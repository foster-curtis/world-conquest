import { createClient } from '@supabase/supabase-js';
import {
  classicMap,
  GAME_CHANNEL_PREFIX,
  type GameEvent,
  MAX_CATCHUP_EVENTS,
  type PlayerView,
  VERSION_BROADCAST_EVENT,
} from '@wc/engine';
import { describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  API_URL,
  finishSetup,
  must,
  owned,
  passTurn,
  sql,
  startedGame,
  type TestUser,
  viewOf,
  waitFor,
} from './helpers.ts';

/** Asserts nothing hidden from `viewer` is in a view or its events. */
function expectNoLeaks(view: PlayerView, events: GameEvent[] | null, viewer: number): void {
  const v = view as unknown as Record<string, unknown>;
  expect(v.deck).toBeUndefined();
  expect(v.hiddenSetup).toBeUndefined();
  for (const s of view.seats) if (s.seat !== viewer) expect(s.hand).toBeNull();
  for (const e of events ?? []) {
    if (e.type === 'GameStarted' || e.type === 'DeckReshuffled') expect(e.deck).toEqual([]);
    if (e.type === 'CardDrawn' && e.seat !== viewer) expect(e.cardId).toBe('');
    if (e.type === 'SetupSubmitted' && e.seat !== viewer) expect(e).toMatchObject({ placements: {}, capital: null });
    if (e.type === 'SeatEliminated' && e.seat !== viewer && e.by !== viewer)
      expect(e.cardsTransferred.every((c) => c === '')).toBe(true);
  }
}

describe('turns through the function', () => {
  it('plays a full turn: place, attack, occupy, fortify, end; broadcasts and writes the outbox', async () => {
    const { host, guest, gameId } = await startedGame();

    // listen for version pings on the game channel, as the client will
    const listener = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
    const pings: number[] = [];
    const channel = listener.channel(GAME_CHANNEL_PREFIX + gameId);
    await new Promise<void>((resolve, reject) => {
      channel
        .on('broadcast', { event: VERSION_BROADCAST_EVENT }, (m) =>
          pings.push((m.payload as { version: number }).version),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
        });
    });

    // setup is hidden: before the other submits, their placements aren't visible
    const bySeat = await finishSetup([host], gameId);
    const guestEarly = await viewOf(guest, gameId, 0);
    expect(guestEarly.view.mySetup).toBeNull();
    expectNoLeaks(guestEarly.view, guestEarly.events?.map((e) => e.event) ?? null, guestEarly.view.viewer as number);
    for (const [seat, user] of await finishSetup([guest], gameId)) bySeat.set(seat, user);

    const { view: start } = await viewOf(host, gameId);
    if (start.phase.kind !== 'turn') throw new Error('expected a turn');
    const seat = start.phase.seat;
    const me = bySeat.get(seat) as TestUser;
    const other = [...bySeat.entries()].find(([s]) => s !== seat) as [number, TestUser];
    const before = start.version;

    const [g] = await sql`select current_seat, awaiting_seats, deadline_at from public.games where id = ${gameId}`;
    expect(g.current_seat).toBe(seat);
    expect(g.awaiting_seats).toEqual([seat]);
    expect(g.deadline_at).not.toBeNull(); // async turn: 24 h deadline

    // not your turn
    const wrong = await viewOf(other[1], gameId);
    expect(wrong.view.viewer).toBe(other[0]);

    // place everything on the territory with the most armies that borders an enemy
    const { view } = await viewOf(me, gameId);
    if (view.phase.kind !== 'turn') throw new Error('expected a turn');
    const mineIds = owned(view, seat);
    const from = mineIds.find((t) => adjacency[t].some((n) => view.territories[n].owner !== seat)) as string;
    const target = adjacency[from].find((n) => view.territories[n].owner !== seat) as string;
    await must(me, gameId, { type: 'PlaceReinforcements', placements: { [from]: view.phase.reinforcementsRemaining } });
    await must(me, gameId, { type: 'Attack', from, to: target, attackerDice: 3, untilConquered: true });
    let after = (await viewOf(me, gameId)).view;
    if (after.phase.kind !== 'turn') throw new Error('expected a turn');
    if (after.phase.pendingOccupy) {
      await must(me, gameId, { type: 'Occupy', armies: after.phase.pendingOccupy.minArmies });
      after = (await viewOf(me, gameId)).view;
    }
    if (after.phase.kind !== 'turn') throw new Error('expected a turn');
    // fortify if a connected pair can move armies
    const src = owned(after, seat).find((t) => after.territories[t].armies > 1);
    const dst = src && adjacency[src].find((n) => after.territories[n].owner === seat);
    if (src && dst) await must(me, gameId, { type: 'Fortify', from: src, to: dst, armies: 1 });
    const endVersion = await must(me, gameId, { type: 'EndTurn' });

    // both players catch up from `before` and see the same (redacted) story
    for (const [s, user] of bySeat) {
      const r = await viewOf(user, gameId, before);
      expect(r.view.version).toBe(endVersion);
      const events = (r.events ?? []).map((e) => e.event);
      const seqs = (r.events ?? []).map((e) => e.seq);
      expect(seqs).toEqual(Array.from({ length: endVersion - before }, (_, i) => before + 1 + i));
      expect(events.map((e) => e.type)).toContain('ArmiesPlaced');
      expect(events.map((e) => e.type)).toContain('AttackRolled');
      expect(events.at(-1)?.type).toBe('TurnStarted');
      expectNoLeaks(r.view, events, s);
    }

    // next player's turn; outbox row for each TurnStarted
    const [g2] = await sql`select current_seat, awaiting_seats from public.games where id = ${gameId}`;
    expect(g2.current_seat).toBe(other[0]);
    const outbox =
      await sql`select kind, recipient_user_id, payload from public.outbox where game_id = ${gameId} order by id`;
    expect(outbox.map((o) => o.recipient_user_id)).toEqual([me.id, other[1].id]);
    expect(outbox[1]).toMatchObject({ kind: 'turn_started', payload: { seat: other[0] } });

    await waitFor(async () => pings.includes(endVersion));
    await listener.removeAllChannels();
  });

  it('?since catch-up: redacted events after since, null when missing or too far behind', async () => {
    const { host, guest, gameId } = await startedGame();
    const bySeat = await finishSetup([host, guest], gameId);
    const v0 = (await viewOf(host, gameId)).view.version;

    expect((await viewOf(host, gameId)).events).toBeNull();
    expect((await viewOf(host, gameId, v0)).events).toEqual([]);

    while ((await viewOf(host, gameId)).view.version <= MAX_CATCHUP_EVENTS + 5) await passTurn(bySeat, gameId);
    const { view } = await viewOf(host, gameId);
    const near = await viewOf(host, gameId, view.version - MAX_CATCHUP_EVENTS);
    expect(near.events).toHaveLength(MAX_CATCHUP_EVENTS);
    expect(near.events?.[0].seq).toBe(view.version - MAX_CATCHUP_EVENTS + 1);
    expect((await viewOf(host, gameId, view.version - MAX_CATCHUP_EVENTS - 1)).events).toBeNull();
    expect((await viewOf(host, gameId, 0)).events).toBeNull();
    expectNoLeaks(near.view, near.events?.map((e) => e.event) ?? null, near.view.viewer as number);
  });
});

const adjacency: Record<string, string[]> = Object.fromEntries(
  Object.entries(classicMap.territories).map(([id, t]) => [id, t.adjacent]),
);

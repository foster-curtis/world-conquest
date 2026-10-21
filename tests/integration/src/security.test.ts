import { createClient } from '@supabase/supabase-js';
import { type ApiError, apply, createInitialState, type ReplayResponse, toPlayerView } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  API_URL,
  admin,
  call,
  createGame,
  finishSetup,
  join,
  must,
  newUser,
  send,
  sql,
  startedGame,
  viewOf,
} from './helpers.ts';

describe('concurrency', () => {
  it('concurrent writes against the same version: one wins, the other gets STALE_VERSION', async () => {
    const host = await newUser('Host');
    const { gameId, version } = await createGame(host);
    const a = await newUser('A');
    const b = await newUser('B');
    const [ra, rb] = await Promise.all([
      send(a, gameId, { type: 'JoinGame', displayName: 'x' }, version),
      send(b, gameId, { type: 'JoinGame', displayName: 'x' }, version),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = (ra.status === 409 ? ra : rb).body as ApiError;
    expect(loser.error.code).toBe('STALE_VERSION');
    // without expectedVersion the function re-decides on the new state, so both joins land
    const c = await newUser('C');
    const d = await newUser('D');
    const both = await Promise.all([
      send(c, gameId, { type: 'JoinGame', displayName: 'x' }),
      send(d, gameId, { type: 'JoinGame', displayName: 'x' }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect((await viewOf(host, gameId)).view.seats).toHaveLength(4);
  });

  it('append_events rejects a stale expected version atomically', async () => {
    const host = await newUser('Host');
    const { gameId } = await createGame(host);
    const [st] = await sql`select seq, state from public.game_state where game_id = ${gameId}`;
    const event = { type: 'SeatColorChanged', seat: 0, color: 'green' };
    const next = { ...st.state, version: st.seq + 1 };
    const stale = await admin.rpc('append_events', {
      p_game_id: gameId,
      p_expected_version: st.seq - 1,
      p_events: [event],
      p_new_state: { ...st.state, version: st.seq },
    });
    expect(stale.error?.message).toContain('STALE_VERSION');
    const good = await admin.rpc('append_events', {
      p_game_id: gameId,
      p_expected_version: st.seq,
      p_events: [event],
      p_new_state: next,
    });
    expect(good.error).toBeNull();
    expect(good.data).toBe(st.seq + 1);
    const again = await admin.rpc('append_events', {
      p_game_id: gameId,
      p_expected_version: st.seq,
      p_events: [event],
      p_new_state: next,
    });
    expect(again.error?.message).toContain('STALE_VERSION');
    const [{ n }] = await sql`select count(*)::int as n from public.game_events where game_id = ${gameId}`;
    expect(n).toBe(st.seq + 1);
  });
});

describe('RLS', () => {
  it('members see metadata, non-members see nothing, nobody reads state/events or writes game tables', async () => {
    const { host, guest, gameId } = await startedGame();
    const stranger = await newUser('Stranger');

    for (const member of [host, guest]) {
      const games = await member.client.from('games').select('id, phase, awaiting_seats, join_code').eq('id', gameId);
      expect(games.error).toBeNull();
      expect(games.data).toHaveLength(1);
      const seats = await member.client.from('game_seats').select('seat, display_name').eq('game_id', gameId);
      expect(seats.data).toHaveLength(3);
    }
    expect((await stranger.client.from('games').select('id').eq('id', gameId)).data).toEqual([]);
    expect((await stranger.client.from('game_seats').select('seat').eq('game_id', gameId)).data).toEqual([]);

    for (const user of [host, stranger]) {
      for (const table of ['game_state', 'game_events', 'outbox']) {
        const r = await user.client.from(table).select('*').eq('game_id', gameId);
        expect(r.data ?? []).toEqual([]);
        expect(r.error).not.toBeNull(); // no grant at all
      }
      for (const table of ['games', 'game_seats', 'game_events', 'game_state', 'outbox']) {
        const ins = await user.client.from(table).insert({ game_id: gameId, id: gameId });
        expect(ins.error).not.toBeNull();
      }
      const upd = await user.client.from('games').update({ phase: 'game_over' }).eq('id', gameId).select();
      expect(upd.error ?? upd.data?.length === 0).toBeTruthy();
      const del = await user.client.from('game_seats').delete().eq('game_id', gameId).select();
      expect(del.error ?? del.data?.length === 0).toBeTruthy();
      for (const fn of ['append_events', 'create_game', 'expired_game_ids', 'cron_claim_timeouts', 'call_game_system']) {
        const args =
          fn === 'append_events'
            ? { p_game_id: gameId, p_expected_version: 0, p_events: [{ type: 'GameCanceled', reason: 'host' }], p_new_state: {} }
            : {};
        const rpc = await user.client.rpc(fn, args);
        expect(rpc.error).not.toBeNull();
      }
    }
    const [g] = await sql`select phase from public.games where id = ${gameId}`;
    expect(g.phase).toBe('setup');
    const [{ n }] = await sql`select count(*)::int as n from public.game_seats where game_id = ${gameId}`;
    expect(n).toBe(3);

    // anonymous (signed-out) clients see nothing either
    const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
    for (const table of ['games', 'game_seats', 'game_state', 'game_events', 'profiles']) {
      expect((await anon.from(table).select('*')).data ?? []).toEqual([]);
    }
  });

  it('profiles: own row only', async () => {
    const a = await newUser('Alice');
    const b = await newUser('Bob');
    const mine = await a.client.from('profiles').select('user_id, display_name');
    expect(mine.data).toEqual([{ user_id: a.id, display_name: 'Alice' }]);
    expect((await a.client.from('profiles').select('*').eq('user_id', b.id)).data).toEqual([]);
    const forge = await a.client.from('profiles').insert({ user_id: b.id, display_name: 'Evil' });
    expect(forge.error).not.toBeNull();
    const steal = await a.client.from('profiles').update({ display_name: 'Evil' }).eq('user_id', b.id).select();
    expect(steal.data ?? []).toEqual([]);
    const rename = await a.client.from('profiles').update({ display_name: 'Alicia' }).eq('user_id', a.id).select();
    expect(rename.data).toEqual([expect.objectContaining({ display_name: 'Alicia' })]);
    const [row] = await sql`select display_name from public.profiles where user_id = ${b.id}`;
    expect(row.display_name).toBe('Bob');
  });
});

describe('protocol and replay', () => {
  it('426 on a missing or different protocol version', async () => {
    const host = await newUser('Host');
    for (const v of [null, '0', '999']) {
      const r = await call<ApiError>(host, 'GET', '/join/ABCDEF', undefined, { 'x-wc-protocol': v });
      expect(r.status).toBe(426);
      expect(r.body.error.code).toBe('PROTOCOL_MISMATCH');
    }
    const sys = await call(null, 'POST', '/system', { gameId: crypto.randomUUID(), action: 'timeout' });
    expect(sys.status).toBe(401); // system route needs the secret
    const forged = await call(null, 'POST', '/system', { gameId: crypto.randomUUID(), action: 'timeout' }, {
      'x-wc-system-secret': 'guess',
    });
    expect(forged.status).toBe(401);
  });

  it('replay: members only, after game_over, unredacted and foldable', async () => {
    const { host, guest, gameId } = await startedGame();
    const stranger = await newUser('Stranger');
    await finishSetup([host, guest], gameId);

    expect((await call<ApiError>(host, 'GET', `/games/${gameId}/replay`)).body.error.code).toBe('NOT_FINISHED');
    await must(guest, gameId, { type: 'LeaveGame' }); // resign → last standing
    const [g] = await sql`select status, phase, awaiting_seats from public.games where id = ${gameId}`;
    expect(g).toMatchObject({ status: 'finished', phase: 'game_over', awaiting_seats: [] });
    expect(await sql`select 1 from public.game_state where game_id = ${gameId}`).toHaveLength(0);

    const denied = await call<ApiError>(stranger, 'GET', `/games/${gameId}/replay`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('NOT_MEMBER');

    for (const member of [host, guest]) {
      const r = await call<ReplayResponse>(member, 'GET', `/games/${gameId}/replay`);
      expect(r.status).toBe(200);
      const started = r.body.events.find((e) => e.event.type === 'GameStarted')?.event;
      expect(started && started.type === 'GameStarted' && started.deck.length).toBeGreaterThan(0);
      const folded = r.body.events.reduce((s, e) => apply(s, e.event), createInitialState(gameId, r.body.settings));
      expect(folded.phase).toMatchObject({ kind: 'game_over', reason: 'last_standing' });
      // the rebuilt live view (game_state is gone) matches the replay fold
      const { view } = await viewOf(member, gameId);
      expect(view).toEqual(toPlayerView(folded, view.viewer));
    }
  });

  it('a removed lobby player loses access', async () => {
    const host = await newUser('Host');
    const guest = await newUser('Guest');
    const { gameId } = await createGame(host);
    await join(guest, gameId);
    expect((await guest.client.from('games').select('id').eq('id', gameId)).data).toHaveLength(1);
    await must(host, gameId, { type: 'RemoveFromLobby', seat: 1 });
    expect((await guest.client.from('games').select('id').eq('id', gameId)).data).toEqual([]);
  });
});

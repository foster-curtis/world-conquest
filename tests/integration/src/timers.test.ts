import { type ApiError, SYSTEM_SECRET_HEADER, TIMERS } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import {
  call,
  createGame,
  expireDeadline,
  join,
  must,
  newUser,
  send,
  sql,
  startedGame,
  viewOf,
  waitFor,
} from './helpers.ts';

describe('timers', () => {
  it('ClaimTimeout is rejected before the deadline and wins once after it', async () => {
    const { host, guest, gameId } = await startedGame({ pace: 'sync', territoryAssignment: 'draft' });
    const { view } = await viewOf(host, gameId);
    if (view.phase.kind !== 'draft') throw new Error('expected draft');
    const claim = { type: 'ClaimTimeout' as const, phase: 'draft' as const, deadlineAt: view.phase.deadlineAt };

    const early = await send(guest, gameId, claim);
    expect(early.status).toBe(422);
    expect((early.body as ApiError).error.code).toBe('TIMER_NOT_EXPIRED');
    const wrong = await send(guest, gameId, { ...claim, deadlineAt: '2020-01-01T00:00:00.000Z' });
    expect((wrong.body as ApiError).error.code).toBe('STALE_VERSION');

    const wait = Date.parse(view.phase.deadlineAt) + TIMERS.graceMs + 300 - Date.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    const [a, b] = await Promise.all([send(host, gameId, claim), send(guest, gameId, claim)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(((a.status === 409 ? a : b).body as ApiError).error.code).toBe('STALE_VERSION');

    const after = (await viewOf(host, gameId, view.version)).events?.map((e) => e.event) ?? [];
    expect(after[0]).toMatchObject({ type: 'DraftPicked', seat: view.phase.pickingSeat, auto: true });
  });

  it('the system route claims only expired deadlines', async () => {
    const { host, gameId } = await startedGame();
    const secret = { [SYSTEM_SECRET_HEADER]: 'local-dev-system-secret' };
    const early = await call<ApiError>(null, 'POST', '/system', { gameId, action: 'timeout' }, secret);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('TIMER_NOT_EXPIRED');
    await expireDeadline(gameId);
    const ok = await call(null, 'POST', '/system', { gameId, action: 'timeout' }, secret);
    expect(ok.status).toBe(200);
    const { view } = await viewOf(host, gameId);
    expect(view.phase.kind).toBe('turn'); // both setups auto-filled
  });
});

describe('cron', () => {
  it('expired_game_ids selects only active games past deadline + grace; the cron job claims them via pg_net', async () => {
    const fresh = await startedGame();
    const expired = await startedGame();
    const lobby = await createGame(await newUser('Lobby'));

    // inside one transaction, so the every-minute job can't race the check
    const ids = await sql.begin(async (tx) => {
      await tx`update public.games set deadline_at = now() - interval '5 seconds' where id = ${expired.gameId}`;
      await tx`update public.games set deadline_at = now() - interval '500 milliseconds' where id = ${fresh.gameId}`;
      const rows = await tx`select public.expired_game_ids() as id`;
      throw Object.assign(new Error('rollback'), { rows });
    }).catch((e: { rows?: { id: string }[] }) => {
      if (!e.rows) throw e;
      return e.rows.map((r) => r.id);
    });
    expect(ids).toContain(expired.gameId);
    expect(ids).not.toContain(fresh.gameId); // within the 1 s grace
    expect(ids).not.toContain(lobby.gameId);
    const [{ none }] = await sql`select count(*)::int as none from public.expired_game_ids() as e (id)
      join public.games g on g.id = e.id where g.status <> 'active' or g.deadline_at + interval '1 second' >= now()`;
    expect(none).toBe(0);

    await expireDeadline(expired.gameId);
    const [{ n }] = await sql`select public.cron_claim_timeouts() as n`;
    expect(n).toBeGreaterThanOrEqual(1);
    await waitFor(async () => {
      const [g] = await sql`select phase from public.games where id = ${expired.gameId}`;
      return g.phase === 'turn';
    });
    const [g] = await sql`select phase from public.games where id = ${fresh.gameId}`;
    expect(g.phase).toBe('setup');
    const [ev] = await sql`select actor_seat from public.game_events where game_id = ${expired.gameId}
      and type = 'SetupSubmitted' order by seq limit 1`;
    expect(ev.actor_seat).toBeNull(); // the system actor
  });

  it('stale lobbies (14 days without events) are canceled as expired', async () => {
    const host = await newUser('Host');
    const stale = await createGame(host);
    const guest = await newUser('Guest');
    await join(guest, stale.gameId);
    const active = await createGame(host);
    const started = await startedGame();

    await sql`update public.games set updated_at = now() - interval '15 days' where id in ${sql([stale.gameId, started.gameId])}`;
    await sql`update public.games set updated_at = now() - interval '13 days' where id = ${active.gameId}`;
    const ids = (await sql`select public.stale_lobby_ids() as id`).map((r) => r.id);
    expect(ids).toContain(stale.gameId);
    expect(ids).not.toContain(active.gameId);
    expect(ids).not.toContain(started.gameId); // not a lobby

    await sql`select public.cron_expire_lobbies()`;
    await waitFor(async () => {
      const [g] = await sql`select status from public.games where id = ${stale.gameId}`;
      return g.status === 'canceled';
    });
    const [last] = await sql`select payload from public.game_events where game_id = ${stale.gameId}
      order by seq desc limit 1`;
    expect(last.payload).toEqual({ type: 'GameCanceled', reason: 'expired' });
    const [a] = await sql`select status from public.games where id = ${active.gameId}`;
    expect(a.status).toBe('lobby');
    // canceled games can't be played on
    expect((await send(host, stale.gameId, { type: 'StartGame' })).status).toBe(422);
    await must(host, active.gameId, { type: 'CancelGame' });
  });
});

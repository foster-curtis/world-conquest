import type { ApiError, JoinLookupResponse } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import { call, createGame, join, must, newUser, send, sql, viewOf } from './helpers.ts';

describe('lobby through the function', () => {
  it('create, look up, join, colors, settings, remove, start', async () => {
    const host = await newUser('Ada');
    const bo = await newUser('Bo');
    const cy = await newUser('Cy');

    const created = await createGame(host, { settings: { maxSeats: 3 }, color: 'cobalt' });
    expect(created.joinCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    expect(created.version).toBe(1);
    const { gameId } = created;

    // a non-member looks the game up by code (lower-case input is fine)
    const look = await call<JoinLookupResponse>(bo, 'GET', `/join/${created.joinCode.toLowerCase()}`);
    expect(look.status).toBe(200);
    expect(look.body).toEqual({
      gameId,
      joinCode: created.joinCode,
      phase: 'lobby',
      isMember: false,
      players: 1,
      maxSeats: 3,
      hostName: 'Ada',
    });
    expect((await call(bo, 'GET', '/join/ZZZZZZ')).status).toBe(404);

    // join: first free color; display name comes from the profile, never from the client
    await must(bo, gameId, { type: 'JoinGame', displayName: 'Mallory', userId: host.id } as never);
    let { view } = await viewOf(host, gameId);
    expect(view.seats.map((s) => [s.seat, s.displayName, s.color, s.userId])).toEqual([
      [0, 'Ada', 'cobalt', host.id],
      [1, 'Bo', 'crimson', bo.id],
    ]);
    expect((await send(bo, gameId, { type: 'JoinGame', displayName: 'x' })).body).toMatchObject({
      error: { code: 'ALREADY_JOINED' },
    });

    // colors
    expect((await send(cy, gameId, { type: 'JoinGame', displayName: 'x', color: 'cobalt' })).body).toMatchObject({
      error: { code: 'COLOR_TAKEN' },
    });
    await join(cy, gameId, 'jade');
    const taken = await send(bo, gameId, { type: 'ChangeColor', color: 'jade' });
    expect(taken.status).toBe(422);
    expect((taken.body as ApiError).error.code).toBe('COLOR_TAKEN');
    expect((await send(bo, gameId, { type: 'ChangeColor', color: 'gray' })).body).toMatchObject({
      error: { code: 'COLOR_TAKEN' },
    });
    await must(bo, gameId, { type: 'ChangeColor', color: 'bone' });

    // a fourth player can't join a 3-seat game
    const dee = await newUser('Dee');
    expect((await send(dee, gameId, { type: 'JoinGame', displayName: 'x' })).body).toMatchObject({
      error: { code: 'GAME_FULL' },
    });

    // settings: host only, validated
    expect((await send(bo, gameId, { type: 'UpdateSettings', settings: { pace: 'sync' } })).body).toMatchObject({
      error: { code: 'NOT_HOST' },
    });
    expect((await send(host, gameId, { type: 'UpdateSettings', settings: { maxSeats: 2 } })).body).toMatchObject({
      error: { code: 'INVALID_SETTINGS' },
    });
    expect(
      (await send(host, gameId, { type: 'UpdateSettings', settings: { territoryAssignment: 'draft' } })).body,
    ).toMatchObject({ error: { code: 'INVALID_SETTINGS' } });
    await must(host, gameId, { type: 'UpdateSettings', settings: { winCondition: 'capitals', maxSeats: 4 } });
    const [row] = await sql`select settings, status, phase, host_user_id from public.games where id = ${gameId}`;
    expect(row.settings).toMatchObject({ mode: 'online', winCondition: 'capitals', maxSeats: 4 });
    expect(row).toMatchObject({ status: 'lobby', phase: 'lobby', host_user_id: host.id });

    // remove: host only
    expect((await send(bo, gameId, { type: 'RemoveFromLobby', seat: 2 })).body).toMatchObject({
      error: { code: 'NOT_HOST' },
    });
    await must(host, gameId, { type: 'RemoveFromLobby', seat: 2 });
    const seats = await sql`select seat, user_id from public.game_seats where game_id = ${gameId} order by seat`;
    expect(seats.map((s) => s.user_id)).toEqual([host.id, bo.id]);
    expect((await call(cy, 'GET', `/games/${gameId}/view`)).status).toBe(403);

    // start: host only
    expect((await send(bo, gameId, { type: 'StartGame' })).body).toMatchObject({ error: { code: 'NOT_HOST' } });
    await must(host, gameId, { type: 'StartGame' });
    ({ view } = await viewOf(bo, gameId));
    expect(view.phase.kind).toBe('setup');
    expect(view.settings.winCondition).toBe('capitals');
    // settings froze at start
    expect((await send(host, gameId, { type: 'UpdateSettings', settings: { pace: 'sync' } })).body).toMatchObject({
      error: { code: 'WRONG_PHASE' },
    });
    // late joiners are told it started
    const late = await call<JoinLookupResponse>(cy, 'GET', `/join/${created.joinCode}`);
    expect(late.body.phase).toBe('setup');
    expect(late.body.isMember).toBe(false);
  });

  it('2-player game gets a gray neutral seat; denormalized columns follow the state', async () => {
    const host = await newUser('Host');
    const guest = await newUser('Guest');
    const { gameId } = await createGame(host);
    await join(guest, gameId);
    await must(host, gameId, { type: 'StartGame' });

    const { view } = await viewOf(host, gameId);
    const neutral = view.seats.filter((s) => s.kind === 'neutral');
    expect(neutral).toHaveLength(1);
    expect(neutral[0]).toMatchObject({ color: 'gray', userId: null, turnOrder: null });
    expect(Object.values(view.territories).filter((t) => t.owner === neutral[0].seat).length).toBe(14);
    if (view.phase.kind !== 'setup') throw new Error('expected setup');

    const [g] =
      await sql`select status, phase, awaiting_seats, deadline_at, version from public.games where id = ${gameId}`;
    expect(g.status).toBe('active');
    expect(g.phase).toBe('setup');
    expect(g.awaiting_seats).toEqual([0, 1]);
    expect(new Date(g.deadline_at).toISOString()).toBe(view.phase.deadlineAt);
    expect(g.version).toBe(view.version);
    const seats =
      await sql`select seat, kind, color, user_id from public.game_seats where game_id = ${gameId} order by seat`;
    expect(seats.map((s) => s.kind)).toEqual(['human', 'human', 'neutral']);
  });

  it('host leaving passes host on; last one out cancels', async () => {
    const host = await newUser('Host');
    const guest = await newUser('Guest');
    const { gameId } = await createGame(host);
    await join(guest, gameId);
    await must(host, gameId, { type: 'LeaveGame' });
    let [g] = await sql`select host_user_id, status from public.games where id = ${gameId}`;
    expect(g.host_user_id).toBe(guest.id);
    await must(guest, gameId, { type: 'LeaveGame' });
    [g] = await sql`select status, phase from public.games where id = ${gameId}`;
    expect(g).toMatchObject({ status: 'canceled', phase: 'canceled' });
    const state = await sql`select 1 from public.game_state where game_id = ${gameId}`;
    expect(state).toHaveLength(0);
  });

  it('needs a profile and valid input', async () => {
    const nameless = await newUser('Nameless', { profile: false });
    const r = await call<ApiError>(nameless, 'POST', '/games', {});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NO_PROFILE');

    const host = await newUser('Host');
    expect((await call<ApiError>(host, 'POST', '/games', { settings: { maxSeats: 9 } })).body.error.code).toBe(
      'INVALID_SETTINGS',
    );
    const { gameId } = await createGame(host);
    expect((await send(host, gameId, { type: 'Nope' })).status).toBe(400);
    expect((await send(host, gameId, { type: 'RemoveFromLobby', seat: 'x' })).status).toBe(400);
    expect((await call(null, 'POST', '/games', {})).status).toBe(401);
    expect((await call(host, 'GET', '/nowhere')).status).toBe(404);
  });
});

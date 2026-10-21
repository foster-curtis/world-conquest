import {
  type Command,
  createInitialState,
  defaultSettings,
  type GameEvent,
  type JoinLookupResponse,
  type PlayerView,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  toPlayerView,
  type ViewResponse,
} from '@wc/engine';
import { describe, expect, it, vi } from 'vitest';
import { ApiException, createApi, type GameApi, RELOAD_MESSAGE } from './api.ts';
import { applyViewResponse, emptySync, sinceFor } from './catchup.ts';
import { MOVED_ON, OnlineGame } from './game/OnlineGame.ts';
import { canSkip, claimable, formatRemaining, timerInfo } from './game/timer.ts';
import { codePage, type LookupState } from './gameScreenState.ts';
import { type GameRow, sectionize, tabTitle } from './mygames.ts';
import { codeFromInput, parseRoute } from './route.ts';

const view = (version: number, patch: Partial<PlayerView> = {}): PlayerView => ({
  ...toPlayerView(createInitialState('g1', defaultSettings('online')), null),
  version,
  ...patch,
});
const ev = (seat: number): GameEvent => ({ type: 'TurnEnded', seat });
const seq = (n: number) => ({ seq: n, event: ev(n) });
const resp = (version: number, events: ViewResponse['events']): ViewResponse => ({ view: view(version), events });

describe('catch-up rules', () => {
  it('asks for since=0 on first load, then for the held version', () => {
    expect(sinceFor(emptySync)).toBe(0);
    const r = applyViewResponse(emptySync, resp(5, [seq(4), seq(5)]));
    expect(sinceFor(r.state)).toBe(5);
  });

  it('first load keeps the events for the feed but animates nothing', () => {
    const r = applyViewResponse(emptySync, resp(2, [seq(1), seq(2)]));
    expect(r.animate).toEqual([]);
    expect(r.state.log.map((e) => e.seq)).toEqual([1, 2]);
    expect(r.snapped).toBe(false);
  });

  it('animates only events newer than the held version, in order', () => {
    const first = applyViewResponse(emptySync, resp(2, [seq(1), seq(2)])).state;
    const r = applyViewResponse(first, resp(4, [seq(2), seq(3), seq(4)]));
    expect(r.animate).toEqual([ev(3), ev(4)]);
    expect(r.state.log.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(r.state.version).toBe(4);
  });

  it('snaps without animating when events is null (too far behind)', () => {
    const first = applyViewResponse(emptySync, resp(2, [seq(1), seq(2)])).state;
    const r = applyViewResponse(first, resp(300, null));
    expect(r.snapped).toBe(true);
    expect(r.animate).toEqual([]);
    expect(r.state.version).toBe(300);
    expect(r.state.log).toEqual([]);
  });

  it('drops a response older than what is held', () => {
    const first = applyViewResponse(emptySync, resp(5, [seq(5)])).state;
    const r = applyViewResponse(first, resp(3, [seq(3)]));
    expect(r.ignored).toBe(true);
    expect(r.state).toBe(first);
  });
});

function fakeApi(over: Partial<GameApi> = {}): GameApi & { calls: string[] } {
  const calls: string[] = [];
  const base: GameApi = {
    createGame: vi.fn(),
    lookup: vi.fn(),
    replay: vi.fn(),
    command: vi.fn(async (_id: string, _c: Command, _v?: number) => ({ version: 1 })),
    view: vi.fn(async () => resp(1, [])),
  };
  const api = { ...base, ...over } as GameApi & { calls: string[] };
  api.calls = calls;
  return api;
}

describe('OnlineGame', () => {
  it('fetches with since, then since=<version>, and emits new events to listeners', async () => {
    const views = [resp(1, [seq(1)]), resp(2, [seq(2)])];
    const api = fakeApi({ view: vi.fn(async () => views.shift() as ViewResponse) });
    const g = new OnlineGame(api, 'g1');
    const heard: GameEvent[][] = [];
    g.subscribe((e) => heard.push(e));
    await g.refresh();
    expect(api.view).toHaveBeenLastCalledWith('g1', 0);
    expect(heard).toEqual([]);
    await g.refresh();
    expect(api.view).toHaveBeenLastCalledWith('g1', 1);
    expect(heard).toEqual([[ev(2)]]);
    expect(g.version).toBe(2);
  });

  it('sends the held version as expectedVersion and re-fetches after a command', async () => {
    const api = fakeApi({ view: vi.fn(async () => resp(3, [seq(3)])) });
    const g = new OnlineGame(api, 'g1');
    await g.refresh();
    const r = await g.dispatch({ type: 'EndTurn' });
    expect(r.ok).toBe(true);
    expect(api.command).toHaveBeenCalledWith('g1', { type: 'EndTurn' }, 3);
    expect(api.view).toHaveBeenCalledTimes(2);
  });

  it('STALE_VERSION reloads the view and shows the "game moved on" notice', async () => {
    const api = fakeApi({
      command: vi.fn(async () => {
        throw new ApiException(409, 'STALE_VERSION', 'stale');
      }),
      view: vi.fn(async () => resp(7, null)),
    });
    const g = new OnlineGame(api, 'g1');
    const r = await g.dispatch({ type: 'EndTurn' });
    expect(r).toEqual({ ok: false, error: { code: 'STALE_VERSION', message: MOVED_ON } });
    expect(g.notice).toBe(MOVED_ON);
    expect(g.version).toBe(7);
  });

  it('a network failure flags offline and a later success clears it; nothing is queued', async () => {
    let fail = true;
    const api = fakeApi({
      view: vi.fn(async () => {
        if (fail) throw new ApiException(0, 'NETWORK', 'offline');
        return resp(1, []);
      }),
    });
    const g = new OnlineGame(api, 'g1');
    await g.refresh();
    expect(g.offline).toBe(true);
    expect(g.ready).toBe(false);
    fail = false;
    await g.refresh();
    expect(g.offline).toBe(false);
    expect(api.command).not.toHaveBeenCalled();
  });

  it('collapses concurrent refreshes into at most one follow-up fetch', async () => {
    const api = fakeApi();
    const g = new OnlineGame(api, 'g1');
    await Promise.all([g.refresh(), g.refresh(), g.refresh()]);
    expect(api.view).toHaveBeenCalledTimes(2);
  });
});

describe('api client', () => {
  const mk = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const onOutdated = vi.fn();
    const api = createApi({ baseUrl: 'http://x/fn', getToken: () => 'jwt', fetch: fetchMock as never, onOutdated });
    return { fetchMock, onOutdated, api };
  };

  it('sends the protocol header and the bearer token', async () => {
    const { fetchMock, api } = mk(200, { version: 1 });
    await api.command('g', { type: 'EndTurn' }, 4);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/fn/games/g/commands');
    const h = init.headers as Record<string, string>;
    expect(h[PROTOCOL_HEADER]).toBe(String(PROTOCOL_VERSION));
    expect(h.Authorization).toBe('Bearer jwt');
    expect(JSON.parse(init.body as string)).toEqual({ command: { type: 'EndTurn' }, expectedVersion: 4 });
  });

  it('turns 426 into the reload message and notifies the app', async () => {
    const { api, onOutdated } = mk(426, { error: { code: 'PROTOCOL_MISMATCH', message: 'old' } });
    await expect(api.view('g')).rejects.toMatchObject({ status: 426, message: RELOAD_MESSAGE });
    expect(onOutdated).toHaveBeenCalled();
  });

  it('maps error bodies and omits since when absent', async () => {
    const { api, fetchMock } = mk(422, { error: { code: 'NOT_YOUR_TURN', message: 'nope' } });
    await expect(api.view('g')).rejects.toMatchObject({ code: 'NOT_YOUR_TURN', status: 422 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://x/fn/games/g/view');
  });
});

describe('/g/:code routing states', () => {
  const lookup = (patch: Partial<JoinLookupResponse>): JoinLookupResponse => ({
    gameId: 'g1',
    joinCode: 'K7QM2X',
    phase: 'lobby',
    isMember: false,
    players: 1,
    maxSeats: 4,
    hostName: 'Ana',
    ...patch,
  });
  const ok = (l: JoinLookupResponse): LookupState => ({ status: 'ok', lookup: l });

  it('signed-out visitors sign in first, on the same URL', () => {
    expect(codePage(false, { status: 'idle' }).kind).toBe('signin');
  });
  it('loads while looking up', () => {
    expect(codePage(true, { status: 'loading' }).kind).toBe('loading');
  });
  it('non-members see the join page in the lobby', () => {
    expect(codePage(true, ok(lookup({}))).kind).toBe('join');
  });
  it('members see the game itself, lobby or board', () => {
    expect(codePage(true, ok(lookup({ isMember: true }))).kind).toBe('member');
    expect(codePage(true, ok(lookup({ isMember: true, phase: 'turn' }))).kind).toBe('member');
  });
  it('non-members after the start see "already started"', () => {
    expect(codePage(true, ok(lookup({ phase: 'turn' }))).kind).toBe('started');
    expect(codePage(true, ok(lookup({ phase: 'game_over' }))).kind).toBe('started');
  });
  it('canceled games say so', () => {
    expect(codePage(true, ok(lookup({ phase: 'canceled' }))).kind).toBe('canceled');
  });
  it('unknown codes, errors and outdated clients', () => {
    expect(codePage(true, { status: 'failed', error: new ApiException(404, 'NOT_FOUND', 'x') }).kind).toBe('not_found');
    expect(codePage(true, { status: 'failed', error: new ApiException(426, 'PROTOCOL_MISMATCH', 'x') })).toMatchObject({
      kind: 'error',
      reload: true,
    });
    expect(codePage(true, { status: 'failed', error: new Error('boom') })).toMatchObject({
      kind: 'error',
      message: 'boom',
    });
  });

  it('parses URLs', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/g/k7qm2x')).toEqual({ kind: 'game', code: 'K7QM2X' });
    expect(parseRoute('/g/K7QM2X/replay')).toEqual({ kind: 'replay', code: 'K7QM2X' });
    expect(parseRoute('/g/K7QM2X/stats/')).toEqual({ kind: 'stats', code: 'K7QM2X' });
    expect(parseRoute('/g/O0O0O0')).toEqual({ kind: 'home' }); // look-alike characters are not in the alphabet
    expect(parseRoute('/elsewhere')).toEqual({ kind: 'home' });
    expect(codeFromInput('https://world-conquest.fostercurtis.dev/g/K7QM2X')).toBe('K7QM2X');
    expect(codeFromInput(' k7qm2x ')).toBe('K7QM2X');
    expect(codeFromInput('nope')).toBeNull();
  });
});

describe('timers', () => {
  const turnView = (pace: 'sync' | 'async', viewer: number, deadlineAt: string | null) =>
    view(5, {
      viewer,
      settings: { ...defaultSettings('online'), pace },
      phase: {
        kind: 'turn',
        seat: 0,
        step: 'reinforce',
        reinforcementsRemaining: 3,
        conqueredThisTurn: false,
        pendingOccupy: null,
        forcedTrade: null,
        fortified: false,
        startedAt: '2026-01-01T00:00:00.000Z',
        lastActionAt: '2026-01-01T00:00:00.000Z',
        deadlineAt,
      },
      seats: [{ seat: 1, status: 'active' } as never],
    });

  it('async turns count down to deadlineAt and become claimable after the grace', () => {
    const v = turnView('async', 1, '2026-01-02T00:00:00.000Z');
    const info = timerInfo(v);
    const end = Date.parse('2026-01-02T00:00:00.000Z');
    expect(info.claim).toEqual({ phase: 'turn', deadlineAt: '2026-01-02T00:00:00.000Z' });
    expect(claimable(info, end + 500)).toBe(false);
    expect(claimable(info, end + 1500)).toBe(true);
  });

  it('sync turns let other players skip after 5 minutes idle', () => {
    const v = turnView('sync', 1, null);
    const info = timerInfo(v);
    const t0 = Date.parse('2026-01-01T00:00:00.000Z');
    expect(info.claim).toBeNull();
    expect(canSkip(v, info, t0 + 4 * 60_000)).toBe(false);
    expect(canSkip(v, info, t0 + 5 * 60_000)).toBe(true);
    // the current player never sees Skip
    const mine = turnView('sync', 0, null);
    expect(canSkip(mine, timerInfo(mine), t0 + 10 * 60_000)).toBe(false);
  });

  it('formats countdowns', () => {
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});

describe('My games', () => {
  const row = (id: string, patch: Partial<GameRow>): GameRow => ({
    id,
    join_code: id.toUpperCase(),
    status: 'active',
    phase: 'turn',
    awaiting_seats: [],
    settings: defaultSettings('online'),
    updated_at: '2026-01-01T00:00:00Z',
    game_seats: [
      { seat: 0, user_id: 'me', display_name: 'Me', color: 'red', kind: 'human', status: 'active' },
      { seat: 1, user_id: 'you', display_name: 'You', color: 'blue', kind: 'human', status: 'active' },
    ],
    ...patch,
  });

  it('sorts games into sections and hides canceled ones', () => {
    const g = sectionize(
      [
        row('a', { awaiting_seats: [0] }),
        row('b', { awaiting_seats: [1] }),
        row('c', { status: 'lobby', phase: 'lobby' }),
        row('d', { status: 'finished', phase: 'game_over', updated_at: '2026-02-01T00:00:00Z' }),
        row('e', { status: 'finished', phase: 'game_over' }),
        row('f', { status: 'canceled', phase: 'canceled' }),
      ],
      'me',
    );
    expect(g.yourMove.map((x) => x.id)).toEqual(['a']);
    expect(g.waiting.map((x) => x.id)).toEqual(['b']);
    expect(g.lobbies.map((x) => x.id)).toEqual(['c']);
    expect(g.finished.map((x) => x.id)).toEqual(['d', 'e']); // most recent first
  });

  it('puts the waiting-on-you count in the tab title', () => {
    expect(tabTitle(2)).toBe('(2) World Conquest');
    expect(tabTitle(0)).toBe('World Conquest');
  });
});

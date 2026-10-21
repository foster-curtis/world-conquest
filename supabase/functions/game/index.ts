// Single edge function for every command and every PlayerView read (SPEC §6); the cron fallback calls
// POST /system as the `system` actor. Routes and bodies: the transport section of packages/engine/src/types.ts.
import '@supabase/functions-js/edge-runtime.d.ts';
import {
  type Actor,
  apply,
  type Command,
  type CommandResponse,
  type CreateGameResponse,
  createInitialState,
  type DecideContext,
  decide,
  defaultSettings,
  type GameEvent,
  type GameSettings,
  type GameState,
  getMap,
  type JoinLookupResponse,
  MAX_CATCHUP_EVENTS,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type ReplayResponse,
  redactEvent,
  type SequencedEvent,
  SYSTEM_SECRET_HEADER,
  type SystemRequest,
  toPlayerView,
  type ViewResponse,
  validateSettings,
} from '@wc/engine';
import { CORS_HEADERS, errorResponse, HttpError, json, readJson, rejection, safeEqual } from './http.ts';
import { type LoadedGame, StaleVersion, Store } from './store.ts';
import * as validate from './validate.ts';

const MAX_ATTEMPTS = 5; // re-decide on version conflict
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

let store: Store | null = null;
const getStore = () => {
  store ??= new Store(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  return store;
};

/** Crypto-backed uniform [0, 1). */
function cryptoRng(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  // 53 random bits
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
}

function randomJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(cryptoRng() * CODE_ALPHABET.length)];
  return code;
}

function context(settings: GameSettings): DecideContext {
  const map = getMap(settings.mapId);
  if (!map) throw new Error(`unknown map ${settings.mapId}`);
  return { now: new Date(), rng: cryptoRng, map };
}

function seatOf(state: GameState, userId: string): number | null {
  return state.seats.find((s) => s.userId === userId)?.seat ?? null;
}

// ---------------------------------------------------------------------------- write path

/**
 * Load → decide → append_events, re-deciding on a version conflict (SPEC §6 Write path).
 * `prepare` builds the actor and command from the freshly loaded state (membership can change between tries).
 */
async function runCommand(
  gameId: string,
  prepare: (g: LoadedGame) => { actor: Actor; command: Command },
  expectedVersion?: number,
): Promise<CommandResponse> {
  const s = getStore();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const g = await s.load(gameId);
    if (!g) throw new HttpError(404, 'NOT_FOUND', 'no such game');
    if (expectedVersion !== undefined && g.state.version !== expectedVersion) {
      throw rejection('STALE_VERSION', `the game is at version ${g.state.version}`);
    }
    const { actor, command } = prepare(g);
    let result: ReturnType<typeof decide>;
    try {
      result = decide(g.state, actor, command, context(g.state.settings));
    } catch (e) {
      console.error('decide threw', e);
      throw new HttpError(400, 'BAD_REQUEST', 'malformed command');
    }
    if (!result.ok) throw rejection(result.error.code, result.error.message);
    const events = result.value;
    if (events.length === 0) return { version: g.state.version };
    const next = events.reduce<GameState>((st, e) => apply(st, e), g.state);
    try {
      const version = await s.append(gameId, g.state.version, events, next, actor.kind === 'seat' ? actor.seat : null);
      await s.broadcast(gameId, version);
      return { version };
    } catch (e) {
      if (!(e instanceof StaleVersion)) throw e;
      if (expectedVersion !== undefined) throw rejection('STALE_VERSION', 'another write landed first');
    }
  }
  throw rejection('STALE_VERSION', 'too many concurrent writes, try again');
}

// ---------------------------------------------------------------------------- handlers

async function createGame(userId: string, req: Request): Promise<CreateGameResponse> {
  const body = await readJson(req);
  const color = validate.optionalColor(body.color);
  const settings: GameSettings = {
    ...defaultSettings('online'),
    ...validate.settingsPatch(body.settings),
    mode: 'online',
  };
  const problem = validateSettings(settings, 1);
  if (problem) throw rejection('INVALID_SETTINGS', problem);
  const displayName = await requireProfile(userId);

  const s = getStore();
  const gameId = crypto.randomUUID();
  const initial = createInitialState(gameId, settings);
  const join: Command = { type: 'JoinGame', displayName, userId, ...(color ? { color } : {}) };
  const result = decide(initial, { kind: 'system' }, join, context(settings));
  if (!result.ok) throw rejection(result.error.code, result.error.message);
  const next = result.value.reduce<GameState>((st, e) => apply(st, e), initial);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const joinCode = randomJoinCode();
    if (await s.create(joinCode, result.value, next)) {
      await s.broadcast(gameId, next.version);
      return { gameId, joinCode, version: next.version };
    }
  }
  throw new HttpError(500, 'INTERNAL', 'could not allocate a join code');
}

async function requireProfile(userId: string): Promise<string> {
  const name = await getStore().displayName(userId);
  if (!name) throw new HttpError(400, 'NO_PROFILE', 'set a display name first');
  return name;
}

async function lookup(userId: string, code: string): Promise<JoinLookupResponse> {
  const s = getStore();
  const gameId = /^[2-9A-HJKMNP-Z]{6}$/.test(code) ? await s.gameIdByCode(code) : null;
  const g = gameId ? await s.load(gameId) : null;
  if (!g) throw new HttpError(404, 'NOT_FOUND', 'no game with that code');
  const { state } = g;
  return {
    gameId: state.gameId,
    joinCode: g.row.join_code,
    phase: state.phase.kind,
    isMember: seatOf(state, userId) !== null,
    players: state.seats.filter((x) => x.kind === 'human').length,
    maxSeats: state.settings.maxSeats,
    hostName: state.seats.find((x) => x.seat === state.hostSeat)?.displayName ?? null,
  };
}

async function command(userId: string, gameId: string, req: Request): Promise<CommandResponse> {
  const body = await readJson(req);
  const cmd = validate.command(body.command);
  const expected = body.expectedVersion;
  if (expected !== undefined && !Number.isSafeInteger(expected)) {
    throw new HttpError(400, 'BAD_REQUEST', 'expectedVersion must be an integer');
  }
  const joinName = cmd.type === 'JoinGame' ? await requireProfile(userId) : '';
  return runCommand(
    gameId,
    ({ state }) => {
      const seat = seatOf(state, userId);
      if (cmd.type === 'JoinGame') {
        // The engine ignores the JoinGame actor except for ALREADY_JOINED; name and user come from the server.
        const actor: Actor = seat === null ? { kind: 'system' } : { kind: 'seat', seat };
        return { actor, command: { ...cmd, displayName: joinName, userId } };
      }
      if (seat === null) throw new HttpError(403, 'NOT_MEMBER', 'you are not in this game');
      return { actor: { kind: 'seat', seat }, command: cmd };
    },
    expected as number | undefined,
  );
}

async function memberGame(userId: string, gameId: string): Promise<{ g: LoadedGame; seat: number }> {
  const g = await getStore().load(gameId);
  if (!g) throw new HttpError(404, 'NOT_FOUND', 'no such game');
  const seat = seatOf(g.state, userId);
  if (seat === null) throw new HttpError(403, 'NOT_MEMBER', 'you are not in this game');
  return { g, seat };
}

async function view(userId: string, gameId: string, url: URL): Promise<ViewResponse> {
  const raw = url.searchParams.get('since');
  let since: number | null = null;
  if (raw !== null && raw !== '') {
    since = Number(raw);
    if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, 'BAD_REQUEST', 'since must be a version');
  }
  const { g, seat } = await memberGame(userId, gameId);
  const version = g.state.version;
  let events: SequencedEvent[] | null = null;
  if (since !== null && since <= version && version - since <= MAX_CATCHUP_EVENTS) {
    const rows = await getStore().events(gameId, since);
    events = [];
    for (const r of rows) {
      if (r.seq > version) break; // a write landed after the state snapshot; the next ping covers it
      const event = redactEvent(r.event, seat);
      if (event) events.push({ seq: r.seq, event });
    }
  }
  return { view: toPlayerView(g.state, seat), events };
}

async function replayGame(userId: string, gameId: string): Promise<ReplayResponse> {
  const { g } = await memberGame(userId, gameId);
  if (g.state.phase.kind !== 'game_over') throw new HttpError(409, 'NOT_FINISHED', 'replay opens after game over');
  const events: { seq: number; event: GameEvent }[] = await getStore().events(gameId, 0);
  return { gameId, settings: g.state.settings, events };
}

async function system(req: Request): Promise<CommandResponse> {
  const secret = req.headers.get(SYSTEM_SECRET_HEADER) ?? '';
  if (!safeEqual(secret, env('WC_SYSTEM_SECRET'))) throw new HttpError(401, 'UNAUTHORIZED', 'bad system secret');
  const body = await readJson(req);
  const { gameId, action } = body as Partial<SystemRequest>;
  if (typeof gameId !== 'string' || !UUID.test(gameId)) throw new HttpError(400, 'BAD_REQUEST', 'bad gameId');
  if (action !== 'timeout' && action !== 'expire') throw new HttpError(400, 'BAD_REQUEST', 'bad action');
  return runCommand(gameId, ({ state }) => {
    if (action === 'expire') return { actor: { kind: 'system' }, command: { type: 'CancelGame' } };
    const p = state.phase;
    if ((p.kind !== 'draft' && p.kind !== 'setup' && p.kind !== 'turn') || p.deadlineAt === null) {
      throw rejection('WRONG_PHASE', 'nothing to time out');
    }
    return { actor: { kind: 'system' }, command: { type: 'ClaimTimeout', phase: p.kind, deadlineAt: p.deadlineAt } };
  });
}

// ---------------------------------------------------------------------------- routing

async function authUser(req: Request): Promise<string> {
  const header = req.headers.get('Authorization') ?? '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = jwt ? await getStore().userId(jwt) : null;
  if (!userId) throw new HttpError(401, 'UNAUTHORIZED', 'sign in first');
  return userId;
}

async function route(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  const url = new URL(req.url);
  // pathname is `/game/...` locally and in production; keep what follows the function name
  const path = url.pathname.replace(/^.*?\/game(?=\/|$)/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  if (req.method === 'POST' && path === '/system') return json(await system(req));

  if (req.headers.get(PROTOCOL_HEADER) !== String(PROTOCOL_VERSION)) {
    throw new HttpError(426, 'PROTOCOL_MISMATCH', `protocol ${PROTOCOL_VERSION} required: reload`);
  }
  const userId = await authUser(req);

  if (req.method === 'POST' && path === '/games') return json(await createGame(userId, req), 201);
  if (req.method === 'GET' && parts[0] === 'join' && parts.length === 2) {
    return json(await lookup(userId, decodeURIComponent(parts[1]).toUpperCase()));
  }
  if (parts[0] === 'games' && parts.length === 3 && UUID.test(parts[1])) {
    const [, gameId, action] = parts;
    if (req.method === 'POST' && action === 'commands') return json(await command(userId, gameId, req));
    if (req.method === 'GET' && action === 'view') return json(await view(userId, gameId, url));
    if (req.method === 'GET' && action === 'replay') return json(await replayGame(userId, gameId));
  }
  throw new HttpError(404, 'NOT_FOUND', `no route ${req.method} ${path}`);
}

Deno.serve(async (req) => {
  try {
    return await route(req);
  } catch (e) {
    return errorResponse(e);
  }
});

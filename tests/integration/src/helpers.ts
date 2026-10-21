// Shared helpers: users, the `game` function client, direct SQL for setup/backdating, polling.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  type ApiError,
  type Color,
  type Command,
  type CommandResponse,
  type CreateGameRequest,
  type CreateGameResponse,
  isValidSet,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type PlayerView,
  type ViewResponse,
} from '@wc/engine';
import postgres from 'postgres';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing: run through vitest (global-setup reads \`supabase status\`)`);
  return v;
}

export const API_URL = env('WC_API_URL');
export const FN_URL = `${API_URL}/functions/v1/game`;
export const ANON_KEY = env('WC_ANON_KEY');
export const SERVICE_KEY = env('WC_SERVICE_KEY');
export const MAIL_URL = env('WC_MAIL_URL');
export const sql = postgres(env('WC_DB_URL'), { max: 2, onnotice: () => {} });

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = createClient(API_URL, SERVICE_KEY, noSession);

export interface TestUser {
  id: string;
  email: string;
  token: string;
  client: SupabaseClient; // signed in as this user, RLS applies
}

const run = Math.random().toString(36).slice(2, 8);
let counter = 0;

export function uniqueEmail(tag: string): string {
  counter += 1;
  return `${tag}-${run}-${counter}@example.test`;
}

/** A confirmed user with a password session and (unless `profile: false`) a profile row. */
export async function newUser(name: string, opts: { profile?: boolean } = {}): Promise<TestUser> {
  const email = uniqueEmail(name.toLowerCase());
  const password = `pw-${run}-${counter}-secret`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(API_URL, ANON_KEY, noSession);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('no session');
  const user: TestUser = { id: created.data.user.id, email, token: signedIn.data.session.access_token, client };
  if (opts.profile !== false) {
    const { error } = await client.from('profiles').insert({ user_id: user.id, display_name: name });
    if (error) throw error;
  }
  return user;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

/** Raw call to the function with the protocol header (override or drop it via `headers`). */
export async function call<T = unknown>(
  user: TestUser | null,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string | null> = {},
): Promise<ApiResult<T>> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) };
  if (user) h.Authorization = `Bearer ${user.token}`;
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) delete h[k];
    else h[k] = v;
  }
  const res = await fetch(FN_URL + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}

function ok<T>(r: ApiResult<T | ApiError>, what: string): T {
  if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as T;
}

export async function createGame(user: TestUser, req: CreateGameRequest = {}): Promise<CreateGameResponse> {
  return ok(await call<CreateGameResponse>(user, 'POST', '/games', req), 'create');
}

export function send(user: TestUser, gameId: string, command: Command | Record<string, unknown>, expectedVersion?: number) {
  return call<CommandResponse | ApiError>(user, 'POST', `/games/${gameId}/commands`, {
    command,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  });
}

export async function must(user: TestUser, gameId: string, command: Command): Promise<number> {
  return ok(await send(user, gameId, command), command.type).version;
}

export async function viewOf(user: TestUser, gameId: string, since?: number): Promise<ViewResponse> {
  const q = since === undefined ? '' : `?since=${since}`;
  return ok(await call<ViewResponse>(user, 'GET', `/games/${gameId}/view${q}`), 'view');
}

export async function join(user: TestUser, gameId: string, color?: Color): Promise<number> {
  return must(user, gameId, { type: 'JoinGame', displayName: 'ignored', ...(color ? { color } : {}) });
}

/** Two-player game in setup: [host, guest, gameId]. */
export async function startedGame(
  settings: CreateGameRequest['settings'] = {},
): Promise<{ host: TestUser; guest: TestUser; gameId: string }> {
  const host = await newUser('Host');
  const guest = await newUser('Guest');
  const { gameId } = await createGame(host, { settings });
  await join(guest, gameId);
  await must(host, gameId, { type: 'StartGame' });
  return { host, guest, gameId };
}

export function owned(view: PlayerView, seat: number): string[] {
  return Object.keys(view.territories).filter((t) => view.territories[t].owner === seat);
}

/** Both players submit setup (everything on their first territory). Returns the users by seat. */
export async function finishSetup(players: TestUser[], gameId: string): Promise<Map<number, TestUser>> {
  const bySeat = new Map<number, TestUser>();
  for (const p of players) {
    const { view } = await viewOf(p, gameId);
    const seat = view.viewer as number;
    bySeat.set(seat, p);
    if (view.phase.kind !== 'setup') continue;
    const [first] = owned(view, seat);
    await must(p, gameId, { type: 'SubmitSetup', placements: { [first]: view.phase.armiesToPlace[seat] } });
  }
  return bySeat;
}

/** The current player places everything on one territory and ends the turn (no attacks). */
export async function passTurn(bySeat: Map<number, TestUser>, gameId: string): Promise<number> {
  const any = bySeat.values().next().value as TestUser;
  const { view } = await viewOf(any, gameId);
  if (view.phase.kind !== 'turn') throw new Error(`not in a turn: ${view.phase.kind}`);
  const me = bySeat.get(view.phase.seat) as TestUser;
  const mine = await viewOf(me, gameId);
  if (mine.view.phase.kind !== 'turn') throw new Error('turn moved on');
  const hand = mine.view.seats.find((s) => s.seat === mine.view.viewer)?.hand ?? [];
  if (hand.length >= 5) {
    const set = findSet(mine.view, hand);
    if (set) await must(me, gameId, { type: 'TradeCards', cardIds: set });
  }
  const again = (await viewOf(me, gameId)).view;
  if (again.phase.kind !== 'turn') throw new Error('turn moved on');
  const [first] = owned(again, again.viewer as number);
  if (again.phase.reinforcementsRemaining > 0) {
    await must(me, gameId, { type: 'PlaceReinforcements', placements: { [first]: again.phase.reinforcementsRemaining } });
  }
  return must(me, gameId, { type: 'EndTurn' });
}

export function findSet(view: PlayerView, hand: string[]): [string, string, string] | null {
  for (let a = 0; a < hand.length; a++)
    for (let b = a + 1; b < hand.length; b++)
      for (let c = b + 1; c < hand.length; c++) {
        const ids: [string, string, string] = [hand[a], hand[b], hand[c]];
        if (isValidSet(ids.map((id) => view.cards[id].symbol))) return ids;
      }
  return null;
}

/** Polls `check` until it returns a truthy value or the timeout passes. */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Moves a game's current deadline into the past, in both the state snapshot and the `games` row. */
export async function expireDeadline(gameId: string, deadlineIso = '2020-01-01T00:00:00.000Z'): Promise<void> {
  await sql`update public.game_state set state = jsonb_set(state, '{phase,deadlineAt}', to_jsonb(${deadlineIso}::text))
            where game_id = ${gameId}`;
  await sql`update public.games set deadline_at = ${deadlineIso} where id = ${gameId}`;
}

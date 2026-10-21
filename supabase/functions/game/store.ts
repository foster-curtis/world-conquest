// Database access for the `game` function (service role: bypasses RLS, the only writer of game tables).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createInitialState,
  GAME_CHANNEL_PREFIX,
  type GameEvent,
  type GameSettings,
  type GameState,
  replay,
  VERSION_BROADCAST_EVENT,
  type VersionPing,
} from '@wc/engine';

const PAGE = 1000; // PostgREST max_rows (config.toml)

export interface GameRow {
  id: string;
  status: 'lobby' | 'active' | 'finished' | 'canceled';
  join_code: string;
  settings: GameSettings;
  version: number;
}

export interface LoadedGame {
  row: GameRow;
  state: GameState;
}

/** Thrown by append when another write landed first. */
export class StaleVersion extends Error {}

export class Store {
  readonly db: SupabaseClient;
  private readonly url: string;
  private readonly key: string;

  constructor(url: string, serviceKey: string) {
    this.url = url;
    this.key = serviceKey;
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  /** The caller's user id from a user JWT, or null. */
  async userId(jwt: string): Promise<string | null> {
    const { data, error } = await this.db.auth.getUser(jwt);
    if (error || !data.user) return null;
    return data.user.id;
  }

  async displayName(userId: string): Promise<string | null> {
    const { data, error } = await this.db.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.display_name ?? null;
  }

  async gameIdByCode(code: string): Promise<string | null> {
    const { data, error } = await this.db.from('games').select('id').eq('join_code', code).maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }

  /** Row + full state in one snapshot. Finished/canceled games have no `game_state` row: rebuilt from events. */
  async load(gameId: string): Promise<LoadedGame | null> {
    const { data, error } = await this.db
      .from('games')
      .select('id, status, join_code, settings, version, game_state(seq, state)')
      .eq('id', gameId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    type Snap = { seq: number; state: GameState };
    const { game_state, ...row } = data as unknown as GameRow & { game_state: Snap | Snap[] | null };
    // one-to-one embed (game_state.game_id is the PK): PostgREST returns an object, older versions an array
    const snap = Array.isArray(game_state) ? (game_state[0] ?? null) : game_state;
    if (snap && snap.seq === row.version) return { row, state: snap.state };
    const events = await this.events(gameId, 0);
    const state = replay(
      createInitialState(gameId, row.settings),
      events.map((e) => e.event),
    );
    return { row, state };
  }

  /** Events with seq > since, in order, all pages. */
  async events(gameId: string, since: number): Promise<{ seq: number; event: GameEvent }[]> {
    const out: { seq: number; event: GameEvent }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from('game_events')
        .select('seq, payload')
        .eq('game_id', gameId)
        .gt('seq', since)
        .order('seq')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data) out.push({ seq: r.seq, event: r.payload as GameEvent });
      if (data.length < PAGE) return out;
    }
  }

  async append(
    gameId: string,
    expectedVersion: number,
    events: GameEvent[],
    newState: GameState,
    actorSeat: number | null,
  ): Promise<number> {
    const { data, error } = await this.db.rpc('append_events', {
      p_game_id: gameId,
      p_expected_version: expectedVersion,
      p_events: events,
      p_new_state: newState,
      p_actor_seat: actorSeat,
    });
    if (error) {
      if (error.message.includes('STALE_VERSION')) throw new StaleVersion(error.message);
      throw error;
    }
    return data as number;
  }

  /** Inserts the game row and its first events; false when the join code is already taken. */
  async create(joinCode: string, events: GameEvent[], newState: GameState): Promise<boolean> {
    const { error } = await this.db.rpc('create_game', {
      p_game_id: newState.gameId,
      p_join_code: joinCode,
      p_events: events,
      p_new_state: newState,
      p_actor_seat: null,
    });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw error;
  }

  /** Realtime broadcast `{ version }` on `game:<id>` (REST endpoint, no socket). Best effort. */
  async broadcast(gameId: string, version: number): Promise<void> {
    const payload: VersionPing = { version };
    try {
      const res = await fetch(`${this.url}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ topic: GAME_CHANNEL_PREFIX + gameId, event: VERSION_BROADCAST_EVENT, payload, private: false }],
        }),
      });
      if (!res.ok) console.error('broadcast failed', res.status, await res.text());
    } catch (e) {
      console.error('broadcast failed', e);
    }
  }
}

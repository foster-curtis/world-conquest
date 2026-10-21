// Pass-and-play game controller: runs decide/apply with Math.random and saves every event (SPEC 1, 7.8).
// The UI only ever receives `toPlayerView(state, viewer)`; full state never leaves this class.
import {
  type Actor,
  apply,
  type Color,
  type Command,
  createInitialState,
  decide,
  defaultSettings,
  type GameEvent,
  type GameState,
  getMap,
  type MapDefinition,
  type PlayerCount,
  type PlayerView,
  type Result,
  type SeatId,
  toPlayerView,
  type WinCondition,
} from '@wc/engine';
import type { SavedPlayer, SaveMeta, SaveStore } from './store.ts';

export interface PlayerInput {
  name: string;
  color: Color;
}

export interface ControllerDeps {
  rng?: () => number;
  now?: () => Date;
}

type Listener = (events: GameEvent[]) => void;

export class LocalGame {
  readonly id: string;
  readonly map: MapDefinition;
  private state: GameState;
  private log: GameEvent[];
  private turns: number;
  private passedKey: string | null = null;
  private view: { version: number; viewer: SeatId | null; value: PlayerView } | null = null;
  private listeners = new Set<Listener>();
  private queue: Promise<void> = Promise.resolve();
  private readonly store: SaveStore;
  private meta: SaveMeta;
  private saved: number;
  private readonly rng: () => number;
  private readonly now: () => Date;

  private constructor(
    store: SaveStore,
    meta: SaveMeta,
    events: GameEvent[],
    saved: number,
    deps: ControllerDeps,
  ) {
    this.store = store;
    this.id = meta.id;
    this.meta = meta;
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? (() => new Date());
    const map = getMap(meta.settings.mapId);
    if (!map) throw new Error(`unknown map ${meta.settings.mapId}`);
    this.map = map;
    this.log = events;
    this.saved = saved;
    this.state = events.reduce(apply, createInitialState(meta.id, meta.settings));
    this.turns = events.filter((e) => e.type === 'TurnStarted').length;
  }

  /** Starts a new game: everyone joins, seat 0 hosts and starts. Saved immediately. */
  static async create(
    store: SaveStore,
    players: PlayerInput[],
    winCondition: WinCondition,
    deps: ControllerDeps = {},
  ): Promise<LocalGame> {
    const rng = deps.rng ?? Math.random;
    const now = (deps.now ?? (() => new Date()))();
    const id = `local-${now.getTime().toString(36)}-${Math.floor(rng() * 1e9).toString(36)}`;
    const settings = {
      ...defaultSettings('local'),
      winCondition,
      maxSeats: players.length as PlayerCount,
    };
    const map = getMap(settings.mapId) as MapDefinition;
    let state = createInitialState(id, settings);
    const events: GameEvent[] = [];
    const run = (actor: Actor, cmd: Command) => {
      const r = decide(state, actor, cmd, { now, rng, map });
      if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.error.message}`);
      for (const e of r.value) {
        state = apply(state, e);
        events.push(e);
      }
    };
    for (const p of players) run({ kind: 'system' }, { type: 'JoinGame', displayName: p.name, color: p.color });
    run({ kind: 'seat', seat: state.hostSeat }, { type: 'StartGame' });
    const meta: SaveMeta = {
      id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      settings,
      players: seatsOf(state),
      status: 'playing',
      winner: null,
      eventCount: events.length,
    };
    const game = new LocalGame(store, meta, events, 0, deps);
    game.persist();
    await game.flush();
    return game;
  }

  /** Rebuilds a game from its saved events. The pass screen is shown first. */
  static async resume(store: SaveStore, id: string, deps: ControllerDeps = {}): Promise<LocalGame | null> {
    const rec = await store.load(id);
    if (!rec) return null;
    return new LocalGame(store, rec.meta, rec.events, rec.events.length, deps);
  }

  // ---- reading

  get events(): readonly GameEvent[] {
    return this.log;
  }

  get settings() {
    return this.state.settings;
  }

  get over(): boolean {
    return this.state.phase.kind === 'game_over';
  }

  get phaseKind(): string {
    return this.state.phase.kind;
  }

  get players(): SavedPlayer[] {
    return this.meta.players;
  }

  /** The seat whose turn (or setup) it is, or null in lobby/game over. */
  actingSeat(): SeatId | null {
    const p = this.state.phase;
    if (p.kind === 'turn') return p.seat;
    if (p.kind === 'setup') {
      const next = this.state.seats
        .filter((s) => s.kind === 'human' && s.status === 'active' && !p.submitted.includes(s.seat))
        .sort((a, b) => (a.turnOrder ?? 0) - (b.turnOrder ?? 0))[0];
      return next ? next.seat : null;
    }
    return null;
  }

  /** Who may see their hidden info right now: the acting seat; nobody (spectator) at game over. */
  viewer(): SeatId | null {
    return this.state.phase.kind === 'game_over' ? null : this.actingSeat();
  }

  getView(): PlayerView {
    const viewer = this.viewer();
    if (!this.view || this.view.version !== this.state.version || this.view.viewer !== viewer) {
      this.view = { version: this.state.version, viewer, value: toPlayerView(this.state, viewer) };
    }
    return this.view.value;
  }

  private passKey(): string | null {
    const seat = this.actingSeat();
    if (seat === null) return null;
    return `${this.state.phase.kind}:${seat}:${this.turns}`;
  }

  /** True while the "Pass the device to ..." screen must be shown (before every turn and setup turn). */
  needsPass(): boolean {
    const key = this.passKey();
    return key !== null && key !== this.passedKey;
  }

  confirmPass(): void {
    this.passedKey = this.passKey();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- acting

  /** Runs a command as the acting seat. Applied and queued for saving before it returns. */
  dispatch(cmd: Command): Result<GameEvent[]> {
    const seat = this.actingSeat();
    if (seat === null) return { ok: false, error: { code: 'WRONG_PHASE', message: 'nobody can act right now' } };
    const r = decide(this.state, { kind: 'seat', seat }, cmd, { now: this.now(), rng: this.rng, map: this.map });
    if (!r.ok) return r;
    for (const e of r.value) {
      this.state = apply(this.state, e);
      this.log.push(e);
      if (e.type === 'TurnStarted') this.turns++;
    }
    this.persist();
    for (const l of this.listeners) l(r.value);
    return r;
  }

  private persist(): void {
    const p = this.state.phase;
    this.meta = {
      ...this.meta,
      updatedAt: this.now().toISOString(),
      status: p.kind === 'game_over' ? 'finished' : 'playing',
      winner: p.kind === 'game_over' ? p.winner : null,
      eventCount: this.log.length,
      players: seatsOf(this.state),
    };
    const from = this.saved;
    const events = this.log.slice(from);
    this.saved = this.log.length;
    const meta = this.meta;
    this.queue = this.queue.then(() => this.store.append(meta, events, from)).catch(() => undefined);
  }

  /** Resolves when every queued save has been written. */
  flush(): Promise<void> {
    return this.queue;
  }
}

function seatsOf(state: GameState): SavedPlayer[] {
  return state.seats
    .filter((s) => s.kind === 'human')
    .map((s) => ({ seat: s.seat, name: s.displayName, color: s.color }));
}

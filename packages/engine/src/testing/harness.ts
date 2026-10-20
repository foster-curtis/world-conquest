// Test-only game driver: runs decide → apply exactly like a server would, freezing every state so any
// mutation by decide/apply throws, and checking board invariants after every event.
import { apply } from '../apply.ts';
import { decide } from '../decide.ts';
import { classicMap } from '../maps/classic.ts';
import { createInitialState, defaultSettings, ownedTerritories } from '../state.ts';
import type {
  Actor,
  Command,
  GameEvent,
  GameSettings,
  GameState,
  RejectionCode,
  Result,
  SeatId,
  TerritoryId,
} from '../types.ts';
import { seededRng } from './rng.ts';

/** Every event type any Game in this test file has emitted (vitest isolates files, so it's per file). */
export const emittedTypes = new Set<GameEvent['type']>();

export const seat = (n: SeatId): Actor => ({ kind: 'seat', seat: n });
export const SYSTEM: Actor = { kind: 'system' };

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Invariants that must hold after every event. Throws with a description on failure. */
export function checkInvariants(s: GameState): void {
  const pending = s.phase.kind === 'turn' ? s.phase.pendingOccupy : null;
  for (const [id, t] of Object.entries(s.territories)) {
    if (!Number.isInteger(t.armies) || t.armies < 0) throw new Error(`negative armies on ${id}`);
    if (t.armies === 0 && pending?.to !== id && s.phase.kind !== 'game_over') throw new Error(`empty territory ${id}`);
  }
  if (s.phase.kind === 'turn') {
    const p = s.phase;
    if (p.reinforcementsRemaining < 0) throw new Error('negative reinforcements');
    if (p.forcedTrade && p.forcedTrade.armiesToPlace < 0) throw new Error('negative forced-trade armies');
  }
  const ids = Object.keys(s.cards);
  if (ids.length > 0) {
    const held = [...s.deck, ...s.discard, ...s.seats.flatMap((x) => x.hand)];
    if (held.length !== ids.length || new Set(held).size !== ids.length) throw new Error('cards not conserved');
  }
}

export class Game {
  readonly initial: GameState;
  state: GameState;
  readonly log: GameEvent[] = [];
  now = new Date('2026-01-01T00:00:00.000Z');
  readonly rng: () => number;
  checks = true;

  constructor(settings: Partial<GameSettings> = {}, seed = 1) {
    this.initial = createInitialState('game-1', { ...defaultSettings('local'), ...settings });
    this.state = deepFreeze(this.initial);
    this.rng = seededRng(seed);
  }

  get map() {
    return classicMap;
  }

  try(actor: Actor, cmd: Command): Result<GameEvent[]> {
    return decide(this.state, actor, cmd, { now: this.now, rng: this.rng, map: classicMap });
  }

  /** Run a command that must succeed; returns its events. */
  do(actor: Actor, cmd: Command): GameEvent[] {
    const r = this.try(actor, cmd);
    if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.error.code} (${r.error.message})`);
    this.push(r.value);
    return r.value;
  }

  push(events: GameEvent[]): void {
    for (const e of events) {
      this.state = deepFreeze(apply(this.state, e));
      this.log.push(e);
      emittedTypes.add(e.type);
      if (this.checks) checkInvariants(this.state);
    }
  }

  /** Run a command that must be rejected; returns the code. State must not change. */
  reject(actor: Actor, cmd: Command): RejectionCode {
    const before = this.state;
    const r = this.try(actor, cmd);
    if (r.ok) throw new Error(`${cmd.type} unexpectedly accepted: ${r.value.map((e) => e.type).join(', ')}`);
    if (this.state !== before) throw new Error('state changed on rejection');
    return r.error.code;
  }

  advance(ms: number): void {
    this.now = new Date(this.now.getTime() + ms);
  }

  /** Test-only escape hatch to set up a board position (breaks replay from the log). */
  patch(mutate: (s: GameState) => void): void {
    const s: GameState = JSON.parse(JSON.stringify(this.state));
    mutate(s);
    this.state = deepFreeze(s);
  }

  owned(n: SeatId): TerritoryId[] {
    return ownedTerritories(this.state, classicMap, n);
  }

  turnSeat(): SeatId {
    if (this.state.phase.kind !== 'turn') throw new Error(`not in a turn (${this.state.phase.kind})`);
    return this.state.phase.seat;
  }
}

/** n players join (seat 0 hosts) and, unless start = false, the host starts the game. */
export function lobbyGame(n: number, settings: Partial<GameSettings> = {}, seed = 1, start = true): Game {
  const g = new Game(settings, seed);
  for (let i = 0; i < n; i++) g.do(SYSTEM, { type: 'JoinGame', displayName: `P${i}`, userId: `user-${i}` });
  if (start) g.do(seat(0), { type: 'StartGame' });
  return g;
}

/** Every active human that hasn't submitted places evenly (capital = first owned). */
export function finishSetup(g: Game): void {
  const p = g.state.phase;
  if (p.kind !== 'setup') throw new Error('not in setup');
  for (const s of g.state.seats) {
    if (s.kind !== 'human' || s.status !== 'active' || p.submitted.includes(s.seat)) continue;
    const owned = g.owned(s.seat);
    const n = p.armiesToPlace[s.seat];
    const placements: Record<TerritoryId, number> = {};
    owned.forEach((t, i) => {
      const k = Math.floor(n / owned.length) + (i < n % owned.length ? 1 : 0);
      if (k > 0) placements[t] = k;
    });
    g.do(seat(s.seat), { type: 'SubmitSetup', placements, capital: owned[0] });
  }
}

/** A started game, setup done, now in turn 1. */
export function playingGame(n: number, settings: Partial<GameSettings> = {}, seed = 1): Game {
  const g = lobbyGame(n, settings, seed);
  finishSetup(g);
  return g;
}

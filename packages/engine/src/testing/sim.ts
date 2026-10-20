// Test-only random-legal-move simulation. The "bot" is a test driver, not a product feature (bots are §10).
import { findValidSet } from '../rules/cards.ts';
import { maxAttackerDice } from '../rules/combat.ts';
import { connectedOwned } from '../rules/fortify.ts';
import { pick, randomInt } from '../rules/random.ts';
import type { Command, GameSettings, SeatId, TerritoryId } from '../types.ts';
import { TIMERS } from '../types.ts';
import { type Game, lobbyGame, SYSTEM, seat } from './harness.ts';
import { seededRng } from './rng.ts';

export interface SimOptions {
  players: number;
  seed: number;
  settings?: Partial<GameSettings>;
  /** Chance per step of letting the current deadline expire (ClaimTimeout) or of a sync SkipTurn. */
  timeoutRate?: number;
  /** Chance per step that a random active human resigns. */
  resignRate?: number;
  /** Chance per step of sending a random (often illegal) command; accepted ones are applied. */
  fuzzRate?: number;
  maxSteps?: number;
  /** Called after every step. */
  onStep?: (g: Game) => void;
}

export function simulate(opts: SimOptions): Game {
  const g = lobbyGame(opts.players, opts.settings ?? {}, opts.seed);
  const rnd = seededRng(opts.seed ^ 0x5eed);
  const maxSteps = opts.maxSteps ?? 20_000;
  for (let step = 0; g.state.phase.kind !== 'game_over'; step++) {
    if (step >= maxSteps) throw new Error(`no winner after ${maxSteps} steps (seed ${opts.seed})`);
    g.advance(1_000);
    stepOnce(g, rnd, opts);
    opts.onStep?.(g);
  }
  return g;
}

function activeHumans(g: Game): SeatId[] {
  return g.state.seats.filter((s) => s.kind === 'human' && s.status === 'active').map((s) => s.seat);
}

function stepOnce(g: Game, rnd: () => number, opts: SimOptions): void {
  const p = g.state.phase;
  if (rnd() < (opts.resignRate ?? 0)) {
    g.do(seat(pick(rnd, activeHumans(g))), { type: 'LeaveGame' });
    return;
  }
  if (rnd() < (opts.timeoutRate ?? 0)) {
    if ((p.kind === 'draft' || p.kind === 'setup' || p.kind === 'turn') && p.deadlineAt !== null) {
      g.now = new Date(Date.parse(p.deadlineAt) + TIMERS.graceMs + 1);
      g.do(SYSTEM, { type: 'ClaimTimeout', phase: p.kind, deadlineAt: p.deadlineAt });
      return;
    }
    if (p.kind === 'turn') {
      const others = activeHumans(g).filter((s) => s !== p.seat);
      if (g.state.settings.mode === 'online' && g.state.settings.pace === 'sync' && others.length > 0) {
        g.advance(TIMERS.turnInactivityMs + 1);
        g.do(seat(pick(rnd, others)), { type: 'SkipTurn' });
        return;
      }
    }
  }
  if (rnd() < (opts.fuzzRate ?? 0)) {
    const r = g.try(seat(randomInt(rnd, 6)), fuzzCommand(g, rnd));
    if (r.ok) g.push(r.value);
    return;
  }
  const actorAndCmd = legalMove(g, rnd);
  g.do(seat(actorAndCmd[0]), actorAndCmd[1]);
}

function frontier(g: Game, s: SeatId): TerritoryId[] {
  return g.owned(s).filter((t) => g.map.territories[t].adjacent.some((n) => g.state.territories[n].owner !== s));
}

function strongest(g: Game, ts: TerritoryId[]): TerritoryId {
  return ts.reduce((best, t) => (g.state.territories[t].armies > g.state.territories[best].armies ? t : best));
}

/** A plausible, aggressive legal move for whoever has to act next. */
export function legalMove(g: Game, rnd: () => number): [SeatId, Command] {
  const p = g.state.phase;
  const terr = g.state.territories;
  if (p.kind === 'draft') {
    const free = Object.keys(g.map.territories).filter((t) => !terr[t]);
    return [p.pickingSeat, { type: 'DraftPick', territory: pick(rnd, free) }];
  }
  if (p.kind === 'setup') {
    const s = activeHumans(g).find((x) => !p.submitted.includes(x)) as SeatId;
    const owned = g.owned(s);
    const placements: Record<TerritoryId, number> = {};
    for (let i = 0; i < p.armiesToPlace[s]; i++) {
      const t = pick(rnd, owned);
      placements[t] = (placements[t] ?? 0) + 1;
    }
    return [s, { type: 'SubmitSetup', placements, capital: pick(rnd, owned) }];
  }
  if (p.kind !== 'turn') throw new Error(`no move in phase ${p.kind}`);
  const me = p.seat;
  const hand = g.state.seats.find((x) => x.seat === me)?.hand ?? [];
  const set = findValidSet(hand, g.state.cards);
  const front = frontier(g, me);
  if (p.pendingOccupy) {
    const { minArmies, maxArmies } = p.pendingOccupy;
    const armies = rnd() < 0.9 ? maxArmies : minArmies + randomInt(rnd, maxArmies - minArmies + 1);
    return [me, { type: 'Occupy', armies }];
  }
  if (p.forcedTrade) {
    if (hand.length > 4 && set) return [me, { type: 'TradeCards', cardIds: set }];
    return [me, { type: 'PlaceReinforcements', placements: { [strongest(g, front)]: p.forcedTrade.armiesToPlace } }];
  }
  if (p.step === 'reinforce') {
    if (set && (hand.length >= 5 || rnd() < 0.5)) return [me, { type: 'TradeCards', cardIds: set }];
    const n = p.reinforcementsRemaining;
    if (rnd() < 0.3 && n > 1) {
      // partial placement; the rest comes next step
      return [me, { type: 'PlaceReinforcements', placements: { [pick(rnd, g.owned(me))]: 1 } }];
    }
    return [me, { type: 'PlaceReinforcements', placements: { [strongest(g, front)]: n } }];
  }
  if (p.step === 'attack' && rnd() < 0.97) {
    const from = front.filter((t) => terr[t].armies >= 2);
    if (from.length > 0) {
      const f = rnd() < 0.9 ? strongest(g, from) : pick(rnd, from);
      const targets = g.map.territories[f].adjacent.filter((n) => terr[n].owner !== me);
      const to = targets.reduce((a, b) => (terr[b].armies < terr[a].armies ? b : a));
      // press on while it looks favorable, and sometimes take a long shot
      if (terr[f].armies > terr[to].armies || rnd() < 0.2) {
        const max = maxAttackerDice(terr[f].armies);
        const blitz = rnd() < 0.8;
        const dice = (blitz ? max : 1 + randomInt(rnd, max)) as 1 | 2 | 3;
        return [me, { type: 'Attack', from: f, to, attackerDice: dice, untilConquered: blitz }];
      }
    }
  }
  const interior = g.owned(me).filter((t) => terr[t].armies >= 2 && !front.includes(t));
  if (!p.fortified && interior.length > 0 && rnd() < 0.7) {
    // bring idle armies to the front
    const from = strongest(g, interior);
    const reach = [...connectedOwned(g.map, terr, me, from)].filter((t) => front.includes(t));
    if (reach.length > 0)
      return [me, { type: 'Fortify', from, to: strongest(g, reach), armies: terr[from].armies - 1 }];
  }
  if (!p.fortified && rnd() < 0.3) {
    const sources = g.owned(me).filter((t) => terr[t].armies >= 2);
    if (sources.length > 0) {
      const from = pick(rnd, sources);
      const reach = [...connectedOwned(g.map, terr, me, from)].filter((t) => t !== from);
      if (reach.length > 0) {
        const armies = 1 + randomInt(rnd, terr[from].armies - 1);
        return [me, { type: 'Fortify', from, to: pick(rnd, reach), armies }];
      }
    }
  }
  if (p.step === 'attack' && rnd() < 0.3) return [me, { type: 'EndAttack' }];
  return [me, { type: 'EndTurn' }];
}

function fuzzCommand(g: Game, rnd: () => number): Command {
  const ids = Object.keys(g.map.territories);
  const t = () => pick(rnd, ids);
  const n = () => randomInt(rnd, 8) - 1;
  const cards = Object.keys(g.state.cards);
  const card = () => (cards.length > 0 ? pick(rnd, cards) : 'nope');
  const options: Command[] = [
    {
      type: 'Attack',
      from: t(),
      to: t(),
      attackerDice: (1 + randomInt(rnd, 3)) as 1 | 2 | 3,
      untilConquered: rnd() < 0.5,
    },
    { type: 'Fortify', from: t(), to: t(), armies: n() },
    { type: 'PlaceReinforcements', placements: { [t()]: n() } },
    { type: 'TradeCards', cardIds: [card(), card(), card()] },
    { type: 'Occupy', armies: n() },
    { type: 'EndAttack' },
    { type: 'EndTurn' },
    { type: 'DraftPick', territory: t() },
    { type: 'SubmitSetup', placements: { [t()]: n() } },
    { type: 'SkipTurn' },
    { type: 'ChangeColor', color: 'green' },
    { type: 'StartGame' },
  ];
  return pick(rnd, options);
}

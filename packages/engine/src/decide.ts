// decide(state, actor, command, ctx) → events | rejection. The only place randomness and time are read
// (ctx.rng, ctx.now). Events are folded through apply() as they are emitted, so every later check sees
// exactly the state a replay would see.
import { apply } from './apply.ts';
import { getMap } from './maps/index.ts';
import { evenPlacements, forcedTradeSets, randomPlacements } from './rules/autoplay.ts';
import { buildCards, isValidSet, tradeBonusTerritory } from './rules/cards.ts';
import { defenderDice, maxAttackerDice, resolveRound, rollDice } from './rules/combat.ts';
import { lastStanding, mapWin, ownsAny } from './rules/conquest.ts';
import { canFortifyPath } from './rules/fortify.ts';
import { pick, shuffle } from './rules/random.ts';
import { reinforcementsFor } from './rules/reinforcements.ts';
import { assignmentOrder, findSeat, getSeat, nextTurnSeat, ownedTerritories } from './state.ts';
import {
  type Actor,
  type Color,
  type Command,
  type DecideContext,
  type GameEvent,
  type GameSettings,
  type GameState,
  MIN_SEATS,
  MUST_TRADE_AT,
  NEUTRAL_COLOR,
  type Phase,
  type PlayerCount,
  type RejectionCode,
  type Result,
  type Seat,
  type SeatId,
  type TerritoryId,
  TIMERS,
  tradeValue,
} from './types.ts';

/** Colors offered to humans, in "first free" order. */
export const SEAT_COLORS: readonly Color[] = ['crimson', 'cobalt', 'jade', 'berry', 'bone', 'sky'];
const MAX_SEAT_ID = 5;
const HAND_LIMIT_AFTER_FORCED_TRADE = 4;

type TurnPhase = Extract<Phase, { kind: 'turn' }>;

class Rejected extends Error {
  readonly code: RejectionCode;
  constructor(code: RejectionCode, message: string) {
    super(message);
    this.code = code;
  }
}

function reject(code: RejectionCode, message: string): never {
  throw new Rejected(code, message);
}

/** Accumulates events and keeps a folded copy of the state in step with them. */
class Builder {
  readonly events: GameEvent[] = [];
  s: GameState;
  readonly ctx: DecideContext;
  constructor(s: GameState, ctx: DecideContext) {
    this.s = s;
    this.ctx = ctx;
  }

  emit(event: GameEvent): void {
    this.events.push(event);
    this.s = apply(this.s, event);
  }

  get map() {
    return this.ctx.map;
  }

  iso(offsetMs = 0): string {
    return new Date(this.ctx.now.getTime() + offsetMs).toISOString();
  }

  get over(): boolean {
    return this.s.phase.kind === 'game_over';
  }

  turn(): TurnPhase {
    if (this.s.phase.kind !== 'turn') throw new Error('not in a turn');
    return this.s.phase;
  }
}

export function decide(state: GameState, actor: Actor, cmd: Command, ctx: DecideContext): Result<GameEvent[]> {
  const b = new Builder(state, ctx);
  try {
    dispatch(b, actor, cmd);
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
  return { ok: true, value: b.events };
}

// ---------------------------------------------------------------------------- dispatch

function dispatch(b: Builder, actor: Actor, cmd: Command): void {
  // Commands that don't need the actor to hold a seat.
  if (cmd.type === 'JoinGame') joinGame(b, actor, cmd);
  else if (cmd.type === 'CancelGame') cancelGame(b, actor);
  else if (cmd.type === 'ClaimTimeout') {
    if (actor.kind === 'seat') actorSeat(b, actor);
    claimTimeout(b, cmd);
  } else seatCommand(b, actorSeat(b, actor), cmd);
}

function seatCommand(
  b: Builder,
  seat: Seat,
  cmd: Exclude<Command, { type: 'JoinGame' | 'CancelGame' | 'ClaimTimeout' }>,
) {
  if (cmd.type === 'LeaveGame') {
    if (b.s.phase.kind === 'lobby') leaveLobby(b, seat.seat, false);
    else resign(b, seat);
  } else if (cmd.type === 'ChangeColor') changeColor(b, seat, cmd.color);
  else if (cmd.type === 'UpdateSettings') updateSettings(b, seat, cmd.settings);
  else if (cmd.type === 'RemoveFromLobby') removeFromLobby(b, seat, cmd.seat);
  else if (cmd.type === 'StartGame') startGame(b, seat);
  else if (cmd.type === 'DraftPick') draftPick(b, seat, cmd.territory);
  else if (cmd.type === 'SubmitSetup') submitSetup(b, seat, cmd.placements, cmd.capital ?? null);
  else if (cmd.type === 'SkipTurn') skipTurn(b, seat);
  else turnCommand(b, seat, cmd);
}

function actorSeat(b: Builder, actor: Actor): Seat {
  if (actor.kind !== 'seat') reject('NOT_A_SEAT', 'this command needs a seat');
  const seat = findSeat(b.s, actor.seat);
  if (seat?.kind !== 'human') reject('NOT_A_SEAT', `seat ${actor.seat} is not in this game`);
  return seat;
}

function requireLobby(b: Builder): void {
  if (b.s.phase.kind !== 'lobby') reject('WRONG_PHASE', 'only allowed in the lobby');
}

function requireHost(b: Builder, seat: Seat): void {
  if (seat.seat !== b.s.hostSeat) reject('NOT_HOST', 'only the host can do that');
}

// ---------------------------------------------------------------------------- lobby

function joinGame(b: Builder, actor: Actor, cmd: Extract<Command, { type: 'JoinGame' }>): void {
  requireLobby(b);
  const userId = cmd.userId ?? null;
  if (actor.kind === 'seat' && findSeat(b.s, actor.seat)) reject('ALREADY_JOINED', 'already in this game');
  if (userId !== null && b.s.seats.some((s) => s.userId === userId)) reject('ALREADY_JOINED', 'already in this game');
  if (b.s.seats.length >= b.s.settings.maxSeats) reject('GAME_FULL', 'the game is full');
  const taken = new Set(b.s.seats.map((s) => s.color));
  let color: Color;
  if (cmd.color !== undefined) {
    if (cmd.color === NEUTRAL_COLOR || taken.has(cmd.color)) reject('COLOR_TAKEN', `${cmd.color} is not available`);
    color = cmd.color;
  } else {
    color = SEAT_COLORS.find((c) => !taken.has(c)) as Color;
  }
  b.emit({ type: 'SeatJoined', seat: lowestFreeSeat(b.s), userId, displayName: cmd.displayName, color });
}

function lowestFreeSeat(s: GameState): SeatId {
  for (let id = 0; id <= MAX_SEAT_ID; id++) if (!findSeat(s, id)) return id;
  throw new Error('no free seat id');
}

function leaveLobby(b: Builder, seat: SeatId, removedByHost: boolean): void {
  const wasHost = seat === b.s.hostSeat;
  b.emit({ type: 'SeatLeft', seat, removedByHost });
  if (!wasHost) return;
  // seats stay in join order, so the first remaining seat is the earliest-joined one
  const next = b.s.seats[0];
  if (next) b.emit({ type: 'HostChanged', seat: next.seat });
  else b.emit({ type: 'GameCanceled', reason: 'empty' });
}

function changeColor(b: Builder, seat: Seat, color: Color): void {
  requireLobby(b);
  if (color === NEUTRAL_COLOR || b.s.seats.some((s) => s.color === color))
    reject('COLOR_TAKEN', `${color} is not available`);
  b.emit({ type: 'SeatColorChanged', seat: seat.seat, color });
}

function cancelGame(b: Builder, actor: Actor): void {
  if (actor.kind === 'system') {
    requireLobby(b);
    b.emit({ type: 'GameCanceled', reason: 'expired' });
    return;
  }
  const seat = actorSeat(b, actor);
  requireLobby(b);
  requireHost(b, seat);
  b.emit({ type: 'GameCanceled', reason: 'host' });
}

export function validateSettings(settings: GameSettings, joined: number): string | null {
  if (!getMap(settings.mapId)) return `unknown map ${settings.mapId}`;
  if (!['local', 'online'].includes(settings.mode)) return 'bad mode';
  if (!['classic', 'capitals'].includes(settings.winCondition)) return 'bad win condition';
  if (!['sync', 'async'].includes(settings.pace)) return 'bad pace';
  if (!['random', 'draft'].includes(settings.territoryAssignment)) return 'bad territory assignment';
  if (settings.territoryAssignment === 'draft' && !(settings.mode === 'online' && settings.pace === 'sync')) {
    return 'draft needs an online, sync game';
  }
  if (![2, 3, 4, 5, 6].includes(settings.maxSeats)) return 'maxSeats must be 2–6';
  if (settings.maxSeats < joined) return 'maxSeats is below the number of joined players';
  return null;
}

function updateSettings(b: Builder, seat: Seat, patch: Partial<GameSettings>): void {
  requireLobby(b);
  requireHost(b, seat);
  const settings: GameSettings = { ...b.s.settings, ...patch };
  const problem = validateSettings(settings, b.s.seats.length);
  if (problem) reject('INVALID_SETTINGS', problem);
  b.emit({ type: 'SettingsUpdated', settings });
}

function removeFromLobby(b: Builder, host: Seat, target: SeatId): void {
  requireLobby(b);
  requireHost(b, host);
  if (!findSeat(b.s, target)) reject('NOT_A_SEAT', `seat ${target} is not in this game`);
  leaveLobby(b, target, target !== host.seat);
}

// ---------------------------------------------------------------------------- start & assignment

function startGame(b: Builder, seat: Seat): void {
  requireLobby(b);
  requireHost(b, seat);
  const humans = b.s.seats.map((s) => s.seat);
  if (humans.length < MIN_SEATS) reject('NOT_ENOUGH_PLAYERS', `needs at least ${MIN_SEATS} players`);
  const rng = b.ctx.rng;
  const turnOrder = shuffle(rng, humans);
  const neutralSeat = humans.length === 2 ? lowestFreeSeat(b.s) : null;
  const deck = shuffle(rng, Object.keys(buildCards(b.map)));
  const draft = b.s.settings.territoryAssignment === 'draft';
  b.emit({
    type: 'GameStarted',
    turnOrder,
    neutralSeat,
    deck,
    draftDeadlineAt: draft ? b.iso(TIMERS.draftPickMs) : null,
  });
  if (draft) {
    continueDraft(b);
    return;
  }

  const order = assignmentOrder(b.s);
  const territories = shuffle(rng, Object.keys(b.map.territories));
  const assignments: Record<TerritoryId, SeatId> = {};
  territories.forEach((t, i) => {
    assignments[t] = order[i % order.length];
  });
  b.emit({ type: 'TerritoriesDealt', assignments });
  startSetup(b);
}

function unclaimed(b: Builder): TerritoryId[] {
  return Object.keys(b.map.territories).filter((t) => !b.s.territories[t]);
}

function emitDraftPick(b: Builder, seat: SeatId, territory: TerritoryId, auto: boolean): void {
  const remaining = unclaimed(b).length - 1;
  b.emit({
    type: 'DraftPicked',
    seat,
    territory,
    auto,
    nextDeadlineAt: remaining > 0 ? b.iso(TIMERS.draftPickMs) : null,
  });
}

/** Inert seats (neutral, kicked) pick instantly at random; stops at the next human pick or the end of the draft. */
function continueDraft(b: Builder): void {
  while (b.s.phase.kind === 'draft') {
    const free = unclaimed(b);
    if (free.length === 0) {
      startSetup(b);
      return;
    }
    const picker = getSeat(b.s, b.s.phase.pickingSeat);
    if (picker.kind === 'human' && picker.status === 'active') return;
    emitDraftPick(b, picker.seat, pick(b.ctx.rng, free), true);
  }
}

function draftPick(b: Builder, seat: Seat, territory: TerritoryId): void {
  if (b.s.phase.kind !== 'draft') reject('WRONG_PHASE', 'not drafting');
  if (b.s.phase.pickingSeat !== seat.seat) reject('NOT_YOUR_TURN', 'not your pick');
  if (!b.map.territories[territory]) reject('INVALID_PLACEMENT', `unknown territory ${territory}`);
  if (b.s.territories[territory]) reject('TERRITORY_TAKEN', `${territory} is taken`);
  resetStrikes(b, seat.seat);
  emitDraftPick(b, seat.seat, territory, false);
  continueDraft(b);
}

// ---------------------------------------------------------------------------- setup

function startSetup(b: Builder): void {
  const humans = b.s.seats.filter((s) => s.kind === 'human').length as PlayerCount;
  const starting = b.map.startingArmies[humans];
  const armiesToPlace: Record<SeatId, number> = {};
  for (const seat of assignmentOrder(b.s)) {
    armiesToPlace[seat] = Math.max(0, starting - ownedTerritories(b.s, b.map, seat).length);
  }
  b.emit({ type: 'SetupStarted', armiesToPlace, deadlineAt: b.iso(TIMERS.setupMs[b.s.settings.pace]) });
  for (const seat of b.s.seats) {
    if (seat.kind === 'neutral') {
      const placements = randomPlacements(b.ctx.rng, armiesToPlace[seat.seat], ownedTerritories(b.s, b.map, seat.seat));
      b.emit({ type: 'NeutralPlaced', seat: seat.seat, placements });
    } else if (seat.status !== 'active') {
      autoSetup(b, seat.seat);
    }
  }
  finishSetupIfDone(b);
}

/** Timeout / resign fill: even spread; in capitals mode a random owned capital. */
function autoSetup(b: Builder, seat: SeatId): void {
  if (b.s.phase.kind !== 'setup') return;
  const owned = ownedTerritories(b.s, b.map, seat);
  const placements = evenPlacements(b.s.phase.armiesToPlace[seat] ?? 0, owned);
  const capital = b.s.settings.winCondition === 'capitals' && owned.length > 0 ? pick(b.ctx.rng, owned) : null;
  b.emit({ type: 'SetupSubmitted', seat, placements, capital, auto: true });
}

function finishSetupIfDone(b: Builder): void {
  const p = b.s.phase;
  if (p.kind !== 'setup') return;
  if (!Object.keys(p.armiesToPlace).every((seat) => p.submitted.includes(Number(seat)))) return;
  b.emit({ type: 'SetupRevealed' });
  const first = nextTurnSeat(b.s, null);
  if (first !== null) startTurn(b, first);
}

function submitSetup(
  b: Builder,
  seat: Seat,
  placements: Record<TerritoryId, number>,
  capital: TerritoryId | null,
): void {
  const p = b.s.phase;
  if (p.kind !== 'setup') reject('WRONG_PHASE', 'not in setup');
  if (p.submitted.includes(seat.seat)) reject('SETUP_ALREADY_SUBMITTED', 'setup already submitted');
  const clean = validatePlacements(b, seat.seat, placements, true);
  const total = Object.values(clean).reduce((a, n) => a + n, 0);
  if (total !== p.armiesToPlace[seat.seat])
    reject('MUST_PLACE_ALL', `place exactly ${p.armiesToPlace[seat.seat]} armies`);
  let cap: TerritoryId | null = null;
  if (b.s.settings.winCondition === 'capitals') {
    if (capital === null || b.s.territories[capital]?.owner !== seat.seat) {
      reject('INVALID_PLACEMENT', 'choose one of your territories as capital');
    }
    cap = capital;
  }
  resetStrikes(b, seat.seat);
  b.emit({ type: 'SetupSubmitted', seat: seat.seat, placements: clean, capital: cap, auto: false });
  finishSetupIfDone(b);
}

/** Own territories, non-negative integers. Returns the placements without zero entries. */
function validatePlacements(
  b: Builder,
  seat: SeatId,
  placements: Record<TerritoryId, number>,
  allowZero: boolean,
): Record<TerritoryId, number> {
  const clean: Record<TerritoryId, number> = {};
  for (const [t, n] of Object.entries(placements ?? {})) {
    if (b.s.territories[t]?.owner !== seat) reject('NOT_OWNED', `you don't own ${t}`);
    if (!Number.isInteger(n) || n < 0 || (n === 0 && !allowZero))
      reject('INVALID_PLACEMENT', `bad army count for ${t}`);
    if (n > 0) clean[t] = n;
  }
  return clean;
}

// ---------------------------------------------------------------------------- turns

function startTurn(b: Builder, seat: SeatId): void {
  const reinforcements = reinforcementsFor(b.map, b.s.territories, seat);
  const { mode, pace } = b.s.settings;
  const deadlineAt = mode === 'online' && pace === 'async' ? b.iso(TIMERS.turnDeadlineMs) : null;
  b.emit({ type: 'TurnStarted', seat, reinforcements, deadlineAt, startedAt: b.iso() });
}

function resetStrikes(b: Builder, seat: SeatId): void {
  if (getSeat(b.s, seat).consecutiveStrikes > 0) b.emit({ type: 'StrikesReset', seat });
}

type Win = Extract<GameEvent, { type: 'GameEnded' }>;

/** A map win for `seat` (classic / capitals), else last standing, else null. */
function findWin(b: Builder, seat: SeatId | null): Win | null {
  if (seat !== null) {
    const reason = mapWin(b.map, b.s.territories, b.s.seats, b.s.settings.winCondition, seat);
    if (reason) return { type: 'GameEnded', winner: seat, reason };
  }
  const last = lastStanding(b.s.seats);
  return last === null ? null : { type: 'GameEnded', winner: last, reason: 'last_standing' };
}

function checkWin(b: Builder, seat: SeatId | null): void {
  if (b.over) return;
  const win = findWin(b, seat);
  if (win) b.emit(win);
}

type TurnCommand = Extract<
  Command,
  { type: 'TradeCards' | 'PlaceReinforcements' | 'Attack' | 'Occupy' | 'EndAttack' | 'Fortify' | 'EndTurn' }
>;

function turnCommand(b: Builder, seat: Seat, cmd: TurnCommand): void {
  if (b.s.phase.kind !== 'turn') reject('WRONG_PHASE', 'no turn in progress');
  if (b.s.phase.seat !== seat.seat) reject('NOT_YOUR_TURN', 'not your turn');
  const p = b.s.phase;
  // Gates shared by everything except trading/placing/occupying.
  const gate = (allowStep: TurnPhase['step'][]) => {
    if (p.pendingOccupy) reject('OCCUPY_PENDING', 'occupy the conquered territory first');
    if (p.forcedTrade) {
      if (seat.hand.length > HAND_LIMIT_AFTER_FORCED_TRADE) reject('MUST_TRADE', 'trade cards down to 4 first');
      reject('MUST_PLACE_ALL', 'place the traded armies first');
    }
    if (p.step === 'reinforce' && !allowStep.includes('reinforce'))
      reject('MUST_PLACE_ALL', 'place all reinforcements first');
    if (!allowStep.includes(p.step)) reject('WRONG_STEP', `not allowed during ${p.step}`);
  };

  switch (cmd.type) {
    case 'TradeCards': {
      if (p.pendingOccupy) reject('OCCUPY_PENDING', 'occupy the conquered territory first');
      if (p.forcedTrade) {
        if (seat.hand.length <= HAND_LIMIT_AFTER_FORCED_TRADE) reject('WRONG_STEP', 'no more trades needed');
      } else if (p.step !== 'reinforce') reject('WRONG_STEP', 'trade only while reinforcing');
      const ids = cmd.cardIds;
      if (
        !Array.isArray(ids) ||
        ids.length !== 3 ||
        new Set(ids).size !== 3 ||
        !ids.every((c) => seat.hand.includes(c))
      ) {
        reject('CARDS_NOT_IN_HAND', 'those cards are not in your hand');
      }
      if (!isValidSet(ids.map((c) => b.s.cards[c].symbol))) reject('INVALID_SET', 'not a valid set');
      resetStrikes(b, seat.seat);
      emitTrade(b, seat.seat, ids, false);
      return;
    }
    case 'PlaceReinforcements': {
      if (p.pendingOccupy) reject('OCCUPY_PENDING', 'occupy the conquered territory first');
      let pool: number;
      if (p.forcedTrade) {
        if (seat.hand.length > HAND_LIMIT_AFTER_FORCED_TRADE) reject('MUST_TRADE', 'trade cards down to 4 first');
        pool = p.forcedTrade.armiesToPlace;
      } else {
        if (p.step !== 'reinforce') reject('WRONG_STEP', 'reinforcements are already placed');
        if (seat.hand.length >= MUST_TRADE_AT) reject('MUST_TRADE', `trade while holding ${MUST_TRADE_AT}+ cards`);
        pool = p.reinforcementsRemaining;
      }
      const clean = validatePlacements(b, seat.seat, cmd.placements, false);
      const total = Object.values(clean).reduce((a, n) => a + n, 0);
      if (total === 0) reject('INVALID_PLACEMENT', 'place at least one army');
      if (total > pool) reject('INSUFFICIENT_ARMIES', `only ${pool} armies to place`);
      resetStrikes(b, seat.seat);
      b.emit({ type: 'ArmiesPlaced', seat: seat.seat, placements: clean, at: b.iso() });
      return;
    }
    case 'Attack':
      gate(['attack']);
      attack(b, seat.seat, cmd);
      return;
    case 'Occupy': {
      if (!p.pendingOccupy) reject('WRONG_STEP', 'nothing to occupy');
      const { from, to, minArmies, maxArmies } = p.pendingOccupy;
      if (!Number.isInteger(cmd.armies) || cmd.armies < minArmies || cmd.armies > maxArmies) {
        reject('INVALID_OCCUPY_COUNT', `move between ${minArmies} and ${maxArmies} armies`);
      }
      resetStrikes(b, seat.seat);
      b.emit({ type: 'ArmiesOccupied', from, to, armies: cmd.armies, at: b.iso() });
      return;
    }
    case 'EndAttack':
      gate(['attack']);
      resetStrikes(b, seat.seat);
      b.emit({ type: 'AttackEnded', seat: seat.seat, at: b.iso() });
      return;
    case 'Fortify': {
      gate(['attack', 'fortify']);
      if (p.fortified) reject('ALREADY_FORTIFIED', 'already fortified this turn');
      const { from, to, armies } = cmd;
      const t = b.s.territories;
      if (t[from]?.owner !== seat.seat || t[to]?.owner !== seat.seat)
        reject('NOT_OWNED', 'fortify between your territories');
      if (!canFortifyPath(b.map, t, seat.seat, from, to))
        reject('NOT_CONNECTED', 'no chain of your territories joins them');
      if (!Number.isInteger(armies) || armies < 1 || armies > t[from].armies - 1) {
        reject('INSUFFICIENT_ARMIES', 'leave at least one army behind');
      }
      resetStrikes(b, seat.seat);
      if (p.step === 'attack') b.emit({ type: 'AttackEnded', seat: seat.seat, at: b.iso() });
      b.emit({ type: 'Fortified', from, to, armies, at: b.iso() });
      return;
    }
    case 'EndTurn':
      gate(['attack', 'fortify']);
      resetStrikes(b, seat.seat);
      endTurn(b, p.conqueredThisTurn);
      return;
  }
}

function emitTrade(b: Builder, seat: SeatId, cardIds: string[], forced: boolean): void {
  b.emit({
    type: 'CardsTraded',
    seat,
    cardIds,
    armies: tradeValue(b.s.tradeCount),
    bonusTerritory: tradeBonusTerritory(cardIds, b.s.cards, b.s.territories, seat),
    forced,
    at: b.iso(),
  });
}

function attack(b: Builder, seat: SeatId, cmd: Extract<Command, { type: 'Attack' }>): void {
  const { from, to } = cmd;
  const t = b.s.territories;
  if (t[from]?.owner !== seat) reject('NOT_OWNED', `you don't own ${from}`);
  if (!t[to] || t[to].owner === seat) reject('NOT_OWNED', `${to} is not an enemy territory`);
  if (!b.map.territories[from].adjacent.includes(to)) reject('NOT_ADJACENT', `${from} doesn't border ${to}`);
  if (![1, 2, 3].includes(cmd.attackerDice) || cmd.attackerDice > maxAttackerDice(t[from].armies)) {
    reject('INSUFFICIENT_ARMIES', 'not enough armies for that many dice');
  }
  resetStrikes(b, seat);
  // Blitz rolls the maximum dice every round (§4.4); a single attack rolls what was asked.
  for (;;) {
    const fromArmies = b.s.territories[from].armies;
    const toArmies = b.s.territories[to].armies;
    const dice = cmd.untilConquered ? maxAttackerDice(fromArmies) : cmd.attackerDice;
    if (dice < 1) break;
    const attackerRolls = rollDice(b.ctx.rng, dice);
    const defenderRolls = rollDice(b.ctx.rng, defenderDice(toArmies));
    const losses = resolveRound(attackerRolls, defenderRolls);
    b.emit({ type: 'AttackRolled', from, to, attackerRolls, defenderRolls, ...losses, at: b.iso() });
    if (losses.defenderLosses === toArmies) {
      conquer(b, seat, from, to);
      break;
    }
    if (!cmd.untilConquered) break;
  }
}

function conquer(b: Builder, seat: SeatId, from: TerritoryId, to: TerritoryId): void {
  const previousOwner = b.s.territories[to].owner;
  b.emit({ type: 'TerritoryConquered', from, to, newOwner: seat, previousOwner });
  if (!ownsAny(b.s.territories, previousOwner)) {
    const cardsTransferred = [...getSeat(b.s, previousOwner).hand];
    b.emit({ type: 'SeatEliminated', seat: previousOwner, by: seat, cardsTransferred });
  }
  const win = findWin(b, seat);
  if (win) {
    // The game is over: move the minimum in so the board never ends with an empty territory.
    const occ = b.turn().pendingOccupy;
    if (occ) b.emit({ type: 'ArmiesOccupied', from: occ.from, to: occ.to, armies: occ.minArmies, at: b.iso() });
    b.emit(win);
  }
}

/** Draw if earned, end the turn, and start the next active seat's turn. */
function endTurn(b: Builder, draw: boolean): void {
  const seat = b.turn().seat;
  if (draw) drawCard(b, seat);
  b.emit({ type: 'TurnEnded', seat });
  advance(b, seat);
}

function advance(b: Builder, after: SeatId): void {
  if (b.over) return;
  const next = nextTurnSeat(b.s, after);
  if (next !== null) startTurn(b, next);
}

function drawCard(b: Builder, seat: SeatId): void {
  if (b.s.deck.length === 0) {
    if (b.s.discard.length === 0) return;
    b.emit({ type: 'DeckReshuffled', deck: shuffle(b.ctx.rng, b.s.discard) });
  }
  b.emit({ type: 'CardDrawn', seat, cardId: b.s.deck[0] });
}

function kick(b: Builder, seat: SeatId, reason: 'strikes' | 'resigned'): void {
  b.emit({ type: 'SeatKicked', seat, reason, discardedCards: [...getSeat(b.s, seat).hand] });
  checkWin(b, null);
}

// ---------------------------------------------------------------------------- resign, timers, auto-play

function resign(b: Builder, seat: Seat): void {
  const p = b.s.phase;
  if (p.kind === 'game_over' || p.kind === 'canceled') reject('WRONG_PHASE', 'the game is over');
  if (seat.status !== 'active') reject('WRONG_PHASE', 'you are no longer playing');
  switch (p.kind) {
    case 'draft':
      kick(b, seat.seat, 'resigned');
      continueDraft(b);
      break;
    case 'setup':
      if (!p.submitted.includes(seat.seat)) autoSetup(b, seat.seat);
      kick(b, seat.seat, 'resigned');
      if (!b.over) finishSetupIfDone(b);
      break;
    case 'turn':
      if (p.seat === seat.seat) {
        if (p.pendingOccupy) {
          const { from, to, minArmies } = p.pendingOccupy;
          b.emit({ type: 'ArmiesOccupied', from, to, armies: minArmies, at: b.iso() });
        }
        b.emit({ type: 'TurnEnded', seat: seat.seat });
        kick(b, seat.seat, 'resigned');
        advance(b, seat.seat);
      } else {
        kick(b, seat.seat, 'resigned');
      }
      break;
    default:
      // GameStarted with random assignment runs straight into setup, so no other phase is reachable.
      kick(b, seat.seat, 'resigned');
  }
}

/** §3 auto-play: occupy the minimum, make forced trades, spread armies evenly, end the turn, +1 strike. */
function autoPlay(b: Builder, reason: 'timeout' | 'inactive'): void {
  const seat = b.turn().seat;
  const occ = b.turn().pendingOccupy;
  if (occ) b.emit({ type: 'ArmiesOccupied', from: occ.from, to: occ.to, armies: occ.minArmies, at: b.iso() });
  const placeEvenly = (n: number) => {
    const placements = evenPlacements(n, ownedTerritories(b.s, b.map, seat));
    if (Object.keys(placements).length > 0) b.emit({ type: 'ArmiesPlaced', seat, placements, at: b.iso() });
  };
  if (b.turn().forcedTrade) {
    for (const set of forcedTradeSets(getSeat(b.s, seat).hand, b.s.cards, HAND_LIMIT_AFTER_FORCED_TRADE + 1)) {
      emitTrade(b, seat, set, true);
    }
    placeEvenly(b.turn().forcedTrade?.armiesToPlace ?? 0);
  }
  if (b.turn().step === 'reinforce') {
    for (const set of forcedTradeSets(getSeat(b.s, seat).hand, b.s.cards, MUST_TRADE_AT)) emitTrade(b, seat, set, true);
    placeEvenly(b.turn().reinforcementsRemaining);
  }
  const strikes = getSeat(b.s, seat).consecutiveStrikes + 1;
  b.emit({ type: 'TurnSkipped', seat, reason, strikes });
  b.emit({ type: 'TurnEnded', seat });
  if (strikes >= TIMERS.maxConsecutiveStrikes) kick(b, seat, 'strikes');
  advance(b, seat);
}

function skipTurn(b: Builder, seat: Seat): void {
  const { mode, pace } = b.s.settings;
  if (mode !== 'online' || pace !== 'sync') reject('SKIP_NOT_ALLOWED', 'skipping is only for online sync games');
  if (b.s.phase.kind !== 'turn') reject('WRONG_PHASE', 'no turn in progress');
  if (b.s.phase.seat === seat.seat || seat.status !== 'active')
    reject('SKIP_NOT_ALLOWED', 'only other active players can skip');
  const idle = b.ctx.now.getTime() - Date.parse(b.s.phase.lastActionAt);
  if (idle <= TIMERS.turnInactivityMs) reject('TIMER_NOT_EXPIRED', 'the player is not inactive yet');
  autoPlay(b, 'inactive');
}

function claimTimeout(b: Builder, cmd: Extract<Command, { type: 'ClaimTimeout' }>): void {
  const p = b.s.phase;
  if (p.kind !== 'draft' && p.kind !== 'setup' && p.kind !== 'turn') reject('WRONG_PHASE', 'nothing to time out');
  if (p.kind !== cmd.phase || p.deadlineAt !== cmd.deadlineAt) reject('STALE_VERSION', 'the deadline has moved on');
  if (p.deadlineAt === null) reject('SKIP_NOT_ALLOWED', 'this turn has no deadline');
  if (b.ctx.now.getTime() <= Date.parse(p.deadlineAt) + TIMERS.graceMs) reject('TIMER_NOT_EXPIRED', 'not expired yet');
  switch (p.kind) {
    case 'draft':
      emitDraftPick(b, p.pickingSeat, pick(b.ctx.rng, unclaimed(b)), true);
      continueDraft(b);
      break;
    case 'setup':
      for (const seat of assignmentOrder(b.s)) {
        const phase = b.s.phase;
        if (phase.kind === 'setup' && seat in phase.armiesToPlace && !phase.submitted.includes(seat))
          autoSetup(b, seat);
      }
      finishSetupIfDone(b);
      break;
    case 'turn':
      autoPlay(b, 'timeout');
      break;
  }
}

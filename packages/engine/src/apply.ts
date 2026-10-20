// Pure reducer: (state, event) → new state. Never mutates its input, never reads the clock or rng.
import { getMap } from './maps/index.ts';
import { buildCards } from './rules/cards.ts';
import { occupyBounds } from './rules/combat.ts';
import { assignmentOrder, cloneState, getSeat } from './state.ts';
import {
  ELIMINATION_TRADE_AT,
  type GameEvent,
  type GameState,
  NEUTRAL_COLOR,
  type Phase,
  type TerritoryId,
} from './types.ts';

type TurnPhase = Extract<Phase, { kind: 'turn' }>;

function turn(s: GameState): TurnPhase | null {
  return s.phase.kind === 'turn' ? s.phase : null;
}

function addArmies(s: GameState, placements: Record<TerritoryId, number>): number {
  let total = 0;
  for (const [t, n] of Object.entries(placements)) {
    s.territories[t].armies += n;
    total += n;
  }
  return total;
}

function touch(s: GameState, at: string): void {
  const p = turn(s);
  if (p) p.lastActionAt = at;
}

export function apply(state: GameState, event: GameEvent): GameState {
  const s = cloneState(state);
  s.version = state.version + 1;
  switch (event.type) {
    // ---- Lobby
    case 'SeatJoined':
      if (s.seats.length === 0) s.hostSeat = event.seat;
      s.seats.push({
        seat: event.seat,
        kind: 'human',
        status: 'active',
        userId: event.userId,
        displayName: event.displayName,
        color: event.color,
        turnOrder: null,
        consecutiveStrikes: 0,
        hand: [],
        capital: null,
      });
      break;
    case 'SeatLeft':
      s.seats = s.seats.filter((x) => x.seat !== event.seat);
      break;
    case 'SeatColorChanged':
      getSeat(s, event.seat).color = event.color;
      break;
    case 'HostChanged':
      s.hostSeat = event.seat;
      break;
    case 'GameCanceled':
      s.phase = { kind: 'canceled', reason: event.reason };
      break;
    case 'SettingsUpdated':
      s.settings = { ...event.settings };
      break;
    case 'GameStarted': {
      event.turnOrder.forEach((seat, i) => {
        getSeat(s, seat).turnOrder = i;
      });
      if (event.neutralSeat !== null) {
        s.seats.push({
          seat: event.neutralSeat,
          kind: 'neutral',
          status: 'active',
          userId: null,
          displayName: 'Neutral',
          color: NEUTRAL_COLOR,
          turnOrder: null,
          consecutiveStrikes: 0,
          hand: [],
          capital: null,
        });
      }
      const map = getMap(s.settings.mapId);
      if (!map) throw new Error(`unknown map ${s.settings.mapId}`);
      s.cards = buildCards(map);
      s.deck = [...event.deck];
      s.discard = [];
      s.tradeCount = 0;
      if (event.draftDeadlineAt !== null) {
        s.phase = { kind: 'draft', pickingSeat: assignmentOrder(s)[0], deadlineAt: event.draftDeadlineAt };
      }
      break;
    }

    // ---- Territory assignment
    case 'TerritoriesDealt':
      for (const [t, owner] of Object.entries(event.assignments)) s.territories[t] = { owner, armies: 1 };
      break;
    case 'DraftPicked':
      s.territories[event.territory] = { owner: event.seat, armies: 1 };
      if (s.phase.kind === 'draft' && event.nextDeadlineAt !== null) {
        const order = assignmentOrder(s);
        s.phase.pickingSeat = order[Object.keys(s.territories).length % order.length];
        s.phase.deadlineAt = event.nextDeadlineAt;
      }
      break;

    // ---- Setup
    case 'SetupStarted':
      s.phase = {
        kind: 'setup',
        deadlineAt: event.deadlineAt,
        armiesToPlace: { ...event.armiesToPlace },
        submitted: [],
      };
      s.hiddenSetup = {};
      break;
    case 'SetupSubmitted':
      s.hiddenSetup[event.seat] = { placements: { ...event.placements }, capital: event.capital };
      if (s.phase.kind === 'setup') s.phase.submitted.push(event.seat);
      break;
    case 'NeutralPlaced':
      addArmies(s, event.placements);
      if (s.phase.kind === 'setup') s.phase.submitted.push(event.seat);
      break;
    case 'SetupRevealed':
      for (const [seat, h] of Object.entries(s.hiddenSetup)) {
        addArmies(s, h.placements);
        getSeat(s, Number(seat)).capital = h.capital;
      }
      s.hiddenSetup = {};
      break;

    // ---- Turn
    case 'TurnStarted':
      s.phase = {
        kind: 'turn',
        seat: event.seat,
        step: 'reinforce',
        reinforcementsRemaining: event.reinforcements.total,
        conqueredThisTurn: false,
        pendingOccupy: null,
        forcedTrade: null,
        fortified: false,
        startedAt: event.startedAt,
        lastActionAt: event.startedAt,
        deadlineAt: event.deadlineAt,
      };
      break;
    case 'CardsTraded': {
      const seat = getSeat(s, event.seat);
      seat.hand = seat.hand.filter((c) => !event.cardIds.includes(c));
      s.discard.push(...event.cardIds);
      s.tradeCount += 1;
      if (event.bonusTerritory !== null) s.territories[event.bonusTerritory].armies += 2;
      const p = turn(s);
      if (p?.forcedTrade) p.forcedTrade.armiesToPlace += event.armies;
      else if (p) p.reinforcementsRemaining += event.armies;
      touch(s, event.at);
      break;
    }
    case 'ArmiesPlaced': {
      const n = addArmies(s, event.placements);
      const p = turn(s);
      if (p?.forcedTrade) {
        p.forcedTrade.armiesToPlace -= n;
        if (p.forcedTrade.armiesToPlace === 0 && getSeat(s, event.seat).hand.length < ELIMINATION_TRADE_AT - 1) {
          p.forcedTrade = null;
        }
      } else if (p) {
        p.reinforcementsRemaining -= n;
        if (p.reinforcementsRemaining === 0 && p.step === 'reinforce') p.step = 'attack';
      }
      touch(s, event.at);
      break;
    }
    case 'AttackRolled': {
      const from = s.territories[event.from];
      const to = s.territories[event.to];
      from.armies -= event.attackerLosses;
      to.armies -= event.defenderLosses;
      const p = turn(s);
      if (p && to.armies === 0) {
        // Conquest: the occupy bounds come from this final battle.
        p.step = 'occupy';
        p.pendingOccupy = { from: event.from, to: event.to, ...occupyBounds(event.attackerRolls.length, from.armies) };
      }
      touch(s, event.at);
      break;
    }
    case 'TerritoryConquered': {
      s.territories[event.to].owner = event.newOwner;
      const p = turn(s);
      if (p) p.conqueredThisTurn = true;
      break;
    }
    case 'ArmiesOccupied': {
      s.territories[event.from].armies -= event.armies;
      s.territories[event.to].armies += event.armies;
      const p = turn(s);
      if (p) {
        p.pendingOccupy = null;
        p.step = 'attack';
      }
      touch(s, event.at);
      break;
    }
    case 'AttackEnded': {
      const p = turn(s);
      if (p) p.step = 'fortify';
      touch(s, event.at);
      break;
    }
    case 'Fortified': {
      s.territories[event.from].armies -= event.armies;
      s.territories[event.to].armies += event.armies;
      const p = turn(s);
      if (p) {
        p.step = 'fortify';
        p.fortified = true;
      }
      touch(s, event.at);
      break;
    }
    case 'CardDrawn': {
      const i = s.deck.indexOf(event.cardId);
      if (i >= 0) s.deck.splice(i, 1);
      getSeat(s, event.seat).hand.push(event.cardId);
      break;
    }
    case 'DeckReshuffled':
      s.deck = [...event.deck];
      s.discard = s.discard.filter((c) => !event.deck.includes(c));
      break;
    case 'TurnEnded':
      break;

    // ---- Timeouts, strikes, removal
    case 'TurnSkipped':
      getSeat(s, event.seat).consecutiveStrikes = event.strikes;
      break;
    case 'StrikesReset':
      getSeat(s, event.seat).consecutiveStrikes = 0;
      break;
    case 'SeatKicked': {
      const seat = getSeat(s, event.seat);
      seat.status = 'kicked';
      seat.hand = seat.hand.filter((c) => !event.discardedCards.includes(c));
      s.discard.push(...event.discardedCards);
      break;
    }
    case 'SeatEliminated': {
      const seat = getSeat(s, event.seat);
      const by = getSeat(s, event.by);
      seat.status = 'eliminated';
      seat.hand = seat.hand.filter((c) => !event.cardsTransferred.includes(c));
      by.hand.push(...event.cardsTransferred);
      const p = turn(s);
      if (p && p.seat === event.by && by.hand.length >= ELIMINATION_TRADE_AT) p.forcedTrade = { armiesToPlace: 0 };
      break;
    }
    case 'GameEnded':
      s.phase = { kind: 'game_over', winner: event.winner, reason: event.reason };
      break;
    default: {
      const unknown: never = event;
      throw new Error(`unknown event ${JSON.stringify(unknown)}`);
    }
  }
  return s;
}

/** Fold a whole event log, e.g. for replays. */
export function replay(initial: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(apply, initial);
}

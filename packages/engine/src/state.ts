import type { GameMode, GameSettings, GameState, MapDefinition, Phase, Seat, SeatId, TerritoryId } from './types.ts';

/** Empty lobby state that event replay starts from (the host joins via SeatJoined). */
export function createInitialState(gameId: string, settings: GameSettings): GameState {
  return {
    gameId,
    version: 0,
    settings: { ...settings },
    hostSeat: 0,
    seats: [],
    phase: { kind: 'lobby' },
    territories: {},
    deck: [],
    discard: [],
    cards: {},
    tradeCount: 0,
    hiddenSetup: {},
  };
}

export function defaultSettings(mode: GameMode): GameSettings {
  return { mode, mapId: 'classic', winCondition: 'classic', pace: 'async', territoryAssignment: 'random', maxSeats: 6 };
}

function clonePhase(p: Phase): Phase {
  switch (p.kind) {
    case 'setup':
      return { ...p, armiesToPlace: { ...p.armiesToPlace }, submitted: [...p.submitted] };
    case 'turn':
      return {
        ...p,
        pendingOccupy: p.pendingOccupy && { ...p.pendingOccupy },
        forcedTrade: p.forcedTrade && { ...p.forcedTrade },
      };
    default:
      return { ...p };
  }
}

/** Deep copy for apply(). `cards` is shared: it is never edited in place, only replaced at GameStarted. */
export function cloneState(s: GameState): GameState {
  const territories: GameState['territories'] = {};
  for (const [id, t] of Object.entries(s.territories)) territories[id] = { ...t };
  const hiddenSetup: GameState['hiddenSetup'] = {};
  for (const [seat, h] of Object.entries(s.hiddenSetup)) {
    hiddenSetup[Number(seat)] = { placements: { ...h.placements }, capital: h.capital };
  }
  return {
    ...s,
    settings: { ...s.settings },
    seats: s.seats.map((x) => ({ ...x, hand: [...x.hand] })),
    phase: clonePhase(s.phase),
    territories,
    deck: [...s.deck],
    discard: [...s.discard],
    hiddenSetup,
  };
}

export function findSeat(state: GameState, seat: SeatId): Seat | undefined {
  return state.seats.find((s) => s.seat === seat);
}

export function getSeat(state: GameState, seat: SeatId): Seat {
  const s = findSeat(state, seat);
  if (!s) throw new Error(`no seat ${seat}`);
  return s;
}

/** Humans in turn order (kicked/eliminated included), the neutral seat last (§4.2). */
export function assignmentOrder(state: GameState): SeatId[] {
  const humans = state.seats
    .filter((s) => s.kind === 'human' && s.turnOrder !== null)
    .sort((a, b) => (a.turnOrder as number) - (b.turnOrder as number))
    .map((s) => s.seat);
  const neutral = state.seats.filter((s) => s.kind === 'neutral').map((s) => s.seat);
  return [...humans, ...neutral];
}

/** Territories a seat owns, in map order. */
export function ownedTerritories(state: GameState, map: MapDefinition, seat: SeatId): TerritoryId[] {
  return Object.keys(map.territories).filter((id) => state.territories[id]?.owner === seat);
}

/** Next active human after `seat` in turn order (wrapping), or null if none. */
export function nextTurnSeat(state: GameState, seat: SeatId | null): SeatId | null {
  const order = state.seats
    .filter((s) => s.kind === 'human' && s.turnOrder !== null)
    .sort((a, b) => (a.turnOrder as number) - (b.turnOrder as number));
  const start = seat === null ? -1 : order.findIndex((s) => s.seat === seat);
  for (let i = 1; i <= order.length; i++) {
    const s = order[(start + i + order.length) % order.length];
    if (s.status === 'active') return s.seat;
  }
  return null;
}

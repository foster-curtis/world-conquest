// Rebuilds a finished game in the browser by folding events through the engine's `apply` (SPEC 8.2).
// Input is deliberately the shape of the server's ReplayResponse so M5 can feed server events unchanged.
import {
  apply,
  createInitialState,
  type GameEvent,
  type GameSettings,
  type GameState,
  getMap,
  type MapDefinition,
  type ReplayResponse,
} from '@wc/engine';

export interface ReplayInput {
  gameId: string;
  settings: GameSettings;
  /** Plain events (local) or sequenced events (ReplayResponse.events). */
  events: GameEvent[] | ReplayResponse['events'];
}

export interface Frames {
  map: MapDefinition;
  events: GameEvent[];
  /** states[i] is the state after the first i events; states[0] is the empty lobby. */
  states: GameState[];
  /** Event indices (into `events`) where each turn starts. */
  turnStarts: number[];
}

export function normalizeEvents(events: ReplayInput['events']): GameEvent[] {
  return (events as (GameEvent | { seq: number; event: GameEvent })[]).map((e) => ('event' in e ? e.event : e));
}

export function buildFrames(input: ReplayInput): Frames {
  const map = getMap(input.settings.mapId);
  if (!map) throw new Error(`unknown map ${input.settings.mapId}`);
  const events = normalizeEvents(input.events);
  const states: GameState[] = [createInitialState(input.gameId, input.settings)];
  const turnStarts: number[] = [];
  events.forEach((e, i) => {
    states.push(apply(states[i], e));
    if (e.type === 'TurnStarted') turnStarts.push(i);
  });
  return { map, events, states, turnStarts };
}

// Turns a PlayerView (or a replayed state) into what the board draws. Works from the viewer-safe subset only.
import type { Color, MapDefinition, SeatId, TerritoryId } from '@wc/engine';
import type { TerritoryDisplay } from './Board.tsx';

export interface DisplaySource {
  territories: Record<TerritoryId, { owner: SeatId; armies: number }>;
  seats: { seat: SeatId; color: Color; displayName: string; capital: TerritoryId | null; kind: string }[];
  viewer: SeatId | null;
}

export const initialOf = (name: string): string => (name.trim()[0] ?? '?').toUpperCase();

export function makeDisplay(
  src: DisplaySource,
  map: MapDefinition,
  staged: Readonly<Record<TerritoryId, number>> = {},
  capitalChoice: TerritoryId | null = null,
): (id: TerritoryId) => TerritoryDisplay {
  const seatOf = new Map(src.seats.map((s) => [s.seat, s]));
  const capitals = new Set(src.seats.flatMap((s) => (s.capital ? [s.capital] : [])));
  if (capitalChoice) capitals.add(capitalChoice);
  return (id) => {
    const t = src.territories[id];
    const name = map.territories[id].name;
    if (!t) return { color: null, initial: '', armies: null, staged: 0, capital: false, label: `${name}, unclaimed` };
    const owner = seatOf.get(t.owner);
    const extra = staged[id] ?? 0;
    const who = t.owner === src.viewer ? 'yours' : owner?.kind === 'neutral' ? 'neutral' : `${owner?.displayName}'s`;
    const n = t.armies + extra;
    return {
      color: owner?.color ?? 'gray',
      initial: owner?.kind === 'neutral' ? 'N' : initialOf(owner?.displayName ?? '?'),
      armies: t.armies,
      staged: extra,
      capital: capitals.has(id),
      label: `${name}, ${who}, ${n} ${n === 1 ? 'army' : 'armies'}${capitals.has(id) ? ', capital' : ''}`,
    };
  };
}

export function makeTooltip(src: DisplaySource, map: MapDefinition): (id: TerritoryId) => string {
  const seatOf = new Map(src.seats.map((s) => [s.seat, s]));
  return (id) => {
    const def = map.territories[id];
    const t = src.territories[id];
    const cont = map.continents[def.continent].name;
    if (!t) return `${def.name} (${cont}): unclaimed`;
    const owner = seatOf.get(t.owner);
    const who = t.owner === src.viewer ? 'you' : (owner?.displayName ?? '?');
    return `${def.name} (${cont}): ${who}, ${t.armies} ${t.armies === 1 ? 'army' : 'armies'}`;
  };
}

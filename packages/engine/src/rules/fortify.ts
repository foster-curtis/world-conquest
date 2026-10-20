import type { MapDefinition, SeatId, TerritoryId, TerritoryState } from '../types.ts';

/** Every territory reachable from `from` through territories `seat` owns (including `from`). */
export function connectedOwned(
  map: MapDefinition,
  territories: Readonly<Record<TerritoryId, TerritoryState>>,
  seat: SeatId,
  from: TerritoryId,
): Set<TerritoryId> {
  const seen = new Set<TerritoryId>();
  if (territories[from]?.owner !== seat) return seen;
  seen.add(from);
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop() as TerritoryId;
    for (const n of map.territories[cur]?.adjacent ?? []) {
      if (!seen.has(n) && territories[n]?.owner === seat) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

/** Fortify moves along a connected chain of your own territories (§4.4). */
export function canFortifyPath(
  map: MapDefinition,
  territories: Readonly<Record<TerritoryId, TerritoryState>>,
  seat: SeatId,
  from: TerritoryId,
  to: TerritoryId,
): boolean {
  return from !== to && connectedOwned(map, territories, seat, from).has(to);
}

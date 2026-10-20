import type { ContinentId, MapDefinition, SeatId, TerritoryId, TerritoryState } from '../types.ts';

export interface Reinforcements {
  territories: number;
  continents: Record<ContinentId, number>;
  total: number;
}

/** max(3, floor(territories / 3)) + bonuses of fully owned continents (§4.4). Card trades come on top. */
export function reinforcementsFor(
  map: MapDefinition,
  territories: Readonly<Record<TerritoryId, TerritoryState>>,
  seat: SeatId,
): Reinforcements {
  const ids = Object.keys(map.territories);
  const owned = ids.filter((id) => territories[id]?.owner === seat).length;
  const base = Math.max(3, Math.floor(owned / 3));
  const continents: Record<ContinentId, number> = {};
  for (const [cid, c] of Object.entries(map.continents)) {
    const members = ids.filter((id) => map.territories[id].continent === cid);
    if (members.length > 0 && members.every((id) => territories[id]?.owner === seat)) continents[cid] = c.bonus;
  }
  const total = base + Object.values(continents).reduce((n, b) => n + b, 0);
  return { territories: base, continents, total };
}

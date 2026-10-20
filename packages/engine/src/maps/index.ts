import type { MapDefinition, MapId } from '../types.ts';
import { classicMap } from './classic.ts';

export { classicMap } from './classic.ts';

/** Every published map, keyed by id. v1 ships only `classic`. */
export const MAPS: Readonly<Record<MapId, MapDefinition>> = {
  [classicMap.id]: classicMap,
};

/** Look a map up by id; undefined for unknown ids. */
export function getMap(id: MapId): MapDefinition | undefined {
  return Object.hasOwn(MAPS, id) ? MAPS[id] : undefined;
}

/** SPEC §5.1 validation. Returns a list of problems (empty = valid). */
export function validateMap(map: MapDefinition): string[] {
  const errors: string[] = [];
  const ids = Object.keys(map.territories);
  const idPattern = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
  if (ids.length === 0) errors.push('map has no territories');
  for (const id of [...ids, ...Object.keys(map.continents)]) {
    if (!idPattern.test(id)) errors.push(`id not snake_case: ${id}`);
  }
  for (const id of ids) {
    const t = map.territories[id];
    if (!Object.hasOwn(map.continents, t.continent)) errors.push(`${id}: unknown continent ${t.continent}`);
    if (!['infantry', 'cavalry', 'artillery'].includes(t.cardSymbol)) errors.push(`${id}: bad card symbol`);
    if (new Set(t.adjacent).size !== t.adjacent.length) errors.push(`${id}: duplicate adjacency`);
    for (const n of t.adjacent) {
      if (n === id) errors.push(`${id}: self-link`);
      else if (!Object.hasOwn(map.territories, n)) errors.push(`${id}: unknown neighbor ${n}`);
      else if (!map.territories[n].adjacent.includes(id)) errors.push(`${id} → ${n} is not symmetric`);
    }
  }
  for (const [cid, c] of Object.entries(map.continents)) {
    if (!ids.some((id) => map.territories[id].continent === cid)) errors.push(`continent ${cid} is empty`);
    if (!Number.isInteger(c.bonus) || c.bonus < 0) errors.push(`continent ${cid}: bad bonus`);
  }
  if (ids.length > 0) {
    const seen = new Set([ids[0]]);
    const stack = [ids[0]];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const n of map.territories[cur].adjacent) {
        if (Object.hasOwn(map.territories, n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (seen.size !== ids.length) errors.push('graph is not connected');
  }
  for (const n of [2, 3, 4, 5, 6] as const) {
    const armies = map.startingArmies[n];
    if (!Number.isInteger(armies) || armies <= 0) errors.push(`startingArmies[${n}] missing`);
  }
  return errors;
}

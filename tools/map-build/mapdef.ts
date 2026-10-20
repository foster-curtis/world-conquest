// Loads the classic map definition (territory ids, continents, hand-authored adjacency) for the §5.3 checks.
// Source of truth: `packages/engine/src/maps/classic.ts`. Adjacency is never derived from geometry (§5.1).
import { classicMap } from '../../packages/engine/src/maps/classic.ts';

export interface MapDef {
  continents: { id: string; territories: string[] }[];
  /** territory id -> continent id */
  continentOf: Record<string, string>;
  /** Each border once, as [a, b] with a < b, plus whether it is the wrap-around link. */
  borders: { a: string; b: string; wrap: boolean }[];
  /** Territory ids in the engine's table order. */
  territories: string[];
}

// classic.ts documents alaska <-> kamchatka as the only link that wraps around the map edge.
const WRAP = 'alaska|kamchatka';

export async function loadClassic(): Promise<{ def: MapDef; source: 'engine' }> {
  const territories = Object.keys(classicMap.territories);
  const continents = Object.keys(classicMap.continents).map((id) => ({
    id,
    territories: territories.filter((t) => classicMap.territories[t]?.continent === id),
  }));
  const continentOf: Record<string, string> = {};
  for (const c of continents) for (const t of c.territories) continentOf[t] = c.id;
  const seen = new Set<string>();
  const borders: MapDef['borders'] = [];
  for (const t of territories) {
    for (const o of classicMap.territories[t]?.adjacent ?? []) {
      const [a, b] = t < o ? [t, o] : [o, t];
      if (seen.has(`${a}|${b}`)) continue;
      seen.add(`${a}|${b}`);
      borders.push({ a, b, wrap: `${a}|${b}` === WRAP });
    }
  }
  borders.sort((x, y) => (`${x.a}|${x.b}` < `${y.a}|${y.b}` ? -1 : 1));
  return { def: { continents, continentOf, borders, territories }, source: 'engine' };
}

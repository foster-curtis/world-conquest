import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classicMap } from '../maps/classic.ts';
import type { TerritoryState } from '../types.ts';
import { canFortifyPath, connectedOwned } from './fortify.ts';

const ids = Object.keys(classicMap.territories);

describe('fortify connectivity', () => {
  it('follows chains of own territories only', () => {
    const t: Record<string, TerritoryState> = Object.fromEntries(ids.map((id) => [id, { owner: 1, armies: 1 }]));
    for (const id of ['alaska', 'alberta', 'western_us', 'kamchatka']) t[id] = { owner: 0, armies: 3 };
    expect(canFortifyPath(classicMap, t, 0, 'kamchatka', 'western_us')).toBe(true); // via the alaska wrap
    expect(canFortifyPath(classicMap, t, 0, 'alaska', 'alaska')).toBe(false);
    t.alberta = { owner: 1, armies: 1 };
    expect(canFortifyPath(classicMap, t, 0, 'alaska', 'western_us')).toBe(false);
  });

  it('every reachable territory is owned and joined by an owned path', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 42, maxLength: 42 }), fc.nat(41), (mine, start) => {
        const t: Record<string, TerritoryState> = Object.fromEntries(
          ids.map((id, i) => [id, { owner: mine[i] ? 0 : 1, armies: 1 }]),
        );
        const reach = connectedOwned(classicMap, t, 0, ids[start]);
        if (!mine[start]) return reach.size === 0;
        for (const id of reach) {
          if (t[id].owner !== 0) return false;
          // closure: no owned neighbor of a reached territory is left out
          for (const n of classicMap.territories[id].adjacent) if (t[n].owner === 0 && !reach.has(n)) return false;
        }
        return true;
      }),
    );
  });
});

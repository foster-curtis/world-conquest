import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classicMap } from '../maps/classic.ts';
import type { TerritoryState } from '../types.ts';
import { reinforcementsFor } from './reinforcements.ts';

const ids = Object.keys(classicMap.territories);
const board = (owner: (id: string, i: number) => number) =>
  Object.fromEntries(ids.map((id, i) => [id, { owner: owner(id, i), armies: 1 }])) as Record<string, TerritoryState>;

describe('reinforcement math', () => {
  it('gives at least 3 armies', () => {
    const r = reinforcementsFor(
      classicMap,
      board((_, i) => (i === 0 ? 0 : 1)),
      0,
    );
    expect(r).toEqual({ territories: 3, continents: {}, total: 3 });
  });

  it('floors territories / 3 and adds whole continents', () => {
    const t = board((id) => (['australia', 'south_america'].includes(classicMap.territories[id].continent) ? 0 : 1));
    // 8 territories → 3, plus Australia 2 and South America 2
    expect(reinforcementsFor(classicMap, t, 0)).toEqual({
      territories: 3,
      continents: { south_america: 2, australia: 2 },
      total: 7,
    });
    const all = reinforcementsFor(
      classicMap,
      board(() => 0),
      0,
    );
    expect(all.territories).toBe(14);
    expect(all.total).toBe(14 + 5 + 2 + 5 + 3 + 7 + 2);
  });

  it('total = max(3, floor(n/3)) + bonuses for any ownership', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 42, maxLength: 42 }), (owners) => {
        const t = board((_, i) => owners[i]);
        const r = reinforcementsFor(classicMap, t, 0);
        const n = owners.filter((o) => o === 0).length;
        const bonus = Object.values(r.continents).reduce((a, b) => a + b, 0);
        return r.territories === Math.max(3, Math.floor(n / 3)) && r.total === r.territories + bonus;
      }),
    );
  });
});

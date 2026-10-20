import { describe, expect, it } from 'vitest';
import type { MapDefinition } from '../types.ts';
import { classicMap, getMap, MAPS, validateMap } from './index.ts';

describe.each(Object.values(MAPS))('map $id (§5.1 validation)', (map) => {
  it('passes validation', () => {
    expect(validateMap(map)).toEqual([]);
  });

  it('is registered under its own id', () => {
    expect(getMap(map.id)).toBe(map);
  });
});

describe('validateMap catches broken maps', () => {
  const clone = (): MapDefinition => JSON.parse(JSON.stringify(classicMap));

  it('asymmetric adjacency', () => {
    const m = clone();
    m.territories.alaska.adjacent = m.territories.alaska.adjacent.filter((t) => t !== 'kamchatka');
    expect(validateMap(m)).toContain('kamchatka → alaska is not symmetric');
  });

  it('self-links and unknown ids', () => {
    const m = clone();
    m.territories.peru.adjacent.push('peru', 'atlantis');
    const errors = validateMap(m);
    expect(errors).toContain('peru: self-link');
    expect(errors).toContain('peru: unknown neighbor atlantis');
  });

  it('disconnected graph and unknown continent', () => {
    const m = clone();
    m.territories.island = { name: 'Island', continent: 'nowhere', adjacent: [], cardSymbol: 'infantry' };
    const errors = validateMap(m);
    expect(errors).toContain('graph is not connected');
    expect(errors).toContain('island: unknown continent nowhere');
  });
});

describe('classic map (§5.2)', () => {
  const ids = Object.keys(classicMap.territories);

  it('has 42 territories, 6 continents and 83 borders', () => {
    expect(ids).toHaveLength(42);
    expect(Object.keys(classicMap.continents)).toHaveLength(6);
    const degreeSum = ids.reduce((n, id) => n + classicMap.territories[id].adjacent.length, 0);
    expect(degreeSum / 2).toBe(83);
  });

  it('has 14 of each card symbol', () => {
    const counts: Record<string, number> = {};
    for (const id of ids)
      counts[classicMap.territories[id].cardSymbol] = (counts[classicMap.territories[id].cardSymbol] ?? 0) + 1;
    expect(counts).toEqual({ infantry: 14, cavalry: 14, artillery: 14 });
  });

  it('has the §5.2 continent bonuses and sizes', () => {
    const size = (c: string) => ids.filter((id) => classicMap.territories[id].continent === c).length;
    const summary = Object.fromEntries(
      Object.entries(classicMap.continents).map(([id, c]) => [id, [c.bonus, size(id)]]),
    );
    expect(summary).toEqual({
      north_america: [5, 9],
      south_america: [2, 4],
      europe: [5, 7],
      africa: [3, 6],
      asia: [7, 12],
      australia: [2, 4],
    });
  });

  it('has the §5.2 starting armies', () => {
    expect(classicMap.startingArmies).toEqual({ 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 });
  });

  it('includes the wrap-around and intercontinental links', () => {
    const linked = (a: string, b: string) => classicMap.territories[a].adjacent.includes(b);
    expect(linked('alaska', 'kamchatka')).toBe(true);
    expect(linked('brazil', 'north_africa')).toBe(true);
    expect(linked('greenland', 'iceland')).toBe(true);
    expect(linked('siam', 'indonesia')).toBe(true);
    expect(linked('east_africa', 'middle_east')).toBe(true);
  });

  it('getMap returns undefined for unknown ids', () => {
    expect(getMap('nope')).toBeUndefined();
    expect(getMap('toString')).toBeUndefined();
  });
});

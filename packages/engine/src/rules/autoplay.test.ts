import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classicMap } from '../maps/classic.ts';
import { seededRng } from '../testing/rng.ts';
import { evenPlacements, forcedTradeSets, randomPlacements } from './autoplay.ts';
import { buildCards } from './cards.ts';

const ids = Object.keys(classicMap.territories);
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('auto-play', () => {
  it('spreads evenly, remainder to the first territories', () => {
    expect(evenPlacements(7, ['a', 'b', 'c'])).toEqual({ a: 3, b: 2, c: 2 });
    expect(evenPlacements(2, ['a', 'b', 'c'])).toEqual({ a: 1, b: 1 });
    expect(evenPlacements(0, ['a'])).toEqual({});
  });

  it('even and random placements keep the total and stay on the given territories', () => {
    fc.assert(
      fc.property(fc.nat(60), fc.subarray(ids, { minLength: 1 }), fc.integer(), (n, ts, seed) => {
        const rng = seededRng(seed);
        const even = evenPlacements(n, ts);
        const rand = randomPlacements(rng, n, ts);
        const values = Object.values(even);
        return (
          sum(even) === n &&
          sum(rand) === n &&
          Object.keys({ ...even, ...rand }).every((t) => ts.includes(t)) &&
          (values.length === 0 || Math.max(...values) - Math.min(...values) <= 1)
        );
      }),
    );
  });

  it('forced trades bring a hand below the threshold', () => {
    const cards = buildCards(classicMap);
    fc.assert(
      fc.property(fc.shuffledSubarray(Object.keys(cards), { minLength: 5, maxLength: 12 }), (hand) => {
        const sets = forcedTradeSets(hand, cards, 5);
        const used = sets.flat();
        return hand.length - used.length < 5 && new Set(used).size === used.length;
      }),
    );
  });
});

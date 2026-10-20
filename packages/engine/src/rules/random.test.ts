import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../testing/rng.ts';
import { pick, randomInt, shuffle } from './random.ts';

describe('rng helpers', () => {
  it('shuffle is a permutation and deterministic per seed', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), (xs, seed) => {
        const a = shuffle(seededRng(seed), xs);
        const b = shuffle(seededRng(seed), xs);
        return JSON.stringify(a) === JSON.stringify(b) && [...a].sort().join() === [...xs].sort().join();
      }),
    );
  });

  it('randomInt stays in range even when rng returns 1', () => {
    expect(randomInt(() => 1, 6)).toBe(5);
    expect(randomInt(() => 0, 6)).toBe(0);
    expect(() => pick(() => 0, [])).toThrow();
  });
});

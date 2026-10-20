import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { defenderDice, maxAttackerDice, occupyBounds, resolveRound, rollDice } from './combat.ts';

const die = fc.integer({ min: 1, max: 6 });

describe('combat math', () => {
  it('dice limits follow army counts', () => {
    expect([1, 2, 3, 4, 10].map(maxAttackerDice)).toEqual([0, 1, 2, 3, 3]);
    expect([0, 1, 2, 3].map(defenderDice)).toEqual([0, 1, 2, 2]);
  });

  it('compares sorted pairs and gives ties to the defender', () => {
    expect(resolveRound([6, 1, 1], [5, 5])).toEqual({ attackerLosses: 1, defenderLosses: 1 });
    expect(resolveRound([3], [3])).toEqual({ attackerLosses: 1, defenderLosses: 0 });
    expect(resolveRound([2, 6], [5, 1])).toEqual({ attackerLosses: 0, defenderLosses: 2 });
  });

  it('total losses are min(attacker dice, defender dice), never negative', () => {
    fc.assert(
      fc.property(
        fc.array(die, { minLength: 1, maxLength: 3 }),
        fc.array(die, { minLength: 1, maxLength: 2 }),
        (a, d) => {
          const r = resolveRound(a, d);
          return (
            r.attackerLosses >= 0 &&
            r.defenderLosses >= 0 &&
            r.attackerLosses + r.defenderLosses === Math.min(a.length, d.length)
          );
        },
      ),
    );
  });

  it('rolls n dice in 1..6 sorted descending, even with an rng returning the edges', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.double({ min: 0, max: 1, noNaN: true }), (n, x) => {
        const rolls = rollDice(() => x, n);
        return rolls.length === n && rolls.every((r, i) => r >= 1 && r <= 6 && (i === 0 || rolls[i - 1] >= r));
      }),
    );
  });

  it('occupy bounds: at least the dice rolled, at most armies − 1', () => {
    expect(occupyBounds(3, 10)).toEqual({ minArmies: 3, maxArmies: 9 });
    expect(occupyBounds(1, 2)).toEqual({ minArmies: 1, maxArmies: 1 });
  });
});

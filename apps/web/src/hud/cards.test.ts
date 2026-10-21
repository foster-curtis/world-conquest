import type { Card } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import { bestSet, validSets } from './cards.ts';

const cards: Record<string, Card> = {
  alaska: { id: 'alaska', symbol: 'infantry', territory: 'alaska' },
  alberta: { id: 'alberta', symbol: 'infantry', territory: 'alberta' },
  ontario: { id: 'ontario', symbol: 'cavalry', territory: 'ontario' },
  quebec: { id: 'quebec', symbol: 'artillery', territory: 'quebec' },
  'wild:1': { id: 'wild:1', symbol: 'wild', territory: null },
};

describe('card sets', () => {
  it('finds three of a kind, one of each, and two plus wild', () => {
    expect(validSets(['alaska', 'alberta', 'ontario'], cards)).toEqual([]);
    expect(validSets(['alaska', 'ontario', 'quebec'], cards)).toHaveLength(1);
    expect(validSets(['alaska', 'ontario', 'wild:1'], cards)).toHaveLength(1);
  });

  it('prefers sets that earn the +2 bonus and spends wilds last', () => {
    const hand = ['alaska', 'alberta', 'ontario', 'quebec', 'wild:1'];
    const mine = (t: string) => (t === 'alberta' ? 0 : 1);
    const best = bestSet(hand, cards, mine, 0);
    expect(best).toContain('alberta');
    expect(best).not.toContain('wild:1');
    expect(bestSet(['alaska', 'alberta'], cards, mine, 0)).toBeNull();
  });
});

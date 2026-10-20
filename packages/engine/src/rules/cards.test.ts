import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classicMap } from '../maps/classic.ts';
import type { CardSymbol } from '../types.ts';
import { buildCards, findValidSet, isValidSet, tradeBonusTerritory, WILD_CARD_IDS } from './cards.ts';

const cards = buildCards(classicMap);
const symbol = fc.constantFrom<CardSymbol>('infantry', 'cavalry', 'artillery', 'wild');

describe('card sets', () => {
  it('deck has one card per territory plus 2 wilds', () => {
    expect(Object.keys(cards)).toHaveLength(44);
    expect(WILD_CARD_IDS.map((id) => cards[id].symbol)).toEqual(['wild', 'wild']);
    expect(cards.alaska).toEqual({ id: 'alaska', symbol: 'infantry', territory: 'alaska' });
  });

  it('accepts three of a kind, one of each, and any two + wild', () => {
    expect(isValidSet(['infantry', 'infantry', 'infantry'])).toBe(true);
    expect(isValidSet(['infantry', 'cavalry', 'artillery'])).toBe(true);
    expect(isValidSet(['infantry', 'infantry', 'wild'])).toBe(true);
    expect(isValidSet(['wild', 'wild', 'cavalry'])).toBe(true);
    expect(isValidSet(['infantry', 'infantry', 'cavalry'])).toBe(false);
    expect(isValidSet(['infantry', 'cavalry'])).toBe(false);
  });

  it('any 5 cards contain a valid set', () => {
    const ids = Object.keys(cards);
    fc.assert(
      fc.property(fc.shuffledSubarray(ids, { minLength: 5, maxLength: 5 }), (hand) => {
        const set = findValidSet(hand, cards);
        return set !== null && isValidSet(set.map((id) => cards[id].symbol));
      }),
    );
  });

  it('a set is valid iff it has a wild, or 1 or 3 distinct symbols', () => {
    fc.assert(
      fc.property(fc.array(symbol, { minLength: 3, maxLength: 3 }), (s) => {
        const distinct = new Set(s).size;
        return isValidSet(s) === (s.includes('wild') || distinct === 1 || distinct === 3);
      }),
    );
  });

  it('bonus territory is the first traded card you own', () => {
    const territories = {
      alaska: { owner: 1, armies: 1 },
      peru: { owner: 0, armies: 1 },
      japan: { owner: 0, armies: 1 },
    };
    expect(tradeBonusTerritory(['wild:1', 'alaska', 'peru', 'japan'], cards, territories, 0)).toBe('peru');
    expect(tradeBonusTerritory(['wild:1', 'alaska'], cards, territories, 0)).toBeNull();
  });
});

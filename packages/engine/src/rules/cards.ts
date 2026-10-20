import type { Card, CardId, CardSymbol, MapDefinition, SeatId, TerritoryId, TerritoryState } from '../types.ts';

/** Wild ids use ':' so they can never collide with a snake_case territory id. */
export const WILD_CARD_IDS: readonly CardId[] = ['wild:1', 'wild:2'];

/** One card per territory (card id = territory id) plus two wilds (§4.5). */
export function buildCards(map: MapDefinition): Record<CardId, Card> {
  const cards: Record<CardId, Card> = {};
  for (const [id, t] of Object.entries(map.territories)) cards[id] = { id, symbol: t.cardSymbol, territory: id };
  for (const id of WILD_CARD_IDS) cards[id] = { id, symbol: 'wild', territory: null };
  return cards;
}

/** Three of a kind, one of each, or any two + a wild. */
export function isValidSet(symbols: readonly CardSymbol[]): boolean {
  if (symbols.length !== 3) return false;
  if (symbols.includes('wild')) return true;
  const distinct = new Set(symbols).size;
  return distinct === 1 || distinct === 3;
}

/** First valid set in hand order (i < j < k), or null. */
export function findValidSet(
  hand: readonly CardId[],
  cards: Readonly<Record<CardId, Card>>,
): [CardId, CardId, CardId] | null {
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) {
        const set: [CardId, CardId, CardId] = [hand[i], hand[j], hand[k]];
        if (isValidSet(set.map((id) => cards[id].symbol))) return set;
      }
  return null;
}

/** The first traded card (in the given order) whose territory the trader owns gets +2. */
export function tradeBonusTerritory(
  cardIds: readonly CardId[],
  cards: Readonly<Record<CardId, Card>>,
  territories: Readonly<Record<TerritoryId, TerritoryState>>,
  seat: SeatId,
): TerritoryId | null {
  for (const id of cardIds) {
    const t = cards[id].territory;
    if (t !== null && territories[t]?.owner === seat) return t;
  }
  return null;
}

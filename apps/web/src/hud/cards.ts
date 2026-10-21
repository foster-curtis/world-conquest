// Card-set helpers for the cards panel (SPEC 4.5, 7.6).
import { type Card, type CardId, isValidSet, type SeatId } from '@wc/engine';

export type CardSet = [CardId, CardId, CardId];

/** Every valid set in the hand. */
export function validSets(hand: readonly CardId[], cards: Record<CardId, Card>): CardSet[] {
  const out: CardSet[] = [];
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) {
        const ids: CardSet = [hand[i], hand[j], hand[k]];
        if (isValidSet(ids.map((id) => cards[id].symbol))) out.push(ids);
      }
  return out;
}

/** The set to pre-select: most +2 territory bonuses, and spend wilds last. */
export function bestSet(
  hand: readonly CardId[],
  cards: Record<CardId, Card>,
  owner: (territory: string) => SeatId | undefined,
  me: SeatId,
): CardSet | null {
  const sets = validSets(hand, cards);
  const score = (s: CardSet) =>
    s.reduce((n, id) => {
      const c = cards[id];
      if (c.symbol === 'wild') return n - 3;
      return n + (c.territory !== null && owner(c.territory) === me ? 10 : 0);
    }, 0);
  let best: CardSet | null = null;
  for (const s of sets) if (best === null || score(s) > score(best)) best = s;
  return best;
}

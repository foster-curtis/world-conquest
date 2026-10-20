// Auto-play building blocks (§3): even distribution for timeouts, random placement for neutral,
// and the forced trades a skipped turn makes. decide() turns these into ordinary events.
import type { Card, CardId, TerritoryId } from '../types.ts';
import { findValidSet } from './cards.ts';
import { type Rng, randomInt } from './random.ts';

/** Spread n armies as evenly as possible; the first territories (in the given order) get the remainder. */
export function evenPlacements(n: number, territories: readonly TerritoryId[]): Record<TerritoryId, number> {
  const out: Record<TerritoryId, number> = {};
  if (n <= 0 || territories.length === 0) return out;
  const base = Math.floor(n / territories.length);
  const extra = n % territories.length;
  territories.forEach((t, i) => {
    const armies = base + (i < extra ? 1 : 0);
    if (armies > 0) out[t] = armies;
  });
  return out;
}

/** Each army goes to a uniformly random territory (neutral setup, §4.3). */
export function randomPlacements(
  rng: Rng,
  n: number,
  territories: readonly TerritoryId[],
): Record<TerritoryId, number> {
  const out: Record<TerritoryId, number> = {};
  if (territories.length === 0) return out;
  for (let i = 0; i < n; i++) {
    const t = territories[randomInt(rng, territories.length)];
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

/** Sets to trade until the hand is below `tradeWhileAtLeast` (or no set is left). */
export function forcedTradeSets(
  hand: readonly CardId[],
  cards: Readonly<Record<CardId, Card>>,
  tradeWhileAtLeast: number,
): [CardId, CardId, CardId][] {
  const sets: [CardId, CardId, CardId][] = [];
  let rest = [...hand];
  while (rest.length >= tradeWhileAtLeast) {
    const set = findValidSet(rest, cards);
    if (set === null) break;
    sets.push(set);
    rest = rest.filter((id) => !set.includes(id));
  }
  return sets;
}

import { type Rng, randomInt } from './random.ts';

export const MAX_ATTACK_DICE = 3;
export const MAX_DEFENSE_DICE = 2;

/** Attacker may roll 1–3 dice, at most armies − 1 (0 means it can't attack). */
export function maxAttackerDice(armies: number): number {
  return Math.max(0, Math.min(MAX_ATTACK_DICE, armies - 1));
}

/** The defender always rolls the maximum allowed (§4.4). */
export function defenderDice(armies: number): number {
  return Math.max(0, Math.min(MAX_DEFENSE_DICE, armies));
}

/** Roll n six-sided dice, sorted high to low. */
export function rollDice(rng: Rng, n: number): number[] {
  const rolls: number[] = [];
  for (let i = 0; i < n; i++) rolls.push(1 + randomInt(rng, 6));
  return rolls.sort((a, b) => b - a);
}

/** Compare highest against highest, and so on; ties go to the defender.
 *  Total losses always equal min(attacker dice, defender dice). */
export function resolveRound(
  attackerRolls: readonly number[],
  defenderRolls: readonly number[],
): { attackerLosses: number; defenderLosses: number } {
  const a = [...attackerRolls].sort((x, y) => y - x);
  const d = [...defenderRolls].sort((x, y) => y - x);
  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++) {
    if (a[i] > d[i]) defenderLosses++;
    else attackerLosses++;
  }
  return { attackerLosses, defenderLosses };
}

/** Occupy rule: move at least the dice rolled in the final battle, at most armies − 1. */
export function occupyBounds(diceRolled: number, fromArmies: number): { minArmies: number; maxArmies: number } {
  const maxArmies = fromArmies - 1;
  return { minArmies: Math.min(diceRolled, maxArmies), maxArmies };
}

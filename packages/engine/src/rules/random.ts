// All engine randomness flows through the caller's rng (DecideContext.rng); never Math.random here.

export type Rng = () => number;

/** Integer in [0, n). Clamped so an rng that returns exactly 1 can't overflow. */
export function randomInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[randomInt(rng, items.length)];
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

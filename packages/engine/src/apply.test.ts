import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, replay } from './apply.ts';
import { simulate } from './testing/sim.ts';
import type { GameState } from './types.ts';

describe('apply', { timeout: 60_000 }, () => {
  it('never mutates its input (states are deep-frozen by the harness) and bumps the version', () => {
    const g = simulate({ players: 3, seed: 5, settings: { mode: 'online' }, timeoutRate: 0.05 });
    expect(Object.isFrozen(g.state)).toBe(true);
    expect(g.state.version).toBe(g.log.length);
  });

  it('property: replaying a prefix of the log yields the state the live game had at that point', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 1, max: 400 }),
        (seed, players, at) => {
          const snapshots: { n: number; state: GameState }[] = [];
          const g = simulate({
            players,
            seed,
            onStep: (game) => {
              if (snapshots.length === 0 && game.log.length >= at)
                snapshots.push({ n: game.log.length, state: game.state });
            },
          });
          const { n, state } = snapshots[0] ?? { n: g.log.length, state: g.state };
          expect(replay(g.initial, g.log.slice(0, n))).toEqual(state);
        },
      ),
      { numRuns: 8 },
    );
  });

  it('is a plain reducer usable with Array.reduce', () => {
    const g = simulate({ players: 2, seed: 9 });
    expect(g.log.reduce(apply, g.initial)).toEqual(g.state);
  });
});

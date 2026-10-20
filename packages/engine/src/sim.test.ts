import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { replay } from './apply.ts';
import { createInitialState } from './state.ts';
import { simulate } from './testing/sim.ts';
import type { GameEvent, WinCondition } from './types.ts';

const winConditions: WinCondition[] = ['classic', 'capitals'];

describe('full-game simulation', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    for (const winCondition of winConditions) {
      it(`${players} players, ${winCondition}: reaches game_over and replays exactly`, () => {
        const g = simulate({ players, seed: players * 31 + winCondition.length, settings: { winCondition } });
        expect(g.state.phase.kind).toBe('game_over');
        expect(replay(g.initial, g.log)).toEqual(g.state);
      });
    }
  }

  it('online async with forced timeouts, resignations and fuzzed commands', () => {
    for (const players of [2, 3, 4, 5, 6]) {
      for (const winCondition of winConditions) {
        const g = simulate({
          players,
          seed: 1000 + players,
          settings: { mode: 'online', pace: 'async', winCondition },
          timeoutRate: 0.08,
          resignRate: 0.002,
          fuzzRate: 0.1,
        });
        expect(g.state.phase.kind).toBe('game_over');
        expect(replay(g.initial, g.log)).toEqual(g.state);
      }
    }
  });

  it('online sync draft with skips, timeouts and resignations', () => {
    for (const players of [2, 3, 4, 5, 6]) {
      const g = simulate({
        players,
        seed: 2000 + players,
        settings: { mode: 'online', pace: 'sync', territoryAssignment: 'draft', winCondition: 'capitals' },
        timeoutRate: 0.1,
        resignRate: 0.003,
        fuzzRate: 0.05,
      });
      expect(g.state.phase.kind).toBe('game_over');
      expect(g.log.some((e) => e.type === 'DraftPicked')).toBe(true);
    }
  });

  it('is deterministic per seed', () => {
    const opts = { players: 4, seed: 77, settings: { mode: 'online' as const }, timeoutRate: 0.05, fuzzRate: 0.05 };
    expect(simulate(opts).log).toEqual(simulate(opts).log);
  });

  it('property: folding the emitted events from createInitialState reproduces the live state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.constantFrom(...winConditions),
        fc.integer(),
        fc.boolean(),
        (players, winCondition, seed, online) => {
          const g = simulate({
            players,
            seed,
            settings: { winCondition, mode: online ? 'online' : 'local' },
            timeoutRate: online ? 0.05 : 0,
            resignRate: 0.001,
            fuzzRate: 0.05,
          });
          const wire: GameEvent[] = JSON.parse(JSON.stringify(g.log));
          const fromFinalSettings = createInitialState(g.state.gameId, g.state.settings);
          expect(replay(g.initial, wire)).toEqual(g.state);
          expect(replay(fromFinalSettings, wire)).toEqual(g.state);
        },
      ),
      { numRuns: 12 },
    );
  });
});

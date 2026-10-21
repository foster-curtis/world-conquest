import type { GameEvent } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import { BLITZ_CAP_MS, effectiveSpeed, pairDice, planAnimation, SETTLE_MS } from './animation.ts';

const roll = (a: number[], d: number[], al = 0, dl = 0): GameEvent => ({
  type: 'AttackRolled',
  from: 'a',
  to: 'b',
  attackerRolls: a,
  defenderRolls: d,
  attackerLosses: al,
  defenderLosses: dl,
  at: '',
});

describe('dice animation plan', () => {
  it('pairs highest with highest and dims the losers', () => {
    expect(pairDice([3, 6, 1], [4, 2])).toEqual([
      { attacker: 6, defender: 4, attackerWins: true, defenderWins: false },
      { attacker: 3, defender: 2, attackerWins: true, defenderWins: false },
      { attacker: 1, defender: null, attackerWins: false, defenderWins: false },
    ]);
    expect(pairDice([4], [4])[0]).toMatchObject({ attackerWins: false, defenderWins: true });
  });

  it('a single roll is a dice step of about a second at normal speed', () => {
    const [s] = planAnimation([roll([5], [2], 0, 1)], 'normal');
    expect(s.kind).toBe('dice');
    expect(s.durationMs).toBe(600 + SETTLE_MS.normal);
  });

  it('several rolls on one border are a blitz capped at about 1.5 s plus settle', () => {
    const rolls = Array.from({ length: 30 }, () => roll([1], [1], 1, 0));
    const steps = planAnimation(rolls, 'normal');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'blitz', rounds: 30, attackerLosses: 30, defenderLosses: 0 });
    expect(steps[0].durationMs).toBe(BLITZ_CAP_MS + SETTLE_MS.normal);
  });

  it('plays moves, and nothing when speed is off or reduce-motion is on', () => {
    const ev: GameEvent[] = [roll([1], [1]), { type: 'ArmiesOccupied', from: 'a', to: 'b', armies: 2, at: '' }];
    expect(planAnimation(ev, 'fast').map((s) => s.kind)).toEqual(['dice', 'move']);
    expect(planAnimation(ev, 'off')).toEqual([]);
    expect(effectiveSpeed('normal', true)).toBe('off');
    expect(effectiveSpeed('fast', false)).toBe('fast');
  });
});

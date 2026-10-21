// Dice and move animation plans (SPEC 7.5). Pure: events in, timed steps out; components just play them.
import type { GameEvent, TerritoryId } from '@wc/engine';

export type Speed = 'normal' | 'fast' | 'off';
export const SPEEDS: Speed[] = ['normal', 'fast', 'off'];

/** The device's reduce-motion setting means "off". */
export function effectiveSpeed(setting: Speed, reduceMotion: boolean): Speed {
  return reduceMotion ? 'off' : setting;
}

export interface DicePair {
  attacker: number;
  defender: number | null;
  /** The attacker die beat the defender die (an unpaired die never "wins"). */
  attackerWins: boolean;
  defenderWins: boolean;
}

export type AnimStep =
  | {
      kind: 'dice';
      from: TerritoryId;
      to: TerritoryId;
      attackerRolls: number[];
      defenderRolls: number[];
      pairs: DicePair[];
      attackerLosses: number;
      defenderLosses: number;
      durationMs: number;
    }
  | {
      kind: 'blitz';
      from: TerritoryId;
      to: TerritoryId;
      rounds: number;
      attackerLosses: number;
      defenderLosses: number;
      last: { attackerRolls: number[]; defenderRolls: number[] };
      durationMs: number;
    }
  | { kind: 'move'; from: TerritoryId; to: TerritoryId; armies: number; durationMs: number };

export const TUMBLE_MS = { normal: 600, fast: 250 } as const;
export const BLITZ_CAP_MS = 1500;
const MOVE_MS = { normal: 450, fast: 200 } as const;
/** How long the result stays on screen after the tumble. */
export const SETTLE_MS = { normal: 700, fast: 300 } as const;

/** Highest die vs highest die, then second highest, and so on (SPEC 4.4). */
export function pairDice(attacker: number[], defender: number[]): DicePair[] {
  const a = [...attacker].sort((x, y) => y - x);
  const d = [...defender].sort((x, y) => y - x);
  return a.map((die, i) => {
    const other = i < d.length ? d[i] : null;
    return {
      attacker: die,
      defender: other,
      attackerWins: other !== null && die > other,
      defenderWins: other !== null && die <= other,
    };
  });
}

type Roll = Extract<GameEvent, { type: 'AttackRolled' }>;

/** Turns the events of one command into animation steps. Several rolls on the same border = a blitz. */
export function planAnimation(events: readonly GameEvent[], speed: Speed): AnimStep[] {
  if (speed === 'off') return [];
  const steps: AnimStep[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.type === 'AttackRolled') {
      const group: Roll[] = [e];
      while (i + 1 < events.length) {
        const n = events[i + 1];
        if (n.type !== 'AttackRolled' || n.from !== e.from || n.to !== e.to) break;
        group.push(n);
        i++;
      }
      const last = group[group.length - 1];
      const attackerLosses = group.reduce((s, r) => s + r.attackerLosses, 0);
      const defenderLosses = group.reduce((s, r) => s + r.defenderLosses, 0);
      if (group.length === 1) {
        steps.push({
          kind: 'dice',
          from: e.from,
          to: e.to,
          attackerRolls: e.attackerRolls,
          defenderRolls: e.defenderRolls,
          pairs: pairDice(e.attackerRolls, e.defenderRolls),
          attackerLosses,
          defenderLosses,
          durationMs: TUMBLE_MS[speed] + SETTLE_MS[speed],
        });
      } else {
        const perRound = speed === 'fast' ? 60 : 120;
        steps.push({
          kind: 'blitz',
          from: e.from,
          to: e.to,
          rounds: group.length,
          attackerLosses,
          defenderLosses,
          last: { attackerRolls: last.attackerRolls, defenderRolls: last.defenderRolls },
          durationMs: Math.min(BLITZ_CAP_MS, group.length * perRound) + SETTLE_MS[speed],
        });
      }
    } else if (e.type === 'ArmiesOccupied' || e.type === 'Fortified') {
      steps.push({ kind: 'move', from: e.from, to: e.to, armies: e.armies, durationMs: MOVE_MS[speed] });
    }
    i++;
  }
  return steps;
}

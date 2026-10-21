// Post-game stats computed in the browser from the replayed events (SPEC 8.3).
import type { Color, SeatId } from '@wc/engine';
import type { Frames } from '../replay/frames.ts';

export interface StatsSeat {
  seat: SeatId;
  name: string;
  color: Color;
}

export interface SeriesPoint {
  /** Turn number (1-based, every player's turn counts); the last point is the final position. */
  turn: number;
  territories: Record<SeatId, number>;
  armies: Record<SeatId, number>;
}

export interface Luck {
  seat: SeatId;
  /** Armies this player lost, attacking and defending. */
  actualLost: number;
  /** What the dice odds predict for the same fights. */
  expectedLost: number;
}

export interface Battle {
  from: string;
  to: string;
  attacker: SeatId;
  defender: SeatId;
  attackerLost: number;
  defenderLost: number;
  rounds: number;
}

export interface Stats {
  seats: StatsSeat[];
  series: SeriesPoint[];
  luck: Luck[];
  biggestBattle: Battle | null;
  longestContinent: { continent: string; seat: SeatId; turns: number } | null;
}

const cache = new Map<string, [number, number]>();

/** Expected [attacker losses, defender losses] for one roll of `a` vs `d` dice (defender wins ties). */
export function expectedLosses(a: number, d: number): [number, number] {
  const key = `${a}v${d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const total = a + d;
  let attLoss = 0;
  let defLoss = 0;
  const n = 6 ** total;
  for (let k = 0; k < n; k++) {
    let x = k;
    const dice: number[] = [];
    for (let i = 0; i < total; i++) {
      dice.push((x % 6) + 1);
      x = Math.floor(x / 6);
    }
    const att = dice.slice(0, a).sort((p, q) => q - p);
    const def = dice.slice(a).sort((p, q) => q - p);
    for (let i = 0; i < Math.min(a, d); i++) {
      if (att[i] > def[i]) defLoss++;
      else attLoss++;
    }
  }
  const r: [number, number] = [attLoss / n, defLoss / n];
  cache.set(key, r);
  return r;
}

export function computeStats(frames: Frames): Stats {
  const { events, states, map } = frames;
  const finalState = states[states.length - 1];
  const seats: StatsSeat[] = finalState.seats
    .filter((s) => s.kind === 'human')
    .map((s) => ({ seat: s.seat, name: s.displayName, color: s.color }));
  const allSeats = finalState.seats.map((s) => s.seat);

  const point = (turn: number, i: number): SeriesPoint => {
    const territories: Record<SeatId, number> = {};
    const armies: Record<SeatId, number> = {};
    for (const s of allSeats) {
      territories[s] = 0;
      armies[s] = 0;
    }
    for (const t of Object.values(states[i].territories)) {
      territories[t.owner]++;
      armies[t.owner] += t.armies;
    }
    return { turn, territories, armies };
  };

  const series: SeriesPoint[] = [];
  const lost = new Map<SeatId, { actual: number; expected: number }>();
  const addLuck = (seat: SeatId, actual: number, expected: number) => {
    const c = lost.get(seat) ?? { actual: 0, expected: 0 };
    c.actual += actual;
    c.expected += expected;
    lost.set(seat, c);
  };

  let turn = 0;
  let biggest: Battle | null = null;
  let biggestTotal = -1;
  // continent -> current holder and the turn count when they took it
  const holders = new Map<string, { seat: SeatId; since: number }>();
  let longest: Stats['longestContinent'] = null;
  const closeHold = (continent: string, upTo: number) => {
    const h = holders.get(continent);
    if (!h) return;
    const turns = upTo - h.since;
    if (turns > (longest?.turns ?? 0)) longest = { continent, seat: h.seat, turns };
    holders.delete(continent);
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'TurnStarted') {
      turn++;
      series.push(point(turn, i + 1));
    }
    if (e.type === 'AttackRolled') {
      const before = states[i].territories;
      const att = before[e.from].owner;
      const def = before[e.to].owner;
      const [ea, ed] = expectedLosses(e.attackerRolls.length, e.defenderRolls.length);
      addLuck(att, e.attackerLosses, ea);
      addLuck(def, e.defenderLosses, ed);
      // A battle is a run of rolls on one border (a blitz, or repeated Rolls).
      let attackerLost = e.attackerLosses;
      let defenderLost = e.defenderLosses;
      let rounds = 1;
      while (i + 1 < events.length) {
        const n = events[i + 1];
        if (n.type !== 'AttackRolled' || n.from !== e.from || n.to !== e.to) break;
        const [xa, xd] = expectedLosses(n.attackerRolls.length, n.defenderRolls.length);
        addLuck(att, n.attackerLosses, xa);
        addLuck(def, n.defenderLosses, xd);
        attackerLost += n.attackerLosses;
        defenderLost += n.defenderLosses;
        rounds++;
        i++;
      }
      if (attackerLost + defenderLost > biggestTotal) {
        biggestTotal = attackerLost + defenderLost;
        biggest = { from: e.from, to: e.to, attacker: att, defender: def, attackerLost, defenderLost, rounds };
      }
    }
    // Continent holders after this event.
    const terr = states[i + 1].territories;
    for (const [cid] of Object.entries(map.continents)) {
      const owners = new Set<number>();
      let all = true;
      for (const [tid, def] of Object.entries(map.territories)) {
        if (def.continent !== cid) continue;
        const t = terr[tid];
        if (!t) {
          all = false;
          break;
        }
        owners.add(t.owner);
      }
      const holder = all && owners.size === 1 ? [...owners][0] : null;
      const cur = holders.get(cid);
      if (cur && cur.seat !== holder) closeHold(cid, turn);
      if (holder !== null && !holders.has(cid)) holders.set(cid, { seat: holder, since: turn });
    }
  }
  for (const cid of [...holders.keys()]) closeHold(cid, turn);
  series.push(point(turn + 1, states.length - 1));

  return {
    seats,
    series,
    luck: seats.map((s) => ({
      seat: s.seat,
      actualLost: lost.get(s.seat)?.actual ?? 0,
      expectedLost: lost.get(s.seat)?.expected ?? 0,
    })),
    biggestBattle: biggest,
    longestContinent: longest,
  };
}

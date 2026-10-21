// Test driver: picks a plausible legal command from what the acting player can see (their PlayerView).
// Not a product feature (bots are out of scope, SPEC 10).
import {
  type Command,
  connectedOwned,
  isValidSet,
  type PlayerView,
  type SeatId,
  type TerritoryId,
} from '@wc/engine';
import type { MapDefinition } from '@wc/engine';

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;

function validSet(view: PlayerView, hand: string[]): [string, string, string] | null {
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) {
        const ids: [string, string, string] = [hand[i], hand[j], hand[k]];
        if (isValidSet(ids.map((id) => view.cards[id].symbol))) return ids;
      }
  return null;
}

export function randomMove(view: PlayerView, map: MapDefinition, me: SeatId, rnd: () => number): Command {
  const p = view.phase;
  const terr = view.territories;
  const owned = Object.keys(terr).filter((t) => terr[t].owner === me);
  const mySeat = view.seats.find((s) => s.seat === me);
  const hand = mySeat?.hand ?? [];
  if (p.kind === 'setup') {
    const placements: Record<TerritoryId, number> = {};
    for (let i = 0; i < p.armiesToPlace[me]; i++) {
      const t = pick(rnd, owned);
      placements[t] = (placements[t] ?? 0) + 1;
    }
    return { type: 'SubmitSetup', placements, capital: pick(rnd, owned) };
  }
  if (p.kind !== 'turn') throw new Error(`no move in phase ${p.kind}`);
  const front = owned.filter((t) => map.territories[t].adjacent.some((n) => terr[n].owner !== me));
  const strongest = (ts: TerritoryId[]) => ts.reduce((a, b) => (terr[b].armies > terr[a].armies ? b : a));
  const set = validSet(view, hand);
  if (p.pendingOccupy) return { type: 'Occupy', armies: p.pendingOccupy.maxArmies };
  if (p.forcedTrade) {
    if (hand.length > 4 && set) return { type: 'TradeCards', cardIds: set };
    return { type: 'PlaceReinforcements', placements: { [strongest(front)]: p.forcedTrade.armiesToPlace } };
  }
  if (p.step === 'reinforce') {
    if (set && (hand.length >= 5 || rnd() < 0.5)) return { type: 'TradeCards', cardIds: set };
    return { type: 'PlaceReinforcements', placements: { [strongest(front)]: p.reinforcementsRemaining } };
  }
  if (p.step === 'attack' && rnd() < 0.97) {
    const sources = front.filter((t) => terr[t].armies >= 2);
    if (sources.length > 0) {
      const from = rnd() < 0.9 ? strongest(sources) : pick(rnd, sources);
      const targets = map.territories[from].adjacent.filter((n) => terr[n].owner !== me);
      const to = targets.reduce((a, b) => (terr[b].armies < terr[a].armies ? b : a));
      if (terr[from].armies > terr[to].armies || rnd() < 0.2) {
        const dice = Math.min(3, terr[from].armies - 1) as 1 | 2 | 3;
        return { type: 'Attack', from, to, attackerDice: dice, untilConquered: rnd() < 0.8 };
      }
    }
  }
  if (!p.fortified && rnd() < 0.5) {
    const interior = owned.filter((t) => terr[t].armies >= 2 && !front.includes(t));
    if (interior.length > 0) {
      const from = strongest(interior);
      const reach = [...connectedOwned(map, terr, me, from)].filter((t) => front.includes(t));
      if (reach.length > 0) return { type: 'Fortify', from, to: strongest(reach), armies: terr[from].armies - 1 };
    }
  }
  if (p.step === 'attack' && rnd() < 0.3) return { type: 'EndAttack' };
  return { type: 'EndTurn' };
}

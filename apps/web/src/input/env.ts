// Builds the selection machine's environment from a PlayerView (never from full state).
import {
  connectedOwned,
  ELIMINATION_TRADE_AT,
  type MapDefinition,
  MUST_TRADE_AT,
  type PlayerView,
  type TerritoryId,
} from '@wc/engine';
import type { Mode, SelEnv } from './selection.ts';

export function deriveEnv(view: PlayerView, map: MapDefinition): SelEnv {
  const me = view.viewer;
  const terr = view.territories;
  const order = Object.keys(map.territories);
  const owns = (t: TerritoryId) => terr[t]?.owner === me;
  const armies = (t: TerritoryId) => terr[t]?.armies ?? 0;
  const p = view.phase;
  const seat = me === null ? undefined : view.seats.find((s) => s.seat === me);
  const handSize = seat?.hand?.length ?? 0;

  let mode: Mode = 'none';
  let remaining = 0;
  let setup = false;
  let occupy: SelEnv['occupy'] = null;
  if (me !== null) {
    if (p.kind === 'draft' && p.pickingSeat === me) mode = 'draft';
    else if (p.kind === 'setup' && !p.submitted.includes(me)) {
      mode = 'place';
      setup = true;
      remaining = p.armiesToPlace[me] ?? 0;
    } else if (p.kind === 'turn' && p.seat === me) {
      if (p.pendingOccupy) {
        mode = 'occupy';
        occupy = { min: p.pendingOccupy.minArmies, max: p.pendingOccupy.maxArmies };
      } else if (p.forcedTrade) {
        if (handSize >= ELIMINATION_TRADE_AT - 1) mode = 'trade';
        else if (p.forcedTrade.armiesToPlace > 0) {
          mode = 'place';
          remaining = p.forcedTrade.armiesToPlace;
        }
      } else if (p.step === 'reinforce') {
        if (handSize >= MUST_TRADE_AT) mode = 'trade';
        else {
          mode = 'place';
          remaining = p.reinforcementsRemaining;
        }
      } else if (p.step === 'attack') mode = 'attack';
      else if (p.step === 'fortify') mode = 'fortify'; // also after fortifying: End turn must stay available
    }
  }

  const frontier = (t: TerritoryId) => map.territories[t].adjacent.some((n) => !owns(n));
  const reach = (t: TerritoryId) => [...connectedOwned(map, terr, me as number, t)].filter((x) => x !== t);
  let candidates: TerritoryId[] = [];
  if (mode === 'draft') candidates = order.filter((t) => !terr[t]);
  else if (mode === 'place') candidates = order.filter(owns);
  else if (mode === 'attack') candidates = order.filter((t) => owns(t) && armies(t) >= 2 && frontier(t));
  else if (mode === 'fortify' && !(p.kind === 'turn' && p.fortified))
    candidates = order.filter((t) => owns(t) && armies(t) >= 2 && reach(t).length > 0);

  const targets = (source: TerritoryId): readonly TerritoryId[] => {
    if (mode === 'attack') return map.territories[source].adjacent.filter((n) => !owns(n));
    if (mode === 'fortify') {
      const set = new Set(reach(source));
      return order.filter((t) => set.has(t));
    }
    return [];
  };

  const turnNo = p.kind === 'turn' ? `${p.seat}:${p.startedAt}` : p.kind;
  return {
    key: `${me}|${mode}|${turnNo}`,
    mode,
    setup,
    capitals: setup && view.settings.winCondition === 'capitals',
    candidates,
    targets,
    armies,
    remaining,
    occupy,
  };
}

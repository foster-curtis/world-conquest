// Elimination and win conditions (§4.4, §4.7).
import type { MapDefinition, Seat, SeatId, TerritoryId, TerritoryState, WinCondition } from '../types.ts';

type Territories = Readonly<Record<TerritoryId, TerritoryState>>;
export type WinReason = 'world_domination' | 'capitals' | 'last_standing';

export function ownsAny(territories: Territories, seat: SeatId): boolean {
  return Object.values(territories).some((t) => t.owner === seat);
}

/** Classic: every territory. Capitals: every chosen capital (kicked players' too). */
export function mapWin(
  map: MapDefinition,
  territories: Territories,
  seats: readonly Seat[],
  winCondition: WinCondition,
  seat: SeatId,
): WinReason | null {
  if (winCondition === 'classic') {
    return Object.keys(map.territories).every((id) => territories[id]?.owner === seat) ? 'world_domination' : null;
  }
  const capitals = seats.map((s) => s.capital).filter((c): c is TerritoryId => c !== null);
  return capitals.length > 0 && capitals.every((c) => territories[c]?.owner === seat) ? 'capitals' : null;
}

/** The only human seat still active, once every other human is kicked or eliminated. */
export function lastStanding(seats: readonly Seat[]): SeatId | null {
  const active = seats.filter((s) => s.kind === 'human' && s.status === 'active');
  return active.length === 1 ? active[0].seat : null;
}

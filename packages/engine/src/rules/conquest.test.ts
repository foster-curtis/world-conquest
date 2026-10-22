import { describe, expect, it } from 'vitest';
import { classicMap } from '../maps/classic.ts';
import type { Seat, TerritoryState } from '../types.ts';
import { lastStanding, mapWin, ownsAny } from './conquest.ts';

const ids = Object.keys(classicMap.territories);
const seat = (n: number, extra: Partial<Seat> = {}): Seat => ({
  seat: n,
  kind: 'human',
  status: 'active',
  userId: null,
  displayName: `P${n}`,
  color: 'crimson',
  turnOrder: n,
  consecutiveStrikes: 0,
  hand: [],
  capital: null,
  ...extra,
});

describe('elimination and win conditions', () => {
  it('a seat with no territories is out', () => {
    expect(ownsAny({ alaska: { owner: 1, armies: 1 } }, 0)).toBe(false);
    expect(ownsAny({ alaska: { owner: 0, armies: 1 } }, 0)).toBe(true);
  });

  it('classic needs every territory, including inert seats', () => {
    const all: Record<string, TerritoryState> = Object.fromEntries(ids.map((id) => [id, { owner: 0, armies: 1 }]));
    expect(mapWin(classicMap, all, [seat(0)], 'classic', 0)).toBe('world_domination');
    all.peru = { owner: 2, armies: 1 };
    expect(mapWin(classicMap, all, [seat(0)], 'classic', 0)).toBeNull();
  });

  it('capitals needs every capital, kicked players included', () => {
    const t: Record<string, TerritoryState> = Object.fromEntries(ids.map((id) => [id, { owner: 0, armies: 1 }]));
    t.japan = { owner: 1, armies: 1 };
    const seats = [
      seat(0, { capital: 'peru' }),
      seat(1, { capital: 'alaska', status: 'kicked' }),
      seat(2, { capital: 'japan' }),
    ];
    expect(mapWin(classicMap, t, seats, 'capitals', 0)).toBeNull();
    t.japan = { owner: 0, armies: 1 };
    expect(mapWin(classicMap, t, seats, 'capitals', 0)).toBe('capitals');
  });

  it('last standing ignores neutral and kicked seats', () => {
    const seats = [
      seat(0),
      seat(1, { status: 'kicked' }),
      seat(2, { kind: 'neutral' }),
      seat(3, { status: 'eliminated' }),
    ];
    expect(lastStanding(seats)).toBe(0);
    expect(lastStanding([seat(0), seat(1)])).toBeNull();
  });
});

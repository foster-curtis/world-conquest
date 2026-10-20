import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Game, lobbyGame, seat } from './testing/harness.ts';
import { simulate } from './testing/sim.ts';
import type { GameEvent, GameState, SeatId } from './types.ts';
import { HIDDEN_CARD_ID, redactEvent, toPlayerView } from './views.ts';

function checkView(s: GameState, viewer: SeatId | null): void {
  const view = toPlayerView(s, viewer);
  expect('deck' in view).toBe(false);
  expect('hiddenSetup' in view).toBe(false);
  expect(view.deckSize).toBe(s.deck.length);
  expect(view.viewer).toBe(viewer);
  for (const seat of view.seats) {
    const real = s.seats.find((x) => x.seat === seat.seat);
    expect(seat.handSize).toBe(real?.hand.length);
    expect(seat.hand).toEqual(seat.seat === viewer ? real?.hand : null);
  }
  expect(view.mySetup).toEqual(viewer !== null ? (s.hiddenSetup[viewer] ?? null) : null);
  // nothing in the view mentions another seat's secret: the deck order or another hand, in any card field
  const secret = new Set([...s.deck, ...s.seats.filter((x) => x.seat !== viewer).flatMap((x) => x.hand)]);
  for (const seat of view.seats) for (const c of seat.hand ?? []) expect(secret.has(c)).toBe(false);
}

function checkEvent(e: GameEvent, viewer: SeatId | null): void {
  const before = JSON.stringify(e);
  const r = redactEvent(e, viewer);
  expect(JSON.stringify(e)).toBe(before); // redaction never mutates the original
  if (r === null) return;
  expect(r.type).toBe(e.type);
  if (r.type === 'GameStarted' || r.type === 'DeckReshuffled') expect(r.deck).toEqual([]);
  if (r.type === 'CardDrawn' && r.seat !== viewer) expect(r.cardId).toBe(HIDDEN_CARD_ID);
  if (r.type === 'SetupSubmitted' && r.seat !== viewer) {
    expect(r.placements).toEqual({});
    expect(r.capital).toBeNull();
  }
  if (r.type === 'SeatEliminated' && r.seat !== viewer && r.by !== viewer) {
    expect(r.cardsTransferred.every((c) => c === HIDDEN_CARD_ID)).toBe(true);
  }
  // events the viewer is entitled to see come through untouched
  if (r.type === 'CardDrawn' && r.seat === viewer) expect(r).toEqual(e);
  if (r.type === 'SetupSubmitted' && r.seat === viewer) expect(r).toEqual(e);
}

describe('views and redaction', () => {
  it('property: no viewer ever sees deck order, other hands, or others’ hidden setup', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 2, max: 6 }), fc.boolean(), (seed, players, online) => {
        let seen = 0;
        const onStep = (g: Game) => {
          const viewers: (SeatId | null)[] = [null, ...g.state.seats.map((s) => s.seat), 5];
          for (const v of viewers) checkView(g.state, v);
          for (const e of g.log.slice(seen)) for (const v of viewers) checkEvent(e, v);
          seen = g.log.length;
        };
        simulate({
          players,
          seed,
          settings: online
            ? { mode: 'online', pace: 'sync', territoryAssignment: 'draft', winCondition: 'capitals' }
            : { mode: 'local' },
          timeoutRate: online ? 0.05 : 0,
          resignRate: 0.002,
          onStep,
        });
        return true;
      }),
      { numRuns: 6 },
    );
  });

  it('a seated viewer sees their own hidden setup during setup, not others’', () => {
    const g = lobbyGame(3);
    const p = g.state.phase;
    if (p.kind !== 'setup') throw new Error('expected setup');
    const t = g.owned(0)[0];
    const [submitted] = g.do(seat(0), { type: 'SubmitSetup', placements: { [t]: p.armiesToPlace[0] } });
    expect(toPlayerView(g.state, 0).mySetup).toEqual({ placements: { [t]: p.armiesToPlace[0] }, capital: null });
    expect(toPlayerView(g.state, 1).mySetup).toBeNull();
    expect(toPlayerView(g.state, null).mySetup).toBeNull();
    expect(toPlayerView(g.state, 1).territories[t].armies).toBe(1);
    expect(redactEvent(submitted, 1)).toEqual({ ...submitted, placements: {}, capital: null });
    expect(redactEvent(submitted, 0)).toBe(submitted);
  });
});

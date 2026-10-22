import { describe, expect, it } from 'vitest';
import { LocalGame } from '../local/controller.ts';
import { memoryStore } from '../local/store.ts';
import { compactStrip } from './strip.ts';

describe('compactStrip', () => {
  it('derives per-seat counts, the current seat and eliminations from a PlayerView only', async () => {
    const g = await LocalGame.create(
      memoryStore(),
      [
        { name: 'Ana', color: 'crimson' },
        { name: 'Ben', color: 'cobalt' },
        { name: 'Cy', color: 'jade' },
      ],
      'classic',
    );
    g.confirmPass();
    const view = g.getView();
    const rows = compactStrip(view);
    expect(rows.map((r) => r.name)).toEqual(view.seats.map((s) => (s.kind === 'neutral' ? 'Neutral' : s.displayName)));
    const total = Object.keys(view.territories).length;
    expect(rows.reduce((n, r) => n + r.territories, 0)).toBe(total);
    expect(rows.reduce((n, r) => n + r.armies, 0)).toBe(
      Object.values(view.territories).reduce((n, t) => n + t.armies, 0),
    );
    expect(rows.every((r) => !r.eliminated)).toBe(true);
    for (const r of rows) {
      const seat = view.seats.find((s) => s.seat === r.seat);
      expect(r.cards).toBe(seat?.kind === 'human' ? seat.handSize : null);
    }
    const eliminated = compactStrip({
      ...view,
      phase: { kind: 'game_over', winner: 0, reason: 'last_standing' } as typeof view.phase,
      seats: view.seats.map((s, i) => (i === 1 ? { ...s, status: 'eliminated' as const } : s)),
    });
    expect(eliminated.every((r) => !r.current)).toBe(true);
    expect(eliminated[1].eliminated).toBe(true);
  });
});

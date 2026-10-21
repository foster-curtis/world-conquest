// Compact player strip data (SPEC 7.6), shown across the top when the sidebar is closed.
// Pure function of a PlayerView: nothing here needs hidden information.
import type { PlayerView } from '@wc/engine';

export interface StripEntry {
  seat: number;
  color: PlayerView['seats'][number]['color'];
  name: string;
  territories: number;
  armies: number;
  /** Null for the neutral seat, whose hand is not shown. */
  cards: number | null;
  current: boolean;
  eliminated: boolean;
}

export function compactStrip(view: PlayerView): StripEntry[] {
  const counts = new Map<number, { t: number; a: number }>();
  for (const t of Object.values(view.territories)) {
    const c = counts.get(t.owner) ?? { t: 0, a: 0 };
    c.t++;
    c.a += t.armies;
    counts.set(t.owner, c);
  }
  const turn = view.phase.kind === 'turn' ? view.phase.seat : null;
  return view.seats.map((s) => {
    const c = counts.get(s.seat) ?? { t: 0, a: 0 };
    const human = s.kind === 'human';
    return {
      seat: s.seat,
      color: s.color,
      name: s.kind === 'neutral' ? 'Neutral' : s.displayName,
      territories: c.t,
      armies: c.a,
      cards: human ? s.handSize : null,
      current: s.seat === turn,
      eliminated: human && s.status !== 'active',
    };
  });
}

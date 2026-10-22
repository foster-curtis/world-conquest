// Turn HUD (SPEC 7.6): step bar, cards, players, activity feed. No timer in local mode.
import { type CardId, type MapDefinition, type PlayerView, tradeValue } from '@wc/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COLOR_HEX } from '../board/colors.ts';
import type { MainButton } from '../input/selection.ts';
import { bestSet, type CardSet, validSets } from './cards.ts';
import type { FeedLine } from './feed.ts';
import { compactStrip } from './strip.ts';

const STEPS = [
  { id: 'reinforce', label: 'Reinforce' },
  { id: 'attack', label: 'Attack' },
  { id: 'fortify', label: 'Fortify' },
] as const;

export function StepBar(props: {
  view: PlayerView;
  main: MainButton;
  onMain: () => void;
  onCards: () => void;
  onShortcuts: () => void;
  locked: boolean;
}) {
  const { view, main } = props;
  const p = view.phase;
  let active: string | null = null;
  let note = '';
  if (p.kind === 'setup') {
    note = `Setup: place ${p.armiesToPlace[view.viewer ?? -1] ?? 0} armies`;
  } else if (p.kind === 'turn') {
    active = p.pendingOccupy ? 'attack' : p.step;
    if (p.pendingOccupy) note = 'Move armies into the conquered territory';
    else if (p.forcedTrade) note = 'Trade cards to get your hand down';
    else if (p.step === 'reinforce') note = `${p.reinforcementsRemaining} armies left to place`;
    else if (p.step === 'attack') note = 'Attack, or end your attack';
    else note = p.fortified ? 'Already fortified' : 'Fortify once, or end your turn';
  } else if (p.kind === 'game_over') note = 'Game over';
  return (
    <div className={`stepbar${p.kind === 'turn' && p.seat === view.viewer ? ' mine' : ''}`}>
      <ol className="steps">
        {STEPS.map((s) => (
          <li key={s.id} className={s.id === active ? 'on' : ''} aria-current={s.id === active ? 'step' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
      <span className="note">{note}</span>
      <span className="grow" />
      <button type="button" className="ghost" onClick={props.onCards}>
        Cards
        {(view.seats.find((s) => s.seat === view.viewer)?.handSize ?? 0) > 0
          ? ` (${view.seats.find((s) => s.seat === view.viewer)?.handSize})`
          : ''}
      </button>
      <button type="button" className="ghost" onClick={props.onShortcuts}>
        Keyboard shortcuts
      </button>
      <button type="button" className="primary" disabled={!main.enabled || props.locked} onClick={props.onMain}>
        {main.label}
      </button>
    </div>
  );
}

export function PlayersPanel({ view, present }: { view: PlayerView; present?: ReadonlySet<number> }) {
  const rows = useMemo(() => {
    const counts = new Map<number, { territories: number; armies: number }>();
    for (const t of Object.values(view.territories)) {
      const c = counts.get(t.owner) ?? { territories: 0, armies: 0 };
      c.territories++;
      c.armies += t.armies;
      counts.set(t.owner, c);
    }
    return view.seats.map((s) => ({ s, c: counts.get(s.seat) ?? { territories: 0, armies: 0 } }));
  }, [view.territories, view.seats]);
  const turn = view.phase.kind === 'turn' ? view.phase.seat : null;
  return (
    <ul className="players" aria-label="Players">
      {rows.map(({ s, c }) => (
        <li
          key={s.seat}
          className={`${s.seat === turn ? 'turn' : ''}${s.status !== 'active' && s.kind === 'human' ? ' out' : ''}`}
        >
          <span className="dot" style={{ background: COLOR_HEX[s.color] }} />
          <span className="pname">{s.kind === 'neutral' ? 'Neutral' : s.displayName}</span>
          {present && s.kind === 'human' && (
            <span
              className={`presence${present.has(s.seat) ? ' on' : ''}`}
              title={present.has(s.seat) ? 'Has the game open' : 'Away'}
              role="img"
              aria-label={present.has(s.seat) ? 'online' : 'away'}
            />
          )}
          {s.kind === 'human' && s.status === 'active' && s.consecutiveStrikes > 0 && (
            <span className="tag" title="Consecutive skipped turns; 3 means removal">
              {s.consecutiveStrikes}/3 strikes
            </span>
          )}
          <span className="pstats num" title="territories / armies / cards">
            {c.territories}T {c.armies}A {s.kind === 'human' ? `${s.handSize}C` : ''}
          </span>
          {s.status !== 'active' && s.kind === 'human' && <span className="tag">{s.status}</span>}
        </li>
      ))}
    </ul>
  );
}

export function CompactStrip({ view }: { view: PlayerView }) {
  const rows = useMemo(() => compactStrip(view), [view]);
  return (
    <ul className="compact-strip" aria-label="Players">
      {rows.map((r) => (
        <li
          key={r.seat}
          className={`${r.current ? 'turn' : ''}${r.eliminated ? ' out' : ''}`}
          aria-current={r.current ? 'true' : undefined}
          title={`${r.name}: ${r.territories} territories, ${r.armies} armies${r.cards === null ? '' : `, ${r.cards} cards`}`}
        >
          <span className="dot" style={{ background: COLOR_HEX[r.color] }} />
          <span className="pname">{r.name}</span>
          <span className="pstats num">
            {r.territories}T {r.armies}A{r.cards === null ? '' : ` ${r.cards}C`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityFeed({ lines }: { lines: FeedLine[] }) {
  const end = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a line is added
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [lines.length]);
  return (
    <>
      <div className="feed-head">
        <span>Activity</span>
      </div>
      <div className="feed" role="log" aria-label="Activity">
        {lines.slice(-200).map((l) => (
          <p key={l.key}>{l.text}</p>
        ))}
        <div ref={end} />
      </div>
    </>
  );
}

const SYMBOL: Record<string, string> = { infantry: 'I', cavalry: 'C', artillery: 'A', wild: '*' };

export function CardsPanel(props: {
  view: PlayerView;
  map: MapDefinition;
  /** Trading is allowed right now (reinforce step or forced trade). */
  canTrade: boolean;
  /** A trade is required before anything else. */
  mustTrade: boolean;
  onTrade: (ids: CardSet) => void;
  onClose: () => void;
}) {
  const { view, map } = props;
  const me = view.viewer;
  const hand: CardId[] = useMemo(() => view.seats.find((s) => s.seat === me)?.hand ?? [], [view.seats, me]);
  const sets = useMemo(() => validSets(hand, view.cards), [hand, view.cards]);
  const best = useMemo(
    () => (me === null ? null : bestSet(hand, view.cards, (t) => view.territories[t]?.owner, me)),
    [hand, view.cards, view.territories, me],
  );
  const [picked, setPicked] = useState<CardId[]>(best ?? []);
  const handKey = hand.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-select the best set only when the hand changes
  useEffect(() => setPicked(best ?? []), [handKey]);
  const inSet = new Set(sets.flat());
  const chosenValid = picked.length === 3 && sets.some((s) => s.every((id) => picked.includes(id)));
  const toggle = (id: CardId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));
  return (
    <section className="modal cards" aria-label="Your cards">
      <h2>Your cards</h2>
      {props.mustTrade && <p className="warn">You must trade in a set before doing anything else.</p>}
      {hand.length === 0 && <p>No cards yet. You draw one when you conquer a territory.</p>}
      <div className="cardhand">
        {hand.map((id) => {
          const c = view.cards[id];
          const on = picked.includes(id);
          return (
            <button
              type="button"
              key={id}
              className={`card ${c.symbol}${on ? ' on' : ''}${inSet.has(id) ? ' inset' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(id)}
            >
              <b>{SYMBOL[c.symbol]}</b>
              <span>{c.territory ? map.territories[c.territory].name : 'Wild'}</span>
              <small>{c.symbol}</small>
            </button>
          );
        })}
      </div>
      <p className="hint">Trade value now: {tradeValue(view.tradeCount)} armies. Cards that form a set are outlined.</p>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={!props.canTrade || !chosenValid}
          onClick={() => props.onTrade(picked as CardSet)}
        >
          Trade in
        </button>
        <button type="button" className="ghost" onClick={props.onClose} disabled={props.mustTrade && sets.length > 0}>
          Close
        </button>
      </div>
    </section>
  );
}

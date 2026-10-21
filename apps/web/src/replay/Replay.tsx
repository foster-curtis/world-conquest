// Replay viewer (SPEC 8.2): the normal board, rebuilt from events, with a timeline. Post-game only; everything is revealed.
import { type Card, type GameState, tradeValue } from '@wc/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Fx } from '../board/Board.tsx';
import { COLOR_HEX } from '../board/colors.ts';
import { makeDisplay, makeTooltip } from '../board/display.ts';
import { buildFeed } from '../hud/feed.ts';
import { buildFrames, type ReplayInput } from './frames.ts';

type ReplaySpeed = 'normal' | 'fast' | 'instant';
const DELAY: Record<ReplaySpeed, number> = { normal: 450, fast: 120, instant: 0 };
const NO_FX: Fx[] = [];

function describeHand(state: GameState, hand: string[]): string {
  if (hand.length === 0) return 'none';
  return hand
    .map((id) => {
      const c: Card = state.cards[id];
      return c.territory ? `${c.territory.replace(/_/g, ' ')} (${c.symbol})` : 'wild';
    })
    .join(', ');
}

export function ReplayScreen(props: { input: ReplayInput; onClose: () => void; onStats?: () => void }) {
  const frames = useMemo(() => buildFrames(props.input), [props.input]);
  const total = frames.events.length;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>('normal');
  const boardRef = useRef<HTMLDivElement | null>(null);
  const state = frames.states[idx];
  const event = idx > 0 ? frames.events[idx - 1] : null;

  useEffect(() => {
    if (!playing) return;
    if (idx >= total) {
      setPlaying(false);
      return;
    }
    if (speed === 'instant') {
      setIdx(total);
      return;
    }
    const t = setTimeout(() => setIdx((i) => Math.min(total, i + 1)), DELAY[speed]);
    return () => clearTimeout(t);
  }, [playing, idx, total, speed]);

  const stepTurn = (dir: 1 | -1) => {
    const starts = frames.turnStarts.map((i) => i + 1); // frame index after the TurnStarted event
    if (dir === 1) setIdx(starts.find((s) => s > idx) ?? total);
    else setIdx([...starts].reverse().find((s) => s < idx) ?? 0);
  };

  const display = useMemo(
    () => makeDisplay({ territories: state.territories, seats: state.seats, viewer: null }, frames.map),
    [state, frames.map],
  );
  const tooltip = useMemo(
    () => makeTooltip({ territories: state.territories, seats: state.seats, viewer: null }, frames.map),
    [state, frames.map],
  );
  const names = useMemo(() => {
    const final = frames.states[frames.states.length - 1];
    const byId = new Map(final.seats.map((s) => [s.seat, s.kind === 'neutral' ? 'Neutral' : s.displayName]));
    return { seat: (n: number) => byId.get(n) ?? `Seat ${n}`, map: frames.map };
  }, [frames]);
  const lines = useMemo(() => buildFeed(frames.events.slice(0, idx), names), [frames, idx, names]);
  const fx: Fx[] = useMemo(() => {
    if (event?.type !== 'AttackRolled') return NO_FX;
    const out: Fx[] = [];
    if (event.attackerLosses > 0)
      out.push({ key: `a${idx}`, kind: 'loss', territory: event.from, text: `−${event.attackerLosses}` });
    if (event.defenderLosses > 0)
      out.push({ key: `d${idx}`, kind: 'loss', territory: event.to, text: `−${event.defenderLosses}` });
    return out;
  }, [event, idx]);

  return (
    <div className="game replay">
      <header className="topbar">
        <button type="button" className="ghost" onClick={props.onClose}>
          ← Back
        </button>
        <span className="who">Replay</span>
        <span className="grow" />
        {props.onStats && (
          <button type="button" onClick={props.onStats}>
            Stats
          </button>
        )}
      </header>
      <main className="stage">
        <Board
          boardRef={boardRef}
          display={display}
          displayVersion={idx}
          source={null}
          target={null}
          focus={null}
          candidates={[]}
          targets={[]}
          fx={fx}
          interactive={false}
          onAction={() => {}}
          tooltip={tooltip}
        />
      </main>
      <aside className="sidebar open">
        <ul className="players" aria-label="Players (hands revealed)">
          {state.seats
            .filter((s) => s.kind === 'human')
            .map((s) => (
              <li key={s.seat} className={state.phase.kind === 'turn' && state.phase.seat === s.seat ? 'turn' : ''}>
                <span className="dot" style={{ background: COLOR_HEX[s.color] }} />
                <span className="pname">{s.displayName}</span>
                <span className="pstats" title="Cards in hand">
                  {s.hand.length} cards
                </span>
                <small className="hand">{describeHand(state, s.hand)}</small>
              </li>
            ))}
        </ul>
        <p className="hint">Next card trade is worth {tradeValue(state.tradeCount)} armies.</p>
        <div className="feed" role="log" aria-label="Activity so far">
          {lines.slice(-60).map((l) => (
            <p key={l.key}>{l.text}</p>
          ))}
        </div>
      </aside>
      <footer className="bottom timeline">
        <button type="button" onClick={() => setIdx(0)} aria-label="Start" disabled={idx === 0}>
          ⏮
        </button>
        <button type="button" onClick={() => stepTurn(-1)} aria-label="Previous turn" disabled={idx === 0}>
          ⏪
        </button>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          aria-label="Previous event"
          disabled={idx === 0}
        >
          ◀
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (idx >= total) setIdx(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.min(total, i + 1))}
          aria-label="Next event"
          disabled={idx >= total}
        >
          ▶
        </button>
        <button type="button" onClick={() => stepTurn(1)} aria-label="Next turn" disabled={idx >= total}>
          ⏩
        </button>
        <button type="button" onClick={() => setIdx(total)} aria-label="End" disabled={idx >= total}>
          ⏭
        </button>
        <input
          type="range"
          min={0}
          max={total}
          value={idx}
          aria-label="Timeline"
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
        />
        <span className="count">
          {idx}/{total}
        </span>
        <label className="speed">
          Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value as ReplaySpeed)}>
            <option value="normal">normal</option>
            <option value="fast">fast</option>
            <option value="instant">instant</option>
          </select>
        </label>
      </footer>
    </div>
  );
}

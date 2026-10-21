// The pass-and-play game screen. It renders only `toPlayerView(state, currentSeat)` (via LocalGame.getView),
// never full state, and shows the pass screen before every turn and setup turn (SPEC 1).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Board, type Fx } from '../board/Board.tsx';
import { makeDisplay, makeTooltip } from '../board/display.ts';
import { type AnimStep, effectiveSpeed, planAnimation, SPEEDS, type Speed } from '../dice/animation.ts';
import { DiceOverlay } from '../dice/DiceOverlay.tsx';
import { loadSpeed, prefersReducedMotion, saveSpeed } from '../dice/settings.ts';
import { ActionPanel } from '../hud/ActionPanel.tsx';
import type { CardSet } from '../hud/cards.ts';
import { buildFeed } from '../hud/feed.ts';
import { ActivityFeed, CardsPanel, PlayersPanel, StepBar } from '../hud/Hud.tsx';
import { deriveEnv } from '../input/env.ts';
import { keyToAction } from '../input/keyboard.ts';
import { ShortcutOverlay, StartTip, useShortcutOverlay } from '../input/ShortcutOverlay.tsx';
import {
  contextOf,
  initialSel,
  mainButton,
  reduce,
  type SelAction,
  type SelEffect,
  type SelState,
} from '../input/selection.ts';
import type { LocalGame } from './controller.ts';
import { PassScreen } from './PassScreen.tsx';

export interface GameScreenProps {
  game: LocalGame;
  /** Show the "Hold Alt + /" tip (new games only). */
  showTip: boolean;
  /** Set when saving is unavailable (IndexedDB blocked). */
  warning: string | null;
  onHome: () => void;
  onReplay: () => void;
  onStats: () => void;
}

export function GameScreen(props: GameScreenProps) {
  const { game } = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [tip, setTip] = useState(props.showTip);
  const [speed, setSpeedState] = useState<Speed>(loadSpeed);
  const [anim, setAnim] = useState<{ steps: AnimStep[]; i: number } | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [showCards, setShowCards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardFocused, setBoardFocused] = useState(false);
  const overlay = useShortcutOverlay();
  const fxCounter = useRef(0);

  const passing = game.needsPass();
  const view = game.getView();
  const env = useMemo(() => deriveEnv(view, game.map), [view, game.map]);
  const [sel, setSel] = useState<SelState>(() => initialSel(env.key));
  const selRef = useRef(sel);
  selRef.current = sel;
  const envRef = useRef(env);
  envRef.current = env;
  const locked = anim !== null;
  const over = view.phase.kind === 'game_over';

  const setSpeed = (s: Speed) => {
    setSpeedState(s);
    saveSpeed(s);
  };

  const playEvents = useCallback(
    (events: Parameters<Parameters<LocalGame['subscribe']>[0]>[0]) => {
      const steps = planAnimation(events, effectiveSpeed(speed, prefersReducedMotion()));
      if (steps.length > 0) setAnim({ steps, i: 0 });
    },
    [speed],
  );

  const runEffect = useCallback(
    (ef: SelEffect) => {
      if (ef.type === 'releaseFocus') {
        boardRef.current?.blur();
        return;
      }
      const events: Parameters<Parameters<LocalGame['subscribe']>[0]>[0][] = [];
      const off = game.subscribe((e) => events.push(e));
      const r = game.dispatch(ef.cmd);
      off();
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setError(null);
      setSel(initialSel(''));
      selRef.current = initialSel('');
      for (const e of events) playEvents(e);
      rerender();
    },
    [game, playEvents],
  );

  const send = useCallback(
    (a: SelAction) => {
      const r = reduce(selRef.current, a, envRef.current);
      selRef.current = r.state;
      setSel(r.state);
      for (const ef of r.effects) runEffect(ef);
    },
    [runEffect],
  );

  // Re-validate the selection whenever the game changes under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `env` is derived from `view`
  useEffect(() => {
    send({ type: 'sync' });
  }, [env, send]);

  // Advance the animation queue.
  useEffect(() => {
    if (!anim) {
      setFx([]);
      return;
    }
    const step = anim.steps[anim.i];
    const key = () => `fx${fxCounter.current++}`;
    if (step.kind === 'move') setFx([{ key: key(), kind: 'move', from: step.from, to: step.to }]);
    else {
      const next: Fx[] = [];
      if (step.attackerLosses > 0)
        next.push({ key: key(), kind: 'loss', territory: step.from, text: `−${step.attackerLosses}` });
      if (step.defenderLosses > 0)
        next.push({ key: key(), kind: 'loss', territory: step.to, text: `−${step.defenderLosses}` });
      setFx(next);
    }
    const t = setTimeout(
      () => setAnim((a) => (a && a.i + 1 < a.steps.length ? { ...a, i: a.i + 1 } : null)),
      step.durationMs,
    );
    return () => clearTimeout(t);
  }, [anim]);

  // A required trade opens the cards panel by itself.
  useEffect(() => {
    if (env.mode === 'trade') setShowCards(true);
  }, [env.mode]);

  // Keyboard: one window listener, translated by the keyboard adapter.
  useEffect(() => {
    if (passing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Slash' && e.altKey) return; // overlay hook owns this
      const target = e.target as HTMLElement | null;
      if (target?.matches('input:not([type=range]), textarea, select')) return;
      if (showCards) {
        if (e.key === 'Escape' && envRef.current.mode !== 'trade') setShowCards(false);
        return;
      }
      if (locked) return;
      const ctx = contextOf(selRef.current, envRef.current);
      const onRange = target?.matches('input[type=range]') ?? false;
      const onButton = target?.matches('button, a') ?? false;
      if (onRange && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) return;
      if (onButton && e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) return;
      const a = keyToAction(e, { context: ctx, boardFocused: document.activeElement === boardRef.current });
      if (!a) return;
      e.preventDefault();
      if (a.type === 'cards') setShowCards(true);
      else send(a);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Space on a focused button would otherwise click it on release.
      if (e.key === ' ' && contextOf(selRef.current, envRef.current) === 'attack-panel') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [passing, showCards, locked, send]);

  const names = useMemo(() => {
    const byId = new Map(view.seats.map((s) => [s.seat, s.kind === 'neutral' ? 'Neutral' : s.displayName]));
    return { seat: (n: number) => byId.get(n) ?? `Seat ${n}`, map: game.map };
  }, [view.seats, game.map]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the log only changes with the view version
  const feed = useMemo(() => buildFeed(game.visibleEvents(), names), [view.version, names, game]);
  const stagedKey = JSON.stringify(sel.staged);
  const display = useMemo(
    () => makeDisplay(view, game.map, sel.staged, sel.capital),
    [view, game.map, sel.staged, sel.capital],
  );
  const tooltip = useMemo(() => makeTooltip(view, game.map), [view, game.map]);

  if (passing) {
    const seat = game.actingSeat() as number;
    const p = game.players.find((x) => x.seat === seat);
    return (
      <PassScreen
        name={p?.name ?? `Player ${seat + 1}`}
        color={p?.color ?? 'gray'}
        kind={game.phaseKind === 'setup' ? 'setup' : 'turn'}
        onReady={() => {
          game.confirmPass();
          rerender();
        }}
        onHome={props.onHome}
      />
    );
  }

  const me = view.viewer;
  const mySeat = view.seats.find((s) => s.seat === me);
  const p = view.phase;
  const canTrade = p.kind === 'turn' && !p.pendingOccupy && (p.forcedTrade !== null || p.step === 'reinforce');
  const main = mainButton(sel, env);
  const ctx = contextOf(sel, env);
  const targets = sel.source ? env.targets(sel.source) : [];
  const step = anim ? anim.steps[anim.i] : null;
  const winner = p.kind === 'game_over' ? view.seats.find((s) => s.seat === p.winner) : null;

  const trade = (ids: CardSet) => {
    const r = game.dispatch({ type: 'TradeCards', cardIds: ids });
    if (!r.ok) setError(r.error.message);
    else {
      setError(null);
      setShowCards(false);
      send({ type: 'reset' });
      rerender();
    }
  };

  const resign = () => {
    if (!window.confirm(`${mySeat?.displayName} resigns? This cannot be undone.`)) return;
    const r = game.dispatch({ type: 'LeaveGame' });
    if (!r.ok) setError(r.error.message);
    rerender();
  };

  return (
    <div className={`game${drawer ? ' drawer-open' : ''}`}>
      <header className="topbar">
        <button type="button" className="ghost" onClick={props.onHome}>
          ← Home
        </button>
        <span className="who">
          {over ? (
            'Game over'
          ) : (
            <>
              Playing: <b>{mySeat?.displayName}</b>
            </>
          )}
        </span>
        <span className="grow" />
        <label className="speed">
          Animation
          <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {!over && (
          <button type="button" className="ghost" onClick={resign}>
            Resign
          </button>
        )}
      </header>
      {props.warning && (
        <div className="banner warn" role="alert">
          {props.warning}
        </div>
      )}
      {error && (
        <div className="banner err" role="alert">
          {error}
        </div>
      )}
      <div className="strip">
        <PlayersPanel view={view} />
      </div>
      <main className="stage">
        <Board
          boardRef={boardRef}
          display={display}
          displayVersion={`${view.version}|${stagedKey}|${sel.capital}`}
          source={sel.source}
          target={sel.target}
          focus={sel.focus}
          candidates={env.mode === 'place' ? [] : env.candidates}
          targets={targets}
          fx={fx}
          interactive={!locked && !over && env.mode !== 'none' && env.mode !== 'trade'}
          onAction={send}
          tooltip={tooltip}
          onFocusChange={setBoardFocused}
        />
        {tip && <StartTip onDismiss={() => setTip(false)} />}
        {!over && !locked && <ActionPanel sel={sel} env={env} map={game.map} locked={locked} send={send} />}
        {step && (step.kind === 'dice' || step.kind === 'blitz') && (
          <DiceOverlay
            step={step}
            fromName={game.map.territories[step.from].name}
            toName={game.map.territories[step.to].name}
            speed={speed === 'fast' ? 'fast' : 'normal'}
            onSkip={() => setAnim(null)}
          />
        )}
      </main>
      <aside className="sidebar">
        <button type="button" className="ghost drawer-toggle" onClick={() => setDrawer((d) => !d)}>
          {drawer ? 'Hide' : 'Players & log'}
        </button>
        <div className="side-players">
          <PlayersPanel view={view} />
        </div>
        <ActivityFeed lines={feed} />
      </aside>
      <footer className="bottom">
        <StepBar
          view={view}
          main={over ? { label: 'Game over', enabled: false } : main}
          onMain={() => send({ type: 'main' })}
          onCards={() => setShowCards(true)}
          onShortcuts={overlay.toggle}
          locked={locked || over}
        />
      </footer>
      {showCards && !over && (
        <div className="overlay">
          <CardsPanel
            view={view}
            map={game.map}
            canTrade={canTrade && !locked}
            mustTrade={env.mode === 'trade'}
            onTrade={trade}
            onClose={() => setShowCards(false)}
          />
        </div>
      )}
      {overlay.open && <ShortcutOverlay context={ctx} onClose={overlay.close} />}
      {over && !locked && winner && (
        <div className="overlay">
          <section className="modal gameover" aria-label="Game over">
            <h2>{winner.displayName} wins!</h2>
            <p>
              {p.kind === 'game_over' && p.reason === 'last_standing'
                ? 'The last player standing.'
                : p.kind === 'game_over' && p.reason === 'capitals'
                  ? 'Every capital captured.'
                  : 'The world is conquered.'}
            </p>
            <div className="row">
              <button type="button" className="primary" onClick={props.onReplay}>
                Watch replay
              </button>
              <button type="button" onClick={props.onStats}>
                Stats
              </button>
              <button type="button" className="ghost" onClick={props.onHome}>
                Home
              </button>
            </div>
          </section>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {boardFocused && sel.focus ? display(sel.focus).label : ''}
      </span>
    </div>
  );
}

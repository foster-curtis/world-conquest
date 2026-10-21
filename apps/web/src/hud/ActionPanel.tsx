// Bottom panels for the selection machine's contexts (SPEC 7.3): placing, attack, occupy/fortify sliders.
// Counts are never typed: buttons and a range slider only (SPEC 7.2).
import type { MapDefinition } from '@wc/engine';
import {
  contextOf,
  freeToPlace,
  maxDice,
  type SelAction,
  type SelEnv,
  type SelState,
  sliderRange,
  stagedTotal,
} from '../input/selection.ts';

export function ActionPanel(props: {
  sel: SelState;
  env: SelEnv;
  map: MapDefinition;
  locked: boolean;
  send: (a: SelAction) => void;
}) {
  const { sel, env, map, send, locked } = props;
  const ctx = contextOf(sel, env);
  const name = (id: string | null) => (id ? (map.territories[id]?.name ?? id) : '');

  if (ctx === 'placing') {
    const free = freeToPlace(sel, env);
    const here = sel.focus ? (sel.staged[sel.focus] ?? 0) : 0;
    return (
      <section className="panel" aria-label="Place armies">
        <div className="panel-title">
          {env.setup ? 'Place your starting armies' : 'Place reinforcements'}: <b>{free}</b> left
          {sel.focus ? (
            <span className="sub">
              {' '}
              · {name(sel.focus)}: +{here}
            </span>
          ) : (
            <span className="sub"> · tap a territory</span>
          )}
        </div>
        <div className="row">
          <button
            type="button"
            disabled={locked || !sel.focus || here === 0}
            onClick={() => send({ type: 'adjust', delta: -1 })}
            aria-label="Remove one army"
          >
            −
          </button>
          <button
            type="button"
            disabled={locked || !sel.focus || free === 0}
            onClick={() => send({ type: 'adjust', delta: 1 })}
            aria-label="Add one army"
          >
            +
          </button>
          <button type="button" disabled={locked || !sel.focus || free === 0} onClick={() => send({ type: 'allHere' })}>
            All here
          </button>
          <button type="button" disabled={locked || sel.history.length === 0} onClick={() => send({ type: 'undo' })}>
            Undo
          </button>
          {env.capitals && (
            <button
              type="button"
              className={sel.capitalMode ? 'on' : ''}
              aria-pressed={sel.capitalMode}
              onClick={() => send({ type: 'toggleCapital' })}
            >
              Choose capital{sel.capital ? `: ${name(sel.capital)}` : ''}
            </button>
          )}
        </div>
        {stagedTotal(sel) > 0 && free === 0 && <div className="sub">Press Confirm when ready.</div>}
      </section>
    );
  }

  if (ctx === 'attack-panel' && sel.source && sel.target) {
    const max = maxDice(env, sel.source);
    return (
      <section className="panel" aria-label="Attack">
        <div className="panel-title">
          {name(sel.source)} ({env.armies(sel.source)}) attacks {name(sel.target)} ({env.armies(sel.target)})
        </div>
        <div className="row">
          {[1, 2, 3].map((n) => (
            <button
              type="button"
              key={n}
              className={sel.dice === n ? 'on' : ''}
              aria-pressed={sel.dice === n}
              disabled={locked || n > max}
              onClick={() => send({ type: 'setDice', dice: n })}
            >
              {n} {n === 1 ? 'die' : 'dice'}
            </button>
          ))}
          <button type="button" className="primary" disabled={locked} onClick={() => send({ type: 'roll' })}>
            Roll
          </button>
          <button type="button" className="primary" disabled={locked} onClick={() => send({ type: 'blitz' })}>
            Blitz
          </button>
          <button type="button" className="ghost" onClick={() => send({ type: 'back' })}>
            Close
          </button>
        </div>
      </section>
    );
  }

  if (ctx === 'slider') {
    const range = sliderRange(sel, env);
    if (!range) return null;
    const fortify = env.mode === 'fortify';
    return (
      <section className="panel" aria-label={fortify ? 'Fortify' : 'Occupy'}>
        <div className="panel-title">
          {fortify
            ? `Move armies from ${name(sel.source)} to ${name(sel.target)}`
            : 'Move armies into the conquered territory'}
          : <b>{sel.amount}</b>
        </div>
        <div className="row">
          <button type="button" disabled={locked} onClick={() => send({ type: 'min' })}>
            Min
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => send({ type: 'adjust', delta: -1 })}
            aria-label="One fewer"
          >
            −
          </button>
          <input
            type="range"
            min={range.min}
            max={range.max}
            value={sel.amount}
            disabled={locked}
            aria-label="Armies to move"
            onChange={(e) => send({ type: 'setAmount', value: Number(e.target.value) })}
          />
          <button
            type="button"
            disabled={locked}
            onClick={() => send({ type: 'adjust', delta: 1 })}
            aria-label="One more"
          >
            +
          </button>
          <button type="button" disabled={locked} onClick={() => send({ type: 'max' })}>
            Max
          </button>
          <button type="button" className="primary" disabled={locked} onClick={() => send({ type: 'confirm' })}>
            Confirm
          </button>
          {fortify && (
            <button type="button" className="ghost" onClick={() => send({ type: 'back' })}>
              Cancel
            </button>
          )}
        </div>
      </section>
    );
  }
  return null;
}

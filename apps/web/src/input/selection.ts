// The one selection state machine (SPEC 7.2-7.4). Pure: (state, action, env) -> (state, effects).
// Pointer and keyboard adapters only translate events into SelActions; they never hold logic of their own.
import type { Command, TerritoryId } from '@wc/engine';

export type Mode =
  /** Nothing to do on the board (not your turn, waiting, game over). */
  | 'none'
  | 'draft'
  /** Reinforce, setup, or placing after a forced trade. */
  | 'place'
  | 'attack'
  | 'occupy'
  | 'fortify'
  /** A trade is required before anything else (5+ cards, or 6+ after an elimination). */
  | 'trade';

/** What the machine needs to know about the game; rebuilt from the PlayerView on every render. */
export interface SelEnv {
  /** Changes whenever staged/selected state must be thrown away (viewer, step, turn). */
  key: string;
  mode: Mode;
  /** place mode only: true = SubmitSetup, false = PlaceReinforcements. */
  setup: boolean;
  /** setup in capitals mode: the "Choose capital" toggle exists. */
  capitals: boolean;
  /** Map definition order. Context decides what this holds (see deriveEnv). */
  candidates: readonly TerritoryId[];
  /** Valid targets of a selected source (attack: enemy neighbours; fortify: own reachable). */
  targets(source: TerritoryId): readonly TerritoryId[];
  /** Armies on the board, not counting staged placements. */
  armies(t: TerritoryId): number;
  /** place mode: armies still to place (before staging). */
  remaining: number;
  /** occupy mode: the legal range. */
  occupy: { min: number; max: number } | null;
}

export interface SelState {
  forKey: string;
  focus: TerritoryId | null;
  source: TerritoryId | null;
  target: TerritoryId | null;
  staged: Readonly<Record<TerritoryId, number>>;
  history: readonly Readonly<Record<TerritoryId, number>>[];
  capital: TerritoryId | null;
  capitalMode: boolean;
  dice: 1 | 2 | 3;
  /** Slider value (occupy, fortify). */
  amount: number;
}

export type SelAction =
  | { type: 'tap'; id: TerritoryId | null } // null = empty space
  | { type: 'hover'; id: TerritoryId | null }
  | { type: 'cycle'; dir: 1 | -1 } // Tab / Shift+Tab
  | { type: 'enter' }
  | { type: 'back' } // Esc, right-click
  | { type: 'adjust'; delta: number } // placing: +-N on the focused territory; sliders: +-N
  | { type: 'allHere' } // End while placing
  | { type: 'clearHere' } // Home while placing
  | { type: 'undo' }
  | { type: 'min' } // sliders
  | { type: 'max' }
  | { type: 'setAmount'; value: number }
  | { type: 'setDice'; dice: number }
  | { type: 'roll' }
  | { type: 'blitz' }
  | { type: 'confirm' }
  | { type: 'main' } // the step bar's main button (Ctrl+Enter)
  | { type: 'toggleCapital' }
  | { type: 'reset' } // after a command was accepted
  | { type: 'sync' }; // after env changed

export type SelEffect = { type: 'command'; cmd: Command } | { type: 'releaseFocus' };

export interface SelResult {
  state: SelState;
  effects: SelEffect[];
}

/** The keyboard context of SPEC 7.4. */
export type SelContext = 'idle' | 'source' | 'placing' | 'attack-panel' | 'slider' | 'none';

/** A clean selection for env; entering occupy defaults the slider to Max (SPEC 7.3). */
function fresh(env: SelEnv): SelState {
  const s = initialSel(env.key);
  return env.occupy ? { ...s, amount: env.occupy.max } : s;
}

export function initialSel(key = ''): SelState {
  return {
    forKey: key,
    focus: null,
    source: null,
    target: null,
    staged: {},
    history: [],
    capital: null,
    capitalMode: false,
    dice: 3,
    amount: 1,
  };
}

export const stagedTotal = (s: SelState): number => Object.values(s.staged).reduce((a, b) => a + b, 0);
export const freeToPlace = (s: SelState, env: SelEnv): number => env.remaining - stagedTotal(s);
export const maxDice = (env: SelEnv, source: TerritoryId): 1 | 2 | 3 =>
  Math.max(1, Math.min(3, env.armies(source) - 1)) as 1 | 2 | 3;

export function contextOf(s: SelState, env: SelEnv): SelContext {
  switch (env.mode) {
    case 'place':
      return 'placing';
    case 'occupy':
      return 'slider';
    case 'attack':
      return s.source && s.target ? 'attack-panel' : s.source ? 'source' : 'idle';
    case 'fortify':
      return s.source && s.target ? 'slider' : s.source ? 'source' : 'idle';
    case 'draft':
      return 'idle';
    default:
      return 'none';
  }
}

/** Slider bounds for the current context, or null when no slider is open. */
export function sliderRange(s: SelState, env: SelEnv): { min: number; max: number } | null {
  if (env.mode === 'occupy') return env.occupy;
  if (env.mode === 'fortify' && s.source && s.target) return { min: 1, max: Math.max(1, env.armies(s.source) - 1) };
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function done(state: SelState, effects: SelEffect[] = []): SelResult {
  return { state, effects };
}

function listFor(s: SelState, env: SelEnv): readonly TerritoryId[] {
  if ((env.mode === 'attack' || env.mode === 'fortify') && s.source) return env.targets(s.source);
  return env.candidates;
}

function withStaged(s: SelState, staged: Record<TerritoryId, number>): SelState {
  for (const k of Object.keys(staged)) if (staged[k] <= 0) delete staged[k];
  return { ...s, staged, history: [...s.history, s.staged] };
}

function canConfirmPlacement(s: SelState, env: SelEnv): boolean {
  if (freeToPlace(s, env) !== 0 || env.remaining <= 0) return false;
  return !(env.setup && env.capitals && s.capital === null);
}

function placementCommand(s: SelState, env: SelEnv): Command {
  return env.setup
    ? { type: 'SubmitSetup', placements: { ...s.staged }, ...(env.capitals ? { capital: s.capital as string } : {}) }
    : { type: 'PlaceReinforcements', placements: { ...s.staged } };
}

function sliderCommand(s: SelState, env: SelEnv): Command | null {
  const range = sliderRange(s, env);
  if (!range) return null;
  const armies = clamp(s.amount, range.min, range.max);
  if (env.mode === 'occupy') return { type: 'Occupy', armies };
  if (s.source && s.target) return { type: 'Fortify', from: s.source, to: s.target, armies };
  return null;
}

/** Content of the step bar's main button for the current context. */
export interface MainButton {
  label: string;
  enabled: boolean;
}

export function mainButton(s: SelState, env: SelEnv): MainButton {
  switch (env.mode) {
    case 'place':
      return { label: 'Confirm', enabled: canConfirmPlacement(s, env) };
    case 'occupy':
      return { label: 'Confirm', enabled: true };
    case 'attack':
      return { label: 'End attack', enabled: true };
    case 'fortify':
      return { label: 'End turn', enabled: true };
    default:
      return { label: 'Confirm', enabled: false };
  }
}

export function reduce(s: SelState, a: SelAction, env: SelEnv): SelResult {
  switch (a.type) {
    case 'hover':
      // Placing: the selected territory is sticky, so +, - and "All here" still act on it when the pointer
      // leaves the board for the panel.
      if (env.mode === 'place') return done(s);
      return done(s.focus === a.id ? s : { ...s, focus: a.id });
    case 'tap':
      return a.id === null ? back(s, env) : tap(s, a.id, env);
    case 'cycle':
      return cycle(s, a.dir, env);
    case 'enter': {
      const ctx = contextOf(s, env);
      if (ctx === 'slider') return reduce(s, { type: 'confirm' }, env);
      if (ctx === 'attack-panel' || s.focus === null) return done(s);
      return tap(s, s.focus, env);
    }
    case 'back':
      return back(s, env);
    case 'adjust':
      return adjust(s, a.delta, env);
    case 'allHere': {
      if (env.mode !== 'place' || !s.focus || !env.candidates.includes(s.focus)) return done(s);
      const free = freeToPlace(s, env);
      if (free <= 0) return done(s);
      return done(withStaged(s, { ...s.staged, [s.focus]: (s.staged[s.focus] ?? 0) + free }));
    }
    case 'clearHere': {
      if (env.mode !== 'place' || !s.focus || !s.staged[s.focus]) return done(s);
      const staged = { ...s.staged };
      delete staged[s.focus];
      return done(withStaged(s, staged));
    }
    case 'undo': {
      if (env.mode !== 'place' || s.history.length === 0) return done(s);
      const last = s.history[s.history.length - 1];
      return done({ ...s, staged: last, history: s.history.slice(0, -1) });
    }
    case 'min':
    case 'max': {
      const range = sliderRange(s, env);
      if (!range) return done(s);
      return done({ ...s, amount: a.type === 'min' ? range.min : range.max });
    }
    case 'setAmount': {
      const range = sliderRange(s, env);
      if (!range) return done(s);
      return done({ ...s, amount: clamp(Math.round(a.value), range.min, range.max) });
    }
    case 'setDice': {
      if (contextOf(s, env) !== 'attack-panel' || !s.source) return done(s);
      if (a.dice < 1 || a.dice > 3) return done(s);
      return done({ ...s, dice: Math.min(a.dice, maxDice(env, s.source)) as 1 | 2 | 3 });
    }
    case 'roll':
    case 'blitz': {
      if (contextOf(s, env) !== 'attack-panel' || !s.source || !s.target) return done(s);
      const dice = Math.min(s.dice, maxDice(env, s.source)) as 1 | 2 | 3;
      const cmd: Command = {
        type: 'Attack',
        from: s.source,
        to: s.target,
        attackerDice: dice,
        ...(a.type === 'blitz' ? { untilConquered: true } : {}),
      };
      return done(s, [{ type: 'command', cmd }]);
    }
    case 'confirm': {
      if (env.mode === 'place') {
        return canConfirmPlacement(s, env) ? done(s, [{ type: 'command', cmd: placementCommand(s, env) }]) : done(s);
      }
      const cmd = sliderCommand(s, env);
      return cmd ? done(s, [{ type: 'command', cmd }]) : done(s);
    }
    case 'main': {
      if (env.mode === 'place' || env.mode === 'occupy') return reduce(s, { type: 'confirm' }, env);
      if (env.mode === 'attack') return done(s, [{ type: 'command', cmd: { type: 'EndAttack' } }]);
      if (env.mode === 'fortify') return done(s, [{ type: 'command', cmd: { type: 'EndTurn' } }]);
      return done(s);
    }
    case 'toggleCapital':
      return env.mode === 'place' && env.setup && env.capitals ? done({ ...s, capitalMode: !s.capitalMode }) : done(s);
    case 'reset':
      return done(fresh(env));
    case 'sync':
      return done(sync(s, env));
  }
}

function tap(s: SelState, id: TerritoryId, env: SelEnv): SelResult {
  const base: SelState = { ...s, focus: id };
  switch (env.mode) {
    case 'draft':
      return env.candidates.includes(id)
        ? done(base, [{ type: 'command', cmd: { type: 'DraftPick', territory: id } }])
        : done(base);
    case 'place': {
      if (!env.candidates.includes(id)) return done(base);
      if (base.capitalMode) return done({ ...base, capital: id });
      if (freeToPlace(base, env) <= 0) return done(base);
      return done({ ...withStaged(base, { ...base.staged, [id]: (base.staged[id] ?? 0) + 1 }), focus: id });
    }
    case 'attack':
    case 'fortify': {
      if (!base.source) {
        return env.candidates.includes(id) ? done({ ...base, source: id, target: null }) : done(base);
      }
      if (id === base.source) return done({ ...base, source: null, target: null });
      if (env.targets(base.source).includes(id)) {
        const src = base.source;
        return done({
          ...base,
          target: id,
          dice: env.mode === 'attack' ? maxDice(env, src) : base.dice,
          amount: env.mode === 'fortify' ? Math.max(1, env.armies(src) - 1) : base.amount,
        });
      }
      if (env.candidates.includes(id)) return done({ ...base, source: id, target: null });
      return done(base);
    }
    default:
      return done(base);
  }
}

function back(s: SelState, env: SelEnv): SelResult {
  if (env.mode === 'attack' || env.mode === 'fortify') {
    if (s.target) return done({ ...s, target: null });
    if (s.source) return done({ ...s, source: null });
  }
  if (env.mode === 'place' && s.capitalMode) return done({ ...s, capitalMode: false });
  return done(s, [{ type: 'releaseFocus' }]);
}

function cycle(s: SelState, dir: 1 | -1, env: SelEnv): SelResult {
  const list = listFor(s, env);
  if (list.length === 0) return done(s);
  const i = s.focus === null ? -1 : list.indexOf(s.focus);
  const next = i < 0 ? (dir === 1 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
  return done({ ...s, focus: list[next] });
}

function adjust(s: SelState, delta: number, env: SelEnv): SelResult {
  if (env.mode === 'place') {
    const f = s.focus;
    if (!f || !env.candidates.includes(f)) return done(s);
    const have = s.staged[f] ?? 0;
    const next = delta > 0 ? have + Math.min(delta, Math.max(0, freeToPlace(s, env))) : Math.max(0, have + delta);
    if (next === have) return done(s);
    return done(withStaged(s, { ...s.staged, [f]: next }));
  }
  const range = sliderRange(s, env);
  if (!range) return done(s);
  return done({ ...s, amount: clamp(s.amount + delta, range.min, range.max) });
}

/** Drops selection that no longer makes sense after the game state changed. */
function sync(s: SelState, env: SelEnv): SelState {
  if (s.forKey !== env.key) return fresh(env);
  let next = s;
  if (env.mode === 'attack' || env.mode === 'fortify') {
    if (next.source && !env.candidates.includes(next.source)) next = { ...next, source: null, target: null };
    if (next.source && next.target && !env.targets(next.source).includes(next.target)) next = { ...next, target: null };
    if (next.source && next.target && env.mode === 'attack') {
      const dice = Math.min(next.dice, maxDice(env, next.source)) as 1 | 2 | 3;
      if (dice !== next.dice) next = { ...next, dice };
    }
  }
  if (env.mode === 'occupy' && env.occupy) {
    const amount = next.amount < env.occupy.min || next.amount > env.occupy.max ? env.occupy.max : next.amount;
    if (amount !== next.amount) next = { ...next, amount };
  }
  return next;
}

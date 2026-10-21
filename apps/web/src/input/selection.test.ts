import { describe, expect, it } from 'vitest';
import { keyToAction } from './keyboard.ts';
import {
  contextOf,
  initialSel,
  type Mode,
  mainButton,
  reduce,
  type SelAction,
  type SelEffect,
  type SelEnv,
  type SelState,
} from './selection.ts';

// A tiny line map: a - b - c - d, with armies, to drive every context without a full game.
const ARMIES: Record<string, number> = { a: 5, b: 2, c: 1, d: 4 };
const NEIGH: Record<string, string[]> = { a: ['b'], b: ['a', 'c'], c: ['b', 'd'], d: ['c'] };

function env(mode: Mode, over: Partial<SelEnv> = {}): SelEnv {
  const candidates = mode === 'attack' ? ['a', 'b'] : mode === 'fortify' ? ['a', 'b'] : ['a', 'b', 'c', 'd'];
  return {
    key: `k-${mode}`,
    mode,
    setup: false,
    capitals: false,
    candidates,
    targets: (s) => (mode === 'attack' ? NEIGH[s].filter((n) => n !== 'a') : mode === 'fortify' ? ['b', 'c', 'd'] : []),
    armies: (t) => ARMIES[t],
    remaining: 5,
    occupy: mode === 'occupy' ? { min: 2, max: 6 } : null,
    ...over,
  };
}

function run(e: SelEnv, actions: SelAction[], from: SelState = initialSel(e.key)) {
  let s = from;
  const effects: SelEffect[] = [];
  for (const a of actions) {
    const r = reduce(s, a, e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { s, effects };
}

const tap = (id: string): SelAction => ({ type: 'tap', id });

describe('candidates (Tab / Shift+Tab)', () => {
  it('cycles all candidates before a selection, in map order, wrapping', () => {
    const e = env('place');
    expect(run(e, [{ type: 'cycle', dir: 1 }]).s.focus).toBe('a');
    expect(run(e, Array(4).fill({ type: 'cycle', dir: 1 })).s.focus).toBe('d');
    expect(run(e, Array(5).fill({ type: 'cycle', dir: 1 })).s.focus).toBe('a');
    expect(run(e, [{ type: 'cycle', dir: -1 }]).s.focus).toBe('d');
  });

  it('attack: only sources with a target before selection, only targets after', () => {
    const e = env('attack');
    expect(
      run(e, [
        { type: 'cycle', dir: 1 },
        { type: 'cycle', dir: 1 },
        { type: 'cycle', dir: 1 },
      ]).s.focus,
    ).toBe('a');
    const { s } = run(e, [tap('b'), { type: 'cycle', dir: 1 }]);
    expect(s.focus).toBe('c'); // b's targets are [c] (a is excluded in this fixture)
    expect(run(e, [tap('b'), { type: 'cycle', dir: 1 }, { type: 'cycle', dir: 1 }]).s.focus).toBe('c');
  });

  it('fortify and draft use their own candidate lists', () => {
    const f = env('fortify');
    expect(run(f, [tap('a'), { type: 'cycle', dir: -1 }]).s.focus).toBe('d');
    const d = env('draft', { candidates: ['c', 'd'] });
    expect(run(d, [{ type: 'cycle', dir: 1 }]).s.focus).toBe('c');
    expect(run(d, [tap('c')]).effects).toEqual([{ type: 'command', cmd: { type: 'DraftPick', territory: 'c' } }]);
    expect(run(d, [tap('a')]).effects).toEqual([]);
  });

  it('does nothing when there are no candidates', () => {
    expect(run(env('none', { candidates: [] }), [{ type: 'cycle', dir: 1 }]).s.focus).toBeNull();
  });
});

describe('Enter / Esc levels', () => {
  const e = env('attack');
  it('Enter acts like tapping the focused territory', () => {
    const { s } = run(e, [{ type: 'cycle', dir: 1 }, { type: 'enter' }]);
    expect(s.source).toBe('a');
  });

  it('Esc steps back target -> source -> nothing -> release focus', () => {
    const { s: s1 } = run(e, [tap('b'), tap('c')]);
    expect([s1.source, s1.target]).toEqual(['b', 'c']);
    const r1 = reduce(s1, { type: 'back' }, e);
    expect([r1.state.source, r1.state.target]).toEqual(['b', null]);
    const r2 = reduce(r1.state, { type: 'back' }, e);
    expect([r2.state.source, r2.state.target]).toEqual([null, null]);
    expect(r2.effects).toEqual([]);
    const r3 = reduce(r2.state, { type: 'back' }, e);
    expect(r3.effects).toEqual([{ type: 'releaseFocus' }]);
  });

  it('tapping empty space and right-click are back', () => {
    const { s } = run(e, [tap('b'), tap('c')]);
    expect(reduce(s, { type: 'tap', id: null }, e).state.target).toBeNull();
    expect(reduce(s, { type: 'back' }, e).state.target).toBeNull();
  });

  it('tapping the source again deselects; tapping another candidate switches source', () => {
    expect(run(e, [tap('b'), tap('b')]).s.source).toBeNull();
    expect(run(e, [tap('b'), tap('a')]).s.source).toBe('a');
  });

  it('Esc in placing with capital mode leaves the mode first', () => {
    const c = env('place', { setup: true, capitals: true });
    const { s } = run(c, [{ type: 'toggleCapital' }]);
    expect(s.capitalMode).toBe(true);
    const r = reduce(s, { type: 'back' }, c);
    expect(r.state.capitalMode).toBe(false);
    expect(r.effects).toEqual([]);
  });
});

describe('placing', () => {
  const e = env('place', { remaining: 6 });
  it('tap adds 1 up to the remaining count', () => {
    const { s } = run(e, Array(8).fill(tap('a')));
    expect(s.staged).toEqual({ a: 6 });
  });

  it('up/down adjust by 1 and 5 (clamped); End = all here; Home = clear; undo steps back', () => {
    let { s } = run(e, [tap('b'), { type: 'adjust', delta: 1 }]);
    expect(s.staged.b).toBe(2);
    ({ s } = run(e, [{ type: 'adjust', delta: 5 }], s));
    expect(s.staged.b).toBe(6); // clamped by remaining
    ({ s } = run(e, [{ type: 'adjust', delta: -5 }], s));
    expect(s.staged.b).toBe(1);
    ({ s } = run(e, [{ type: 'adjust', delta: -1 }], s));
    expect(s.staged.b).toBeUndefined();
    ({ s } = run(e, [{ type: 'allHere' }], s));
    expect(s.staged.b).toBe(6);
    ({ s } = run(e, [{ type: 'clearHere' }], s));
    expect(s.staged).toEqual({});
    ({ s } = run(e, [{ type: 'undo' }], s));
    expect(s.staged.b).toBe(6);
    ({ s } = run(e, [{ type: 'undo' }, { type: 'undo' }], s));
    expect(s.staged.b).toBe(1);
  });

  it('adjust only touches the focused owned territory', () => {
    expect(run(e, [{ type: 'adjust', delta: 1 }]).s.staged).toEqual({});
    expect(
      run(env('place', { candidates: ['a'] }), [
        { type: 'hover', id: 'b' },
        { type: 'adjust', delta: 1 },
      ]).s.staged,
    ).toEqual({});
  });

  it('Confirm needs everything placed, then sends one PlaceReinforcements', () => {
    const { s } = run(e, [tap('a'), { type: 'confirm' }]);
    expect(mainButton(s, e).enabled).toBe(false);
    const full = run(e, [tap('a'), { type: 'allHere' }, { type: 'main' }]);
    expect(full.effects).toEqual([{ type: 'command', cmd: { type: 'PlaceReinforcements', placements: { a: 6 } } }]);
    expect(mainButton(full.s, e)).toEqual({ label: 'Confirm', enabled: true });
  });

  it('setup in capitals mode needs a capital and sends SubmitSetup', () => {
    const c = env('place', { setup: true, capitals: true, remaining: 2 });
    let r = run(c, [tap('a'), tap('a'), { type: 'confirm' }]);
    expect(r.effects).toEqual([]);
    r = run(c, [tap('a'), tap('a'), { type: 'toggleCapital' }, tap('b'), { type: 'confirm' }]);
    expect(r.s.capital).toBe('b');
    expect(r.s.staged).toEqual({ a: 2 }); // capital taps never add armies
    expect(r.effects).toEqual([{ type: 'command', cmd: { type: 'SubmitSetup', placements: { a: 2 }, capital: 'b' } }]);
  });

  it('toggleCapital is ignored outside capitals setup', () => {
    expect(run(e, [{ type: 'toggleCapital' }]).s.capitalMode).toBe(false);
  });
});

describe('attack panel', () => {
  const e = env('attack');
  it('opens on a target with max dice and caps dice at armies - 1', () => {
    const a = run(e, [tap('a'), tap('b')]);
    // a has 5 armies, but b is the only target in the fixture for source a
    expect(contextOf(a.s, e)).toBe('attack-panel');
    expect(a.s.dice).toBe(3);
    const b = run(e, [tap('b'), tap('c')]); // b has 2 armies -> max 1 die
    expect(b.s.dice).toBe(1);
    expect(run(e, [{ type: 'setDice', dice: 3 }], b.s).s.dice).toBe(1);
  });

  it('1/2/3 set dice, Space rolls, B blitzes; the panel stays open', () => {
    const open = run(e, [tap('a'), tap('b')]).s;
    const s2 = run(e, [{ type: 'setDice', dice: 2 }], open).s;
    expect(s2.dice).toBe(2);
    const roll = reduce(s2, { type: 'roll' }, e);
    expect(roll.effects).toEqual([{ type: 'command', cmd: { type: 'Attack', from: 'a', to: 'b', attackerDice: 2 } }]);
    expect(contextOf(roll.state, e)).toBe('attack-panel');
    const blitz = reduce(s2, { type: 'blitz' }, e);
    expect(blitz.effects).toEqual([
      { type: 'command', cmd: { type: 'Attack', from: 'a', to: 'b', attackerDice: 2, untilConquered: true } },
    ]);
  });

  it('roll and blitz do nothing without the panel', () => {
    expect(run(e, [tap('a'), { type: 'roll' }]).effects).toEqual([]);
    expect(run(e, [{ type: 'blitz' }]).effects).toEqual([]);
  });

  it('the main button is End attack', () => {
    expect(mainButton(initialSel(), e).label).toBe('End attack');
    expect(run(e, [{ type: 'main' }]).effects).toEqual([{ type: 'command', cmd: { type: 'EndAttack' } }]);
  });

  it('sync drops a selection that is no longer valid', () => {
    const open = run(e, [tap('a'), tap('b')]).s;
    const gone = env('attack', { candidates: ['b'], key: e.key });
    const s = reduce(open, { type: 'sync' }, gone).state;
    expect([s.source, s.target]).toEqual([null, null]);
    const other = env('occupy', { key: 'other' });
    expect(reduce(open, { type: 'sync' }, other).state.forKey).toBe('other');
  });
});

describe('sliders', () => {
  it('occupy defaults to Max, clamps, and confirms', () => {
    const e = env('occupy');
    let s = reduce(initialSel('x'), { type: 'sync' }, e).state;
    expect(s.amount).toBe(6);
    expect(contextOf(s, e)).toBe('slider');
    s = run(e, [{ type: 'adjust', delta: -1 }], s).s;
    expect(s.amount).toBe(5);
    s = run(e, [{ type: 'adjust', delta: -5 }], s).s;
    expect(s.amount).toBe(2); // clamped to min
    s = run(e, [{ type: 'max' }], s).s;
    expect(s.amount).toBe(6);
    s = run(e, [{ type: 'min' }], s).s;
    expect(s.amount).toBe(2);
    s = run(e, [{ type: 'setAmount', value: 99 }], s).s;
    expect(s.amount).toBe(6);
    expect(reduce(s, { type: 'enter' }, e).effects).toEqual([{ type: 'command', cmd: { type: 'Occupy', armies: 6 } }]);
    expect(reduce(s, { type: 'main' }, e).effects).toEqual([{ type: 'command', cmd: { type: 'Occupy', armies: 6 } }]);
  });

  it('occupy cannot be cancelled with Esc', () => {
    const e = env('occupy');
    const r = reduce(initialSel('x'), { type: 'back' }, e);
    expect(r.effects).toEqual([{ type: 'releaseFocus' }]);
    expect(contextOf(r.state, e)).toBe('slider');
  });

  it('fortify: source, target, slider defaults to all but one, confirm sends Fortify', () => {
    const e = env('fortify');
    const open = run(e, [tap('a'), tap('c')]).s;
    expect(contextOf(open, e)).toBe('slider');
    expect(open.amount).toBe(4);
    const s = run(e, [{ type: 'adjust', delta: -5 }], open).s;
    expect(s.amount).toBe(1);
    expect(reduce(s, { type: 'confirm' }, e).effects).toEqual([
      { type: 'command', cmd: { type: 'Fortify', from: 'a', to: 'c', armies: 1 } },
    ]);
    expect(reduce(s, { type: 'main' }, e).effects).toEqual([{ type: 'command', cmd: { type: 'EndTurn' } }]);
  });

  it('adjusting without a slider does nothing', () => {
    const e = env('attack');
    expect(run(e, [{ type: 'adjust', delta: 1 }]).s.amount).toBe(1);
  });
});

describe('other modes', () => {
  it('trade and none modes ignore the board', () => {
    for (const m of ['trade', 'none'] as const) {
      const e = env(m);
      expect(contextOf(initialSel(), e)).toBe('none');
      expect(run(e, [tap('a')]).effects).toEqual([]);
      expect(mainButton(initialSel(), e).enabled).toBe(false);
    }
  });

  it('reset clears staging after an accepted command', () => {
    const e = env('place');
    const { s } = run(e, [tap('a'), { type: 'reset' }]);
    expect(s.staged).toEqual({});
    expect(s.history).toEqual([]);
  });
});

describe('keyboard adapter (SPEC 7.4 table)', () => {
  const k = (
    key: string,
    extra: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'code', unknown>> = {},
  ) => ({
    key,
    code: key === ' ' ? 'Space' : key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...extra,
  });
  const a = (key: string, context: Parameters<typeof keyToAction>[1]['context'], boardFocused = true, extra = {}) =>
    keyToAction(k(key, extra) as Parameters<typeof keyToAction>[0], { context, boardFocused });

  it('board focus: Tab, Shift+Tab, Enter, Esc', () => {
    expect(a('Tab', 'idle')).toEqual({ type: 'cycle', dir: 1 });
    expect(a('Tab', 'source', true, { shiftKey: true })).toEqual({ type: 'cycle', dir: -1 });
    expect(a('Enter', 'idle')).toEqual({ type: 'enter' });
    expect(a('Escape', 'source')).toEqual({ type: 'back' });
    expect(a('Tab', 'idle', false)).toBeNull();
    expect(a('Tab', 'none')).toBeNull();
  });

  it('placing: arrows, Shift+arrows, End, Home, Ctrl+Z', () => {
    expect(a('ArrowUp', 'placing')).toEqual({ type: 'adjust', delta: 1 });
    expect(a('ArrowDown', 'placing', true, { shiftKey: true })).toEqual({ type: 'adjust', delta: -5 });
    expect(a('End', 'placing')).toEqual({ type: 'allHere' });
    expect(a('Home', 'placing')).toEqual({ type: 'clearHere' });
    expect(a('z', 'placing', true, { ctrlKey: true })).toEqual({ type: 'undo' });
    expect(a('ArrowUp', 'idle')).toBeNull();
  });

  it('attack panel: 1/2/3, Space, B, Esc, even without board focus', () => {
    expect(a('2', 'attack-panel', false)).toEqual({ type: 'setDice', dice: 2 });
    expect(a(' ', 'attack-panel', false)).toEqual({ type: 'roll' });
    expect(a('b', 'attack-panel', false)).toEqual({ type: 'blitz' });
    expect(a('Escape', 'attack-panel', false)).toEqual({ type: 'back' });
    expect(a('2', 'source', false)).toBeNull();
  });

  it('sliders: arrows, Shift+arrows, Home/End, Enter', () => {
    expect(a('ArrowRight', 'slider', false)).toEqual({ type: 'adjust', delta: 1 });
    expect(a('ArrowDown', 'slider', false)).toEqual({ type: 'adjust', delta: -1 });
    expect(a('ArrowLeft', 'slider', false, { shiftKey: true })).toEqual({ type: 'adjust', delta: -5 });
    expect(a('Home', 'slider', false)).toEqual({ type: 'min' });
    expect(a('End', 'slider', false)).toEqual({ type: 'max' });
    expect(a('Enter', 'slider', false)).toEqual({ type: 'enter' });
  });

  it('global: Ctrl+Enter is the main button, C opens cards', () => {
    expect(a('Enter', 'idle', false, { ctrlKey: true })).toEqual({ type: 'main' });
    expect(a('Enter', 'none', false, { metaKey: true })).toEqual({ type: 'main' });
    expect(a('c', 'idle', false)).toEqual({ type: 'cards' });
    expect(a('C', 'none', false)).toEqual({ type: 'cards' });
  });
});

describe('placement: select and stay (note 3)', () => {
  it('a tap places one army and keeps the territory selected', () => {
    const e = env('place');
    const { s } = run(e, [tap('b')]);
    expect(s.focus).toBe('b');
    expect(s.staged).toEqual({ b: 1 });
  });

  it('the pointer leaving the board or crossing other territories does not drop the selection', () => {
    const e = env('place');
    const { s } = run(e, [tap('b'), { type: 'hover', id: 'c' }, { type: 'hover', id: null }]);
    expect(s.focus).toBe('b');
  });

  it('All here then puts every remaining army on the selected territory', () => {
    const e = env('place', { remaining: 5 });
    const { s } = run(e, [tap('b'), { type: 'hover', id: null }, { type: 'allHere' }]);
    expect(s.staged).toEqual({ b: 5 });
    expect(mainButton(s, e).enabled).toBe(true);
  });

  it('minus returns armies to the pool, never below what was staged this step', () => {
    const e = env('place', { remaining: 3 });
    let r = run(e, [tap('a'), tap('b'), tap('b')]);
    expect(r.s.staged).toEqual({ a: 1, b: 2 });
    r = run(e, [{ type: 'adjust', delta: -1 }], r.s);
    expect(r.s.staged).toEqual({ a: 1, b: 1 });
    r = run(
      e,
      [
        { type: 'adjust', delta: -1 },
        { type: 'adjust', delta: -1 },
        { type: 'adjust', delta: -1 },
      ],
      r.s,
    );
    expect(r.s.staged).toEqual({ a: 1 });
    expect(r.s.focus).toBe('b');
    expect(mainButton(r.s, e).enabled).toBe(false);
  });
});

describe('feed and dice shortcuts (notes 1 and 4)', () => {
  const key = (k: string) => ({ key: k, code: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
  it('L toggles the whole sidebar in every context', () => {
    for (const context of ['idle', 'source', 'placing', 'attack-panel', 'slider', 'none'] as const) {
      expect(keyToAction(key('l'), { context, boardFocused: false })).toEqual({ type: 'sidebar' });
      expect(keyToAction(key('L'), { context, boardFocused: true })).toEqual({ type: 'sidebar' });
    }
  });
  it('Ctrl+L is left to the browser', () => {
    expect(keyToAction({ ...key('l'), ctrlKey: true }, { context: 'idle', boardFocused: true })).toBeNull();
  });
  it('Esc closes the dice result first, then works as before', () => {
    expect(keyToAction(key('Escape'), { context: 'attack-panel', boardFocused: false, diceOpen: true })).toEqual({
      type: 'closeDice',
    });
    expect(keyToAction(key('Escape'), { context: 'attack-panel', boardFocused: false })).toEqual({ type: 'back' });
  });
});

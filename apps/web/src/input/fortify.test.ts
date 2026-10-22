// Regression: after a fortify the turn must still be endable (the main button was disabled because the
// fortify step with `fortified: true` mapped to mode "none").
import { type Color, connectedOwned, type PlayerView } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import { LocalGame } from '../local/controller.ts';
import { randomMove } from '../local/randomMoves.ts';
import { memoryStore } from '../local/store.ts';
import { deriveEnv } from './env.ts';
import { initialSel, mainButton, reduce } from './selection.ts';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COLORS: Color[] = ['crimson', 'cobalt', 'jade'];
const players = [0, 1, 2].map((i) => ({ name: `P${i + 1}`, color: COLORS[i] }));

function fortifyMove(g: LocalGame, view: PlayerView, me: number) {
  const terr = view.territories;
  for (const from of Object.keys(terr)) {
    if (terr[from].owner !== me || terr[from].armies < 2) continue;
    const to = [...connectedOwned(g.map, terr, me, from)].find((t) => t !== from);
    if (to) return { from, to, max: terr[from].armies - 1 };
  }
  return null;
}

/** Plays random moves until the acting player is at the attack step with a legal fortify available. */
async function toAttackStepWithFortify(seed: number) {
  const rnd = mulberry(seed);
  const g = await LocalGame.create(memoryStore(), players, 'classic', { rng: rnd });
  for (let i = 0; i < 5000; i++) {
    if (g.needsPass()) g.confirmPass();
    const me = g.actingSeat() as number;
    const view = g.getView();
    const p = view.phase;
    if (p.kind === 'turn' && p.step === 'attack' && !p.pendingOccupy && !p.forcedTrade) {
      const f = fortifyMove(g, view, me);
      if (f) return { g, me, f };
    }
    const r = g.dispatch(randomMove(view, g.map, me, rnd));
    if (!r.ok) throw new Error(r.error.message);
  }
  throw new Error('no fortify opportunity');
}

/** What the UI does: derive env from the view, press the step bar's main button, run the command. */
function pressMain(g: LocalGame) {
  const env = deriveEnv(g.getView(), g.map);
  const sel = initialSel(env.key);
  const main = mainButton(sel, env);
  expect(main.enabled).toBe(true);
  expect(main.label).toBe('End turn');
  const r = reduce(sel, { type: 'main' }, env);
  expect(r.effects).toEqual([{ type: 'command', cmd: { type: 'EndTurn' } }]);
  expect(g.dispatch({ type: 'EndTurn' }).ok).toBe(true);
}

describe('fortify then End turn', () => {
  it('after EndAttack, fortify with the slider at max', async () => {
    const { g, me, f } = await toAttackStepWithFortify(21);
    expect(g.dispatch({ type: 'EndAttack' }).ok).toBe(true);
    expect(deriveEnv(g.getView(), g.map).mode).toBe('fortify');
    expect(g.dispatch({ type: 'Fortify', from: f.from, to: f.to, armies: f.max }).ok).toBe(true);
    const after = deriveEnv(g.getView(), g.map);
    expect(after.mode).toBe('fortify');
    expect(after.candidates).toEqual([]);
    pressMain(g);
    expect(g.actingSeat()).not.toBe(me);
  });

  it('after EndAttack, fortify with the slider at min', async () => {
    const { g, f } = await toAttackStepWithFortify(22);
    g.dispatch({ type: 'EndAttack' });
    g.dispatch({ type: 'Fortify', from: f.from, to: f.to, armies: 1 });
    pressMain(g);
  });

  it('fortify straight from the attack step', async () => {
    const { g, f } = await toAttackStepWithFortify(23);
    expect(g.dispatch({ type: 'Fortify', from: f.from, to: f.to, armies: f.max }).ok).toBe(true);
    expect(g.getView().phase).toMatchObject({ step: 'fortify', fortified: true });
    pressMain(g);
  });

  it('End turn without fortifying, from the fortify step and from the attack step', async () => {
    const a = await toAttackStepWithFortify(24);
    a.g.dispatch({ type: 'EndAttack' });
    pressMain(a.g);
    const b = await toAttackStepWithFortify(25);
    expect(b.g.dispatch({ type: 'EndTurn' }).ok).toBe(true);
  });
});

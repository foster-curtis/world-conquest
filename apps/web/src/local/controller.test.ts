import 'fake-indexeddb/auto';
import { classicMap, type Color, type WinCondition } from '@wc/engine';
import { describe, expect, it } from 'vitest';
import { LocalGame } from './controller.ts';
import { randomMove } from './randomMoves.ts';
import { idbStore, memoryStore, type SaveStore } from './store.ts';

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

const COLORS: Color[] = ['red', 'blue', 'green', 'yellow', 'purple', 'black'];
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, color: COLORS[i] }));

/** Plays like the UI would: pass screen, then one command at a time from the acting seat's view. */
function step(g: LocalGame, rnd: () => number) {
  if (g.needsPass()) g.confirmPass();
  const me = g.actingSeat() as number;
  const view = g.getView();
  // Rendering rule: only the acting seat's hand reaches the UI.
  for (const s of view.seats) if (s.seat !== me) expect(s.hand).toBeNull();
  expect(view).not.toHaveProperty('deck');
  expect(view).not.toHaveProperty('hiddenSetup');
  const r = g.dispatch(randomMove(view, g.map, me, rnd));
  if (!r.ok) throw new Error(`rejected: ${r.error.code} ${r.error.message}`);
}

async function playOut(g: LocalGame, rnd: () => number, maxSteps = 30_000) {
  for (let i = 0; !g.over; i++) {
    if (i > maxSteps) throw new Error('no winner');
    step(g, rnd);
  }
}

describe('local controller', () => {
  const cases: [string, number, WinCondition, number][] = [
    ['2 players + neutral', 2, 'classic', 11],
    ['6 players', 6, 'classic', 12],
    ['capitals, 3 players', 3, 'capitals', 13],
    ['capitals, 2 players + neutral', 2, 'capitals', 14],
  ];
  for (const [name, n, win, seed] of cases) {
    it(`plays ${name} to game_over and saves every event`, async () => {
      const store = memoryStore();
      const rnd = mulberry(seed);
      const g = await LocalGame.create(store, players(n), win, { rng: rnd });
      await playOut(g, rnd);
      await g.flush();
      const saved = await store.load(g.id);
      expect(saved?.events).toEqual(g.events);
      expect(saved?.meta.status).toBe('finished');
      expect(saved?.meta.winner).not.toBeNull();
      expect(g.settings.winCondition).toBe(win);
    }, 60_000);
  }

  it('shows a pass screen before every setup turn and every turn', async () => {
    const rnd = mulberry(5);
    const g = await LocalGame.create(memoryStore(), players(3), 'classic', { rng: rnd });
    const seen: string[] = [];
    while (!g.over && seen.length < 40) {
      expect(g.needsPass()).toBe(true);
      seen.push(`${g.phaseKind}:${g.actingSeat()}`);
      g.confirmPass();
      expect(g.needsPass()).toBe(false);
      const me = g.actingSeat() as number;
      // act until the acting player changes
      while (g.actingSeat() === me && !g.over) {
        const r = g.dispatch(randomMove(g.getView(), g.map, me, rnd));
        if (!r.ok) throw new Error(r.error.message);
        if (g.phaseKind === 'turn') expect(g.needsPass()).toBe(g.actingSeat() !== me);
      }
    }
    expect(seen.slice(0, 3).every((s) => s.startsWith('setup'))).toBe(true);
  });

  it('spectator view at game over', async () => {
    const rnd = mulberry(21);
    const g = await LocalGame.create(memoryStore(), players(2), 'classic', { rng: rnd });
    await playOut(g, rnd);
    expect(g.getView().viewer).toBeNull();
    for (const s of g.getView().seats) expect(s.hand).toBeNull();
  });

  async function resumeCheck(store: SaveStore) {
    const rnd = mulberry(7);
    const g = await LocalGame.create(store, players(4), 'classic', { rng: rnd });
    for (let i = 0; i < 120; i++) step(g, rnd);
    await g.flush();
    const r = await LocalGame.resume(store, g.id, { rng: rnd });
    expect(r).not.toBeNull();
    const g2 = r as LocalGame;
    expect(g2.events).toEqual(g.events);
    expect(g2.actingSeat()).toBe(g.actingSeat());
    expect(g2.getView()).toEqual(g.getView());
    expect(g2.needsPass()).toBe(true);
    await playOut(g2, rnd);
    await g2.flush();
    const done = await store.load(g.id);
    expect(done?.meta.status).toBe('finished');
    expect((await store.list()).map((m) => m.id)).toContain(g.id);
    await store.remove(g.id);
    expect(await store.load(g.id)).toBeNull();
  }

  it('resumes from a memory save', () => resumeCheck(memoryStore()), 60_000);
  it('resumes from an IndexedDB save', async () => resumeCheck(await idbStore()), 60_000);

  it('uses the classic map', async () => {
    const g = await LocalGame.create(memoryStore(), players(2), 'classic');
    expect(g.map).toBe(classicMap);
  });
});

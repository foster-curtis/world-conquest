// §5.3 checks, run against the committed outputs (no network, no build).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Layout, parseBoard, runChecks, touchingPairs } from './checks.ts';
import { loadClassic } from './mapdef.ts';

const dir = resolve(import.meta.dirname, '../../apps/web/src/board');
const board = parseBoard(readFileSync(resolve(dir, 'board.svg'), 'utf8'));
const layout = JSON.parse(readFileSync(resolve(dir, 'layout.json'), 'utf8')) as Layout;
const { def } = await loadClassic();

describe('board.svg + layout.json vs the classic map', () => {
  it('passes every §5.3 build-time check', () => {
    expect(runChecks(def, board, layout)).toEqual([]);
  });

  it('has exactly one path per territory, grouped by continent', () => {
    const ids = board.groups.flatMap((g) => g.paths.map((p) => p.id));
    expect(ids.length).toBe(42);
    expect(new Set(ids).size).toBe(42);
    expect(board.groups.map((g) => g.id)).toEqual(def.continents.map((c) => c.id));
  });

  it('every land-touching pair is adjacent', () => {
    const adj = new Set(def.borders.map((b) => `${b.a}|${b.b}`));
    for (const p of touchingPairs(board)) expect(adj.has(p), p).toBe(true);
  });

  it('every adjacent non-touching pair has a sea link', () => {
    const touch = touchingPairs(board);
    const links = new Set(layout.seaLinks.map((l) => [l.a, l.b].sort().join('|')));
    for (const b of def.borders.filter((x) => !x.wrap && !touch.has(`${x.a}|${x.b}`))) {
      expect(links.has(`${b.a}|${b.b}`), `${b.a}-${b.b}`).toBe(true);
    }
  });

  it('Alaska–Kamchatka is the only wrap link, drawn as two edge stubs', () => {
    expect(layout.wrapLinks).toHaveLength(1);
    const w = layout.wrapLinks[0];
    expect([w?.a, w?.b].sort()).toEqual(['alaska', 'kamchatka']);
    expect(w?.stubs.map((s) => s.to[0]).sort((a, b) => a - b)).toEqual([0, layout.width]);
  });

  it('has an anchor for all 42 territories', () => {
    expect(Object.keys(layout.anchors).sort()).toEqual([...def.territories].sort());
  });
});

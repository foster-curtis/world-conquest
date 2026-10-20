// §5.3 build-time checks, shared by build.ts and the tests. They read the *outputs* (board.svg, layout.json).
import type { MapDef } from './mapdef.ts';

export type Pt = [number, number];

export interface Layout {
  width: number;
  height: number;
  anchors: Record<string, Pt>;
  /**
   * Adjacent-but-not-touching pairs. `from` lies on `a`, `to` lies on `b`. When `via` is present the link is a
   * quadratic curve with `via` as its control point (SVG `M from Q via to`); otherwise a straight line.
   */
  seaLinks: { a: string; b: string; from: Pt; to: Pt; via?: Pt }[];
  /** Alaska–Kamchatka: two stubs, each from its territory to the left/right map edge (§5.4). */
  wrapLinks: { a: string; b: string; stubs: { territory: string; from: Pt; to: Pt }[] }[];
}

export interface Board {
  width: number;
  height: number;
  groups: { id: string; paths: { id: string; rings: Pt[][] }[] }[];
}

/** Parses the restricted SVG that build.ts writes (absolute M/L/Z only). */
export function parseBoard(svg: string): Board {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const groups: Board['groups'] = [];
  for (const g of svg.matchAll(/<g id="([a-z_]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const paths: Board['groups'][number]['paths'] = [];
    for (const p of g[2]?.matchAll(/<path id="([a-z_]+)"[^>]*\sd="([^"]*)"/g) ?? []) {
      const rings: Pt[][] = [];
      for (const sub of (p[2] ?? '').split('M').slice(1)) {
        const nums = sub
          .replace(/[LZ]/g, ' ')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        const ring: Pt[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) ring.push([nums[i] as number, nums[i + 1] as number]);
        rings.push(ring);
      }
      paths.push({ id: p[1] as string, rings });
    }
    groups.push({ id: g[1] as string, paths });
  }
  return { width: Number(vb?.[1]), height: Number(vb?.[2]), groups };
}

const key = (a: Pt, b: Pt) => {
  const ka = `${a[0]},${a[1]}`;
  const kb = `${b[0]},${b[1]}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
};

/**
 * Two territories "touch" when their shapes share at least one boundary segment (identical consecutive vertices).
 * mapshaper simplifies shared arcs once, so neighbouring borders are vertex-identical after export.
 */
export function touchingPairs(board: Board): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const g of board.groups) {
    for (const p of g.paths) {
      for (const ring of p.rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i] as Pt;
          const b = ring[(i + 1) % ring.length] as Pt;
          if (a[0] === b[0] && a[1] === b[1]) continue;
          const k = key(a, b);
          const s = owners.get(k) ?? new Set<string>();
          owners.set(k, s);
          s.add(p.id);
        }
      }
    }
  }
  const pairs = new Set<string>();
  for (const s of owners.values()) {
    if (s.size < 2) continue;
    const ids = [...s].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.add(`${ids[i]}|${ids[j]}`);
  }
  return pairs;
}

/** Returns a list of human-readable problems; empty means every §5.3 check passes. */
export function runChecks(def: MapDef, board: Board, layout: Layout): string[] {
  const errs: string[] = [];
  const ids = new Set(def.territories);

  // Exactly one <path> per territory, grouped by continent.
  const seen = new Map<string, number>();
  for (const g of board.groups) {
    if (!def.continents.some((c) => c.id === g.id)) errs.push(`unknown group <g id="${g.id}">`);
    for (const p of g.paths) {
      seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
      if (def.continentOf[p.id] !== g.id)
        errs.push(`path ${p.id} is in group ${g.id}, expected ${def.continentOf[p.id]}`);
      if (p.rings.length === 0 || p.rings.some((r) => r.length < 3)) errs.push(`path ${p.id} has a degenerate ring`);
    }
  }
  for (const t of ids) if (seen.get(t) !== 1) errs.push(`territory ${t} has ${seen.get(t) ?? 0} paths, expected 1`);
  for (const t of seen.keys()) if (!ids.has(t)) errs.push(`path ${t} is not a territory`);

  // Anchors for all territories, inside the board.
  for (const t of ids) {
    const a = layout.anchors[t];
    if (!a) errs.push(`missing anchor for ${t}`);
    else if (a[0] < 0 || a[0] > layout.width || a[1] < 0 || a[1] > layout.height)
      errs.push(`anchor for ${t} is off-board`);
  }

  // Touching <-> adjacency.
  const touch = touchingPairs(board);
  const adj = new Set(def.borders.map((b) => `${b.a}|${b.b}`));
  const wrap = def.borders.filter((b) => b.wrap);
  const links = new Set(layout.seaLinks.map((l) => (l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`)));
  for (const p of touch) if (!adj.has(p)) errs.push(`${p.replace('|', ' and ')} touch but are not adjacent`);
  for (const b of def.borders) {
    const k = `${b.a}|${b.b}`;
    if (b.wrap) continue;
    if (!touch.has(k) && !links.has(k)) errs.push(`${b.a}-${b.b} are adjacent, do not touch, and have no sea link`);
    if (touch.has(k) && links.has(k)) errs.push(`${b.a}-${b.b} touch but also have a sea link`);
  }
  for (const k of links) if (!adj.has(k)) errs.push(`sea link ${k} is not an adjacent pair`);
  if (links.size !== layout.seaLinks.length) errs.push('duplicate sea links');

  // Alaska–Kamchatka is the only wrap link: two edge stubs.
  if (layout.wrapLinks.length !== wrap.length)
    errs.push(`expected ${wrap.length} wrap link(s), got ${layout.wrapLinks.length}`);
  for (const w of wrap) {
    const l = layout.wrapLinks.find((x) => [x.a, x.b].sort().join('|') === `${w.a}|${w.b}`);
    if (!l) {
      errs.push(`missing wrap link ${w.a}-${w.b}`);
      continue;
    }
    if (l.stubs.length !== 2) errs.push('wrap link needs exactly two stubs');
    const xs = l.stubs.map((s) => s.to[0]).sort((p, q) => p - q);
    if (xs[0] !== 0 || xs[1] !== layout.width) errs.push('wrap stubs must end on the left and right map edges');
    if (new Set(l.stubs.map((s) => s.territory)).size !== 2)
      errs.push('wrap stubs must belong to different territories');
  }
  return errs;
}

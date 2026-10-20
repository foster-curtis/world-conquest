// Stylization on the shared-arc topology (§5.3): drop small detached islands, Chaikin-smooth every arc once, then
// rebuild each territory's rings from its arcs. A border shared by two territories is one arc, so it is smoothed once
// and stays vertex-identical on both sides. Arc endpoints (junctions) never move.
export type XY = [number, number];
export type Ring = XY[];

interface Topo {
  arcs: XY[][];
  transform?: { scale: XY; translate: XY };
  objects: Record<
    string,
    {
      geometries: (
        | { type: 'Polygon'; arcs: number[][]; properties: { t: string } }
        | { type: 'MultiPolygon'; arcs: number[][][]; properties: { t: string } }
        | { type: null; properties: { t: string } }
      )[];
    }
  >;
}

/** territory -> polygons -> rings -> arc refs (negative = reversed, ~i) */
export type TopoShapes = { arcs: XY[][]; terr: Record<string, number[][][]> };

export function readTopo(topo: Topo): TopoShapes {
  const arcs = topo.arcs.map((arc) => {
    if (!topo.transform) return arc.map((p) => [p[0], p[1]] as XY);
    const { scale, translate } = topo.transform;
    let x = 0;
    let y = 0;
    return arc.map((p) => {
      x += p[0];
      y += p[1];
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as XY;
    });
  });
  const terr: Record<string, number[][][]> = {};
  for (const obj of Object.values(topo.objects)) {
    for (const g of obj.geometries) {
      if (g.type === null) continue;
      terr[g.properties.t] = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    }
  }
  return { arcs, terr };
}

const arcOf = (arcs: XY[][], ref: number): XY[] =>
  ref >= 0 ? (arcs[ref] as XY[]) : [...(arcs[~ref] as XY[])].reverse();

export function ringOf(arcs: XY[][], refs: number[]): Ring {
  const out: Ring = [];
  for (const ref of refs) {
    const pts = arcOf(arcs, ref);
    for (let i = out.length ? 1 : 0; i < pts.length; i++) out.push(pts[i] as XY);
  }
  return out; // closed: last point == first point
}

export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0; i + 1 < r.length; i++)
    a += (r[i] as XY)[0] * (r[i + 1] as XY)[1] - (r[i + 1] as XY)[0] * (r[i] as XY)[1];
  return a / 2;
}

/**
 * Drops polygon parts that share no arc with another territory (islands) and whose area is below `minArea`, except a
 * territory's largest part. Returns the dropped parts per territory, for the build log.
 */
export function dropIslands(s: TopoShapes, minArea: number): Record<string, number> {
  const owners = new Map<number, Set<string>>();
  for (const [t, polys] of Object.entries(s.terr))
    for (const poly of polys)
      for (const ring of poly)
        for (const ref of ring) {
          const i = ref >= 0 ? ref : ~ref;
          const set = owners.get(i) ?? new Set<string>();
          set.add(t);
          owners.set(i, set);
        }
  const dropped: Record<string, number> = {};
  for (const [t, polys] of Object.entries(s.terr)) {
    const areas = polys.map((p) => Math.abs(ringArea(ringOf(s.arcs, p[0] as number[]))));
    const biggest = areas.indexOf(Math.max(...areas));
    s.terr[t] = polys.filter((p, i) => {
      if (i === biggest) return true;
      const shared = (p[0] as number[]).some((ref) => (owners.get(ref >= 0 ? ref : ~ref)?.size ?? 0) > 1);
      if (shared || (areas[i] as number) >= minArea) return true;
      dropped[t] = (dropped[t] ?? 0) + 1;
      return false;
    });
  }
  return dropped;
}

function chaikinOpen(pts: XY[]): XY[] {
  if (pts.length < 3) return pts;
  const out: XY[] = [pts[0] as XY];
  const last = pts.length - 2;
  for (let i = 0; i <= last; i++) {
    const [ax, ay] = pts[i] as XY;
    const [bx, by] = pts[i + 1] as XY;
    if (i > 0) out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
    if (i < last) out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  out.push(pts[pts.length - 1] as XY);
  return out;
}

function chaikinClosed(pts: XY[]): XY[] {
  const ring = pts.slice(0, -1);
  const out: XY[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i] as XY;
    const [bx, by] = ring[(i + 1) % ring.length] as XY;
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  out.push(out[0] as XY);
  return out;
}

const MIN_STEP = 0.8; // board units between kept vertices of a smoothed arc (outputs are rounded to 0.1)

/** Drops vertices closer than `d` to the previous kept one; the endpoints always stay. */
function thin(pts: XY[], d: number): XY[] {
  const out: XY[] = [pts[0] as XY];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i] as XY;
    const q = out[out.length - 1] as XY;
    if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= d * d) out.push(p);
  }
  out.push(pts[pts.length - 1] as XY);
  return out;
}

/**
 * Closes narrow water inlets on coasts that belong to a single territory (river estuaries, fjords, slivers between
 * two parts of one territory): where two points of a ring come within `gap` of each other, the coast between them
 * bends away into the land (water inside the loop), and that water is thin (mean width under `gap`), the coast is
 * replaced by the short segment across the mouth. Land lobes (peninsulas) are never cut, and borders shared with
 * another territory are never touched, so adjacency is unchanged. Returns the number of inlets filled.
 */
export function fillInlets(s: TopoShapes, gap: number): number {
  const owners = new Map<number, Set<string>>();
  for (const [t, polys] of Object.entries(s.terr))
    for (const poly of polys)
      for (const ring of poly)
        for (const ref of ring) {
          const i = ref >= 0 ? ref : ~ref;
          const o = owners.get(i) ?? new Set<string>();
          o.add(t);
          owners.set(i, o);
        }
  const single = (ref: number) => owners.get(ref >= 0 ? ref : ~ref)?.size === 1;
  const key = (p: XY) => `${p[0]},${p[1]}`;
  const startKey = (ref: number) => key(arcOf(s.arcs, ref)[0] as XY);
  const endKey = (ref: number) => startKey(~ref);
  let filled = 0;

  // Cuts the inlets of one ring; returns the rewritten arc refs, or null when nothing was cut.
  const cutRing = (ring: number[], landSign: number): number[] | null => {
    const pts: XY[] = [];
    const tag: number[] = []; // tag[k] = position in `ring` of the arc that segment k..k+1 belongs to
    ring.forEach((ref, n) => {
      const a = arcOf(s.arcs, ref);
      for (let k = pts.length ? 1 : 0; k < a.length; k++) {
        if (pts.length) tag.push(n);
        pts.push(a[k] as XY);
      }
    });
    const removed = new Set<number>();
    let i = 0;
    while (i < pts.length - 1) {
      const p = pts[i] as XY;
      let cut = -1;
      let length = 0;
      let twice = 0; // running shoelace sum along the ring from i
      for (let j = i + 1; j < pts.length; j++) {
        if (!single(ring[tag[j - 1] as number] as number)) break;
        const q = pts[j] as XY;
        const o = pts[j - 1] as XY;
        length += Math.hypot(q[0] - o[0], q[1] - o[1]);
        twice += o[0] * q[1] - q[0] * o[1];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (j < i + 2 || d >= gap || length < 3 * gap) continue;
        const area = (twice + q[0] * p[1] - p[0] * q[1]) / 2; // loop closed by the segment back to p
        if (Math.sign(area) !== landSign && (2 * Math.abs(area)) / length < gap) cut = j;
      }
      if (cut > 0) {
        for (let k = i + 1; k < cut; k++) removed.add(k);
        filled++;
        i = cut;
      } else i++;
    }
    if (removed.size === 0) return null;
    // Rewrite each run of consecutive single-owner arcs as one new arc without the removed points.
    const out: number[] = [];
    let n = 0;
    let start = 0; // index in pts where the current arc starts
    while (n < ring.length) {
      const ref = ring[n] as number;
      const len = arcOf(s.arcs, ref).length - 1;
      if (!single(ref)) {
        out.push(ref);
        start += len;
        n++;
        continue;
      }
      let end = start + len;
      let m = n + 1;
      while (m < ring.length && single(ring[m] as number)) {
        end += arcOf(s.arcs, ring[m] as number).length - 1;
        m++;
      }
      const run: XY[] = [];
      for (let k = start; k <= end; k++) if (!removed.has(k)) run.push(pts[k] as XY);
      s.arcs.push(run);
      out.push(s.arcs.length - 1);
      start = end;
      n = m;
    }
    return out;
  };

  for (const [t, polys] of Object.entries(s.terr)) {
    // A loop that encloses land has the sign of the outer ring's area, for every ring of the polygon.
    const sign = (poly: number[][]) => Math.sign(ringArea(ringOf(s.arcs, poly[0] as number[])));
    // Two parts of one territory that touch at a single node (a sliver of water between them running up to that
    // node) are first spliced into one pinched ring at that node, so the sliver becomes an inlet of that ring.
    let merged = true;
    while (merged) {
      merged = false;
      for (let a = 0; a < polys.length && !merged; a++)
        for (let b = a + 1; b < polys.length && !merged; b++) {
          const A = (polys[a] as number[][])[0] as number[];
          const B = (polys[b] as number[][])[0] as number[];
          if (sign(polys[a] as number[][]) !== sign(polys[b] as number[][])) continue;
          for (let x = 0; x < A.length && !merged; x++) {
            const node = endKey(A[x] as number);
            const y = B.findIndex((ref) => startKey(ref) === node);
            if (y < 0) continue;
            const ring = [...A.slice(0, x + 1), ...B.slice(y), ...B.slice(0, y), ...A.slice(x + 1)];
            const cut = cutRing(ring, sign(polys[a] as number[][]));
            if (!cut) continue;
            polys[a] = [cut, ...(polys[a] as number[][]).slice(1), ...(polys[b] as number[][]).slice(1)];
            polys.splice(b, 1);
            merged = true;
          }
        }
    }
    for (const poly of polys) {
      const landSign = sign(poly);
      poly.forEach((ring, ri) => {
        const cut = cutRing(ring, landSign);
        if (cut) poly[ri] = cut;
      });
    }
    s.terr[t] = polys;
  }
  return filled;
}

/**
 * Arcs joined end to end through nodes where only two arc ends meet (no real junction) form one chain, so smoothing
 * never leaves a corner at such a node. Returns chains as oriented arc refs, and whether each chain is a closed loop.
 */
function chains(arcs: XY[][], used: Set<number>): { refs: number[]; closed: boolean }[] {
  const key = (p: XY) => `${p[0]},${p[1]}`;
  const ends = new Map<string, number[]>(); // node -> oriented refs leaving that node
  for (const i of used) {
    const a = arcs[i] as XY[];
    for (const [k, ref] of [
      [key(a[0] as XY), i],
      [key(a[a.length - 1] as XY), ~i],
    ] as [string, number][]) {
      const l = ends.get(k) ?? [];
      l.push(ref);
      ends.set(k, l);
    }
  }
  const startOf = (ref: number) => {
    const a = arcs[ref >= 0 ? ref : ~ref] as XY[];
    return key((ref >= 0 ? a[0] : a[a.length - 1]) as XY);
  };
  const endOf = (ref: number) => startOf(~ref);
  const done = new Set<number>();
  const out: { refs: number[]; closed: boolean }[] = [];
  const walk = (first: number) => {
    const refs = [first];
    done.add(first >= 0 ? first : ~first);
    for (;;) {
      const node = endOf(refs[refs.length - 1] as number);
      const leaving = ends.get(node) as number[];
      if (leaving.length !== 2) return { refs, closed: false };
      const back = ~(refs[refs.length - 1] as number);
      const next = leaving[0] === back ? (leaving[1] as number) : (leaving[0] as number);
      const idx = next >= 0 ? next : ~next;
      if (done.has(idx)) return { refs, closed: next === refs[0] };
      done.add(idx);
      refs.push(next);
    }
  };
  // Chains start at real junctions (degree != 2); what is left are loops.
  for (const [, leaving] of [...ends.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
    if (leaving.length !== 2) for (const ref of leaving) if (!done.has(ref >= 0 ? ref : ~ref)) out.push(walk(ref));
  for (const i of [...used].sort((x, y) => x - y)) if (!done.has(i)) out.push(walk(i));
  return out;
}

/**
 * Chaikin corner cutting on every chain of arcs. Where a smoothed chain would cross another (narrow inlets,
 * straits), both fall back to their unsmoothed shape, which mapshaper's simplification already keeps free of
 * crossings. Returns how many chains fell back.
 */
export function smoothArcs(s: TopoShapes, iterations: number): number {
  const used = new Set<number>();
  for (const polys of Object.values(s.terr))
    for (const poly of polys) for (const ring of poly) for (const ref of ring) used.add(ref >= 0 ? ref : ~ref);
  const original = s.arcs;
  const list = chains(original, used);
  // A chain's smoothed line goes on its first arc; its other arcs collapse to the chain's end point. Rings walk a
  // chain's arcs in order (or all reversed), so they still trace the whole smoothed line exactly once.
  const smoothedChain = list.map(({ refs, closed }) => {
    let line: XY[] = [];
    for (const ref of refs) {
      const pts = arcOf(original, ref);
      line.push(...(line.length ? pts.slice(1) : pts));
    }
    for (let k = 0; k < iterations; k++) line = closed ? chaikinClosed(line) : chaikinOpen(line);
    return thin(line, MIN_STEP);
  });
  const build = (fallback: Set<number>) => {
    const arcs = original.slice();
    list.forEach(({ refs }, c) => {
      if (fallback.has(c)) return;
      const line = smoothedChain[c] as XY[];
      const endPt = line[line.length - 1] as XY;
      refs.forEach((ref, n) => {
        const pts = n === 0 ? line : [endPt, endPt];
        arcs[ref >= 0 ? ref : ~ref] = ref >= 0 ? pts : [...pts].reverse();
      });
    });
    return arcs;
  };
  const chainOf = new Map<number, number>();
  list.forEach(({ refs }, c) => {
    for (const ref of refs) chainOf.set(ref >= 0 ? ref : ~ref, c);
  });
  const fallback = new Set<number>();
  for (let round = 0; round < 10; round++) {
    const bad = crossingArcs(build(fallback), used);
    if (bad.size === 0) break;
    for (const i of bad) fallback.add(chainOf.get(i) as number);
  }
  s.arcs = build(fallback);
  return fallback.size;
}

/** Arcs (by index) with a segment that properly crosses a segment of any arc. */
function crossingArcs(arcs: XY[][], used: Set<number>): Set<number> {
  const CELL = 20;
  const grid = new Map<string, [number, number][]>();
  for (const i of used) {
    const arc = arcs[i] as XY[];
    for (let j = 0; j + 1 < arc.length; j++) {
      const a = arc[j] as XY;
      const b = arc[j + 1] as XY;
      for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++)
        for (let gy = Math.floor(Math.min(a[1], b[1]) / CELL); gy <= Math.floor(Math.max(a[1], b[1]) / CELL); gy++) {
          const k = `${gx},${gy}`;
          const l = grid.get(k) ?? [];
          l.push([i, j]);
          grid.set(k, l);
        }
    }
  }
  const bad = new Set<number>();
  for (const list of grid.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const [i, j] = list[x] as [number, number];
        const [k, l] = list[y] as [number, number];
        if (i === k && Math.abs(j - l) < 2) continue;
        const A = arcs[i] as XY[];
        const B = arcs[k] as XY[];
        if (properCross(A[j] as XY, A[j + 1] as XY, B[l] as XY, B[l + 1] as XY)) {
          bad.add(i);
          bad.add(k);
        }
      }
  return bad;
}

/** Proper crossings between segments that are not the same shared segment. Returns a few offending points. */
export function crossings(rings: Ring[]): XY[] {
  const segs: [XY, XY][] = [];
  const seen = new Set<string>();
  for (const r of rings)
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i] as XY;
      const b = r[i + 1] as XY;
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const ka = `${a[0]},${a[1]}`;
      const kb = `${b[0]},${b[1]}`;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(k)) continue;
      seen.add(k);
      segs.push([a, b]);
    }
  const CELL = 20;
  const grid = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++)
      for (let gy = Math.floor(Math.min(a[1], b[1]) / CELL); gy <= Math.floor(Math.max(a[1], b[1]) / CELL); gy++) {
        const k = `${gx},${gy}`;
        const l = grid.get(k) ?? [];
        l.push(i);
        grid.set(k, l);
      }
  });
  const out: XY[] = [];
  const tested = new Set<string>();
  for (const list of grid.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x] as number;
        const j = list[y] as number;
        const k = `${i},${j}`;
        if (tested.has(k)) continue;
        tested.add(k);
        const [a, b] = segs[i] as [XY, XY];
        const [c, d] = segs[j] as [XY, XY];
        if (properCross(a, b, c, d)) out.push(a);
      }
  return out;
}

const orient = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function properCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

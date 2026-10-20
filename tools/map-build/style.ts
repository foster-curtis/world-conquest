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

const arcOf = (arcs: XY[][], ref: number): XY[] => (ref >= 0 ? (arcs[ref] as XY[]) : [...(arcs[~ref] as XY[])].reverse());

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
  for (let i = 0; i + 1 < r.length; i++) a += (r[i] as XY)[0] * (r[i + 1] as XY)[1] - (r[i + 1] as XY)[0] * (r[i] as XY)[1];
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

/** Chaikin corner cutting on every arc in use. An arc that alone forms a ring is smoothed as a closed loop. */
export function smoothArcs(s: TopoShapes, iterations: number): void {
  const closed = new Set<number>();
  const used = new Set<number>();
  for (const polys of Object.values(s.terr))
    for (const poly of polys)
      for (const ring of poly) {
        for (const ref of ring) used.add(ref >= 0 ? ref : ~ref);
        if (ring.length === 1) closed.add(ring[0] as number >= 0 ? (ring[0] as number) : ~(ring[0] as number));
      }
  s.arcs = s.arcs.map((arc, i) => {
    if (!used.has(i)) return arc;
    let a = arc;
    for (let k = 0; k < iterations; k++) a = closed.has(i) ? chaikinClosed(a) : chaikinOpen(a);
    return a;
  });
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

// Natural Earth 1:10m -> apps/web/src/board/{board.svg,layout.json} (+ tools/map-build/preview.png).
// Run: pnpm --filter @wc/map-build build   (needs network only on the first run; downloads are cached in .cache/)
//
// Pipeline (§5.3): assign (assignments.json) -> project (Miller) -> snap + dissolve + clip (mapshaper)
//   -> warp (warp.json, one smooth displacement field) -> simplify (mapshaper, shared-arc topology)
//   -> drop small islands + Chaikin-smooth each arc (style.ts) -> fit to the board -> anchors, sea links (sealinks.json)
//   -> §5.3 checks.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import mapshaper from 'mapshaper';
import { type Layout, type Pt, parseBoard, runChecks, touchingPairs } from './checks.ts';
import { loadClassic } from './mapdef.ts';
import { crossings, dropIslands, fillInlets, properCross, type Ring, readTopo, ringOf, smoothArcs } from './style.ts';
import { checkFold, compileWarp, type LonLat, type WarpConfig } from './warp.ts';

// ---- Settings (the single tuning surface, §5.3) -----------------------------------------------------------------
const MAP_WIDTH = 2000; // projected units spanned by 360 degrees (before the warp)
const PAD = 60; // empty margin left/right of the land: room for the Alaska-Kamchatka edge stubs (§5.4)
const MARGIN = 24; // empty margin above/below the land
const CENTER_LON = 11; // central meridian: puts the cut at 11 - 180 = -169 (Bering Strait)
const LAT_MAX = 85;
const LAT_MIN = -56;
const SNAP_INTERVAL = 0.05; // projected units; welds admin-0 / admin-1 borders from different files
const SIMPLIFY_INTERVAL = 4; // board units (weighted Visvalingam): the "chunky" level
// Coarser simplification where the user asked for cleaner, rounder shapes (a shared border takes the larger value).
const SIMPLIFY_BY_TERRITORY: Record<string, number> = {
  greenland: 14,
  western_australia: 16,
  eastern_australia: 16,
  new_guinea: 7,
};
const MIN_ISLAND_AREA = 220; // board units^2; smaller detached parts are removed (never a territory's largest part)
const SMOOTH_ITERATIONS = 3; // Chaikin passes per arc
const NEEDLE_WIDTH = 7; // board units; one-territory land spikes thinner than this are cut off
const INLET_GAP = 5; // board units; one-territory water inlets narrower than this (mouth and mean width) are filled
const MIN_TAP_RADIUS = 15; // board units; every territory's anchor must sit this far inside its shape
const FOLD_MIN_DET = 0.05; // the warp's Jacobian determinant must stay above this everywhere near land

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(here, '.cache');
const BOARD_DIR = resolve(here, '../../apps/web/src/board');
const SOURCES = {
  a0: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip',
  a1: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip',
};

// ---- Types ------------------------------------------------------------------------------------------------------
type Bounds = [number, number, number, number];
// parts: whole polygons whose bbox centre falls in ounds go to 	o; split: the piece of a polygon inside
// ounds (cut along the box edges) goes to 	o.
type Rule = {
  to?: string;
  keep?: Bounds | Bounds[];
  parts?: { bounds: Bounds; to: string }[];
  split?: { bounds: Bounds; to: string }[];
};
type Entry = string | (Rule & { provinces?: Record<string, string | Rule> });
type GRing = [number, number][];
type Geom = { type: 'Polygon'; coordinates: GRing[] } | { type: 'MultiPolygon'; coordinates: GRing[][] } | null;
type Feature = { properties: Record<string, unknown>; geometry: Geom };
type FC = { features: Feature[] };
type EndSpec = 'anchor' | { lonlat: LonLat } | { board: Pt };
type PointSpec = { lonlat: LonLat } | { board: Pt };
/** `through`: a point (over water) the curved link passes through at its middle. */
type LinkSpec = { from?: EndSpec; to?: EndSpec; through?: PointSpec };

// ---- Natural Earth download + read ------------------------------------------------------------------------------
async function loadLayer(name: 'a0' | 'a1'): Promise<FC> {
  mkdirSync(CACHE, { recursive: true });
  const zip = resolve(CACHE, `${name}.zip`);
  if (!existsSync(zip)) {
    console.log(`downloading ${SOURCES[name]}`);
    const res = await fetch(SOURCES[name]);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${SOURCES[name]}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const json = resolve(CACHE, `${name}.geojson`);
  if (!existsSync(json)) {
    const out = await mapshaper.applyCommands(`-i "${zip}" -o out.json format=geojson`);
    // The zip yields several outputs (some empty); the data layer is the largest.
    const biggest = Object.values(out).reduce((a, b) => (String(b).length > String(a).length ? b : a));
    writeFileSync(json, biggest);
  }
  return JSON.parse(readFileSync(json, 'utf8')) as FC;
}

const prop = (f: Feature, k: string): string => String(f.properties[k] ?? f.properties[k.toLowerCase()] ?? '');

// ---- Projection -------------------------------------------------------------------------------------------------
const mill = (phiDeg: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((phiDeg * Math.PI) / 180)));
const SCALE = MAP_WIDTH / (2 * Math.PI);
const Y_TOP = mill(LAT_MAX);
const Y_BOTTOM = (Y_TOP - mill(LAT_MIN)) * SCALE;
const project = ([lon, lat]: [number, number]): [number, number] => {
  const l = ((((lon - CENTER_LON + 180) % 360) + 360) % 360) - 180;
  return [PAD + ((l + 180) / 360) * MAP_WIDTH, (Y_TOP - mill(lat)) * SCALE];
};

function polygonsOf(g: Geom): GRing[][] {
  if (!g) return [];
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

const inside = (b: Bounds, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const insideAny = (k: Bounds | Bounds[], x: number, y: number) =>
  typeof k[0] === 'number' ? inside(k as Bounds, x, y) : (k as Bounds[]).some((b) => inside(b, x, y));

// ---- Assignment -> projected polygon features -------------------------------------------------------------------
function buildFeatures(a0: FC, a1: FC, assignments: { countries: Record<string, Entry> }, validIds: Set<string>) {
  const out: {
    type: 'Feature';
    properties: { t: string; split?: { bounds: Bounds; to: string } };
    geometry: { type: 'Polygon'; coordinates: GRing[] };
  }[] = [];
  const problems: string[] = [];
  const used = new Set<string>();
  const checkTo = (to: string, where: string) => {
    if (to !== 'drop' && !validIds.has(to)) problems.push(`${where}: unknown territory id "${to}"`);
  };
  const emit = (f: Feature, to: string, rule: Rule) => {
    for (const poly of polygonsOf(f.geometry)) {
      const outer = poly[0] as GRing;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of outer) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      let dest = to;
      const part = rule.parts?.find((p) => inside(p.bounds, cx, cy));
      if (part) dest = part.to;
      else if (rule.keep && !insideAny(rule.keep, cx, cy)) dest = 'drop';
      if (dest === 'drop') continue;
      checkTo(dest, 'parts rule');
      const projected = poly.map((r) => r.map((p) => project(p)));
      // A polygon straddling the cut would draw a line across the whole map: drop it (only Bering Strait islets).
      if (
        (projected[0] as GRing).some(
          (p, i, r) => i > 0 && Math.abs(p[0] - (r[i - 1] as [number, number])[0]) > MAP_WIDTH / 2,
        )
      )
        continue;
      const split = rule.split?.find(
        (s) => s.bounds[0] < maxX && s.bounds[2] > minX && s.bounds[1] < maxY && s.bounds[3] > minY,
      );
      if (split) checkTo(split.to, 'split rule');
      out.push({
        type: 'Feature',
        properties: split ? { t: dest, split } : { t: dest },
        geometry: { type: 'Polygon', coordinates: projected },
      });
    }
  };

  for (const f of a0.features) {
    const code = prop(f, 'ADM0_A3');
    const raw = assignments.countries[code];
    if (raw === undefined) {
      problems.push(`country ${code} (${prop(f, 'NAME')}) has no assignment`);
      continue;
    }
    used.add(code);
    const entry: Exclude<Entry, string> = typeof raw === 'string' ? { to: raw } : raw;
    if (entry.provinces) {
      const provs = a1.features.filter((p) => prop(p, 'adm0_a3') === code);
      if (provs.length === 0) problems.push(`country ${code} lists provinces but has no admin-1 shapes`);
      const seen = new Set<string>();
      for (const p of provs) {
        const name = prop(p, 'name');
        const pe = entry.provinces[name];
        seen.add(name);
        if (pe === undefined) {
          problems.push(`province ${code}/${name} has no assignment`);
          continue;
        }
        const rule: Rule = typeof pe === 'string' ? { to: pe, keep: entry.keep, parts: entry.parts } : pe;
        checkTo(rule.to ?? '', `${code}/${name}`);
        emit(p, rule.to ?? 'drop', rule);
      }
      for (const name of Object.keys(entry.provinces))
        if (!seen.has(name)) problems.push(`unknown province ${code}/${name}`);
    } else {
      checkTo(entry.to ?? '', code);
      emit(f, entry.to ?? 'drop', entry);
    }
  }
  for (const code of Object.keys(assignments.countries))
    if (!used.has(code)) problems.push(`unknown country code ${code}`);
  return { features: out, problems };
}

// ---- mapshaper stages -------------------------------------------------------------------------------------------
type SplitFeature = ReturnType<typeof buildFeatures>['features'][number];
/** Applies split rules: the part of a polygon inside the (projected) box goes to the split's territory. */
async function applySplits(features: SplitFeature[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const f of features) {
    const s = f.properties.split;
    if (!s) {
      out.push(f);
      continue;
    }
    const [x0, y1] = project([s.bounds[0], s.bounds[1]]);
    const [x1, y0] = project([s.bounds[2], s.bounds[3]]);
    const input = {
      'in.json': JSON.stringify({ type: 'FeatureCollection', features: [{ ...f, properties: { k: 1 } }] }),
    };
    for (const [cmd, t] of [
      [`-clip bbox=${x0},${y0},${x1},${y1}`, s.to],
      [`-erase bbox=${x0},${y0},${x1},${y1}`, f.properties.t],
    ] as [string, string][]) {
      const res = await mapshaper.applyCommands(`-i in.json ${cmd} -o out.json format=geojson`, input);
      for (const g of (JSON.parse(String(res['out.json'])) as OutFC).features ?? [])
        for (const poly of polygonsOf(g.geometry))
          out.push({ type: 'Feature', properties: { t }, geometry: { type: 'Polygon', coordinates: poly } });
    }
  }
  return out;
}

type OutFC = { features: { properties: { t: string }; geometry: Geom }[] };
async function dissolve(features: unknown[]): Promise<OutFC> {
  const cmd = [
    `-i in.json snap snap-interval=${SNAP_INTERVAL}`,
    '-dissolve t',
    `-clip bbox=${PAD},0,${PAD + MAP_WIDTH},${Y_BOTTOM}`,
    '-o out.json format=geojson',
  ].join(' ');
  const res = await mapshaper.applyCommands(cmd, {
    'in.json': JSON.stringify({ type: 'FeatureCollection', features }),
  });
  return JSON.parse(String(res['out.json'])) as OutFC;
}

const simplifyExpr = () =>
  Object.entries(SIMPLIFY_BY_TERRITORY).reduce((e, [t, v]) => `t == "${t}" ? ${v} : ${e}`, String(SIMPLIFY_INTERVAL));

async function simplify(fc: OutFC) {
  const cmd = [
    '-i in.json name=land',
    `-simplify visvalingam weighted keep-shapes variable interval='${simplifyExpr()}'`,
    '-o out.json format=topojson no-quantization',
  ].join(' ');
  const res = await mapshaper.applyCommands(cmd, {
    'in.json': JSON.stringify({ type: 'FeatureCollection', features: fc.features }),
  });
  return readTopo(JSON.parse(String(res['out.json'])));
}

async function anchors(shape: Record<string, Pt[][][]>): Promise<Record<string, Pt>> {
  const features = Object.entries(shape).map(([t, polys]) => ({
    type: 'Feature',
    properties: { t },
    geometry: { type: 'MultiPolygon', coordinates: polys },
  }));
  const res = await mapshaper.applyCommands('-i in.json -points inner -o out.json format=geojson precision=0.1', {
    'in.json': JSON.stringify({ type: 'FeatureCollection', features }),
  });
  const fc = JSON.parse(String(res['out.json'])) as {
    features: { properties: { t: string }; geometry: { coordinates: Pt } }[];
  };
  return Object.fromEntries(fc.features.map((f) => [f.properties.t, f.geometry.coordinates]));
}

// ---- Geometry helpers -------------------------------------------------------------------------------------------
const round = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(round(n));
const dAttr = (polys: Pt[][][]) =>
  polys
    .flat()
    .map(
      (ring) =>
        `M${ring
          .slice(0, -1)
          .map((p) => `${fmt(p[0])} ${fmt(p[1])}`)
          .join('L')}Z`,
    )
    .join('');

const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function closestPair(A: Pt[][], B: Pt[][]): [Pt, Pt] {
  const va = A.flat();
  const vb = B.flat();
  let best: [Pt, Pt] = [va[0] as Pt, vb[0] as Pt];
  let bd = Infinity;
  for (const p of va)
    for (const q of vb) {
      const d = dist2(p, q);
      if (d < bd) {
        bd = d;
        best = [p, q];
      }
    }
  return best;
}

function nearestOnRings(rings: Pt[][], p: Pt): { pt: Pt; d: number } {
  let best: Pt = p;
  let bd = Infinity;
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i] as Pt;
      const b = r[(i + 1) % r.length] as Pt;
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const len = vx * vx + vy * vy;
      const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len)) : 0;
      const q: Pt = [a[0] + t * vx, a[1] + t * vy];
      const d = dist2(p, q);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
  return { pt: best, d: Math.sqrt(bd) };
}

function extreme(rings: Pt[][], pick: 'min' | 'max'): Pt {
  let best: Pt | undefined;
  for (const ring of rings)
    for (const p of ring) if (!best || (pick === 'min' ? p[0] < best[0] : p[0] > best[0])) best = p;
  return best as Pt;
}

/** Points along a sea link (a straight segment, or a quadratic curve through `via`'s control point). */
function linkPoints(l: Layout['seaLinks'][number]): Pt[] {
  if (!l.via) return [l.from, l.to];
  const out: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    out.push([
      u * u * l.from[0] + 2 * u * t * l.via[0] + t * t * l.to[0],
      u * u * l.from[1] + 2 * u * t * l.via[1] + t * t * l.to[1],
    ]);
  }
  return out;
}

/** Sea links must cross open water only: no land crossing away from their endpoints, no crossing each other. */
function seaLinkProblems(links: Layout['seaLinks'], rings: Pt[][]): string[] {
  const errs: string[] = [];
  // A crossing within 1.5 units of an endpoint is the link leaving its own coast.
  const near = (p: Pt, l: Layout['seaLinks'][number]) => dist2(p, l.from) < 2.25 || dist2(p, l.to) < 2.25;
  const meet = (a: Pt, b: Pt, c: Pt, d: Pt): Pt => {
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const polys = links.map(linkPoints);
  links.forEach((l, li) => {
    const pts = polys[li] as Pt[];
    let hits = 0;
    for (let i = 0; i + 1 < pts.length; i++)
      for (const r of rings)
        for (let j = 0; j < r.length; j++) {
          const a = pts[i] as Pt;
          const b = pts[i + 1] as Pt;
          const c = r[j] as Pt;
          const d = r[(j + 1) % r.length] as Pt;
          if (properCross(a, b, c, d) && !near(meet(a, b, c, d), l)) hits++;
        }
    if (hits) errs.push(`sea link ${l.a}-${l.b} crosses land ${hits} time(s)`);
  });
  for (let x = 0; x < links.length; x++)
    for (let y = x + 1; y < links.length; y++) {
      const p = polys[x] as Pt[];
      const q = polys[y] as Pt[];
      let hit = false;
      for (let i = 0; i + 1 < p.length && !hit; i++)
        for (let j = 0; j + 1 < q.length && !hit; j++)
          hit = properCross(p[i] as Pt, p[i + 1] as Pt, q[j] as Pt, q[j + 1] as Pt);
      if (hit) errs.push(`sea links ${links[x]?.a}-${links[x]?.b} and ${links[y]?.a}-${links[y]?.b} cross`);
    }
  return errs;
}

// ---- Preview ----------------------------------------------------------------------------------------------------
const CONTINENT_FILL: Record<string, string> = {
  north_america: '#e8a87c',
  south_america: '#c5a3d6',
  europe: '#7fb3e0',
  africa: '#e6c35c',
  asia: '#8fcf8f',
  australia: '#e58f9f',
};

function previewSvg(board: string, layout: Layout): string {
  const fills = Object.entries(CONTINENT_FILL)
    .map(([c, col]) => `#${c} path{fill:${col}}`)
    .join('');
  const body = board.replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const dots = Object.entries(layout.anchors)
    .map(
      ([t, [x, y]]) =>
        `<circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="#223" stroke-width="1.5"/><text x="${x}" y="${y - 9}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#112">${t}</text>`,
    )
    .join('');
  const links = layout.seaLinks
    .map((l) => {
      const d = l.via
        ? `M${l.from[0]} ${l.from[1]}Q${l.via[0]} ${l.via[1]} ${l.to[0]} ${l.to[1]}`
        : `M${l.from[0]} ${l.from[1]}L${l.to[0]} ${l.to[1]}`;
      return `<path d="${d}" style="fill:none;stroke:#16324a;stroke-width:2;stroke-dasharray:7 5"/>`;
    })
    .join('');
  const wraps = layout.wrapLinks
    .flatMap((w) => w.stubs)
    .map((s) => {
      const dir = s.to[0] === 0 ? 1 : -1;
      const [x, y] = s.to;
      return `<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${x}" y2="${y}" stroke="#c0392b" stroke-width="3" stroke-dasharray="7 5"/><path d="M${x + dir * 12} ${y - 9}L${x} ${y}L${x + dir * 12} ${y + 9}" style="fill:none;stroke:#c0392b;stroke-width:3"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"><style>${fills}path{stroke:#fff;stroke-width:1.2}</style><rect width="100%" height="100%" fill="#cfdbe6"/>${body}${links}${wraps}${dots}</svg>`;
}

// ---- Main -------------------------------------------------------------------------------------------------------
const readJson = <T>(name: string) => JSON.parse(readFileSync(resolve(here, name), 'utf8').replace(/^﻿/, '')) as T;

async function main() {
  const assignments = readJson<{ countries: Record<string, Entry> }>('assignments.json');
  const warpCfg = readJson<WarpConfig>('warp.json');
  const linkCfg = readJson<{ links: Record<string, LinkSpec> }>('sealinks.json');
  const { def, source } = await loadClassic();
  console.log(`map definition source: ${source}`);
  const [a0, a1] = [await loadLayer('a0'), await loadLayer('a1')];
  const { features, problems } = buildFeatures(a0, a1, assignments, new Set(def.territories));
  if (problems.length) {
    console.error(`assignment problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  // Dissolve in projected space, then warp every vertex with one smooth field (shared vertices stay shared).
  const land = await dissolve(await applySplits(features));
  const warp = compileWarp(warpCfg, project);
  const fold = checkFold(
    warp,
    land.features.flatMap((f) => polygonsOf(f.geometry).flat(2)),
    8,
  );
  if (fold.minDet < FOLD_MIN_DET) {
    console.error(`warp folds: Jacobian determinant ${fold.minDet.toFixed(3)} at projected ${fold.at.join(',')}`);
    process.exit(1);
  }
  for (const f of land.features)
    for (const poly of polygonsOf(f.geometry)) for (const ring of poly) for (const p of ring) [p[0], p[1]] = warp(p);

  // Simplify on shared-arc topology, drop small islands, smooth each arc once.
  const topo = await simplify(land);
  const dropped = dropIslands(topo, MIN_ISLAND_AREA);
  const inlets = fillInlets(topo, INLET_GAP, NEEDLE_WIDTH);
  const unsmoothed = smoothArcs(topo, SMOOTH_ITERATIONS);

  // Fit: translate so the land starts at (PAD, MARGIN); the board size follows from the land's extent.
  let raw: Record<string, Pt[][][]> = {};
  for (const [t, polys] of Object.entries(topo.terr)) raw[t] = polys.map((p) => p.map((r) => ringOf(topo.arcs, r)));
  const ext = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of Object.values(raw).flat(3)) {
    ext[0] = Math.min(ext[0] as number, p[0]);
    ext[1] = Math.min(ext[1] as number, p[1]);
    ext[2] = Math.max(ext[2] as number, p[0]);
    ext[3] = Math.max(ext[3] as number, p[1]);
  }
  const [minX, minY, maxX, maxY] = ext as [number, number, number, number];
  const WIDTH = Math.ceil(maxX - minX + 2 * PAD);
  const HEIGHT = Math.ceil(maxY - minY + 2 * MARGIN);
  const dx = PAD - minX;
  const dy = MARGIN - minY;
  const place = (p: Pt): Pt => [round(p[0] + dx), round(p[1] + dy)];
  const toBoard = (ll: LonLat): Pt => {
    const [x, y] = warp(project(ll));
    return [x + dx, y + dy];
  };
  raw = Object.fromEntries(
    Object.entries(raw).map(([t, polys]) => [
      t,
      polys
        .map((poly) =>
          poly
            .map((ring) => ring.map(place).filter((p, i, r) => i === 0 || dist2(p, r[i - 1] as Pt) > 0))
            .filter((ring) => ring.length >= 4),
        )
        .filter((poly) => poly.length > 0),
    ]),
  );
  const shape = raw;
  const bad = crossings(Object.values(shape).flat(2) as Ring[]);
  const anchor = await anchors(shape);

  // board.svg: one <path> per territory, grouped by continent, in table order.
  const parts: string[] = [];
  for (const c of def.continents) {
    const paths = c.territories.map((t) => {
      const polys = shape[t];
      if (!polys?.length) throw new Error(`territory ${t} has no geometry; check assignments.json`);
      return `<path id="${t}" d="${dAttr(polys)}"/>`;
    });
    parts.push(`<g id="${c.id}">${paths.join('')}</g>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill-rule="evenodd">\n${parts.join('\n')}\n</svg>\n`;

  // Round-trip through the parser so links are computed from exactly what is committed.
  const board = parseBoard(svg);
  const touch = touchingPairs(board);
  const rings = (t: string) => board.groups.flatMap((g) => g.paths).find((p) => p.id === t)?.rings as Pt[][];
  // An endpoint is the territory's anchor, or the coast point nearest a given [lon, lat] / board point.
  const end = (spec: EndSpec | undefined, t: string, fallback: Pt): Pt => {
    if (spec === undefined) return fallback;
    if (spec === 'anchor') return anchor[t] as Pt;
    const p = 'lonlat' in spec ? toBoard(spec.lonlat) : spec.board;
    const { pt } = nearestOnRings(rings(t), p);
    return [round(pt[0]), round(pt[1])];
  };
  const seaLinks: Layout['seaLinks'] = [];
  let wrapLinks: Layout['wrapLinks'] = [];
  const linkKeys = new Set<string>();
  for (const b of def.borders) {
    if (b.wrap) {
      const left = extreme(rings(b.a), 'min'); // a (alaska) sits at the left edge
      const right = extreme(rings(b.b), 'max'); // b (kamchatka / Chukotka) sits at the right edge
      wrapLinks = [
        {
          a: b.a,
          b: b.b,
          stubs: [
            { territory: b.a, from: left, to: [0, left[1]] },
            { territory: b.b, from: right, to: [WIDTH, right[1]] },
          ],
        },
      ];
    } else if (!touch.has(`${b.a}|${b.b}`)) {
      const key = `${b.a}|${b.b}`;
      linkKeys.add(key);
      const spec = linkCfg.links[key] ?? {};
      const [from0, to0] = closestPair(rings(b.a), rings(b.b));
      const link: Layout['seaLinks'][number] = {
        a: b.a,
        b: b.b,
        from: end(spec.from, b.a, from0),
        to: end(spec.to, b.b, to0),
      };
      if (spec.through) {
        // Quadratic Bézier through `m` at t = 1/2: control = 2m - (from + to) / 2.
        const m = 'lonlat' in spec.through ? toBoard(spec.through.lonlat) : spec.through.board;
        link.via = [
          round(2 * m[0] - (link.from[0] + link.to[0]) / 2),
          round(2 * m[1] - (link.from[1] + link.to[1]) / 2),
        ];
      }
      seaLinks.push(link);
    }
  }
  const unknown = Object.keys(linkCfg.links).filter((k) => !linkKeys.has(k));
  const layout: Layout = {
    width: WIDTH,
    height: HEIGHT,
    anchors: Object.fromEntries(def.territories.map((t) => [t, anchor[t] as Pt])),
    seaLinks,
    wrapLinks,
  };

  mkdirSync(BOARD_DIR, { recursive: true });
  writeFileSync(resolve(BOARD_DIR, 'board.svg'), svg);
  writeFileSync(resolve(BOARD_DIR, 'layout.json'), `${JSON.stringify(layout, null, 1)}\n`);
  const png = new Resvg(previewSvg(svg, layout), { font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(resolve(here, 'preview.png'), png);

  // Tappability: how far each anchor sits inside its territory.
  const tap = def.territories
    .map((t) => [t, nearestOnRings(rings(t), anchor[t] as Pt).d] as [string, number])
    .sort((x, y) => x[1] - y[1]);
  console.log(`board ${WIDTH}x${HEIGHT} (aspect ${(WIDTH / HEIGHT).toFixed(2)}), ${seaLinks.length} sea links`);
  console.log(`warp: min Jacobian determinant ${fold.minDet.toFixed(3)}`);
  console.log(
    `islands dropped: ${JSON.stringify(dropped)}; inlets filled: ${inlets}; arcs left unsmoothed to avoid crossings: ${unsmoothed}`,
  );
  console.log(
    `smallest tap radii: ${tap
      .slice(0, 8)
      .map(([t, d]) => `${t} ${d.toFixed(1)}`)
      .join(', ')}`,
  );

  const errs = [
    ...runChecks(def, parseBoard(svg), layout),
    ...bad.map((p) => `shapes overlap or self-cross near ${p.join(',')}`),
    ...unknown.map((k) => `sealinks.json: ${k} is not a sea link`),
    ...seaLinkProblems(
      seaLinks,
      board.groups.flatMap((g) => g.paths.flatMap((p) => p.rings)),
    ),
    ...tap.filter(([, d]) => d < MIN_TAP_RADIUS).map(([t, d]) => `${t} is too small to tap (radius ${d.toFixed(1)})`),
  ];
  if (errs.length) {
    console.error(`CHECKS FAILED:\n  ${errs.join('\n  ')}`);
    process.exit(1);
  }
  console.log('all §5.3 checks pass');
}

await main();

// Natural Earth 1:10m -> apps/web/src/board/{board.svg,layout.json} (+ tools/map-build/preview.png).
// Run: pnpm --filter @wc/map-build build   (needs network only on the first run; downloads are cached in .cache/)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import mapshaper from 'mapshaper';
import { type Layout, type Pt, parseBoard, runChecks, touchingPairs } from './checks.ts';
import { loadClassic } from './mapdef.ts';

// ---- Settings (the single tuning surface, §5.3) -----------------------------------------------------------------
const MAP_WIDTH = 2000; // board units (SVG user units) spanned by 360 degrees; height follows from the crop
const PAD = 60; // empty margin left/right of the map: room for the Alaska-Kamchatka edge stubs (§5.4)
const WIDTH = MAP_WIDTH + 2 * PAD;
const CENTER_LON = 11; // central meridian: puts the cut at 11 - 180 = -169 (Bering Strait)
const LAT_MAX = 80;
const LAT_MIN = -56;
const MIN_ISLAND_AREA = 45; // board units^2; smaller islands are removed
const SIMPLIFY_PERCENT = 4; // % of vertices kept (weighted Visvalingam): the "chunky" level
const SNAP_INTERVAL = 0.05; // board units; welds admin-0 / admin-1 borders from different files

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = resolve(here, '.cache');
const BOARD_DIR = resolve(here, '../../apps/web/src/board');
const SOURCES = {
  a0: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip',
  a1: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip',
};

// ---- Types ------------------------------------------------------------------------------------------------------
type Bounds = [number, number, number, number];
type Entry =
  | string
  | { to?: string; provinces?: Record<string, string>; keep?: Bounds; parts?: { bounds: Bounds; to: string }[] };
type Ring = [number, number][];
type Geom = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] } | null;
type Feature = { properties: Record<string, unknown>; geometry: Geom };
type FC = { features: Feature[] };

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

// ---- Assignment -> projected polygon features -------------------------------------------------------------------
const mill = (phiDeg: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((phiDeg * Math.PI) / 180)));
const SCALE = MAP_WIDTH / (2 * Math.PI);
const Y_TOP = mill(LAT_MAX);
const HEIGHT = Math.round((Y_TOP - mill(LAT_MIN)) * SCALE * 10) / 10;
const project = ([lon, lat]: [number, number]): [number, number] => {
  const l = ((((lon - CENTER_LON + 180) % 360) + 360) % 360) - 180;
  return [PAD + ((l + 180) / 360) * MAP_WIDTH, (Y_TOP - mill(lat)) * SCALE];
};

function polygonsOf(g: Geom): Ring[][] {
  if (!g) return [];
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

const inside = (b: Bounds, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

function buildFeatures(a0: FC, a1: FC, assignments: { countries: Record<string, Entry> }, validIds: Set<string>) {
  const out: { type: 'Feature'; properties: { t: string }; geometry: { type: 'Polygon'; coordinates: Ring[] } }[] = [];
  const problems: string[] = [];
  const used = new Set<string>();
  const checkTo = (to: string, where: string) => {
    if (to !== 'drop' && !validIds.has(to)) problems.push(`${where}: unknown territory id "${to}"`);
  };
  const emit = (f: Feature, to: string, entry: Exclude<Entry, string>) => {
    for (const poly of polygonsOf(f.geometry)) {
      const outer = poly[0] as Ring;
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
      const rule = entry.parts?.find((p) => inside(p.bounds, cx, cy));
      if (rule) dest = rule.to;
      else if (entry.keep && !inside(entry.keep, cx, cy)) dest = 'drop';
      if (dest === 'drop') continue;
      checkTo(dest, 'parts rule');
      const projected = poly.map((r) => r.map((p) => project(p)));
      // A polygon straddling the cut would draw a line across the whole map: drop it (only Bering Strait islets).
      if (
        (projected[0] as Ring).some(
          (p, i, r) => i > 0 && Math.abs(p[0] - (r[i - 1] as [number, number])[0]) > MAP_WIDTH / 2,
        )
      )
        continue;
      out.push({ type: 'Feature', properties: { t: dest }, geometry: { type: 'Polygon', coordinates: projected } });
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
        const to = entry.provinces[name];
        seen.add(name);
        if (to === undefined) {
          problems.push(`province ${code}/${name} has no assignment`);
          continue;
        }
        checkTo(to, `${code}/${name}`);
        emit(p, to, entry);
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

// ---- mapshaper: dissolve, clip, simplify ------------------------------------------------------------------------
type Prefix = { type: 'FeatureCollection'; features: unknown[] };
async function shapes(features: unknown[]): Promise<Record<string, Ring[][]>> {
  const input: Prefix = { type: 'FeatureCollection', features };
  const cmd = [
    `-i in.json snap snap-interval=${SNAP_INTERVAL}`,
    '-dissolve t',
    `-clip bbox=${PAD},0,${PAD + MAP_WIDTH},${HEIGHT}`,
    `-filter-islands min-area=${MIN_ISLAND_AREA} remove-empty`,
    `-simplify visvalingam weighted keep-shapes ${SIMPLIFY_PERCENT}%`,
    '-o out.json format=geojson precision=0.1',
  ].join(' ');
  const res = await mapshaper.applyCommands(cmd, { 'in.json': JSON.stringify(input) });
  const fc = JSON.parse(String(res['out.json'])) as { features: { properties: { t: string }; geometry: Geom }[] };
  const r: Record<string, Ring[][]> = {};
  for (const f of fc.features) r[f.properties.t] = polygonsOf(f.geometry);
  return r;
}

async function anchors(shape: Record<string, Ring[][]>): Promise<Record<string, Pt>> {
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

// ---- Output -----------------------------------------------------------------------------------------------------
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const dAttr = (polys: Ring[][]) =>
  polys
    .flatMap((poly) => poly)
    .map((ring) => {
      const pts = ring.slice(0, -1);
      return `M${pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}Z`;
    })
    .join('');

const CONTINENT_FILL: Record<string, string> = {
  north_america: '#e8a87c',
  south_america: '#c5a3d6',
  europe: '#7fb3e0',
  africa: '#e6c35c',
  asia: '#8fcf8f',
  australia: '#e58f9f',
};

function dist2(a: Pt, b: Pt) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function closestPair(A: Ring[][], B: Ring[][]): [Pt, Pt] {
  const va = A.flatMap((p) => p.flatMap((r) => r)) as Pt[];
  const vb = B.flatMap((p) => p.flatMap((r) => r)) as Pt[];
  let best: [Pt, Pt] = [va[0] as Pt, vb[0] as Pt];
  let bd = Infinity;
  for (const p of va) {
    for (const q of vb) {
      const d = dist2(p, q);
      if (d < bd) {
        bd = d;
        best = [p, q];
      }
    }
  }
  return best;
}

function extreme(polys: Ring[][], pick: 'min' | 'max'): Pt {
  let best: Pt | undefined;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const p of ring) {
        if (!best || (pick === 'min' ? p[0] < best[0] : p[0] > best[0])) best = p;
      }
    }
  }
  return best as Pt;
}

function previewSvg(board: string, layout: Layout, def: { continentOf: Record<string, string> }): string {
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
    .map(
      (l) =>
        `<line x1="${l.from[0]}" y1="${l.from[1]}" x2="${l.to[0]}" y2="${l.to[1]}" stroke="#16324a" stroke-width="2" stroke-dasharray="7 5"/>`,
    )
    .join('');
  const wraps = layout.wrapLinks
    .flatMap((w) => w.stubs)
    .map((s) => {
      const dir = s.to[0] === 0 ? 1 : -1;
      const [x, y] = s.to;
      return `<line x1="${s.from[0]}" y1="${s.from[1]}" x2="${x}" y2="${y}" stroke="#c0392b" stroke-width="3" stroke-dasharray="7 5"/><path d="M${x + dir * 12} ${y - 9}L${x} ${y}L${x + dir * 12} ${y + 9}" fill="none" stroke="#c0392b" stroke-width="3"/>`;
    })
    .join('');
  void def;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"><style>${fills}path{stroke:#fff;stroke-width:1.2}</style><rect width="100%" height="100%" fill="#cfdbe6"/>${body}${links}${wraps}${dots}</svg>`;
}

async function main() {
  const assignments = JSON.parse(readFileSync(resolve(here, 'assignments.json'), 'utf8')) as {
    countries: Record<string, Entry>;
  };
  const { def, source } = await loadClassic();
  console.log(`map definition source: ${source}`);
  const [a0, a1] = [await loadLayer('a0'), await loadLayer('a1')];
  const { features, problems } = buildFeatures(a0, a1, assignments, new Set(def.territories));
  if (problems.length) {
    console.error(`assignment problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const shape = await shapes(features);
  const anchor = await anchors(shape);

  // board.svg: one <path> per territory, grouped by continent, in table order.
  const parts: string[] = [];
  for (const c of def.continents) {
    const paths = c.territories.map((t) => {
      const polys = shape[t];
      if (!polys) throw new Error(`territory ${t} has no geometry; check assignments.json`);
      return `<path id="${t}" d="${dAttr(polys)}"/>`;
    });
    parts.push(`<g id="${c.id}">${paths.join('')}</g>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill-rule="evenodd">\n${parts.join('\n')}\n</svg>\n`;

  // Round-trip through the parser so links are computed from exactly what is committed.
  const board = parseBoard(svg);
  const touch = touchingPairs(board);
  const rings = (t: string) =>
    board.groups
      .flatMap((g) => g.paths)
      .find((p) => p.id === t)
      ?.rings.map((r) => [r.concat([r[0] as Pt])]) as unknown as Ring[][];
  const seaLinks: Layout['seaLinks'] = [];
  let wrapLinks: Layout['wrapLinks'] = [];
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
      const [from, to] = closestPair(rings(b.a), rings(b.b));
      seaLinks.push({ a: b.a, b: b.b, from, to });
    }
  }
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
  const png = new Resvg(previewSvg(svg, layout, def), { font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(resolve(here, 'preview.png'), png);

  const errs = runChecks(def, parseBoard(svg), layout);
  console.log(`board ${WIDTH}x${HEIGHT}, ${def.territories.length} territories, ${seaLinks.length} sea links`);
  if (errs.length) {
    console.error(`CHECKS FAILED:\n  ${errs.join('\n  ')}`);
    process.exit(1);
  }
  console.log('all §5.3 checks pass');
}

await main();

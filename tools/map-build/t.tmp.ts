import { readFileSync } from 'node:fs';
import { compileWarp } from './warp.ts';
const mill = (p: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * ((p * Math.PI) / 180)));
const S = 2000 / (2 * Math.PI);
const YT = mill(85);
const project = ([lon, lat]: [number, number]): [number, number] => {
  const l = ((((lon - 11 + 180) % 360) + 360) % 360) - 180;
  return [60 + ((l + 180) / 360) * 2000, (YT - mill(lat)) * S];
};
const cfg = JSON.parse(readFileSync('warp.json', 'utf8'));
const [x, y] = process.argv.slice(2).map(Number) as [number, number];
for (let n = 1; n <= cfg.steps.length; n++) {
  const f = compileWarp({ steps: cfg.steps.slice(0, n) }, project);
  const c = f([x, y]);
  const fx = f([x + 0.5, y]);
  const fy = f([x, y + 0.5]);
  const det = ((fx[0] - c[0]) * (fy[1] - c[1]) - (fx[1] - c[1]) * (fy[0] - c[0])) / 0.25;
  console.log(n, cfg.steps[n - 1].type, cfg.steps[n - 1].name ?? '', det.toFixed(3), c.map((v) => v.toFixed(0)).join(','));
}

// The declarative geographic warp (§5.3): one smooth, continuous displacement field applied to every projected vertex
// before topology is built. It is a composition of global steps, never per-territory transforms, so shared borders stay
// shared. `checkFold` samples the Jacobian so a config that would fold (and overlap land) fails the build.
//
// warp.json steps, applied in order:
//  - squeeze: x' = X(about) + (x - X(about)) * s(lat). Horizontal scale toward a meridian as a smooth function of
//    latitude (knots [lat, s], smoothstep between knots). Its Jacobian determinant is s > 0, so it never folds.
//  - mls: moving-least-squares similarity deformation (Schaefer et al. 2006). Control points are grouped; each group
//    gets one similarity (move / scale / rotate about a pivot) and the field blends them smoothly (weights 1/d^(2*alpha)).
// All positions in warp.json are [lon, lat]; a step sees them where the previous steps have already moved them.

export type XY = [number, number];
export type LonLat = [number, number];

interface Group {
  name: string;
  points: LonLat[];
  move?: XY;
  scale?: number;
  /** degrees, counter-clockwise on screen */
  rotate?: number;
  about?: LonLat;
}
type Step =
  | { type: 'squeeze'; about: number; rows: [number, number][] }
  | { type: 'mls'; alpha?: number; groups: Group[] };
export interface WarpConfig {
  steps: Step[];
}

type Fn = (p: XY) => XY;

const smooth = (t: number) => t * t * (3 - 2 * t);

function squeeze(step: Extract<Step, { type: 'squeeze' }>, place: (ll: LonLat) => XY): Fn {
  const cx = place([step.about, 0])[0];
  // knots by projected y (current position of that latitude on the central meridian)
  const knots = step.rows.map(([lat, s]) => [place([step.about, lat])[1], s] as XY).sort((a, b) => a[0] - b[0]);
  const scaleAt = (y: number): number => {
    const first = knots[0] as XY;
    const last = knots[knots.length - 1] as XY;
    if (y <= first[0]) return first[1];
    if (y >= last[0]) return last[1];
    for (let i = 0; i + 1 < knots.length; i++) {
      const [y0, s0] = knots[i] as XY;
      const [y1, s1] = knots[i + 1] as XY;
      if (y <= y1) return s0 + (s1 - s0) * smooth((y - y0) / (y1 - y0));
    }
    return last[1];
  };
  return ([x, y]) => [cx + (x - cx) * scaleAt(y), y];
}

function mls(step: Extract<Step, { type: 'mls' }>, place: (ll: LonLat) => XY): Fn {
  const alpha = step.alpha ?? 1;
  const P: XY[] = [];
  const Q: XY[] = [];
  for (const g of step.groups) {
    const pts = g.points.map(place);
    const about: XY = g.about
      ? place(g.about)
      : [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const k = g.scale ?? 1;
    const th = (-(g.rotate ?? 0) * Math.PI) / 180; // screen y points down
    const [mx, my] = g.move ?? [0, 0];
    for (const [x, y] of pts) {
      const dx = (x - about[0]) * k;
      const dy = (y - about[1]) * k;
      P.push([x, y]);
      Q.push([about[0] + dx * Math.cos(th) - dy * Math.sin(th) + mx, about[1] + dx * Math.sin(th) + dy * Math.cos(th) + my]);
    }
  }
  const n = P.length;
  return ([vx, vy]) => {
    let sw = 0;
    let px = 0;
    let py = 0;
    let qx = 0;
    let qy = 0;
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const p = P[i] as XY;
      const d2 = (p[0] - vx) ** 2 + (p[1] - vy) ** 2;
      if (d2 < 1e-12) return Q[i] as XY;
      const wi = 1 / d2 ** alpha;
      w[i] = wi;
      sw += wi;
      px += wi * p[0];
      py += wi * p[1];
      qx += wi * (Q[i] as XY)[0];
      qy += wi * (Q[i] as XY)[1];
    }
    px /= sw;
    py /= sw;
    qx /= sw;
    qy /= sw;
    // best similarity a (complex) mapping p^ -> q^:  a = sum w conj(p^) q^ / sum w |p^|^2
    let re = 0;
    let im = 0;
    let mu = 0;
    for (let i = 0; i < n; i++) {
      const wi = w[i] as number;
      const ax = (P[i] as XY)[0] - px;
      const ay = (P[i] as XY)[1] - py;
      const bx = (Q[i] as XY)[0] - qx;
      const by = (Q[i] as XY)[1] - qy;
      re += wi * (ax * bx + ay * by);
      im += wi * (ax * by - ay * bx);
      mu += wi * (ax * ax + ay * ay);
    }
    re /= mu;
    im /= mu;
    const ux = vx - px;
    const uy = vy - py;
    return [re * ux - im * uy + qx, im * ux + re * uy + qy];
  };
}

/** Compiles warp.json into one function of projected board coordinates. */
export function compileWarp(cfg: WarpConfig, project: (ll: LonLat) => XY): Fn {
  let f: Fn = (p) => p;
  for (const step of cfg.steps) {
    const prev = f;
    const place = (ll: LonLat) => prev(project(ll));
    const g = step.type === 'squeeze' ? squeeze(step, place) : mls(step, place);
    f = (p) => g(prev(p));
  }
  return f;
}

/** Smallest Jacobian determinant of `f` over a grid covering `box` (projected, pre-warp coordinates). */
export function checkFold(f: Fn, box: [number, number, number, number], stepSize: number): { minDet: number; at: XY } {
  const h = 0.5;
  let minDet = Infinity;
  let at: XY = [0, 0];
  for (let x = box[0]; x <= box[2]; x += stepSize) {
    for (let y = box[1]; y <= box[3]; y += stepSize) {
      const c = f([x, y]);
      const fx = f([x + h, y]);
      const fy = f([x, y + h]);
      const det = ((fx[0] - c[0]) * (fy[1] - c[1]) - (fx[1] - c[1]) * (fy[0] - c[0])) / (h * h);
      if (det < minDet) {
        minDet = det;
        at = [x, y];
      }
    }
  }
  return { minDet, at };
}

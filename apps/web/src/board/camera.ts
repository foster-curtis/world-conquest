// Zoom/pan as a pure transform: screen = world * s + (tx, ty). Pointer code only calls these functions.
export interface Camera {
  tx: number;
  ty: number;
  /** Screen pixels per board unit. */
  s: number;
}

export interface Size {
  w: number;
  h: number;
}

export const MAX_ZOOM = 8; // relative to the fitted scale

export function fitScale(view: Size, world: Size): number {
  return Math.min(view.w / world.w, view.h / world.h);
}

export function fitCamera(view: Size, world: Size): Camera {
  const s = fitScale(view, world);
  return { s, tx: (view.w - world.w * s) / 2, ty: (view.h - world.h * s) / 2 };
}

/** Keeps the board from being dragged out of sight; centered when smaller than the viewport. */
export function clampCamera(c: Camera, view: Size, world: Size): Camera {
  const min = fitScale(view, world);
  const s = Math.max(min, Math.min(min * MAX_ZOOM, c.s));
  const clampAxis = (t: number, v: number, w: number) => {
    const ws = w * s;
    if (ws <= v) return (v - ws) / 2;
    return Math.min(0, Math.max(v - ws, t));
  };
  return { s, tx: clampAxis(c.tx, view.w, world.w), ty: clampAxis(c.ty, view.h, world.h) };
}

/** Zoom by `factor` keeping the world point under screen (px, py) fixed. */
export function zoomAt(c: Camera, px: number, py: number, factor: number, view: Size, world: Size): Camera {
  const s = c.s * factor;
  const wx = (px - c.tx) / c.s;
  const wy = (py - c.ty) / c.s;
  return clampCamera({ s, tx: px - wx * s, ty: py - wy * s }, view, world);
}

export function pan(c: Camera, dx: number, dy: number, view: Size, world: Size): Camera {
  return clampCamera({ ...c, tx: c.tx + dx, ty: c.ty + dy }, view, world);
}

/** Pans the least amount that brings world point (x, y) at least `margin` px inside the viewport. */
export function panToKeep(c: Camera, x: number, y: number, view: Size, world: Size, margin = 60): Camera {
  const sx = x * c.s + c.tx;
  const sy = y * c.s + c.ty;
  const shift = (p: number, v: number) => (p < margin ? margin - p : p > v - margin ? v - margin - p : 0);
  const dx = shift(sx, view.w);
  const dy = shift(sy, view.h);
  return dx === 0 && dy === 0 ? c : pan(c, dx, dy, view, world);
}

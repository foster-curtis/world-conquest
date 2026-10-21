import { describe, expect, it } from 'vitest';
import { clampCamera, fitCamera, MAX_ZOOM, pan, panToKeep, zoomAt } from './camera.ts';

const world = { w: 1000, h: 800 };
const view = { w: 500, h: 500 };

describe('camera', () => {
  it('fits and centers the board', () => {
    const c = fitCamera(view, world);
    expect(c.s).toBeCloseTo(0.5);
    expect(c.tx).toBeCloseTo(0);
    expect(c.ty).toBeCloseTo(50);
  });

  it('zooms around a point and clamps zoom', () => {
    const c0 = fitCamera(view, world);
    const c1 = zoomAt(c0, 250, 250, 2, view, world);
    expect(c1.s).toBeCloseTo(1);
    // the world point under the cursor stays put
    expect((250 - c0.tx) / c0.s).toBeCloseTo((250 - c1.tx) / c1.s);
    expect(zoomAt(c0, 0, 0, 100, view, world).s).toBeCloseTo(c0.s * MAX_ZOOM);
    expect(zoomAt(c0, 0, 0, 0.01, view, world).s).toBeCloseTo(c0.s);
  });

  it('keeps the board in view when panning', () => {
    const z = zoomAt(fitCamera(view, world), 250, 250, 4, view, world);
    const p = pan(z, 99999, 99999, view, world);
    expect(p.tx).toBe(0);
    expect(p.ty).toBe(0);
    const q = clampCamera({ ...z, tx: -99999, ty: -99999 }, view, world);
    expect(q.tx).toBeCloseTo(view.w - world.w * z.s);
  });

  it('auto-pans a focused point onto the screen', () => {
    const z = { s: 1, tx: 0, ty: 0 };
    const c = panToKeep(z, 900, 700, view, world);
    expect(900 * c.s + c.tx).toBeLessThanOrEqual(view.w - 60);
    expect(700 * c.s + c.ty).toBeLessThanOrEqual(view.h - 60);
    expect(panToKeep(z, 100, 100, view, world)).toBe(z);
  });
});

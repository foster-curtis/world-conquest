// Pointer adapter (SPEC 7.2, 7.3): mouse and touch events become SelActions.
import type { TerritoryId } from '@wc/engine';
import type { SelAction } from './selection.ts';

export const pointerTap = (id: TerritoryId | null): SelAction => ({ type: 'tap', id });
export const pointerHover = (id: TerritoryId | null): SelAction => ({ type: 'hover', id });
/** Right-click is "back", same as Esc. */
export const pointerContextMenu = (): SelAction => ({ type: 'back' });

/** Treats a pointer press-and-release as a tap unless it moved (then it was a pan). */
export function isTap(down: { x: number; y: number }, up: { x: number; y: number }, slop = 6): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= slop;
}

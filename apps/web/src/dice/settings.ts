import { SPEEDS, type Speed } from './animation.ts';

const KEY = 'wc.animationSpeed';

export function loadSpeed(): Speed {
  try {
    const v = localStorage.getItem(KEY);
    return SPEEDS.includes(v as Speed) ? (v as Speed) : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveSpeed(s: Speed): void {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    // storage unavailable: the setting just won't persist
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

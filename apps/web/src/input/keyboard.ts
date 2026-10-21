// Keyboard adapter (SPEC 7.4): translates a key event into a SelAction (or the UI-level "cards" action).
// All the logic lives in selection.ts; this file is only the key table.
import type { SelAction, SelContext } from './selection.ts';

export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type KeyAction = SelAction | { type: 'cards' } | { type: 'sidebar' } | { type: 'closeDice' };

export interface KeyEnv {
  context: SelContext;
  /** The board element has keyboard focus. */
  boardFocused: boolean;
  /** The dice result panel is open: Esc closes it before anything else. */
  diceOpen?: boolean;
}

/** True for contexts where Home/End/arrows belong to the machine. */
export function keyToAction(e: KeyLike, env: KeyEnv): KeyAction | null {
  const { context, boardFocused, diceOpen } = env;
  const step = e.shiftKey ? 5 : 1;
  const mod = e.ctrlKey || e.metaKey;

  // Global
  if (mod && e.key === 'Enter') return { type: 'main' };
  if (!mod && !e.altKey && (e.key === 'c' || e.key === 'C')) return { type: 'cards' };
  if (!mod && !e.altKey && (e.key === 'l' || e.key === 'L')) return { type: 'sidebar' };
  if (diceOpen && !mod && !e.altKey && e.key === 'Escape') return { type: 'closeDice' };
  if (context === 'none') return null;

  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) return context === 'placing' ? { type: 'undo' } : null;
  if (mod || e.altKey) return null;

  // Attack panel: works wherever focus is while the panel is open.
  if (context === 'attack-panel') {
    if (e.key === '1' || e.key === '2' || e.key === '3') return { type: 'setDice', dice: Number(e.key) };
    if (e.key === ' ' || e.code === 'Space') return { type: 'roll' };
    if (e.key === 'b' || e.key === 'B') return { type: 'blitz' };
    if (e.key === 'Escape') return { type: 'back' };
  }

  // Sliders: occupy and fortify.
  if (context === 'slider') {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') return { type: 'adjust', delta: step };
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') return { type: 'adjust', delta: -step };
    if (e.key === 'Home') return { type: 'min' };
    if (e.key === 'End') return { type: 'max' };
    if (e.key === 'Enter') return { type: 'enter' };
    if (e.key === 'Escape') return { type: 'back' };
  }

  if (!boardFocused) return null;

  if (e.key === 'Tab') return { type: 'cycle', dir: e.shiftKey ? -1 : 1 };
  if (e.key === 'Enter') return { type: 'enter' };
  if (e.key === 'Escape') return { type: 'back' };
  if (context === 'placing') {
    if (e.key === 'ArrowUp') return { type: 'adjust', delta: step };
    if (e.key === 'ArrowDown') return { type: 'adjust', delta: -step };
    if (e.key === 'End') return { type: 'allHere' };
    if (e.key === 'Home') return { type: 'clearHere' };
  }
  return null;
}

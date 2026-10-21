// Shortcut overlay and start tip (SPEC 7.4). Hold Alt+/ to show; the HUD button toggles it for mouse users.
import { useEffect, useState } from 'react';
import type { SelContext } from './selection.ts';

interface Group {
  id: string;
  title: string;
  contexts: SelContext[];
  rows: [string, string][];
}

export const SHORTCUT_GROUPS: Group[] = [
  {
    id: 'board',
    title: 'Board focus',
    contexts: ['idle', 'source'],
    rows: [
      ['Tab / Shift+Tab', 'Next / previous candidate territory'],
      ['Enter', 'Select the focused territory'],
      ['Esc', 'Back one level (target, source, nothing)'],
    ],
  },
  {
    id: 'placing',
    title: 'Placing armies',
    contexts: ['placing'],
    rows: [
      ['Up / Down', '+1 / -1 on the focused territory'],
      ['Shift+Up / Down', '+5 / -5'],
      ['End', 'All remaining armies here'],
      ['Home', 'Clear this territory'],
      ['Ctrl+Z', 'Undo'],
    ],
  },
  {
    id: 'attack',
    title: 'Attack panel',
    contexts: ['attack-panel'],
    rows: [
      ['1 / 2 / 3', 'Number of dice'],
      ['Space', 'Roll'],
      ['B', 'Blitz'],
      ['Esc', 'Close the panel'],
    ],
  },
  {
    id: 'slider',
    title: 'Sliders (occupy, fortify)',
    contexts: ['slider'],
    rows: [
      ['Left / Right or Up / Down', '-1 / +1'],
      ['Shift+arrows', '-5 / +5'],
      ['Home / End', 'Min / Max'],
      ['Enter', 'Confirm'],
    ],
  },
  {
    id: 'global',
    title: 'Anywhere',
    contexts: [],
    rows: [
      ['Ctrl+Enter', 'The main button (Confirm / End attack / End turn)'],
      ['C', 'Open cards'],
      ['L', 'Show / hide the activity log'],
      ['Esc', 'Close the dice result'],
      ['Hold Alt+/', 'Show this overlay'],
    ],
  },
];

export function ShortcutOverlay({ context, onClose }: { context: SelContext; onClose: () => void }) {
  return (
    <div className="overlay">
      <button type="button" className="backdrop" aria-label="Close shortcuts" onClick={onClose} />
      <section className="modal shortcuts" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <div className="groups">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.id} className={`group${g.contexts.includes(context) ? ' current' : ''}`}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([k, d]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Hold Alt+/ (physical Slash key) to show the overlay; releasing hides it. Returns open state and a toggle. */
export function useShortcutOverlay(): { open: boolean; toggle: () => void; close: () => void } {
  const [held, setHeld] = useState(false);
  const [toggled, setToggled] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Slash' && e.altKey) {
        e.preventDefault(); // Option+/ would type a division sign on a Mac
        setHeld(true);
      } else if (e.key === 'Escape') setToggled(false);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Slash' || e.key === 'Alt') setHeld(false);
    };
    const blur = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return {
    open: held || toggled,
    toggle: () => setToggled((t) => !t),
    close: () => {
      setToggled(false);
      setHeld(false);
    },
  };
}

export const hasFinePointer = (): boolean => {
  try {
    return window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
};

/** Dismissible once-per-game tip, only on devices with a fine pointer. */
export function StartTip({ onDismiss }: { onDismiss: () => void }) {
  if (!hasFinePointer()) return null;
  return (
    <div className="tip" role="status">
      <span>
        Hold <kbd>Alt</kbd> + <kbd>/</kbd> to see keyboard shortcuts
      </span>
      <button type="button" className="ghost" onClick={onDismiss} aria-label="Dismiss tip">
        Got it
      </button>
    </div>
  );
}

// Pass-and-play setup (SPEC 1): names, colors (gray reserved for neutral), win condition. No join code, no sign-in.
import { MIN_SEATS, type WinCondition } from '@wc/engine';
import { useState } from 'react';
import { COLOR_HEX, COLOR_NAME, PICKABLE_COLORS } from '../board/colors.ts';
import type { PlayerInput } from './controller.ts';

const MAX_PLAYERS = 6;

/** Returns a problem with the player list, or null. Exported for tests. */
export function validatePlayers(players: PlayerInput[]): string | null {
  if (players.length < MIN_SEATS) return `Needs at least ${MIN_SEATS} players.`;
  if (players.length > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players.`;
  const names = players.map((p) => p.name.trim());
  if (names.some((n) => n.length === 0)) return 'Every player needs a name.';
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return 'Names must be different.';
  if (new Set(players.map((p) => p.color)).size !== players.length) return 'Colors must be different.';
  return null;
}

export function SetupScreen(props: {
  onStart: (players: PlayerInput[], win: WinCondition) => void;
  onBack: () => void;
  busy: boolean;
}) {
  const [players, setPlayers] = useState<PlayerInput[]>([
    { name: 'Player 1', color: 'red' },
    { name: 'Player 2', color: 'blue' },
  ]);
  const [win, setWin] = useState<WinCondition>('classic');
  const problem = validatePlayers(players);

  const update = (i: number, patch: Partial<PlayerInput>) =>
    setPlayers((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () =>
    setPlayers((ps) => {
      const color = PICKABLE_COLORS.find((c) => !ps.some((p) => p.color === c));
      return color ? [...ps, { name: `Player ${ps.length + 1}`, color }] : ps;
    });

  return (
    <div className="screen setup">
      <header className="screen-head">
        <button type="button" className="ghost" onClick={props.onBack}>
          ← Back
        </button>
        <h1>Pass-and-play</h1>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem)
            props.onStart(
              players.map((p) => ({ ...p, name: p.name.trim() })),
              win,
            );
        }}
      >
        <section>
          <h2>Players</h2>
          {players.length === 2 && <p className="hint">With two players a gray neutral army fills the map too.</p>}
          <ul className="plist">
            {players.map((p, i) => (
              <li key={p.color}>
                <span className="dot big" style={{ background: COLOR_HEX[p.color] }} />
                <input
                  type="text"
                  aria-label={`Player ${i + 1} name`}
                  value={p.name}
                  maxLength={20}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <span className="swatches" role="radiogroup" aria-label={`Player ${i + 1} color`}>
                  {PICKABLE_COLORS.map((c) => {
                    const taken = players.some((o, j) => j !== i && o.color === c);
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: a swatch button group is clearer than native radios here
                      <button
                        type="button"
                        key={c}
                        role="radio"
                        aria-checked={p.color === c}
                        aria-label={COLOR_NAME[c]}
                        title={COLOR_NAME[c]}
                        disabled={taken}
                        className={`swatch${p.color === c ? ' on' : ''}`}
                        style={{ background: COLOR_HEX[c] }}
                        onClick={() => update(i, { color: c })}
                      />
                    );
                  })}
                </span>
                {players.length > MIN_SEATS && (
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Remove player ${i + 1}`}
                    onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {players.length < MAX_PLAYERS && (
            <button type="button" onClick={add}>
              + Add player
            </button>
          )}
        </section>
        <section>
          <h2>Win condition</h2>
          <label className="choice">
            <input type="radio" name="win" checked={win === 'classic'} onChange={() => setWin('classic')} />
            <span>
              <b>Classic</b> Conquer every territory.
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="win" checked={win === 'capitals'} onChange={() => setWin('capitals')} />
            <span>
              <b>Capitals</b> Each player picks a capital in setup; capture them all.
            </span>
          </label>
        </section>
        {problem && <p className="warn">{problem}</p>}
        <button type="submit" className="primary big" disabled={problem !== null || props.busy}>
          Start game
        </button>
      </form>
    </div>
  );
}

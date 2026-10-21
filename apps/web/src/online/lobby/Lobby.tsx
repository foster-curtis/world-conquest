// The lobby for members (SPEC 2): seats and colors, host settings, remove, start, cancel, leave, share.
import { type Color, type PlayerView, SEAT_COLORS } from '@wc/engine';
import { useState } from 'react';
import { COLOR_HEX } from '../../board/colors.ts';
import type { OnlineGame } from '../game/OnlineGame.ts';
import { gameUrl } from '../route.ts';
import { patchSettings, SettingsForm } from './SettingsForm.tsx';
import { canShare, copyText, shareLink } from './share.ts';

export function Lobby(props: {
  game: OnlineGame;
  view: PlayerView;
  code: string;
  offline: boolean;
  onHome: () => void;
}) {
  const { game, view, code } = props;
  const me = view.viewer;
  const host = view.hostSeat === me;
  const humans = view.seats.filter((s) => s.kind === 'human');
  const taken = new Set(humans.map((s) => s.color));
  const url = gameUrl(window.location.origin, code);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (cmd: Parameters<OnlineGame['dispatch']>[0]) => {
    setBusy(true);
    const r = await game.dispatch(cmd);
    setBusy(false);
    setError(r.ok ? null : r.error.message);
    return r.ok;
  };

  const leave = async () => {
    if (await run({ type: 'LeaveGame' })) props.onHome();
  };
  const cancel = async () => {
    if (!window.confirm('Cancel this game for everyone?')) return;
    if (await run({ type: 'CancelGame' })) props.onHome();
  };

  return (
    <div className="screen lobby">
      <div className="screen-head">
        <button type="button" className="ghost" onClick={props.onHome}>
          ← Home
        </button>
        <h1>Lobby</h1>
      </div>
      {props.offline && (
        <div className="banner warn" role="status">
          Reconnecting…
        </div>
      )}
      {error && (
        <div className="banner err" role="alert">
          {error}
        </div>
      )}
      <section aria-label="Invite">
        <h2>
          Join code <code className="code">{code}</code>
        </h2>
        <p className="hint">{url}</p>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              setCopied(await copyText(url));
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {canShare() && (
            <button type="button" onClick={() => void shareLink(url)}>
              Share
            </button>
          )}
        </div>
      </section>
      <section aria-label="Players">
        <h2>
          Players ({humans.length}/{view.settings.maxSeats})
        </h2>
        <ul className="plist">
          {humans.map((s) => (
            <li key={s.seat}>
              <span className="dot big" style={{ background: COLOR_HEX[s.color] }} />
              <b>{s.displayName}</b>
              {s.seat === view.hostSeat && <span className="tag">host</span>}
              {s.seat === me && <span className="tag">you</span>}
              {host && s.seat !== me && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || props.offline}
                  onClick={() => void run({ type: 'RemoveFromLobby', seat: s.seat })}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <h3>Your color</h3>
        <div className="swatches">
          {SEAT_COLORS.map((c: Color) => {
            const mine = humans.find((s) => s.seat === me)?.color === c;
            return (
              <button
                key={c}
                type="button"
                className={`swatch${mine ? ' on' : ''}`}
                style={{ background: COLOR_HEX[c] }}
                aria-label={c}
                aria-pressed={mine}
                disabled={busy || props.offline || (taken.has(c) && !mine)}
                onClick={() => void run({ type: 'ChangeColor', color: c })}
              />
            );
          })}
        </div>
      </section>
      <section aria-label="Settings">
        <h2>Settings</h2>
        <SettingsForm
          value={view.settings}
          disabled={!host || busy || props.offline}
          minSeats={Math.max(2, humans.length)}
          onChange={(patch) =>
            void run({
              type: 'UpdateSettings',
              settings: { ...patch, territoryAssignment: patchSettings(view.settings, patch).territoryAssignment },
            })
          }
        />
        {!host && <p className="hint">Only the host can change settings.</p>}
      </section>
      <div className="row">
        {host && (
          <button
            type="button"
            className="primary big"
            disabled={busy || props.offline || humans.length < 2}
            onClick={() => void run({ type: 'StartGame' })}
          >
            {humans.length < 2 ? 'Waiting for players (2 needed)' : 'Start game'}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => void leave()}>
          Leave
        </button>
        {host && (
          <button type="button" className="ghost" disabled={busy} onClick={() => void cancel()}>
            Cancel game
          </button>
        )}
      </div>
    </div>
  );
}

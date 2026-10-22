// Home (SPEC 1, 8.1): Pass-and-play, Resume game, "On this device" saves, and the online section.
import type { ReactNode } from 'react';
import type { SaveMeta } from '../local/store.ts';
import { Footer, Mark } from './Brand.tsx';

const when = (iso: string) => {
  try {
    return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export function Home(props: {
  saves: SaveMeta[];
  warning: string | null;
  onNew: () => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onReplay: (id: string) => void;
  onStats: (id: string) => void;
  /** Online create/join and "My games"; absent when online is not configured. */
  online?: ReactNode;
  /** Signed-in name and Sign out, or Sign in; shown top right. */
  account?: ReactNode;
  /** An online game is waiting on you, so its Play button takes the one amber fill. */
  onlineMove?: boolean;
}) {
  const latest = props.saves.find((s) => s.status === 'playing');
  // Amber goes to the single most useful next action (BRAND rule 2).
  const amber = props.onlineMove ? null : latest ? 'resume' : 'new';
  return (
    <div className="screen home">
      {props.account && <div className="topbar">{props.account}</div>}
      <header className="hero">
        <Mark size={56} />
        <div>
          <h1>World Conquest</h1>
          <p className="tagline">Take the map with your friends, one turn at a time.</p>
        </div>
      </header>
      {props.warning && (
        <div className="banner warn" role="alert">
          {props.warning}
        </div>
      )}
      <section aria-labelledby="home-device">
        <h2 id="home-device">This device</h2>
        <p className="hint">Everyone plays on one screen and passes it around between turns.</p>
        <div className="menu">
          <button type="button" className={amber === 'new' ? 'primary big' : 'big'} onClick={props.onNew}>
            Pass-and-play
          </button>
          {latest && (
            <button
              type="button"
              className={amber === 'resume' ? 'primary big' : 'big'}
              onClick={() => props.onResume(latest.id)}
            >
              Resume game
            </button>
          )}
        </div>
        {props.saves.length > 0 && (
          <>
            <h3>Saved games</h3>
            <ul className="saves">
              {props.saves.map((s) => (
                <li key={s.id}>
                  <div className="info">
                    <b>{s.players.map((p) => p.name).join(', ')}</b>
                    <span className="sub">
                      {s.settings.winCondition === 'capitals' ? 'Capitals' : 'Classic'} · {when(s.updatedAt)} ·{' '}
                      {s.status === 'finished'
                        ? `finished, ${s.players.find((p) => p.seat === s.winner)?.name ?? '?'} won`
                        : 'in progress'}
                    </span>
                  </div>
                  <div className="row">
                    {s.status === 'playing' ? (
                      <button type="button" onClick={() => props.onResume(s.id)}>
                        Resume
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => props.onReplay(s.id)}>
                          Replay
                        </button>
                        <button type="button" onClick={() => props.onStats(s.id)}>
                          Stats
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => window.confirm('Delete this saved game?') && props.onDelete(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {props.online ?? <p className="hint">Online play is not configured in this build.</p>}
      <Footer />
    </div>
  );
}

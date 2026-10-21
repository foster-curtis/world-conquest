// Home (SPEC 1, 8.1): Pass-and-play, Resume game, "On this device" saves. Online is present but disabled until M5.
import type { SaveMeta } from '../local/store.ts';

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
}) {
  const latest = props.saves.find((s) => s.status === 'playing');
  return (
    <div className="screen home">
      <h1>World Conquest</h1>
      {props.warning && (
        <div className="banner warn" role="alert">
          {props.warning}
        </div>
      )}
      <div className="menu">
        <button type="button" className="primary big" onClick={props.onNew}>
          Pass-and-play
        </button>
        <button type="button" className="big" disabled={!latest} onClick={() => latest && props.onResume(latest.id)}>
          Resume game
        </button>
        <button type="button" className="big" disabled title="Online play arrives in a later release">
          Online <small>(coming soon)</small>
        </button>
      </div>
      <section aria-label="On this device">
        <h2>On this device</h2>
        {props.saves.length === 0 ? (
          <p className="hint">No saved games yet.</p>
        ) : (
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
        )}
      </section>
    </div>
  );
}

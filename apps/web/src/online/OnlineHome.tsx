// The online half of the home screen (SPEC 1, 8.1): create / join, and "My games" sections.
import { useState } from 'react';
import { COLOR_HEX } from '../board/colors.ts';
import type { AuthState } from './auth/useSession.ts';
import { fetchMyGames, type GameRow, type MyGames, waitingOnYou } from './mygames.ts';
import { codeFromInput } from './route.ts';

const SECTIONS: { key: keyof MyGames; title: string }[] = [
  { key: 'yourMove', title: 'Your move' },
  { key: 'waiting', title: 'Waiting on others' },
  { key: 'lobbies', title: 'Lobbies' },
  { key: 'finished', title: 'Finished' },
];

function GameItem(props: {
  g: GameRow;
  section: keyof MyGames;
  onOpen: (code: string) => void;
  onReplay: (code: string) => void;
}) {
  const { g } = props;
  const humans = g.game_seats.filter((s) => s.kind === 'human');
  return (
    <li>
      <div className="info">
        <b>
          {humans.map((s) => (
            <span key={s.seat} className="dot" style={{ background: COLOR_HEX[s.color], marginRight: 4 }} />
          ))}
          {humans.map((s) => s.display_name).join(', ')}
        </b>
        <span className="sub">
          {g.join_code} · {g.settings.winCondition === 'capitals' ? 'Capitals' : 'Classic'} ·{' '}
          {g.settings.pace === 'sync' ? 'Sync' : 'Async'}
          {props.section === 'lobbies' && ` · ${humans.length}/${g.settings.maxSeats} players`}
        </span>
      </div>
      <div className="row">
        <button
          type="button"
          className={props.section === 'yourMove' ? 'primary' : ''}
          onClick={() => props.onOpen(g.join_code)}
        >
          {props.section === 'finished' ? 'Open' : props.section === 'lobbies' ? 'Open lobby' : 'Play'}
        </button>
        {props.section === 'finished' && (
          <button type="button" onClick={() => props.onReplay(g.join_code)}>
            Replay
          </button>
        )}
      </div>
    </li>
  );
}

export function OnlineHome(props: {
  auth: AuthState;
  games: MyGames | null;
  gamesError: string | null;
  onCreate: () => void;
  onOpen: (code: string) => void;
  onReplay: (code: string) => void;
  onSignIn: () => void;
}) {
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const { auth, games } = props;
  const count = games ? waitingOnYou(games) : 0;

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const c = codeFromInput(code);
    if (!c) setBad(true);
    else props.onOpen(c);
  };

  return (
    <>
      <div className="menu">
        <button type="button" className="primary big" onClick={props.onCreate}>
          New online game
        </button>
        {!auth.session && (
          <button type="button" className="big" onClick={props.onSignIn}>
            Sign in
          </button>
        )}
      </div>
      <section aria-label="Join with a code">
        <h2>Join with a code</h2>
        <form className="row" onSubmit={go}>
          <input
            aria-label="Join code or link"
            placeholder="K7QM2X or a link"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setBad(false);
            }}
          />
          <button type="submit" disabled={!code.trim()}>
            Join
          </button>
        </form>
        {bad && <p className="hint">That is not a join code.</p>}
      </section>
      <section aria-label="My games">
        <h2>
          My games{' '}
          {count > 0 && (
            <span className="badge" title={`${count} waiting on you`}>
              {count}
            </span>
          )}
        </h2>
        {!auth.session ? (
          <p className="hint">Sign in to see your online games.</p>
        ) : props.gamesError ? (
          <p className="hint">{props.gamesError}</p>
        ) : !games ? (
          <p className="hint">Loading…</p>
        ) : (
          SECTIONS.map(({ key, title }) =>
            games[key].length === 0 ? null : (
              <div key={key}>
                <h3>{title}</h3>
                <ul className="saves">
                  {games[key].map((g) => (
                    <GameItem key={g.id} g={g} section={key} onOpen={props.onOpen} onReplay={props.onReplay} />
                  ))}
                </ul>
              </div>
            ),
          )
        )}
        {games && SECTIONS.every((s) => games[s.key].length === 0) && <p className="hint">No online games yet.</p>}
        {auth.session && (
          <p className="hint">
            Signed in as {auth.displayName ?? auth.session.user.email}.{' '}
            <button type="button" className="ghost" onClick={() => void auth.signOut()}>
              Sign out
            </button>
          </p>
        )}
      </section>
    </>
  );
}

export { fetchMyGames };

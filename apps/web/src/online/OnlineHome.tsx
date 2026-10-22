// The online half of the home screen (SPEC 1, 8.1): create / join, "My games" sections, and the account chip.
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
  /** The home screen's one amber button: the first game waiting on you. */
  primary: boolean;
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
          <span className="num">{g.join_code}</span> · {g.settings.winCondition === 'capitals' ? 'Capitals' : 'Classic'}{' '}
          · {g.settings.pace === 'sync' ? 'Sync' : 'Async'}
          {props.section === 'lobbies' && ` · ${humans.length}/${g.settings.maxSeats} players`}
        </span>
      </div>
      <div className="row">
        <button type="button" className={props.primary ? 'primary' : ''} onClick={() => props.onOpen(g.join_code)}>
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

/** Top right of the home screen: who is signed in, or a way to sign in. */
export function Account(props: { auth: AuthState; onSignIn: () => void }) {
  const { auth } = props;
  if (!auth.session) {
    return (
      <button type="button" onClick={props.onSignIn}>
        Sign in
      </button>
    );
  }
  return (
    <div className="account">
      <span className="sub">
        Signed in as <b>{auth.displayName ?? auth.session.user.email}</b>
      </span>
      <button type="button" className="ghost" onClick={() => void auth.signOut()}>
        Sign out
      </button>
    </div>
  );
}

export function OnlineHome(props: {
  auth: AuthState;
  games: MyGames | null;
  gamesError: string | null;
  onCreate: () => void;
  onOpen: (code: string) => void;
  onReplay: (code: string) => void;
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
    <section aria-labelledby="home-online">
      <h2 id="home-online">Online</h2>
      <p className="hint">Play with friends on their own devices, live or a turn a day.</p>
      <div className="menu">
        <button type="button" className="big" onClick={props.onCreate}>
          New online game
        </button>
      </div>
      <form className="row join-form" onSubmit={go}>
        <input
          aria-label="Join code or link"
          placeholder="Join code or link"
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
      {!auth.session ? (
        <p className="hint">Sign in to see your online games.</p>
      ) : (
        <>
          <h3>
            My games{' '}
            {count > 0 && (
              <span className="badge" title={`${count} waiting on you`}>
                {count}
              </span>
            )}
          </h3>
          {props.gamesError ? (
            <p className="hint">{props.gamesError}</p>
          ) : !games ? (
            <p className="hint">Loading…</p>
          ) : SECTIONS.every((s) => games[s.key].length === 0) ? (
            <p className="hint">No online games yet. Start one and send the link to your friends.</p>
          ) : (
            SECTIONS.map(({ key, title }) =>
              games[key].length === 0 ? null : (
                <div key={key}>
                  <h4>{title}</h4>
                  <ul className="saves">
                    {games[key].map((g, i) => (
                      <GameItem
                        key={g.id}
                        g={g}
                        section={key}
                        primary={key === 'yourMove' && i === 0}
                        onOpen={props.onOpen}
                        onReplay={props.onReplay}
                      />
                    ))}
                  </ul>
                </div>
              ),
            )
          )}
        </>
      )}
    </section>
  );
}

export { fetchMyGames };

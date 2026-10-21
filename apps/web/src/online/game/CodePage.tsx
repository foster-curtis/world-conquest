// `/g/:code` (SPEC 2 Join code & link): sign-in, join page, "already started", or the game itself.
import type { JoinLookupResponse } from '@wc/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameScreen } from '../../local/GameScreen.tsx';
import { NamePrompt, SignIn } from '../auth/SignIn.tsx';
import type { AuthState } from '../auth/useSession.ts';
import { type CodePage as CodePageState, codePage, type LookupState } from '../gameScreenState.ts';
import { Lobby } from '../lobby/Lobby.tsx';
import { replayPath, statsPath } from '../route.ts';
import { gameApi } from '../supabase.ts';
import { OnlineGame } from './OnlineGame.ts';
import { OnlineTimer } from './OnlineTimer.tsx';
import { useGameLive } from './useGameLive.ts';

export interface PageProps {
  code: string;
  auth: AuthState;
  navigate: (path: string) => void;
}

/** Looks the code up (join page data); reloads when the session changes. */
export function useLookup(code: string, signedIn: boolean): [LookupState, () => Promise<void>] {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  const load = useCallback(async () => {
    if (!signedIn) {
      setState({ status: 'idle' });
      return;
    }
    try {
      setState((s) => (s.status === 'ok' ? s : { status: 'loading' }));
      setState({ status: 'ok', lookup: await gameApi().lookup(code) });
    } catch (error) {
      setState({ status: 'failed', error });
    }
  }, [code, signedIn]);
  useEffect(() => {
    void load();
  }, [load]);
  return [state, load];
}

export function Message(props: { title: string; children?: React.ReactNode; onHome: () => void; reload?: boolean }) {
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{props.title}</h1>
      </div>
      <section>
        {props.children}
        <div className="row">
          {props.reload && (
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
          <button type="button" onClick={props.onHome}>
            Home
          </button>
        </div>
      </section>
    </div>
  );
}

export function CodePage({ code, auth, navigate }: PageProps) {
  const signedIn = Boolean(auth.session);
  const [state, reload] = useLookup(code, signedIn);
  const home = () => navigate('/');

  if (!auth.ready) return <p className="loading">Loading…</p>;
  if (signedIn && !auth.profileLoaded) return <p className="loading">Loading…</p>;
  if (signedIn && !auth.displayName) return <NamePrompt onSave={auth.saveName} />;

  const page: CodePageState = codePage(signedIn, state);
  switch (page.kind) {
    case 'signin':
      return <SignIn onBack={home} reason={`Sign in to open game ${code}. You will come back to this page.`} />;
    case 'loading':
      return <p className="loading">Loading…</p>;
    case 'not_found':
      return (
        <Message title="Game not found" onHome={home}>
          <p>There is no game with code {code}. Check the link.</p>
        </Message>
      );
    case 'error':
      return (
        <Message
          title={page.reload ? 'New version available' : 'Something went wrong'}
          onHome={home}
          reload={page.reload}
        >
          <p>{page.reload ? 'New version available, reload.' : page.message}</p>
        </Message>
      );
    case 'canceled':
      return (
        <Message title="Game canceled" onHome={home}>
          <p>This game was canceled.</p>
        </Message>
      );
    case 'started':
      return (
        <Message title="Already started" onHome={home}>
          <p>This game has already started.</p>
        </Message>
      );
    case 'join':
      return <JoinPage lookup={page.lookup} code={code} onJoined={reload} onHome={home} />;
    case 'member':
      return (
        <MemberGame
          key={page.lookup.gameId}
          lookup={page.lookup}
          code={code}
          userId={auth.session?.user.id as string}
          navigate={navigate}
        />
      );
  }
}

function JoinPage(props: {
  lookup: JoinLookupResponse;
  code: string;
  onJoined: () => Promise<void>;
  onHome: () => void;
}) {
  const { lookup } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = lookup.players >= lookup.maxSeats;
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      // displayName is overwritten by the function from the profile; the field is required by the type only.
      await gameApi().command(lookup.gameId, { type: 'JoinGame', displayName: '' });
      await props.onJoined();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join');
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <div className="screen-head">
        <button type="button" className="ghost" onClick={props.onHome}>
          ← Home
        </button>
        <h1>Join game</h1>
      </div>
      {error && (
        <div className="banner err" role="alert">
          {error}
        </div>
      )}
      <section>
        <p>{lookup.hostName ? <b>{lookup.hostName}</b> : 'Someone'} invited you to a game of World Conquest.</p>
        <p className="hint">
          Code {props.code} · {lookup.players}/{lookup.maxSeats} players
        </p>
        <button type="button" className="primary big" disabled={busy || full} onClick={() => void join()}>
          {full ? 'Game is full' : 'Join game'}
        </button>
      </section>
    </div>
  );
}

function MemberGame(props: {
  lookup: JoinLookupResponse;
  code: string;
  userId: string;
  navigate: (p: string) => void;
}) {
  const { lookup, code, navigate } = props;
  const game = useMemo(() => new OnlineGame(gameApi(), lookup.gameId), [lookup.gameId]);
  const [failed, setFailed] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => game.onChange(() => setTick((n) => n + 1)), [game]);
  useEffect(() => {
    void game.refresh().then(() => {
      if (!game.ready) setFailed('Could not load the game.');
    });
  }, [game]);

  const view = game.ready ? game.getView() : null;
  const live = useGameLive(game, props.userId, view?.viewer ?? null);
  const home = () => navigate('/');

  if (game.outdated) {
    return (
      <Message title="New version available" onHome={home} reload>
        <p>New version available, reload.</p>
      </Message>
    );
  }
  if (!view) {
    return failed ? (
      <Message title="Something went wrong" onHome={home}>
        <p>{failed}</p>
      </Message>
    ) : (
      <p className="loading">Loading…</p>
    );
  }
  if (view.phase.kind === 'canceled') {
    return (
      <Message title="Game canceled" onHome={home}>
        <p>This game was canceled.</p>
      </Message>
    );
  }
  if (view.phase.kind === 'lobby') {
    return <Lobby game={game} view={view} code={code} offline={game.offline} onHome={home} />;
  }
  return (
    <GameScreen
      key={game.id}
      game={game}
      showTip={false}
      warning={null}
      online={{
        offline: game.offline,
        present: live.present,
        notice: game.notice,
        topExtra: <OnlineTimer game={game} view={view} />,
      }}
      onHome={home}
      onReplay={() => navigate(replayPath(code))}
      onStats={() => navigate(statsPath(code))}
    />
  );
}

import type { WinCondition } from '@wc/engine';
import { useCallback, useEffect, useState } from 'react';
import { Loading } from './home/Brand.tsx';
import { Home } from './home/Home.tsx';
import { LocalGame as Local, type LocalGame, type PlayerInput } from './local/controller.ts';
import { GameScreen } from './local/GameScreen.tsx';
import { SetupScreen } from './local/SetupScreen.tsx';
import { openStore, type SaveMeta, type SaveStore } from './local/store.ts';
import { NamePrompt, SignIn } from './online/auth/SignIn.tsx';
import { useSession } from './online/auth/useSession.ts';
import { CodePage } from './online/game/CodePage.tsx';
import { ReplayPage } from './online/game/ReplayPage.tsx';
import { CreateGame } from './online/lobby/CreateGame.tsx';
import { Account, OnlineHome } from './online/OnlineHome.tsx';
import { gamePath, parseRoute, type Route, replayPath } from './online/route.ts';
import { onlineConfigured, onOutdated } from './online/supabase.ts';
import { useMyGames } from './online/useMyGames.ts';
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx';
import type { ReplayInput } from './replay/frames.ts';
import { ReplayScreen } from './replay/Replay.tsx';
import { StatsScreen } from './stats/Stats.tsx';

type Screen =
  | { kind: 'home' }
  | { kind: 'setup' }
  | { kind: 'online-new' }
  | { kind: 'signin' }
  | { kind: 'game'; game: LocalGame; showTip: boolean }
  | { kind: 'replay'; input: ReplayInput }
  | { kind: 'stats'; input: ReplayInput };

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [outdated, setOutdated] = useState(false);
  const auth = useSession();
  const my = useMyGames(auth, true);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => onOutdated(() => setOutdated(true)), []);

  /** Plain History API navigation (decision: no router library). */
  const navigate = useCallback(
    (path: string) => {
      if (window.location.pathname !== path) window.history.pushState(null, '', path);
      setRoute(parseRoute(path));
      my.refresh();
    },
    [my.refresh],
  );

  const [store, setStore] = useState<SaveStore | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (screen.kind === 'signin' && auth.session) setScreen({ kind: 'home' });
  }, [screen.kind, auth.session]);

  useEffect(() => {
    openStore().then((o) => {
      setStore(o.store);
      setWarning(o.warning);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (store) setSaves(await store.list());
  }, [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const goHome = async () => {
    if (screen.kind === 'game') await screen.game.flush();
    await refresh();
    setScreen({ kind: 'home' });
  };

  const start = async (players: PlayerInput[], win: WinCondition) => {
    if (!store) return;
    setBusy(true);
    try {
      const game = await Local.create(store, players, win);
      setScreen({ kind: 'game', game, showTip: true });
    } finally {
      setBusy(false);
    }
  };

  const resume = async (id: string) => {
    if (!store) return;
    const game = await Local.resume(store, id);
    if (game) setScreen({ kind: 'game', game, showTip: false });
  };

  const inputFor = async (id: string): Promise<ReplayInput | null> => {
    if (!store) return null;
    const rec = await store.load(id);
    return rec ? { gameId: rec.meta.id, settings: rec.meta.settings, events: rec.events } : null;
  };

  if (route.kind !== 'home') {
    const page =
      route.kind === 'game' ? (
        <CodePage code={route.code} auth={auth} navigate={navigate} />
      ) : (
        <ReplayPage code={route.code} auth={auth} navigate={navigate} stats={route.kind === 'stats'} />
      );
    return (
      <>
        {page}
        {outdated && <ReloadBanner />}
        <UpdatePrompt />
      </>
    );
  }

  if (!store) return <Loading />;

  const body = renderScreen(store);
  return (
    <>
      {body}
      {outdated && <ReloadBanner />}
      <UpdatePrompt />
    </>
  );

  function renderScreen(store: SaveStore) {
    switch (screen.kind) {
      case 'online-new':
        if (!auth.ready) return <Loading />;
        if (!auth.session) return <SignIn onBack={() => setScreen({ kind: 'home' })} />;
        if (!auth.profileLoaded) return <Loading />;
        if (!auth.displayName) return <NamePrompt onSave={auth.saveName} />;
        return <CreateGame onBack={() => setScreen({ kind: 'home' })} onCreated={(code) => navigate(gamePath(code))} />;
      case 'signin':
        if (auth.session) return <Loading />;
        return <SignIn onBack={() => setScreen({ kind: 'home' })} />;
      case 'setup':
        return <SetupScreen onStart={start} onBack={() => setScreen({ kind: 'home' })} busy={busy} />;
      case 'game': {
        const { game } = screen;
        const finished = () => ({ gameId: game.id, settings: game.settings, events: game.fullEvents() });
        return (
          <GameScreen
            key={game.id}
            game={game}
            showTip={screen.showTip}
            warning={store.persistent ? null : warning}
            onHome={goHome}
            onReplay={() => setScreen({ kind: 'replay', input: finished() })}
            onStats={() => setScreen({ kind: 'stats', input: finished() })}
          />
        );
      }
      case 'replay': {
        const { input } = screen;
        return <ReplayScreen input={input} onClose={goHome} onStats={() => setScreen({ kind: 'stats', input })} />;
      }
      case 'stats': {
        const { input } = screen;
        return <StatsScreen input={input} onClose={goHome} onReplay={() => setScreen({ kind: 'replay', input })} />;
      }
      default:
        return (
          <Home
            saves={saves}
            warning={warning}
            onNew={() => setScreen({ kind: 'setup' })}
            onResume={resume}
            onDelete={async (id) => {
              await store.remove(id);
              await refresh();
            }}
            onReplay={async (id) => {
              const input = await inputFor(id);
              if (input) setScreen({ kind: 'replay', input });
            }}
            onStats={async (id) => {
              const input = await inputFor(id);
              if (input) setScreen({ kind: 'stats', input });
            }}
            online={
              onlineConfigured ? (
                <OnlineHome
                  auth={auth}
                  games={my.games}
                  gamesError={my.error}
                  onCreate={() => setScreen({ kind: 'online-new' })}
                  onOpen={(code) => navigate(gamePath(code))}
                  onReplay={(code) => navigate(replayPath(code))}
                />
              ) : undefined
            }
            account={
              onlineConfigured ? <Account auth={auth} onSignIn={() => setScreen({ kind: 'signin' })} /> : undefined
            }
            onlineMove={Boolean(auth.session && my.games && my.games.yourMove.length > 0)}
          />
        );
    }
  }
}

function ReloadBanner() {
  return (
    <div className="banner warn reload" role="alert">
      New version available, reload.{' '}
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

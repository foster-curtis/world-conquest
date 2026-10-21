import type { WinCondition } from '@wc/engine';
import { useCallback, useEffect, useState } from 'react';
import { Home } from './home/Home.tsx';
import { LocalGame as Local, type LocalGame, type PlayerInput } from './local/controller.ts';
import { GameScreen } from './local/GameScreen.tsx';
import { SetupScreen } from './local/SetupScreen.tsx';
import { openStore, type SaveMeta, type SaveStore } from './local/store.ts';
import type { ReplayInput } from './replay/frames.ts';
import { ReplayScreen } from './replay/Replay.tsx';
import { StatsScreen } from './stats/Stats.tsx';

type Screen =
  | { kind: 'home' }
  | { kind: 'setup' }
  | { kind: 'game'; game: LocalGame; showTip: boolean }
  | { kind: 'replay'; input: ReplayInput }
  | { kind: 'stats'; input: ReplayInput };

export function App() {
  const [store, setStore] = useState<SaveStore | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [busy, setBusy] = useState(false);

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

  if (!store) return <p className="loading">Loading…</p>;

  switch (screen.kind) {
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
        />
      );
  }
}

// `/g/:code/replay` and `/g/:code/stats`: members only, after game over. Reuses M3's viewers with ReplayResponse.
import { useEffect, useState } from 'react';
import type { ReplayInput } from '../../replay/frames.ts';
import { ReplayScreen } from '../../replay/Replay.tsx';
import { StatsScreen } from '../../stats/Stats.tsx';
import { NamePrompt, SignIn } from '../auth/SignIn.tsx';
import { gamePath, replayPath, statsPath } from '../route.ts';
import { gameApi } from '../supabase.ts';
import { Message, type PageProps } from './CodePage.tsx';

type Load = { status: 'loading' } | { status: 'ok'; input: ReplayInput } | { status: 'failed'; message: string };

export function ReplayPage(props: PageProps & { stats?: boolean }) {
  const { code, auth, navigate } = props;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const signedIn = Boolean(auth.session);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      try {
        const lookup = await gameApi().lookup(code);
        const r = await gameApi().replay(lookup.gameId);
        if (live) setLoad({ status: 'ok', input: { gameId: r.gameId, settings: r.settings, events: r.events } });
      } catch (e) {
        if (live) setLoad({ status: 'failed', message: e instanceof Error ? e.message : 'Could not load the replay' });
      }
    })();
    return () => {
      live = false;
    };
  }, [code, signedIn]);

  const game = () => navigate(gamePath(code));
  if (!auth.ready || (signedIn && !auth.profileLoaded)) return <p className="loading">Loading…</p>;
  if (!signedIn) return <SignIn onBack={() => navigate('/')} reason="Sign in to watch this replay." />;
  if (!auth.displayName) return <NamePrompt onSave={auth.saveName} />;
  if (load.status === 'loading') return <p className="loading">Loading…</p>;
  if (load.status === 'failed') {
    return (
      <Message title="No replay" onHome={game}>
        <p>{load.message}</p>
      </Message>
    );
  }
  const { input } = load;
  return props.stats ? (
    <StatsScreen input={input} onClose={() => navigate('/')} onReplay={() => navigate(replayPath(code))} />
  ) : (
    <ReplayScreen input={input} onClose={() => navigate('/')} onStats={() => navigate(statsPath(code))} />
  );
}

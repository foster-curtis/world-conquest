// Loads "My games" and keeps it fresh (focus, every 30 s while visible); drives the badge and the tab title.
import { useCallback, useEffect, useState } from 'react';
import type { AuthState } from './auth/useSession.ts';
import { fetchMyGames, type MyGames, tabTitle, waitingOnYou } from './mygames.ts';
import { supabase } from './supabase.ts';

export function useMyGames(
  auth: AuthState,
  active: boolean,
): { games: MyGames | null; error: string | null; refresh: () => void } {
  const [games, setGames] = useState<MyGames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = auth.session?.user.id ?? null;

  const refresh = useCallback(() => {
    if (!uid) return;
    fetchMyGames(supabase(), uid)
      .then((g) => {
        setGames(g);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your games'));
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setGames(null);
      return;
    }
    refresh();
    if (!active) return;
    const visible = () => document.visibilityState === 'visible' && refresh();
    const t = setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [uid, active, refresh]);

  const count = games ? waitingOnYou(games) : 0;
  useEffect(() => {
    document.title = tabTitle(count);
  }, [count]);

  return { games, error, refresh };
}

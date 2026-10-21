// Realtime ping + presence + catch-up triggers (SPEC 7.8, 2 Presence). The ping only carries a version; the
// client then fetches its own view. Catch-up also runs on reconnect, tab refocus, and every 30 s while visible.
import { GAME_CHANNEL_PREFIX, VERSION_BROADCAST_EVENT } from '@wc/engine';
import { useEffect, useReducer, useState } from 'react';
import { supabase } from '../supabase.ts';
import type { OnlineGame } from './OnlineGame.ts';

export const POLL_MS = 30_000;

export function useGameLive(game: OnlineGame, userId: string, seat: number | null): { present: ReadonlySet<number> } {
  const [present, setPresent] = useState<ReadonlySet<number>>(new Set());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => game.onChange(rerender), [game]);

  useEffect(() => {
    const sb = supabase();
    const channel = sb.channel(`${GAME_CHANNEL_PREFIX}${game.id}`, { config: { presence: { key: userId } } });
    channel
      .on('broadcast', { event: VERSION_BROADCAST_EVENT }, (msg) => {
        const v = (msg.payload as { version?: unknown } | undefined)?.version;
        if (typeof v === 'number' && v > game.version) void game.refresh();
      })
      .on('presence', { event: 'sync' }, () => {
        const seats = new Set<number>();
        for (const metas of Object.values(channel.presenceState<{ seat: number | null }>())) {
          for (const m of metas) if (typeof m.seat === 'number') seats.add(m.seat);
        }
        setPresent(seats);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          game.setOffline(false);
          void channel.track({ seat });
          void game.refresh(); // anything missed while disconnected
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          game.setOffline(true);
        }
      });

    const visible = () => document.visibilityState === 'visible';
    const onVisible = () => visible() && void game.refresh();
    const onOnline = () => void game.refresh();
    const onOffline = () => game.setOffline(true);
    const poll = setInterval(() => visible() && void game.refresh(), POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      void sb.removeChannel(channel);
    };
  }, [game, userId, seat]);

  return { present };
}

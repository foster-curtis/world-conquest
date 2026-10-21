// "My games" (SPEC 8.1): members read their games' metadata directly (RLS); everything else goes through the function.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Color, GameSettings } from '@wc/engine';

export interface GameRow {
  id: string;
  join_code: string;
  status: 'lobby' | 'active' | 'finished' | 'canceled';
  phase: string;
  awaiting_seats: number[] | null;
  settings: GameSettings;
  updated_at: string;
  game_seats: {
    seat: number;
    user_id: string | null;
    display_name: string;
    color: Color;
    kind: string;
    status: string;
  }[];
}

export interface MyGames {
  yourMove: GameRow[];
  waiting: GameRow[];
  lobbies: GameRow[];
  finished: GameRow[];
}

const byRecent = (a: GameRow, b: GameRow) => b.updated_at.localeCompare(a.updated_at);

export function sectionize(rows: GameRow[], userId: string): MyGames {
  const out: MyGames = { yourMove: [], waiting: [], lobbies: [], finished: [] };
  for (const g of rows) {
    if (g.status === 'canceled' || g.phase === 'canceled') continue;
    const mine = g.game_seats.find((s) => s.user_id === userId);
    if (!mine) continue;
    if (g.status === 'finished') out.finished.push(g);
    else if (g.status === 'lobby') out.lobbies.push(g);
    else if (g.awaiting_seats?.includes(mine.seat)) out.yourMove.push(g);
    else out.waiting.push(g);
  }
  for (const list of Object.values(out)) list.sort(byRecent);
  return out;
}

/** Number shown in the badge and the tab title. */
export const waitingOnYou = (g: MyGames) => g.yourMove.length;

export function tabTitle(count: number): string {
  return count > 0 ? `(${count}) World Conquest` : 'World Conquest';
}

export async function fetchMyGames(client: SupabaseClient, userId: string): Promise<MyGames> {
  const { data, error } = await client
    .from('games')
    .select(
      'id, join_code, status, phase, awaiting_seats, settings, updated_at, game_seats(seat, user_id, display_name, color, kind, status)',
    )
    .neq('status', 'canceled')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return sectionize((data ?? []) as unknown as GameRow[], userId);
}

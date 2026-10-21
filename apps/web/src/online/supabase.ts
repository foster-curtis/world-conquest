// The browser's Supabase client (PKCE flow, session kept in localStorage) and the shared API client.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createApi, type GameApi } from './api.ts';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** False when the build has no Supabase env: online mode then explains itself instead of crashing. */
export const onlineConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!url || !key)
    throw new Error('Online mode is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).');
  client ??= createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } });
  return client;
}

type Outdated = () => void;
const outdatedListeners = new Set<Outdated>();
export const onOutdated = (fn: Outdated) => {
  outdatedListeners.add(fn);
  return () => {
    outdatedListeners.delete(fn);
  };
};

let api: GameApi | null = null;
export function gameApi(): GameApi {
  api ??= createApi({
    baseUrl: `${url}/functions/v1/game`,
    apiKey: key,
    getToken: async () => (await supabase().auth.getSession()).data.session?.access_token ?? null,
    onOutdated: () => {
      for (const l of outdatedListeners) l();
    },
  });
  return api;
}

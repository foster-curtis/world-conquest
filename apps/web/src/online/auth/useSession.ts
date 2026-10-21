// Session + profile state for the app shell.
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { onlineConfigured, supabase } from '../supabase.ts';
import { getDisplayName, saveDisplayName } from './auth.ts';

export interface AuthState {
  /** false until the stored session has been read */
  ready: boolean;
  session: Session | null;
  /** null = no profile yet (prompt for a name) */
  displayName: string | null;
  profileLoaded: boolean;
  saveName: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSession(): AuthState {
  const [ready, setReady] = useState(!onlineConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (!onlineConfigured) return;
    const sb = supabase();
    const { data } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    void sb.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id ?? null;
  useEffect(() => {
    setProfileLoaded(false);
    if (!uid) {
      setDisplayName(null);
      return;
    }
    let live = true;
    getDisplayName(supabase(), uid)
      .then((n) => live && setDisplayName(n))
      .catch(() => live && setDisplayName(null))
      .finally(() => live && setProfileLoaded(true));
    return () => {
      live = false;
    };
  }, [uid]);

  const saveName = useCallback(
    async (name: string) => {
      if (!uid) throw new Error('Not signed in');
      setDisplayName(await saveDisplayName(supabase(), uid, name));
    },
    [uid],
  );
  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
  }, []);
  return { ready, session, displayName, profileLoaded, saveName, signOut };
}

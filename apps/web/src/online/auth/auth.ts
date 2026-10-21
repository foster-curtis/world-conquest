// Sign-in helpers (SPEC 6 Auth): email magic link + 6-digit code, PKCE. The code path works on its own, since
// PKCE links only work in the browser that asked for them. Takes a client so tests can use their own.
import type { SupabaseClient } from '@supabase/supabase-js';

export const NAME_MAX = 40;

export function cleanName(raw: string): string | null {
  const n = raw.trim().replace(/\s+/g, ' ');
  return n.length >= 1 && n.length <= NAME_MAX ? n : null;
}

/** Sends the email. `redirectTo` is the current `/g/CODE` URL so the link returns the player to the game. */
export async function requestSignIn(client: SupabaseClient, email: string, redirectTo: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
  if (error) throw new Error(error.message);
}

export async function verifyCode(client: SupabaseClient, email: string, code: string): Promise<void> {
  const token = code.replace(/\D/g, '');
  const { error } = await client.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
  if (error) throw new Error(error.message);
}

export async function getDisplayName(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.display_name as string | undefined) ?? null;
}

export async function saveDisplayName(client: SupabaseClient, userId: string, name: string): Promise<string> {
  const clean = cleanName(name);
  if (!clean) throw new Error(`Enter a name of 1 to ${NAME_MAX} characters.`);
  const { error } = await client
    .from('profiles')
    .upsert({ user_id: userId, display_name: clean, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return clean;
}

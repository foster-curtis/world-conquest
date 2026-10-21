import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ANON_KEY, API_URL, MAIL_URL, uniqueEmail, waitFor } from './helpers.ts';

interface MailSummary {
  ID: string;
}

async function latestMail(email: string): Promise<{ Subject: string; Text: string; HTML: string }> {
  const found = await waitFor(async () => {
    const res = await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { messages: MailSummary[] };
    return body.messages[0] ?? null;
  });
  const res = await fetch(`${MAIL_URL}/api/v1/message/${found.ID}`);
  return (await res.json()) as { Subject: string; Text: string; HTML: string };
}

describe('auth email', () => {
  it('first sign-in email carries the link and a 6-digit code that signs in', async () => {
    const email = uniqueEmail('magic');
    const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, flowType: 'pkce' } });
    const sent = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'http://localhost:5173/g/K7QM2X' },
    });
    expect(sent.error).toBeNull();

    const mail = await latestMail(email);
    expect(mail.Subject).toBe('Your World Conquest sign-in code');
    const code = /\b(\d{6})\b/.exec(mail.Text)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.HTML).toContain('/auth/v1/verify');
    expect(mail.HTML).toContain('localhost:5173');

    const verified = await client.auth.verifyOtp({ email, token: code as string, type: 'email' });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.user.email).toBe(email);
  });
});

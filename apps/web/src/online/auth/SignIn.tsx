// Email -> magic link, with an "or enter the code" field (SPEC 6 Auth). Stays on the current URL.
import { type FormEvent, useState } from 'react';
import { supabase } from '../supabase.ts';
import { requestSignIn, verifyCode } from './auth.ts';

export function SignIn(props: { onBack?: () => void; reason?: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestSignIn(supabase(), email, window.location.href);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyCode(supabase(), email, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        {props.onBack && (
          <button type="button" className="ghost" onClick={props.onBack}>
            ← Home
          </button>
        )}
        <h1>Sign in</h1>
      </div>
      <section>
        <p className="hint">
          {props.reason ?? 'Online games need an account. We email you a sign-in link and a 6-digit code.'}
        </p>
        {error && (
          <div className="banner err" role="alert">
            {error}
          </div>
        )}
        <form className="stack" onSubmit={send}>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={busy || !email}>
            {sent ? 'Send again' : 'Email me a sign-in link'}
          </button>
        </form>
        {sent && (
          <form className="stack" onSubmit={verify}>
            <p>
              Check your email. Click the link, <b>or enter the code</b> here (use this if the link opens in another
              browser):
            </p>
            <label>
              6-digit code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button type="submit" className="primary" disabled={busy || code.replace(/\D/g, '').length < 6}>
              Sign in with code
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

export function NamePrompt(props: { onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await props.onSave(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Pick a display name</h1>
      </div>
      <section>
        <p className="hint">Other players see this name. You can change it later.</p>
        {error && (
          <div className="banner err" role="alert">
            {error}
          </div>
        )}
        <form className="stack" onSubmit={submit}>
          <label>
            Display name
            <input value={name} maxLength={40} required onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            Save
          </button>
        </form>
      </section>
    </div>
  );
}

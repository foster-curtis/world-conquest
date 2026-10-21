// Reads the local stack's URLs and keys from `supabase status` once, for every test worker.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default async function setup(): Promise<void> {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  let out: string;
  try {
    out = execSync('npx supabase status -o json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`local Supabase is not running; start it with \`npx supabase start\` (${String(e)})`);
  }
  const status = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  process.env.WC_API_URL = status.API_URL;
  process.env.WC_DB_URL = status.DB_URL;
  process.env.WC_ANON_KEY = status.ANON_KEY;
  process.env.WC_SERVICE_KEY = status.SERVICE_ROLE_KEY;
  process.env.WC_MAIL_URL = status.MAILPIT_URL ?? status.INBUCKET_URL;
  const res = await fetch(`${status.API_URL}/functions/v1/game/`, { method: 'OPTIONS' });
  if (!res.ok) throw new Error(`game function not reachable: ${res.status}`);
}

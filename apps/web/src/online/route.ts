// URL routing (decision: plain History API, no router library). SPEC 2: one URL per game for its whole life.
export type Route =
  | { kind: 'home' }
  | { kind: 'game'; code: string }
  | { kind: 'replay'; code: string }
  | { kind: 'stats'; code: string }
  | { kind: 'notfound' };

const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** `/` is home, `/g/CODE[/replay|/stats]` is a game, anything else (including a malformed code) is the 404 page. */
export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  const m = /^\/g\/([^/]+)(?:\/(replay|stats))?\/?$/.exec(pathname);
  if (!m) return { kind: 'notfound' };
  const code = m[1].toUpperCase();
  if (!CODE.test(code)) return { kind: 'notfound' };
  if (m[2] === 'replay') return { kind: 'replay', code };
  if (m[2] === 'stats') return { kind: 'stats', code };
  return { kind: 'game', code };
}

export const gamePath = (code: string) => `/g/${code}`;
export const replayPath = (code: string) => `/g/${code}/replay`;
export const statsPath = (code: string) => `/g/${code}/stats`;
export const gameUrl = (origin: string, code: string) => `${origin}${gamePath(code)}`;

/** Accepts a bare code or a pasted link. */
export function codeFromInput(raw: string): string | null {
  const t = raw.trim();
  const path = t.includes('/') ? (t.match(/\/g\/[^/?#]+(?:\/[a-z]+)?/i)?.[0] ?? '') : `/g/${t}`;
  const r = parseRoute(path);
  return 'code' in r ? r.code : null;
}

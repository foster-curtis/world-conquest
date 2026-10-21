// The single client for the `game` edge function (SPEC 6 Write path). Framework-free so the integration
// tests drive the very same code. Sends PROTOCOL_VERSION on every request; a 426 means "reload" (SPEC 9.4).
import {
  type ApiError,
  type ApiErrorCode,
  type Command,
  type CommandResponse,
  type CreateGameRequest,
  type CreateGameResponse,
  type JoinLookupResponse,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type ReplayResponse,
  type ViewResponse,
} from '@wc/engine';

export const RELOAD_MESSAGE = 'New version available, reload';

export class ApiException extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'NETWORK';
  constructor(status: number, code: ApiErrorCode | 'NETWORK', message: string) {
    super(message);
    this.name = 'ApiException';
    this.status = status;
    this.code = code;
  }
}

export interface ApiOptions {
  /** `<SUPABASE_URL>/functions/v1/game` */
  baseUrl: string;
  /** The user's current access token (null when signed out). */
  getToken: () => Promise<string | null> | string | null;
  /** The publishable key; the Supabase gateway wants it as `apikey` next to the user JWT. */
  apiKey?: string;
  /** Called on a 426 so the UI can show the "reload" prompt. */
  onOutdated?: () => void;
  fetch?: typeof fetch;
}

export interface GameApi {
  createGame(req?: CreateGameRequest): Promise<CreateGameResponse>;
  lookup(code: string): Promise<JoinLookupResponse>;
  command(gameId: string, command: Command, expectedVersion?: number): Promise<CommandResponse>;
  /** `since` omitted: the server answers with `events: null` (snap). */
  view(gameId: string, since?: number): Promise<ViewResponse>;
  replay(gameId: string): Promise<ReplayResponse>;
}

export function createApi(opts: ApiOptions): GameApi {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = await opts.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    };
    if (opts.apiKey) headers.apikey = opts.apiKey;
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await doFetch(opts.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiException(0, 'NETWORK', "You're offline or the server is unreachable");
    }
    if (res.status === 426) {
      opts.onOutdated?.();
      throw new ApiException(426, 'PROTOCOL_MISMATCH', RELOAD_MESSAGE);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON body: fall through to the generic error
    }
    if (!res.ok) {
      const err = (json as ApiError | null)?.error;
      throw new ApiException(res.status, err?.code ?? 'INTERNAL', err?.message ?? `Request failed (${res.status})`);
    }
    return json as T;
  }

  return {
    createGame: (req = {}) => request('POST', '/games', req),
    lookup: (code) => request('GET', `/join/${encodeURIComponent(code.toUpperCase())}`),
    command: (gameId, command, expectedVersion) =>
      request('POST', `/games/${gameId}/commands`, {
        command,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    view: (gameId, since) => request('GET', `/games/${gameId}/view${since === undefined ? '' : `?since=${since}`}`),
    replay: (gameId) => request('GET', `/games/${gameId}/replay`),
  };
}

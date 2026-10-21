// What `/g/:code` shows (SPEC 2 Join code & link). Pure so the routing states are unit-testable.
import type { JoinLookupResponse } from '@wc/engine';
import { ApiException } from './api.ts';

export type CodePage =
  | { kind: 'signin' } // signed-out visitors sign in first, then stay on the same URL
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string; reload: boolean }
  | { kind: 'join'; lookup: JoinLookupResponse } // non-member, lobby
  | { kind: 'started'; lookup: JoinLookupResponse } // non-member, after start
  | { kind: 'canceled'; lookup: JoinLookupResponse }
  | { kind: 'member'; lookup: JoinLookupResponse }; // the game itself: lobby, then board

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; lookup: JoinLookupResponse }
  | { status: 'failed'; error: unknown };

export function codePage(signedIn: boolean, state: LookupState): CodePage {
  if (!signedIn) return { kind: 'signin' };
  if (state.status === 'idle' || state.status === 'loading') return { kind: 'loading' };
  if (state.status === 'failed') {
    const e = state.error;
    if (e instanceof ApiException) {
      if (e.status === 404) return { kind: 'not_found' };
      return { kind: 'error', message: e.message, reload: e.status === 426 };
    }
    return { kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong', reload: false };
  }
  const { lookup } = state;
  if (lookup.phase === 'canceled') return { kind: 'canceled', lookup };
  if (lookup.isMember) return { kind: 'member', lookup };
  if (lookup.phase === 'lobby') return { kind: 'join', lookup };
  return { kind: 'started', lookup };
}

// Catch-up rules (SPEC 7.8): the client fetches `?since=<version>`; the answer is the current view plus the
// redacted events since then, or `events: null` to snap. Pure so the rules are unit-testable.
import type { GameEvent, PlayerView, SequencedEvent, ViewResponse } from '@wc/engine';

export interface SyncState {
  /** Version of `view`; null before the first response. */
  version: number | null;
  view: PlayerView | null;
  /** Everything seen this session, for the activity feed. */
  log: SequencedEvent[];
}

export const emptySync: SyncState = { version: null, view: null, log: [] };

export interface SyncResult {
  state: SyncState;
  /** Events to animate (none on the first load, a snap, or a stale response). */
  animate: GameEvent[];
  snapped: boolean;
  /** True when the response was older than what we already hold and was dropped. */
  ignored: boolean;
}

/** The `since` to send: the held version, or 0 on first load so the feed gets the history (the server snaps if too far behind). */
export function sinceFor(state: SyncState): number {
  return state.version ?? 0;
}

export function applyViewResponse(prev: SyncState, resp: ViewResponse): SyncResult {
  const version = resp.view.version;
  if (prev.version !== null && version < prev.version) {
    return { state: prev, animate: [], snapped: false, ignored: true };
  }
  const first = prev.version === null;
  if (resp.events === null) {
    // Too far behind (or no `since`): snap to the view, no animation. The feed restarts from here.
    return { state: { version, view: resp.view, log: [] }, animate: [], snapped: !first, ignored: false };
  }
  const have = prev.version ?? 0;
  const fresh = resp.events.filter((e) => e.seq > have);
  return {
    state: { version, view: resp.view, log: [...prev.log, ...fresh] },
    animate: first ? [] : fresh.map((e) => e.event),
    snapped: false,
    ignored: false,
  };
}

// A server-backed game: no optimistic updates, no offline queue (SPEC 7.8). Every command goes to the function,
// then the player's own view is fetched with `?since=`. Implements GameSource for the shared game screen.
import {
  type Command,
  type GameEvent,
  getMap,
  type MapDefinition,
  type PlayerView,
  type RejectionCode,
  type Result,
  type SeatId,
} from '@wc/engine';
import type { GameSource } from '../../gameSource.ts';
import { ApiException, type GameApi } from '../api.ts';
import { applyViewResponse, emptySync, type SyncState, sinceFor } from '../catchup.ts';

export const MOVED_ON = 'The game moved on; your view was refreshed.';

export class OnlineGame implements GameSource {
  readonly id: string;
  readonly map: MapDefinition;
  readonly players = [];
  private sync: SyncState = emptySync;
  private eventListeners = new Set<(events: GameEvent[]) => void>();
  private changeListeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;
  private again = false;
  private _offline = false;
  private _notice: string | null = null;
  outdated = false;

  private readonly api: GameApi;

  constructor(api: GameApi, gameId: string, mapId = 'classic') {
    this.api = api;
    this.id = gameId;
    const map = getMap(mapId);
    if (!map) throw new Error(`unknown map ${mapId}`);
    this.map = map;
  }

  // ---- reading

  get ready(): boolean {
    return this.sync.view !== null;
  }
  get version(): number {
    return this.sync.version ?? 0;
  }
  get offline(): boolean {
    return this._offline;
  }
  /** Short one-off message ("the game moved on"); cleared by the next successful command. */
  get notice(): string | null {
    return this._notice;
  }
  get phaseKind(): string {
    return this.sync.view?.phase.kind ?? 'lobby';
  }
  getView(): PlayerView {
    if (!this.sync.view) throw new Error('view not loaded yet');
    return this.sync.view;
  }
  visibleEvents(): GameEvent[] {
    return this.sync.log.map((e) => e.event);
  }
  actingSeat(): SeatId | null {
    return this.sync.view?.viewer ?? null;
  }
  needsPass(): boolean {
    return false;
  }
  confirmPass(): void {}

  subscribe(fn: (events: GameEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }
  private changed() {
    for (const l of this.changeListeners) l();
  }

  setOffline(v: boolean) {
    if (this._offline === v) return;
    this._offline = v;
    this.changed();
  }
  clearNotice() {
    if (this._notice === null) return;
    this._notice = null;
    this.changed();
  }

  // ---- catching up

  /** Fetches the view since the held version. Concurrent calls collapse into one follow-up fetch. */
  refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = (async () => {
      try {
        do {
          this.again = false;
          await this.fetchOnce();
        } while (this.again);
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  private async fetchOnce() {
    try {
      const resp = await this.api.view(this.id, sinceFor(this.sync));
      this.setOffline(false);
      const r = applyViewResponse(this.sync, resp);
      if (r.ignored) return;
      this.sync = r.state;
      if (r.animate.length > 0) for (const l of this.eventListeners) l(r.animate);
      this.changed();
    } catch (e) {
      this.noteFailure(e);
    }
  }

  private noteFailure(e: unknown) {
    if (e instanceof ApiException) {
      if (e.code === 'NETWORK') this.setOffline(true);
      if (e.status === 426) this.outdated = true;
    }
  }

  // ---- acting

  async dispatch(cmd: Command): Promise<Result<unknown>> {
    try {
      const res = await this.api.command(this.id, cmd, this.version);
      this.setOffline(false);
      this._notice = null;
      await this.refresh();
      return { ok: true, value: res };
    } catch (e) {
      this.noteFailure(e);
      if (e instanceof ApiException) {
        if (e.code === 'STALE_VERSION') {
          this._notice = MOVED_ON;
          await this.refresh();
          return { ok: false, error: { code: 'STALE_VERSION', message: MOVED_ON } };
        }
        const code = e.code === 'NETWORK' || e.status >= 500 ? 'WRONG_PHASE' : (e.code as RejectionCode);
        return { ok: false, error: { code, message: e.message } };
      }
      return { ok: false, error: { code: 'WRONG_PHASE', message: e instanceof Error ? e.message : 'Failed' } };
    }
  }
}

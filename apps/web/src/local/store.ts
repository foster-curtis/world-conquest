// Pass-and-play persistence (SPEC 7.8): events are appended to IndexedDB after every command.
// Falls back to an in-memory store (with a visible warning in the UI) when IndexedDB is unavailable.
import type { Color, GameEvent, GameSettings, SeatId } from '@wc/engine';

export interface SavedPlayer {
  seat: SeatId;
  name: string;
  color: Color;
}

export interface SaveMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  settings: GameSettings;
  players: SavedPlayer[];
  status: 'playing' | 'finished';
  winner: SeatId | null;
  eventCount: number;
}

export interface SaveRecord {
  meta: SaveMeta;
  events: GameEvent[];
}

export interface SaveStore {
  /** false for the in-memory fallback. */
  readonly persistent: boolean;
  list(): Promise<SaveMeta[]>;
  load(id: string): Promise<SaveRecord | null>;
  /** Writes `events` starting at index `from`, and the new meta, atomically. */
  append(meta: SaveMeta, events: GameEvent[], from: number): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryStore(): SaveStore {
  const games = new Map<string, SaveRecord>();
  return {
    persistent: false,
    async list() {
      return [...games.values()].map((g) => g.meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async load(id) {
      const g = games.get(id);
      return g ? { meta: g.meta, events: [...g.events] } : null;
    },
    async append(meta, events, from) {
      const g = games.get(meta.id) ?? { meta, events: [] };
      g.events.splice(from, g.events.length - from, ...events);
      g.meta = meta;
      games.set(meta.id, g);
    },
    async remove(id) {
      games.delete(id);
    },
  };
}

const DB_NAME = 'wc-local';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Opens the IndexedDB store; rejects if IndexedDB is missing or blocked. */
export async function idbStore(factory: IDBFactory = indexedDB): Promise<SaveStore> {
  const open = factory.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('meta', { keyPath: 'id' });
    db.createObjectStore('events', { keyPath: ['id', 'n'] });
  };
  const db = await wrap(open);
  const range = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  return {
    persistent: true,
    async list() {
      const all = await wrap(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<SaveMeta[]>);
      return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async load(id) {
      const tx = db.transaction(['meta', 'events']);
      const meta = await wrap(tx.objectStore('meta').get(id) as IDBRequest<SaveMeta | undefined>);
      if (!meta) return null;
      const rows = await wrap(
        tx.objectStore('events').getAll(range(id)) as IDBRequest<{ id: string; n: number; event: GameEvent }[]>,
      );
      return { meta, events: rows.sort((a, b) => a.n - b.n).map((r) => r.event) };
    },
    async append(meta, events, from) {
      const tx = db.transaction(['meta', 'events'], 'readwrite');
      const store = tx.objectStore('events');
      events.forEach((event, i) => {
        store.put({ id: meta.id, n: from + i, event });
      });
      tx.objectStore('meta').put(meta);
      await done(tx);
    },
    async remove(id) {
      const tx = db.transaction(['meta', 'events'], 'readwrite');
      tx.objectStore('meta').delete(id);
      tx.objectStore('events').delete(range(id));
      await done(tx);
    },
  };
}

export interface OpenedStore {
  store: SaveStore;
  /** Set when saving to disk is unavailable; show it to the user. */
  warning: string | null;
}

export async function openStore(): Promise<OpenedStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    return { store: await idbStore(), warning: null };
  } catch {
    return {
      store: memoryStore(),
      warning:
        'Saving is unavailable in this browser (private mode?). The game will be lost if you close or reload this tab.',
    };
  }
}

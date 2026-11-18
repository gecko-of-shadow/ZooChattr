// Remember emotes: every downloaded emote list is kept in localStorage (which lives in the ZooChattr-data folder),
// so pictures show the moment a channel opens instead of after three downloads. Stale-while-revalidate: an old
// list is used right away and refreshed in the background. Bounded: at most MAX_SETS lists, least recently used
// dropped first. A 1,000-emote 7TV channel is about 500 KB, so a handful of big channels can fill the storage
// long before MAX_SETS: when a write does not fit, the least recently used lists are dropped until it does.
import type { Emote, EmoteScope } from "./types";

const HOUR = 3_600_000;
/** How old a list may get before it's downloaded again (it keeps being used meanwhile). */
export const FRESH_FOR: Record<EmoteScope, number> = { channel: 1 * HOUR, global: 12 * HOUR };
const MAX_SETS = 60;
const PREFIX = "zoochattr.emotes.";
const INDEX_KEY = `${PREFIX}index`;

interface Entry {
  at: number;
  scope: EmoteScope;
  emotes: Emote[];
}

export interface CacheHit {
  emotes: Emote[];
  /** Older than FRESH_FOR: use it, but download a fresh copy too. */
  stale: boolean;
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Present on real `localStorage`; lets `clear()` sweep entries the index lost track of. */
  readonly length?: number;
  key?(index: number): string | null;
}

/** A stored list is only trusted if every entry still looks like an emote (the file may have been cut short or edited). */
function validEmotes(value: unknown): value is Emote[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        e &&
        typeof e === "object" &&
        typeof (e as Emote).id === "string" &&
        typeof (e as Emote).name === "string" &&
        typeof (e as Emote).url1x === "string" &&
        typeof (e as Emote).provider === "string",
    )
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): Record<string, number> {
  try {
    const parsed = JSON.parse(store.getItem(INDEX_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class EmoteCache {
  constructor(private readonly store: Storage | null = storage(), private readonly now: () => number = Date.now) {}

  get available(): boolean {
    return this.store !== null;
  }

  get(key: string): CacheHit | null {
    const store = this.store;
    if (!store) return null;
    let entry: Partial<Entry>;
    try {
      const raw = store.getItem(PREFIX + key);
      if (!raw) return null;
      entry = JSON.parse(raw) as Partial<Entry>;
    } catch {
      return null;
    }
    if (!validEmotes(entry.emotes) || typeof entry.at !== "number" || !(entry.scope! in FRESH_FOR)) {
      try {
        store.removeItem(PREFIX + key);
      } catch {
        // nothing more to do
      }
      return null;
    }
    const stale = this.now() - entry.at > FRESH_FOR[entry.scope as EmoteScope];
    try {
      this.touch(store, key);
    } catch {
      // Couldn't update the index (quota); the hit itself is still good.
    }
    return { emotes: entry.emotes, stale };
  }

  put(key: string, scope: EmoteScope, emotes: Emote[]): void {
    const store = this.store;
    if (!store) return;
    const value = JSON.stringify({ at: this.now(), scope, emotes } satisfies Entry);
    // Storage full: drop the least recently used lists, one at a time, until this one fits.
    let freed = 0;
    for (;;) {
      try {
        store.setItem(PREFIX + key, value);
        break;
      } catch {
        // Freed more than this list needs and it still does not fit: it never will, so keep the other lists.
        if (freed > value.length) return;
        const dropped = this.dropOldest(store, key);
        if (dropped === null) return; // Nothing left to drop (or private mode): live without the cache.
        freed += dropped;
      }
    }
    try {
      this.touch(store, key, true);
    } catch {
      // No room for the index entry: don't leave an orphan behind.
      try {
        store.removeItem(PREFIX + key);
      } catch {
        // nothing more to do
      }
    }
  }

  clear(): void {
    const store = this.store;
    if (!store) return;
    const index = readIndex(store);
    for (const key of Object.keys(index)) store.removeItem(PREFIX + key);
    store.removeItem(INDEX_KEY);
    // Sweep anything the index lost track of (e.g. an entry whose index write failed).
    if (typeof store.length === "number" && store.key) {
      const strays: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const name = store.key(i);
        if (name?.startsWith(PREFIX)) strays.push(name);
      }
      for (const name of strays) store.removeItem(name);
    }
  }

  /** Number of lists kept. */
  get size(): number {
    return this.store ? Object.keys(readIndex(this.store)).length : 0;
  }

  /**
   * Removes the least recently used list other than `keep` and returns how many characters that freed.
   * Null when there is none (or storage refuses).
   */
  private dropOldest(store: Storage, keep: string): number | null {
    try {
      const index = readIndex(store);
      const oldest = Object.keys(index)
        .filter((k) => k !== keep)
        .sort((a, b) => index[a] - index[b])[0];
      if (oldest === undefined) return null;
      const size = store.getItem(PREFIX + oldest)?.length ?? 0;
      store.removeItem(PREFIX + oldest);
      delete index[oldest];
      // Removing an entry frees room, so this smaller index fits where the old one did.
      store.setItem(INDEX_KEY, JSON.stringify(index));
      return size;
    } catch {
      return null;
    }
  }

  /** Marks `key` as just used; drops the oldest lists when there are too many. */
  private touch(store: Storage, key: string, prune = false): void {
    const index = readIndex(store);
    index[key] = this.now();
    if (prune) {
      const keys = Object.keys(index).sort((a, b) => index[a] - index[b]);
      for (const drop of keys.slice(0, Math.max(0, keys.length - MAX_SETS))) {
        delete index[drop];
        store.removeItem(PREFIX + drop);
      }
    }
    store.setItem(INDEX_KEY, JSON.stringify(index));
  }
}

export const emoteCache = new EmoteCache();

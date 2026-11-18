import { describe, expect, it } from "vitest";
import { EmoteCache, FRESH_FOR } from "./cache";
import type { Emote } from "./types";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => [...map.keys()],
  };
}

const emote = (name: string): Emote => ({ id: name, name, provider: "bttv", scope: "global", url1x: "x", zeroWidth: false });

describe("EmoteCache", () => {
  it("remembers a list and says when it is stale", () => {
    let now = 1_000_000;
    const cache = new EmoteCache(memoryStorage(), () => now);
    cache.put("bttv:global", "global", [emote("a")]);
    expect(cache.get("bttv:global")).toEqual({ emotes: [emote("a")], stale: false });
    now += FRESH_FOR.global + 1;
    expect(cache.get("bttv:global")?.stale).toBe(true);
    expect(cache.get("missing")).toBeNull();
  });

  it("drops the least recently used lists past the limit", () => {
    let now = 0;
    const store = memoryStorage();
    const cache = new EmoteCache(store, () => ++now);
    for (let i = 0; i < 65; i++) cache.put(`7tv:channel:${i}`, "channel", []);
    expect(cache.size).toBe(60);
    expect(cache.get("7tv:channel:0")).toBeNull();
    expect(cache.get("7tv:channel:64")).not.toBeNull();
  });

  it("clears everything it wrote", () => {
    const store = memoryStorage();
    const cache = new EmoteCache(store, () => 1);
    cache.put("ffz:global", "global", []);
    cache.clear();
    expect(store.keys()).toEqual([]);
  });

  it("treats a damaged list as a miss and removes it", () => {
    const store = memoryStorage();
    const cache = new EmoteCache(store, () => 1);
    store.setItem("zoochattr.emotes.7tv:global", JSON.stringify({ at: 1, scope: "global", emotes: [{ id: "1" }, "junk"] }));
    expect(cache.get("7tv:global")).toBeNull();
    expect(store.getItem("zoochattr.emotes.7tv:global")).toBeNull();
    store.setItem("zoochattr.emotes.bttv:global", "{not json");
    expect(cache.get("bttv:global")).toBeNull();
  });

  it("leaves no orphan when the index write fails, and sweeps strays on clear", () => {
    const store = memoryStorage();
    let failIndex = false;
    const flaky = {
      ...store,
      setItem: (k: string, v: string) => {
        if (failIndex && k.endsWith("index")) throw new Error("QuotaExceededError");
        store.setItem(k, v);
      },
    };
    const cache = new EmoteCache(flaky, () => 1);
    failIndex = true;
    cache.put("ffz:global", "global", [emote("a")]);
    expect(store.keys()).toEqual([]);
    failIndex = false;
    cache.put("ffz:global", "global", [emote("a")]);
    store.setItem("zoochattr.emotes.stray", "{}");
    const sweepable = { ...flaky, length: 0, key: (i: number) => store.keys()[i] ?? null };
    Object.defineProperty(sweepable, "length", { get: () => store.keys().length });
    new EmoteCache(sweepable, () => 1).clear();
    expect(store.keys()).toEqual([]);
  });

  it("drops the least recently used lists when the storage is full", () => {
    const store = memoryStorage();
    // A storage with room for about two lists (the index is small and always fits).
    const LIMIT = 700;
    const used = (skip: string) =>
      store.keys().reduce((n, k) => (k === skip || k.endsWith("index") ? n : n + (store.getItem(k)?.length ?? 0)), 0);
    const small = {
      ...store,
      setItem: (k: string, v: string) => {
        if (!k.endsWith("index") && used(k) + v.length > LIMIT) throw new Error("QuotaExceededError");
        store.setItem(k, v);
      },
    };
    let now = 0;
    const cache = new EmoteCache(small, () => ++now);
    const list = (tag: string) => Array.from({ length: 3 }, (_, i) => emote(`${tag}${i}`));
    cache.put("7tv:channel:1", "channel", list("a"));
    cache.put("7tv:channel:2", "channel", list("b"));
    expect(cache.size).toBe(2);
    cache.get("7tv:channel:1"); // channel 1 was used last, so channel 2 is the one to go
    cache.put("7tv:channel:3", "channel", list("c"));
    expect(cache.get("7tv:channel:3")?.emotes).toHaveLength(3);
    expect(cache.get("7tv:channel:1")).not.toBeNull();
    expect(cache.get("7tv:channel:2")).toBeNull();
    expect(cache.size).toBe(2);

  });

  it("stops dropping lists when the new one still does not fit", () => {
    const store = memoryStorage();
    // Something else has filled the storage: this one key can never be written.
    const full = {
      ...store,
      setItem: (k: string, v: string) => {
        if (k.endsWith("channel:new")) throw new Error("QuotaExceededError");
        store.setItem(k, v);
      },
    };
    let now = 0;
    const cache = new EmoteCache(full, () => ++now);
    const list = (tag: string) => Array.from({ length: 3 }, (_, i) => emote(`${tag}${i}`));
    for (const id of ["1", "2", "3"]) cache.put(`7tv:channel:${id}`, "channel", list(id));
    cache.put("7tv:channel:new", "channel", [emote("small")]);
    expect(cache.get("7tv:channel:new")).toBeNull();
    // One older list made more room than the new list needs; the rest are kept.
    expect(cache.size).toBe(2);
    expect(cache.get("7tv:channel:3")).not.toBeNull();
  });

  it("does nothing without storage", () => {
    const cache = new EmoteCache(null);
    cache.put("x", "global", []);
    expect(cache.get("x")).toBeNull();
    expect(cache.available).toBe(false);
  });
});

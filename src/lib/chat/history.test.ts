import { describe, expect, it } from "vitest";
import {
  HISTORY_HARD_CAP,
  HISTORY_TTL_MS,
  historyBoundary,
  isHistoryBoundary,
  messagesForDisk,
  sanitizeHistory,
  trimLiveBuffer,
} from "./history";
import type { ChatMessage } from "@/lib/twitch/types";

const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  channel: "geckotown",
  kind: "chat",
  ts: Date.now(),
  badges: [],
  text: "hi",
  twitchEmotes: [],
  ...over,
});

describe("chat history (48h)", () => {
  it("keeps real chat rows and drops pending / boundary rows", () => {
    const now = 1_700_000_000_000;
    const disk = messagesForDisk(
      [
        base({ id: "a", text: "one", ts: now - 1_000 }),
        historyBoundary("geckotown"),
        base({ id: "b", text: "two", ts: now - 500, pending: "sending" }),
        base({ id: "c", text: "three", ts: now }),
      ],
      now,
    );
    expect(disk.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("drops messages older than 48 hours", () => {
    const now = 1_700_000_000_000;
    const disk = messagesForDisk(
      [
        base({ id: "old", ts: now - HISTORY_TTL_MS - 1 }),
        base({ id: "fresh", ts: now - 60_000 }),
      ],
      now,
    );
    expect(disk.map((m) => m.id)).toEqual(["fresh"]);
  });

  it("puts lines appended out of order back in time order, ties in file order", () => {
    const now = 1_700_000_000_000;
    const loaded = sanitizeHistory(
      [
        base({ id: "a", ts: now - 9_000 }),
        base({ id: "live", ts: now - 1_000 }),
        // Filled in from the history server after "live" was already written.
        base({ id: "gap-1", ts: now - 5_000 }),
        base({ id: "gap-2", ts: now - 5_000 }),
      ],
      now,
    );
    expect(loaded.map((m) => m.id)).toEqual(["a", "gap-1", "gap-2", "live"]);
  });

  it("sanitizes junk from disk", () => {
    const now = 1_700_000_000_000;
    const cleaned = sanitizeHistory(
      [
        { id: "ok", channel: "x", kind: "chat", ts: now, text: "yep", badges: [], twitchEmotes: [] },
        { id: "nope" },
        historyBoundary("x"),
        null,
      ],
      now,
    );
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].text).toBe("yep");
    expect(cleaned.every((m) => !isHistoryBoundary(m))).toBe(true);
  });

  it("returns the same array when disk does not need to strip or trim", () => {
    const now = 1_700_000_000_000;
    const messages = [base({ id: "a", ts: now - 1_000 }), base({ id: "b", ts: now })];
    expect(messagesForDisk(messages, now)).toBe(messages);
  });

  it("returns the same array when every live row is still inside the cap", () => {
    const now = 1_700_000_000_000;
    const messages = [base({ id: "a", ts: now - 1_000 }), base({ id: "b", ts: now })];
    expect(trimLiveBuffer(messages, now)).toBe(messages);
  });

  it("drops only the expired prefix and keeps the array tail", () => {
    const now = 1_700_000_000_000;
    const messages = [
      base({ id: "old", ts: now - HISTORY_TTL_MS - 5 }),
      base({ id: "fresh", ts: now - 1_000 }),
    ];
    expect(trimLiveBuffer(messages, now).map((m) => m.id)).toEqual(["fresh"]);
  });

  it("keeps the newest rows when a saved log is over the cap", () => {
    const now = 1_700_000_000_000;
    const raw = Array.from({ length: HISTORY_HARD_CAP + 10 }, (_, i) => ({
      id: String(i),
      channel: "x",
      kind: "chat",
      ts: now - (HISTORY_HARD_CAP + 10 - i),
      text: "y",
      badges: [],
      twitchEmotes: [],
    }));
    const cleaned = sanitizeHistory(raw, now);
    expect(cleaned).toHaveLength(HISTORY_HARD_CAP);
    expect(cleaned[0].id).toBe("10");
    expect(cleaned.at(-1)?.id).toBe(String(HISTORY_HARD_CAP + 9));
  });

  it("hard-caps a buffer that is still inside the time window", () => {
    const now = 1_700_000_000_000;
    const messages = Array.from({ length: HISTORY_HARD_CAP + 10 }, (_, i) =>
      base({ id: String(i), ts: now - (HISTORY_HARD_CAP + 10 - i) }),
    );
    const kept = trimLiveBuffer(messages, now);
    expect(kept).toHaveLength(HISTORY_HARD_CAP);
    expect(kept[0].id).toBe("10");
    expect(kept.at(-1)?.id).toBe(String(HISTORY_HARD_CAP + 9));
  });
});

describe("saved lines with an impossible time", () => {
  const now = 1_700_000_000_000;

  it.each([1e18, 8_640_000_000_000_001, now + 3 * 24 * 60 * 60_000, -1, 0])("skips a line stamped %d and keeps the rest", (ts) => {
    const kept = sanitizeHistory([base({ id: "good", ts: now - 1_000 }), base({ id: "bad", ts })], now);
    expect(kept.map((m) => m.id)).toEqual(["good"]);
  });

  it("keeps a line a little ahead of this computer's clock", () => {
    expect(sanitizeHistory([base({ id: "ahead", ts: now + 60_000 })], now).map((m) => m.id)).toEqual(["ahead"]);
  });
});

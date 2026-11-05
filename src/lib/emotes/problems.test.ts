import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problemLog } from "./problems";

describe("problemLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    problemLog.clear();
  });

  afterEach(() => {
    problemLog.clear();
    vi.useRealTimers();
  });

  it("keeps one entry for a failure that repeats every hour, with the latest time", () => {
    const start = Date.now();
    problemLog.record("7tv", "channel", "7TV answered 503", "geckotown");
    vi.setSystemTime(start + 61 * 60_000);
    problemLog.record("7tv", "channel", "7TV answered 503", "geckotown");
    vi.setSystemTime(start + 122 * 60_000);
    problemLog.record("7tv", "channel", "7TV answered 503", "geckotown");
    const entries = problemLog.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].at).toBe(start + 122 * 60_000);
  });

  it("still lists a different channel, provider or message, and the same failure after a long pause", () => {
    const start = Date.now();
    problemLog.record("7tv", "channel", "7TV answered 503", "geckotown");
    problemLog.record("7tv", "channel", "7TV answered 503", "lizardlounge");
    problemLog.record("bttv", "channel", "7TV answered 503", "geckotown");
    problemLog.record("7tv", "channel", "timed out", "geckotown");
    expect(problemLog.size).toBe(4);
    vi.setSystemTime(start + 3 * 60 * 60_000);
    problemLog.record("7tv", "channel", "7TV answered 503", "geckotown");
    expect(problemLog.size).toBe(5);
  });
});

describe("a damaged saved list", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("can't give Settings a time it can't format", async () => {
    const saved = JSON.stringify([{ id: "p", at: 1e18, provider: "7tv", scope: "global", message: "x" }]);
    vi.stubGlobal("localStorage", { getItem: () => saved, setItem: () => undefined, removeItem: () => undefined });
    vi.resetModules();
    const { problemLog: fresh } = await import("./problems");
    expect(() => new Date(fresh.list()[0].at).toISOString()).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { EmoteCache } from "./cache";
import { problemLog } from "./problems";
import { EmoteRegistry } from "./registry";
import type { Emote, ThirdPartyProvider } from "./types";

describe("channelNeedsRetry", () => {
  it("is not a failed download when the channel has not been loaded yet", () => {
    expect(new EmoteRegistry().channelNeedsRetry("geckotown")).toBe(false);
  });
});

describe("retryChannel / retryGlobal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    problemLog.clear();
  });

  /** Answers every emote server; FrankerFaceZ fails while `ffzDown` is true. Counts requests per server. */
  function stubServers() {
    const state = { ffzDown: true, asked: { "7tv": 0, bttv: 0, ffz: 0 } };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes("frankerfacez")) {
        state.asked.ffz++;
        if (state.ffzDown) return new Response("", { status: 522 });
        const emoticons = [{ id: 1, name: "ZreknarF", urls: { "1": "//cdn.frankerfacez.com/emote/1/1" } }];
        return json(url.includes("/room/") ? { room: { set: 9 }, sets: { 9: { emoticons } } } : { default_sets: [3], sets: { 3: { emoticons } } });
      }
      if (url.includes("betterttv")) {
        state.asked.bttv++;
        return json(url.includes("/users/") ? { channelEmotes: [], sharedEmotes: [] } : []);
      }
      state.asked["7tv"]++;
      return json(url.includes("/users/") ? { emote_set: { emotes: [] } } : { emotes: [] });
    });
    return state;
  }

  it("asks only the source that failed, and shows its emotes once it answers", async () => {
    const servers = stubServers();
    const registry = new EmoteRegistry(new EmoteCache(null));
    await registry.loadChannel("geckotown", "1");
    expect(registry.getChannelStatus("geckotown")?.ffz).toEqual({ state: "error", error: "HTTP 522" });
    expect(registry.channelNeedsRetry("geckotown")).toBe(true);
    expect(servers.asked).toEqual({ "7tv": 1, bttv: 1, ffz: 1 });

    await registry.retryChannel("geckotown"); // still down: stays an error
    expect(registry.channelNeedsRetry("geckotown")).toBe(true);
    servers.ffzDown = false;
    await registry.retryChannel("geckotown");
    expect(servers.asked).toEqual({ "7tv": 1, bttv: 1, ffz: 3 });
    expect(registry.getChannelStatus("geckotown")?.ffz).toEqual({ state: "ok", count: 1 });
    expect(registry.lookup("geckotown").has("ZreknarF")).toBe(true);
    expect(registry.channelNeedsRetry("geckotown")).toBe(false);

    await registry.retryChannel("geckotown"); // nothing failed: nothing is asked
    expect(servers.asked.ffz).toBe(3);
  });

  it("does the same for the global lists", async () => {
    const servers = stubServers();
    const registry = new EmoteRegistry(new EmoteCache(null));
    await registry.loadGlobal();
    expect(registry.globalNeedsRetry()).toBe(true);
    servers.ffzDown = false;
    await registry.retryGlobal();
    expect(servers.asked).toEqual({ "7tv": 1, bttv: 1, ffz: 2 });
    expect(registry.globalNeedsRetry()).toBe(false);
    expect(registry.lookup("geckotown").has("ZreknarF")).toBe(true);
  });
});

const emote = (name: string, provider: ThirdPartyProvider, scope: "channel" | "global"): Emote =>
  ({ id: `${provider}-${name}`, name, provider, scope }) as Emote;

describe("providerEmotes (emote panel BTTV / 7TV tabs)", () => {
  it("lists every emote of one provider, even names another provider wins in chat", () => {
    const registry = new EmoteRegistry();
    // Fill the private lists the way a finished download would.
    const internals = registry as unknown as { global: Record<ThirdPartyProvider, Emote[]> };
    internals.global.bttv = [emote("catJAM", "bttv", "global"), emote("monkaS", "bttv", "global")];
    internals.global["7tv"] = [emote("catJAM", "7tv", "global")];

    expect(registry.lookup("geckotown").get("catJAM")?.provider).toBe("7tv");
    expect(registry.providerEmotes("geckotown", "bttv").map((e) => e.name)).toEqual(["catJAM", "monkaS"]);
    expect(registry.providerEmotes("geckotown", "7tv").map((e) => e.name)).toEqual(["catJAM"]);
  });
});

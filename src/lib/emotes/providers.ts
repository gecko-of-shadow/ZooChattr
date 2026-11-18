import { config } from "@/lib/config";
import type { Emote, EmoteScope, ThirdPartyProvider } from "./types";

export class NotFoundError extends Error {}

/** A struggling emote server can take about 20 s to answer; giving up sooner loses a list it would have sent. */
const TIMEOUT_MS = 25_000;

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) throw new NotFoundError(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 7TV ----

interface SevenTvFile {
  name: string;
  width: number;
  height: number;
  format: string;
}

interface SevenTvActiveEmote {
  id: string;
  name: string;
  flags?: number;
  data?: {
    flags?: number;
    animated?: boolean;
    host?: { url: string; files?: SevenTvFile[] };
  };
}

export function parseSevenTvEmotes(emotes: SevenTvActiveEmote[] | null | undefined, scope: EmoteScope): Emote[] {
  const out: Emote[] = [];
  for (const emote of emotes ?? []) {
    const host = emote.data?.host;
    if (!host?.url || !emote.name) continue;
    const base = host.url.startsWith("//") ? `https:${host.url}` : host.url;
    const files = host.files ?? [];
    const has = (name: string) => files.length === 0 || files.some((f) => f.name === name);
    const first = files.find((f) => f.name === "1x.webp");
    const animated = !!emote.data?.animated;
    out.push({
      id: emote.id,
      name: emote.name,
      provider: "7tv",
      scope,
      url1x: `${base}/1x.webp`,
      url2x: has("2x.webp") ? `${base}/2x.webp` : undefined,
      url4x: has("4x.webp") ? `${base}/4x.webp` : undefined,
      width: first?.width,
      height: first?.height,
      // Active-emote flag 1 = zero-width override; emote flag 256 = zero-width by design.
      zeroWidth: ((emote.flags ?? 0) & 1) === 1 || ((emote.data?.flags ?? 0) & 256) === 256,
      animated,
      // Still frames exist only for animated emotes: 1x_static.webp.
      still1x: animated ? `${base}/1x_static.webp` : undefined,
      still2x: animated && has("2x.webp") ? `${base}/2x_static.webp` : undefined,
      still4x: animated && has("4x.webp") ? `${base}/4x_static.webp` : undefined,
    });
  }
  return out;
}

export async function fetchSevenTvGlobal(): Promise<Emote[]> {
  const set = await getJson<{ emotes?: SevenTvActiveEmote[] }>(`${config.sevenTvBase}/emote-sets/global`);
  return parseSevenTvEmotes(set.emotes, "global");
}

export async function fetchSevenTvChannel(twitchId: string): Promise<Emote[]> {
  const user = await getJson<{ emote_set?: { emotes?: SevenTvActiveEmote[] } | null }>(
    `${config.sevenTvBase}/users/twitch/${twitchId}`,
  );
  return parseSevenTvEmotes(user.emote_set?.emotes, "channel");
}

// ---- BetterTTV ----

interface BttvEmote {
  id: string;
  code: string;
  modifier?: boolean;
  animated?: boolean;
  imageType?: string;
  width?: number;
  height?: number;
}

/** BTTV's overlay emotes; the API doesn't flag them. */
const BTTV_ZERO_WIDTH = new Set([
  "SoSnowy",
  "IceCold",
  "SantaHat",
  "TopHat",
  "ReinDeer",
  "CandyCane",
  "cvMask",
  "cvHazmat",
]);

export function parseBttvEmotes(emotes: BttvEmote[] | null | undefined, scope: EmoteScope): Emote[] {
  const out: Emote[] = [];
  for (const emote of emotes ?? []) {
    // `modifier` emotes (w!, h!, …) are text modifiers, not images.
    if (!emote.id || !emote.code || emote.modifier) continue;
    const base = `https://cdn.betterttv.net/emote/${emote.id}`;
    const animated = !!emote.animated || emote.imageType === "gif";
    out.push({
      id: emote.id,
      name: emote.code,
      provider: "bttv",
      scope,
      url1x: `${base}/1x`,
      url2x: `${base}/2x`,
      url4x: `${base}/3x`,
      width: emote.width,
      height: emote.height,
      zeroWidth: BTTV_ZERO_WIDTH.has(emote.code),
      animated,
      still1x: animated ? `${base}/static/1x.webp` : undefined,
      still2x: animated ? `${base}/static/2x.webp` : undefined,
      still4x: animated ? `${base}/static/3x.webp` : undefined,
    });
  }
  return out;
}

export async function fetchBttvGlobal(): Promise<Emote[]> {
  return parseBttvEmotes(await getJson<BttvEmote[]>(`${config.bttvBase}/cached/emotes/global`), "global");
}

export async function fetchBttvChannel(twitchId: string): Promise<Emote[]> {
  const user = await getJson<{ channelEmotes?: BttvEmote[]; sharedEmotes?: BttvEmote[] }>(
    `${config.bttvBase}/cached/users/twitch/${twitchId}`,
  );
  return parseBttvEmotes([...(user.channelEmotes ?? []), ...(user.sharedEmotes ?? [])], "channel");
}

// ---- FrankerFaceZ ----

interface FfzEmote {
  id: number;
  name: string;
  width?: number;
  height?: number;
  hidden?: boolean;
  modifier?: boolean;
  modifier_flags?: number;
  urls: Record<string, string>;
  animated?: Record<string, string> | null;
}

interface FfzSet {
  emoticons?: FfzEmote[];
}

export function parseFfzEmotes(emotes: FfzEmote[] | null | undefined, scope: EmoteScope): Emote[] {
  const out: Emote[] = [];
  for (const emote of emotes ?? []) {
    if (!emote || emote.hidden || !emote.name) continue;
    // Effect modifiers (rainbow, hyper, …) change the previous emote with CSS; they're skipped.
    if (emote.modifier && emote.modifier_flags) continue;
    const moving = emote.animated ?? undefined;
    const urls = moving ?? emote.urls;
    const url1x = urls?.["1"] ?? emote.urls?.["1"];
    if (!url1x) continue;
    const abs = (url?: string) => (url ? (url.startsWith("//") ? `https:${url}` : url) : undefined);
    const animated = !!moving;
    out.push({
      id: String(emote.id),
      name: emote.name,
      provider: "ffz",
      scope,
      url1x: abs(url1x)!,
      url2x: abs(urls["2"]),
      url4x: abs(urls["4"]),
      width: emote.width,
      height: emote.height,
      zeroWidth: !!emote.modifier,
      animated,
      // FFZ's plain `urls` are the still frames of an animated emote.
      still1x: animated ? abs(emote.urls?.["1"]) : undefined,
      still2x: animated ? abs(emote.urls?.["2"]) : undefined,
      still4x: animated ? abs(emote.urls?.["4"]) : undefined,
    });
  }
  return out;
}

export async function fetchFfzGlobal(): Promise<Emote[]> {
  const body = await getJson<{ default_sets?: number[]; sets?: Record<string, FfzSet> }>(
    `${config.ffzBase}/set/global`,
  );
  const ids = body.default_sets ?? Object.keys(body.sets ?? {}).map(Number);
  return ids.flatMap((id) => parseFfzEmotes(body.sets?.[String(id)]?.emoticons, "global"));
}

export async function fetchFfzChannel(twitchId: string): Promise<Emote[]> {
  const body = await getJson<{ room?: { set?: number }; sets?: Record<string, FfzSet> }>(
    `${config.ffzBase}/room/id/${twitchId}`,
  );
  const setId = body.room?.set;
  if (setId != null && body.sets?.[String(setId)]) {
    return parseFfzEmotes(body.sets[String(setId)].emoticons, "channel");
  }
  return Object.values(body.sets ?? {}).flatMap((set) => parseFfzEmotes(set.emoticons, "channel"));
}

export const globalFetchers: Record<ThirdPartyProvider, () => Promise<Emote[]>> = {
  "7tv": fetchSevenTvGlobal,
  bttv: fetchBttvGlobal,
  ffz: fetchFfzGlobal,
};

export const channelFetchers: Record<ThirdPartyProvider, (twitchId: string) => Promise<Emote[]>> = {
  "7tv": fetchSevenTvChannel,
  bttv: fetchBttvChannel,
  ffz: fetchFfzChannel,
};

/** Twitch's own emotes come from chat tags. Every Twitch emote has a still frame at `/static/`. */
export function twitchEmote(id: string, name: string): Emote {
  const base = `https://static-cdn.jtvnw.net/emoticons/v2/${id}`;
  return {
    id,
    name,
    provider: "twitch",
    scope: "global",
    url1x: `${base}/default/dark/1.0`,
    url2x: `${base}/default/dark/2.0`,
    url4x: `${base}/default/dark/3.0`,
    zeroWidth: false,
    // Twitch doesn't say which emotes move; the static picture is identical for still ones, so it's safe for all.
    animated: true,
    still1x: `${base}/static/dark/1.0`,
    still2x: `${base}/static/dark/2.0`,
    still4x: `${base}/static/dark/3.0`,
  };
}

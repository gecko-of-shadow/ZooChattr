import { CONCRETE_SKINS, DEFAULT_AUTO_DARK, DEFAULT_AUTO_LIGHT, DEFAULT_SKIN, SKIN_ORDER, type ConcreteSkin, type Skin } from "@/lib/themes";
import { parseHistoryServer } from "@/lib/chat/remoteHistory";
import { viewForSlots } from "@/lib/gridLayout";
import { EMPTY_PANE, paneChannels, trimPanes } from "@/lib/view/panes";
import type { ThirdPartyProvider } from "@/lib/emotes/types";
import { normalizeChannelName } from "@/lib/twitch/messages";

export type { Skin } from "@/lib/themes";
/** `grid`: several channels in boxes. `focused`: one channel fills the window (Single). */
export type ViewMode = "grid" | "focused";
/** How many times their normal size emotes are drawn. */
export type EmoteSize = 1 | 1.5 | 2;
/** Moving emotes: always, only while pointed at, or shown as a still frame. */
export type EmoteAnimation = "always" | "hover" | "never";
/** Emote panel tab. `all` is from older builds (it loads and shows as Recent). */
export type PickerTab = "fav" | "recent" | "channel" | "global" | "bttv" | "7tv" | "all";
export const PICKER_TABS: readonly PickerTab[] = ["fav", "recent", "channel", "global", "bttv", "7tv", "all"];
/** How many recently used emotes the panel remembers. */
export const MAX_RECENT_EMOTES = 40;

/** Hard cap on grid boxes. The user's setting ({@link DEFAULT_GRID_SLOTS}) starts at 4. */
const MAX_GRID_SLOTS = 9;
/** Grid boxes for a settings file that never chose a count. */
const DEFAULT_GRID_SLOTS = 4;

export const TEXT_SIZE_MIN = 10;
export const TEXT_SIZE_MAX = 40;
export const MENTION_COOLDOWN_MIN = 1;
export const MENTION_COOLDOWN_MAX = 120;
const MENTION_COOLDOWN_DEFAULT = 10;
export const TEXT_SIZE_PRESETS: { label: string; px: number }[] = [
  { label: "Small", px: 12.5 },
  { label: "Medium", px: 13.5 },
  { label: "Large", px: 15.5 },
  { label: "Huge", px: 20 },
];

export interface Settings {
  version: 2;
  /** Every channel you're following (IRC stays joined). */
  channels: string[];
  /**
   * The grid panes in order: channels from `channels` (at most {@link MAX_GRID_SLOTS}), with "" for an empty pane that
   * keeps its place. Other channels wait in each pane's channel picker until you pick them or open Single.
   */
  gridChannels: string[];
  /** How many boxes the grid may hold (1–{@link MAX_GRID_SLOTS}). Older files omit this and stay at 4. */
  gridSlots: number;
  /**
   * Pins set aside when the view switch went to fewer panes (say 4 → 2). Picking a bigger view brings them back in
   * this order. Older files omit it.
   */
  gridParked: string[];
  mode: ViewMode;
  focused: string | null;
  skin: Skin;
  /** With skin "auto": the theme used while Windows is light. */
  autoLightSkin: ConcreteSkin;
  /** With skin "auto": the theme used while Windows is dark. */
  autoDarkSkin: ConcreteSkin;
  showTimestamps: boolean;
  use24h: boolean;
  showBadges: boolean;
  /** Chat text size in pixels. Emotes grow and shrink with it. */
  textSize: number;
  /** Alternate row shading. */
  zebra: boolean;
  /** Closing the window hides ZooChattr in the system tray instead of quitting. */
  closeToTray: boolean;
  /** Hide the bottom bar so the chat boxes fill the window (Ctrl+Shift+H, or the floating Show UI button). */
  chromeHidden: boolean;
  /**
   * Watch-only: hide composers, emote/send controls, and channel-switch confirms on every pane.
   * Logs and channel headers stay so each pane is still identifiable.
   */
  readOnly: boolean;
  /** Start ZooChattr when Windows signs you in (portable: a Startup shortcut to this exe). */
  startOnLogin: boolean;
  /** Keep ~48 hours of chat per channel in ZooChattr-data so logs survive restarts. */
  rememberChatHistory: boolean;
  /**
   * Your chat logger's address (an https origin), or "" for none. At startup ZooChattr asks it for the chat
   * said while it was closed. The read token lives in the credential store, never in this file.
   */
  historyServer: string;
  /**
   * History server switched off. When false and historyServer is "", the address built into this
   * release (config.builtInHistoryServer) is used.
   */
  historyServerOff: boolean;
  /** Ask GitHub for a newer portable build when ZooChattr starts (and every few hours). */
  autoCheckUpdates: boolean;
  /**
   * Before typing in a channel's box, require clicking "Switch to #channel".
   * Stops accidental sends when several chats are open.
   */
  confirmChannelSwitch: boolean;
  /** Overrides the Client ID baked in at build time. */
  clientId: string;

  // ---- emotes (each feature has its own switch, like Geckmotes) ----
  /** Which third-party emote sources are shown. Twitch's own emotes always are. */
  emoteProviders: Record<ThirdPartyProvider, boolean>;
  emoteSize: EmoteSize;
  emoteAnimation: EmoteAnimation;
  /** Overlay (zero-width) emotes sit on top of the emote before them instead of next to it. */
  overlayEmotes: boolean;
  /** Emote names that stay plain words. */
  blockedEmotes: string[];
  /** Keep emote lists on disk so pictures show instantly next launch. */
  rememberEmotes: boolean;
  /** Tab finishes emote names and chatter names in the message box. */
  tabComplete: boolean;
  /** The emote menu button in the message box. */
  emotePicker: boolean;
  /** Point at an emote to see it big. */
  emotePreview: boolean;
  /** "provider:id" of favourite emotes in the picker. */
  favoriteEmotes: string[];
  /** Picker sections folded shut, as "scope:provider". */
  pickerFolded: string[];
  pickerTab: PickerTab;
  /** "provider:id" of the emotes used most recently, newest first (the panel's Recent tab). */
  recentEmotes: string[];

  // ---- reading ----
  /** Besides your own name, these words make a message stand out. */
  highlightWords: string[];
  /**
   * Chime when your name, a reply to you, or a highlight word shows up in any open chat.
   * Off until you turn it on.
   */
  mentionSound: boolean;
  /** Seconds to wait before another mention chime. A burst in one moment still chimes once. */
  mentionSoundCooldown: number;
  /** Keep deleted messages readable (faded and crossed out) instead of hiding what they said. */
  showDeleted: boolean;
  /** Our own spell checker in the message box. Edge's checker stays off. */
  spellCheck: boolean;
  /** Words that are never underlined. Edited in Settings and by "Add to dictionary". */
  spellDictionary: string[];
  /** Hunspell language id. Only en-US ships today; the list is built so more can be added. */
  spellLanguage: string;

  /**
   * Features switched off for one channel only (like Geckmotes' per-channel overrides).
   * Key is the channel login; value is the feature ids that are off there.
   */
  channelOverrides: Record<string, ChannelFeature[]>;
}

/** Features that can be switched off for one channel without changing the global switches. */
export type ChannelFeature =
  | ThirdPartyProvider
  | "overlayEmotes"
  | "tabComplete"
  | "emotePicker"
  | "emotePreview"
  | "highlightWords"
  | "showDeleted";

export const TAB_COMPLETE_LABEL = "Tab finishes emote and chatter names";
export const TAB_COMPLETE_HINT =
  "Type the first letters or @ and a name, then Tab. Tab again cycles emotes and people in this chat.";

export const CHANNEL_FEATURES: { id: ChannelFeature; label: string }[] = [
  { id: "7tv", label: "7TV" },
  { id: "bttv", label: "BetterTTV" },
  { id: "ffz", label: "FrankerFaceZ" },
  { id: "overlayEmotes", label: "Overlay emotes" },
  { id: "tabComplete", label: TAB_COMPLETE_LABEL },
  { id: "emotePicker", label: "Emote menu" },
  { id: "emotePreview", label: "Preview on hover" },
  { id: "highlightWords", label: "Highlight words" },
  { id: "showDeleted", label: "Show deleted messages" },
];

const CHANNEL_FEATURE_IDS = new Set(CHANNEL_FEATURES.map((f) => f.id));

/** True when the feature is on globally and not switched off for `channel`. */
export function isFeatureOn(settings: Settings, channel: string | null | undefined, feature: ChannelFeature): boolean {
  switch (feature) {
    case "7tv":
    case "bttv":
    case "ffz":
      if (!settings.emoteProviders[feature]) return false;
      break;
    case "overlayEmotes":
    case "tabComplete":
    case "emotePicker":
    case "emotePreview":
    case "showDeleted":
      if (!settings[feature]) return false;
      break;
    case "highlightWords":
      // Extra words only; your own name always lights up. An empty list matches nothing either way.
      break;
  }
  if (!channel) return true;
  return !settings.channelOverrides[channel]?.includes(feature);
}

/** Distinct, known feature ids from a saved override list. */
function cleanFeatureList(value: unknown): ChannelFeature[] {
  if (!Array.isArray(value)) return [];
  const out: ChannelFeature[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && CHANNEL_FEATURE_IDS.has(entry as ChannelFeature) && !out.includes(entry as ChannelFeature)) {
      out.push(entry as ChannelFeature);
    }
  }
  return out;
}

/** Channel login -> features off there. Unknown channels and feature ids are dropped. */
export function cleanChannelOverrides(value: unknown): Record<string, ChannelFeature[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ChannelFeature[]> = {};
  for (const [raw, list] of Object.entries(value as Record<string, unknown>)) {
    const channel = normalizeChannelName(raw);
    if (!channel) continue;
    out[channel] = cleanFeatureList(list);
  }
  return out;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  channels: [],
  gridChannels: [],
  gridSlots: DEFAULT_GRID_SLOTS,
  gridParked: [],
  mode: "grid",
  focused: null,
  skin: DEFAULT_SKIN,
  autoLightSkin: DEFAULT_AUTO_LIGHT,
  autoDarkSkin: DEFAULT_AUTO_DARK,
  showTimestamps: true,
  use24h: true,
  showBadges: true,
  textSize: 13.5,
  zebra: false,
  closeToTray: true,
  chromeHidden: false,
  readOnly: false,
  startOnLogin: false,
  rememberChatHistory: true,
  historyServer: "",
  historyServerOff: false,
  autoCheckUpdates: true,
  confirmChannelSwitch: true,
  clientId: "",
  emoteProviders: { "7tv": true, bttv: true, ffz: true },
  emoteSize: 1,
  emoteAnimation: "always",
  overlayEmotes: true,
  blockedEmotes: [],
  rememberEmotes: true,
  tabComplete: true,
  emotePicker: true,
  emotePreview: true,
  favoriteEmotes: [],
  pickerFolded: [],
  pickerTab: "recent",
  recentEmotes: [],
  highlightWords: [],
  mentionSound: false,
  mentionSoundCooldown: MENTION_COOLDOWN_DEFAULT,
  showDeleted: true,
  spellCheck: true,
  spellDictionary: [],
  spellLanguage: "en-US",
  channelOverrides: {},
};

/** Settings that are the user's preferences (everything but the channel list and view). */
export type PreferenceKey = Exclude<keyof Settings, "version" | "channels" | "gridChannels" | "gridParked" | "focused">;

const pick = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const MAX_LIST = 200;
/** Favourites are picked one click at a time; emote fans collect a lot of them. */
const MAX_FAVOURITES = 2000;

/** Distinct, trimmed, non-empty strings; at most `max` of them. */
function cleanWordList(value: unknown, max = MAX_LIST): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const word = entry.trim();
    if (word) out.add(word);
    if (out.size >= max) break;
  }
  return Array.from(out);
}

/** Textarea text, one entry per line (spaces and commas also separate), to a clean list. */
export function parseWordList(text: string): string[] {
  return cleanWordList(text.split(/[\n,\s]+/));
}

/** Older builds saved "sm" / "md" / "lg". */
const LEGACY_FONT: Record<string, number> = { sm: 12.5, md: 13.5, lg: 15.5 };

export function clampTextSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.textSize;
  return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n * 2) / 2));
}

/** Whole seconds between mention chimes. Junk falls back to the default; the rest is clamped. */
export function clampMentionCooldown(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MENTION_COOLDOWN_DEFAULT;
  return Math.min(MENTION_COOLDOWN_MAX, Math.max(MENTION_COOLDOWN_MIN, Math.round(n)));
}

/** Accepts whatever was on disk (including older versions) and returns a valid Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const channels: string[] = [];
  if (Array.isArray(input.channels)) {
    for (const entry of input.channels) {
      const name = typeof entry === "string" ? normalizeChannelName(entry) : null;
      if (name && !channels.includes(name)) channels.push(name);
    }
  }
  // Older builds had a "merged" feed; the grid replaces it.
  const mode = input.mode === "merged" ? "grid" : pick(input.mode, ["grid", "focused"] as const, DEFAULT_SETTINGS.mode);
  // View 1 emptied with "−" stays empty (older builds only saved null with no channels at all).
  const savedFocus =
    typeof input.focused === "string" && channels.includes(input.focused)
      ? input.focused
      : input.focused === null && mode === "focused"
        ? null
        : (channels[0] ?? null);
  const gridSlots = clampGridSlots(input.gridSlots);
  // Pins beyond the view are set aside (gridParked), not dropped.
  const { gridChannels, gridParked } = fitGridToView(
    sanitizeGridChannels(input.gridChannels, channels, Array.isArray(input.gridChannels) ? MAX_GRID_SLOTS : gridSlots),
    cleanChannelList(input.gridParked, channels),
    gridSlots,
    false,
  );
  // In the grid, the focused pane (underline, where the message box sends) must be one that is on screen.
  const focused = focusOnGrid(mode, savedFocus, gridChannels);
  const textSize =
    typeof input.textSize === "number"
      ? clampTextSize(input.textSize)
      : typeof input.fontSize === "string" && input.fontSize in LEGACY_FONT
        ? LEGACY_FONT[input.fontSize]
        : DEFAULT_SETTINGS.textSize;
  const providers = (input.emoteProviders && typeof input.emoteProviders === "object" ? input.emoteProviders : {}) as Record<
    string,
    unknown
  >;

  return {
    version: 2,
    channels,
    gridChannels,
    gridSlots,
    gridParked,
    mode,
    focused,
    skin: pick(input.skin, SKIN_ORDER, DEFAULT_SETTINGS.skin),
    autoLightSkin: pick(input.autoLightSkin, CONCRETE_SKINS, DEFAULT_SETTINGS.autoLightSkin),
    autoDarkSkin: pick(input.autoDarkSkin, CONCRETE_SKINS, DEFAULT_SETTINGS.autoDarkSkin),
    showTimestamps: bool(input.showTimestamps, DEFAULT_SETTINGS.showTimestamps),
    use24h: bool(input.use24h, DEFAULT_SETTINGS.use24h),
    showBadges: bool(input.showBadges, DEFAULT_SETTINGS.showBadges),
    textSize,
    zebra: bool(input.zebra, DEFAULT_SETTINGS.zebra),
    closeToTray: bool(input.closeToTray, DEFAULT_SETTINGS.closeToTray),
    chromeHidden: bool(input.chromeHidden, DEFAULT_SETTINGS.chromeHidden),
    readOnly: bool(input.readOnly, DEFAULT_SETTINGS.readOnly),
    startOnLogin: bool(input.startOnLogin, DEFAULT_SETTINGS.startOnLogin),
    rememberChatHistory: bool(input.rememberChatHistory, DEFAULT_SETTINGS.rememberChatHistory),
    historyServer: typeof input.historyServer === "string" ? (parseHistoryServer(input.historyServer) ?? "") : "",
    // Before the built-in address, a field without a usable address meant "off": files saved then keep
    // that choice. A file without the key (fresh install) uses the built-in address.
    historyServerOff:
      typeof input.historyServerOff === "boolean"
        ? input.historyServerOff
        : "historyServer" in input && !(typeof input.historyServer === "string" && parseHistoryServer(input.historyServer)),
    autoCheckUpdates: bool(input.autoCheckUpdates, DEFAULT_SETTINGS.autoCheckUpdates),
    confirmChannelSwitch: bool(input.confirmChannelSwitch, DEFAULT_SETTINGS.confirmChannelSwitch),
    clientId: typeof input.clientId === "string" ? input.clientId.trim() : "",
    emoteProviders: {
      "7tv": bool(providers["7tv"], true),
      bttv: bool(providers.bttv, true),
      ffz: bool(providers.ffz, true),
    },
    emoteSize: pick(input.emoteSize, [1, 1.5, 2] as const, DEFAULT_SETTINGS.emoteSize),
    emoteAnimation: pick(input.emoteAnimation, ["always", "hover", "never"] as const, DEFAULT_SETTINGS.emoteAnimation),
    overlayEmotes: bool(input.overlayEmotes, DEFAULT_SETTINGS.overlayEmotes),
    blockedEmotes: cleanWordList(input.blockedEmotes),
    rememberEmotes: bool(input.rememberEmotes, DEFAULT_SETTINGS.rememberEmotes),
    tabComplete: bool(input.tabComplete, DEFAULT_SETTINGS.tabComplete),
    emotePicker: bool(input.emotePicker, DEFAULT_SETTINGS.emotePicker),
    emotePreview: bool(input.emotePreview, DEFAULT_SETTINGS.emotePreview),
    favoriteEmotes: cleanWordList(input.favoriteEmotes, MAX_FAVOURITES),
    pickerFolded: cleanWordList(input.pickerFolded),
    pickerTab: pick(input.pickerTab, PICKER_TABS, DEFAULT_SETTINGS.pickerTab),
    recentEmotes: cleanWordList(input.recentEmotes, MAX_RECENT_EMOTES),
    highlightWords: cleanWordList(input.highlightWords),
    mentionSound: bool(input.mentionSound, DEFAULT_SETTINGS.mentionSound),
    mentionSoundCooldown: clampMentionCooldown(input.mentionSoundCooldown),
    showDeleted: bool(input.showDeleted, DEFAULT_SETTINGS.showDeleted),
    spellCheck: bool(input.spellCheck, DEFAULT_SETTINGS.spellCheck),
    spellDictionary: cleanWordList(input.spellDictionary),
    spellLanguage: sanitizeSpellLanguage(input.spellLanguage),
    channelOverrides: cleanChannelOverrides(input.channelOverrides),
  };
}

/** Known spell-check languages. Unknown saved values fall back to en-US. */
export const SPELL_LANGUAGE_OPTIONS = [{ id: "en-US", label: "English (US)" }] as const;

function sanitizeSpellLanguage(value: unknown): string {
  const id = typeof value === "string" ? value : "";
  return SPELL_LANGUAGE_OPTIONS.some((option) => option.id === id) ? id : DEFAULT_SETTINGS.spellLanguage;
}

/** What a settings backup file holds. */
export interface SettingsBackup {
  zoochattr: 1;
  savedAt: string;
  settings: Settings;
}

export function makeBackup(settings: Settings): SettingsBackup {
  return { zoochattr: 1, savedAt: new Date().toISOString(), settings };
}

/** Reads a backup file (or a bare settings object). Returns null when it isn't one of ours. */
export function readBackup(text: string): Settings | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.zoochattr === 1) {
    return obj.settings && typeof obj.settings === "object" ? sanitizeSettings(obj.settings) : null;
  }
  // A bare settings.json is fine too, but "version" / "mode" / "channels" are in lots of files;
  // insist on keys only ZooChattr writes so a stray package.json can't reset everything.
  const keys = Object.keys(obj);
  const known = keys.filter((k) => k in DEFAULT_SETTINGS && !GENERIC_KEYS.has(k));
  const legacy = typeof obj.fontSize === "string";
  return known.length >= 2 || (legacy && keys.includes("skin")) ? sanitizeSettings(obj) : null;
}

const GENERIC_KEYS = new Set(["version", "mode", "channels", "gridChannels", "focused"]);

/** The toast text after a restore. A restore can turn chat history off; it never deletes saved logs. */
export function restoreSummary(joined: number, historyTurnedOff: boolean): string {
  const result = joined
    ? `Joined ${joined} channel${joined === 1 ? "" : "s"} from the backup too. Your login was left alone.`
    : "Your channels and login were left as they were.";
  if (!historyTurnedOff) return result;
  return `${result} Remember chat history is now off, as it was in the backup, so new chat won't be saved. Your saved chat logs were kept. To delete them, use Clear history in Settings → Account & history.`;
}

/** Whole number of grid boxes from 1 to {@link MAX_GRID_SLOTS}. Missing or junk stays at 4. */
export function clampGridSlots(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GRID_SLOTS;
  return Math.min(MAX_GRID_SLOTS, Math.max(1, Math.round(n)));
}

/** The focused channel, moved to the first pane when the grid is showing and it isn't on it. */
export function focusOnGrid(mode: ViewMode, focused: string | null, gridChannels: readonly string[]): string | null {
  const shown = paneChannels(gridChannels);
  if (mode !== "grid" || shown.length === 0) return focused;
  return focused && shown.includes(focused) ? focused : shown[0];
}

/** Followed channels from a saved list, unique, in order (unknown names dropped), at most {@link MAX_GRID_SLOTS}. */
function cleanChannelList(raw: unknown, channels: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(channels);
  const out: string[] = [];
  for (const entry of raw) {
    const name = typeof entry === "string" ? normalizeChannelName(entry) : null;
    if (name && allowed.has(name) && !out.includes(name)) out.push(name);
    if (out.length >= MAX_GRID_SLOTS) break;
  }
  return out;
}

/**
 * Fits the pins to a view size: the first `view` pins show, the rest are set aside (in order) so a bigger view brings
 * them back. With `refill` (picking a view), set-aside pins fill free panes; without it (loading a file), they wait,
 * so a pane you emptied on purpose stays empty. Old 5/7/8 slot counts use the next offered view.
 */
export function fitGridToView(
  gridChannels: readonly string[],
  gridParked: readonly string[],
  slots: number,
  refill = true,
): { gridChannels: string[]; gridParked: string[] } {
  const view = viewForSlots(slots);
  // Each channel once; empty panes keep their place.
  const panes = gridChannels.filter((name, i) => name === EMPTY_PANE || gridChannels.indexOf(name) === i);
  const grid = panes.slice(0, view);
  const rest = [...paneChannels(panes.slice(view)), ...gridParked].filter(
    (name, i, list) => name !== EMPTY_PANE && !grid.includes(name) && list.indexOf(name) === i,
  );
  if (refill) {
    for (let i = 0; i < view && rest.length; i++) if (!grid[i]) grid[i] = rest.shift()!;
  }
  return { gridChannels: trimPanes(grid), gridParked: rest.slice(0, MAX_GRID_SLOTS) };
}

/** Pins that still exist, unique, at most `slots` panes ("" = empty pane kept). Missing list → the first slots (older builds). */
function sanitizeGridChannels(raw: unknown, channels: string[], slots = DEFAULT_GRID_SLOTS): string[] {
  const cap = clampGridSlots(slots);
  const allowed = new Set(channels);
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      if (entry === EMPTY_PANE) {
        out.push(EMPTY_PANE);
      } else {
        const name = normalizeChannelName(entry);
        if (!name || !allowed.has(name) || out.includes(name)) continue;
        out.push(name);
      }
      if (out.length >= cap) break;
    }
    return trimPanes(out);
  }
  return channels.slice(0, cap);
}

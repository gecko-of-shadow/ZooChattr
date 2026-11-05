import { toast } from "sonner";
import { config } from "@/lib/config";
import { rememberUsers, type ActiveUser } from "@/lib/chat/activeUsers";
import { historyBoundary, sanitizeHistory, trimLiveBuffer } from "@/lib/chat/history";
import {
  HistoryServerError,
  OVERLAP_MS,
  activeHistoryServer,
  fetchServerLines,
  fillNote,
  mergeServerMessages,
  newestTwitchTime,
  serverMessages,
  type FillResult,
} from "@/lib/chat/remoteHistory";
import { channelOnScreen, readMarkerAfterFocus } from "@/lib/chat/visibility";
import { FRESH_FOR } from "@/lib/emotes/cache";
import { emoteRegistry, type EmotePrefs } from "@/lib/emotes/registry";
import { mentionChimesPlayed, mentionDue, playMentionChime } from "@/lib/notify";
import { IrcConnection, type ConnectionDetail, type ConnectionStatus } from "@/lib/irc/connection";
import { channelFromParam, type IrcMessage } from "@/lib/irc/parser";
import * as platform from "@/lib/platform";
import { fetchLatestRelease, installUpdate, isNewerVersion } from "@/lib/updates";
import { refreshSession, revokeToken, validateToken, type Session } from "@/lib/twitch/auth";
import {
  HelixUnauthorizedError,
  fetchChannelBadges,
  fetchFollowedChannels,
  fetchGlobalBadges,
  fetchLiveStreams,
  fetchUsers,
  publicBadge,
  type BadgeImage,
  type BadgeMap,
} from "@/lib/twitch/helix";
import {
  localId,
  flagMentions,
  noticeToChat,
  normalizeChannelName,
  parseRoomState,
  parseUserState,
  privmsgToChat,
  systemMessage,
  usernoticeToChat,
} from "@/lib/twitch/messages";
import type { Badge, ChatMessage } from "@/lib/twitch/types";
import { newChannelView, useChat, type ChannelView } from "@/store/chat";
import { fitGridToView, focusOnGrid, isFeatureOn, sanitizeSettings, type Settings, type ViewMode } from "@/store/settings";
import { moveItem, replaceGridSlot, swapItems } from "@/lib/view/reorder";
import { clearPaneOf, EMPTY_PANE, fillFreePane, paneChannels, placeInPane, trimPanes } from "@/lib/view/panes";
import { viewForSlots, type ViewSize } from "@/lib/gridLayout";
import { prefersDarkNow, resolveSkin, THEMES } from "@/lib/themes";
import { clearReplyTarget, useUi } from "@/store/ui";
import { replyParentMsgId, replySnippet } from "@/lib/twitch/reply";
import { FOLLOWS_REFRESH_MS, LIVE_POLL_MS, hasFollowsScope, sameLive, type FollowView } from "@/lib/follows";

/** System lines addressed to this pseudo-channel show up in every view. */
export const ALL_CHANNELS = "*";

const JOIN_TIMEOUT_MS = 45_000;
const EMOTE_RELOAD_GAP_MS = 5 * 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
/** How often a busy channel appends the lines still only in memory. */
export const HISTORY_FLUSH_MS = 30_000;
const UPDATE_CHECK_GAP_MS = 6 * 60 * 60_000;
/** Twitch message ids remembered per channel to drop a live line that already came in. */
const SEEN_IDS_PER_CHANNEL = 2000;

interface PendingSend {
  id: string;
  channel: string;
  text: string;
  state: "sending" | "sent";
  timer: ReturnType<typeof setTimeout>;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** What the history server sent for one channel: lines, null when it doesn't record that channel, or why it failed. */
type ServerFill = { channel: string; result: FillResult | null } | { channel: string; error: unknown };

const get = useChat.getState;
const set = useChat.setState;
const NO_CHATTERS: ActiveUser[] = [];
const SETTINGS_PROBLEM_TOAST = "settings-problem";

function anonymousNick(): string {
  return `justinfan${Math.floor(10_000 + Math.random() * 89_999)}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function messageStamp(message: ChatMessage): string {
  let hash = 2166136261;
  const text = message.text;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${message.deleted ? 1 : 0}:${message.ts}:${text.length}:${hash >>> 0}`;
}

function emotePrefsFrom(settings: Settings): EmotePrefs {
  const off: EmotePrefs["off"] = {};
  for (const [channel, list] of Object.entries(settings.channelOverrides)) {
    if (list.length) off[channel] = new Set(list);
  }
  return {
    providers: settings.emoteProviders,
    overlays: settings.overlayEmotes,
    blocked: new Set(settings.blockedEmotes),
    remember: settings.rememberEmotes,
    off,
  };
}

class ChatController {
  private session: Session | null = null;
  private readonly read: IrcConnection;
  private write: IrcConnection | null = null;
  private queue: ChatMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private saveDirty = false;
  private savesBlocked = false;
  private saveErrorShown = false;
  private pendingSends: PendingSend[] = [];
  private sentLog: number[] = [];
  /** Recent chatters per channel, newest first. Not in the store, so a new line does not redraw the message box. */
  private chatterLists = new Map<string, ActiveUser[]>();
  /** Recent Twitch message ids per channel, oldest first (live, saved and history-server lines). */
  private seenIds = new Map<string, Set<string>>();
  private globalBadges: BadgeMap = new Map();
  private channelBadges = new Map<string, BadgeMap>();
  private emoteLoadedAt = new Map<string, number>();
  private globalEmotesLoadedAt = Date.now();
  private refreshing: Promise<Session | null> | null = null;
  private recoveringAuth = false;
  private everConnected = false;
  private dropAnnounced = false;
  private booted = false;
  /** Settings popout window: preferences UI only — no IRC / chat joins. */
  private settingsUiOnly = false;
  private lastAttention = 0;
  /** When the last live mention chime started. 0 means none yet. Preview does not set this. */
  private lastMentionSoundAt = 0;
  /** Channels whose in-memory lines are ahead of the log file. */
  private historyUnsaved = new Set<string>();
  /** Id → stamp of lines already appended. */
  private historyOnDisk = new Map<string, Map<string, string>>();
  private historyFlushTimer: ReturnType<typeof setInterval> | null = null;
  private historyWriting = new Map<string, Promise<void>>();
  private exitFlushListening = false;
  private updateCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** Live dots / follows refresh; paused while the window is hidden. */
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private livePollSoon: ReturnType<typeof setTimeout> | null = null;
  private liveCheckedAt = 0;
  private followsFetchedAt = 0;
  /** Bumped on each login change; answers from before it are dropped. */
  private followsGeneration = 0;
  /** Whose follows are in the store (to clear them when another account logs in). */
  private followsUser: string | null = null;
  private pollAuthRetryAt = 0;

  constructor() {
    this.read = new IrcConnection({
      url: config.ircUrl,
      name: "read",
      getCredentials: async () => {
        const session = this.session ? await this.freshSession() : null;
        return session ? { nick: session.login, pass: `oauth:${session.accessToken}` } : { nick: anonymousNick() };
      },
      onMessage: (message) => this.onReadMessage(message),
      onStatus: (status, detail) => this.onReadStatus(status, detail),
    });

    emoteRegistry.subscribe((channel) => {
      if (channel === null) set((s) => ({ globalEmoteVersion: s.globalEmoteVersion + 1 }));
      else set((s) => ({ emoteVersions: { ...s.emoteVersions, [channel]: (s.emoteVersions[channel] ?? 0) + 1 } }));
    });
  }

  // ---------------------------------------------------------------- lifecycle

  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;

    const [saved, appInfo] = await Promise.all([this.readSavedSettings(), platform.getAppInfo().catch(() => null)]);
    const rawSettings = saved.raw;
    const settings = sanitizeSettings(rawSettings);
    void platform.setCloseToTray(settings.closeToTray).catch(() => undefined);
    // Blocked means these are defaults, not the user's choice: leave the Startup shortcut as it is.
    if (!this.savesBlocked) void platform.setLaunchAtLogin(settings.startOnLogin).catch(() => undefined);
    emoteRegistry.setPrefs(emotePrefsFrom(settings));
    set({
      settings,
      appInfo,
      channels: Object.fromEntries(settings.channels.map((c) => [c, newChannelView(c)])),
      ready: true,
      settingsLoaded: rawSettings !== null,
    });
    this.showSettingsProblem(saved.failure);

    if (settings.rememberChatHistory) {
      await this.restoreHistory(settings.channels);
      this.armHistoryFlush();
    }
    // Ask the history server about the gap while the saved login is checked.
    const fromServer = this.fetchServerHistory(settings.channels);

    const stored = await platform.loadSession().catch((err) => {
      toast.error("Couldn't read your saved Twitch login", { description: errorText(err) });
      return null;
    });
    if (stored) {
      const session = await this.revalidate(stored);
      if (session) this.setSession(session, true);
      else {
        this.setSession(null);
        toast.warning("Your Twitch login expired", { description: "You're reading anonymously. Log in again to chat." });
      }
    } else {
      this.setSession(null);
    }

    this.read.start();
    if (this.session) this.startWrite();
    void this.joinAfterFill(settings.channels, fromServer);

    void emoteRegistry.loadGlobal();
    if (this.session) {
      void this.loadGlobalBadges();
      void this.loadProfiles(settings.channels);
    }
    this.armFollows();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.onVisible();
    });

    window.addEventListener("online", () => {
      this.read.retryNow();
      this.write?.retryNow();
    });
    window.addEventListener("beforeunload", () => {
      void this.flushSavedHistory();
    });
    window.addEventListener("pagehide", () => {
      void this.flushSavedHistory();
    });
    void this.listenForExitFlush();
    setInterval(() => this.tick(), 5_000);
    setInterval(() => void this.validateHourly(), 60 * 60_000);
    this.armUpdateChecks(settings.autoCheckUpdates);
  }

  /** Preferences-only boot for the Settings popout (no second IRC connection). */
  async bootSettingsUi(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    this.settingsUiOnly = true;

    const [saved, appInfo, display] = await Promise.all([
      this.readSavedSettings(),
      platform.getAppInfo().catch(() => null),
      // Login name only — never pull tokens into the Settings webview.
      platform.loadAuthDisplay().catch(() => null),
    ]);
    const rawSettings = saved.raw;
    const settings = sanitizeSettings(rawSettings);
    emoteRegistry.setPrefs(emotePrefsFrom(settings));
    set({
      settings,
      appInfo,
      channels: {},
      ready: true,
      settingsLoaded: rawSettings !== null,
      auth: display?.login
        ? { status: "logged_in", login: display.login, userId: display.userId, remembered: display.remembered }
        : { status: "anonymous" },
    });
    this.session = null;
    this.showSettingsProblem(saved.failure);
  }

  /**
   * A window that couldn't read settings.json holds defaults, so saving must stay off until a read
   * works. The one exception: the main window, once the damaged file is moved aside, has nothing left
   * to overwrite and can start fresh. The Settings window never can: the main window holds the real settings.
   */
  private async readSavedSettings(): Promise<{ raw: unknown | null; failure: platform.SettingsLoadFailure | null }> {
    try {
      return { raw: await platform.loadSettings(), failure: null };
    } catch (err) {
      const failure = platform.settingsLoadFailure(err);
      this.savesBlocked = !failure.keptCopy || this.settingsUiOnly;
      return { raw: null, failure };
    }
  }

  /** Stays up until dismissed. Waits a tick so the Settings window's Toaster, which appears with `ready`, can catch it. */
  private showSettingsProblem(failure: platform.SettingsLoadFailure | null): void {
    if (!failure) return;
    const blocked = this.savesBlocked;
    const options = { id: SETTINGS_PROBLEM_TOAST, duration: Number.POSITIVE_INFINITY, closeButton: true };
    setTimeout(() => {
      if (blocked) {
        toast.error("Couldn't read your saved settings", {
          ...options,
          description: `ZooChattr won't save any changes for now, so your saved settings stay safe. Restart ZooChattr to try again. (${failure.message})`,
        });
      } else {
        toast.error("Your saved settings were damaged", {
          ...options,
          description: `ZooChattr started fresh with default settings and no channels. The damaged file was kept as ${failure.keptCopy}.`,
        });
      }
    }, 0);
  }

  /** Main window: reload preferences (and join any channels Settings added) after the popout saves. */
  async pullSettingsFromDisk(): Promise<void> {
    if (this.settingsUiOnly) return;
    const raw = await platform.loadSettings().catch(() => null);
    if (!raw) return;
    if (this.savesBlocked) {
      // A read worked at last. Whatever was waiting to save came from the defaults, so drop it.
      this.savesBlocked = false;
      this.saveDirty = false;
      toast.dismiss(SETTINGS_PROBLEM_TOAST);
    }
    const next = sanitizeSettings(raw);
    const before = get().settings;
    set({ settings: next });
    emoteRegistry.setPrefs(emotePrefsFrom(next));
    if (next.closeToTray !== before.closeToTray) void platform.setCloseToTray(next.closeToTray).catch(() => undefined);
    if (next.startOnLogin !== before.startOnLogin) void platform.setLaunchAtLogin(next.startOnLogin).catch(() => undefined);
    if (next.autoCheckUpdates !== before.autoCheckUpdates) this.armUpdateChecks(next.autoCheckUpdates);
    for (const name of next.channels) {
      if (get().channels[name]) continue;
      set((s) => ({ channels: { ...s.channels, [name]: newChannelView(name) } }));
      this.openChannel(name);
      if (this.session) void this.loadProfiles([name]);
    }
  }

  /** Main window: refresh login state after Settings logs out. */
  async pullSessionFromDisk(): Promise<void> {
    if (this.settingsUiOnly) return;
    const stored = await platform.loadSession().catch(() => null);
    if (!stored) {
      if (this.session) await this.logout("Logged out from Settings.");
      return;
    }
    if (!this.session || this.session.accessToken !== stored.accessToken) {
      const session = await this.revalidate(stored);
      if (session) {
        this.setSession(session, true);
        this.startWrite();
        this.armFollows();
      }
    }
  }

  private async broadcastSettingsChanged(): Promise<void> {
    if (!platform.isTauri) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("settings-changed");
    } catch {
      // Ignore — main window will pick up on next open.
    }
  }

  private async broadcastSessionChanged(): Promise<void> {
    if (!platform.isTauri) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("session-changed");
    } catch {
      // Ignore.
    }
  }

  // ---------------------------------------------------------------- auth

  get clientId(): string {
    return get().settings.clientId || config.builtInClientId;
  }

  private setSession(session: Session | null, remembered = true): void {
    this.session = session;
    if (session) this.dropSelfFromChatters(session.login);
    set({
      auth: session
        ? { status: "logged_in", login: session.login, userId: session.userId, remembered }
        : { status: "anonymous" },
    });
  }

  private async persistSession(session: Session): Promise<boolean> {
    try {
      await platform.saveSession(session);
      return true;
    } catch (err) {
      toast.warning("Logged in, but your login couldn't be saved", {
        description: `${get().appInfo?.tokenStore ?? "The credential store"} said: ${errorText(err)}. You'll need to log in again next launch.`,
      });
      return false;
    }
  }

  /** Validates a stored session; refreshes it if Twitch says it expired. Keeps it when offline. */
  private async revalidate(session: Session): Promise<Session | null> {
    try {
      const info = await validateToken(session.accessToken);
      if (info) {
        return {
          ...session,
          login: info.login,
          userId: info.user_id,
          scopes: info.scopes ?? session.scopes,
          expiresAt: Date.now() + (info.expires_in || 4 * 3600) * 1000,
        };
      }
      const refreshed = await refreshSession(session);
      if (refreshed) {
        await this.persistSession(refreshed);
        return refreshed;
      }
      await platform.clearSession().catch(() => undefined);
      return null;
    } catch {
      return session;
    }
  }

  private refreshOnce(): Promise<Session | null> {
    if (!this.session) return Promise.resolve(null);
    if (!this.refreshing) {
      const current = this.session;
      this.refreshing = refreshSession(current)
        .then(async (next) => {
          if (next && this.session === current) {
            const remembered = await this.persistSession(next);
            this.setSession(next, remembered);
          }
          return next;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  /** The current session with a token that's good for at least a few more minutes. */
  private async freshSession(): Promise<Session | null> {
    if (!this.session) return null;
    if (this.session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return this.session;
    try {
      const next = await this.refreshOnce();
      if (next) return next;
      await this.logout("Your Twitch login expired, so ZooChattr switched to anonymous reading. Log in again to chat.");
      return null;
    } catch {
      return this.session;
    }
  }

  private async recoverAuth(): Promise<void> {
    if (this.recoveringAuth) return;
    if (!this.session) {
      setTimeout(() => this.read.restart("Retrying anonymously"), 5_000);
      return;
    }
    this.recoveringAuth = true;
    try {
      let next: Session | null | undefined;
      try {
        next = await this.refreshOnce();
      } catch {
        next = undefined;
      }
      if (next) {
        this.read.restart("Logged back in");
        this.write?.restart("Logged back in");
      } else if (next === null) {
        await this.logout("Twitch rejected your saved login, so ZooChattr switched to anonymous reading. Log in again to chat.");
      } else {
        setTimeout(() => {
          this.read.restart("Retrying login");
          this.write?.restart("Retrying login");
        }, 15_000);
      }
    } finally {
      this.recoveringAuth = false;
    }
  }

  private async validateHourly(): Promise<void> {
    if (!this.session) return;
    try {
      const info = await validateToken(this.session.accessToken);
      if (!info) await this.recoverAuth();
      else this.session = { ...this.session, expiresAt: Date.now() + (info.expires_in || 4 * 3600) * 1000 };
    } catch {
      // Offline; try again next hour.
    }
  }

  async completeLogin(session: Session): Promise<void> {
    const remembered = await this.persistSession(session);
    this.setSession(session, remembered);
    this.read.restart("Logging in");
    this.startWrite();
    void this.loadGlobalBadges();
    void this.loadProfiles(get().settings.channels);
    for (const channel of Object.values(get().channels)) {
      if (channel.roomId) void this.loadChannelBadges(channel.login, channel.roomId);
    }
    this.armFollows();
    toast.success(`Logged in as ${session.login}`, { description: "Your messages go out as you now." });
  }

  async logout(reason?: string): Promise<void> {
    const session = this.session;
    if (this.settingsUiOnly) {
      // Settings never holds tokens — clear the keyring and tell main to drop its session.
      if (get().auth.status !== "logged_in" && !session) return;
      this.setSession(null);
      await platform.clearSession().catch(() => undefined);
      void this.broadcastSessionChanged();
      if (reason) toast.warning(reason);
      else toast("Logged out", { description: "Still reading chat anonymously." });
      return;
    }
    if (!session) return;
    this.setSession(null);
    this.armFollows();
    this.stopWrite();
    for (const pending of this.pendingSends) clearTimeout(pending.timer);
    this.pendingSends = [];
    this.globalBadges = new Map();
    this.channelBadges.clear();
    set((s) => ({
      badgeVersion: s.badgeVersion + 1,
      channels: Object.fromEntries(Object.entries(s.channels).map(([k, c]) => [k, { ...c, me: undefined }])),
    }));
    this.read.restart("Switching to anonymous reading");
    await platform.clearSession().catch(() => undefined);
    void this.broadcastSessionChanged();
    if (reason) toast.warning(reason);
    else {
      void revokeToken(session.clientId, session.accessToken);
      toast("Logged out", { description: "Still reading chat anonymously." });
    }
  }

  // ---------------------------------------------------------------- connections

  private startWrite(): void {
    this.stopWrite();
    const write = new IrcConnection({
      url: config.ircUrl,
      name: "write",
      joinChannels: false,
      getCredentials: async () => {
        const session = await this.freshSession();
        if (!session) throw new Error("Not logged in");
        return { nick: session.login, pass: `oauth:${session.accessToken}` };
      },
      onMessage: (message) => this.onWriteMessage(message),
      onStatus: (status, detail) => {
        if (this.write !== write) return;
        set({ write: { status, detail, since: Date.now() } });
        if (status === "auth_failed") void this.recoverAuth();
      },
    });
    this.write = write;
    write.start();
  }

  private stopWrite(): void {
    const write = this.write;
    this.write = null;
    write?.stop();
    set({ write: null });
  }

  retryNow(): void {
    this.read.retryNow();
    this.write?.retryNow();
  }

  private onReadStatus(status: ConnectionStatus, detail: ConnectionDetail): void {
    set({ read: { status, detail, since: Date.now() } });
    if (status === "connected") {
      const now = Date.now();
      set((s) => ({
        channels: Object.fromEntries(
          Object.entries(s.channels).map(([k, c]) => [k, { ...c, status: "joining" as const, joinRequestedAt: now }]),
        ),
      }));
      if (this.dropAnnounced) {
        this.enqueue(systemMessage(ALL_CHANNELS, "Reconnected. Anything said while ZooChattr was offline was missed.", "success"));
        this.dropAnnounced = false;
      }
      this.everConnected = true;
    } else if (status === "reconnecting" && this.everConnected && !this.dropAnnounced) {
      this.dropAnnounced = true;
      this.enqueue(
        systemMessage(ALL_CHANNELS, `Lost the connection to Twitch chat (${detail.reason ?? "network error"}). Reconnecting…`, "warn"),
      );
    } else if (status === "auth_failed") {
      void this.recoverAuth();
    }
  }

  private onReadMessage(message: IrcMessage): void {
    const self = this.session?.login;
    switch (message.command) {
      case "PRIVMSG": {
        const chat = privmsgToChat(message, self);
        if (this.alreadyShown(chat, message.tags.id)) return;
        if (chat.self && this.resolvePending(chat)) return;
        this.enqueue(this.withHighlight(chat));
        return;
      }
      case "USERNOTICE": {
        const chat = usernoticeToChat(message, self);
        if (this.alreadyShown(chat, message.tags.id)) return;
        this.enqueue(this.withHighlight(chat));
        return;
      }
      case "ROOMSTATE":
        this.onRoomState(message);
        return;
      case "USERSTATE":
        this.onUserState(message);
        return;
      case "NOTICE":
        this.onNotice(message, false);
        return;
      case "CLEARCHAT":
        this.onClearChat(message);
        return;
      case "CLEARMSG":
        this.onClearMsg(message);
        return;
    }
  }

  /** Replies to you and extra highlight words count like a name mention (never your own messages). */
  private withHighlight(message: ChatMessage): ChatMessage {
    const settings = get().settings;
    const words = isFeatureOn(settings, message.channel, "highlightWords") ? settings.highlightWords : null;
    return flagMentions(message, this.session?.login, words);
  }

  private onWriteMessage(message: IrcMessage): void {
    if (message.command === "USERSTATE") {
      this.onUserState(message);
      this.markPendingSent(channelFromParam(message.params[0]));
    } else if (message.command === "NOTICE") {
      this.onNotice(message, true);
    }
  }

  private onRoomState(message: IrcMessage): void {
    const channel = channelFromParam(message.params[0]);
    const current = get().channels[channel];
    if (!current) return;
    const state = parseRoomState(message);
    const roomChanged = !!state.roomId && state.roomId !== current.roomId;
    const nowJoined = !!state.roomId && current.status !== "joined";
    this.patchChannel(channel, (c) => ({
      ...c,
      roomState: { ...c.roomState, ...state },
      roomId: state.roomId ?? c.roomId,
      status: state.roomId ? "joined" : c.status,
      error: state.roomId ? undefined : c.error,
    }));
    if (state.roomId && (nowJoined || roomChanged)) {
      const lastLoad = this.emoteLoadedAt.get(channel) ?? 0;
      // Retry right away when a previous download failed (don't remember a blip as "no emotes").
      const retry = emoteRegistry.channelNeedsRetry(channel);
      if (roomChanged || retry || Date.now() - lastLoad > EMOTE_RELOAD_GAP_MS) {
        this.emoteLoadedAt.set(channel, Date.now());
        void emoteRegistry.loadChannel(channel, state.roomId, retry);
      }
      if (this.session && (roomChanged || !this.channelBadges.has(channel))) {
        void this.loadChannelBadges(channel, state.roomId);
      }
    }
  }

  private onUserState(message: IrcMessage): void {
    const channel = channelFromParam(message.params[0]);
    if (!get().channels[channel]) return;
    const me = parseUserState(message);
    this.patchChannel(channel, (c) => ({ ...c, me }));
  }

  private onNotice(message: IrcMessage, fromWrite: boolean): void {
    const channel = channelFromParam(message.params[0]);
    const text = message.params[1] ?? "";
    const msgId = message.tags["msg-id"] ?? "";
    if (!channel || channel === "*" || !get().channels[channel]) return;
    if (msgId === "msg_channel_suspended") {
      this.patchChannel(channel, (c) => ({ ...c, status: "error", error: text || "This channel is suspended." }));
    }
    if (fromWrite && this.failPending(channel, text)) return;
    const notice = noticeToChat(message);
    if (notice) this.enqueue(notice);
  }

  private onClearChat(message: IrcMessage): void {
    const channel = channelFromParam(message.params[0]);
    const target = message.params[1]?.toLowerCase();
    if (!get().channels[channel]) return;
    if (!target) {
      this.enqueue(systemMessage(channel, "A moderator cleared the chat."));
      return;
    }
    this.markDeleted(channel, (m) => m.login === target);
  }

  private onClearMsg(message: IrcMessage): void {
    const channel = channelFromParam(message.params[0]);
    const targetId = message.tags["target-msg-id"];
    if (targetId) this.markDeleted(channel, (m) => m.id === targetId, true);
  }

  // ---------------------------------------------------------------- sending

  send(channel: string, raw: string, reply?: { id: string; login: string; displayName: string; text: string }): ActionResult {
    const text = raw.trim();
    if (!text) return { ok: false };
    if (!this.session || !this.write) return { ok: false, error: "Log in with Twitch to chat. Reading works without it." };
    const view = get().channels[channel];
    if (!view) return { ok: false, error: "Join that channel first." };
    if (Array.from(text).length > 500) return { ok: false, error: "Twitch messages max out at 500 characters." };

    let wire = text;
    let shown = text;
    let kind: ChatMessage["kind"] = "chat";
    if (text.startsWith("/")) {
      const command = text.split(/\s/, 1)[0].toLowerCase();
      if (command !== "/me") {
        return {
          ok: false,
          error: `${command} isn't available here. Twitch retired chat commands over IRC; only /me still works.`,
        };
      }
      shown = text.slice(3).trim();
      if (!shown) return { ok: false, error: "Add a message after /me." };
      wire = `\u0001ACTION ${shown}\u0001`;
      kind = "action";
    }

    const parentId = reply ? replyParentMsgId(reply.id) : null;
    if (reply && !parentId) return { ok: false, error: "That message can't be replied to." };

    const limit = view.me?.mod ? 100 : 20;
    const now = Date.now();
    this.sentLog = this.sentLog.filter((t) => now - t < 30_000);
    if (this.sentLog.length >= limit) {
      return { ok: false, error: `Easy there: Twitch allows ${limit} messages every 30 seconds.` };
    }
    if (!this.write.privmsg(channel, wire, parentId ?? undefined)) {
      return { ok: false, error: "Not connected to Twitch chat right now. Your message wasn't sent." };
    }
    this.sentLog.push(now);

    const id = localId("send");
    const me = view.me;
    this.enqueue({
      id,
      channel,
      kind,
      ts: now,
      login: this.session.login,
      userId: this.session.userId,
      displayName: me?.displayName ?? this.session.login,
      color: me?.color,
      badges: me?.badges ?? [],
      text: shown,
      twitchEmotes: [],
      self: true,
      pending: "sending",
      reply:
        reply && parentId
          ? { login: reply.login, displayName: reply.displayName || reply.login, text: replySnippet(reply.text) }
          : undefined,
    });
    this.pendingSends.push({
      id,
      channel,
      text: shown,
      state: "sending",
      timer: setTimeout(() => this.expirePending(id), 10_000),
    });
    return { ok: true };
  }

  /** Recent chatters in this channel, newest first. Read when Tab is pressed, not on each message. */
  activeChatters(channel: string): readonly ActiveUser[] {
    return this.chatterLists.get(channel) ?? NO_CHATTERS;
  }

  private noteUsers(channel: string, messages: readonly ChatMessage[]): void {
    const prev = this.chatterLists.get(channel) ?? NO_CHATTERS;
    const next = rememberUsers(prev, messages, this.session?.login);
    if (next !== prev) this.chatterLists.set(channel, next);
  }

  /** History can load before login. Drop your own name once the account is known. */
  private dropSelfFromChatters(login: string): void {
    const self = login.toLowerCase();
    for (const [channel, list] of this.chatterLists) {
      if (!list.some((user) => user.login === self)) continue;
      const next = list.filter((user) => user.login !== self);
      if (next.length) this.chatterLists.set(channel, next);
      else this.chatterLists.delete(channel);
    }
  }

  /** Notes a line's Twitch id; drops the oldest once a channel holds SEEN_IDS_PER_CHANNEL. */
  private rememberId(channel: string, message: ChatMessage): void {
    if (message.kind === "system" || message.id.startsWith("send-")) return;
    let seen = this.seenIds.get(channel);
    if (!seen) this.seenIds.set(channel, (seen = new Set()));
    seen.delete(message.id);
    seen.add(message.id);
    if (seen.size > SEEN_IDS_PER_CHANNEL) seen.delete(seen.values().next().value as string);
  }

  /** True when a live line with this Twitch id already came in for its channel (live, saved or history server). */
  private alreadyShown(message: ChatMessage, twitchId: string | undefined): boolean {
    // A late line for a channel you left is dropped by flush; don't start a new id list for it.
    if (!twitchId || twitchId.startsWith("send-") || !get().channels[message.channel]) return false;
    if (this.seenIds.get(message.channel)?.has(twitchId)) {
      console.debug("[zoochattr] dropped duplicate", message.channel, twitchId, message.login);
      return true;
    }
    this.rememberId(message.channel, message);
    return false;
  }

  /** Twitch echoes our message on the read connection with full emote tags; swap it in. */
  private resolvePending(echo: ChatMessage): boolean {
    let index = this.pendingSends.findIndex((p) => p.channel === echo.channel && p.text === echo.text);
    if (index < 0) index = this.pendingSends.findIndex((p) => p.channel === echo.channel);
    if (index >= 0) {
      const [pending] = this.pendingSends.splice(index, 1);
      clearTimeout(pending.timer);
      this.replaceMessage(pending.channel, pending.id, () => echo);
      return true;
    }
    // The 10s tracker is gone (failed or dropped). A late echo must replace the
    // local row, not sit beside it.
    return this.replaceLateOwnEcho(echo);
  }

  /** Oldest matching local send within two minutes. Newest-last, so scan from the end and keep the oldest hit. */
  private replaceLateOwnEcho(echo: ChatMessage): boolean {
    const list = get().channels[echo.channel]?.messages;
    if (!list) return false;
    const cutoff = Date.now() - 120_000;
    let matchId: string | undefined;
    for (let i = list.length - 1; i >= 0; i--) {
      const message = list[i];
      if (message.ts < cutoff) break;
      if (message.id.startsWith("send-") && message.text === echo.text) matchId = message.id;
    }
    if (!matchId) return false;
    this.replaceMessage(echo.channel, matchId, () => echo);
    return true;
  }

  private markPendingSent(channel: string): void {
    const pending = this.pendingSends.find((p) => p.channel === channel && p.state === "sending");
    if (!pending) return;
    pending.state = "sent";
    this.replaceMessage(channel, pending.id, (m) => ({ ...m, pending: undefined }));
  }

  private failPending(channel: string, reason: string): boolean {
    const index = this.pendingSends.findIndex((p) => p.channel === channel);
    if (index < 0) return false;
    const [pending] = this.pendingSends.splice(index, 1);
    clearTimeout(pending.timer);
    this.replaceMessage(channel, pending.id, (m) => ({ ...m, pending: "failed", failReason: reason }));
    return true;
  }

  private expirePending(id: string): void {
    const index = this.pendingSends.findIndex((p) => p.id === id);
    if (index < 0) return;
    const [pending] = this.pendingSends.splice(index, 1);
    if (pending.state === "sending") {
      this.replaceMessage(pending.channel, id, (m) => ({
        ...m,
        pending: "failed",
        failReason: "Twitch never confirmed this message, so it probably wasn't sent.",
      }));
    }
  }

  // ---------------------------------------------------------------- message buffer

  /** Total messages received since launch (for soak stats). */
  received = 0;

  private enqueue(message: ChatMessage): void {
    this.received++;
    this.queue.push(message);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 80);
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];

    if (batch.some((m) => m.mention && !m.self) && !document.hasFocus() && Date.now() - this.lastAttention > 10_000) {
      this.lastAttention = Date.now();
      void platform.requestAttention().catch(() => undefined);
    }
    this.maybeMentionSound(batch);

    const noted = new Map<string, ChatMessage[]>();
    set((state) => {
      const { mode, focused } = state.settings;
      const additions = new Map<string, ChatMessage[]>();
      const counts = new Map<string, { unread: number; mentions: number }>();
      const add = (channel: string, message: ChatMessage) => {
        const list = additions.get(channel);
        if (list) list.push(message);
        else additions.set(channel, [message]);
      };

      for (const message of batch) {
        if (message.channel === ALL_CHANNELS) {
          for (const channel of Object.keys(state.channels)) add(channel, message);
          continue;
        }
        if (!state.channels[message.channel]) continue;
        add(message.channel, message);
        const visible = channelOnScreen(mode, focused, state.settings.gridChannels, message.channel);
        const countable = message.kind === "chat" || message.kind === "action" || message.kind === "event";
        if (!visible && countable && !message.self) {
          const c = counts.get(message.channel) ?? { unread: 0, mentions: 0 };
          c.unread++;
          if (message.mention) c.mentions++;
          counts.set(message.channel, c);
        }
      }

      const channels = { ...state.channels };
      for (const [channel, list] of additions) {
        const view = channels[channel];
        const next = view.messages.concat(list);
        const c = counts.get(channel);
        channels[channel] = {
          ...view,
          messages: this.capMessages(next),
          unread: view.unread + (c?.unread ?? 0),
          mentions: view.mentions + (c?.mentions ?? 0),
        };
        this.scheduleHistorySave(channel);
      }
      for (const [channel, list] of additions) noted.set(channel, list);
      return { channels };
    });
    for (const [channel, list] of noted) this.noteUsers(channel, list);
  }

  /**
   * One chime per cooldown when a live mention lands in any joined chat.
   * Saved history never comes through here, so reopening a log stays quiet.
   */
  private maybeMentionSound(batch: ChatMessage[]): void {
    const settings = get().settings;
    if (!settings.mentionSound) return;
    const open = new Set(Object.keys(get().channels));
    const mentioned = batch.some(
      (m) => m.mention && !m.self && open.has(m.channel) && (m.kind === "chat" || m.kind === "action" || m.kind === "event"),
    );
    if (!mentioned) return;
    const now = Date.now();
    if (!mentionDue(now, this.lastMentionSoundAt, settings.mentionSoundCooldown * 1000)) return;
    this.lastMentionSoundAt = now;
    playMentionChime(THEMES[resolveSkin(settings.skin, settings.autoLightSkin, settings.autoDarkSkin, prefersDarkNow())].animal);
  }

  /** With history on: keep ~48h. Otherwise keep the short live buffer. */
  private capMessages(messages: ChatMessage[]): ChatMessage[] {
    if (get().settings.rememberChatHistory) return trimLiveBuffer(messages);
    return messages.length > config.messageCapPerChannel ? messages.slice(-config.messageCapPerChannel) : messages;
  }

  private replaceMessage(channel: string, id: string, update: (message: ChatMessage) => ChatMessage): void {
    this.flush();
    let changed = false;
    set((state) => {
      const view = state.channels[channel];
      if (!view) return {};
      const list = view.messages;
      let index = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].id === id) {
          index = i;
          break;
        }
      }
      if (index < 0) return {};
      changed = true;
      const next = list.slice();
      next[index] = update(list[index]);
      return { channels: { ...state.channels, [channel]: { ...view, messages: next } } };
    });
    // A pending row is stripped before it hits disk. The echo has to be written too.
    if (changed) this.scheduleHistorySave(channel);
  }

  private markDeleted(channel: string, match: (message: ChatMessage) => boolean, newestOnly = false): void {
    this.flush();
    let changed = false;
    set((state) => {
      const view = state.channels[channel];
      if (!view) return {};
      const list = view.messages;
      const hit = (m: ChatMessage) => m.channel === channel && !m.deleted && match(m);
      if (newestOnly) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (!hit(list[i])) continue;
          changed = true;
          const next = list.slice();
          next[i] = { ...list[i], deleted: true };
          return { channels: { ...state.channels, [channel]: { ...view, messages: next } } };
        }
        return {};
      }
      if (!list.some(hit)) return {};
      changed = true;
      return {
        channels: {
          ...state.channels,
          [channel]: { ...view, messages: list.map((m) => (hit(m) ? { ...m, deleted: true } : m)) },
        },
      };
    });
    if (changed) this.scheduleHistorySave(channel);
  }

  private patchChannel(channel: string, update: (view: ChannelView) => ChannelView): void {
    set((state) => {
      const view = state.channels[channel];
      return view ? { channels: { ...state.channels, [channel]: update(view) } } : {};
    });
  }

  // ---------------------------------------------------------------- channels & view

  /** `toGrid: false`: only follow it (a drag onto a pane places it itself), so no grid slot and no "grid is full" note. */
  addChannel(input: string, { toGrid = true }: { toGrid?: boolean } = {}): ActionResult & { channel?: string } {
    const name = normalizeChannelName(input);
    if (!name) return { ok: false, error: "That doesn't look like a Twitch channel. Use letters, numbers and underscores." };
    if (this.settingsUiOnly) {
      if (get().settings.channels.includes(name)) return { ok: true, channel: name };
      this.updateSettings((s) => ({
        channels: [...s.channels, name],
        gridChannels: fillFreePane(s.gridChannels, name, this.gridCap()) ?? s.gridChannels,
        focused: s.mode === "focused" || !s.focused ? name : s.focused,
      }));
      return { ok: true, channel: name };
    }
    if (get().channels[name]) {
      if (get().settings.mode === "focused") this.focus(name);
      return { ok: true, channel: name };
    }
    set((s) => ({ channels: { ...s.channels, [name]: newChannelView(name) } }));
    const placed = toGrid ? fillFreePane(get().settings.gridChannels, name, this.gridCap()) : null;
    const gridFull = toGrid && !placed;
    this.updateSettings((s) => ({
      channels: [...s.channels, name],
      gridChannels: placed ?? s.gridChannels,
      focused: s.mode === "focused" || !s.focused ? name : s.focused,
    }));
    this.openChannel(name);
    if (this.session) {
      void this.loadProfiles([name]);
      this.queueLivePoll();
    }
    if (gridFull) {
      toast(`Added #${name}`, {
        description: `Grid is full (${this.gridCap()}). Empty a pane with − and pick it there, or open it alone anytime.`,
      });
    }
    return { ok: true, channel: name };
  }

  removeChannel(name: string): void {
    this.read.part(name);
    emoteRegistry.removeChannel(name);
    this.emoteLoadedAt.delete(name);
    this.channelBadges.delete(name);
    this.pendingSends = this.pendingSends.filter((p) => {
      if (p.channel === name) clearTimeout(p.timer);
      return p.channel !== name;
    });
    this.flush();
    this.dropHistoryChannel(name);
    this.chatterLists.delete(name);
    this.seenIds.delete(name);
    clearReplyTarget(name);
    set((s) => {
      const channels = { ...s.channels };
      delete channels[name];
      return { channels };
    });
    this.updateSettings((s) => {
      const index = s.channels.indexOf(name);
      const channels = s.channels.filter((c) => c !== name);
      // Its pane stays where it is, empty.
      const gridChannels = clearPaneOf(s.gridChannels, name);
      const gridParked = s.gridParked.filter((c) => c !== name);
      const fallback = channels[Math.min(Math.max(index, 0), channels.length - 1)] ?? null;
      return { channels, gridChannels, gridParked, focused: s.focused === name ? fallback : s.focused };
    });
    if (useUi.getState().armedComposer === name) useUi.setState({ armedComposer: null });
  }

  moveChannel(name: string, offset: number): void {
    this.updateSettings((s) => {
      const channels = moveItem(s.channels, name, offset);
      return channels ? { channels } : {};
    });
  }

  /** Reorder a box on the grid (not the full follow list). */
  moveGridChannel(name: string, offset: number): void {
    this.updateSettings((s) => {
      // Every pane of the view counts, empty ones too (so a pane can move into an empty pane at the end).
      const panes = [...s.gridChannels];
      while (panes.length < this.gridCap()) panes.push(EMPTY_PANE);
      const moved = moveItem(panes, name, offset);
      if (!moved) return {};
      const gridChannels = trimPanes(moved);
      this.announce(`Moved #${name} ${offset < 0 ? "earlier" : "later"}`);
      return { gridChannels };
    });
  }

  /** Exchange two grid boxes. */
  swapGridChannels(a: string, b: string): void {
    this.updateSettings((s) => {
      const gridChannels = swapItems(s.gridChannels, a, b);
      if (!gridChannels) return {};
      this.announce(`Swapped #${a} with #${b}`);
      return { gridChannels };
    });
  }

  /** Drop a followed channel onto a grid box, swapping when it is already pinned. */
  replaceInGrid(slot: string, incoming: string): void {
    if (!get().settings.channels.includes(incoming)) return;
    this.updateSettings((s) => {
      const gridChannels = replaceGridSlot(s.gridChannels, slot, incoming);
      if (!gridChannels) return {};
      const gridParked = s.gridParked.filter((c) => c !== incoming);
      this.announce(
        s.gridChannels.includes(incoming) ? `Swapped #${slot} with #${incoming}` : `Replaced #${slot} with #${incoming}`,
      );
      // The channel that lands in the focused pane takes over the focus.
      return { gridChannels, gridParked, focused: s.focused === slot ? incoming : s.focused };
    });
  }

  /** Panes in the current grid view (an old saved 5, 7 or 8 counts as the next offered view). */
  private gridCap(): number {
    return viewForSlots(get().settings.gridSlots);
  }

  /**
   * The bottom-left view switch. 1 is Single (the focused channel); 2–9 is the grid with that many panes. Going down
   * sets the extra pins aside; going up brings them back.
   */
  setView(view: ViewSize): void {
    if (view === 1) {
      this.setMode("focused");
      return;
    }
    this.setGridView(view);
    this.setMode("grid");
  }

  /** Grid size without leaving Single (the Settings row). Extra pins are set aside, set-aside ones come back. */
  setGridView(view: ViewSize): void {
    this.updateSettings((s) => ({ gridSlots: view, ...fitGridToView(s.gridChannels, s.gridParked, view) }));
  }

  private announce(text: string): void {
    useUi.setState((s) => ({ liveMessage: text, liveNonce: s.liveNonce + 1 }));
  }

  /** Pin a followed channel onto the grid (max {@link MAX_GRID_SLOTS}). */
  showInGrid(name: string): ActionResult {
    const settings = get().settings;
    if (!settings.channels.includes(name)) return { ok: false, error: "You're not following that channel." };
    if (settings.gridChannels.includes(name)) {
      this.setMode("grid");
      return { ok: true };
    }
    const cap = this.gridCap();
    const gridChannels = fillFreePane(settings.gridChannels, name, cap);
    if (!gridChannels) {
      return {
        ok: false,
        error: `Grid is full (${cap}). Empty a pane with − first, or read this channel alone (view 1).`,
      };
    }
    this.updateSettings((s) => ({ gridChannels, gridParked: s.gridParked.filter((c) => c !== name) }));
    this.setMode("grid");
    this.patchChannel(name, (c) => ({ ...c, unread: 0, mentions: 0 }));
    return { ok: true };
  }

  /** "−" on a pane: the channel stays joined (it counts unread), its pane stays where it is, empty. */
  hideFromGrid(name: string): void {
    const { mode, gridChannels } = get().settings;
    if (mode === "grid" && gridChannels.includes(name)) {
      this.flush();
      const last = get().channels[name]?.messages.at(-1)?.id;
      if (last) this.patchChannel(name, (c) => ({ ...c, readMarker: last }));
    }
    this.updateSettings((s) => ({ gridChannels: clearPaneOf(s.gridChannels, name), gridParked: s.gridParked.filter((c) => c !== name) }));
  }

  /**
   * The channel picker in grid pane `index` loaded `name` (a channel already in the app). A channel already on screen
   * swaps places with what the pane showed. The pane becomes the focused one, so the message box sends there.
   */
  setPaneChannel(index: number, name: string): void {
    const settings = get().settings;
    if (!settings.channels.includes(name) || index < 0 || index >= this.gridCap()) return;
    const replaced = settings.gridChannels[index];
    this.updateSettings((s) => ({
      gridChannels: placeInPane(s.gridChannels, index, name),
      gridParked: s.gridParked.filter((c) => c !== name),
      focused: name,
    }));
    if (replaced && replaced !== name) this.announce(`Replaced #${replaced} with #${name}`);
    if (settings.mode === "grid") this.patchChannel(name, (c) => ({ ...c, unread: 0, mentions: 0 }));
  }

  /** "−" in view 1: nothing is shown until a channel is picked (it stays joined). */
  clearSingle(): void {
    const { mode, focused } = get().settings;
    if (mode !== "focused" || !focused) return;
    this.markRead(focused, null);
    this.updateSettings({ focused: null });
  }

  /** Remembers where the user stopped reading the channel they're leaving. */
  private markRead(leaving: string | null, entering: string | null): void {
    const { mode } = get().settings;
    if (mode !== "focused" || !leaving || leaving === entering) return;
    this.flush();
    this.patchChannel(leaving, (c) => ({ ...c, readMarker: c.messages[c.messages.length - 1]?.id }));
  }

  /**
   * Makes a grid pane the focused one (teal underline; the message box sends there) without leaving the grid.
   * Ctrl+G then opens this pane alone.
   */
  setActivePane(name: string): void {
    const s = get().settings;
    if (s.focused === name || !s.channels.includes(name)) return;
    this.updateSettings({ focused: name });
  }

  focus(name: string): void {
    const settings = get().settings;
    const fromGrid = settings.mode === "grid";
    const wasOnGrid = fromGrid && settings.gridChannels.includes(name);
    this.markRead(settings.focused, name);
    this.updateSettings({ mode: "focused", focused: name });
    this.patchChannel(name, (c) => ({
      ...c,
      unread: 0,
      mentions: 0,
      readMarker: readMarkerAfterFocus(fromGrid, wasOnGrid, c.readMarker),
    }));
  }

  setMode(mode: ViewMode): void {
    if (mode === "focused") {
      const { focused, channels, gridChannels } = get().settings;
      const target = focused ?? paneChannels(gridChannels)[0] ?? channels[0];
      if (target) this.focus(target);
      else this.updateSettings({ mode });
      return;
    }
    const { focused, gridChannels } = get().settings;
    const onGrid = new Set(gridChannels);
    if (focused && onGrid.has(focused)) {
      // Still on screen in a grid box. A divider here would say you left a chat you can see.
      const view = get().channels[focused];
      if (view?.readMarker) this.patchChannel(focused, (c) => ({ ...c, readMarker: undefined }));
    } else {
      this.markRead(focused, null);
    }
    this.updateSettings({ mode });
    // Only clear unread on channels that are actually on the grid.
    set((s) => ({
      channels: Object.fromEntries(
        Object.entries(s.channels).map(([k, c]) =>
          onGrid.has(k) && (c.unread || c.mentions) ? [k, { ...c, unread: 0, mentions: 0 }] : [k, c],
        ),
      ),
    }));
  }

  reloadEmotes(channel: string): void {
    const view = get().channels[channel];
    if (!view?.roomId) {
      toast("Emotes load once Twitch confirms the channel.");
      return;
    }
    this.emoteLoadedAt.set(channel, Date.now());
    this.globalEmotesLoadedAt = Date.now();
    void emoteRegistry.loadChannel(channel, view.roomId, true);
    void emoteRegistry.loadGlobal(true);
  }

  /** Throws away remembered emote lists and fetches fresh ones for every joined channel. */
  forgetEmotes(): void {
    emoteRegistry.forgetCache();
    this.refetchEmotes();
  }

  private refetchEmotes(): void {
    this.globalEmotesLoadedAt = Date.now();
    void emoteRegistry.loadGlobal(true);
    for (const view of Object.values(get().channels)) {
      if (view.roomId) {
        this.emoteLoadedAt.set(view.login, Date.now());
        void emoteRegistry.loadChannel(view.login, view.roomId, true);
      }
    }
  }

  /** `keepSavedHistory`: turning chat history off here stops saving but leaves the logs. Only the user's own toggle wipes them. */
  updateSettings(
    patch: Partial<Settings> | ((settings: Settings) => Partial<Settings>),
    { keepSavedHistory = false }: { keepSavedHistory?: boolean } = {},
  ): void {
    const before = get().settings;
    set((s) => {
      const next = { ...s.settings, ...(typeof patch === "function" ? patch(s.settings) : patch) };
      // Hiding, leaving or replacing the focused pane moves the focus to a pane that is still on screen.
      next.focused = focusOnGrid(next.mode, next.focused, next.gridChannels);
      return { settings: next };
    });
    const after = get().settings;
    if (after.closeToTray !== before.closeToTray) void platform.setCloseToTray(after.closeToTray).catch(() => undefined);
    if (after.startOnLogin !== before.startOnLogin) {
      void platform.setLaunchAtLogin(after.startOnLogin).catch((err) => {
        toast.error("Couldn't change start on login", { description: errorText(err) });
        set((s) => ({ settings: { ...s.settings, startOnLogin: before.startOnLogin } }));
      });
    }
    emoteRegistry.setPrefs(emotePrefsFrom(after));
    if (after.rememberEmotes && !before.rememberEmotes) {
      // Turning "remember" on: fetch once more so every current list gets stored.
      this.refetchEmotes();
    } else if (!after.rememberEmotes && before.rememberEmotes) {
      emoteRegistry.forgetCache();
    }
    if (after.rememberChatHistory && !before.rememberChatHistory) {
      for (const channel of Object.keys(get().channels)) this.scheduleHistorySave(channel);
      this.armHistoryFlush();
    } else if (!after.rememberChatHistory && before.rememberChatHistory) {
      this.stopHistoryFlush();
      if (!keepSavedHistory) void this.forgetAllHistory();
    }
    if (after.autoCheckUpdates !== before.autoCheckUpdates) {
      this.armUpdateChecks(after.autoCheckUpdates);
    }
    this.saveDirty = true;
    void this.persistSettings();
  }

  /** Wipe every saved chat log (Settings → Storage). */
  async clearSavedHistory(): Promise<void> {
    this.historyUnsaved.clear();
    this.historyOnDisk.clear();
    await platform.clearChatHistory();
    set((state) => {
      const channels = { ...state.channels };
      for (const [name, view] of Object.entries(channels)) {
        channels[name] = { ...view, messages: [] };
      }
      return { channels };
    });
    toast("Chat history cleared", { description: "Saved logs for every channel are gone." });
  }

  /** Replaces every preference (not the channel list or view) with the ones from a backup or the defaults. */
  replacePreferences(source: Settings): void {
    this.updateSettings(
      (current) => {
        const next: Partial<Settings> = { ...source };
        delete next.channels;
        delete next.gridChannels;
        delete next.gridParked;
        delete next.focused;
        delete next.mode;
        delete next.version;
        // Keep the view pointing at a channel we actually have, and the pins within the (possibly new) view size.
        // Same view size: a pane emptied on purpose stays empty.
        const slots = next.gridSlots ?? current.gridSlots;
        const refill = viewForSlots(slots) !== viewForSlots(current.gridSlots);
        return { ...next, focused: current.focused, ...fitGridToView(current.gridChannels, current.gridParked, slots, refill) };
      },
      { keepSavedHistory: true },
    );
  }

  /** Saves right away (so closing the window can't lose a change), one write at a time, latest state wins. */
  private async persistSettings(): Promise<void> {
    if (this.saving || this.savesBlocked) return;
    this.saving = true;
    try {
      while (this.saveDirty) {
        this.saveDirty = false;
        try {
          await platform.saveSettings(get().settings);
          this.saveErrorShown = false;
          if (this.settingsUiOnly) void this.broadcastSettingsChanged();
        } catch (err) {
          if (!this.saveErrorShown) {
            this.saveErrorShown = true;
            toast.error("Couldn't save settings", { description: errorText(err) });
          }
        }
      }
    } finally {
      this.saving = false;
    }
  }

  private tick(): void {
    if (this.read.status !== "connected") return;
    const now = Date.now();
    for (const view of Object.values(get().channels)) {
      if (view.status === "joining" && now - view.joinRequestedAt > JOIN_TIMEOUT_MS) {
        this.patchChannel(view.login, (c) => ({
          ...c,
          status: "error",
          error: `Twitch never confirmed #${c.login}. Check the spelling; the channel may not exist or may be banned.`,
        }));
      }
    }
    this.refreshStaleEmotes(now);
  }

  /**
   * New, removed or renamed 7TV / BTTV / FFZ emotes show up without a restart: a channel's lists are
   * fetched again once they're an hour old (global ones after 12 hours), one set per 5 s tick so the
   * requests are spread out. The emotes on screen stay until the fresh list arrives.
   */
  private refreshStaleEmotes(now: number): void {
    if (now - this.globalEmotesLoadedAt > FRESH_FOR.global) {
      this.globalEmotesLoadedAt = now;
      void emoteRegistry.loadGlobal(true);
      return;
    }
    for (const view of Object.values(get().channels)) {
      const loadedAt = this.emoteLoadedAt.get(view.login);
      if (view.status !== "joined" || !view.roomId || loadedAt === undefined || now - loadedAt < FRESH_FOR.channel) continue;
      this.emoteLoadedAt.set(view.login, now);
      void emoteRegistry.loadChannel(view.login, view.roomId, true);
      return;
    }
  }

  // ---------------------------------------------------------------- chat history & updates

  private async restoreHistory(channels: string[]): Promise<void> {
    await Promise.all(
      channels.map(async (channel) => {
        try {
          const raw = await platform.loadChatHistory(channel);
          const history = sanitizeHistory(raw);
          if (!history.length) return;
          let unsavedLive = false;
          this.patchChannel(channel, (view) => {
            // Lines already on screen (they arrived while the file was loading)
            // win over the copy from disk so a delete in that window is kept.
            const liveById = new Map<string, ChatMessage>();
            for (const message of view.messages) {
              if (!message.id.startsWith("hist-boundary:")) liveById.set(message.id, message);
            }
            const seen = new Set<string>();
            const merged: ChatMessage[] = [];
            for (const message of history) {
              this.rememberId(channel, message);
              const live = liveById.get(message.id);
              if (live && !live.pending) {
                merged.push(live);
                if (messageStamp(live) !== messageStamp(message)) unsavedLive = true;
              } else {
                merged.push(message);
              }
              seen.add(message.id);
            }
            const liveOnly: ChatMessage[] = [];
            for (const message of view.messages) {
              if (message.id.startsWith("hist-boundary:") || seen.has(message.id)) continue;
              liveOnly.push(message);
              if (!message.pending) unsavedLive = true;
            }
            return { ...view, messages: this.capMessages([...merged, historyBoundary(channel), ...liveOnly]) };
          });
          this.markOnDisk(channel, history);
          if (unsavedLive) this.scheduleHistorySave(channel);
          const seeded = get().channels[channel]?.messages;
          if (seeded) this.noteUsers(channel, seeded);
        } catch {
          // Missing or unreadable history is fine — start empty.
        }
      }),
    );
  }

  /** Saved lines, then the history server's gap, then live chat. */
  private openChannel(name: string): void {
    if (!get().settings.rememberChatHistory) {
      this.read.join(name);
      return;
    }
    void this.joinAfterFill([name], this.restoreHistory([name]).then(() => this.fetchServerHistory([name])));
  }

  /** Adds what the history server caught, then joins. Twitch never replays a line said before the join, so none comes twice. */
  private async joinAfterFill(channels: string[], pending: Promise<ServerFill[]>): Promise<void> {
    try {
      this.applyServerHistory(await pending);
    } finally {
      for (const channel of channels) if (get().channels[channel]) this.read.join(channel);
    }
  }

  /** Asks the history server (Settings → History server) for each channel's lines since the newest saved one. */
  private async fetchServerHistory(channels: string[]): Promise<ServerFill[]> {
    const settings = get().settings;
    const server = activeHistoryServer(settings);
    if (!server || !settings.rememberChatHistory || !channels.length) return [];
    const token = await platform.loadHistoryToken().then(
      (value) => value || new HistoryServerError("unauthorized", "No read token is saved on this computer."),
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    // The built-in address without a token is the normal state for anyone but the logger's owner:
    // don't ask the server, don't warn at every start (not even when the credential store can't be read).
    if (token instanceof Error && !settings.historyServer) return [];
    if (token instanceof Error) return channels.map((channel) => ({ channel, error: token }));
    return Promise.all(
      channels.map(async (channel): Promise<ServerFill> => {
        const newest = newestTwitchTime(get().channels[channel]?.messages ?? []);
        try {
          const after = newest === undefined ? undefined : newest - OVERLAP_MS;
          return { channel, result: await fetchServerLines({ server, token, channel, after }) };
        } catch (err) {
          return { channel, error: err };
        }
      }),
    );
  }

  /** One toast when any channel couldn't be filled in. */
  private applyServerHistory(fills: ServerFill[]): void {
    let problem: unknown;
    for (const fill of fills) {
      if ("error" in fill) problem ??= fill.error;
      else if (fill.result) this.mergeServerLines(fill.channel, fill.result);
    }
    if (problem === undefined) return;
    const tokenProblem = problem instanceof HistoryServerError && problem.problem === "unauthorized";
    toast.warning("Couldn't fill in missed chat", {
      description: tokenProblem ? `${errorText(problem)} Check it in Settings → Account & history → History server.` : errorText(problem),
    });
  }

  private mergeServerLines(channel: string, result: FillResult): void {
    const incoming = serverMessages(result.lines, this.session?.login).map((message) => this.withHighlight(message));
    if (!incoming.length) return;
    // A line still in the 80ms paint queue counts as already here.
    this.flush();
    let added = 0;
    this.patchChannel(channel, (view) => {
      const merged = mergeServerMessages(view.messages, incoming, channel, (fresh) => fillNote(channel, fresh, result.truncated));
      added = merged.added.length;
      for (const message of merged.added) this.rememberId(channel, message);
      return added ? { ...view, messages: this.capMessages(merged.messages) } : view;
    });
    if (!added) return;
    // Write them now, before live lines pile up behind them, rather than at the next 30s flush.
    this.historyUnsaved.delete(channel);
    void this.appendUnsaved(channel);
    const seeded = get().channels[channel]?.messages;
    if (seeded) this.noteUsers(channel, seeded);
  }

  private scheduleHistorySave(channel: string): void {
    if (!get().settings.rememberChatHistory) return;
    this.historyUnsaved.add(channel);
    this.armHistoryFlush();
  }

  private armHistoryFlush(): void {
    if (this.historyFlushTimer || !get().settings.rememberChatHistory) return;
    this.historyFlushTimer = setInterval(() => {
      void this.flushSavedHistory();
    }, HISTORY_FLUSH_MS);
  }

  private stopHistoryFlush(): void {
    if (!this.historyFlushTimer) return;
    clearInterval(this.historyFlushTimer);
    this.historyFlushTimer = null;
  }

  private markOnDisk(channel: string, messages: ChatMessage[]): void {
    const saved = new Map<string, string>();
    for (const message of messages) {
      if (message.pending || message.id.startsWith("hist-boundary:")) continue;
      saved.set(message.id, messageStamp(message));
    }
    this.historyOnDisk.set(channel, saved);
  }

  private dropHistoryChannel(channel: string): void {
    this.historyUnsaved.delete(channel);
    this.historyOnDisk.delete(channel);
  }

  private linesToAppend(channel: string): ChatMessage[] {
    const view = get().channels[channel];
    if (!view) return [];
    const known = this.historyOnDisk.get(channel) ?? new Map<string, string>();
    const batch: ChatMessage[] = [];
    for (const message of view.messages) {
      if (message.pending || message.id.startsWith("hist-boundary:")) continue;
      const stamp = messageStamp(message);
      if (known.get(message.id) === stamp) continue;
      batch.push(message);
    }
    return batch;
  }

  private async appendUnsaved(channel: string): Promise<void> {
    const previous = this.historyWriting.get(channel) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.appendUnsavedNow(channel));
    this.historyWriting.set(channel, run);
    try {
      await run;
    } finally {
      if (this.historyWriting.get(channel) === run) this.historyWriting.delete(channel);
    }
  }

  private async appendUnsavedNow(channel: string): Promise<void> {
    if (!get().settings.rememberChatHistory) return;
    const batch = this.linesToAppend(channel);
    if (!batch.length) return;
    try {
      await platform.appendChatHistory(channel, batch);
      const known = this.historyOnDisk.get(channel) ?? new Map<string, string>();
      for (const message of batch) known.set(message.id, messageStamp(message));
      this.historyOnDisk.set(channel, known);
    } catch {
      this.historyUnsaved.add(channel);
    }
  }

  /** Append lines that are still only in memory. Quit, update, and shutdown call this too. */
  async flushSavedHistory(): Promise<void> {
    if (!get().settings.rememberChatHistory) return;
    // The 80ms paint queue is not on screen yet. Empty it before reading the view.
    this.flush();
    const channels = [...this.historyUnsaved];
    this.historyUnsaved.clear();
    await Promise.all(channels.map((channel) => this.appendUnsaved(channel)));
  }

  private async listenForExitFlush(): Promise<void> {
    if (!platform.isTauri || this.exitFlushListening) return;
    this.exitFlushListening = true;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen("flush-history", async () => {
        await this.flushSavedHistory();
        await platform.finishExit();
      });
    } catch {
      this.exitFlushListening = false;
    }
  }

  private async forgetAllHistory(): Promise<void> {
    this.stopHistoryFlush();
    this.historyUnsaved.clear();
    this.historyOnDisk.clear();
    try {
      await platform.clearChatHistory();
    } catch (err) {
      toast.error("Couldn't clear saved chat history", { description: errorText(err) });
    }
  }

  private armUpdateChecks(enabled: boolean): void {
    if (this.updateCheckTimer) {
      clearInterval(this.updateCheckTimer);
      this.updateCheckTimer = null;
    }
    if (!enabled) return;
    void this.checkForUpdateQuietly();
    this.updateCheckTimer = setInterval(() => void this.checkForUpdateQuietly(), UPDATE_CHECK_GAP_MS);
  }

  /** Background check — toast only when a newer portable build exists. */
  private async checkForUpdateQuietly(): Promise<void> {
    if (!get().settings.autoCheckUpdates) return;
    const version = get().appInfo?.version;
    if (!version || version === "dev") return;
    try {
      const info = await fetchLatestRelease();
      if (!info || !isNewerVersion(info.version, version)) return;
      toast(`ZooChattr ${info.tag} is out`, {
        description: "Your channels stay in ZooChattr-data when you update.",
        duration: 20_000,
        action: {
          label: "Install",
          onClick: () => installUpdate(info.downloadUrl),
        },
      });
    } catch {
      // Quiet on network blips — manual Check for updates still works in Settings.
    }
  }

  /**
   * Tray "Check for updates…": toast only. Does not open Settings, show the
   * main window, or start a download until the user clicks Install.
   */
  async checkForUpdateFromTray(): Promise<void> {
    const version = get().appInfo?.version;
    try {
      const info = await fetchLatestRelease();
      if (!info) {
        toast.error("Couldn't check for updates");
        return;
      }
      if (!version || version === "dev" || !isNewerVersion(info.version, version)) {
        toast("You're on the latest version");
        return;
      }
      toast(`ZooChattr ${info.tag} is out`, {
        description: "Your channels stay in ZooChattr-data when you update.",
        duration: 20_000,
        action: {
          label: "Install",
          onClick: () => installUpdate(info.downloadUrl),
        },
      });
    } catch (err) {
      toast.error("Couldn't check for updates", { description: errorText(err) });
    }
  }

  // ---------------------------------------------------------------- badges & profiles

  badgeImage(channel: string, badge: Badge): BadgeImage | undefined {
    const key = `${badge.setId}/${badge.version}`;
    return this.channelBadges.get(channel)?.get(key) ?? this.globalBadges.get(key) ?? publicBadge(badge.setId);
  }

  private async loadGlobalBadges(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      this.globalBadges = await fetchGlobalBadges(session);
      set((s) => ({ badgeVersion: s.badgeVersion + 1 }));
    } catch (err) {
      if (err instanceof HelixUnauthorizedError) void this.recoverAuth();
    }
  }

  private async loadChannelBadges(channel: string, roomId: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      this.channelBadges.set(channel, await fetchChannelBadges(session, roomId));
      set((s) => ({ badgeVersion: s.badgeVersion + 1 }));
    } catch (err) {
      if (err instanceof HelixUnauthorizedError) void this.recoverAuth();
    }
  }

  private async loadProfiles(logins: string[]): Promise<void> {
    const session = this.session;
    if (!session || !logins.length) return;
    try {
      const users = await fetchUsers(session, logins);
      for (const user of users) {
        this.patchChannel(user.login, (c) => ({ ...c, displayName: user.displayName, avatarUrl: user.avatarUrl }));
      }
      const found = new Set(users.map((u) => u.login));
      for (const login of logins) {
        if (!found.has(login)) {
          this.patchChannel(login, (c) => ({ ...c, status: "error", error: `Twitch has no channel called #${login}.` }));
        }
      }
    } catch (err) {
      if (err instanceof HelixUnauthorizedError) void this.recoverAuth();
    }
  }

  // ---------------------------------------------------------------- follows and live dots

  /** Starts (logged in) or stops (logged out) the follow list and live-dot checks. Called on every login change. */
  private armFollows(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.livePollSoon) clearTimeout(this.livePollSoon);
    this.liveTimer = null;
    this.livePollSoon = null;
    this.followsFetchedAt = 0;
    // Answers to requests started before this login change are dropped (a token refresh doesn't count).
    this.followsGeneration++;
    const userId = this.session && !this.settingsUiOnly ? this.session.userId : null;
    if (!userId) {
      this.followsUser = null;
      set({ follows: {}, followsState: "off", live: null });
      return;
    }
    // Another account: don't show the previous one's follows or dots while the new ones load.
    if (this.followsUser !== userId) set({ follows: {}, live: null });
    this.followsUser = userId;
    set({ followsState: "loading" });
    void this.refreshFollows();
    this.liveTimer = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - this.followsFetchedAt > FOLLOWS_REFRESH_MS) void this.refreshFollows();
      else void this.pollLive();
    }, LIVE_POLL_MS);
  }

  /** Back from the tray or a minimised window: catch up on what went stale while hidden. */
  private onVisible(): void {
    if (!this.session || !this.liveTimer) return;
    if (Date.now() - this.followsFetchedAt > FOLLOWS_REFRESH_MS) void this.refreshFollows();
    else if (Date.now() - this.liveCheckedAt > LIVE_POLL_MS) void this.pollLive();
  }

  /**
   * Twitch said 401 to a follows or live check. Refresh the token quietly (chat stays connected); only when that
   * fails does the usual recovery (log out) run. At most once per 10 minutes so a persistent 401 can't loop.
   */
  private async onHelixPollUnauthorized(): Promise<void> {
    if (Date.now() - this.pollAuthRetryAt < 10 * 60_000) return;
    this.pollAuthRetryAt = Date.now();
    let next: Session | null | undefined;
    try {
      next = await this.refreshOnce();
    } catch {
      next = undefined;
    }
    if (next === null) await this.recoverAuth();
  }

  /** A channel was just added: show its live dot without waiting a whole poll. */
  private queueLivePoll(): void {
    if (this.livePollSoon) clearTimeout(this.livePollSoon);
    this.livePollSoon = setTimeout(() => {
      this.livePollSoon = null;
      void this.pollLive();
    }, 1_500);
  }

  /** The picker's Retry after the follow list couldn't be fetched. Same fetch as the timer's. */
  retryFollows(): void {
    if (!this.session || !this.liveTimer) return;
    if (get().followsState !== "ok") set({ followsState: "loading" });
    void this.refreshFollows();
  }

  private async refreshFollows(): Promise<void> {
    const generation = this.followsGeneration;
    // A token that's about to expire is refreshed first, so the check itself doesn't hit a 401.
    const session = await this.pollSession();
    if (generation !== this.followsGeneration) return;
    if (!session) {
      if (get().followsState === "loading") set({ followsState: "error" });
      return;
    }
    // Logged in before ZooChattr asked for this permission: the picker offers a fresh login instead.
    if (!hasFollowsScope(session.scopes)) {
      this.followsFetchedAt = Date.now();
      set({ follows: {}, followsState: "needs-login" });
      await this.pollLive();
      return;
    }
    let unauthorized = false;
    try {
      const list = await fetchFollowedChannels(session);
      if (generation !== this.followsGeneration) return;
      // Stamped only on success: a failed fetch (offline, timeout) is tried again on the next poll, not in 15 minutes.
      this.followsFetchedAt = Date.now();
      const before = get().follows;
      const follows: Record<string, FollowView> = {};
      for (const f of list) {
        follows[f.login] = { displayName: f.displayName, followedAt: f.followedAt, avatarUrl: before[f.login]?.avatarUrl };
      }
      set({ follows, followsState: "ok" });
      // Pictures for every follow (kept across refreshes), so one you Leave keeps its picture in the picker.
      const missing = list.map((f) => f.login).filter((login) => !follows[login].avatarUrl);
      if (missing.length) void this.loadFollowPictures(session, missing, generation);
    } catch (err) {
      unauthorized = err instanceof HelixUnauthorizedError;
      // Failed (offline, timeout, 401): try the follow list again in 5 minutes; live dots keep updating meanwhile.
      if (generation === this.followsGeneration) {
        this.followsFetchedAt = Date.now() - FOLLOWS_REFRESH_MS + 5 * 60_000;
        // A list fetched earlier stays up; only a first fetch that failed shows the error (with Retry).
        if (get().followsState !== "ok") set({ followsState: "error" });
      }
    }
    // A 401 to a request made before a logout or login switch says nothing about the current login.
    if (unauthorized && generation === this.followsGeneration && this.session) await this.onHelixPollUnauthorized();
    await this.pollLive();
  }

  /** The login for a background check: refreshed when close to expiry, but a check never logs out a login that can't refresh. */
  private async pollSession(): Promise<Session | null> {
    if (!this.session) return null;
    if (!this.session.refreshToken) return this.session;
    return this.freshSession();
  }

  private async loadFollowPictures(session: Session, logins: string[], generation: number): Promise<void> {
    try {
      const users = await fetchUsers(session, logins);
      if (generation !== this.followsGeneration) return;
      set((s) => {
        const follows = { ...s.follows };
        for (const user of users) {
          if (follows[user.login]) follows[user.login] = { ...follows[user.login], avatarUrl: user.avatarUrl };
        }
        return { follows };
      });
    } catch {
      // Letter avatars stay; the next follow refresh tries again.
    }
  }

  /** Viewer counts for every channel in the picker. Skipped while the window is hidden (tray or minimised). */
  private async pollLive(): Promise<void> {
    if (!this.session || document.hidden) return;
    const generation = this.followsGeneration;
    const session = await this.pollSession();
    if (!session || generation !== this.followsGeneration) return;
    const logins = [...new Set([...get().settings.channels, ...Object.keys(get().follows)])];
    this.liveCheckedAt = Date.now();
    if (!logins.length) {
      if (!sameLive(get().live, {})) set({ live: {} });
      return;
    }
    try {
      const live = await fetchLiveStreams(session, logins);
      if (generation !== this.followsGeneration) return;
      if (!sameLive(get().live, live)) set({ live });
    } catch (err) {
      if (err instanceof HelixUnauthorizedError && generation === this.followsGeneration && this.session) {
        await this.onHelixPollUnauthorized();
      }
    }
  }
}

export const chat = new ChatController();

declare global {
  interface Window {
    /** Read-only counters for soak tests; never exposes tokens. */
    __zoochattrStats?: () => Record<string, unknown>;
  }
}

if (typeof window !== "undefined") {
  window.__zoochattrStats = () => {
    const s = get();
    return {
      read: s.read.status,
      readDetail: s.read.detail,
      auth: s.auth.status,
      channels: Object.values(s.channels).map((c) => ({
        login: c.login,
        status: c.status,
        messages: c.messages.length,
        unread: c.unread,
        emotes: emoteRegistry.channelEmotes(c.login).length,
      })),
      received: chat.received,
      mentionChimes: mentionChimesPlayed(),
      rows: document.querySelectorAll(".chat-row").length,
      emoteImages: document.querySelectorAll("img.chat-emote").length,
    };
  };
}

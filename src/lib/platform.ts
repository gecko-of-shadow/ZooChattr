import type { Session } from "@/lib/twitch/auth";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface AppInfo {
  version: string;
  dataDir: string;
  portable: boolean;
  tokenStore: string;
  platform: string;
  /** Set when the desktop process was started with ZOOCHATTR_VERIFY=1. */
  verify?: boolean;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

const SETTINGS_KEY = "zoochattr.settings";
const SESSION_KEY = "zoochattr.session";
const HISTORY_TOKEN_KEY = "zoochattr.historyToken";

export async function getAppInfo(): Promise<AppInfo> {
  if (isTauri) return invoke<AppInfo>("app_info");
  return {
    version: "dev",
    dataDir: "Browser localStorage (dev mode)",
    portable: false,
    tokenStore: "Browser session storage (dev mode only)",
    platform: "browser",
    verify: import.meta.env.VITE_ZOOCHATTR_VERIFY === "1",
  };
}

export async function loadSettings(): Promise<unknown | null> {
  if (isTauri) return invoke<unknown | null>("settings_load");
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Why settings_load failed. `keptCopy` names the moved-aside file; null means settings.json is still there, unread. */
export interface SettingsLoadFailure {
  message: string;
  keptCopy: string | null;
}

export function settingsLoadFailure(err: unknown): SettingsLoadFailure {
  if (err && typeof err === "object" && "message" in err) {
    const { message, keptCopy } = err as { message: unknown; keptCopy?: unknown };
    return { message: String(message), keptCopy: typeof keptCopy === "string" && keptCopy ? keptCopy : null };
  }
  return { message: String(err), keptCopy: null };
}

export async function saveSettings(settings: unknown): Promise<void> {
  if (isTauri) return invoke("settings_save", { settings });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadSession(): Promise<Session | null> {
  const raw = isTauri ? await invoke<string | null>("session_load") : sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session.accessToken && session.login ? session : null;
  } catch {
    return null;
  }
}

/** Login name only — Settings popout. Never returns tokens. */
export async function loadAuthDisplay(): Promise<{ login: string; userId: string; remembered: boolean } | null> {
  if (isTauri) {
    return invoke<{ login: string; userId: string; remembered: boolean } | null>("auth_display");
  }
  const session = await loadSession();
  if (!session) return null;
  return { login: session.login, userId: session.userId, remembered: true };
}

export async function saveSession(session: Session): Promise<void> {
  const payload = JSON.stringify(session);
  if (isTauri) return invoke("session_save", { payload });
  sessionStorage.setItem(SESSION_KEY, payload);
}

export async function clearSession(): Promise<void> {
  if (isTauri) return invoke("session_clear");
  sessionStorage.removeItem(SESSION_KEY);
}

/** Main window only: the history server's read token. The Settings window can't read it back. */
export async function loadHistoryToken(): Promise<string | null> {
  if (isTauri) return invoke<string | null>("history_token_load");
  return sessionStorage.getItem(HISTORY_TOKEN_KEY);
}

/** Keeps the read token next to the Twitch login, never in settings.json. An empty token forgets it. */
export async function saveHistoryToken(token: string): Promise<void> {
  const value = token.trim();
  if (isTauri) return invoke("history_token_save", { token: value });
  if (value) sessionStorage.setItem(HISTORY_TOKEN_KEY, value);
  else sessionStorage.removeItem(HISTORY_TOKEN_KEY);
}

/** Whether a read token is saved (Settings shows this instead of the token). */
export async function historyTokenSaved(): Promise<boolean> {
  if (isTauri) return invoke<boolean>("history_token_saved");
  return !!sessionStorage.getItem(HISTORY_TOKEN_KEY);
}

/** Whether closing the window hides ZooChattr in the tray (true) or quits it. */
export async function setCloseToTray(enabled: boolean): Promise<void> {
  if (isTauri) await invoke("set_close_to_tray", { enabled });
}

/** Tray tooltip, e.g. "ZooChattr · 2 mentions". */
export async function setTrayStatus(mentions: number): Promise<void> {
  if (isTauri) await invoke("set_tray_status", { mentions });
}

/** Flashes the taskbar button (Windows) / bounces the dock icon. */
export async function requestAttention(): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
  await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Really quit (after the user confirmed). Closing the window only hides to the tray. */
export async function quitApp(): Promise<void> {
  if (isTauri) await invoke("quit_app");
  else window.close();
}

/** Start (or stop starting) ZooChattr when Windows signs you in. */
export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (isTauri) await invoke("set_launch_at_login", { enabled });
}

const chatHistoryKey = (channel: string) => `zoochattr.chat.${channel}`;

function rememberParsedLine(items: unknown[], index: Map<string, number>, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string") {
    items.push(value);
    return;
  }
  const at = index.get(id);
  if (at === undefined) {
    index.set(id, items.length);
    items.push(value);
  } else {
    items[at] = value;
  }
}

/** JSON array (old logs) or JSON Lines. A later line with the same id wins. */
function parseStoredHistory(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const items: unknown[] = [];
  const index = new Map<string, number>();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        for (const row of parsed) rememberParsedLine(items, index, row);
        return items;
      }
    } catch {
      // Fall through and try lines.
    }
  }
  for (const line of trimmed.split("\n")) {
    if (!line) continue;
    try {
      rememberParsedLine(items, index, JSON.parse(line) as unknown);
    } catch {
      // Skip a torn line.
    }
  }
  return items;
}

function historyToJsonl(items: unknown[]): string {
  if (!items.length) return "";
  return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}

/** Last saved chat lines for a channel (or null when none). */
export async function loadChatHistory(channel: string): Promise<unknown | null> {
  if (isTauri) return invoke<unknown | null>("chat_history_load", { channel });
  const raw = localStorage.getItem(chatHistoryKey(channel));
  if (!raw) return null;
  const items = parseStoredHistory(raw);
  if (raw.trim().startsWith("[")) {
    localStorage.setItem(chatHistoryKey(channel), historyToJsonl(items));
  }
  return items.length ? items : null;
}

/** Append lines in one write. Returns the log size. An empty list does not touch storage. */
export async function appendChatHistory(channel: string, messages: unknown[]): Promise<number> {
  if (!messages.length) return 0;
  if (isTauri) return invoke<number>("chat_history_append", { channel, messages });
  const key = chatHistoryKey(channel);
  const prev = localStorage.getItem(key) ?? "";
  const base = prev.trim().startsWith("[") ? historyToJsonl(parseStoredHistory(prev)) : prev;
  const next = `${base}${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
  localStorage.setItem(key, next);
  return next.length;
}

/** Wipe one channel's history, or every channel when `channel` is omitted. */
export async function clearChatHistory(channel?: string): Promise<void> {
  if (isTauri) {
    await invoke("chat_history_clear", { channel: channel ?? null });
    return;
  }
  if (channel) {
    localStorage.removeItem(chatHistoryKey(channel));
    return;
  }
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("zoochattr.chat.")) localStorage.removeItem(key);
  }
}

/** Lets the process exit after the history buffer has been appended. */
export async function finishExit(): Promise<void> {
  if (isTauri) await invoke("finish_exit");
}

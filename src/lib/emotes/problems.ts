// Recent emote-download failures, kept so Settings → Problems can show why a source went quiet.
// Mirrors Geckmotes' errlog: the last MAX entries, newest last, persisted in localStorage.
import { isUsableTime } from "@/lib/chat/messageTime";
import type { EmoteScope, ThirdPartyProvider } from "./types";

const KEY = "zoochattr.problems";
const MAX = 20;
/** The same failure again within this time isn't listed twice (just over the hourly emote refresh). */
const REPEAT_GAP_MS = 65 * 60_000;

export interface EmoteProblem {
  /** Stable id for React keys. */
  id: string;
  at: number;
  provider: ThirdPartyProvider;
  scope: EmoteScope;
  /** Channel login when the failure was for a channel set. */
  channel?: string;
  message: string;
}

type Listener = () => void;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(store: Storage): EmoteProblem[] {
  try {
    const parsed = JSON.parse(store.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const out: EmoteProblem[] = [];
    for (const e of parsed) {
      if (!e || typeof e !== "object" || typeof e.provider !== "string" || typeof e.message !== "string") continue;
      const at = Number(e.at);
      out.push({
        id: typeof e.id === "string" ? e.id : `${e.at}-${e.provider}`,
        // Settings formats this, and a date past the range throws.
        at: isUsableTime(at) ? at : 0,
        provider: e.provider as ThirdPartyProvider,
        scope: e.scope === "channel" ? "channel" : "global",
        channel: typeof e.channel === "string" ? e.channel : undefined,
        message: String(e.message),
      });
    }
    return out.slice(-MAX);
  } catch {
    return [];
  }
}

class ProblemLog {
  private entries: EmoteProblem[] = [];
  private listeners = new Set<Listener>();
  private booted = false;

  private ensure(): void {
    if (this.booted) return;
    this.booted = true;
    const store = storage();
    if (store) this.entries = read(store);
  }

  list(): EmoteProblem[] {
    this.ensure();
    return this.entries.slice();
  }

  get size(): number {
    this.ensure();
    return this.entries.length;
  }

  record(provider: ThirdPartyProvider, scope: EmoteScope, message: string, channel?: string): void {
    this.ensure();
    // The hourly emote refresh would log the same outage again and again and push older entries out:
    // a repeat within REPEAT_GAP_MS only moves the existing entry's time forward.
    const now = Date.now();
    const repeat = this.entries.findIndex(
      (e) =>
        now - e.at < REPEAT_GAP_MS && e.provider === provider && e.scope === scope && e.channel === channel && e.message === message,
    );
    if (repeat >= 0) {
      this.entries = this.entries.map((e, i) => (i === repeat ? { ...e, at: now } : e));
    } else {
      const entry: EmoteProblem = {
        id: `${now}-${provider}-${scope}-${channel ?? ""}-${Math.random().toString(36).slice(2, 7)}`,
        at: now,
        provider,
        scope,
        channel,
        message,
      };
      this.entries = [...this.entries, entry].slice(-MAX);
    }
    const store = storage();
    if (store) {
      try {
        store.setItem(KEY, JSON.stringify(this.entries));
      } catch {
        // Quota / private mode: keep the in-memory list for this session.
      }
    }
    for (const listener of this.listeners) listener();
  }

  clear(): void {
    this.ensure();
    this.entries = [];
    const store = storage();
    if (store) {
      try {
        store.removeItem(KEY);
      } catch {
        // nothing more to do
      }
    }
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const problemLog = new ProblemLog();

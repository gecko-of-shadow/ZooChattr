import { sentTime } from "@/lib/chat/messageTime";
import { channelFromParam, type IrcMessage } from "@/lib/irc/parser";
import type { Badge, ChatMessage, RoomState, TwitchEmoteRange, UserState } from "./types";

let localCounter = 0;
export function localId(prefix = "local"): string {
  localCounter = (localCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${localCounter.toString(36)}`;
}

/** `25:0-4,12-16/1902:6-10` */
export function parseEmotesTag(tag: string | undefined): TwitchEmoteRange[] {
  if (!tag) return [];
  const ranges: TwitchEmoteRange[] = [];
  for (const group of tag.split("/")) {
    const colon = group.indexOf(":");
    if (colon <= 0) continue;
    const id = group.slice(0, colon);
    for (const span of group.slice(colon + 1).split(",")) {
      const [startText, endText] = span.split("-");
      const start = Number(startText);
      const end = Number(endText);
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start) ranges.push({ id, start, end });
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

export function parseBadges(badgesTag: string | undefined, infoTag?: string): Badge[] {
  if (!badgesTag) return [];
  const info = new Map<string, string>();
  for (const part of (infoTag ?? "").split(",")) {
    const slash = part.indexOf("/");
    if (slash > 0) info.set(part.slice(0, slash), part.slice(slash + 1));
  }
  const badges: Badge[] = [];
  for (const part of badgesTag.split(",")) {
    const slash = part.indexOf("/");
    if (slash <= 0) continue;
    const setId = part.slice(0, slash);
    badges.push({ setId, version: part.slice(slash + 1), info: info.get(setId) });
  }
  return badges;
}

const ACTION_PREFIX = "\u0001ACTION ";

function splitAction(text: string): { text: string; action: boolean } {
  if (text.startsWith(ACTION_PREFIX)) {
    const body = text.slice(ACTION_PREFIX.length);
    return { text: body.endsWith("\u0001") ? body.slice(0, -1) : body, action: true };
  }
  return { text, action: false };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let mentionLogin = "";
let mentionPattern: RegExp | null = null;

export function mentionsUser(text: string, login: string | undefined): boolean {
  if (!login) return false;
  if (login !== mentionLogin || !mentionPattern) {
    mentionLogin = login;
    mentionPattern = new RegExp(`(^|[^\\w])@?${escapeRegExp(login)}(?![\\w])`, "i");
  }
  return mentionPattern.test(text);
}

const highlightPatterns = new WeakMap<readonly string[], RegExp>();

/**
 * Name matches are already on the message. A reply to you, or a highlight word when that
 * list is passed, counts the same way. Own messages never do. Pass null when highlight
 * words are switched off for this channel.
 */
export function flagMentions(
  message: ChatMessage,
  selfLogin: string | undefined,
  highlightWords: readonly string[] | null,
): ChatMessage {
  if (message.self || message.mention) return message;
  const reply = message.reply?.login;
  if (selfLogin && reply && reply.toLowerCase() === selfLogin.toLowerCase()) {
    return { ...message, mention: true };
  }
  if (highlightWords && matchesHighlight(message.text, highlightWords)) {
    return { ...message, mention: true };
  }
  return message;
}

/** True when any of the user's extra highlight words appears as a whole word (case-insensitive). */
export function matchesHighlight(text: string, words: readonly string[]): boolean {
  if (!words.length) return false;
  // One combined pattern per word list (the list object only changes when the setting does).
  let pattern = highlightPatterns.get(words);
  if (!pattern) {
    pattern = new RegExp(`(^|[^\\w])@?(?:${words.map(escapeRegExp).join("|")})(?![\\w])`, "i");
    highlightPatterns.set(words, pattern);
  }
  return pattern.test(text);
}

export function privmsgToChat(message: IrcMessage, selfLogin?: string): ChatMessage {
  const tags = message.tags;
  const login = (message.nick ?? tags.login ?? "").toLowerCase();
  const raw = message.params[1] ?? "";
  const { text, action } = splitAction(raw);
  const self = !!selfLogin && login === selfLogin;
  const replyLogin = tags["reply-parent-user-login"];

  return {
    id: tags.id || localId("msg"),
    channel: channelFromParam(message.params[0]),
    kind: action ? "action" : "chat",
    ts: sentTime(tags["tmi-sent-ts"]),
    login,
    userId: tags["user-id"],
    displayName: tags["display-name"] || login,
    color: tags.color || undefined,
    badges: parseBadges(tags.badges, tags["badge-info"]),
    text,
    twitchEmotes: parseEmotesTag(tags.emotes),
    firstMsg: tags["first-msg"] === "1",
    highlighted: tags["msg-id"] === "highlighted-message",
    reply: replyLogin
      ? {
          login: replyLogin,
          displayName: tags["reply-parent-display-name"] || replyLogin,
          text: tags["reply-parent-msg-body"] ?? "",
        }
      : undefined,
    self,
    mention: !self && mentionsUser(text, selfLogin),
  };
}

/** Subs, resubs, raids, gift subs, announcements. */
export function usernoticeToChat(message: IrcMessage, selfLogin?: string): ChatMessage {
  const tags = message.tags;
  const login = (tags.login ?? "").toLowerCase();
  const text = message.params[1] ?? "";
  const self = !!selfLogin && login === selfLogin;
  return {
    id: tags.id || localId("event"),
    channel: channelFromParam(message.params[0]),
    kind: "event",
    ts: sentTime(tags["tmi-sent-ts"]),
    login,
    userId: tags["user-id"],
    displayName: tags["display-name"] || login,
    color: tags.color || undefined,
    badges: parseBadges(tags.badges, tags["badge-info"]),
    text,
    twitchEmotes: parseEmotesTag(tags.emotes),
    systemText: tags["system-msg"] || describeUsernotice(tags["msg-id"]),
    self,
    mention: !self && mentionsUser(text, selfLogin),
  };
}

function describeUsernotice(msgId: string | undefined): string {
  switch (msgId) {
    case "raid":
      return "A raid is arriving!";
    case "sub":
    case "resub":
      return "New subscription";
    case "subgift":
    case "submysterygift":
      return "Gift subs dropped";
    case "announcement":
      return "Announcement";
    default:
      return "Channel event";
  }
}

export function systemMessage(
  channel: string,
  text: string,
  tone: ChatMessage["tone"] = "info",
): ChatMessage {
  return {
    id: localId("sys"),
    channel,
    kind: "system",
    ts: Date.now(),
    badges: [],
    text,
    twitchEmotes: [],
    tone,
  };
}

export function noticeToChat(message: IrcMessage): ChatMessage | null {
  const channel = channelFromParam(message.params[0]);
  const text = message.params[1];
  if (!channel || channel === "*" || !text) return null;
  const msgId = message.tags["msg-id"] ?? "";
  const tone: ChatMessage["tone"] = /^(msg_|bad_|no_permission|unrecognized_cmd)/.test(msgId) ? "warn" : "info";
  return { ...systemMessage(channel, text, tone), kind: "notice" };
}

export function parseRoomState(message: IrcMessage): RoomState {
  const tags = message.tags;
  const state: RoomState = {};
  if ("room-id" in tags) state.roomId = tags["room-id"];
  if ("emote-only" in tags) state.emoteOnly = tags["emote-only"] === "1";
  if ("followers-only" in tags) state.followersOnly = Number(tags["followers-only"]);
  if ("slow" in tags) state.slow = Number(tags.slow);
  if ("subs-only" in tags) state.subsOnly = tags["subs-only"] === "1";
  if ("r9k" in tags) state.r9k = tags.r9k === "1";
  return state;
}

export function parseUserState(message: IrcMessage): UserState {
  const tags = message.tags;
  const badges = parseBadges(tags.badges, tags["badge-info"]);
  return {
    displayName: tags["display-name"] || undefined,
    color: tags.color || undefined,
    badges,
    mod: tags.mod === "1" || badges.some((b) => b.setId === "broadcaster" || b.setId === "moderator"),
  };
}

/**
 * twitch.tv path segments that look like logins but aren't channels
 * (a pasted video, directory, settings, … address).
 */
const NOT_CHANNELS =
  /^(videos|directory|popout|moderator|settings|downloads|jobs|turbo|store|search|drops|inventory|wallet|subscriptions|friends|messages|bits|prime|clips?|embed|p|u)$/;

/** Accepts `xqc`, `#xqc`, `@xqc`, `twitch.tv/xqc`, or a full channel / popout / mod-view URL. */
export function normalizeChannelName(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  // clips.twitch.tv/<slug> is a clip, not a channel. The slug must not be joined.
  if (/clips\.twitch\.tv\//i.test(value)) return null;
  const urlMatch = value.match(/twitch\.tv\/(?:popout\/|moderator\/)?([A-Za-z0-9_]+)/i);
  if (urlMatch) value = urlMatch[1];
  value = value.replace(/^[#@]/, "").toLowerCase();
  if (NOT_CHANNELS.test(value)) return null;
  return /^[a-z0-9_]{2,25}$/.test(value) ? value : null;
}

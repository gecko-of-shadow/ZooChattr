import { describe, expect, it } from "vitest";
import { parseIrcLine } from "@/lib/irc/parser";
import type { ChatMessage } from "./types";
import {
  matchesHighlight,
  flagMentions,
  mentionsUser,
  normalizeChannelName,
  parseBadges,
  parseEmotesTag,
  parseRoomState,
  privmsgToChat,
  usernoticeToChat,
} from "./messages";

describe("parseEmotesTag", () => {
  it("expands multiple ranges and sorts them", () => {
    expect(parseEmotesTag("25:12-16,0-4/1902:6-10")).toEqual([
      { id: "25", start: 0, end: 4 },
      { id: "1902", start: 6, end: 10 },
      { id: "25", start: 12, end: 16 },
    ]);
  });

  it("ignores empty or broken tags", () => {
    expect(parseEmotesTag("")).toEqual([]);
    expect(parseEmotesTag(undefined)).toEqual([]);
    expect(parseEmotesTag("25:x-y")).toEqual([]);
  });
});

describe("parseBadges", () => {
  it("attaches badge-info (sub months)", () => {
    expect(parseBadges("subscriber/12,moderator/1", "subscriber/14")).toEqual([
      { setId: "subscriber", version: "12", info: "14" },
      { setId: "moderator", version: "1", info: undefined },
    ]);
  });
});

describe("privmsgToChat", () => {
  const line = (text: string, tags = "") =>
    parseIrcLine(
      `@badges=;color=;display-name=Lizard;id=m1;tmi-sent-ts=1700000000000;user-id=7${tags} :lizard!lizard@lizard.tmi.twitch.tv PRIVMSG #gecko :${text}`,
    )!;

  it("maps a normal message", () => {
    const msg = privmsgToChat(line("hi chat"), "me");
    expect(msg).toMatchObject({ id: "m1", channel: "gecko", kind: "chat", login: "lizard", text: "hi chat" });
    expect(msg.mention).toBe(false);
    expect(msg.ts).toBe(1700000000000);
  });

  it("detects /me actions", () => {
    const msg = privmsgToChat(line("\u0001ACTION waves\u0001"));
    expect(msg.kind).toBe("action");
    expect(msg.text).toBe("waves");
  });

  it("flags mentions of the logged-in user, but not our own messages", () => {
    expect(privmsgToChat(line("hey @Me how are you"), "me").mention).toBe(true);
    expect(privmsgToChat(line("hey me"), "me").mention).toBe(true);
    expect(privmsgToChat(line("meme time"), "me").mention).toBe(false);
    expect(privmsgToChat(line("talking to myself"), "lizard").self).toBe(true);
  });

  it("captures reply context and first messages", () => {
    const msg = privmsgToChat(
      line(
        "@bob agreed",
        ";first-msg=1;reply-parent-display-name=Bob;reply-parent-msg-body=geckos\\srule;reply-parent-user-login=bob",
      ),
    );
    expect(msg.firstMsg).toBe(true);
    expect(msg.reply).toEqual({ login: "bob", displayName: "Bob", text: "geckos rule" });
  });
});

describe("usernoticeToChat", () => {
  it("uses Twitch's system-msg", () => {
    const msg = usernoticeToChat(
      parseIrcLine(
        "@display-name=Raider;login=raider;msg-id=raid;system-msg=15\\sraiders\\sfrom\\sRaider\\shave\\sjoined!;id=u1 :tmi.twitch.tv USERNOTICE #gecko",
      )!,
    );
    expect(msg.kind).toBe("event");
    expect(msg.systemText).toBe("15 raiders from Raider have joined!");
    expect(msg.text).toBe("");
  });

  it("does not mark your own announcement as a mention", () => {
    const msg = usernoticeToChat(
      parseIrcLine(
        "@display-name=Me;login=me;msg-id=announcement;id=u2 :me!me@me.tmi.twitch.tv USERNOTICE #gecko :hello me",
      )!,
      "me",
    );
    expect(msg.self).toBe(true);
    expect(msg.mention).toBe(false);
  });
});

describe("parseRoomState", () => {
  it("only reports keys that are present", () => {
    const state = parseRoomState(parseIrcLine("@room-id=1;slow=30 :tmi.twitch.tv ROOMSTATE #gecko")!);
    expect(state).toEqual({ roomId: "1", slow: 30 });
  });
});

describe("normalizeChannelName", () => {
  it.each([
    ["xqc", "xqc"],
    ["#XQC", "xqc"],
    ["@Some_Body", "some_body"],
    ["https://www.twitch.tv/summit1g", "summit1g"],
    ["twitch.tv/popout/kato_junichi0817/chat", "kato_junichi0817"],
    ["https://www.twitch.tv/moderator/xqc", "xqc"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeChannelName(input)).toBe(expected);
  });

  it("rejects invalid names and non-channel twitch.tv pages", () => {
    expect(normalizeChannelName("")).toBeNull();
    expect(normalizeChannelName("has space")).toBeNull();
    expect(normalizeChannelName("x".repeat(26))).toBeNull();
    // Pasted video / directory / settings addresses used to be taken as the channel "videos", etc.
    expect(normalizeChannelName("https://www.twitch.tv/videos/1234567890")).toBeNull();
    expect(normalizeChannelName("twitch.tv/directory/game/Just%20Chatting")).toBeNull();
    expect(normalizeChannelName("https://www.twitch.tv/settings")).toBeNull();
    expect(normalizeChannelName("videos")).toBeNull();
    expect(normalizeChannelName("https://clips.twitch.tv/KindlySplendidClip")).toBeNull();
  });
});

describe("mentionsUser", () => {
  it("escapes regex characters in logins", () => {
    expect(mentionsUser("hello a_b", "a_b")).toBe(true);
    expect(mentionsUser("anything", undefined)).toBe(false);
  });
});

describe("flagMentions", () => {
  const base = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: "1",
    channel: "gecko",
    kind: "chat",
    ts: 1,
    badges: [],
    text: "hello",
    twitchEmotes: [],
    ...over,
  });

  it("counts a reply to you, and highlight words when that list is on", () => {
    expect(flagMentions(base({ reply: { login: "Me", displayName: "Me", text: "yo" } }), "me", null).mention).toBe(true);
    expect(flagMentions(base({ text: "big GIVEAWAY" }), "me", ["giveaway"]).mention).toBe(true);
  });

  it("leaves other replies, own messages, and switched-off highlight words alone", () => {
    expect(flagMentions(base({ reply: { login: "bob", displayName: "Bob", text: "yo" } }), "me", null).mention).toBeUndefined();
    expect(flagMentions(base({ self: true, reply: { login: "me", displayName: "Me", text: "yo" } }), "me", ["hello"]).mention).toBeUndefined();
    expect(flagMentions(base({ text: "giveaway" }), "me", null).mention).toBeUndefined();
    expect(flagMentions(base({ mention: true }), "me", null).mention).toBe(true);
  });
});

describe("matchesHighlight", () => {
  it("matches whole words from the list, ignoring case", () => {
    expect(matchesHighlight("big GIVEAWAY tonight", ["giveaway"])).toBe(true);
    expect(matchesHighlight("giveaways are rigged", ["giveaway"])).toBe(false);
    expect(matchesHighlight("c++ rocks", ["c++"])).toBe(true);
    expect(matchesHighlight("nothing here", [])).toBe(false);
  });
});

describe("message times from Twitch", () => {
  const privmsg = (ts: string) => parseIrcLine(`@id=m1;tmi-sent-ts=${ts} :lizard!lizard@lizard.tmi.twitch.tv PRIVMSG #gecko :hi`)!;
  const usernotice = (ts: string) => parseIrcLine(`@id=u1;login=raider;msg-id=raid;tmi-sent-ts=${ts} :tmi.twitch.tv USERNOTICE #gecko`)!;

  it("keeps a normal time", () => {
    expect(privmsgToChat(privmsg("1700000000000")).ts).toBe(1_700_000_000_000);
    expect(usernoticeToChat(usernotice("1700000000000")).ts).toBe(1_700_000_000_000);
  });

  it.each(["999999999999999999", "8640000000000001", "1e400", "-1", "not a time"])("uses the current time for %s", (ts) => {
    const before = Date.now();
    for (const message of [privmsgToChat(privmsg(ts)), usernoticeToChat(usernotice(ts))]) {
      expect(message.ts).toBeGreaterThanOrEqual(before);
      expect(message.ts).toBeLessThanOrEqual(Date.now());
    }
  });
});

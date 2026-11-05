import { describe, expect, it } from "vitest";
import { findMisspellings, indexAtWidth, isUrlOrDomain, rankSuggestions, replaceSpellWord, spellMenuIsCurrent, spellSuggestions, type SpellContext } from "./misspellings";

const KNOWN = new Set(["i", "the", "message", "receive", "uptime", "hello", "now", "someone"]);

function ctx(overrides: Partial<SpellContext> = {}): SpellContext {
  return {
    isEmote: (word) => ["kappa", "pogchamp", "kekw"].includes(word.toLowerCase()),
    chatters: new Set(["someuser"]),
    dictionary: new Set(),
    ignored: new Set(),
    correct: (word) => KNOWN.has(word.toLowerCase()),
    ...overrides,
  };
}

describe("findMisspellings", () => {
  it("flags recieve and teh and leaves real words alone", () => {
    const spans = findMisspellings("I recieve teh message", ctx());
    expect(spans.map((span) => span.word)).toEqual(["recieve", "teh"]);
    expect(spans[1]).toMatchObject({ word: "teh" });
    const teh = spans[1];
    expect("I recieve teh message".slice(teh.start, teh.end)).toBe("teh");
  });

  it("does not flag emotes, mentions, a leading command, urls, short caps, or digits", () => {
    const text = "Kappa PogChamp @someuser !uptime https://twitch.tv KEKW";
    expect(findMisspellings(text, ctx())).toEqual([]);
    expect(findMisspellings("!uptime now", ctx())).toEqual([]);
    expect(findMisspellings("/ban someone", ctx())).toEqual([]);
    expect(findMisspellings("hello w0rld", ctx()).map((span) => span.word)).toEqual([]);
    expect(findMisspellings("OK LOL", ctx())).toEqual([]);
    expect(findMisspellings("a", ctx())).toEqual([]);
  });

  it("skips known chatters and the user dictionary", () => {
    expect(findMisspellings("someuser recieve", ctx()).map((span) => span.word)).toEqual(["recieve"]);
    expect(
      findMisspellings("recieve", ctx({ dictionary: new Set(["recieve"]) })),
    ).toEqual([]);
    expect(findMisspellings("teh", ctx({ ignored: new Set(["teh"]) }))).toEqual([]);
  });

  it("skips slash and bang commands even when they are not the first token", () => {
    expect(findMisspellings("hello !notaword /ban", ctx())).toEqual([]);
  });
});

describe("spellSuggestions", () => {
  it("returns the for teh and caps the list at 5", () => {
    expect(spellSuggestions("teh", () => ["the", "ten", "the"])[0]).toBe("the");
    expect(spellSuggestions("x", () => ["a", "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(rankSuggestions("teh", ["ten", "eh", "meh", "tea", "tech", "ted", "tee", "tel", "the"])[0]).toBe("the");
  });
});

describe("replaceSpellWord", () => {
  it("replaces only that word and parks the caret after it", () => {
    const text = "I recieve teh message";
    const spans = findMisspellings(text, ctx());
    const next = replaceSpellWord(text, spans[1], "the");
    expect(next).toEqual({ text: "I recieve the message", caret: "I recieve the".length });
  });
});

describe("indexAtWidth", () => {
  it("picks the glyph closest to the click", () => {
    const widthAt = (end: number) => end * 10;
    expect(indexAtWidth("abcd", 0, widthAt)).toBe(0);
    expect(indexAtWidth("abcd", 25, widthAt)).toBe(2);
    expect(indexAtWidth("abcd", 26, widthAt)).toBe(3);
    expect(indexAtWidth("abcd", 100, widthAt)).toBe(4);
  });
});

describe("isUrlOrDomain", () => {
  it("recognises links and bare domains", () => {
    expect(isUrlOrDomain("https://twitch.tv")).toBe(true);
    expect(isUrlOrDomain("twitch.tv")).toBe(true);
    expect(isUrlOrDomain("hello")).toBe(false);
  });
});

describe("spellMenuIsCurrent", () => {
  const target = { channel: "alpha", text: "I recieve teh", span: { start: 2, end: 9, word: "recieve" } };

  it("is true for the draft the menu was opened on", () => {
    expect(spellMenuIsCurrent(target, "alpha", "I recieve teh")).toBe(true);
  });

  it("is false in another channel, even with the same text", () => {
    expect(spellMenuIsCurrent(target, "bravo", "I recieve teh")).toBe(false);
    expect(spellMenuIsCurrent(target, null, "I recieve teh")).toBe(false);
  });

  it("is false once the text has changed", () => {
    expect(spellMenuIsCurrent(target, "alpha", "good morning friends")).toBe(false);
    expect(spellMenuIsCurrent(target, "alpha", "")).toBe(false);
    expect(spellMenuIsCurrent(target, "alpha", "I recieve teh!")).toBe(false);
  });

  it("is false when the saved position doesn't hold the saved word", () => {
    expect(spellMenuIsCurrent({ ...target, span: { start: 3, end: 10, word: "recieve" } }, "alpha", target.text)).toBe(false);
  });
});

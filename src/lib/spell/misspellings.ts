/** A word the spell checker wants underlined. Indexes are into the original text. */
export interface SpellSpan {
  start: number;
  end: number;
  word: string;
}

export interface SpellContext {
  /** True when this token is an emote name on the channel (any provider). */
  isEmote: (word: string) => boolean;
  /** Logins and display names that have spoken, compared case-insensitively. */
  chatters: ReadonlySet<string>;
  /** User dictionary, compared case-insensitively. */
  dictionary: ReadonlySet<string>;
  /** Ignored for this session, compared case-insensitively. */
  ignored: ReadonlySet<string>;
  /** Hunspell-style correct() — true when the word is in the language dictionary. */
  correct: (word: string) => boolean;
}

const TOKEN = /\S+/g;
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)*$/;

function has(set: ReadonlySet<string>, word: string): boolean {
  return set.has(word.toLowerCase());
}

/** URLs and bare domains (twitch.tv, https://example.com/a). */
export function isUrlOrDomain(token: string): boolean {
  const bare = token.replace(/[),.;!?]+$/g, "");
  if (/^https?:\/\//i.test(bare)) return true;
  if (/^www\./i.test(bare)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(bare);
}

/**
 * Words that should be underlined. Never flags emotes, mentions, chatters,
 * a leading ! or / command, URLs, words with digits, short ALL-CAPS, single
 * letters, or the user/session dictionaries.
 */
export function findMisspellings(text: string, ctx: SpellContext): SpellSpan[] {
  const spans: SpellSpan[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0];
    const at = match.index ?? 0;
    // Chat commands (!uptime, /ban) are not words, including when they are the first token.
    if (/^[!/]/.test(raw) || raw.startsWith("@")) continue;

    const trimmed = raw.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
    if (!trimmed) continue;
    const local = at + raw.indexOf(trimmed);
    if (isUrlOrDomain(raw) || isUrlOrDomain(trimmed)) continue;
    if (/\d/.test(raw)) continue;
    if (ctx.isEmote(trimmed) || ctx.isEmote(raw)) continue;
    if (has(ctx.chatters, trimmed) || has(ctx.dictionary, trimmed) || has(ctx.ignored, trimmed)) continue;
    if (trimmed.length === 1) continue;
    if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) continue;
    if (!WORD.test(trimmed)) continue;
    if (ctx.correct(trimmed)) continue;
    spans.push({ start: local, end: local + trimmed.length, word: trimmed });
  }
  return spans;
}

/** Everyday words. Hunspell ranks "ten" ahead of "the" for "teh"; these win that tie. */
const COMMON_WORDS = new Set(
  "the be to of and a in that have i it for not on with he as you do at this but his by from they we her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take into your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us message hello".split(
    " ",
  ),
);

/**
 * At most `limit` suggestions. Common words and a shared first letter outrank the raw hunspell order,
 * so "teh" offers "the" before "ten".
 */
export function rankSuggestions(word: string, raw: readonly string[], limit = 5): string[] {
  const lower = word.toLowerCase();
  const ranked = raw.map((item, index) => {
    const key = item.toLowerCase();
    let score = index;
    if (COMMON_WORDS.has(key)) score -= 30;
    if (key[0] === lower[0]) score -= 2;
    score += Math.abs(key.length - lower.length) * 2;
    return { item, score };
  });
  ranked.sort((a, b) => a.score - b.score || a.item.localeCompare(b.item));
  return spellSuggestions(word, () => ranked.map((entry) => entry.item), limit);
}

/** At most `limit` unique suggestions, in the checker's order. */
export function spellSuggestions(word: string, suggest: (word: string) => readonly string[], limit = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of suggest(word)) {
    const clean = item.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Character index whose glyph sits under an x offset measured in the same units as `widthAt`.
 * `widthAt(i)` is the width of `text.slice(0, i)`.
 */
export function indexAtWidth(text: string, x: number, widthAt: (end: number) => number): number {
  if (x <= 0) return 0;
  let previous = 0;
  for (let i = 1; i <= text.length; i++) {
    const width = widthAt(i);
    if (width >= x) return width - x < x - previous ? i : i - 1;
    previous = width;
  }
  return text.length;
}

/** Replace one flagged span and put the caret just after the new word. */
/** The draft a spell menu was opened on. */
export interface SpellMenuTarget {
  channel: string;
  text: string;
  span: SpellSpan;
}

/** A fix may only touch the exact draft its menu was opened on, in the channel it was opened in. */
export function spellMenuIsCurrent(target: SpellMenuTarget, channel: string | null, text: string): boolean {
  return target.channel === channel && target.text === text && text.slice(target.span.start, target.span.end) === target.span.word;
}

export function replaceSpellWord(text: string, span: Pick<SpellSpan, "start" | "end">, next: string): { text: string; caret: number } {
  return {
    text: `${text.slice(0, span.start)}${next}${text.slice(span.end)}`,
    caret: span.start + next.length,
  };
}

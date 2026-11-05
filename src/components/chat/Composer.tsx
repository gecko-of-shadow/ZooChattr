import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, Clock, CornerDownRight, Lock, SendHorizontal, Smile, Users, X } from "lucide-react";
import { Mascot } from "@/components/mascots/Mascot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completionInsert, tabMatches, type TabMatch } from "@/lib/chat/activeUsers";
import { reduceComposerKey } from "@/lib/chat/composerKeys";
import { chat } from "@/lib/chat/controller";
import { findEmotes, wordAt } from "@/lib/emotes/search";
import { loadSpellEngine, type SpellLanguageId } from "@/lib/spell/engine";
import {
  findMisspellings,
  indexAtWidth,
  rankSuggestions,
  replaceSpellWord,
  spellMenuIsCurrent,
  type SpellMenuTarget,
  type SpellSpan,
} from "@/lib/spell/misspellings";
import { ignoreSpellWord, ignoredSpellWords, subscribeSpellIgnore } from "@/lib/spell/session";
import { emoteKey, emoteUrls, type Emote } from "@/lib/emotes/types";
import { useTheme } from "@/lib/useTheme";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat";
import { isFeatureOn } from "@/store/settings";
import { ackSendChannel, clearReplyTarget, useUi } from "@/store/ui";
import { EmotePicker, rememberEmoteUse } from "./EmotePicker";
import { SpellMenu, SpellMirror } from "./SpellOverlay";
import { useEmoteIndex } from "./useEmoteIndex";

function srcSet(urls: { url1x: string; url2x?: string; url4x?: string }): string | undefined {
  const parts = [`${urls.url1x} 1x`];
  if (urls.url2x) parts.push(`${urls.url2x} 2x`);
  if (urls.url4x) parts.push(`${urls.url4x} 4x`);
  return parts.length > 1 ? parts.join(", ") : undefined;
}

function CompletionEmoteThumb({ emote, still }: { emote: Emote; still: boolean }) {
  const [failed, setFailed] = useState(false);
  const urls = emoteUrls(emote, still);
  if (failed) {
    return <span className="text-[10px] font-medium text-muted-foreground">?</span>;
  }
  return (
    <img
      src={urls.url1x}
      srcSet={srcSet(urls)}
      alt=""
      loading="eager"
      decoding="async"
      draggable={false}
      className="max-h-7 max-w-9 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function RoomChips({ channel }: { channel: string }) {
  const room = useChat((s) => s.channels[channel]?.roomState);
  if (!room) return null;
  const chips: { icon: typeof Clock; label: string }[] = [];
  if (room.emoteOnly) chips.push({ icon: Smile, label: "Emote-only" });
  if (room.subsOnly) chips.push({ icon: Lock, label: "Subscribers only" });
  if (room.followersOnly !== undefined && room.followersOnly >= 0) {
    chips.push({ icon: Users, label: room.followersOnly === 0 ? "Followers only" : `Followers (${room.followersOnly}m+)` });
  }
  if (room.slow) chips.push({ icon: Clock, label: `Slow mode ${room.slow}s` });
  if (!chips.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          <Icon className="size-3" />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Shown instead of message boxes while reading anonymously. */
export function LoginPrompt() {
  const booting = useChat((s) => s.auth.status === "booting");
  return (
    <div className="min-w-0 flex-1" data-testid="login-prompt">
      <div className="flex w-full flex-wrap items-center gap-3 px-1">
        <Mascot className="size-7 shrink-0" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          You're reading anonymously. Log in with Twitch to chat back.
        </p>
        <Button size="sm" className="h-8" onClick={() => useUi.setState({ loginOpen: true })} disabled={booting}>
          Log in with Twitch
        </Button>
      </div>
    </div>
  );
}

/** A Tab-completion in progress: which word is being finished and which match is in the box right now. */
interface SpellMenuState extends SpellMenuTarget {
  x: number;
  y: number;
  suggestions: string[];
}

interface Completion {
  matches: TabMatch[];
  index: number;
  /** Where the typed word started. */
  start: number;
  /** Where the inserted name (plus its trailing space) ends. */
  end: number;
}

function matchKey(match: TabMatch): string {
  return match.kind === "emote" ? emoteKey(match.emote) : `user:${match.login}`;
}

function matchLabel(match: TabMatch): string {
  if (match.kind === "emote") return match.emote.name;
  if (match.displayName.toLowerCase() === match.login) return `@${match.login}`;
  return `@${match.login} (${match.displayName})`;
}

const MIN_TYPED = 2;

function CompletionBar({
  id,
  completion,
  onChoose,
  compact,
  anchorRef,
}: {
  id: string;
  completion: Completion;
  onChoose: (index: number) => void;
  compact: boolean;
  /** Position the list above this input (portaled so grid overflow can't clip it). */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const still = useChat((s) => s.settings.emoteAnimation === "never");
  const activeRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ left: number; width: number; bottom: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const place = () => {
      const rect = el.getBoundingClientRect();
      setBox({
        left: rect.left,
        width: rect.width,
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, completion.matches.length, completion.index]);

  useEffect(() => {
    const active = activeRef.current;
    const list = active?.parentElement;
    if (!active || !list) return;
    // Scroll only this list. scrollIntoView also scrolls the page and blurs the message box.
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [completion.index]);

  if (!box || typeof document === "undefined") return null;

  return createPortal(
    <div
      id={id}
      data-testid="tab-complete"
      role="listbox"
      aria-label="Suggestions"
      className="zoo-scroll fixed z-50 flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain border border-border bg-popover p-1"
      style={{ left: box.left, width: box.width, bottom: box.bottom }}
    >
      {completion.matches.map((match, i) => {
        const active = i === completion.index;
        return (
          <button
            key={matchKey(match)}
            id={`${id}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(i)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left",
              compact ? "text-[11px]" : "text-xs",
              active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center">
              {match.kind === "emote" ? (
                <CompletionEmoteThumb emote={match.emote} still={still} />
              ) : (
                <span className="text-sm font-semibold">@</span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{matchLabel(match)}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Drafts and sent-message history per channel, kept outside the (single, shared) message box so hiding it
 * (Read only, an empty grid) loses nothing.
 */
const sharedDrafts = new Map<string, string>();
const sharedHistories = new Map<string, string[]>();

/** Message input for one channel. `compact` is the slim version used inside grid boxes. */
export function Composer({ channel, compact = false }: { channel: string | null; compact?: boolean }) {
  const auth = useChat((s) => s.auth);
  const writeStatus = useChat((s) => s.write?.status);
  const theme = useTheme();
  const tabComplete = useChat((s) => isFeatureOn(s.settings, channel, "tabComplete"));
  const emotePicker = useChat((s) => isFeatureOn(s.settings, channel, "emotePicker"));
  const confirmSwitch = useChat((s) => s.settings.confirmChannelSwitch);
  const insert = useUi((s) => s.insert);
  const sendAckChannel = useUi((s) => s.sendAckChannel);
  const replyTo = useUi((s) => (channel && s.replyTo?.channel === channel ? s.replyTo : null));
  const { emotes, index } = useEmoteIndex(channel);
  const spellCheck = useChat((s) => s.settings.spellCheck);
  const spellDictionary = useChat((s) => s.settings.spellDictionary);
  const spellLanguage = useChat((s) => s.settings.spellLanguage);
  const textSize = useChat((s) => s.settings.textSize);
  const [text, setText] = useState(() => (channel ? (sharedDrafts.get(channel) ?? "") : ""));
  const [error, setError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [misspellings, setMisspellings] = useState<SpellSpan[]>([]);
  const [spellMenu, setSpellMenu] = useState<SpellMenuState | null>(null);
  const [ignoreVersion, setIgnoreVersion] = useState(0);
  const history = useRef<string[]>(channel ? (sharedHistories.get(channel) ?? []).slice() : []);
  const historyIndex = useRef(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const prevChannel = useRef(channel);
  const textRef = useRef("");
  // An insert from before this box mounted (it unmounts in Read only) must not come back.
  const appliedInsert = useRef<number | null>(useUi.getState().insert?.nonce ?? null);
  const drafts = useRef(sharedDrafts);
  const histories = useRef(sharedHistories);
  const listId = useId();
  textRef.current = text;
  const [spellArmed, setSpellArmed] = useState(false);
  const spellLanguageId: SpellLanguageId = spellLanguage === "en-US" ? "en-US" : "en-US";

  useEffect(() => subscribeSpellIgnore(() => setIgnoreVersion((version) => version + 1)), []);

  // A menu belongs to one draft: anything that changes the text, the channel or the login ends it.
  useEffect(() => {
    setSpellMenu(null);
  }, [text, channel, auth.status]);

  const closeSpellMenu = useCallback(() => {
    // With focus on a menu item, closing would drop it on the page and the next keys would go nowhere.
    if (document.activeElement?.closest("[data-testid='spell-menu']")) inputRef.current?.focus();
    setSpellMenu(null);
  }, []);

  // Keep the current channel's draft and history when the box goes away (Read only, empty grid).
  useEffect(
    () => () => {
      const current = prevChannel.current;
      if (!current) return;
      sharedDrafts.set(current, textRef.current);
      sharedHistories.set(current, history.current.slice());
    },
    [],
  );

  useEffect(() => {
    if (!spellCheck || !spellArmed || !channel) {
      setMisspellings([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSpellEngine(spellLanguageId)
        .then((engine) => {
          if (cancelled) return;
          const names = new Set(emotes.map((emote) => emote.name.toLowerCase()));
          const messages = useChat.getState().channels[channel]?.messages ?? [];
          const recent = messages.slice(-120);
          for (const message of recent) {
            if (!message.twitchEmotes?.length) continue;
            const chars = Array.from(message.text);
            for (const range of message.twitchEmotes) {
              if (range.start < 0 || range.end >= chars.length) continue;
              names.add(chars.slice(range.start, range.end + 1).join("").toLowerCase());
            }
          }
          const people = new Set<string>();
          for (const user of chat.activeChatters(channel)) {
            people.add(user.login.toLowerCase());
            people.add(user.displayName.toLowerCase());
          }
          setMisspellings(
            findMisspellings(textRef.current, {
              isEmote: (word) => names.has(word.toLowerCase()),
              chatters: people,
              dictionary: new Set(spellDictionary.map((word) => word.toLowerCase())),
              ignored: ignoredSpellWords(),
              correct: (word) => engine.correct(word),
            }),
          );
        })
        .catch(() => {
          if (!cancelled) setMisspellings([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, spellCheck, spellArmed, spellDictionary, spellLanguageId, emotes, channel, ignoreVersion]);

  useEffect(() => {
    if (!insert || !channel || insert.channel !== channel) return;
    if (appliedInsert.current === insert.nonce) return;
    appliedInsert.current = insert.nonce;
    setText((current) => {
      const spacer = current && !current.endsWith(" ") ? " " : "";
      const next = `${current}${spacer}${insert.text}`;
      pendingCaret.current = next.length;
      return next;
    });
    // Clicking a name chooses this channel, same as confirming the switch.
    ackSendChannel(channel);
    inputRef.current?.focus();
  }, [insert, channel]);

  useEffect(() => {
    if (!replyTo) return;
    inputRef.current?.focus();
  }, [replyTo?.nonce]);

  useEffect(() => {
    const previous = prevChannel.current;
    if (previous !== channel) {
      if (previous) {
        drafts.current.set(previous, textRef.current);
        histories.current.set(previous, history.current.slice());
      }
      prevChannel.current = channel;
      history.current = channel ? (histories.current.get(channel) ?? []).slice() : [];
      historyIndex.current = -1;
      setText(channel ? (drafts.current.get(channel) ?? "") : "");
      // Focused view: switching the single composer to another channel clears ack.
      if (useUi.getState().sendAckChannel !== channel) {
        useUi.setState({ sendAckChannel: null });
      }
    }
    setError(null);
    setCompletion(null);
  }, [channel]);

  // Programmatic edits (Tab, picker) put the caret right after what they inserted.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = inputRef.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.setSelectionRange(caret, caret);
  }, [text]);

  if (!channel) return null;
  if (auth.status !== "logged_in") return compact ? null : <LoginPrompt />;

  const connected = writeStatus === "connected";
  const locked = confirmSwitch && sendAckChannel !== channel;
  const length = Array.from(text).length;

  const submit = () => {
    setSpellMenu(null);
    if (locked || !text.trim()) return;
    const result = chat.send(
      channel,
      text,
      replyTo
        ? { id: replyTo.id, login: replyTo.login, displayName: replyTo.displayName, text: replyTo.text }
        : undefined,
    );
    if (result.ok) {
      history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 50);
      historyIndex.current = -1;
      setText("");
      setError(null);
      setCompletion(null);
      if (replyTo) clearReplyTarget(channel);
    } else if (result.error) {
      setError(result.error);
    }
  };

  const applySpelling = (menu: SpellMenuState, next: string) => {
    setSpellMenu(null);
    if (!spellMenuIsCurrent(menu, channel, text)) return;
    const replaced = replaceSpellWord(text, menu.span, next);
    setText(replaced.text);
    pendingCaret.current = replaced.caret;
    historyIndex.current = -1;
    inputRef.current?.focus();
  };

  const onSpellContextMenu = (event: React.MouseEvent<HTMLInputElement>) => {
    if (!spellCheck) return;
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    const pad = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth);
    const x = event.clientX - rect.left - pad + input.scrollLeft;
    const canvas = document.createElement("canvas").getContext("2d");
    if (!canvas) return;
    canvas.font = style.font;
    const at = indexAtWidth(text, x, (end) => canvas.measureText(text.slice(0, end)).width);
    // Underlines lag the text by a moment. One that no longer sits on its word doesn't count.
    const span = misspellings.find((item) => at >= item.start && at < item.end && text.slice(item.start, item.end) === item.word);
    if (!span) return;
    event.preventDefault();
    const engine = loadSpellEngine(spellLanguageId);
    void engine.then((checker) => {
      // This runs a moment after the right-click. Too late if the draft has moved on.
      if (prevChannel.current !== channel || textRef.current !== text) return;
      setSpellMenu({
        x: event.clientX,
        y: event.clientY,
        channel,
        text,
        span,
        suggestions: rankSuggestions(span.word, checker.suggest(span.word)),
      });
    });
  };

  /** Replaces text[start..end] with the match's name and a space. `close` accepts it and drops the list. */
  const applyMatch = (base: Completion, nextIndex: number, close = false) => {
    const name = completionInsert(base.matches[nextIndex]);
    const after = text.slice(base.end);
    const spacer = after.startsWith(" ") ? "" : " ";
    const inserted = `${name}${spacer}`;
    const next = `${text.slice(0, base.start)}${inserted}${after}`;
    const end = base.start + inserted.length;
    if (next === text) {
      // Same name again (one match, or re-picking the active one): no render, so place the caret now.
      inputRef.current?.setSelectionRange(end, end);
    } else {
      setText(next);
      pendingCaret.current = end;
    }
    if (close) {
      setCompletion(null);
      inputRef.current?.focus();
      const chosen = base.matches[nextIndex];
      if (chosen.kind === "emote") rememberEmoteUse(chosen.emote);
    } else {
      setCompletion({ ...base, index: nextIndex, end });
    }
  };

  const startCompletion = (backwards: boolean): boolean => {
    const caret = inputRef.current?.selectionStart ?? text.length;
    const word = wordAt(text, caret);
    if (!word) return false;
    const emoteHits = word.word.startsWith("@") || word.word.length < MIN_TYPED ? [] : findEmotes(index, word.word);
    const matches = tabMatches(word.word, emoteHits, chat.activeChatters(channel));
    if (!matches.length) return false;
    applyMatch({ matches, index: 0, start: word.start, end: word.end }, backwards ? matches.length - 1 : 0);
    return true;
  };

  const insertEmote = (emote: Emote) => {
    const caret = inputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const trail = after.startsWith(" ") ? "" : " ";
    const head = `${before}${lead}${emote.name}${trail}`;
    setText(`${head}${after}`);
    setCompletion(null);
    // The menu hands focus back to its button when it closes; take it back after that.
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(head.length, head.length);
    }, 0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const decision = reduceComposerKey({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      composing: event.nativeEvent.isComposing,
      tabComplete,
      completion: completion ? { index: completion.index, count: completion.matches.length } : null,
      text,
      history: history.current,
      historyIndex: historyIndex.current,
    });
    switch (decision.kind) {
      case "cycle":
        event.preventDefault();
        if (completion) applyMatch(completion, decision.index);
        return;
      case "start":
        if (startCompletion(decision.backwards)) event.preventDefault();
        return;
      case "accept":
        // The match (and its trailing space) is already in the box. Close the list; the next Enter sends.
        event.preventDefault();
        if (completion) {
          const end = completion.end;
          const chosen = completion.matches[completion.index];
          if (chosen?.kind === "emote") rememberEmoteUse(chosen.emote);
          setCompletion(null);
          const el = inputRef.current;
          el?.focus();
          el?.setSelectionRange(end, end);
        }
        return;
      case "close":
        event.preventDefault();
        event.stopPropagation();
        setCompletion(null);
        return;
      case "dismiss":
        setCompletion(null);
        return;
      case "submit":
        event.preventDefault();
        submit();
        return;
      case "history":
        event.preventDefault();
        historyIndex.current = decision.historyIndex;
        setText(decision.text);
        return;
      case "escape":
        if (replyTo) {
          clearReplyTarget(channel);
          // Esc that cancelled a reply must not also leave the single view.
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
        }
        setError(null);
        return;
      default:
        return;
    }
  };

  return (
    <div className="min-w-0 flex-1" data-testid="composer">
      {/* Middle of the bottom bar: fills the space between the view switch and the gear. */}
      <div className="w-full" data-testid="composer-inner">
      {error ? (
        <div role="alert" className={cn("flex items-start gap-1.5 text-danger-text", compact ? "mb-1 text-[11px]" : "mb-2 text-xs")}>
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {error}
        </div>
      ) : null}
      {locked ? (
        <div
          className={cn("flex flex-col", compact ? "gap-0" : "gap-1.5")}
          data-testid="channel-switch-ack"
        >
          {/* No line of text above the button (the owner's choice): the sentence is its tooltip and spoken description. */}
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            className={cn("h-8 w-full shrink-0", compact && "text-[13px]")}
            data-testid="channel-switch-unlock"
            title="You switched channels. Confirm before sending."
            aria-description="You switched channels. Confirm before sending."
            onClick={() => {
              ackSendChannel(channel);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            chat in #{channel}
          </Button>
        </div>
      ) : (
        <div>
          {replyTo ? (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-muted-foreground",
                compact ? "mb-1 text-[11px]" : "mb-1.5 text-xs",
              )}
              data-testid="reply-banner"
            >
              <CornerDownRight className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Replying to <span className="font-medium text-foreground">@{replyTo.displayName}</span>
                {replyTo.text ? `: ${replyTo.text}` : ""}
              </span>
              <button
                type="button"
                className="rounded-md p-0.5 hover:bg-background hover:text-foreground"
                aria-label="Cancel reply"
                onClick={() => clearReplyTarget(channel)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="relative min-w-0 flex-1">
            {completion && completion.matches.length > 0 ? (
              <CompletionBar
                id={listId}
                completion={completion}
                compact={compact}
                anchorRef={inputRef}
                onChoose={(i) => {
                  applyMatch(completion, i, true);
                }}
              />
            ) : null}
            {spellCheck ? <SpellMirror text={text} spans={misspellings} inputRef={inputRef} /> : null}
            {spellMenu
              ? createPortal(
                  <SpellMenu
                    x={spellMenu.x}
                    y={spellMenu.y}
                    suggestions={spellMenu.suggestions}
                    onPick={(word) => applySpelling(spellMenu, word)}
                    onClose={closeSpellMenu}
                    onAdd={() => {
                      const word = spellMenu.span.word;
                      const exists = spellDictionary.some((entry) => entry.toLowerCase() === word.toLowerCase());
                      if (!exists) chat.updateSettings({ spellDictionary: [...spellDictionary, word] });
                      closeSpellMenu();
                    }}
                    onIgnore={() => {
                      ignoreSpellWord(spellMenu.span.word);
                      closeSpellMenu();
                    }}
                  />,
                  document.body,
                )
              : null}
            <Input
              ref={inputRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                historyIndex.current = -1;
                setCompletion(null);
                setSpellMenu(null);
                if (error) setError(null);
              }}
              onKeyDown={onKeyDown}
              onContextMenu={onSpellContextMenu}
              style={{ fontSize: textSize }}
              onBlur={(event) => {
                const next = event.relatedTarget;
                // Focus going elsewhere (Ctrl+K, Settings) ends the menu, or it would sit there and take their first Esc.
                if (!(next instanceof Element && next.closest("[data-testid='spell-menu']"))) setSpellMenu(null);
                if (next instanceof Element && next.closest("[data-testid='tab-complete']")) return;
                window.setTimeout(() => {
                  const active = document.activeElement;
                  if (active === inputRef.current) return;
                  if (active instanceof Element && active.closest("[data-testid='tab-complete']")) return;
                  setCompletion(null);
                }, 0);
              }}
              onFocus={() => setSpellArmed(true)}
              placeholder={`${theme.sendVerb} to #${channel}`}
              title={`${theme.sendVerb} to #${channel} as ${auth.login}`}
              aria-label={`Message #${channel}`}
              data-composer={channel}
              aria-autocomplete={tabComplete ? "list" : undefined}
              aria-controls={completion ? listId : undefined}
              aria-expanded={tabComplete ? !!completion : undefined}
              aria-activedescendant={completion ? `${listId}-${completion.index}` : undefined}
              className={cn("h-8 bg-background pr-12 transition-none", compact ? "text-[13px]" : "text-sm")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              // Edge spellcheck rechecks the word under the caret on every arrow press.
              spellCheck={false}
            />
            {length > 400 ? (
              <span
                className={`absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-[11px] ${length > 500 ? "text-danger-text" : "text-muted-foreground"}`}
              >
                {500 - length}
              </span>
            ) : null}
          </div>
          {emotePicker ? (
            <EmotePicker channel={channel} emotes={emotes} index={index} onPick={insertEmote} returnFocus={inputRef} compact={compact} />
          ) : null}
          <Button
            type="submit"
            size={compact ? "icon-sm" : "default"}
            className={cn(!compact && "h-8 gap-1.5 px-4 font-semibold")}
            disabled={!text.trim() || !connected}
            aria-label={theme.sendVerb}
            title={theme.sendVerb}
          >
            {compact ? null : <span className="hidden sm:inline">{theme.sendVerb}</span>}
            <SendHorizontal className={cn("size-4", !compact && "sm:hidden")} />
          </Button>
        </form>
        </div>
      )}
      {compact ? null : <RoomChips channel={channel} />}
      {!compact && !connected && !locked ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Connecting your account to Twitch chat…</p>
      ) : null}
      </div>
    </div>
  );
}

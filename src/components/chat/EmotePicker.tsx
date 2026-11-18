import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useEffectEvent, startTransition, type KeyboardEvent } from "react";
import { Search, Smile, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chat } from "@/lib/chat/controller";
import { emoteRegistry } from "@/lib/emotes/registry";
import { findEmotes, type NameIndex } from "@/lib/emotes/search";
import {
  PROVIDER_SHORT,
  emoteKey,
  emoteUrls,
  type Emote,
  type EmoteProvider,
  type EmoteScope,
} from "@/lib/emotes/types";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat";
import { MAX_RECENT_EMOTES, type PickerTab } from "@/store/settings";
import { useImageRetry } from "./useImageRetry";

/** The panel's tabs (Bran's choice: favourites first, then the approved Recent / Channel / Global / BTTV / 7TV). */
const TABS: { id: Exclude<PickerTab, "all">; label: string; title: string; name?: string }[] = [
  { id: "fav", label: "★", name: "Favourites", title: "Favourites (right-click an emote to add or remove it)" },
  { id: "recent", label: "Recent", title: "Emotes you used recently" },
  { id: "channel", label: "Channel", title: "This channel's emotes (7TV, BetterTTV, FrankerFaceZ)" },
  { id: "global", label: "Global", title: "Emotes every channel has" },
  { id: "bttv", label: "BTTV", title: "BetterTTV emotes" },
  { id: "7tv", label: "7TV", title: "7TV emotes" },
];

/** Older builds saved "all"; it shows as Recent. */
function shownTab(tab: PickerTab): Exclude<PickerTab, "all"> {
  return tab === "all" ? "recent" : tab;
}

/** How many tiles to paint at first / per scroll page, so big packs open instantly. */
const PAGE = 160;

const PROVIDERS: EmoteProvider[] = ["twitch", "7tv", "bttv", "ffz"];
const SCOPE_LABEL: Record<EmoteScope, string> = { channel: "Channel", global: "Global" };

/** Puts an emote at the front of Recent (picked here, or finished with Tab in the message box). */
export function rememberEmoteUse(emote: Emote): void {
  const key = emoteKey(emote);
  chat.updateSettings((s) => ({
    recentEmotes: [key, ...s.recentEmotes.filter((k) => k !== key)].slice(0, MAX_RECENT_EMOTES),
  }));
}

interface Section {
  key: string;
  title?: string;
  emotes: Emote[];
}

/** Groups a tab's emotes under small headers (by provider, or by channel/global for a provider tab). */
function buildSections(emotes: Emote[], tab: Exclude<PickerTab, "all">, typed: string): Section[] {
  if (typed || tab === "fav" || tab === "recent") return [{ key: "all", emotes }];
  const groups = new Map<string, Emote[]>();
  for (const emote of emotes) {
    const key = tab === "bttv" || tab === "7tv" ? emote.scope : emote.provider;
    const list = groups.get(key) ?? [];
    list.push(emote);
    groups.set(key, list);
  }
  const order: string[] = tab === "bttv" || tab === "7tv" ? ["channel", "global"] : PROVIDERS;
  return order
    .filter((key) => groups.get(key)?.length)
    .map((key) => ({
      key,
      title: tab === "bttv" || tab === "7tv" ? SCOPE_LABEL[key as EmoteScope] : PROVIDER_SHORT[key as EmoteProvider],
      emotes: groups.get(key)!,
    }));
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Memoized: hovering one tile updates the footer without redrawing every tile. */
const EmoteTile = memo(function EmoteTile({
  emote,
  favourite,
  still,
  onPick,
  onShow,
}: {
  emote: Emote;
  favourite: boolean;
  still: boolean;
  onPick: (emote: Emote) => void;
  onShow: (emote: Emote | null) => void;
}) {
  const urls = emoteUrls(emote, still);
  const { failed, attempt, onError } = useImageRetry(urls.url1x);
  return (
    <button
      type="button"
      title={`${emote.name} · ${PROVIDER_SHORT[emote.provider]}. Right-click to ${favourite ? "unfavourite" : "favourite"}`}
      aria-label={`${emote.name}, ${PROVIDER_SHORT[emote.provider]}${favourite ? ", favourite" : ""}`}
      data-emote-tile={emote.name}
      onClick={() => onPick(emote)}
      onMouseEnter={() => onShow(emote)}
      onFocus={() => onShow(emote)}
      onContextMenu={(event) => {
        event.preventDefault();
        chat.updateSettings((s) => ({ favoriteEmotes: toggleInList(s.favoriteEmotes, emoteKey(emote)) }));
      }}
      className="relative grid size-9 place-items-center border-2 border-transparent outline-none hover:border-accent-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      style={{ contentVisibility: "auto", containIntrinsicSize: "36px 36px" }}
    >
      {failed ? (
        <span className="truncate px-0.5 text-[9px] text-muted-foreground">{emote.name}</span>
      ) : (
        <img
          key={attempt}
          src={urls.url1x}
          srcSet={urls.url2x ? `${urls.url1x} 1x, ${urls.url2x} 2x` : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={onError}
          className="max-h-7 max-w-8 object-contain"
        />
      )}
      {favourite ? <Star className="absolute top-0 right-0 size-2.5 fill-mention text-mention" aria-hidden /> : null}
    </button>
  );
});

export interface EmotePickerProps {
  channel: string;
  emotes: Emote[];
  index: NameIndex;
  onPick: (emote: Emote) => void;
  /** Where focus goes when the menu closes (the message box). */
  returnFocus?: React.RefObject<HTMLElement | null>;
  compact?: boolean;
}

/** The emote panel next to Send: search, tabs, an emote grid and a footer naming the emote under the pointer. */
export function EmotePicker({ channel, emotes, index, onPick, returnFocus, compact = false }: EmotePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [shownEmote, setShownEmote] = useState<Emote | null>(null);
  const tab = shownTab(useChat((s) => s.settings.pickerTab));
  const favourites = useChat((s) => s.settings.favoriteEmotes);
  const recent = useChat((s) => s.settings.recentEmotes);
  const still = useChat((s) => s.settings.emoteAnimation === "never");
  const emoteVersion = useChat((s) => `${s.emoteVersions[channel] ?? 0}.${s.globalEmoteVersion}`);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setShownEmote(null);
    }
  }, [open]);

  useEffect(() => {
    setLimit(PAGE);
    listRef.current?.scrollTo(0, 0);
  }, [tab, query, channel, open]);

  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  const typed = query.trim();

  const tabEmotes = useMemo(() => {
    if (typed) return findEmotes(index, typed, 500);
    // Favourites and Recent can hold emotes picked from the BTTV / 7TV tabs whose name another source wins in chat.
    const known = (): Map<string, Emote> => {
      const byKey = new Map(emotes.map((e) => [emoteKey(e), e]));
      for (const provider of ["7tv", "bttv", "ffz"] as const) {
        for (const e of emoteRegistry.providerEmotes(channel, provider)) if (!byKey.has(emoteKey(e))) byKey.set(emoteKey(e), e);
      }
      return byKey;
    };
    switch (tab) {
      case "fav": {
        const byKey = known();
        return favourites.map((key) => byKey.get(key)).filter((e): e is Emote => !!e);
      }
      case "recent": {
        const byKey = known();
        return recent.map((key) => byKey.get(key)).filter((e): e is Emote => !!e);
      }
      case "channel":
        return emotes.filter((e) => e.scope === "channel");
      case "global":
        return emotes.filter((e) => e.scope === "global");
      case "bttv":
      case "7tv":
        // Every emote of the source, also names another source wins in chat.
        return emoteRegistry.providerEmotes(channel, tab);
      default:
        return emotes;
    }
    // emoteVersion is a dependency on purpose: provider lists can change without the lookup list changing.
  }, [emotes, index, typed, tab, favouriteSet, favourites, recent, channel, emoteVersion]);

  const sections = useMemo(() => buildSections(tabEmotes, tab, typed), [tabEmotes, tab, typed]);
  // Page through tiles (not sections) so a huge pack never paints at once.
  let budget = limit;
  const visibleSections = sections
    .map((section) => {
      const take = section.emotes.slice(0, Math.max(0, budget));
      budget -= take.length;
      return { ...section, total: section.emotes.length, emotes: take };
    })
    .filter((section) => section.emotes.length > 0);
  const hasMore = limit < tabEmotes.length;

  const grow = useEffectEvent(() => {
    startTransition(() => setLimit((n) => Math.min(n + PAGE, tabEmotes.length)));
  });

  useEffect(() => {
    if (!open || !hasMore) return;
    const node = sentinelRef.current;
    const root = listRef.current;
    if (!node || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) grow();
      },
      { root, rootMargin: "120px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [open, hasMore, limit, tabEmotes.length]);

  // Stable, so the memoized tiles don't redraw when the message box re-renders.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const pick = useCallback((emote: Emote) => {
    onPickRef.current(emote);
    rememberEmoteUse(emote);
    setOpen(false);
  }, []);
  const panelId = useId();

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    const next = TABS[to];
    setQuery("");
    chat.updateSettings({ pickerTab: next.id });
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  const emptyText =
    emotes.length === 0
      ? `No emotes loaded for #${channel} yet.`
      : typed
        ? `Nothing called "${typed}".`
        : tab === "fav"
          ? "No favourites yet. Right-click an emote to add it."
          : tab === "recent"
            ? "Emotes you use show up here."
            : tab === "channel"
              ? `#${channel} has no channel emotes.`
              : "None from this source here.";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={compact ? "icon-sm" : "icon-lg"}
            className={cn(
              "shrink-0 data-popup-open:border-primary data-popup-open:bg-primary data-popup-open:text-primary-foreground",
              !compact && "size-8",
            )}
            aria-label="Emote menu"
            title="Emotes (right-click one to favourite it)"
            data-testid="emote-picker-button"
          />
        }
      >
        <Smile className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={6}
        finalFocus={returnFocus}
        className="w-[min(92vw,22.5rem)] gap-0 border border-border bg-surface p-0 shadow-none ring-0"
        data-testid="emote-picker"
      >
        <div className="relative p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const first = tabEmotes[0];
              // Enter picks the first search result (only once something is typed).
              if (event.key === "Enter" && typed && first) {
                event.preventDefault();
                pick(first);
              }
            }}
            placeholder="Search emotes"
            aria-label="Search emotes"
            className="h-9 pl-8 text-sm"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex border-b border-border px-1" role="tablist" aria-label="Emote groups" onKeyDown={onTabKey}>
          {TABS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              data-tab={option.id}
              aria-selected={!typed && tab === option.id}
              aria-controls={panelId}
              aria-label={option.name}
              tabIndex={tab === option.id ? 0 : -1}
              title={option.title}
              onClick={() => {
                setQuery("");
                chat.updateSettings({ pickerTab: option.id });
              }}
              className={cn(
                "-mb-px h-9 border-b-2 px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                !typed && tab === option.id
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div
          ref={listRef}
          id={panelId}
          role="tabpanel"
          aria-label={typed ? "Search results" : (TABS.find((t) => t.id === tab)?.name ?? TABS.find((t) => t.id === tab)?.label)}
          className="zoo-scroll max-h-72 min-h-24 overflow-y-auto overscroll-contain p-2"
        >
          {tabEmotes.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
          ) : (
            <>
              {visibleSections.map((section) => (
                <div key={section.key} className="mb-1">
                  {section.title ? (
                    <div className="px-0.5 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {section.title}{" "}
                      <span className="ml-0.5 font-normal normal-case">{section.total}</span>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
                    {section.emotes.map((emote) => (
                      <EmoteTile
                        key={emoteKey(emote)}
                        emote={emote}
                        favourite={favouriteSet.has(emoteKey(emote))}
                        still={still}
                        onPick={pick}
                        onShow={setShownEmote}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {hasMore ? (
                <div ref={sentinelRef} className="px-1 py-2 text-center text-[10px] text-muted-foreground">
                  Loading more…
                </div>
              ) : null}
            </>
          )}
        </div>
        {/* Visual helper only: each tile already says its name and source to screen readers. */}
        <div className="flex h-9 items-center gap-2 border-t border-border px-2 text-xs" aria-hidden>
          {shownEmote ? (
            <>
              <img src={emoteUrls(shownEmote, still).url1x} alt="" className="max-h-6 max-w-8 object-contain" />
              <span className="truncate font-semibold">{shownEmote.name}</span>
              <span className="shrink-0 text-muted-foreground">
                · {PROVIDER_SHORT[shownEmote.provider]} · click to insert
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Click an emote to insert it. Right-click to favourite.</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

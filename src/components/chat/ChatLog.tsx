import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { PawPrint } from "lucide-react";
import { GeckoFootIcon } from "@/components/mascots/icons";
import { PROVIDER_LABELS, type EmoteProvider } from "@/lib/emotes/types";
import { resolveSkin } from "@/lib/themes";
import { usePrefersDark, useTheme } from "@/lib/useTheme";
import type { ChatMessage } from "@/lib/twitch/types";
import { useChat } from "@/store/chat";
import { isFeatureOn } from "@/store/settings";
import {
  HISTORY_PAGE,
  countNewer,
  isUserScrollUp,
  liveSlice,
  LIVE_SLACK_PX,
  MAX_PAUSED_ROWS,
  pausedSlice,
} from "@/lib/chat/window";
import { MessageRow, type RowPrefs } from "./MessageRow";

interface HoverEmote {
  name: string;
  provider: EmoteProvider;
  scope: string;
  src: string;
  rect: DOMRect;
}

/** Rows kept in the DOM while following live chat. Scrolling up pages older rows in. */
const DEFAULT_LIVE_ROWS = 150;

interface Pause {
  /** Buffer at the moment live chat was left. Newer lines stay out of this snapshot. */
  snapshot: ChatMessage[];
  /** Inclusive index into the snapshot. */
  start: number;
  /** Exclusive index into the snapshot, fixed when live chat was left. */
  end: number;
}

interface ChatLogProps {
  messages: ChatMessage[];
  /** Channel these messages belong to (used for per-channel feature overrides). */
  channel: string;
  /** Changing this resets scroll position (switching channel or view). */
  viewKey: string;
  empty?: ReactNode;
  /** Draws a "new since you left" divider after this message id. */
  readMarker?: string;
  /** How many recent rows stay rendered while following live chat. */
  liveRows?: number;
  /** Accessible name of the scrolling log. */
  label?: string;
  onNameClick?: (login: string) => void;
}

export function ChatLog({
  messages,
  channel,
  viewKey,
  empty,
  readMarker,
  liveRows = DEFAULT_LIVE_ROWS,
  label = "Chat messages",
  onNameClick,
}: ChatLogProps) {
  const prefersDark = usePrefersDark();
  const prefs: RowPrefs & { textSize: number; emoteSize: number; emotePreview: boolean; zebra: boolean } = useChat(
    useShallow((s) => ({
      skin: resolveSkin(s.settings.skin, s.settings.autoLightSkin, s.settings.autoDarkSkin, prefersDark),
      showTimestamps: s.settings.showTimestamps,
      use24h: s.settings.use24h,
      showBadges: s.settings.showBadges,
      emoteAnimation: s.settings.emoteAnimation,
      showDeleted: isFeatureOn(s.settings, channel, "showDeleted"),
      textSize: s.settings.textSize,
      emoteSize: s.settings.emoteSize,
      emotePreview: isFeatureOn(s.settings, channel, "emotePreview"),
      zebra: s.settings.zebra,
    })),
  );
  const emoteVersions = useChat((s) => s.emoteVersions);
  const globalEmoteVersion = useChat((s) => s.globalEmoteVersion);
  const badgeVersion = useChat((s) => s.badgeVersion);
  const selfLogin = useChat((s) => (s.auth.status === "logged_in" ? s.auth.login : undefined));
  const theme = useTheme();
  // Gecko wording only on an animal gecko theme; Crested gecko uses plain words (Bran's choice).
  const isGecko = theme.kind === "animal" && theme.animal === "gecko";

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastInteraction = useRef(0);
  /** scrollTop the last time the log sat at the bottom (following live chat). */
  const liveTop = useRef(0);
  const [pause, setPause] = useState<Pause | null>(null);
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  const liveRef = useRef(messages);
  liveRef.current = messages;
  const visibleCount = useRef(0);
  const [hover, setHover] = useState<HoverEmote | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const anchorFromBottom = useRef<number | null>(null);
  const paging = useRef(false);

  const visible = useMemo(
    () => (pause ? pausedSlice(pause.snapshot, pause.start, pause.end) : liveSlice(messages, liveRows, readMarker)),
    [pause, messages, readMarker, liveRows],
  );
  visibleCount.current = visible.length;
  const newer = pause ? countNewer(pause.snapshot, messages) : 0;

  useEffect(() => {
    setPause(null);
  }, [viewKey]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!pause) {
      // Already pinned. Writing scrollTop again forces a layout under the caret.
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 2) el.scrollTop = el.scrollHeight;
      // A row that finishes laying out a frame later (wrapped link, late font) must not leave the last line short.
      const id = requestAnimationFrame(() => {
        if (!pauseRef.current && el.scrollHeight - el.scrollTop - el.clientHeight > 2) el.scrollTop = el.scrollHeight;
      });
      return () => cancelAnimationFrame(id);
    } else if (anchorFromBottom.current !== null) {
      // Older history was just rendered above the viewport; keep the same lines in view.
      el.scrollTop = el.scrollHeight - anchorFromBottom.current;
      anchorFromBottom.current = null;
    }
  }, [visible, pause, prefs.textSize, prefs.emoteSize]);

  // Emotes load after the row renders and grow it, and the box itself gets shorter when a reply bar
  // opens or the window shrinks; keep pinned to the bottom while live.
  useEffect(() => {
    const content = contentRef.current;
    const box = scrollRef.current;
    if (!content || !box) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (pauseRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pauseRef.current) scrollToBottom();
      });
    });
    observer.observe(content);
    observer.observe(box);
    // Belt and braces for a last line left half below the edge: an emote picture that finished loading, or the
    // window coming back from behind other windows (Windows stops drawing it there), re-pins while live.
    const repin = () => {
      if (pauseRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pauseRef.current) scrollToBottom();
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") repin();
    };
    content.addEventListener("load", repin, true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", repin);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      content.removeEventListener("load", repin, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", repin);
    };
  }, [scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < LIVE_SLACK_PX) {
      liveTop.current = el.scrollTop;
      if (pauseRef.current) setPause(null);
      return;
    }
    const held = pauseRef.current;
    // Only a person scrolling up pauses the feed; layout shifts from images or a shorter box don't.
    if (!held && isUserScrollUp(liveTop.current, el.scrollTop, distance, Date.now() - lastInteraction.current)) {
      const snapshot = liveRef.current;
      const shown = Math.min(snapshot.length, visibleCount.current);
      setPause({ snapshot, start: snapshot.length - shown, end: snapshot.length });
      return;
    }
    if (held && el.scrollTop < 48 && held.start > 0 && held.end - held.start < MAX_PAUSED_ROWS && !paging.current) {
      paging.current = true;
      requestAnimationFrame(() => {
        paging.current = false;
      });
      anchorFromBottom.current = el.scrollHeight - el.scrollTop;
      const room = MAX_PAUSED_ROWS - (held.end - held.start);
      const start = Math.max(0, held.start - Math.min(HISTORY_PAGE, room));
      setPause({ snapshot: held.snapshot, start, end: held.end });
    }
  };

  const markInteraction = () => {
    lastInteraction.current = Date.now();
  };

  const onMouseOver = (event: React.MouseEvent) => {
    if (!prefs.emotePreview) return;
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.dataset.emoteName) return;
    const name = target.dataset.emoteName;
    const src = target.dataset.emoteSrc ?? target.src;
    const rect = target.getBoundingClientRect();
    const current = hoverRef.current;
    if (
      current &&
      current.name === name &&
      current.src === src &&
      current.rect.left === rect.left &&
      current.rect.top === rect.top &&
      current.rect.width === rect.width
    ) {
      return;
    }
    setHover({
      name,
      provider: target.dataset.emoteProvider as EmoteProvider,
      scope: target.dataset.emoteScope ?? "global",
      src,
      rect,
    });
  };

  const onMouseOut = (event: React.MouseEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest("[data-emote-name]")) return;
    if ((event.target as HTMLElement).dataset?.emoteName) setHover(null);
  };

  return (
    <div className="relative h-full min-h-0 w-full flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={markInteraction}
        onTouchMove={markInteraction}
        onPointerDown={markInteraction}
        onKeyDown={markInteraction}
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
        tabIndex={0}
        aria-label={label}
        className="zoo-scroll absolute inset-0 overflow-y-auto overscroll-contain outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring"
        data-testid="chat-log-scroll"
      >
        <div
          ref={contentRef}
          className="chat-log flex min-h-full flex-col justify-end py-2"
          style={{ "--chat-font": `${prefs.textSize}px`, "--emote-scale": prefs.emoteSize } as React.CSSProperties}
          data-zebra={prefs.zebra}
          role="log"
          aria-live="off"
        >
          {visible.length === 0 && empty ? (
            <div className="flex flex-1 items-center justify-center p-6">{empty}</div>
          ) : null}
          {visible.map((message, index) => (
            <Fragment key={message.id}>
              <MessageRow
                message={message}
                revision={`${emoteVersions[message.channel] ?? 0}.${globalEmoteVersion}.${badgeVersion}`}
                prefs={prefs}
                selfLogin={selfLogin}
                onNameClick={onNameClick}
              />
              {message.id === readMarker && index < visible.length - 1 ? (
                <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-semibold tracking-wide text-mention uppercase" role="separator">
                  <span className="h-px flex-1 bg-mention/45" />
                  New since you left
                  <span className="h-px flex-1 bg-mention/45" />
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>

      {pause ? (
        <button
          type="button"
          onClick={() => setPause(null)}
          className="zoo-glow absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg transition hover:brightness-110"
        >
          {isGecko ? <GeckoFootIcon className="size-4" /> : <PawPrint className="size-4" />}
          {newer > 0 ? `${newer > 999 ? "999+" : newer} new · ` : "Paused · "}
          {isGecko ? "Stick to live chat" : "Back to live chat"}
        </button>
      ) : null}

      {hover
        ? createPortal(
            <div
              className="pointer-events-none fixed z-50 flex w-max max-w-56 flex-col items-center gap-1.5 rounded-xl border bg-popover/95 p-2.5 text-center shadow-xl backdrop-blur"
              style={{
                left: Math.min(Math.max(hover.rect.left + hover.rect.width / 2, 120), window.innerWidth - 120),
                top: hover.rect.top < 168 ? hover.rect.bottom + 8 : hover.rect.top - 8,
                transform: hover.rect.top < 168 ? "translate(-50%, 0)" : "translate(-50%, -100%)",
              }}
            >
              <img src={hover.src} alt="" className="max-h-24 max-w-48 object-contain" />
              <div className="text-sm font-semibold break-all">{hover.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {PROVIDER_LABELS[hover.provider]} · {hover.provider === "twitch" ? "Twitch emote" : `${hover.scope} emote`}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

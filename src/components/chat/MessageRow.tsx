import { memo, useMemo, useState, type ReactNode } from "react";
import { CircleAlert, CornerDownRight, Highlighter, Info, LoaderCircle, Sparkles } from "lucide-react";
import { GeckoEggIcon, GeckoTailIcon } from "@/components/mascots/icons";
import { chat } from "@/lib/chat/controller";
import { canFormatTime } from "@/lib/chat/messageTime";
import { canReplyTo } from "@/lib/twitch/reply";
import { setReplyTarget } from "@/store/ui";
import { tokenize, type Fragment } from "@/lib/chat/tokenize";
import { readableNameColor } from "@/lib/colors";
import { emoteRegistry } from "@/lib/emotes/registry";
import { emoteBigUrl, emoteUrls, type Emote } from "@/lib/emotes/types";
import { openExternal } from "@/lib/platform";
import type { ChatMessage } from "@/lib/twitch/types";
import { cn } from "@/lib/utils";
import type { ConcreteSkin } from "@/lib/themes";
import type { EmoteAnimation } from "@/store/settings";

export interface RowPrefs {
  /** The theme showing now; chatter name colours are adjusted to read on it. */
  skin: ConcreteSkin;
  showTimestamps: boolean;
  use24h: boolean;
  showBadges: boolean;
  emoteAnimation: EmoteAnimation;
  /** Deleted messages stay readable (faded, crossed out) instead of being replaced by a note. */
  showDeleted: boolean;
}

const formatters = {
  h24: new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }),
  h12: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }),
};

function formatTime(ts: number, use24h: boolean): string {
  return canFormatTime(ts) ? (use24h ? formatters.h24 : formatters.h12).format(ts) : "";
}

function srcSet(urls: { url1x: string; url2x?: string; url4x?: string }): string | undefined {
  const parts = [`${urls.url1x} 1x`];
  if (urls.url2x) parts.push(`${urls.url2x} 2x`);
  if (urls.url4x) parts.push(`${urls.url4x} 4x`);
  return parts.length > 1 ? parts.join(", ") : undefined;
}

function EmoteImage({ emote, animation, overlay = false }: { emote: Emote; animation: EmoteAnimation; overlay?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  if (failed) return overlay ? null : <span className="[grid-area:1/1]">{emote.name}</span>;
  // "hover": the still frame until the pointer is on it (the row's mouse events reach us through bubbling).
  const still = animation === "never" || (animation === "hover" && !hovered);
  const urls = emoteUrls(emote, still);
  return (
    <img
      src={urls.url1x}
      srcSet={srcSet(urls)}
      alt={emote.name}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("chat-emote [grid-area:1/1]", overlay && "pointer-events-none")}
      data-emote-name={emote.name}
      data-emote-provider={emote.provider}
      data-emote-scope={emote.scope}
      data-emote-src={emoteBigUrl(emote, animation === "never")}
      onMouseEnter={animation === "hover" && emote.animated ? () => setHovered(true) : undefined}
      onMouseLeave={animation === "hover" && emote.animated ? () => setHovered(false) : undefined}
      onError={() => setFailed(true)}
    />
  );
}

function renderFragment(fragment: Fragment, index: number, animation: EmoteAnimation, selfLogin?: string): ReactNode {
  switch (fragment.type) {
    case "text":
      return <span key={index}>{fragment.text}</span>;
    case "emote":
      return (
        <span key={index} className="inline-grid place-items-center align-middle mx-px">
          <EmoteImage emote={fragment.emote} animation={animation} />
          {fragment.overlays.map((overlay, i) => (
            <EmoteImage key={i} emote={overlay} animation={animation} overlay />
          ))}
        </span>
      );
    case "mention":
      return (
        <span
          key={index}
          className={cn(
            "font-semibold",
            fragment.login === selfLogin ? "font-bold text-foreground" : "text-foreground/95",
          )}
        >
          {fragment.text}
        </span>
      );
    case "link":
      return (
        <a
          key={index}
          href={fragment.href}
          className="text-accent-text underline decoration-primary/40 underline-offset-2 hover:decoration-primary break-all"
          onClick={(event) => {
            event.preventDefault();
            void openExternal(fragment.href);
          }}
        >
          {fragment.text}
        </a>
      );
  }
}

interface MessageRowProps {
  message: ChatMessage;
  /** Changes whenever this channel's emotes or badges change, so the row re-renders. */
  revision: string;
  prefs: RowPrefs;
  selfLogin?: string;
  onNameClick?: (login: string) => void;
}

function MessageRowInner({
  message,
  revision,
  prefs,
  selfLogin,
  onNameClick,
}: MessageRowProps) {
  const fragments = useMemo(() => {
    const lookup = emoteRegistry.lookup(message.channel);
    const { blocked } = emoteRegistry.getPrefs();
    return tokenize(message.text, message.twitchEmotes, (word) => lookup.get(word), (name) => blocked.has(name));
    // `revision` changes when this channel's emote map or the emote switches change; the lookup itself is not reactive.
  }, [message.text, message.twitchEmotes, message.channel, revision]);

  const time = prefs.showTimestamps ? (
    <time className="mr-1.5 font-mono text-[0.78em] tabular-nums text-muted-foreground select-none">
      {formatTime(message.ts, prefs.use24h)}
    </time>
  ) : null;

  if (message.kind === "system") {
    const warn = message.tone === "warn" || message.tone === "error";
    return (
      <div
        className={cn(
          "chat-row flex items-center gap-2 px-3 py-1.5 text-[0.86em]",
          warn ? "text-warn" : message.tone === "success" ? "text-accent-text" : "text-muted-foreground",
        )}
      >
        <span className="h-px flex-1 bg-current opacity-20" />
        {warn ? <GeckoTailIcon className="size-3.5 shrink-0" /> : <Sparkles className="size-3.5 shrink-0" />}
        <span className="text-center">{message.text}</span>
        <span className="h-px flex-1 bg-current opacity-20" />
      </div>
    );
  }

  if (message.kind === "notice") {
    return (
      <div className="chat-row px-3 py-[3px] leading-[1.55] text-muted-foreground italic">
        {time}
        <Info className="mr-1 inline size-3.5 -translate-y-px text-accent-text" />
        {message.text}
      </div>
    );
  }

  const name = message.displayName ?? message.login ?? "";
  const showLogin = !!message.login && name.toLowerCase() !== message.login;
  const nameColor = readableNameColor(message.color, message.login ?? name, prefs.skin);
  const isAction = message.kind === "action";
  const isEvent = message.kind === "event";
  const deleted = !!message.deleted;
  /** Hidden deletions: the words are replaced by a note, like Twitch does. */
  const hideText = deleted && !prefs.showDeleted;
  const replyable = canReplyTo(message);

  const badges = prefs.showBadges
    ? message.badges.map((badge) => {
        const image = chat.badgeImage(message.channel, badge);
        if (!image) return null;
        const title =
          badge.setId === "subscriber" && badge.info ? `${image.title} (${badge.info} months)` : image.title;
        return (
          <img
            key={`${badge.setId}/${badge.version}`}
            src={image.url1x}
            srcSet={image.url2x ? `${image.url1x} 1x, ${image.url2x} 2x` : undefined}
            alt={title}
            title={title}
            className="mr-1 inline-block size-[18px] -translate-y-px align-middle"
            loading="lazy"
          />
        );
      })
    : null;

  return (
    <div
      className={cn(
        "chat-row group relative px-3 py-[3px] leading-[1.6] break-words [overflow-wrap:anywhere]",
        replyable && "pr-8",
        message.mention && "bg-mention-bg shadow-[inset_3px_0_0_var(--mention)]",
        message.highlighted && !message.mention && "bg-mention-bg shadow-[inset_3px_0_0_var(--zc-accent-2)]",
        message.firstMsg && !message.mention && !message.highlighted && "shadow-[inset_3px_0_0_var(--zc-accent-2)]",
        isEvent && "my-0.5 bg-primary/[0.07] py-1.5 shadow-[inset_3px_0_0_var(--primary)]",
        deleted && "chat-row-deleted text-muted-foreground",
        message.pending === "sending" && "text-muted-foreground",
      )}
      data-deleted={deleted || undefined}
      data-mention={message.mention || undefined}
      data-highlighted={(message.highlighted && !message.mention) || undefined}
    >
      {replyable ? (
        <button
          type="button"
          tabIndex={-1}
          className="pointer-events-none absolute top-0.5 right-1 rounded-md p-1 text-muted-foreground opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-80"
          aria-label={`Reply to ${name}`}
          title="Reply"
          onClick={() =>
            message.login &&
            setReplyTarget({
              channel: message.channel,
              id: message.id,
              login: message.login,
              displayName: name,
              text: message.text,
            })
          }
        >
          <CornerDownRight className="size-3.5" />
        </button>
      ) : null}
      {message.reply ? (
        <div className="mb-0.5 flex items-center gap-1 truncate pl-1 text-[0.82em] text-muted-foreground">
          <CornerDownRight className="size-3 shrink-0" />
          <span className="truncate">
            Replying to <span className="font-medium">@{message.reply.displayName}</span>: {message.reply.text}
          </span>
        </div>
      ) : null}
      {isEvent && message.systemText ? (
        <div className="mb-0.5 font-medium text-accent-text">
          {time}
          {message.systemText}
        </div>
      ) : null}
      {isEvent && !message.text ? null : (
        <>
          {isEvent ? null : time}
          {message.firstMsg ? (
            <span title="First message in this channel" className="mr-1 inline-flex -translate-y-px align-middle">
              <GeckoEggIcon />
              <span className="sr-only">First message in this channel</span>
            </span>
          ) : null}
          {message.highlighted && !message.mention ? (
            <span title="Highlighted with channel points" className="mr-1 inline-flex -translate-y-px align-middle text-warn">
              <Highlighter className="size-3.5" aria-hidden />
              <span className="sr-only">Highlighted with channel points</span>
            </span>
          ) : null}
          {badges}
          <button
            type="button"
            onClick={() => message.login && onNameClick?.(message.login)}
            className="font-bold hover:underline"
            style={{ color: nameColor }}
            title={message.login ? `Mention @${message.login}` : undefined}
          >
            {name}
            {showLogin ? <span className="font-medium text-muted-foreground"> ({message.login})</span> : null}
          </button>
          {isAction ? " " : <span className="mr-1 text-muted-foreground">:</span>}
          {hideText ? (
            <span className="text-muted-foreground italic">message deleted</span>
          ) : (
            <span style={isAction ? { color: nameColor } : undefined} className={cn("chat-text", isAction && "italic")}>
              {fragments.map((fragment, index) => renderFragment(fragment, index, prefs.emoteAnimation, selfLogin))}
            </span>
          )}
          {deleted && !hideText ? (
            <span className="ml-1.5 rounded bg-muted px-1 text-[0.75em] text-muted-foreground not-italic">deleted</span>
          ) : null}
          {message.pending === "sending" ? (
            <LoaderCircle className="ml-1.5 inline size-3 animate-spin text-muted-foreground" aria-label="Sending" />
          ) : null}
        </>
      )}
      {message.pending === "failed" ? (
        <div className="mt-0.5 flex items-center gap-1 text-[0.82em] text-danger-text">
          <CircleAlert className="size-3.5 shrink-0" />
          Not sent: {message.failReason ?? "Twitch rejected the message."}
        </div>
      ) : null}
    </div>
  );
}

export const MessageRow = memo(MessageRowInner);

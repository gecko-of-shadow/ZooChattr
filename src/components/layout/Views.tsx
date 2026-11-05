import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { AlertTriangle, Clock, Link2, Lock, Minus, MoreHorizontal, RotateCw, Smile, UserRoundX, Users } from "lucide-react";
import { ChatLog } from "@/components/chat/ChatLog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Mascot } from "@/components/mascots/Mascot";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { chat } from "@/lib/chat/controller";
import { emoteRegistry } from "@/lib/emotes/registry";
import { liveLabel } from "@/lib/follows";
import { PROVIDER_LABELS, THIRD_PARTY_PROVIDERS, type ProviderStatus } from "@/lib/emotes/types";
import { GRID_EDGE, GRID_GAP, layoutViewGrid, viewColumns, viewForSlots } from "@/lib/gridLayout";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { useChat } from "@/store/chat";
import { isFeatureOn } from "@/store/settings";
import { closePicker, insertIntoComposer, openPicker, useUi, type PaneTarget } from "@/store/ui";
import { ChannelAvatar } from "./ChannelAvatar";
import { ChannelMenuPopup } from "./ChannelMenu";
import { ChannelPicker } from "./ChannelPicker";
import { beginChannelDrag } from "./gridDrag";

function statusText(status: ProviderStatus): string {
  switch (status.state) {
    case "ok":
      return `${status.count} emote${status.count === 1 ? "" : "s"}`;
    case "none":
      return "none for this channel";
    case "loading":
      return "loading…";
    case "error":
      return `unavailable (${status.error})`;
    default:
      return "waiting";
  }
}

/** Re-renders when a channel's (or the global) emotes change, and reads their load status. */
function useEmoteStatus(channel: string) {
  const version = useChat((s) => `${s.emoteVersions[channel] ?? 0}.${s.globalEmoteVersion}`);
  const settings = useChat((s) => s.settings);
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [version]);
  const channelStatus = emoteRegistry.getChannelStatus(channel);
  const globalStatus = emoteRegistry.getGlobalStatus();
  const failing = THIRD_PARTY_PROVIDERS.some(
    (p) => channelStatus?.[p].state === "error" || globalStatus[p].state === "error",
  );
  const total = THIRD_PARTY_PROVIDERS.reduce((sum, p) => {
    if (!isFeatureOn(settings, channel, p)) return sum;
    const c = channelStatus?.[p];
    return sum + (c?.state === "ok" ? c.count : 0);
  }, 0);
  return { settings, channelStatus, globalStatus, failing, total };
}

/**
 * Emote status in a pane header, as plain text and icons (not a button: a pane header has only "−" and "⋯").
 * The full table is "Emote status…" on the channel's right-click menu.
 */
function EmoteStatusNote({ channel, compact = false }: { channel: string; compact?: boolean }) {
  const { failing, total } = useEmoteStatus(channel);
  if (compact && !failing) return null;
  const label = failing ? `Emotes in #${channel}: an emote source failed. Right-click the header (or Shift+F10 on its row in the channel picker) for Emote status.` : `${total} channel emotes`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex shrink-0 items-center gap-1 text-xs text-muted-foreground", failing && "text-warn")}
      data-testid={`emote-note-${channel}`}
    >
      {failing ? <AlertTriangle className="size-3" /> : <Smile className="size-3" />}
      {compact ? null : <span className="hidden lg:inline">{total} channel emotes</span>}
    </span>
  );
}

/** Where "Emote status…" opens: under the channel's picker row when the picker is showing it, else under its pane header. */
function emoteStatusAnchor(channel: string): Element | null {
  const name = CSS.escape(channel);
  return (
    document.querySelector(`[data-picker-row="${name}"]`) ??
    document.querySelector(`[data-testid="grid-header-${name}"]`) ??
    document.querySelector(`[data-single-header="${name}"]`)
  );
}

/** "Emote status…" from a channel's right-click menu (picker row or pane header): the emote table in a popover. */
export function EmoteStatusPopover() {
  const channel = useUi((s) => s.emoteStatusFor);
  if (!channel || !emoteStatusAnchor(channel)) return null;
  const close = (open: boolean, details: { reason: string }) => {
    if (open) return;
    useUi.setState({ emoteStatusFor: null });
    // No trigger button to return to: Esc puts focus back in the picker's search box, or on the pane's "⋯".
    if (details.reason === "escape-key") {
      const name = CSS.escape(channel);
      const back =
        document.querySelector<HTMLElement>("[data-testid='channel-picker-search']") ??
        document.querySelector<HTMLElement>(`[data-grid-channel="${name}"] [data-pane-return]`) ??
        document.querySelector<HTMLElement>(`[data-single-header="${name}"] [data-pane-return]`);
      requestAnimationFrame(() => back?.focus());
    }
  };
  return (
    <Popover open onOpenChange={close}>
      <PopoverContent anchor={() => emoteStatusAnchor(channel)} align="start" className="w-72 text-xs" data-testid="emote-status">
        <EmoteStatusTable channel={channel} />
      </PopoverContent>
    </Popover>
  );
}

function EmoteStatusTable({ channel }: { channel: string }) {
  const { settings, channelStatus, globalStatus } = useEmoteStatus(channel);
  return (
    <>
      <div className="mb-2 font-semibold">Emotes in #{channel}</div>
      <table className="w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-medium">Provider</th>
            <th className="pb-1 font-medium">Channel</th>
            <th className="pb-1 font-medium">Global</th>
          </tr>
        </thead>
        <tbody>
          {THIRD_PARTY_PROVIDERS.map((p) => {
            const on = isFeatureOn(settings, channel, p);
            return (
              <tr key={p}>
                <td className="py-0.5 pr-2 font-medium">{PROVIDER_LABELS[p]}</td>
                <td className={cn("py-0.5 pr-2", channelStatus?.[p].state === "error" && "text-warn")}>
                  {!on ? "off here" : channelStatus ? statusText(channelStatus[p]) : "waiting"}
                </td>
                <td className={cn("py-0.5", globalStatus[p].state === "error" && "text-warn")}>
                  {!on ? "off here" : statusText(globalStatus[p])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-muted-foreground">Twitch emotes always come straight from chat messages.</p>
      <Button size="xs" variant="outline" className="mt-2 gap-1" onClick={() => chat.reloadEmotes(channel)}>
        <RotateCw className="size-3" /> Reload emotes
      </Button>
    </>
  );
}

/** What a channel's log shows before its first message arrives. */
const ChannelPlaceholder = memo(function ChannelPlaceholder({ login, compact = false }: { login: string; compact?: boolean }) {
  const view = useChat(
    useShallow((s) => {
      const channel = s.channels[login];
      if (!channel) return null;
      return { status: channel.status, error: channel.error };
    }),
  );
  if (!view) return null;
  const size = compact ? "size-10" : "size-16";
  if (view.status === "error") {
    return (
      <div className="max-w-sm space-y-3 text-center">
        <Mascot className={cn("mx-auto opacity-60 grayscale", size)} />
        <p className="font-semibold">Couldn't join #{login}</p>
        <p className="text-sm text-muted-foreground">{view.error}</p>
        <Button variant="outline" size="sm" onClick={() => chat.removeChannel(login)}>
          Remove #{login}
        </Button>
      </div>
    );
  }
  if (view.status === "joining") {
    return (
      <div className="space-y-3 text-center">
        <Mascot anim="scurry" className={cn("mx-auto", size)} />
        <p className="text-sm text-muted-foreground">Joining #{login}…</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-center">
      <Mascot anim="idle" className={cn("mx-auto", size)} />
      <p className="text-sm text-muted-foreground">
        Connected to #{login}. New messages show up here the moment someone talks.
      </p>
    </div>
  );
});

/** Subscribes to the message list only, so headers and composers stay put while chat arrives. */
function ChannelLog({
  login,
  viewKey,
  label,
  liveRows,
  compactEmpty = false,
}: {
  login: string;
  viewKey: string;
  label: string;
  liveRows?: number;
  compactEmpty?: boolean;
}) {
  const messages = useChat((s) => s.channels[login]?.messages);
  const readMarker = useChat((s) => s.channels[login]?.readMarker);
  // A fresh function here would redraw every visible row on each incoming line.
  const onNameClick = useCallback((name: string) => insertIntoComposer(`@${name} `, login), [login]);
  if (!messages) return null;
  return (
    <ChatLog
      messages={messages}
      channel={login}
      viewKey={viewKey}
      label={label}
      liveRows={liveRows}
      readMarker={readMarker}
      empty={<ChannelPlaceholder login={login} compact={compactEmpty} />}
      onNameClick={onNameClick}
    />
  );
}

/** The two header buttons every pane has: "−" empties the pane, "⋯" opens its channel picker. */
function PaneButtons({
  pane,
  name,
  testIds,
  onClear,
}: {
  pane: PaneTarget;
  name: string;
  testIds: { clear: string; pick: string };
  onClear: () => void;
}) {
  const open = useUi((s) => s.pickerPane === pane);
  return (
    // Side by side with no gap between them (the owner's choice), right at the header's edge.
    <span className="-mr-0.5 flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon-xs"
        // Touching buttons: the focused one draws on top, so its focus ring isn't hidden by its neighbour.
        className="relative focus-visible:z-10"
        onClick={onClear}
        aria-label={`Clear this pane (#${name} stays in the channel picker)`}
        title="Clear this pane"
        data-testid={testIds.clear}
      >
        <Minus className="size-3.5" />
      </Button>
      <Button
        variant={open ? "secondary" : "ghost"}
        size="icon-xs"
        className="relative focus-visible:z-10"
        onClick={() => (open ? closePicker() : openPicker(pane))}
        aria-label={`Pick a channel for this pane (now #${name})`}
        aria-expanded={open}
        title="Pick a channel"
        data-testid={testIds.pick}
        data-pane-return={String(pane)}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
    </span>
  );
}

/** An empty pane: one button that opens its channel picker (or the picker itself while it's open). */
function EmptyPaneBody({ pane, testId, hint }: { pane: PaneTarget; testId: string; hint?: string }) {
  const open = useUi((s) => s.pickerPane === pane);
  const first = useChat((s) => s.settings.channels.length === 0 && Object.keys(s.follows).length === 0);
  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background" data-pane-index={String(pane)}>
      {open ? (
        <ChannelPicker pane={pane} label="Pick a channel for this empty pane" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto p-4 text-center">
          {/* The theme's animal stays on empty screens (still, no animation: a 9-pane view can have many). */}
          <Mascot className="size-10 opacity-80" />
          <Button variant="outline" size="sm" onClick={() => openPicker(pane)} data-testid={testId} data-pane-return={String(pane)}>
            Pick a channel
          </Button>
          {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
          {first ? (
            <ul className="grid gap-1.5 pt-1 text-left text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <Link2 className="size-3.5 shrink-0 text-accent-text" /> In the picker, paste a twitch.tv link, #channel, or just the name.
              </li>
              <li className="flex items-center gap-2">
                <UserRoundX className="size-3.5 shrink-0 text-accent-text" /> No login needed to read. Log in only to chat.
              </li>
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Header of the single view (view 1): the channel, its join status and emote status, then "−" and "⋯". */
function SingleHeader({ login }: { login: string }) {
  const view = useChat(
    useShallow((s) => {
      const channel = s.channels[login];
      return channel ? { displayName: channel.displayName, status: channel.status } : null;
    }),
  );
  const viewers = useChat((s) => (s.live === null ? null : s.live[login]));
  if (!view) return null;
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger
        render={
          <div
            className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-accent-2 bg-surface pr-1 pl-3"
            data-testid="single-header"
            data-single-header={login}
            title={`#${view.displayName ?? login}. Right-click: more`}
          />
        }
      >
        <ChannelAvatar login={login} className="size-6" />
        <h2 className="truncate text-sm font-semibold">#{view.displayName ?? login}</h2>
        <span className="truncate text-xs text-muted-foreground" data-testid="single-status">
          {view.status === "joining"
            ? "Joining…"
            : view.status === "error"
              ? "Couldn't join"
              : viewers === null
                ? "Connected"
                : liveLabel(viewers)}
        </span>
        <span className="flex-1" />
        <EmoteStatusNote channel={login} />
        <PaneButtons
          pane="single"
          name={view.displayName ?? login}
          testIds={{ clear: "single-clear", pick: "single-pick" }}
          onClear={() => chat.clearSingle()}
        />
      </ContextMenuPrimitive.Trigger>
      <ChannelMenuPopup login={login} joined />
    </ContextMenuPrimitive.Root>
  );
}

export function FocusedView({ login }: { login: string }) {
  const exists = useChat((s) => s.channels[login] != null);
  const picking = useUi((s) => s.pickerPane === "single");
  if (!exists) return null;
  return (
    <>
      <SingleHeader login={login} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChannelLog login={login} viewKey={`focused:${login}`} label="Chat messages" />
        {picking ? <ChannelPicker pane="single" label={`Pick a channel instead of #${login}`} /> : null}
      </div>
    </>
  );
}

/** View 1 after "−": an empty pane until a channel is picked. */
export function EmptySingleView() {
  return <EmptyPaneBody pane="single" testId="pane-empty-single" />;
}

function RoomIcons({ login }: { login: string }) {
  const room = useChat((s) => s.channels[login]?.roomState);
  if (!room) return null;
  const icons: { icon: typeof Clock; label: string }[] = [];
  if (room.emoteOnly) icons.push({ icon: Smile, label: "Emote-only chat" });
  if (room.subsOnly) icons.push({ icon: Lock, label: "Subscribers-only chat" });
  if (room.followersOnly !== undefined && room.followersOnly >= 0) {
    icons.push({ icon: Users, label: room.followersOnly === 0 ? "Followers-only chat" : `Followers-only (${room.followersOnly}m+)` });
  }
  if (room.slow) icons.push({ icon: Clock, label: `Slow mode: ${room.slow}s` });
  return (
    <>
      {icons.map(({ icon: Icon, label }) => (
        <span key={label} title={label} role="img" aria-label={label} className="text-muted-foreground">
          <Icon className="size-3" />
        </span>
      ))}
    </>
  );
}

/**
 * Clicking or tabbing into a pane makes it the focused one, and also the one "under the pointer" that Ctrl+G,
 * Alt+Shift+arrows and Ctrl+K's grid slot use, so keyboard and mouse agree.
 */
function activate(login: string): void {
  chat.setActivePane(login);
  if (useUi.getState().hoveredChannel !== login) useUi.setState({ hoveredChannel: login });
}

/** One channel's chat inside the grid: a slim header (drag to swap, double-click for Single, "−" and "⋯") and its log. The one shared message box at the bottom sends to the focused pane. */
function ChatBox({ login, index }: { login: string; index: number }) {
  const view = useChat(
    useShallow((s) => {
      const channel = s.channels[login];
      if (!channel) return null;
      return { status: channel.status, error: channel.error, displayName: channel.displayName };
    }),
  );
  const active = useChat((s) => s.settings.focused === login);
  const dropTarget = useUi((s) => s.dropTarget);
  const picking = useUi((s) => s.pickerPane === index);
  const viewers = useChat((s) => (s.live === null ? null : s.live[login]));
  if (!view) return null;

  const name = view.displayName ?? login;
  // Joined: "N watching" / "offline" once live status is known (logged in); otherwise the join state.
  const status =
    view.status === "joining" ? "joining…" : view.status === "error" ? "couldn't join" : viewers === null ? null : liveLabel(viewers);

  return (
    <section
      aria-label={`#${name} chat${active ? " (focused)" : ""}${view.status === "error" ? `, couldn't join: ${view.error ?? "error"}` : ""}`}
      data-grid-channel={login}
      data-pane-index={index}
      data-active={active || undefined}
      onPointerEnter={() => useUi.setState({ hoveredChannel: login })}
      // Clicking anywhere in a pane makes it the focused one (the message box sends there).
      onPointerDownCapture={() => activate(login)}
      onFocusCapture={() => activate(login)}
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col bg-background",
        // Drop target: an overlay ring drawn on top of the header, log and box (an inset shadow would sit under them).
        dropTarget === login &&
          "after:pointer-events-none after:absolute after:inset-0 after:z-20 after:shadow-[inset_0_0_0_2px_var(--primary)] after:content-['']",
      )}
    >
      <ContextMenuPrimitive.Root>
        <ContextMenuPrimitive.Trigger
          render={
            <header
              className={cn(
                "flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-surface pr-1 pl-3 active:cursor-grabbing",
                // The focused pane: teal underline (and a word for screen readers in the section name).
                active ? "border-b-2 border-accent-2" : "border-border",
              )}
              data-testid={`grid-header-${login}`}
              onPointerDown={(event) => beginChannelDrag(event, login, "box")}
              onMouseDown={(event) => beginChannelDrag(event, login, "box")}
              onDoubleClick={(event) => {
                if (event.target instanceof Element && event.target.closest("button")) return;
                chat.focus(login);
              }}
              title={`#${name}. Drag to swap. Double-click to open alone. Right-click: more.`}
            />
          }
        >
          <h2 className="min-w-0 truncate text-[13px] font-semibold">#{name}</h2>
          {status ? (
            <span
              className={cn("shrink-0 text-xs", view.status === "error" ? "text-danger-text" : "text-muted-foreground")}
              title={view.error}
              data-testid={`grid-status-${login}`}
            >
              {status}
            </span>
          ) : null}
          <RoomIcons login={login} />
          <span className="flex-1" />
          <EmoteStatusNote channel={login} compact />
          <PaneButtons
            pane={index}
            name={name}
            testIds={{ clear: `pane-clear-${index}`, pick: `pane-pick-${index}` }}
            onClear={() => chat.hideFromGrid(login)}
          />
        </ContextMenuPrimitive.Trigger>
        <ChannelMenuPopup login={login} joined />
      </ContextMenuPrimitive.Root>
      {/* h-full chain matters: without a definite height the absolute ChatLog collapses to 0 (composer-only pane). */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-testid={`grid-log-${login}`}>
        <ChannelLog
          login={login}
          viewKey={`box:${login}`}
          label={`#${login} messages`}
          liveRows={120}
          compactEmpty
        />
        {picking ? <ChannelPicker pane={index} label={`Pick a channel for this pane instead of #${name}`} /> : null}
      </div>
    </section>
  );
}

/** A pane with no channel: emptied with "−", or a view with more panes than channels. */
function EmptyPane({ index }: { index: number }) {
  const parked = useChat((s) => s.settings.gridParked.length);
  return (
    <EmptyPaneBody
      pane={index}
      testId={`pane-empty-${index}`}
      hint={
        parked > 0
          ? `${parked} channel${parked === 1 ? "" : "s"} set aside from a bigger view: pick that view again at the bottom left to bring ${parked === 1 ? "it" : "them"} back.`
          : undefined
      }
    />
  );
}

/** The grid views (2, 3, 4, 6, 9 panes): pinned channels in a fixed packing, empty panes after them. */
export function GridView() {
  const panes = useChat((s) => s.settings.gridChannels);
  const view = useChat((s) => viewForSlots(s.settings.gridSlots));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 1200, height: 800 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = el.clientWidth - 2 * GRID_EDGE;
        const height = el.clientHeight - 2 * GRID_EDGE;
        setArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const layout = layoutViewGrid(view, area.width, area.height);
  // Panes keep their place: "" is a pane emptied with "−".
  const shown = panes.slice(0, view);
  const empty = Math.max(0, view - shown.length);

  return (
    <div
      ref={scrollRef}
      data-testid="grid-canvas"
      className="zoo-scroll min-h-0 flex-1 overflow-y-auto bg-gap"
      style={{ padding: GRID_EDGE }}
    >
      {layout.columns < viewColumns(view) ? (
        <p className="bg-background px-2 py-1 text-[11px] text-muted-foreground">
          This window is narrow, so the panes are stacked in fewer columns. Pick 1 at the bottom left (or Ctrl+G) to read one alone.
        </p>
      ) : null}
      <div
        className="grid w-full justify-items-stretch"
        style={{
          gap: GRID_GAP,
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridAutoRows: `${layout.cellHeight}px`,
        }}
        data-testid="chat-grid"
        data-grid-cols={layout.columns}
        data-view={view}
      >
        {shown.map((login, i) =>
          login ? (
            // One pane that can't be drawn leaves the others alone.
            <ErrorBoundary key={login} message={`#${login} can't be shown right now.`} onClear={() => chat.hideFromGrid(login)} clearLabel="Clear this pane">
              <ChatBox login={login} index={i} />
            </ErrorBoundary>
          ) : (
            <EmptyPane key={`empty-${i}`} index={i} />
          ),
        )}
        {Array.from({ length: empty }, (_, i) => (
          <EmptyPane key={`empty-${shown.length + i}`} index={shown.length + i} />
        ))}
      </div>
    </div>
  );
}

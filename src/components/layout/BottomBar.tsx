import { Settings } from "lucide-react";
import { Composer, LoginPrompt } from "@/components/chat/Composer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat";
import { openSettings, useUi } from "@/store/ui";
import { ConnectionDot } from "./ChatHeader";
import { ViewSwitch } from "./ViewSwitch";

/** Bottom-right corner: the Settings gear (opens the same in-window Settings panel as the tray's Settings…). */
function SettingsGear() {
  const settingsOpen = useUi((s) => s.settingsOpen);
  return (
    <Button
      variant={settingsOpen ? "default" : "ghost"}
      size="icon-sm"
      className={cn("size-8 shrink-0 border", settingsOpen ? "border-primary" : "border-border")}
      onClick={() => (settingsOpen ? useUi.setState({ settingsOpen: false }) : void openSettings())}
      aria-label="Settings"
      aria-expanded={settingsOpen}
      data-testid="settings-gear"
      title="Settings (also in the tray menu)"
    >
      <Settings className="size-4" />
    </Button>
  );
}

/**
 * The one bar under the panes: the 1 · 2 · 3 · 4 · 6 · 9 view switch on the left, the message box in the middle (it
 * sends to the focused pane, or the channel in view 1, with the "You switched channels" check as before), connection
 * dot and gear on the right (the owner's choice: views left, gear right).
 */
export function BottomBar({ channel }: { channel: string | null }) {
  const readOnly = useChat((s) => s.settings.readOnly);
  const emptySingle = useChat((s) => s.settings.mode === "focused" && !s.settings.focused);
  const loggedIn = useChat((s) => s.auth.status === "logged_in");
  const anyChannel = useChat((s) => s.settings.channels.length > 0);

  let middle;
  if (readOnly) {
    middle = (
      <p className="min-w-0 flex-1 truncate text-center text-xs leading-8 text-muted-foreground" data-testid="bottom-bar-read-only">
        Read only: the message box is hidden. Ctrl+Shift+R shows it again.
      </p>
    );
  } else if (channel) {
    // Not `key`ed by channel: the box keeps its focus and drafts itself when the channel changes.
    middle = (
      <ErrorBoundary message="The message box can't be shown right now." compact resetKey={channel}>
        <Composer channel={channel} />
      </ErrorBoundary>
    );
  } else if (anyChannel && !loggedIn) {
    middle = <LoginPrompt />;
  } else {
    middle = (
      <p className="min-w-0 flex-1 truncate text-center text-xs leading-8 text-muted-foreground" data-testid="bottom-bar-hint">
        {anyChannel && !emptySingle ? "Click a pane to chat in it." : "Pick a channel in a pane to start reading."}
      </p>
    );
  }

  return (
    // Narrow windows: the message box gets a row of its own above the view switch and gear, so there's room to type.
    <div
      className="flex shrink-0 flex-wrap items-end gap-1.5 border-t border-border bg-surface p-1.5 sm:flex-nowrap"
      data-testid="bottom-bar"
    >
      <div className="flex min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto" data-testid="bottom-bar-middle">
        {middle}
      </div>
      <div className="shrink-0 sm:order-1" data-testid="bottom-bar-left">
        <ViewSwitch />
      </div>
      <div className="ml-auto flex shrink-0 items-center sm:order-3 sm:ml-0" data-testid="bottom-bar-right">
        <ConnectionDot />
        <SettingsGear />
      </div>
    </div>
  );
}

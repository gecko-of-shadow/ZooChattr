import { useEffect } from "react";
import { PanelBottomOpen } from "lucide-react";
import { LoginDialog } from "@/components/dialogs/LoginDialog";
import { QuitConfirmDialog } from "@/components/dialogs/QuitConfirmDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { Mascot } from "@/components/mascots/Mascot";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BottomBar } from "@/components/layout/BottomBar";
import { ConnectionBanner } from "@/components/layout/ChatHeader";
import { QuickSwitcher } from "@/components/layout/QuickSwitcher";
import { ViewHotkeys } from "@/components/layout/ViewHotkeys";
import { EmoteStatusPopover, EmptySingleView, FocusedView, GridView } from "@/components/layout/Views";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { chat } from "@/lib/chat/controller";
import { setTrayStatus } from "@/lib/platform";
import { applySkinToDocument } from "@/lib/themes";
import { useRememberThemeForBoot, useResolvedSkin, useTheme } from "@/lib/useTheme";
import { installUpdate } from "@/lib/updates";
import { useChat } from "@/store/chat";
import { closePicker, openSettings, useUi } from "@/store/ui";

function BootScreen() {
  const waking = useTheme().waking;
  return (
    <div className="zoo-texture flex h-full flex-col items-center justify-center gap-4">
      <Mascot anim="scurry" className="size-20" />
      <p className="text-sm text-muted-foreground">{waking}</p>
    </div>
  );
}

/** Floating controls while the bottom bar is hidden (Ctrl+Shift+H). */
function ChromeReveal() {
  const readOnly = useChat((s) => s.settings.readOnly);
  return (
    <div className="absolute bottom-2 left-2 z-30 flex items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="gap-1.5 shadow-lg"
        data-testid="show-chrome"
        onClick={() => chat.updateSettings({ chromeHidden: false })}
        title="Show the bottom bar (Ctrl+Shift+H)"
      >
        <PanelBottomOpen className="size-3.5" />
        Show UI
      </Button>
      <Button
        type="button"
        size="sm"
        variant={readOnly ? "default" : "secondary"}
        className="gap-1.5 shadow-lg"
        data-testid="read-only-toggle"
        aria-pressed={readOnly}
        onClick={() => chat.updateSettings({ readOnly: !readOnly })}
        title={readOnly ? "Read only on — click to show the message box again (Ctrl+Shift+R)" : "Read only — hide the message box (Ctrl+Shift+R)"}
      >
        {readOnly ? "Reading" : "Read only"}
      </Button>
    </div>
  );
}

function LiveRegion() {
  const message = useUi((s) => s.liveMessage);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

export default function App() {
  const ready = useChat((s) => s.ready);
  const skin = useResolvedSkin();
  const mode = useChat((s) => s.settings.mode);
  const focused = useChat((s) => s.settings.focused);
  const gridSlots = useChat((s) => s.settings.gridSlots);
  const chromeHidden = useChat((s) => s.settings.chromeHidden);
  const mentions = useChat((s) => Object.values(s.channels).reduce((sum, c) => sum + c.mentions, 0));
  // One shared message box: Single sends to its channel, the grid to the focused pane (only while it's on screen).
  const composerChannel = useChat((s) =>
    s.settings.mode === "focused"
      ? s.settings.focused
      : s.settings.focused && s.settings.gridChannels.includes(s.settings.focused)
        ? s.settings.focused
        : null,
  );

  useEffect(() => {
    void chat.boot();
  }, []);

  // A pane's channel picker belongs to the view it was opened in.
  useEffect(() => closePicker(false), [mode, gridSlots]);

  // Until the saved settings are loaded the store holds defaults; keep the theme theme-boot.js already put on the page.
  useEffect(() => {
    if (!ready) return;
    applySkinToDocument(skin);
  }, [ready, skin]);
  useRememberThemeForBoot();

  useEffect(() => {
    document.title = mentions > 0 ? `(${mentions}) ZooChattr` : "ZooChattr";
    void setTrayStatus(mentions).catch(() => undefined);
  }, [mentions]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlistens: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      unlistens.push(
        await listen("login-requested", () => {
          useUi.setState({ loginOpen: true, navOpen: false });
        }),
      );
      unlistens.push(
        await listen("settings-changed", () => {
          void chat.pullSettingsFromDisk();
        }),
      );
      unlistens.push(
        await listen("session-changed", () => {
          void chat.pullSessionFromDisk();
        }),
      );
      // Settings Install button — apply_update is main-only.
      unlistens.push(
        await listen<{ downloadUrl?: string }>("install-update-requested", (event) => {
          const downloadUrl = event.payload?.downloadUrl;
          if (!downloadUrl) return;
          installUpdate(downloadUrl);
        }),
      );
      // Tray "Settings…" — Rust shows the main window, we open the Settings panel in it.
      unlistens.push(
        await listen("open-settings", () => {
          void openSettings();
        }),
      );
      // Tray "Check for updates…" — toast only; never opens Settings.
      unlistens.push(
        await listen("tray-update-check", () => {
          void chat.checkForUpdateFromTray();
        }),
      );
    })();
    return () => {
      cancelled = true;
      for (const off of unlistens) off();
    };
  }, []);

  return (
    <>
      {!ready ? (
        <BootScreen />
      ) : (
        <div className="relative flex h-full">
          <main className="relative flex min-w-0 flex-1 flex-col">
            {/* Nothing above the panes. Settings opens as a panel over the right part of the chats, above the bottom bar. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Settings and the bottom bar stay outside: they must still work when a chat can't be drawn. */}
              <ErrorBoundary
                message="This chat can't be shown right now."
                resetKey={`${mode}:${focused}`}
                onClear={mode === "grid" ? undefined : () => chat.clearSingle()}
                clearLabel="Clear this pane"
              >
                {mode === "grid" ? (
                  <GridView />
                ) : focused ? (
                  <FocusedView key={focused} login={focused} />
                ) : (
                  <EmptySingleView />
                )}
              </ErrorBoundary>
              <SettingsDialog />
              {chromeHidden ? <ChromeReveal /> : null}
            </div>
            {chromeHidden ? null : <ConnectionBanner />}
            {chromeHidden ? null : <BottomBar channel={composerChannel} />}
          </main>
          <LoginDialog />
          <QuitConfirmDialog />
          <QuickSwitcher />
          <ViewHotkeys />
          <EmoteStatusPopover />
          <LiveRegion />
        </div>
      )}
      <Toaster position="top-center" />
    </>
  );
}

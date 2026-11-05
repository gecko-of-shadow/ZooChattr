import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsApp } from "./components/dialogs/SettingsApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isTauri } from "./lib/platform";
import "./index.css";

/** Sync hints from the URL. Label detection (below) is the reliable desktop signal. */
function isSettingsHost(): boolean {
  if (new URLSearchParams(window.location.search).get("window") === "settings") return true;
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "settings";
}

function Root() {
  const [role, setRole] = useState<"loading" | "main" | "settings">(() =>
    isSettingsHost() ? "settings" : isTauri ? "loading" : "main",
  );

  useEffect(() => {
    if (isSettingsHost()) {
      setRole("settings");
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!isTauri) {
        if (!cancelled) setRole("main");
        return;
      }
      // Window label identifies the Settings popout even when the URL has no query/hash
      // (plain index.html — query strings have blanked the WebView2 asset load on Windows).
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      if (cancelled) return;
      setRole(getCurrentWindow().label === "settings" ? "settings" : "main");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (role === "loading") {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Starting…</div>;
  }
  return role === "settings" ? <SettingsApp /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary message="ZooChattr hit a problem and couldn't draw this window." onRetry={() => window.location.reload()} retryLabel="Reload">
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);

# ZooChattr

<img src="src-tauri/icons/128x128.png" width="72" height="72" alt="ZooChattr icon">

A portable Windows 11 desktop app for reading several Twitch chats at once, in an old-school multi-channel IRC style.

## What it does

- Shows many Twitch chats in one window, in a layout of 1, 2, 3, 4, 6 or 9 panes. Each pane has its own channel picker (your Twitch follows and channels you added).
- Reads chat without a login. Log in with Twitch's device login to send messages.
- Shows Twitch, 7TV, BetterTTV and FrankerFaceZ emotes inline, with an emote menu, favourites and Tab completion.
- Has its own spell checker (English US, works offline), mention highlights, an optional mention sound and 13 theme choices.
- Runs in the system tray, keeps about 48 hours of chat history per channel, and updates itself from this repository's GitHub releases.

ZooChattr has no backend of its own. It uses Twitch's official IRC WebSocket and Helix API, and the public 7TV, BetterTTV and FrankerFaceZ APIs. Optionally, it fills in chat you missed from a history server.

## Status

- Current version: **0.7.6** (`package.json`, `src-tauri/Cargo.toml`).
- Latest release: [v0.7.6](https://github.com/gecko-of-shadow/ZooChattr/releases/tag/v0.7.6), 2026-11-15. All releases: [Releases](https://github.com/gecko-of-shadow/ZooChattr/releases). Changes: [CHANGELOG.md](CHANGELOG.md).

## Download and install

1. Download `ZooChattr-portable-<version>.zip` from the [latest release](https://github.com/gecko-of-shadow/ZooChattr/releases/latest). Each release also has a `.sha256` file for the zip.
2. Unzip it anywhere and run `ZooChattr.exe`. Nothing is installed.

Requirements: Windows 11 with the Microsoft Edge WebView2 runtime (Windows 11 includes it). The exe is not code-signed, so SmartScreen can show "Windows protected your PC". Click **More info → Run anyway**.

**Data folder.** On first run ZooChattr makes `ZooChattr-data\` next to the exe. It holds `settings.json`, chat history and the WebView cache. If that folder is not writable (for example under Program Files), ZooChattr uses `%APPDATA%\com.geckoofshadow.zoochattr`. Settings shows which folder is in use. Before you give your copy to another person, delete `ZooChattr-data\`.

**Updates.** The app checks GitHub for a newer portable build at start and every few hours (Settings → About & data has a manual check). It installs a download only if it is a release of this repository and its SHA-256 matches the published `.sha256` file. It keeps the old exe as `ZooChattr.exe.bak` until the new exe has run for 30 seconds. To update by hand, unzip a new release over the old folder.

**Login storage.** The Twitch token is never written to the portable folder.

| Platform | Token storage |
| --- | --- |
| Windows | Windows Credential Manager, generic credential `twitch-session.ZooChattr` |
| macOS | Keychain |
| Linux (development only) | Kernel keyring |

**Log out** revokes the token on Twitch and deletes it. ZooChattr asks for the scopes `chat:read`, `chat:edit` and `user:read:follows`. It reads your follows. It cannot follow or unfollow.

## Usage

- **Pick a channel.** Click ⋯ in a pane header to open the picker. Click a row, or type a name, `#name` or twitch.tv link to add a channel. − empties the pane.
- **Layout.** Use the view switch (1 · 2 · 3 · 4 · 6 · 9) in the bottom bar. Drag a pane header onto another pane to swap them. Double-click a header to read that chat alone.
- **Channel menu.** Right-click a pane header or a picker row: Open alone, Emote status, Reload emotes, Open on twitch.tv, Move up/down, Leave.
- **Send.** The message box sends to the focused pane. With "Confirm channel before typing" on (the default), press "Switch to #channel" after you change panes. Enter sends, `/me` works, ↑/↓ recall sent lines. Hover a line and click Reply to answer it.
- **Emotes.** The smiley button opens the emote menu. Type the start of a name and press Tab to complete emotes and names. Right-click an emote to favourite it.
- **Settings.** The gear opens Settings in the window, with a search box and seven sections: Appearance, Chat & mentions, Emotes, Per channel, Window & startup, Account & history, About & data. You can back up settings to a JSON file, restore them and reset them. The backup never holds your Twitch login.
- **Tray.** Closing the window keeps ZooChattr in the system tray. Right-click the tray icon and choose Quit to exit, or turn close-to-tray off in Settings.

Keyboard shortcuts:

| Keys | Action |
| --- | --- |
| Ctrl+G | Switch between one chat and the grid |
| Esc | Back to the grid |
| Ctrl+K | Jump to an open channel |
| Ctrl+1 … Ctrl+9 | Focus a pane |
| Ctrl+Shift+H | Hide or show the bottom bar |
| Ctrl+Shift+R | Read only on or off |

Settings → Window & startup lists every shortcut.

## Build from source

Prerequisites:

- [Node.js](https://nodejs.org/) 20 or newer (the CI workflows use 22).
- [Rust](https://rustup.rs/) (stable).
- On Windows: the "Desktop development with C++" workload from Visual Studio Build Tools. For other platforms, see [Tauri's prerequisites](https://tauri.app/start/prerequisites/).

Run in development:

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run tauri dev
```

`npm run dev` runs only the UI in a browser at http://127.0.0.1:17420.

**Twitch Client ID.** Reading chat needs no setup. Sending needs a public Twitch Client ID:

1. Register an application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps/create).
2. Set **OAuth Redirect URLs** to `http://localhost` (ZooChattr uses device-code login and never redirects, but the form needs a URL) and **Client Type** to **Public**.
3. Put the Client ID in `.env` as `TWITCH_CLIENT_ID=...`. The build includes it. You can also paste a Client ID in Settings → Account & history.

Build the portable exe (on Windows, from the repository root):

```bash
npm install
npm run build:portable
```

This runs `tauri build --no-bundle` and `scripts/package-portable.mjs`. The output is `release/ZooChattr-portable/ZooChattr.exe` and `release/ZooChattr-portable-<version>.zip`.

`npm run build:windows-cross` builds the Windows exe on Linux or macOS with [cargo-xwin](https://github.com/rust-cross/cargo-xwin) (experimental; test the result on Windows).

Tests and checks:

```bash
npm test                    # unit tests (Vitest)
npm run typecheck
cd src-tauri && cargo test
```

`scripts/mock-twitch.mjs` is an offline stand-in for Twitch (login, Helix, emotes, IRC). Run `npm run mock:twitch`, then `npm run dev:mock` (browser UI on http://127.0.0.1:17440) or `npm run tauri:mock`. `npm run e2e:mock` drives the full flow in headless Chrome (`playwright-core`; set `CHROME_PATH` if needed).

**Releases.** Pushing a `v*` tag runs `.github/workflows/release.yml`. It builds the exe on Windows, runs `npm test`, and publishes the zip and its `.sha256` file as a GitHub release with generated notes. Bump the version in `package.json` and `src-tauri/Cargo.toml` first (`tauri.conf.json` reads it from `package.json`); the workflow stops if the tag and the zip name do not match. The repository variable `TWITCH_CLIENT_ID` is required. `HISTORY_SERVER` (address only) is optional.

Environment variables (`.env`; only `.env.example` and `.env.mock` are committed):

| Variable | Purpose |
| --- | --- |
| `TWITCH_CLIENT_ID` | Public Client ID for login. Empty means read-only until one is set in Settings. |
| `VITE_TWITCH_IRC_URL`, `VITE_TWITCH_AUTH_BASE`, `VITE_TWITCH_HELIX_BASE` | Twitch endpoints (defaults: `wss://irc-ws.chat.twitch.tv:443`, `https://id.twitch.tv`, `https://api.twitch.tv/helix`). |
| `VITE_7TV_API`, `VITE_BTTV_API`, `VITE_FFZ_API` | Emote API overrides. |
| `VITE_HISTORY_SERVER` | Built-in history server address (https). Never put the read token here. |
| `ZOOCHATTR_DATA_DIR` | Runtime: forces the data folder. |

## Project layout

```
src/
  lib/irc/       IRC parser and reconnecting WebSocket connection
  lib/twitch/    message mapping, device login, Helix calls
  lib/emotes/    7TV / BTTV / FFZ providers, per-channel registry, cache, search
  lib/chat/      chat controller and tokenizer
  lib/spell/     spell checker
  store/         Zustand stores (chat, settings, UI)
  components/    React UI
src-tauri/       Rust shell: data folder, settings file, credential store, updater
logger/          chat logger (history server)
scripts/         mock Twitch, end-to-end run, soak test, portable packaging
```

## Troubleshooting

- **"Twitch doesn't recognise this Client ID":** check for extra spaces, and set the app's Client Type to **Public**.
- **Login expires at once:** a confidential (non-public) Twitch app cannot refresh without a secret. Switch the app to Public.
- **Emotes missing in one chat:** open Emote status in the channel menu, or Settings → Emotes → Problems.
- **Blank window on a Linux VM (development):** start with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

## License

This repository has no license file.

# ZooChattr

<img src="src-tauri/icons/128x128.png" width="72" height="72" alt="ZooChattr icon">

A portable Windows 11 desktop app for reading several Twitch chats at once, old-school multi-channel IRC style, with a gecko soul. Log in with Twitch to chat back. Twitch, 7TV, BetterTTV and FrankerFaceZ emotes render inline.

Built with Tauri 2, React, TypeScript and Tailwind. No backend of its own: it talks to Twitch chat over the official IRC WebSocket and pulls emotes from the public emote APIs. Current version: **0.7.6**.

## Features

### Layout

- **Many channels, one window.** Follow as many Twitch chats as you want. Connections stay open while the app runs, and drops are recovered automatically with backoff.
- **One bottom bar.** The view switch (1 · 2 · 3 · 4 · 6 · 9) on the left, the message box in the middle, the connection dot and Settings gear on the right. Nothing sits above the chats. On a narrow window the message box gets its own row.
- **Pick how many chats.** The view switch sets the layout: 1 shows one chat; the others lay out 2 side by side, 3 in a row, 2 by 2, 3 by 2 or 3 by 3. Ctrl+G flips between one chat and the grid, Esc goes back to the grid. Drag a pane header onto another to swap them, double-click it to read that chat alone.
- **A channel picker in every pane.** Each pane header has two buttons: − empties the pane (it keeps its place, also after a restart) and ⋯ opens the picker inside the pane. The picker has a search box and two lists: Following (the channels you follow on Twitch, newest follow first) and Added (channels you added by hand). A green dot means the channel is live; a number counts mentions or unread lines. Click a row (or use the arrow keys and Enter) to show it in that pane; Esc or Back closes the picker. Type a name, `#name` or twitch.tv link that isn't listed to add it. Only channels you open are joined in chat, so following 200 channels doesn't open 200 chats. Ctrl+K jumps between open channels.
- **Channel menu.** Right-click a pane header or a picker row (or press the Menu key in the picker) for Open alone, Emote status, Reload emotes, Open on twitch.tv, Move up/down and Leave. Pane headers show "N watching" or "offline", the room modes, and a warning when an emote source failed.
- **More room for chat.** Ctrl+Shift+H hides the bottom bar so the chats fill the window; a floating Show UI button brings it back. Settings → Window & startup lists every keyboard shortcut.

### Chatting

- **Chat as yourself.** Log in with Twitch's device login (type a code at twitch.tv/activate; your password never touches ZooChattr). The message box sends to the chat you're focused on ("Send to #channel"); click a pane or press Ctrl+1 … Ctrl+9 to pick another. Enter sends, `/me` works, and ↑/↓ recall what you sent. The box shows emote-only, followers-only, subs-only and slow mode.
- **Right room.** With "Confirm channel before typing" on (the default), the message box stays locked after you switch chats until you press "Switch to #channel", so a message does not land in the wrong chat.
- **Spell check.** ZooChattr's own spell checker (Edge's stays off) underlines words after you stop typing, skips emotes, names, commands and URLs, and offers suggestions, Add to dictionary and Ignore for this session. English (US) works offline.
- **Just reading.** Ctrl+Shift+R turns Read only on or off (also in Settings → Chat & mentions); it hides the message box so you can't chat by accident.
- **IRC feel.** Dense log with timestamps, badges, name colors (lifted for readability), reply context, sub/raid events, first-time-chatter eggs, moderator deletions, and links that open in your browser. Hover a chat line and use Reply to answer that message; Esc or × clears it. Clicking a name inserts an `@mention`.

### Emotes

- **Emotes everywhere.** Twitch emotes come from chat tags. 7TV, BetterTTV and FrankerFaceZ load global and channel sets for every joined channel, including zero-width overlay emotes, and refresh about once an hour. If a provider is down, its emotes are skipped, the pane header shows a warning, and Emote status (channel menu) says why.
- **Emote menu.** The smiley button next to Send opens a grid of emotes with a search box and tabs for ★ (favourites), Recent, Channel, Global, BTTV and 7TV. The footer names the emote under the pointer and its source. Scrolling loads more, so big packs don't freeze. Right-click any emote to favourite it.
- **Tab completion.** Type the first letters and press Tab; Tab again or the arrow keys cycle the matches (Shift+Tab goes back), or click one in the strip above the box. Emote names that start with what you typed come first, then names that contain it, then people who have spoken in that chat. A word starting with `@` completes people only. Enter while a completion is open accepts it without sending.
- **Size and motion.** Draw emotes at 1×, 1.5× or 2×. Animated emotes can play always, only on hover, or never (still frames from each provider).
- **Switches for everything.** Turn each source on or off, keep or drop overlay emotes, block emotes by name so they stay plain words, and toggle the hover preview.
- **Remember emotes.** Emote lists are cached on this device (channel sets for an hour, global sets for twelve) so pictures show the moment a channel opens, then refresh in the background. One button clears them.
- **Problems list.** When a 7TV, BetterTTV or FrankerFaceZ download fails, Settings → Emotes keeps the last 20 failures; Clear empties the list.

### Reading and notifications

- **Reading comfort.** Chat text size from 10 to 40px (emotes scale with it), extra highlight words that count as mentions like your name does, and deleted messages either kept readable (faded and crossed out) or hidden.
- **Mention sound.** Off by default. A short chime when your name, a reply to you, or a highlight word shows up in any open chat, including ones not on screen. A cooldown of 1 to 120 seconds keeps a busy room quiet. Settings → Chat & mentions has a Play button to preview it.
- **Per channel.** Turn any emote source, the emote menu, Tab completion, preview, highlight words or deleted-message display off for one channel only.
- **Themes.** Settings → Appearance has 13 choices in three groups. Themes: Auto (follows Windows light or dark, with a pick for each), Crested gecko (the default), Dark, Light, Eye comfort and Paper. Animals: Penguin, Sea turtle and Elephant, each with its own mascot, colors and send button (Squawk, Bloop, Trumpet). Accessibility: Deuteranopia, Protanopia, Tritanopia and High contrast. Every theme keeps text at 4.5:1 contrast or better, and the saved theme is applied before the window first paints.

### App and data

- **Lives in the tray.** Closing the window keeps ZooChattr running in the system tray, so chats stay connected; the tray tooltip counts your mentions. Right-click the tray icon and choose Quit to exit (with a confirmation), or turn close-to-tray off in Settings. Opening the exe again brings the running copy back instead of starting a second one. Optional **Start with Windows** (off by default).
- **Settings in the window.** The gear (or tray › Settings…) opens Settings inside the main window, so chat keeps running behind it. A search box finds any option; seven sections: Appearance, Chat & mentions, Emotes, Per channel, Window & startup, Account & history, About & data.
- **Remembers you.** Channels, view, theme, favourites, window position and every preference survive restarts. Back them up to a JSON file, restore that file on another machine, or reset to defaults from Settings → About & data. Your Twitch login is never part of a backup. The window position is written after you finish dragging, not on every pixel. If `settings.json` can't be read, it is moved aside instead of being overwritten.
- **Chat history.** Keeps about 48 hours of messages per channel in `ZooChattr-data/chat` so logs come back after you quit (on by default; toggle in Settings → Account & history). Optionally, chat missed while ZooChattr was closed fills in from a history server; its read token is pasted once in Settings → Account & history.
- **Updates.** Checks GitHub for a newer portable build on launch and every few hours; Settings → About & data has a manual check. Before installing, the app checks that the download is a release of this repository and that its SHA-256 fingerprint matches the `.sha256` file published with it; if not, nothing changes. The old exe is kept as a backup until the new one has run for 30 seconds. Updating keeps your data folder.
- **Portable.** One `.exe`, nothing to install. Settings live in a `ZooChattr-data` folder next to it.

## Download and install

1. Download `ZooChattr-portable-<version>.zip` from the [latest release](https://github.com/gecko-of-shadow/ZooChattr/releases/latest).
2. Unzip it anywhere (a USB stick or Dropbox works) and run `ZooChattr.exe`.

Requirements: Windows 11 (it needs the Microsoft Edge WebView2 runtime, which ships with Windows 11). The exe isn't code-signed, so SmartScreen may say "Windows protected your PC": click **More info → Run anyway**.

On first run ZooChattr creates `ZooChattr-data\` next to the exe, holding `settings.json`, chat history and the WebView cache. If that folder isn't writable (e.g. under Program Files), it falls back to `%APPDATA%\com.geckoofshadow.zoochattr`. Settings shows which location is in use. To update by hand, unzip a new release over the old folder: only the exe is replaced and your channels are kept.

Before giving your copy to someone else, delete `ZooChattr-data\`: it holds your channel list and browser cache. Your Twitch login isn't in it.

### Where the login is stored

| Platform | Token storage |
| --- | --- |
| Windows | Windows Credential Manager, generic credential `twitch-session.ZooChattr` |
| macOS | Keychain |
| Linux (dev only) | Kernel keyring, cleared when you log out of your desktop session |

The token is never written into the portable folder. **Log out** revokes it on Twitch and deletes it. If the credential store refuses to save it, ZooChattr keeps the login for the current session only and tells you. The history server's read token is kept in the same store.

ZooChattr asks for `chat:read` and `chat:edit` (read and send chat) and `user:read:follows` (list the channels you follow, in the channel picker). It only reads your follows; it can't follow or unfollow anyone. If you logged in before the follows permission was added, the picker shows "Sign in again to see follows" until you log in once more. The token is re-validated every hour, as Twitch requires, and refreshed automatically when it expires.

## Build from source

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ (the release workflow uses 22).
- [Rust](https://rustup.rs/) (stable).
- On Windows: the "Desktop development with C++" workload from Visual Studio Build Tools. WebView2 is already part of Windows 11. See [Tauri's prerequisites](https://tauri.app/start/prerequisites/) for other platforms.

### Run in development

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run tauri dev
```

The desktop window opens with hot reload. `npm run dev` runs only the UI in a browser at http://127.0.0.1:17420. That's handy for styling, but logins aren't saved between browser sessions.

### Set up Twitch login (Client ID)

Reading chat works with no setup (anonymous, read-only). Sending needs a Twitch Client ID:

1. Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps/create) and register an application.
2. **Name:** anything unique, e.g. `ZooChattr (yourname)`.
3. **OAuth Redirect URLs:** `http://localhost`. ZooChattr uses Twitch's device-code login and never redirects, but the form requires a URL.
4. **Category:** Chat Bot (or Application Integration).
5. **Client Type:** **Public**. Public clients can use device login and refresh tokens without a client secret, which a desktop app can't keep secret anyway.
6. Copy the **Client ID** into `.env`:

   ```bash
   TWITCH_CLIENT_ID=your_client_id_here
   ```

   It's baked into the build, so people who get your `.exe` can log in without any setup. You can also paste a Client ID at runtime in **Settings → Account & history**, which overrides the built-in one.

### Build the portable .exe

On Windows, from the repo root:

```bash
npm install
npm run build:portable
```

That runs `tauri build --no-bundle` (a release build with the UI embedded in the binary, no installer) and then collects the result:

```
release/
  ZooChattr-portable/
    ZooChattr.exe      ← the whole app (about 5 MB)
    README.txt
  ZooChattr-portable-<version>.zip
```

### Cross-compiling from Linux or macOS (experimental)

Tauri can build the Windows exe without Windows using [cargo-xwin](https://github.com/rust-cross/cargo-xwin). It produces the same portable `ZooChattr.exe`, but test it on a Windows machine before sharing it.

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
# Debian/Ubuntu: sudo apt install clang lld llvm   (needs llvm-rc and lld-link)
npm run build:windows-cross
```

### Publishing a release

Pushing a `v*` tag runs the [Release workflow](.github/workflows/release.yml): it builds the exe on Windows, runs `npm test`, and attaches the zip and its `.sha256` fingerprint to a new GitHub release with generated notes. Older releases are not deleted.

1. Bump the version in `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads it from `package.json`). The workflow fails if the tag and the zip name don't match.
2. Commit, tag and push:

   ```bash
   git tag vX.Y.Z
   git push && git push --tags
   ```

The commit and tag carry your git name and email. To keep your real email out of the public history, set `git config --global user.email` to your GitHub noreply address first (GitHub → Settings → Emails, and turn on **Keep my email addresses private**).

Repository variables (Settings → Secrets and variables → Actions → Variables):

- `TWITCH_CLIENT_ID` (required): the release stops if it is empty. It's public by design, so a variable is fine.
- `HISTORY_SERVER` (optional): the history server's https address, built into the exe. Never add its read token there: anyone could pull it out of the exe.

## Test without a Twitch account

`scripts/mock-twitch.mjs` is an offline stand-in for Twitch. It provides device login (auto-approved), token validate/refresh/revoke, the Helix calls ZooChattr makes, small 7TV / BTTV / FFZ emote sets (with pictures served locally, so the emote menu and Tab completion work offline), and an IRC server that behaves like Twitch where it matters: one command per frame, no echo to the sending connection, `USERSTATE` after sends, `NOTICE` on failures, `CLEARMSG` on demand.

```bash
npm run mock:twitch     # terminal 1
npm run dev:mock        # terminal 2: browser UI on http://127.0.0.1:17440, wired to the mock
npm run e2e:mock        # terminal 3: drives the whole flow in headless Chrome
npm run tauri:mock      # or: the desktop app wired to the mock
```

Other checks:

```bash
npm test                # unit tests (IRC parser, reconnects, emote parsing, tokenizer…)
npm run typecheck
cd src-tauri && cargo test
SOAK_URL=http://127.0.0.1:17420 SOAK_MINUTES=60 SOAK_CHANNELS=xqc,summit1g npm run soak   # live soak, logs to soak/
```

The e2e and soak scripts use `playwright-core` with an installed Chrome. Set `CHROME_PATH` if yours isn't at `/usr/local/bin/google-chrome`.

## Configuration reference

| Variable | Where | Purpose |
| --- | --- | --- |
| `TWITCH_CLIENT_ID` | `.env` | Public Client ID used for login. Empty means read-only mode until one is set in Settings. |
| `VITE_TWITCH_IRC_URL` | `.env` / `.env.mock` | Chat endpoint. Defaults to `wss://irc-ws.chat.twitch.tv:443`. |
| `VITE_TWITCH_AUTH_BASE` | `.env` / `.env.mock` | OAuth endpoint. Defaults to `https://id.twitch.tv`. |
| `VITE_TWITCH_HELIX_BASE` | `.env` / `.env.mock` | Helix API. Defaults to `https://api.twitch.tv/helix`. |
| `VITE_7TV_API`, `VITE_BTTV_API`, `VITE_FFZ_API` | `.env` | Emote API overrides (rarely needed). |
| `VITE_HISTORY_SERVER` | `.env` | Built-in history server address (https). Settings can override it or turn it off. Never put the read token here. |
| `ZOOCHATTR_DATA_DIR` | runtime env | Forces the data folder, e.g. for testing a clean profile. |

Only `.env.example` and `.env.mock` are committed. `.env` is git-ignored.

## How it works

- **Two IRC connections**, the same way Chatterino does it. The *read* connection joins every open channel; it's anonymous (`justinfan…`) when logged out and authenticated when logged in. The *write* connection only sends. Twitch echoes your message back on the read connection with full emote tags, and ZooChattr swaps that echo in for its local "sending…" copy. A `NOTICE` (rate limit, followers-only, etc.) marks the message as not sent and shows the reason.
- **Reconnects:** exponential backoff with jitter (1s → 30s), immediate retry when Windows reports the network is back, honoring Twitch's `RECONNECT`, and a keepalive ping that catches dead sockets after sleep or Wi-Fi changes. JOINs are paced under Twitch's rate limit.
- **Emotes:** `src/lib/emotes/` fetches 7TV (`7tv.io/v3`), BetterTTV (`api.betterttv.net/3/cached`) and FrankerFaceZ (`api.frankerfacez.com/v1`) global sets, and channel sets whenever a channel is joined. Lookup order is channel over global, then 7TV › BTTV › FFZ. The registry applies your switches (sources, block list, overlays) when it builds each channel's lookup, and with "remember emotes" on it serves cached lists from `localStorage` first and refreshes stale ones in the background (`cache.ts`). Still frames use each provider's static URL (`…/1x_static.webp`, `…/static/1x.webp`, FFZ's plain `urls`, Twitch's `/static/`). Twitch's own emotes come from the `emotes` IRC tag, indexed by Unicode code point so emoji don't shift them.
- **Badges:** with a login, Helix provides exact global and channel badges (custom sub badges included). Anonymous mode falls back to Twitch's public images for broadcaster, mod, VIP, sub, Prime and similar.
- **Storage:** the Rust side (`src-tauri/src`) is deliberately small. It provides the portable data folder, atomic `settings.json` writes (a corrupt file is renamed aside, never deleted), the OS credential store via the `keyring` crate, and the self-updater.
- **Rules followed:** official Twitch IRC and Helix plus the documented public emote APIs only. No scraping of twitch.tv.

### From Geckmotes

The emote features were ported from the Geckmotes browser extension and follow the same rules: each feature has its own switch, Tab completion ranks exact-case prefix matches first, then shorter names, then names that merely contain what you typed (50 at most), and favourites are stored as `provider:id` so a renamed emote stays a favourite. Where the code lives:

- `src/lib/emotes/providers.ts`: fetchers plus still-frame URLs. `registry.ts`: per-channel merge with the user's switches. `cache.ts`: the remember-emotes store. `search.ts`: the name index behind Tab and the picker's search.
- `src/components/chat/EmotePicker.tsx` (menu), `Composer.tsx` (Tab completion), `MessageRow.tsx` / `ChatLog.tsx` (sizes, animation, deleted rows, hover preview).
- `src/store/settings.ts`: the settings model, backup format and migration from older files.

## Project layout

```
src/
  lib/irc/          IRC parser + reconnecting WebSocket connection
  lib/twitch/       message mapping, device login, Helix (badges, users, follows, live streams)
  lib/emotes/       7TV / BTTV / FFZ providers and the per-channel registry
  lib/chat/         controller (connections, buffering, sending) + tokenizer
  lib/spell/        spell checker
  store/            Zustand stores: chat state, settings, UI
  components/       chat log, composer, bottom bar and view switch, panes and channel picker, dialogs, gecko art
src-tauri/          Rust shell: data folder, settings file, credential store, updater
logger/             chat logger (history server)
scripts/            mock Twitch, end-to-end run, soak test, portable packaging
```

## Troubleshooting

- **"Windows protected your PC":** the exe isn't code-signed. Click **More info → Run anyway**.
- **"Twitch doesn't recognise this Client ID":** check for extra spaces, and make sure the app's Client Type is **Public**.
- **Login works but expires right away:** confidential (non-public) Twitch apps can't refresh without a secret. Switch the app to Public, or log in again when asked.
- **A channel stays on "Joining…" then errors:** the name is misspelled, or the channel is banned or deleted.
- **Emotes missing in one chat:** open Emote status from the channel menu, or check Settings → Emotes → Problems.
- **Blank window on Linux VMs (development):** start with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.

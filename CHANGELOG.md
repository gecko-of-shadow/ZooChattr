# Changelog

All notable changes to ZooChattr are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are the GitHub release date where a release exists, otherwise the date of the tagged commit (UTC).

GitHub releases exist for v0.7.3 to v0.7.6. Older versions are git tags only; their entries come from the commit messages.

## [Unreleased]

### Changed

- Docs: README restructured and shortened. CHANGELOG lists every tagged version.

## [0.7.6] - 2026-11-15

### Fixed

- The newest chat line is no longer cut off at the bottom of a pane (most visible with large text or emote-only lines). The newest 12 rows are now always laid out at their real height.

## [0.7.5] - 2026-11-09

### Changed

- Dependencies updated within their existing version ranges (Tauri API and CLI, Vite, Vitest, Zustand, lucide-react, React 19.3.1). No feature changes.
- The mock Twitch server can pause and resume its random background chatter (`POST /__quiet` and `/__quiet/off`); the end-to-end mention-sound step uses it, so it no longer fails at random.
- Unit tests run about twice as fast (Vitest `isolate: false`).

## [0.7.4] - 2026-11-06

### Fixed

- Settings: a `settings.json` that can't be read is moved aside and reported, instead of being overwritten with an empty channel list on the next click. A settings file without a channel list is also moved aside. A blocked start no longer removes the Startup shortcut.
- Restore and Reset say so when the change can't be saved, instead of showing a plain success message.
- Restoring a backup with Remember chat history off no longer deletes saved chat logs.
- Updates: a failed update can no longer delete `ZooChattr.exe`. The new exe replaces the old one in one step; the old exe is kept as `ZooChattr.exe.bak` and removed only after the new one has run for 30 seconds. If the new exe fails at once, the old one is put back and restarted. A read-only exe no longer blocks updates.
- A message with an out-of-range time can no longer blank the window, live or from saved history. If a pane, the chat view or the message box fails to draw, a short message shows and Settings stays reachable.
- Spell check: the suggestion menu closes on click-away, Esc, send, pane switch or window focus loss, returns focus to the message box, and a fix can only change the draft the menu was opened on.

## [0.7.3] - 2026-10-29

### Fixed

- The channel picker opens instantly with a long follow list (with 500 follows it used to stall, and again when you cleared the search).
- The newest chat line no longer stays half below a pane's bottom edge after an emote picture finishes loading or after the window comes back from behind other windows.

## [0.7.2] - 2026-10-29

### Changed

- The − and ⋯ buttons in a pane header sit together at the pane's edge, with no gap between them.

## [0.7.1] - 2026-10-29

### Changed

- The bottom bar is slimmer and even: the view switch, message box, emote button, Send, connection dot and Settings gear are all the same height, and the message box fills the space between the view switch and the gear.
- No line of text above "chat in #channel" any more. You still confirm before sending to a new channel; the reason is in the button's tooltip.

## [0.7.0] - 2026-10-29

### Changed

- No more top bar: nothing sits above the chats. One bar at the bottom holds the view switch (1 · 2 · 3 · 4 · 6 · 9) on the left, the message box in the middle and the connection dot and Settings gear on the right. On a narrow window the message box gets its own row.
- Each pane picks its own channel. A pane header has two buttons: − empties the pane (it keeps its place, also after a restart) and ⋯ opens a channel picker inside the pane: search, your Twitch follows under Following, channels you added under Added, live dots and unread counts. Arrow keys and Enter work; Esc or Back closes it.
- Channels are added only in the picker: type a name, `#name` or twitch.tv link and pick "Add". Ctrl+K still jumps between open channels.
- The channel menu (Open alone, Emote status, Reload emotes, Open on twitch.tv, Move up/down, Leave) is on right-click of a pane header or a picker row, or the Menu key in the picker.
- Ctrl+Shift+H hides the bottom bar.
- Remember chat history is on by default.

### Fixed

- After dragging a pane header onto another pane, the next click is no longer ignored.

## [0.6.0] - 2026-10-28

### Added

- Chat missed while ZooChattr was closed fills in from the history server. The address comes with the app; the read token is pasted once in Settings → Account & history.

### Changed

- New look. Channel avatars across the top replace the sidebar, with Twitch follows, live dots and viewer counts. A view switch (1 · 2 · 3 · 4 · 6 · 9) sits next to the gear. Panes are flush with a slim header and an underline on the focused pane.
- One shared message box at the bottom for the focused pane, centered with a max width. A new emote panel sits next to Send.
- Settings open in the window, with search and seven sections.
- 13 theme choices: 12 themes plus Auto, which follows Windows live. The saved theme loads before the first paint.
- New teal gecko icon for the taskbar, window, tray and exe. A small connection dot replaces the Wi-Fi icon.
- The pane menu keeps Open alone, Open on twitch.tv and Hide from grid. Emote status is on the channel's right-click menu in the top strip.
- Emotes (7TV, BTTV, FFZ) refresh about once an hour, so new or renamed emotes show without a restart.
- First-run defaults: Start with Windows off, Close to tray on.
- A release build stops if no Twitch Client ID is built in.

### Fixed

- The newest chat message is no longer cut off when a pane gets shorter.
- The same chat line can no longer show up twice.
- The login tab no longer steals focus.
- Updates install only releases from this repository whose SHA-256 fingerprint matches.

## [0.5.0] - 2026-10-17

### Added

- ZooChattr's own spell checker in the message box (Edge's checker stays off). It underlines after you stop typing, skips emotes, names, commands, URLs, digits and short ALL-CAPS words, and offers suggestions, Add to dictionary and Ignore for this session. The dictionary is English (US), stored for offline use. Spell check, the word list and the language are in Settings and in backups.
- Grid and Single switch from the header or Ctrl+G. Single opens the chat that was hovered or last focused, and the grid order is kept. Double-click a box header to focus it. Esc returns to the grid when no menu or completion is open.
- Ctrl+K finds a followed channel. Enter opens it in Single. Alt+Enter, or Put in grid slot, drops it into the active grid box. Ctrl+1 through Ctrl+9 jump to a slot. Ctrl+Tab and Ctrl+Shift+Tab move between chats in Single. Alt+Shift+Left and Alt+Shift+Right move a box. Shortcuts are in the header tooltips and in Settings.
- Drag a box header onto another box to swap them. Drag a sidebar channel onto a box to replace it, or onto empty grid space to add it. In Single, dragging a sidebar channel switches to that chat. The box menu has Swap with. Changes are announced for screen readers.
- The grid picks columns from the window size, with boxes at least 300 by 260 CSS pixels. Narrow windows stack, very narrow windows suggest Single, portrait windows prefer rows, and ultrawide windows keep a box from stretching past about 900 pixels. The grid can hold up to 9 chats; the setting defaults to 4, so older settings files stay valid.
- Mock Twitch can send about 50 messages a second per channel (`POST /__heavy?rate=50` or `MOCK_HEAVY`). `SOAK_MOCK=1` runs the soak against that mock, and Chrome is found automatically on Windows.

### Changed

- The sidebar collapses below about 900 pixels wide.
- Tailwind, the Tailwind Vite plugin, `tw-animate-css` and the shadcn package are devDependencies. They are used while building the CSS, not inside the running app.
- The `Cargo.toml` version matches `package.json`.
- Publishing a version tag no longer deletes older GitHub releases.

### Fixed

- Enter while a Tab completion is open accepts the match and leaves the trailing space; the message is not sent until the next Enter. This covers emote names and @mentions. Clicking a suggestion accepts it the same way.

### Removed

- Move earlier and Move later in a grid box's menu, replaced by drag, Swap with and Alt+Shift+Arrow.
- Unused interface files `badge.tsx`, `select.tsx`, `separator.tsx`, `toggle.tsx`, `toggle-group.tsx` and `tooltip.tsx`.
- The unused `next-themes` dependency.
- `export` on helpers that were only used in their own file (spell ranking data, grid-slot sanitizers, color hashing, history boundary prefix, fuzzy score and similar).

## [0.4.22] - 2026-10-14

### Added

- Reply to a chat line: hover a message and choose Reply to send a Twitch reply.
- Tab completion also completes names of people who have spoken in that channel.

## [0.4.21] - 2026-10-14

### Fixed

- The message box stays responsive while chat moves. Edge no longer spellchecks the caret on every arrow key, and a new chat line no longer redraws every visible row.

## [0.4.20] - 2026-10-13

### Changed

- Chat history stays in memory and is appended to disk every 30 seconds as JSON Lines, instead of rewriting the whole log about every 2 seconds. Lines older than 48 hours are trimmed once at start. A clean quit writes the buffer.

## [0.4.19] - 2026-10-13

### Changed

- The app icon is a single cream chat bubble with a gecko pupil.

### Removed

- Edge's "Import passwords" item and other browser commands from the right-click menu.

## [0.4.18] - 2026-10-13

### Fixed

- The appearance themes (Dark, Light, Deuteranopia, Protanopia, Tritanopia, Eye comfort) and Read only are back. The 0.4.15 merge had left them out.

## [0.4.17] - 2026-10-13

### Fixed

- A channel off the grid now gains unread lines in grid mode.
- A late Twitch echo no longer misses the saved log or shows next to the failed local copy.
- Each channel keeps its own draft. Settings search looks only at settings on screen. A window on a monitor left of or above the main monitor is restored. The tray focuses Settings instead of the disabled main window.

## [0.4.16] - 2026-10-13

### Changed

- Faster live chat: paused history mounts a window of rows, not the whole buffer; the sidebar, header and message boxes no longer redraw on every line; mention matching is reused; history saves skip a copy when nothing changed.
- The release workflow deletes older GitHub releases after each publish (tags stay). Reverted in 0.5.0.

## [0.4.15] - 2026-10-13

### Added

- Mention sound (off by default): one chime for your name, a reply to you or a highlight word in any joined chat, then a cooldown.
- The window position is saved after a drag ends and restored on launch. Off-screen positions are rejected.

### Changed

- The on-screen log is capped at 400 rows per channel. History trimming is quieter.

### Removed

- Settings backup to the clipboard (file backup stays) and the duplicate hide-sidebar switch.

## [0.4.14] - 2026-10-13

### Added

- Themes Dark, Light, Deuteranopia, Protanopia, Tritanopia and Eye comfort next to the animal themes.
- Read only: hides the message boxes and channel confirms, with a Settings switch and a header control.

## [0.4.13] - 2026-10-13

### Changed

- The Settings window has its own limited permissions and sends changes to the main window at once.

### Removed

- The close button inside the Settings panel (the title-bar close and Esc stay).

## [0.4.12] - 2026-10-13

### Changed

- Four chats fill a 2 by 2 grid. The channel confirm is one button, "chat in #channel".

## [0.4.11] - 2026-10-13

### Changed

- Grid panes also block sending after a channel switch until you confirm the channel.

## [0.4.10] - 2026-10-13

### Fixed

- Grid panes no longer collapse the chat log to zero height.
- Settings always opens a fresh window, so a white page recovers.
- Quit closes Settings and enables the main window, so exit cannot get stuck.

## [0.4.9] - 2026-10-12

### Added

- A search box in Settings.
- Tray "Check for updates…" runs a quiet check and shows the result as a toast.

## [0.4.8] - 2026-10-12

### Changed

- Settings opens in its own window. The main window is disabled until it closes. Esc closes Settings.

## [0.4.7] - 2026-10-12

### Fixed

- Tab-completion pictures and the suggestion list: the list is no longer clipped in the grid, a single match shows, and emote thumbnails load. The emote menu gets the same picture fix.

## [0.4.6] - 2026-10-12

### Changed

- Grid panes stay near square, with less padding at the edges.

## [0.4.5] - 2026-10-12

### Added

- Tray "Check for updates" uses the portable update flow.
- The main window's position, size and maximized state are saved in `ZooChattr-data/window.json`.
- After a channel switch, the message box blocks sending until you confirm the channel.

## [0.4.4] - 2026-10-12

### Added

- Arrow keys move through the Tab-completion list; Esc closes it.

## [0.4.3] - 2026-10-12

### Added

- Follow many channels and pin up to 4 on the grid. Other channels stay in the sidebar.

### Changed

- The Settings header and close button stay in place while the panel scrolls.

## [0.4.2] - 2026-10-12

### Added

- About 48 hours of chat per channel is saved under `ZooChattr-data/chat` and reloaded on launch.
- The app checks GitHub for newer portable builds at start and every few hours. Both are Settings switches.

## [0.4.1] - 2026-10-12

### Changed

- New chat-bubble app and tray icon. The tray menu has Settings. Tab completion uses the vertical emote list.

## [0.4.0] - 2026-10-12

### Added

- In-app updates from GitHub portable builds (the data folder is kept).
- Start with Windows, quit confirmation from the tray, and a control to hide the window chrome in the grid.

### Fixed

- The emote picker no longer freezes on big 7TV packs.

## [0.3.3] - 2026-10-12

### Fixed

- Pasted twitch.tv links to videos, the directory and other non-channel pages are refused as channel names; `/moderator/<login>` links are accepted.
- Channel emote downloads retry on the next join after a failure.

## [0.3.2] - 2026-10-11

### Added

- Settings → Per channel: turn emote sources, overlays, Tab completion, the emote menu, preview, highlight words or deleted-message display off for one channel.
- Settings → Problems: the last 20 emote download failures, with Clear.

## [0.3.1] - 2026-10-11

### Fixed

- Fixes after review of the Geckmotes port: Tab completion, backup restore (only ZooChattr settings files are accepted), forced emote reloads, damaged cached lists, cache cleanup, the block list for Twitch emotes, highlight words, the text-size box, focus after the emote menu.

### Changed

- The favourites limit is 2000.

## [0.3.0] - 2026-10-11

### Added

- Features ported from the Geckmotes browser extension: per-source emote switches, emote size and animation options, overlay switch, block list, cached emote lists, favourites, emote menu, Tab completion, any text size, highlight words, deleted-message display, and settings backup, restore and reset.

## [0.2.0] - 2026-10-11

### Added

- A grid where each channel has its own box, log and message box (replaces the merged feed).
- Animal themes: Crested gecko, Penguin, Sea turtle and Elephant.
- Close to tray (optional). The tray tooltip counts mentions. A second launch brings the running copy to the front.

### Changed

- Settings and error messages shorten the home folder path.

### Fixed

- On Linux, single-instance is turned on only where its D-Bus transport works.

## [0.1.0] - 2026-10-11

### Added

- First version, first named ChatDeck and renamed to ZooChattr: Tauri 2, React and Tailwind app with a Twitch IRC chat engine, emotes, read markers, mention taskbar flash, portable packaging, a mock Twitch server, unit tests, and end-to-end and soak scripts.
- Release workflow: a `v*` tag builds `ZooChattr.exe` on Windows, runs the tests and attaches the portable zip to a GitHub release. The app version comes from `package.json`.

[Unreleased]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.6...HEAD
[0.7.6]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.22...v0.5.0
[0.4.22]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.21...v0.4.22
[0.4.21]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.20...v0.4.21
[0.4.20]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.19...v0.4.20
[0.4.19]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.18...v0.4.19
[0.4.18]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.17...v0.4.18
[0.4.17]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.16...v0.4.17
[0.4.16]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.15...v0.4.16
[0.4.15]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.14...v0.4.15
[0.4.14]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.13...v0.4.14
[0.4.13]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.12...v0.4.13
[0.4.12]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.11...v0.4.12
[0.4.11]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.10...v0.4.11
[0.4.10]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.9...v0.4.10
[0.4.9]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gecko-of-shadow/ZooChattr/tree/v0.1.0

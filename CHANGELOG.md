# Changelog

All notable changes to ZooChattr are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are the GitHub release date where a release exists, otherwise the date of the version tag (UTC).

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

[0.7.6]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/gecko-of-shadow/ZooChattr/compare/v0.4.22...v0.5.0

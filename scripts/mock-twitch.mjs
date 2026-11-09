// Offline stand-in for Twitch so login + sending can be tested without a real account.
//
//   npm run mock:twitch            (IRC on ws://127.0.0.1:17422, HTTP on http://127.0.0.1:17423)
//   npm run dev:mock               (ZooChattr UI pointed at the mock)
//
// Device login auto-approves after two polls. The IRC side behaves like Twitch where it
// matters to ZooChattr: one command per frame, no echo to the sending connection, USERSTATE
// after a send, NOTICE on failures, RECONNECT/drops on demand. It also stands in for the
// history server (logger/): GET /api/v2/recent-messages/<login> with READ_TOKEN.
import http from "node:http";
import { WebSocketServer } from "ws";

const IRC_PORT = Number(process.env.MOCK_IRC_PORT ?? 17422);
const HTTP_PORT = Number(process.env.MOCK_HTTP_PORT ?? 17423);
const USER = { login: "geckotester", id: "424242", displayName: "GeckoTester" };
const CLIENT_ID = "mock-client-id";
const SCOPES = ["chat:read", "chat:edit", "user:read:follows"];
/** What a new login is granted. POST /__old-scopes makes logins look like they predate user:read:follows. */
let grantScopes = SCOPES;

const tokens = new Map(); // access token -> expiry
const tokenScopes = new Map(); // access or refresh token -> scopes
const refreshTokens = new Set();
let tokenCounter = 0;
let pollsBeforeApproval = 2;

function issueTokens(scopes = grantScopes) {
  tokenCounter++;
  const access = `mock-access-${tokenCounter}`;
  const refresh = `mock-refresh-${tokenCounter}`;
  tokens.set(access, Date.now() + 4 * 3600_000);
  refreshTokens.add(refresh);
  tokenScopes.set(access, scopes);
  tokenScopes.set(refresh, scopes);
  return { access_token: access, refresh_token: refresh, expires_in: 14400, scope: scopes, token_type: "bearer" };
}

/** Channels geckotester follows on mock Twitch (newest last here; Twitch answers newest first). */
const FOLLOWS = [
  { login: "skinkstation", followed_at: "2025-06-01T12:00:00Z" },
  { login: "geckotown", followed_at: "2026-01-02T12:00:00Z" },
  { login: "lizardlounge", followed_at: "2026-03-01T12:00:00Z" },
  { login: "iguanaisland", followed_at: "2026-09-10T12:00:00Z" },
  { login: "chameleoncafe", followed_at: "2026-10-20T12:00:00Z" },
];
// MOCK_FOLLOWS=500 adds that many older follows, to try a long strip (paging, rendering, pictures).
for (let i = 0; i < Number(process.env.MOCK_FOLLOWS ?? 0); i++) {
  FOLLOWS.unshift({ login: `follow${String(i).padStart(3, "0")}`, followed_at: new Date(Date.UTC(2024, 0, 1) - i * 86_400_000).toISOString() });
}
/** login -> viewer count of channels that are live. POST /__live and /__offline change it. */
const live = new Map([
  ["geckotown", 1234],
  ["iguanaisland", 87],
]);

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(new URLSearchParams(data)));
  });
}

const avatar = (login) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="#1f3a22"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="#8fe05a" font-family="sans-serif">${login[0].toUpperCase()}</text></svg>`,
  )}`;

const roomId = (channel) => String(100000 + ([...channel].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 900000));

/** Providers that should answer with 500 until cleared (for the Problems e2e step). */
const failProviders = new Set();

// ------------------------------------------------------------------ History server (the logger/ Worker's read API)

/** Settings → History server: address http://127.0.0.1:17423, this read token. */
const READ_TOKEN = "mock-read-token";
/** channel -> lines "the logger heard", oldest first. Only /__say and /__history lines are kept. */
const recorded = new Map();

function record(channel, id, ts, line) {
  const list = recorded.get(channel) ?? [];
  list.push({ id, ts, line });
  recorded.set(channel, list.slice(-5_000));
}

function recentMessages(res, login, url, bearer) {
  if (bearer !== READ_TOKEN) return json(res, 401, { messages: [], error: "Unauthorized", error_code: "unauthorized" });
  const list = recorded.get(login.toLowerCase());
  if (!list) return json(res, 404, { messages: [], error: "This channel isn't recorded", error_code: "channel_not_joined" });
  const number = (name) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined);
  const after = number("after");
  const before = number("before");
  const limit = Math.max(1, Math.min(800, number("limit") ?? 800));
  const picked = list.filter((entry) => (after === undefined || entry.ts > after) && (before === undefined || entry.ts < before));
  return json(res, 200, { messages: picked.slice(-limit).map((entry) => entry.line), error: null, error_code: null });
}

// ------------------------------------------------------------------ Third-party emotes

const emoteSvg = (name) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 28"><rect width="56" height="28" rx="6" fill="#2b4a2e"/><text x="28" y="18" font-size="9" text-anchor="middle" fill="#c8ffa6" font-family="sans-serif">${name.slice(0, 9)}</text></svg>`;
const emoteBase = (provider, name) => `http://127.0.0.1:${HTTP_PORT}/emote/${encodeURIComponent(name)}/${provider}`;

// Channel sets are keyed by the mock room id of the channel (see roomId()).
const GECKOTOWN = roomId("geckotown");
const SEVEN_TV = {
  global: [
    { id: "7g1", name: "peepoHappy", animated: true },
    { id: "7g2", name: "catJAM", animated: true },
    { id: "7g3", name: "FeelsOkayMan" },
    { id: "7g4", name: "Kappa" },
  ],
  channel: {
    [GECKOTOWN]: [
      { id: "7c1", name: "geckoWave" },
      { id: "7c2", name: "geckoLick", animated: true },
      { id: "7c3", name: "RainbowPls", zeroWidth: true, animated: true },
    ],
  },
};
const BTTV = {
  global: [
    { id: "bg1", code: "KEKW" },
    { id: "bg2", code: "monkaS" },
  ],
  channel: { [GECKOTOWN]: [{ id: "bc1", code: "geckoHype", animated: true, imageType: "gif" }] },
};
const FFZ = {
  global: [
    { id: 1, name: "LilZ" },
    { id: 2, name: "ZreknarF" },
  ],
  channel: { [GECKOTOWN]: [{ id: 3, name: "geckoPog", animated: true }] },
};

const sevenTvEmote = (e) => ({
  id: e.id,
  name: e.name,
  flags: e.zeroWidth ? 1 : 0,
  data: {
    animated: !!e.animated,
    flags: 0,
    host: { url: emoteBase("7tv", e.name), files: [{ name: "1x.webp", width: 56, height: 28, format: "WEBP" }] },
  },
});
const bttvEmote = (e) => ({ id: e.id, code: e.code, imageType: e.imageType ?? "png", animated: !!e.animated, userId: "mock" });
const ffzEmote = (e) => ({
  id: e.id,
  name: e.name,
  width: 56,
  height: 28,
  urls: { 1: `${emoteBase("ffz", e.name)}/1` },
  animated: e.animated ? { 1: `${emoteBase("ffz", e.name)}/1.animated` } : null,
});

// ------------------------------------------------------------------ HTTP: id.twitch.tv + Helix

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Client-Id, Content-Type",
      "access-control-allow-methods": "GET, POST",
    });
    return res.end();
  }

  const bearer = (req.headers.authorization ?? "").replace(/^(OAuth|Bearer)\s+/i, "");
  const tokenValid = tokens.has(bearer) && tokens.get(bearer) > Date.now();

  if (req.method === "GET") {
    let m;
    if (url.pathname.startsWith("/7tv/") && failProviders.has("7tv")) return json(res, 500, { error: "mock 7TV down" });
    if (url.pathname.startsWith("/bttv/") && failProviders.has("bttv")) return json(res, 500, { error: "mock BTTV down" });
    if (url.pathname.startsWith("/ffz/") && failProviders.has("ffz")) return json(res, 500, { error: "mock FFZ down" });
    if (url.pathname.startsWith("/emote/")) {
      // Any path under /emote/<name>/... draws a little badge with the name, whatever the file extension.
      const name = decodeURIComponent(url.pathname.split("/")[2] ?? "?");
      res.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*", "cache-control": "no-store" });
      return res.end(emoteSvg(name));
    }
    if ((m = url.pathname.match(/^\/api\/v2\/recent-messages\/([A-Za-z0-9_]{1,25})$/))) return recentMessages(res, m[1], url, bearer);
    if ((m = url.pathname.match(/^\/7tv\/users\/twitch\/(\d+)$/))) {
      const set = SEVEN_TV.channel[m[1]];
      if (!set) return json(res, 404, { error: "Unknown User" });
      return json(res, 200, { emote_set: { emotes: set.map(sevenTvEmote) } });
    }
    if ((m = url.pathname.match(/^\/bttv\/cached\/users\/twitch\/(\d+)$/))) {
      const set = BTTV.channel[m[1]];
      if (!set) return json(res, 404, { message: "user not found" });
      return json(res, 200, { channelEmotes: set.map(bttvEmote), sharedEmotes: [] });
    }
    if ((m = url.pathname.match(/^\/ffz\/room\/id\/(\d+)$/))) {
      const set = FFZ.channel[m[1]];
      if (!set) return json(res, 404, { error: "Not Found" });
      return json(res, 200, { room: { set: 9 }, sets: { 9: { emoticons: set.map(ffzEmote) } } });
    }
  }

  switch (`${req.method} ${url.pathname}`) {
    case "POST /oauth2/device": {
      const body = await readBody(req);
      if (body.get("client_id") !== CLIENT_ID) return json(res, 400, { status: 400, message: "invalid client" });
      pollsBeforeApproval = 2;
      return json(res, 200, {
        device_code: "mock-device-code",
        user_code: "GECKO123",
        verification_uri: `http://127.0.0.1:${HTTP_PORT}/activate?device-code=GECKO123`,
        expires_in: 1800,
        interval: 1,
      });
    }
    case "POST /oauth2/token": {
      const body = await readBody(req);
      if (body.get("grant_type") === "refresh_token") {
        const refresh = body.get("refresh_token");
        if (!refreshTokens.delete(refresh)) return json(res, 400, { status: 400, message: "Invalid refresh token" });
        // A refreshed token keeps the permissions of the login it came from.
        return json(res, 200, issueTokens(tokenScopes.get(refresh) ?? grantScopes));
      }
      if (pollsBeforeApproval-- > 0) return json(res, 400, { status: 400, message: "authorization_pending" });
      return json(res, 200, issueTokens());
    }
    case "GET /oauth2/validate":
      if (!tokenValid) return json(res, 401, { status: 401, message: "invalid access token" });
      return json(res, 200, {
        client_id: CLIENT_ID,
        login: USER.login,
        user_id: USER.id,
        scopes: tokenScopes.get(bearer) ?? SCOPES,
        expires_in: Math.round((tokens.get(bearer) - Date.now()) / 1000),
      });
    case "POST /oauth2/revoke": {
      const body = await readBody(req);
      tokens.delete(body.get("token"));
      return json(res, 200, {});
    }
    case "GET /activate":
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<h1>Mock Twitch</h1><p>ZooChattr's login will be approved automatically.</p>");
    case "GET /helix/users": {
      if (!tokenValid) return json(res, 401, { status: 401 });
      const logins = url.searchParams.getAll("login").filter((l) => !l.startsWith("nosuch"));
      return json(res, 200, {
        data: logins.map((login) => ({
          id: login === USER.login ? USER.id : roomId(login),
          login,
          display_name: login[0].toUpperCase() + login.slice(1),
          profile_image_url: avatar(login),
        })),
      });
    }
    case "GET /helix/channels/followed": {
      if (!tokenValid) return json(res, 401, { status: 401 });
      if (!(tokenScopes.get(bearer) ?? []).includes("user:read:follows")) {
        return json(res, 401, { error: "Unauthorized", status: 401, message: "Missing scope: user:read:follows" });
      }
      if (url.searchParams.get("user_id") !== USER.id) return json(res, 400, { status: 400, message: "user_id must match the token" });
      // Newest first, paged (first=, after= cursor) like Twitch.
      const all = [...FOLLOWS].reverse();
      const first = Math.min(100, Math.max(1, Number(url.searchParams.get("first") ?? 20)));
      const start = Number(url.searchParams.get("after") ?? 0) || 0;
      const page = all.slice(start, start + first);
      return json(res, 200, {
        total: all.length,
        data: page.map((f) => ({
          broadcaster_id: roomId(f.login),
          broadcaster_login: f.login,
          broadcaster_name: f.login[0].toUpperCase() + f.login.slice(1),
          followed_at: f.followed_at,
        })),
        pagination: start + first < all.length ? { cursor: String(start + first) } : {},
      });
    }
    case "GET /helix/streams": {
      if (!tokenValid) return json(res, 401, { status: 401 });
      const logins = url.searchParams.getAll("user_login").slice(0, 100);
      return json(res, 200, {
        data: logins
          .filter((login) => live.has(login))
          .map((login) => ({
            id: `stream-${login}`,
            user_id: roomId(login),
            user_login: login,
            user_name: login[0].toUpperCase() + login.slice(1),
            type: "live",
            viewer_count: live.get(login),
            started_at: new Date(Date.now() - 3_600_000).toISOString(),
          })),
        pagination: {},
      });
    }
    case "GET /helix/chat/badges/global":
    case "GET /helix/chat/badges": {
      if (!tokenValid) return json(res, 401, { status: 401 });
      const badge = (set, uuid, title) => ({
        set_id: set,
        versions: [
          {
            id: "1",
            title,
            image_url_1x: `https://static-cdn.jtvnw.net/badges/v1/${uuid}/1`,
            image_url_2x: `https://static-cdn.jtvnw.net/badges/v1/${uuid}/2`,
            image_url_4x: `https://static-cdn.jtvnw.net/badges/v1/${uuid}/3`,
          },
        ],
      });
      return json(res, 200, {
        data: url.pathname.endsWith("global")
          ? [badge("moderator", "3267646d-33f0-4b17-b3df-f923a41db1d0", "Moderator"), badge("vip", "b817aba4-fad8-49e2-b88a-7cc744dfa6ec", "VIP")]
          : [],
      });
    }
    // Third-party emotes (7TV, BTTV, FFZ) with pictures served from here, so they render offline.
    case "GET /7tv/emote-sets/global":
      return json(res, 200, { emotes: SEVEN_TV.global.map(sevenTvEmote) });
    case "GET /bttv/cached/emotes/global":
      return json(res, 200, BTTV.global.map(bttvEmote));
    case "GET /ffz/set/global":
      return json(res, 200, { default_sets: [3], sets: { 3: { emoticons: FFZ.global.map(ffzEmote) } } });
    // Test controls
    case "POST /__say": {
      const channel = url.searchParams.get("channel") ?? "";
      const text = url.searchParams.get("text") ?? "";
      const who = chatters[Number(url.searchParams.get("who") ?? 0) % chatters.length];
      const id = `mock-say-${runId}-${++msgCounter}`;
      const ts = Date.now();
      const extra = { id, "tmi-sent-ts": ts };
      const reply = url.searchParams.get("reply");
      if (reply) {
        extra["reply-parent-user-login"] = reply;
        extra["reply-parent-display-name"] = reply;
        extra["reply-parent-msg-body"] = url.searchParams.get("replyText") ?? "earlier";
      }
      const line = privmsgLine(channel, who, text, extra);
      for (const client of clients) if (client.channels.has(channel)) client.send(line);
      // The history server hears it too, like the real logger.
      record(channel, id, ts, line);
      return json(res, 200, { id });
    }
    case "POST /__history": {
      // Lines said "while ZooChattr was closed": only the history server has them.
      const channel = url.searchParams.get("channel") ?? "";
      const text = url.searchParams.get("text") ?? "said while ZooChattr was closed";
      const count = Math.max(1, Number(url.searchParams.get("n") ?? 3));
      const ids = [];
      for (let i = 1; i <= count; i++) {
        const id = `mock-hist-${runId}-${++msgCounter}`;
        const ts = Date.now() - (count - i) * 1_000;
        record(channel, id, ts, privmsgLine(channel, chatters[i % chatters.length], `${text} ${i}`, { id, "tmi-sent-ts": ts }));
        ids.push(id);
      }
      return json(res, 200, { ids });
    }
    case "POST /__delete": {
      const channel = url.searchParams.get("channel") ?? "";
      const id = url.searchParams.get("id") ?? "";
      // The logger drops deleted lines.
      if (recorded.has(channel)) recorded.set(channel, recorded.get(channel).filter((entry) => entry.id !== id));
      for (const client of clients) {
        if (client.channels.has(channel)) client.send(`@login=mock;target-msg-id=${id};tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARMSG #${channel} :deleted`);
      }
      return json(res, 200, { ok: true });
    }
    case "POST /__fail-emotes": {
      const provider = url.searchParams.get("provider");
      if (provider) failProviders.add(provider);
      return json(res, 200, { failing: [...failProviders] });
    }
    case "POST /__unfail-emotes":
      failProviders.clear();
      return json(res, 200, { ok: true });
    case "POST /__drop":
      for (const client of clients) client.socket.terminate();
      return json(res, 200, { dropped: clients.size });
    case "POST /__reconnect":
      for (const client of clients) client.send(":tmi.twitch.tv RECONNECT");
      return json(res, 200, { ok: true });
    case "POST /__expire":
      tokens.clear();
      return json(res, 200, { ok: true });
    case "POST /__live": {
      const channel = url.searchParams.get("channel") ?? "";
      live.set(channel, Math.max(0, Number(url.searchParams.get("viewers") ?? 100)));
      return json(res, 200, { live: Object.fromEntries(live) });
    }
    case "POST /__offline":
      live.delete(url.searchParams.get("channel") ?? "");
      return json(res, 200, { live: Object.fromEntries(live) });
    case "POST /__old-scopes":
      // Next logins look like they predate the follows permission (for the "Log in again" chip).
      grantScopes = ["chat:read", "chat:edit"];
      return json(res, 200, { scopes: grantScopes });
    case "POST /__new-scopes":
      grantScopes = SCOPES;
      return json(res, 200, { scopes: grantScopes });
    case "GET /__sent":
      return json(res, 200, { messages: sentMessages });
    case "POST /__sent/reset":
      sentMessages.length = 0;
      return json(res, 200, { ok: true });
    case "POST /__heavy": {
      heavyRate = Math.max(0, Number(url.searchParams.get("rate") ?? 50));
      return json(res, 200, { rate: heavyRate });
    }
    case "POST /__heavy/off":
      heavyRate = 0;
      return json(res, 200, { rate: 0 });
    // Pause/resume the random ambient chatter so a test can count exact mentions.
    case "POST /__quiet":
      ambientPaused = true;
      return json(res, 200, { ambient: "paused" });
    case "POST /__quiet/off":
      ambientPaused = false;
      return json(res, 200, { ambient: "running" });
    case "POST /__burst": {
      const channel = url.searchParams.get("channel") ?? "";
      const count = Number(url.searchParams.get("n") ?? 50);
      for (const client of clients) {
        if (!client.channels.has(channel)) continue;
        for (let i = 0; i < count; i++) {
          client.send(privmsgLine(channel, chatters[i % chatters.length], `${lines[i % lines.length]} (#${i + 1})`));
        }
      }
      return json(res, 200, { ok: true });
    }
    default:
      return json(res, 404, { status: 404, message: "not found" });
  }
});

// ------------------------------------------------------------------ IRC over WebSocket

const clients = new Set();
const sentMessages = [];
let msgCounter = 0;
/** Message ids must differ between mock runs: the app drops a live line whose id it saved before. */
const runId = Date.now().toString(36);

function tagString(tags) {
  return Object.entries(tags)
    .map(([k, v]) => `${k}=${String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\:").replace(/ /g, "\\s")}`)
    .join(";");
}

function kappaTag(text) {
  const chars = [...text];
  const ranges = [];
  const words = text.split(" ");
  let index = 0;
  for (const word of words) {
    if (word === "Kappa") ranges.push(`${index}-${index + 4}`);
    index += [...word].length + 1;
  }
  return ranges.length && chars.length ? `25:${ranges.join(",")}` : "";
}

function privmsgLine(channel, user, text, extra = {}) {
  const tags = {
    "badge-info": "",
    badges: user.badges ?? "",
    color: user.color ?? "",
    "display-name": user.displayName,
    emotes: kappaTag(text),
    id: `mock-${runId}-${++msgCounter}`,
    "room-id": roomId(channel),
    "tmi-sent-ts": Date.now(),
    "user-id": user.id,
    ...extra,
  };
  return `@${tagString(tags)} :${user.login}!${user.login}@${user.login}.tmi.twitch.tv PRIVMSG #${channel} :${text}`;
}

const wss = new WebSocketServer({ port: IRC_PORT });
wss.on("connection", (socket) => {
  const client = {
    socket,
    nick: null,
    pass: null,
    authed: false,
    channels: new Set(),
    send: (line) => socket.readyState === 1 && socket.send(`${line}\r\n`),
  };
  clients.add(client);
  socket.on("close", () => clients.delete(client));

  socket.on("message", (data) => {
    // Like Twitch: only the first line of a frame counts.
    const line = String(data).split("\r\n")[0];
    const [command, ...rest] = line.split(" ");
    switch (command.toUpperCase()) {
      case "CAP":
        return client.send(":tmi.twitch.tv CAP * ACK :twitch.tv/tags twitch.tv/commands");
      case "PASS":
        client.pass = rest.join(" ");
        return;
      case "NICK": {
        client.nick = rest[0].toLowerCase();
        if (!client.nick.startsWith("justinfan")) {
          const token = (client.pass ?? "").replace(/^oauth:/, "");
          if (!tokens.has(token) || client.nick !== USER.login) {
            client.send(":tmi.twitch.tv NOTICE * :Login authentication failed");
            return socket.close();
          }
          client.authed = true;
        }
        for (const [code, text] of [
          ["001", "Welcome, GLHF!"],
          ["002", "Your host is tmi.twitch.tv"],
          ["376", ">"],
        ]) {
          client.send(`:tmi.twitch.tv ${code} ${client.nick} :${text}`);
        }
        return;
      }
      case "PING":
        return client.send(`:tmi.twitch.tv PONG tmi.twitch.tv :${rest.join(" ").replace(/^:/, "")}`);
      case "JOIN": {
        const channel = rest[0].replace(/^#/, "").toLowerCase();
        if (channel.startsWith("nosuch")) return;
        client.channels.add(channel);
        client.send(`:${client.nick}!${client.nick}@${client.nick}.tmi.twitch.tv JOIN #${channel}`);
        client.send(`@emote-only=0;followers-only=-1;r9k=0;room-id=${roomId(channel)};slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #${channel}`);
        if (client.authed) {
          client.send(`@badge-info=;badges=moderator/1;color=#8FE05A;display-name=${USER.displayName};emote-sets=0;mod=1 :tmi.twitch.tv USERSTATE #${channel}`);
        }
        setTimeout(() => client.send(privmsgLine(channel, chatters[1], `welcome to #${channel}, grab a warm rock`)), 300);
        return;
      }
      case "PART":
        client.channels.delete(rest[0].replace(/^#/, "").toLowerCase());
        return;
      case "PRIVMSG": {
        if (!client.authed) return;
        const channel = rest[0].replace(/^#/, "").toLowerCase();
        const text = line.slice(line.indexOf(" :") + 2);
        sentMessages.push({ channel, text, nick: client.nick });
        if (text.includes("fail-me")) {
          return client.send(`@msg-id=msg_ratelimit :tmi.twitch.tv NOTICE #${channel} :Your message was not sent because you are sending messages too quickly.`);
        }
        client.send(`@badge-info=;badges=moderator/1;color=#8FE05A;display-name=${USER.displayName};mod=1 :tmi.twitch.tv USERSTATE #${channel}`);
        const out = privmsgLine(channel, { ...USER, color: "#8FE05A", badges: "moderator/1" }, text);
        for (const other of clients) if (other !== client && other.channels.has(channel)) other.send(out);
        return;
      }
    }
  });
});

// ------------------------------------------------------------------ ambient chatter

const chatters = [
  { login: "leopard_lou", id: "11", displayName: "Leopard_Lou", color: "#F4C542", badges: "subscriber/0" },
  { login: "tokaytom", id: "12", displayName: "TokayTom", color: "#7CB8FF", badges: "vip/1" },
  { login: "crestedcarl", id: "13", displayName: "CrestedCarl", color: "", badges: "" },
  { login: "username", id: "14", displayName: "Username", color: "#E0A0FF", badges: "" },
];
const lines = [
  "anyone else sticking around for the next round? Kappa",
  "this chat moves faster than a gecko on glass",
  "@geckotester you seeing this?",
  "catJAM catJAM",
  "LUL that was close",
  "gg",
];
const heavyLines = [
  "Kappa Kappa busy chat",
  "geckoWave peepoHappy",
  "KEKW LilZ geckoPog",
  "catJAM this room is flying",
];
/** POST /__quiet stops the random lines below (one of them mentions geckotester); /__quiet/off resumes. */
let ambientPaused = false;
/** Messages per second per joined channel. 0 until POST /__heavy?rate=50 or MOCK_HEAVY. */
let heavyRate = Math.max(0, Number(process.env.MOCK_HEAVY ?? 0));
setInterval(() => {
  if (heavyRate <= 0) return;
  const batch = Math.max(1, Math.round(heavyRate / 10));
  for (const client of clients) {
    for (const channel of client.channels) {
      for (let i = 0; i < batch; i++) {
        const user = chatters[i % chatters.length];
        client.send(privmsgLine(channel, user, `${heavyLines[i % heavyLines.length]} #${msgCounter}`));
      }
    }
  }
}, 100);
setInterval(() => {
  if (ambientPaused) return;
  for (const client of clients) {
    for (const channel of client.channels) {
      if (Math.random() < 0.55) continue;
      const user = chatters[Math.floor(Math.random() * chatters.length)];
      client.send(privmsgLine(channel, user, lines[Math.floor(Math.random() * lines.length)], { "first-msg": Math.random() < 0.05 ? "1" : "0" }));
    }
  }
}, 1500);

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`Mock Twitch ready: IRC ws://127.0.0.1:${IRC_PORT}  HTTP http://127.0.0.1:${HTTP_PORT}  client id ${CLIENT_ID}`);
});

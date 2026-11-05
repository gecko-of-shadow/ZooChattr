import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  Download,
  FolderOpen,
  Hash,
  KeyRound,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  Smile,
  TriangleAlert,
  Type,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Mascot } from "@/components/mascots/Mascot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { chat } from "@/lib/chat/controller";
import { checkHistoryServer, parseHistoryServer, type ServerCheck } from "@/lib/chat/remoteHistory";
import { playMentionChime } from "@/lib/notify";
import { config } from "@/lib/config";
import { problemLog, type EmoteProblem } from "@/lib/emotes/problems";
import { emoteRegistry } from "@/lib/emotes/registry";
import { PROVIDER_LABELS, THIRD_PARTY_PROVIDERS } from "@/lib/emotes/types";
import { historyTokenSaved, isTauri, openExternal, saveHistoryToken } from "@/lib/platform";
import { SETTINGS_SEARCH_CATALOG, settingsSearchHelpers, type SettingsSearchHelpers } from "@/lib/settingsSearch";
import { applyUpdate, fetchLatestRelease, isNewerVersion, updateErrorText, type UpdateInfo } from "@/lib/updates";
import { normalizeChannelName } from "@/lib/twitch/messages";
import { cn } from "@/lib/utils";
import { useChat } from "@/store/chat";
import { ViewSwitch } from "@/components/layout/ViewSwitch";
import { CONCRETE_SKINS, SKIN_ORDER, THEMES, type ConcreteSkin, type Skin } from "@/lib/themes";
import { useTheme } from "@/lib/useTheme";
import {
  CHANNEL_FEATURES,
  SPELL_LANGUAGE_OPTIONS,
  TAB_COMPLETE_HINT,
  TAB_COMPLETE_LABEL,
  MENTION_COOLDOWN_MAX,
  MENTION_COOLDOWN_MIN,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SIZE_PRESETS,
  clampMentionCooldown,
  clampTextSize,
  makeBackup,
  parseWordList,
  readBackup,
  type ChannelFeature,
  type EmoteAnimation,
  type EmoteSize,
  type Settings,
} from "@/store/settings";
import { useUi } from "@/store/ui";

const SettingsSearchContext = createContext<SettingsSearchHelpers>(settingsSearchHelpers(""));

function useSettingsSearch(): SettingsSearchHelpers {
  return useContext(SettingsSearchContext);
}

/** False when one section shows on its own (the section list already names it): its heading is for screen readers only. */
const SectionTitlesContext = createContext(true);

function Section({ icon: Icon, title, children }: { icon: typeof Palette; title: string; children: React.ReactNode }) {
  const { sectionVisible } = useSettingsSearch();
  const showTitle = useContext(SectionTitlesContext);
  if (!sectionVisible(title)) return null;
  return (
    <section className="space-y-2.5" aria-label={title}>
      <h3
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase",
          !showTitle && "sr-only",
        )}
      >
        <Icon className="size-3.5" /> {title}
      </h3>
      {children}
    </section>
  );
}

/** A sub-heading inside a section (as in the mockups). Hidden when search hides every row under it. */
function Group({ section, ids, title, children }: { section: string; ids: string[]; title: string; children: React.ReactNode }) {
  const { rowVisible } = useSettingsSearch();
  if (!ids.some((id) => rowVisible(section, id))) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</h4>
      {children}
    </div>
  );
}

/** Two columns once the settings area is wide enough (container query), one column otherwise. */
function Columns({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-8 gap-y-6 @3xl:grid-cols-2">{children}</div>;
}

/** Hide a settings control when search does not match; never changes its value. */
function Searchable({ section, id, children }: { section: string; id: string; children: React.ReactNode }) {
  const { rowVisible } = useSettingsSearch();
  if (!rowVisible(section, id)) return null;
  return <>{children}</>;
}

type BooleanKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function ToggleRow({ id, label, hint, setting }: { id: string; label: string; hint?: string; setting: BooleanKey }) {
  const value = useChat((s) => s.settings[setting]);
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5">
        <span className="text-sm">{label}</span>
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </Label>
      <Switch id={id} checked={value} onCheckedChange={(checked) => chat.updateSettings({ [setting]: checked })} />
    </div>
  );
}

/** A row of pill buttons where exactly one is chosen. */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <div className="flex rounded-lg border bg-muted/60 p-0.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-6.5 rounded-md px-2.5 text-xs font-medium",
              value === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The same switch as at the bottom left, so the two always agree (1 is Single there too). */
function GridSlotsRow() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-sm">Grid slots</span>
        <span className="text-xs font-normal text-muted-foreground">
          How many chats show at once; 1 is a single chat. The same switch as at the bottom left.
        </span>
      </div>
      <ViewSwitch testIds={false} label="Grid slots (same as the view switch at the bottom left)" />
    </div>
  );
}

function SpellCheckRows() {
  const enabled = useChat((s) => s.settings.spellCheck);
  const language = useChat((s) => s.settings.spellLanguage);
  return (
    <div className="space-y-3">
      <ToggleRow
        id="pref-spell"
        label="Spell check"
        hint="Wavy underlines in the message box. Emotes, names, commands and links are left alone. Edge's checker stays off. When on: language and your dictionary."
        setting="spellCheck"
      />
      {enabled ? (
        <>
          <Choice
            label="Language"
            value={language}
            options={SPELL_LANGUAGE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(value) => chat.updateSettings({ spellLanguage: value })}
          />
          <WordListField
            id="pref-spell-dictionary"
            label="Dictionary"
            hint="Words that should never be underlined. One per line (spaces and commas work too). Add to dictionary from the message box saves here too."
            placeholder={"recieve\nPogChamp"}
            setting="spellDictionary"
          />
        </>
      ) : null}
    </div>
  );
}

function MentionSoundRow() {
  const enabled = useChat((s) => s.settings.mentionSound);
  const cooldown = useChat((s) => s.settings.mentionSoundCooldown);
  const animal = useTheme().animal;
  const [draft, setDraft] = useState(String(cooldown));
  useEffect(() => setDraft(String(cooldown)), [cooldown]);
  const commit = () => {
    const next = clampMentionCooldown(draft);
    setDraft(String(next));
    if (next !== cooldown) chat.updateSettings({ mentionSoundCooldown: next });
  };
  return (
    <div className="space-y-2">
      <ToggleRow
        id="pref-mention-sound"
        label="Mention sound"
        hint="A short chime when your name, a reply to you, or a highlight word shows up in any open chat. When on: cooldown and a Play preview."
        setting="mentionSound"
      />
      {enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="pref-mention-cooldown" className="text-sm font-normal">
            Cooldown
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="pref-mention-cooldown"
              type="number"
              inputMode="numeric"
              min={MENTION_COOLDOWN_MIN}
              max={MENTION_COOLDOWN_MAX}
              step={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
              aria-label="Mention sound cooldown in seconds"
              className="h-7 w-16 text-xs tabular-nums"
            />
            <span className="text-xs text-muted-foreground">sec</span>
            <Button type="button" variant="outline" size="sm" aria-label="Play mention sound" onClick={() => playMentionChime(animal)}>
              Play
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TextSizeRow() {
  const textSize = useChat((s) => s.settings.textSize);
  const [draft, setDraft] = useState(String(textSize));
  // Keep the box in sync when Settings resets/restores text size from elsewhere.
  useEffect(() => setDraft(String(textSize)), [textSize]);
  const commit = () => {
    if (!draft.trim()) {
      setDraft(String(textSize));
      return;
    }
    const next = clampTextSize(draft);
    setDraft(String(next));
    if (next !== textSize) chat.updateSettings({ textSize: next });
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">Text size</span>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border bg-muted/60 p-0.5" role="radiogroup" aria-label="Text size presets">
            {TEXT_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                role="radio"
                aria-checked={textSize === preset.px}
                onClick={() => chat.updateSettings({ textSize: preset.px })}
                className={cn(
                  "h-6.5 rounded-md px-2 text-xs font-medium",
                  textSize === preset.px ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Input
            type="number"
            inputMode="decimal"
            min={TEXT_SIZE_MIN}
            max={TEXT_SIZE_MAX}
            step={0.5}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            aria-label="Text size in pixels"
            className="h-7 w-[4.5rem] text-xs tabular-nums"
          />
          <span className="text-xs text-muted-foreground">px</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Any size from {TEXT_SIZE_MIN} to {TEXT_SIZE_MAX}px. Emotes grow and shrink with the text.
      </p>
    </div>
  );
}

/** A list setting edited as free text; saved when you click away or press Ctrl+Enter. */
function WordListField({
  id,
  label,
  hint,
  placeholder,
  setting,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  setting: "highlightWords" | "blockedEmotes" | "spellDictionary";
}) {
  const saved = useChat((s) => s.settings[setting]);
  const [draft, setDraft] = useState(saved.join("\n"));
  useEffect(() => setDraft(saved.join("\n")), [saved]);
  const commit = () => {
    const next = parseWordList(draft);
    if (next.join("\n") !== saved.join("\n")) chat.updateSettings({ [setting]: next });
    else setDraft(next.join("\n"));
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-xs font-normal text-muted-foreground">{hint}</span>
      </Label>
      <textarea
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder}
        rows={3}
        spellCheck={false}
        className="zoo-scroll w-full resize-y rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring"
      />
    </div>
  );
}

function ClientIdField() {
  const saved = useChat((s) => s.settings.clientId);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = draft.trim() !== saved;
  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        chat.updateSettings({ clientId: draft.trim() });
      }}
    >
      <Label htmlFor="settings-client-id" className="text-sm">
        Twitch Client ID
      </Label>
      <div className="flex gap-2">
        <Input
          id="settings-client-id"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={config.builtInClientId ? "Using the Client ID built into this copy" : "Paste a Client ID to enable login"}
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="outline" disabled={!dirty}>
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {saved
          ? "Custom Client ID in use. Clear the field and save to go back to the built-in one."
          : config.builtInClientId
            ? "This copy of ZooChattr ships with a Client ID, so login works out of the box."
            : "No Client ID is built in. Reading chat works anyway; login needs one."}
      </p>
    </form>
  );
}

type FieldStatus = { error: boolean; text: string };

function describeCheck(check: ServerCheck, channel: string | undefined): FieldStatus {
  if (!check.ok) {
    return {
      error: true,
      text: check.problem === "unauthorized" ? "The history server turned down that token. Paste the READ_TOKEN you gave wrangler." : check.message,
    };
  }
  if (!channel) return { error: false, text: "Connected. Missed chat fills in each time ZooChattr starts." };
  return check.recorded
    ? { error: false, text: `Connected. #${channel} is recorded, so missed chat fills in each time ZooChattr starts.` }
    : { error: false, text: `Connected, but the logger doesn't record #${channel}. The channels it records fill in at startup.` };
}

/** The chat logger's address (settings.json) and read token (credential store; Settings can save it, not read it). */
function HistoryServerField() {
  const typedServer = useChat((s) => s.settings.historyServer);
  const off = useChat((s) => s.settings.historyServerOff);
  const builtIn = parseHistoryServer(config.builtInHistoryServer) ?? "";
  /** What the box shows: off = empty, else the typed address or the one built into this release. */
  const saved = off ? "" : typedServer || builtIn;
  const remember = useChat((s) => s.settings.rememberChatHistory);
  const firstChannel = useChat((s) => s.settings.channels[0]);
  const tokenStore = useChat((s) => s.appInfo?.tokenStore ?? "the credential store");
  const [address, setAddress] = useState(saved);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<FieldStatus | null>(null);
  useEffect(() => setAddress(saved), [saved]);
  useEffect(() => {
    let live = true;
    void historyTokenSaved().then(
      (value) => {
        if (live) setHasToken(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const dirty = !!token.trim() || parseHistoryServer(address) !== saved;

  const save = async () => {
    const server = parseHistoryServer(address);
    if (server === null) {
      setStatus({ error: true, text: "That isn't an https:// address. Paste the one npx wrangler deploy printed." });
      return;
    }
    const typed = token.trim();
    if (server && !typed && !hasToken) {
      setStatus({ error: true, text: "Paste the read token too." });
      return;
    }
    setBusy(true);
    try {
      if (typed) {
        await saveHistoryToken(typed);
        setHasToken(true);
        setToken("");
      }
      setAddress(server);
      // The built-in address is stored as "" so a later release with a new address is followed.
      if (server !== saved) chat.updateSettings({ historyServer: server === builtIn ? "" : server, historyServerOff: !server });
      // With a built-in address the "History server is off." line below already says so.
      if (!server) setStatus(builtIn ? null : { error: false, text: "History server off." });
      // Only a freshly pasted token is tested; a saved one is never shown or sent anywhere but the history server at startup.
      else if (!typed) setStatus({ error: false, text: "Saved. Missed chat fills in each time ZooChattr starts." });
      else setStatus(describeCheck(await checkHistoryServer(server, typed, firstChannel ?? "zoochattr"), firstChannel));
    } catch (err) {
      setStatus({ error: true, text: `Couldn't save the token: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    try {
      await saveHistoryToken("");
      setHasToken(false);
      // The Remove button goes away; keep the keyboard on the token box.
      document.getElementById("pref-history-token")?.focus();
      setStatus({ error: false, text: "Read token removed." });
    } catch (err) {
      setStatus({ error: true, text: `Couldn't remove the token: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Label htmlFor="pref-history-server" className="flex flex-col items-start gap-0.5">
        <span className="text-sm">History server</span>
        <span className="text-xs font-normal text-muted-foreground">
          Your own chat logger. At startup ZooChattr fills in what was said while it was closed.
          {builtIn && !off && !typedServer ? " The address comes with ZooChattr. Clear it and save to turn this off." : null}
        </span>
      </Label>
      <Input
        id="pref-history-server"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="https://zoochattr-logger.you.workers.dev"
        aria-label="History server address"
        className="font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="flex gap-2">
        <Input
          id="pref-history-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={hasToken ? "Saved. Paste a new token to replace it" : "Read token (READ_TOKEN)"}
          aria-label="History server read token"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="outline" disabled={busy || !dirty} data-testid="history-server-save">
          Save
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {hasToken ? `Read token saved in ${tokenStore}.` : `The read token is kept in ${tokenStore}, never in settings or backups.`}
        </span>
        <span className="flex flex-wrap gap-2">
          {builtIn && !address.trim() ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setAddress(builtIn);
                // The button goes away once the box is filled; keep the keyboard on the box.
                document.getElementById("pref-history-server")?.focus();
              }}
            >
              Use the built-in address
            </Button>
          ) : null}
          {hasToken ? (
            <Button type="button" variant="outline" size="xs" onClick={() => void forget()}>
              Remove token
            </Button>
          ) : null}
        </span>
      </div>
      {off && builtIn ? <p className="text-xs text-muted-foreground">History server is off.</p> : null}
      {saved && !remember ? <p className="text-xs text-muted-foreground">Turn on Remember chat history to use it.</p> : null}
      {status ? (
        <p className={cn("text-xs", status.error ? "text-danger-text" : "text-muted-foreground")} data-testid="history-server-status">
          {status.text}
        </p>
      ) : null}
    </form>
  );
}

function EmotesSection() {
  const providers = useChat((s) => s.settings.emoteProviders);
  const emoteSize = useChat((s) => s.settings.emoteSize);
  const animation = useChat((s) => s.settings.emoteAnimation);
  const remember = useChat((s) => s.settings.rememberEmotes);
  const [cacheSize, setCacheSize] = useState(() => emoteRegistry.cacheSize);
  useEffect(() => {
    setCacheSize(emoteRegistry.cacheSize);
    // Lists get remembered as downloads land; the registry announces each one.
    return emoteRegistry.subscribe(() => setCacheSize(emoteRegistry.cacheSize));
  }, [remember]);

  return (
    <Section icon={Smile} title="Emotes">
      <Columns>
      <div className="space-y-6">
      <Group section="Emotes" ids={["sources"]} title="Sources">
        <Searchable section="Emotes" id="sources">
          <div className="space-y-2">
            <span className="text-sm">Emote sources</span>
            <div className="grid grid-cols-3 gap-2">
              {THIRD_PARTY_PROVIDERS.map((provider) => (
                <Label
                  key={provider}
                  htmlFor={`pref-provider-${provider}`}
                  className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                >
                  {PROVIDER_LABELS[provider]}
                  <Switch
                    id={`pref-provider-${provider}`}
                    checked={providers[provider]}
                    onCheckedChange={(checked) =>
                      chat.updateSettings((s) => ({ emoteProviders: { ...s.emoteProviders, [provider]: checked } }))
                    }
                  />
                </Label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Twitch's own emotes always show. Switch a source off and its emotes turn back into plain words.</p>
          </div>
        </Searchable>
      </Group>
      <Group section="Emotes" ids={["size", "anim", "overlays"]} title="Look">
        <Searchable section="Emotes" id="size">
          <Choice<EmoteSize>
            label="Emote size"
            value={emoteSize}
            options={[
              { value: 1, label: "1×" },
              { value: 1.5, label: "1.5×" },
              { value: 2, label: "2×" },
            ]}
            onChange={(value) => chat.updateSettings({ emoteSize: value })}
          />
        </Searchable>
        <Searchable section="Emotes" id="anim">
          <Choice<EmoteAnimation>
            label="Moving emotes"
            value={animation}
            options={[
              { value: "always", label: "Always" },
              { value: "hover", label: "On hover" },
              { value: "never", label: "Never" },
            ]}
            onChange={(value) => chat.updateSettings({ emoteAnimation: value })}
          />
        </Searchable>
        <Searchable section="Emotes" id="overlays">
          <ToggleRow id="pref-overlays" label="Overlay emotes" hint="Zero-width emotes stack on top of the one before them" setting="overlayEmotes" />
        </Searchable>
      </Group>
      </div>
      <div className="space-y-6">
      <Group section="Emotes" ids={["preview", "tab", "picker"]} title="Typing and picker">
        <Searchable section="Emotes" id="preview">
          <ToggleRow id="pref-preview" label="Preview on hover" hint="Point at an emote to see it big with its name and source" setting="emotePreview" />
        </Searchable>
        <Searchable section="Emotes" id="tab">
          <ToggleRow id="pref-tab" label={TAB_COMPLETE_LABEL} hint={TAB_COMPLETE_HINT} setting="tabComplete" />
        </Searchable>
        <Searchable section="Emotes" id="picker">
          <ToggleRow id="pref-picker" label="Emote menu" hint="The smiley button next to Send" setting="emotePicker" />
        </Searchable>
      </Group>
      <Group section="Emotes" ids={["remember", "blocked", "problems"]} title="Saved lists">
        <Searchable section="Emotes" id="remember">
          <div className="space-y-1.5">
            <ToggleRow
              id="pref-remember"
              label="Remember emotes"
              hint="Keep emote lists on this device so pictures show the moment a channel opens"
              setting="rememberEmotes"
            />
            {remember ? (
              <div className="flex items-center justify-between gap-3 pl-0.5 text-xs text-muted-foreground">
                <span>{cacheSize === 0 ? "Nothing remembered yet." : `${cacheSize} emote ${cacheSize === 1 ? "list" : "lists"} remembered.`}</span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={cacheSize === 0}
                  onClick={() => {
                    chat.forgetEmotes();
                    setCacheSize(emoteRegistry.cacheSize);
                    toast("Forgot the remembered emotes", { description: "Fetching fresh lists now." });
                  }}
                >
                  Forget them
                </Button>
              </div>
            ) : null}
          </div>
        </Searchable>
        <Searchable section="Emotes" id="blocked">
          <WordListField
            id="pref-blocked"
            label="Blocked emotes"
            hint="Names that should stay plain text. One per line (spaces and commas work too)."
            placeholder={"KEKW\nmonkaS"}
            setting="blockedEmotes"
          />
        </Searchable>
        <ProblemsRow />
      </Group>
      </div>
      </Columns>
    </Section>
  );
}

function setChannelFeature(channel: string, feature: ChannelFeature, on: boolean): void {
  chat.updateSettings((s) => {
    const current = s.channelOverrides[channel] ?? [];
    const next = on ? current.filter((f) => f !== feature) : current.includes(feature) ? current : [...current, feature];
    return { channelOverrides: { ...s.channelOverrides, [channel]: next } };
  });
}

function ChannelOverridesSection() {
  const overrides = useChat((s) => s.settings.channelOverrides);
  const joined = useChat((s) => s.settings.channels);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const names = Object.keys(overrides).sort();

  const add = (raw: string) => {
    const name = normalizeChannelName(raw);
    if (!name) {
      setError("That doesn't look like a Twitch channel. Use letters, numbers and underscores.");
      return;
    }
    if (!(name in overrides)) {
      chat.updateSettings((s) => ({ channelOverrides: { ...s.channelOverrides, [name]: [] } }));
    }
    setDraft("");
    setError(null);
  };

  return (
    <Section icon={Hash} title="Per channel">
      <Searchable section="Per channel" id="overrides">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Switch features off on one channel only: add the channel, then untick what you don't want there. Everything else keeps your global switches.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add(draft);
            }}
          >
            <Input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              placeholder="Channel name, for example xqc"
              aria-label="Channel for feature overrides"
              className="text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="outline" size="sm">
              Add
            </Button>
          </form>
          {error ? <p className="text-xs text-danger-text">{error}</p> : null}
          {joined.some((channel) => !names.includes(channel)) ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Quick add:</span>
              {joined.filter((channel) => !names.includes(channel)).map((channel) => (
                <Button key={channel} type="button" variant="outline" size="xs" onClick={() => add(channel)}>
                  #{channel}
                </Button>
              ))}
            </div>
          ) : null}
          {names.length === 0 ? (
            <p className="text-xs text-muted-foreground">No per-channel overrides yet.</p>
          ) : (
            <div className="space-y-3">
              {names.map((channel) => {
                const off = new Set(overrides[channel] ?? []);
                return (
                  <div key={channel} className="space-y-2 rounded-xl border px-3 py-2.5" data-testid={`channel-override-${channel}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">#{channel}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        onClick={() =>
                          chat.updateSettings((s) => {
                            const channelOverrides = { ...s.channelOverrides };
                            delete channelOverrides[channel];
                            return { channelOverrides };
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {CHANNEL_FEATURES.map((feature) => (
                        <Label
                          key={feature.id}
                          htmlFor={`override-${channel}-${feature.id}`}
                          className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-xs"
                        >
                          {feature.label}
                          <Switch
                            id={`override-${channel}-${feature.id}`}
                            checked={!off.has(feature.id)}
                            onCheckedChange={(checked) => setChannelFeature(channel, feature.id, checked)}
                          />
                        </Label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Searchable>
    </Section>
  );
}

/** The emote download problem log, as a row at the end of Emotes. */
function ProblemsRow() {
  const [problems, setProblems] = useState<EmoteProblem[]>(() => problemLog.list());
  useEffect(() => problemLog.subscribe(() => setProblems(problemLog.list())), []);

  return (
      <Searchable section="Emotes" id="problems">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <TriangleAlert className="size-4 text-muted-foreground" aria-hidden />
            Emote problems
            <span className="text-xs text-muted-foreground">{problems.length ? `${problems.length} failed` : "none"}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            When a 7TV, BetterTTV or FrankerFaceZ download fails, the last 20 times are listed here so you can see why emotes went quiet.
          </p>
          {problems.length === 0 ? (
            <p className="text-xs text-muted-foreground">No problems so far.</p>
          ) : (
            <div className="space-y-2">
              <ul className="zoo-scroll max-h-48 space-y-1.5 overflow-y-auto text-xs" data-testid="problems-list">
                {[...problems].reverse().map((problem) => (
                  <li key={problem.id} className="rounded-lg border px-2.5 py-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <span className="font-semibold">
                        {PROVIDER_LABELS[problem.provider]}
                        {problem.scope === "channel" && problem.channel ? ` · #${problem.channel}` : " · global"}
                      </span>
                      <time className="text-[11px] text-muted-foreground tabular-nums" dateTime={new Date(problem.at).toISOString()}>
                        {new Date(problem.at).toLocaleString()}
                      </time>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{problem.message}</p>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="xs" onClick={() => problemLog.clear()}>
                Clear the list
              </Button>
            </div>
          )}
        </div>
      </Searchable>
  );
}

function UpdateRow() {
  const { rowVisible } = useSettingsSearch();
  const version = useChat((s) => s.appInfo?.version ?? "");
  const autoCheck = useChat((s) => s.settings.autoCheckUpdates);
  const [busy, setBusy] = useState<"check" | "install" | null>(null);
  const [latest, setLatest] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<string>("");
  const showAuto = rowVisible("About & data", "auto-updates");
  const showCheck = rowVisible("About & data", "check-now");
  if (!showAuto && !showCheck) return null;

  const check = async () => {
    setBusy("check");
    setStatus("");
    try {
      const info = await fetchLatestRelease();
      setLatest(info);
      if (!info) setStatus("No portable release found on GitHub yet.");
      else if (!version || version === "dev" || !isNewerVersion(info.version, version)) {
        setStatus(`You're on the latest (${info.tag}).`);
      } else {
        setStatus(`Update available: ${info.tag}`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Couldn't reach GitHub.");
      setLatest(null);
    } finally {
      setBusy(null);
    }
  };

  const install = async () => {
    if (!latest) return;
    setBusy("install");
    setStatus("Downloading update… ZooChattr will restart. Your channels stay in ZooChattr-data.");
    try {
      // Settings webview cannot call apply_update — ask main to install.
      if (isTauri) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (getCurrentWindow().label === "settings") {
          const { emit } = await import("@tauri-apps/api/event");
          await emit("install-update-requested", { downloadUrl: latest.downloadUrl });
          setStatus("Handing install to the main window… ZooChattr will restart.");
          return;
        }
      }
      await applyUpdate(latest.downloadUrl);
    } catch (err) {
      // Includes "This update didn't pass its safety check. Nothing was changed." (Releases button is right here).
      setStatus(updateErrorText(err));
      setBusy(null);
    }
  };

  const newer = latest && version && version !== "dev" && isNewerVersion(latest.version, version);

  return (
    <div className="space-y-2">
      <Searchable section="About & data" id="auto-updates">
        <ToggleRow
          id="pref-auto-updates"
          label="Check for updates automatically"
          hint="Looks on GitHub when ZooChattr starts and every few hours. You'll get a toast if a newer portable build is out."
          setting="autoCheckUpdates"
        />
      </Searchable>
      <Searchable section="About & data" id="check-now">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void check()} data-testid="check-updates">
              <RefreshCw className={cn("size-3.5", busy === "check" && "animate-spin")} />
              Check now
            </Button>
            {newer ? (
              <Button type="button" size="sm" disabled={busy !== null || !isTauri} onClick={() => void install()} data-testid="install-update">
                <Download className="size-3.5" />
                Install {latest.tag}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void openExternal("https://github.com/gecko-of-shadow/ZooChattr/releases")}
            >
              Releases
            </Button>
          </div>
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
          <p className="text-[11px] text-muted-foreground">
            {autoCheck ? "Auto-check is on. " : "Auto-check is off — use Check now anytime. "}
            Updates replace only ZooChattr.exe. Your <code className="font-mono">ZooChattr-data</code> folder (channels, chat history, settings) stays put.
            An update installs only from ZooChattr's GitHub releases, and only when its fingerprint (SHA-256) matches.
          </p>
        </div>
      </Searchable>
    </div>
  );
}

function ClearHistoryRow() {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirm]);
  return (
    <Searchable section="Account & history" id="clear-history">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm">Clear saved chat history</span>
          <span className="text-xs text-muted-foreground">Deletes the chat saved on this PC for every channel. Click twice to confirm.</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant={confirm ? "destructive" : "outline"}
          data-testid="clear-chat-history"
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            setConfirm(false);
            void chat.clearSavedHistory();
          }}
        >
          {confirm ? "Really clear?" : "Clear history…"}
        </Button>
      </div>
    </Searchable>
  );
}

function BackupRow() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const backupText = () => JSON.stringify(makeBackup(useChat.getState().settings), null, 2);

  const download = () => {
    const blob = new Blob([backupText()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zoochattr-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast("Backup saved", { description: "Check your Downloads folder. Includes your channel list, not your login." });
  };

  const restoreText = (text: string, source: string) => {
    const settings = readBackup(text);
    if (!settings) {
      toast.error(`That ${source} isn't a ZooChattr settings backup.`);
      return;
    }
    const added = chat.restoreBackup(settings);
    for (const channel of added) chat.addChannel(channel);
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    restoreText(await file.text(), "file");
  };

  return (
    <Searchable section="About & data" id="backup">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">Back up settings</span>
            <span className="text-xs text-muted-foreground">
              Saves zoochattr-settings-(date).json: preferences, favourites and channel list. Never includes your login or token.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={download}>
            <Download /> Back up
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">Restore from file</span>
            <span className="text-xs text-muted-foreground">Loads a backup; channels in it are added. Your login stays as it is.</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload /> Restore…
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">Reset settings</span>
            <span className="text-xs text-muted-foreground">Keeps your channels and login. Click twice to confirm.</span>
          </div>
          <Button
            variant={confirmReset ? "destructive" : "outline"}
            size="sm"
            data-testid="settings-reset"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              chat.resetPreferences();
              setConfirmReset(false);
            }}
          >
            <RotateCcw /> {confirmReset ? "Really reset?" : "Reset…"}
          </Button>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void onFile(event)} aria-hidden />
      </div>
    </Searchable>
  );
}

/** One theme card: the button keeps the active theme (its focus ring and outline read on this panel), the inner panel shows the card's own theme. */
function ThemeCard({ id }: { id: Skin }) {
  const skin = useChat((s) => s.settings.skin);
  const autoLight = useChat((s) => s.settings.autoLightSkin);
  const autoDark = useChat((s) => s.settings.autoDarkSkin);
  const option = THEMES[id];
  return (
    <Searchable section="Appearance" id={id}>
      <button
        type="button"
        onClick={() => chat.updateSettings({ skin: id })}
        aria-pressed={skin === id}
        aria-label={`${option.name}: ${option.tag}`}
        className={cn(
          "relative block w-full border p-0 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          skin === id ? "border-primary ring-2 ring-primary" : "border-border hover:border-foreground",
        )}
      >
        <span data-skin={id === "auto" ? undefined : id} className="zoo-texture flex w-full flex-col items-start gap-1.5 p-2.5">
          {option.kind === "animal" ? (
            <Mascot skin={id} className="size-8" anim={skin === id ? "idle" : "none"} />
          ) : id === "auto" ? (
            // Auto: its light choice next to its dark choice.
            <span className="grid size-8 grid-cols-2 overflow-hidden border border-border" aria-hidden>
              <span data-skin={autoLight} className="grid grid-rows-2 bg-background">
                <span />
                <span className="bg-primary" />
              </span>
              <span data-skin={autoDark} className="grid grid-rows-2 bg-background">
                <span />
                <span className="bg-primary" />
              </span>
            </span>
          ) : (
            <span className="grid size-8 grid-cols-2 grid-rows-2 overflow-hidden border border-border" aria-hidden>
              <span className="bg-background" />
              <span className="bg-primary" />
              <span className="bg-accent-2" />
              <span className="bg-card" />
            </span>
          )}
          <span className="text-[13px] font-semibold text-foreground">{option.name}</span>
          <span className="text-[11px] leading-snug text-muted-foreground">{option.tag}</span>
        </span>
        {skin === id ? (
          <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden>
            <Check className="size-3" />
          </span>
        ) : null}
      </button>
    </Searchable>
  );
}

/** Auto's two choices: which theme to use while Windows is light, and while it is dark. */
function AutoChoicesRow() {
  const light = useChat((s) => s.settings.autoLightSkin);
  const dark = useChat((s) => s.settings.autoDarkSkin);
  const select = (value: ConcreteSkin, onChange: (skin: ConcreteSkin) => void, label: string) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as ConcreteSkin)}
      className="h-8 border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {CONCRETE_SKINS.map((id) => (
        <option key={id} value={id}>
          {THEMES[id].name}
        </option>
      ))}
    </select>
  );
  return (
    <Searchable section="Appearance" id="auto-choices">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Auto: when Windows is light use</span>
        {select(light, (skin) => chat.updateSettings({ autoLightSkin: skin }), "Auto theme while Windows is light")}
        <span>· when dark use</span>
        {select(dark, (skin) => chat.updateSettings({ autoDarkSkin: skin }), "Auto theme while Windows is dark")}
        <span>· switches live</span>
      </div>
    </Searchable>
  );
}

const THEME_GROUPS: { group: "theme" | "animal" | "access"; label: string }[] = [
  { group: "theme", label: "Theme" },
  { group: "animal", label: "Animal themes" },
  { group: "access", label: "Colorblind and accessibility" },
];

function ThemePicker() {
  const { rowVisible } = useSettingsSearch();
  return (
    <div className="space-y-4">
      {THEME_GROUPS.map(({ group, label }) => {
        const ids = SKIN_ORDER.filter((id) => THEMES[id].group === group);
        const anyVisible = ids.some((id) => rowVisible("Appearance", id)) || (group === "theme" && rowVisible("Appearance", "auto-choices"));
        if (!anyVisible) return null;
        return (
          <div key={group} className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{label}</h4>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
              {ids.map((id) => (
                <ThemeCard key={id} id={id} />
              ))}
            </div>
            {group === "theme" ? <AutoChoicesRow /> : null}
          </div>
        );
      })}
    </div>
  );
}

function AccountRow({ onRequestLogin }: { onRequestLogin: () => void }) {
  const auth = useChat((s) => s.auth);
  const write = useChat((s) => s.write?.status);
  return (
    <Searchable section="Account & history" id="login">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">
            {auth.status === "logged_in" ? (
              <>
                Logged in as <b className="text-foreground">{auth.login}</b>
                {auth.remembered ? "" : " (this login won't be remembered after you quit)"}
              </>
            ) : (
              "Not logged in"
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {auth.status === "logged_in"
              ? write === "connected"
                ? "Can read and send chat"
                : "Connecting your account to chat…"
              : "You can read any channel anonymously."}
          </span>
        </div>
        {auth.status === "logged_in" ? (
          <Button variant="destructive" size="sm" onClick={() => void chat.logout()}>
            Log out
          </Button>
        ) : (
          <Button size="sm" onClick={onRequestLogin} disabled={auth.status === "booting"}>
            Log in with Twitch
          </Button>
        )}
      </div>
    </Searchable>
  );
}

function AboutRow() {
  const appInfo = useChat((s) => s.appInfo);
  return (
    <Searchable section="About & data" id="paths">
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">This copy of ZooChattr</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Mode</dt>
          <dd>
            {appInfo?.portable
              ? "Portable (data lives next to ZooChattr)"
              : appInfo?.platform === "browser"
                ? "Browser dev mode"
                : "Per-user app data folder"}
          </dd>
          <dt className="text-muted-foreground">Settings folder</dt>
          <dd className="font-mono break-all">{appInfo?.dataDir ?? "…"}</dd>
          <dt className="text-muted-foreground">Login store</dt>
          <dd>{appInfo?.tokenStore ?? "…"}</dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd>ZooChattr {appInfo?.version ?? ""}</dd>
        </dl>
      </div>
    </Searchable>
  );
}

/** Settings sections (the 7 approved ones). With `activeSection`, only that one shows unless searching. */
export function SettingsBody({
  onRequestLogin,
  searchQuery = "",
  activeSection,
}: {
  onRequestLogin: () => void;
  searchQuery?: string;
  activeSection?: string;
}) {
  const search = useMemo(() => settingsSearchHelpers(searchQuery), [searchQuery]);
  const searching = searchQuery.trim() !== "";
  const show = (title: string) => !activeSection || searching || activeSection === title;

  return (
    <SettingsSearchContext.Provider value={search}>
      <SectionTitlesContext.Provider value={!activeSection || searching}>
      <div className="space-y-8">
        {!search.hasMatches ? (
          <p className="text-sm text-muted-foreground" data-testid="settings-search-empty">
            No settings match
          </p>
        ) : null}

        {show("Appearance") ? (
          <Section icon={Palette} title="Appearance">
            <div className="space-y-6">
              <ThemePicker />
              <Group section="Appearance" ids={["text-size", "timestamps", "24h", "badges", "zebra"]} title="Text and rows">
                <Searchable section="Appearance" id="text-size">
                  <TextSizeRow />
                </Searchable>
                <div className="grid gap-x-8 gap-y-3 @3xl:grid-cols-2">
                  <Searchable section="Appearance" id="timestamps">
                    <ToggleRow id="pref-ts" label="Timestamps" setting="showTimestamps" />
                  </Searchable>
                  <Searchable section="Appearance" id="24h">
                    <ToggleRow id="pref-24h" label="24-hour clock" setting="use24h" />
                  </Searchable>
                  <Searchable section="Appearance" id="badges">
                    <ToggleRow id="pref-badges" label="Badges" hint="Mod, VIP, sub and other chat badges" setting="showBadges" />
                  </Searchable>
                  <Searchable section="Appearance" id="zebra">
                    <ToggleRow id="pref-zebra" label="Striped rows" hint="Shade every other line" setting="zebra" />
                  </Searchable>
                </div>
              </Group>
            </div>
          </Section>
        ) : null}

        {show("Chat & mentions") ? (
          <Section icon={Type} title="Chat & mentions">
            <Columns>
              <div className="space-y-6">
                <Group section="Chat & mentions" ids={["deleted", "highlight"]} title="Messages">
                  <Searchable section="Chat & mentions" id="deleted">
                    <ToggleRow
                      id="pref-deleted"
                      label="Show deleted messages"
                      hint="Keep what a mod removed readable, faded and crossed out, instead of hiding it"
                      setting="showDeleted"
                    />
                  </Searchable>
                  <Searchable section="Chat & mentions" id="highlight">
                    <WordListField
                      id="pref-highlight"
                      label="Highlight words"
                      hint="Besides your own name, messages with these words light up and count as mentions."
                      placeholder={"giveaway\nmy_nickname"}
                      setting="highlightWords"
                    />
                  </Searchable>
                </Group>
                <Group section="Chat & mentions" ids={["mention-sound"]} title="Mention sound">
                  <Searchable section="Chat & mentions" id="mention-sound">
                    <MentionSoundRow />
                  </Searchable>
                </Group>
              </div>
              <div className="space-y-6">
                <Group section="Chat & mentions" ids={["confirm-channel", "read-only"]} title="Sending">
                  <Searchable section="Chat & mentions" id="confirm-channel">
                    <ToggleRow
                      id="pref-confirm-channel"
                      label="Confirm channel before typing"
                      hint="The message box stays locked until you confirm the channel, so you don’t send in the wrong room when several chats are open."
                      setting="confirmChannelSwitch"
                    />
                  </Searchable>
                  <Searchable section="Chat & mentions" id="read-only">
                    <ToggleRow
                      id="pref-read-only"
                      label="Read only"
                      hint="Hide the message box so you can watch without accidentally chatting. Ctrl+Shift+R also switches it."
                      setting="readOnly"
                    />
                  </Searchable>
                </Group>
                <Group section="Chat & mentions" ids={["spell"]} title="Spell check">
                  <Searchable section="Chat & mentions" id="spell">
                    <SpellCheckRows />
                  </Searchable>
                </Group>
              </div>
            </Columns>
          </Section>
        ) : null}

        {show("Emotes") ? <EmotesSection /> : null}

        {show("Per channel") ? <ChannelOverridesSection /> : null}

        {show("Window & startup") ? (
          <Section icon={AppWindow} title="Window & startup">
            <div className="space-y-6">
              <Group section="Window & startup" ids={["tray", "startup"]} title="Window">
                <Searchable section="Window & startup" id="tray">
                  <ToggleRow
                    id="pref-tray"
                    label="Close to tray"
                    hint="Closing the window keeps ZooChattr running in the system tray, so your chats stay connected. Right-click the tray icon and choose Quit to exit — you'll get a confirmation first."
                    setting="closeToTray"
                  />
                </Searchable>
                <Searchable section="Window & startup" id="startup">
                  <ToggleRow
                    id="pref-startup"
                    label="Start with Windows"
                    hint="Open ZooChattr when you sign in to Windows. Uses a shortcut in your Startup folder."
                    setting="startOnLogin"
                  />
                </Searchable>
              </Group>
              <Group section="Window & startup" ids={["grid-slots"]} title="Grid">
                <Searchable section="Window & startup" id="grid-slots">
                  <GridSlotsRow />
                </Searchable>
              </Group>
              <Searchable section="Window & startup" id="shortcuts">
                <ShortcutsReference />
              </Searchable>
            </div>
          </Section>
        ) : null}

        {show("Account & history") ? (
          <Section icon={KeyRound} title="Account & history">
            <div className="space-y-6">
              <Group section="Account & history" ids={["login", "client-id"]} title="Twitch account">
                <AccountRow onRequestLogin={onRequestLogin} />
                <Searchable section="Account & history" id="client-id">
                  <ClientIdField />
                </Searchable>
              </Group>
              <Group section="Account & history" ids={["history", "history-server", "clear-history"]} title="Chat history">
                <Searchable section="Account & history" id="history">
                  <ToggleRow
                    id="pref-chat-history"
                    label="Remember chat history"
                    hint="Keeps about 48 hours of messages per channel in ZooChattr-data so logs come back after you quit. Turn off to stop saving (and wipe what's stored)."
                    setting="rememberChatHistory"
                  />
                </Searchable>
                <Searchable section="Account & history" id="history-server">
                  <HistoryServerField />
                </Searchable>
                <ClearHistoryRow />
              </Group>
            </div>
          </Section>
        ) : null}

        {show("About & data") ? (
          <Section icon={FolderOpen} title="About & data">
            <div className="space-y-6">
              <Group section="About & data" ids={["auto-updates", "check-now"]} title="Updates">
                <UpdateRow />
              </Group>
              <AboutRow />
              <Group section="About & data" ids={["backup"]} title="Your data">
                <BackupRow />
              </Group>
            </div>
          </Section>
        ) : null}
      </div>
      </SectionTitlesContext.Provider>
    </SettingsSearchContext.Provider>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+G", "Grid ↔ single chat"],
  ["Ctrl+K", "Find an open channel"],
  ["Ctrl+1 … Ctrl+9", "Jump to a grid pane"],
  ["Ctrl+Tab / Ctrl+Shift+Tab", "Next / previous chat (single)"],
  ["Alt+Enter (in Ctrl+K)", "Put the channel in a grid pane"],
  ["Alt+Shift+← / →", "Move a grid pane"],
  ["Esc", "Close / back to the grid"],
  ["Tab / Shift+Tab", "Finish an emote or name"],
  ["↑ / ↓", "Sent-message history"],
  ["Enter", "Send"],
  ["Shift+Enter", "Don't send yet"],
  ["Ctrl+Enter", "Save a word list"],
  ["Ctrl+Shift+R", "Read only on / off"],
  ["Ctrl+Shift+H", "Hide / show the bottom bar"],
  ["⋯ on a pane header", "Pick or add a channel for that pane"],
  ["Menu key / Shift+F10", "Channel menu (in the channel picker)"],
  ["Drag a header", "Swap grid panes"],
  ["Double-click a header", "Open the chat alone"],
  ["Right-click a header or picker row", "Channel menu"],
  ["Right-click an emote", "Favourite it (emote panel)"],
];

function ShortcutsReference() {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Keyboard shortcuts</h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
        {SHORTCUTS.map(([keys, what]) => (
          <Fragment key={keys}>
            <dt>
              <kbd className="border border-border bg-background px-1.5 py-0.5 font-sans text-[11px]">{keys}</kbd>
            </dt>
            <dd className="text-muted-foreground">{what}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * Settings as a panel inside the main window (Bran's choice): search on top, the 7 sections with counts on the
 * left, the section on the right. Opens from the gear and from the tray's Settings…; Esc or ✕ closes it.
 */
export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const [searchQuery, setSearchQuery] = useState("");
  const [active, setActive] = useState(SETTINGS_SEARCH_CATALOG[0].title);
  const search = useMemo(() => settingsSearchHelpers(searchQuery), [searchQuery]);
  const searching = searchQuery.trim() !== "";
  const close = () => useUi.setState({ settingsOpen: false });

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    setSearchQuery("");
    if (!wasOpen.current) return;
    wasOpen.current = false;
    // Closed from inside the panel (Esc or ✕): focus was lost with it, so it goes back to the gear.
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector<HTMLButtonElement>("[data-testid='settings-gear']")?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // A menu, popover or the login dialog inside Settings closes first (a pane's channel picker beside it doesn't count).
      if (document.querySelector("[role='menu'], [role='listbox']:not([data-picker-list]), [data-slot='popover-content'], [data-slot='dialog-content']")) return;
      event.preventDefault();
      // Text fields save on blur; blur first so a half-typed edit isn't lost when the panel goes away.
      (document.activeElement as HTMLElement | null)?.blur();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Settings"
      data-testid="settings-panel"
      className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-surface md:w-[min(64rem,66%)]"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <h2 className="w-40 shrink-0 text-lg font-semibold max-md:hidden">Settings</h2>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search all settings"
            aria-label="Search settings"
            data-testid="settings-search"
            className="h-9 pl-8"
          />
        </div>
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close settings" title="Close (Esc)">
          <X className="size-4" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav aria-label="Settings sections" className="flex shrink-0 flex-col border-border max-md:flex-row max-md:overflow-x-auto max-md:border-b md:w-52 md:border-r">
          <ul className="flex md:flex-col">
            {SETTINGS_SEARCH_CATALOG.map((section) => {
              const current = !searching && active === section.title;
              const matches = !searching || search.sectionVisible(section.title);
              return (
                <li key={section.title}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    onClick={() => {
                      setSearchQuery("");
                      setActive(section.title);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      // A real left border (not a shadow) so Windows contrast themes keep the bar.
                      current
                        ? "border-l-[3px] border-primary bg-surface-2 pl-[13px] font-semibold text-foreground"
                        : "pl-4 text-foreground hover:bg-accent hover:[--muted-foreground:color-mix(in_srgb,var(--zc-muted)_50%,var(--zc-text))]",
                      !matches && "text-muted-foreground",
                    )}
                  >
                    <span>
                      {section.title}
                      {!matches ? <span className="ml-1.5 text-[11px]">· no match</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {section.count}
                      <span className="sr-only"> settings</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-auto px-4 py-3 text-xs text-muted-foreground max-md:hidden">Also opens from the tray icon → Settings</p>
        </nav>
        <div className="zoo-scroll @container min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <SettingsBody
            searchQuery={searchQuery}
            activeSection={active}
            onRequestLogin={() => useUi.setState({ settingsOpen: false, loginOpen: true })}
          />
        </div>
      </div>
    </aside>
  );
}

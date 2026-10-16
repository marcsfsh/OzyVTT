import { useState } from "react";
import type {
  BuilderAbilityMethod,
  GmView,
  PartyVisibility,
  PlayerView,
  RuleExceptions,
  RuleFamily,
  RuleMode
} from "@vtt/domain";
import {
  Avatar,
  Badge,
  Button,
  Eyebrow,
  Input,
  RevealSwitch,
  SegmentedControl,
  Select,
  Stepper,
  Switch,
  ThemeToggle,
  useToast
} from "@vtt/ui";
import { IntegrationsPanel } from "../integrations/IntegrationsPanel";
import { TokenLibrary } from "../tokens/TokenLibrary";
import { useRollPreference } from "../dice/roll-preference";
import { command, type CommandEvent, type CommandPayload } from "../lib/command";
import { setAutoArrange, useAutoArrange } from "./preferences";
import "./settings.css";

/**
 * Settings: one page, three groups. Includes the rules dial, `builderPolicy`, and access &
 * integrations.
 * Who sees what is structural, not a filter: `SETTINGS_GROUPS` declares each group's audience and
 * only allowed groups render, so GM-only controls are never mounted for a player. The GM groups take
 * `state` as a `GmView`, which a player projection is not.
 */

/** The page's shape as data, so a test can pin it without scraping the DOM. */
export const SETTINGS_GROUPS: ReadonlyArray<
  Readonly<{ id: "mine" | "table" | "players"; label: string; audience: "everyone" | "gm" }>
> = [
  { id: "mine", label: "Mine", audience: "everyone" },
  { id: "table", label: "The table", audience: "gm" },
  { id: "players", label: "Players", audience: "gm" }
];

export function groupsFor(role: "gm" | "player"): typeof SETTINGS_GROUPS {
  return SETTINGS_GROUPS.filter((group) => role === "gm" || group.audience === "everyone");
}

/**
 * The dial's user-facing words. The wire stays `strict | assisted | freeform`: three schemas, the
 * archive documents and the public API speak it, so renaming it would be a breaking change.
 */
const DIAL_COPY: ReadonlyArray<Readonly<{ value: RuleMode; label: string; help: string }>> = [
  { value: "strict", label: "Enforce", help: "blocks illegal moves; you can allow them" },
  { value: "assisted", label: "Advise", help: "allows everything, leaves notes" },
  { value: "freeform", label: "Off", help: "no checks, no prompts" }
];
const dialLabel = (mode: RuleMode) => DIAL_COPY.find((entry) => entry.value === mode)?.label ?? mode;

/**
 * One toggle per server rule family, never finer: the engine classifies every rule into these five
 * (`apps/server/src/rules-families.ts`).
 */
const FAMILY_COPY: ReadonlyArray<Readonly<{ family: RuleFamily; label: string }>> = [
  { family: "movement", label: "Don't police movement" },
  { family: "economy", label: "Don't police action economy" },
  { family: "resources", label: "Don't police limited uses" },
  { family: "targeting", label: "Don't police targeting, range & cover" },
  { family: "slots", label: "Don't police spell slots" }
];

const ABILITY_METHODS: ReadonlyArray<Readonly<{ id: BuilderAbilityMethod; label: string }>> = [
  { id: "standard-array", label: "Standard array" },
  { id: "point-buy", label: "Point buy" },
  { id: "roll", label: "Roll" },
  { id: "custom", label: "Custom formula" }
];

/**
 * How much a player sees of another player's character. The wire values are
 * `off | name-and-class | full-sheet | sheet-and-resources`; only `apps/server/src/projections.ts`
 * enforces them, and nothing here filters (`PartyStrip` only uses the tier to decide whether to
 * mount). A `Select`: four labels this long are unreadable as a segmented control at 320px.
 */
const PARTY_VISIBILITY_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "name-and-class", label: "Name and class" },
  { value: "full-sheet", label: "Full sheet" },
  { value: "sheet-and-resources", label: "Sheet + resources" }
] as const;

/**
 * The promise the GM reads before choosing, so it must match what the tier does: at `off` a
 * character is still named in the turn order and their token still shows health and conditions;
 * what `off` removes is the party list and the sheet.
 */
const PARTY_VISIBILITY_HELP: Readonly<Record<PartyVisibility, string>> = {
  off: "Players see each other's tokens and turn order — no party list, and no sheet to open.",
  "name-and-class": "Players see who's in the party and what they play.",
  "full-sheet": "Players can open each other's sheets, read-only.",
  "sheet-and-resources": "Players also see each other's spell slots, inventory and hit dice."
};

const HEALTH_STYLES = [
  { value: "band", label: "Band" },
  { value: "bar", label: "Bar" },
  { value: "ring", label: "Ring" },
  { value: "aura", label: "Aura" }
] as const;

/**
 * One settings group. The `--{id}` modifier is what the 1280px two-column layout places by name
 * (settings.css).
 * `gmOnly` adds the violet GM rim and appends "GM only" to the Eyebrow (the section's accessible
 * name), so the edge is never the only signal. *Mine* renders for both roles; the GM groups do not
 * render at all without a GM token.
 */
function Group({
  id,
  label,
  gmOnly = false,
  children
}: Readonly<{ id: string; label: string; gmOnly?: boolean; children: React.ReactNode }>) {
  return (
    <section
      className={`settings-group settings-group--${id}${gmOnly ? " rim-gm" : ""}`}
      aria-labelledby={`settings-${id}`}
    >
      <Eyebrow id={`settings-${id}`}>
        {label}
        {gmOnly ? " · GM only" : ""}
      </Eyebrow>
      {children}
    </section>
  );
}

/** One labelled setting: a title, the control, and at most one line of help. */
function Row({
  title,
  help,
  children,
  stacked = false
}: Readonly<{ title: string; help?: string; children: React.ReactNode; stacked?: boolean }>) {
  return (
    <div className={`settings-row${stacked ? " stacked" : ""}`}>
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {help && <span className="settings-row-help">{help}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

// Mine (every role)

function MineGroup() {
  const { rollInput, setRollInput } = useRollPreference();
  return (
    <Group id="mine" label="Mine">
      <Row title="Theme" help="This device.">
        <ThemeToggle />
      </Row>
      <Row title="How you roll" help="'I roll my dice' asks you to type what your physical dice show.">
        <SegmentedControl
          ariaLabel="How you roll"
          value={rollInput}
          onChange={(value) => setRollInput(value as "digital" | "manual")}
          options={[
            { value: "digital", label: "Auto-roll" },
            { value: "manual", label: "I roll my dice" }
          ]}
        />
      </Row>
    </Group>
  );
}

// The table (GM only)

function TableGroup({
  state,
  gmToken,
  onSignOut,
  onRevokeAll,
  busy
}: Readonly<{
  state: GmView;
  gmToken: string;
  onSignOut: () => void;
  onRevokeAll: () => void;
  busy: boolean;
}>) {
  const { toast } = useToast();
  const autoArrange = useAutoArrange();
  const policy = state.rulesPolicy;
  const builder = state.builderPolicy;
  const [formula, setFormula] = useState(builder.customFormula ?? "");

  /** Every write here is the same shape: send, and say so only when it fails. */
  const send = async <E extends CommandEvent>(event: E, payload: CommandPayload<E>, failure: string) => {
    const result = await command(event, payload);
    if (!result.ok) toast(result.message ?? failure, { tone: "error" });
  };

  const setDial = (dial: RuleMode) =>
    send("rules:set-policy", { dial, exceptions: policy.exceptions }, "The rules setting was rejected.");
  /**
   * ON pins that family Off whatever the dial says; OFF removes the key, which on the wire means
   * "follow the dial". A 1:1 map onto `rulesPolicy.exceptions`.
   */
  const setException = (family: RuleFamily, off: boolean) => {
    const next: RuleExceptions = { ...policy.exceptions };
    if (off) next[family] = "freeform";
    else delete next[family];
    send("rules:set-policy", { dial: policy.dial, exceptions: next }, "The rules exception was rejected.");
  };

  const setBuilderPolicy = (
    change: Partial<{
      allowedAbilityMethods: readonly BuilderAbilityMethod[];
      customFormula: string | null;
      maxLevel: number;
      playerBuilder: "open" | "gm-only";
      typedRolls: "open" | "gm-only";
      hitPointRollFloor: "none" | "average";
    }>
  ) =>
    send(
      "builder:set-policy",
      {
        allowedAbilityMethods: builder.allowedAbilityMethods,
        customFormula: builder.customFormula,
        maxLevel: builder.maxLevel,
        playerBuilder: builder.playerBuilder,
        ...change
      },
      "That builder setting was rejected."
    );

  const toggleMethod = (id: BuilderAbilityMethod, on: boolean) => {
    const next = on
      ? [...builder.allowedAbilityMethods, id]
      : builder.allowedAbilityMethods.filter((method) => method !== id);
    // The server requires at least one method; refusing here explains why.
    if (next.length === 0) {
      toast("Leave the players at least one way to set ability scores.", { tone: "error" });
      return;
    }
    setBuilderPolicy({ allowedAbilityMethods: next });
  };

  const health = state.combat.healthDisplay;

  return (
    <Group id="table" label="The table" gmOnly>
      <Row
        title="Rules assistant"
        help="Each fight starts from this and can be changed mid-fight on the Table."
        stacked
      >
        <SegmentedControl
          ariaLabel="Rules assistant"
          value={policy.dial}
          onChange={(value) => setDial(value as RuleMode)}
          options={DIAL_COPY.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <p className="settings-note">{DIAL_COPY.map((entry) => `${entry.label} — ${entry.help}`).join(" · ")}</p>
        <div className="settings-exceptions">
          <span className="settings-subhead">Exceptions</span>
          {FAMILY_COPY.map(({ family, label }) => {
            const stored = policy.exceptions[family];
            return (
              <div key={family} className="settings-exception">
                <Switch checked={stored === "freeform"} onChange={(next) => setException(family, next)} label={label} />
                {/* A family parked at Advise while the dial says Enforce is neither on nor off, so say which. */}
                {stored && stored !== "freeform" && stored !== policy.dial && (
                  <Badge tone="info">{dialLabel(stored)}</Badge>
                )}
              </div>
            );
          })}
        </div>
      </Row>

      <Row title="Max party level" help="Players can build and level their own characters up to this level.">
        <Stepper
          value={builder.maxLevel}
          min={1}
          max={20}
          aria-label="Max party level"
          onChange={(maxLevel) => setBuilderPolicy({ maxLevel })}
        />
      </Row>

      <Row title="Health display" help="Per-token overrides stay on the token's own menu." stacked>
        <div className="settings-inline">
          <Select
            value={health.style}
            aria-label="Health display style"
            onChange={(event) =>
              send(
                "encounter:set-health-display",
                { style: event.target.value as typeof health.style, audience: health.audience },
                "The health display was rejected."
              )
            }
          >
            {HEALTH_STYLES.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </Select>
          <span className="settings-inline-label">Health is:</span>
          <SegmentedControl
            ariaLabel="Who sees health"
            value={health.audience}
            onChange={(value) =>
              send(
                "encounter:set-health-display",
                { style: health.style, audience: value as typeof health.audience },
                "The health display was rejected."
              )
            }
            options={[
              { value: "gm", label: "GM only" },
              { value: "all", label: "Shown to players" }
            ]}
          />
        </div>
      </Row>

      <Row title="What players see of each other" help={PARTY_VISIBILITY_HELP[state.partyVisibility]} stacked>
        <Select
          value={state.partyVisibility}
          aria-label="What players see of each other"
          onChange={(event) =>
            send(
              "table:set-party-visibility",
              { visibility: event.target.value as GmView["partyVisibility"] },
              "That setting was rejected."
            )
          }
        >
          {PARTY_VISIBILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <p className="settings-note">
          Their own character is always theirs in full — this is only what they see of the rest of the party.
        </p>
      </Row>

      <Row title="New tokens" help="What a newly staged character or monster starts as." stacked>
        <RevealSwitch
          revealed={state.stagingDefaults.visibility === "public"}
          ariaLabel="New tokens shown to players"
          onChange={(revealed) =>
            send(
              "table:set-staging-defaults",
              { visibility: revealed ? "public" : "gm-only" },
              "The staging default was rejected."
            )
          }
        />
        <Switch checked={autoArrange} onChange={setAutoArrange} label="Open new scenes for arranging automatically" />
        <p className="settings-note">Arranging is private to you — this device.</p>
      </Row>

      <Row title="Players' hits">
        <SegmentedControl
          ariaLabel="Players' hits"
          value={state.combat.playerDamageMode}
          onChange={(value) =>
            send(
              "encounter:set-player-damage-mode",
              { mode: value as GmView["combat"]["playerDamageMode"] },
              "That setting was rejected."
            )
          }
          options={[
            { value: "proposal", label: "Applied by the GM" },
            { value: "direct", label: "Applied immediately" }
          ]}
        />
      </Row>

      <Row title="Players' initiative" help="When players roll their own initiative at the start of a fight.">
        <SegmentedControl
          ariaLabel="When turns start"
          value={state.combat.playerInitiativeMode}
          onChange={(value) =>
            send(
              "encounter:set-player-initiative-mode",
              { mode: value as GmView["combat"]["playerInitiativeMode"] },
              "That setting was rejected."
            )
          }
          options={[
            { value: "immediate", label: "Start turns immediately" },
            { value: "wait", label: "When everyone has rolled" }
          ]}
        />
      </Row>

      <Row title="Builder policy" help="Who may build characters, and how their ability scores are set." stacked>
        <Switch
          checked={builder.playerBuilder === "open"}
          onChange={(open) => setBuilderPolicy({ playerBuilder: open ? "open" : "gm-only" })}
          label="Players can build & level their own characters"
        />
        <div className="settings-methods" role="group" aria-label="Ability score methods">
          {ABILITY_METHODS.map((method) => (
            <Switch
              key={method.id}
              checked={builder.allowedAbilityMethods.includes(method.id)}
              onChange={(on) => toggleMethod(method.id, on)}
              label={method.label}
            />
          ))}
        </div>
        <Switch
          checked={builder.typedRolls === "open"}
          onChange={(open) => setBuilderPolicy({ typedRolls: open ? "open" : "gm-only" })}
          label="Players can type their own dice for rolled scores and hit points"
        />
        <Switch
          checked={builder.hitPointRollFloor === "average"}
          onChange={(raise) => setBuilderPolicy({ hitPointRollFloor: raise ? "average" : "none" })}
          label="Raise a hit point roll below the average to the average"
        />
        {builder.allowedAbilityMethods.includes("custom") && (
          <div className="settings-inline">
            <Input
              value={formula}
              aria-label="Custom ability formula"
              placeholder="4d6kh3"
              maxLength={160}
              onChange={(event) => setFormula(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={formula.trim() === (builder.customFormula ?? "")}
              onClick={() => setBuilderPolicy({ customFormula: formula.trim() || null })}
            >
              Save formula
            </Button>
          </div>
        )}
      </Row>

      <div className="settings-subsection">
        <span className="settings-subhead">Access &amp; integrations</span>
        <IntegrationsPanel gmToken={gmToken} />
        <div className="settings-session">
          <Button variant="secondary" onClick={onSignOut} disabled={busy}>
            Sign out
          </Button>
          <Button variant="destructive" onClick={onRevokeAll} disabled={busy}>
            Revoke all GM sessions
          </Button>
        </div>
      </div>
    </Group>
  );
}

// Players (GM only)

/**
 * Projection guard: rows are built only from claim and presence the GM view already carries
 * (`ownerSessionId`, `presence`). No session id, token, address or other player-identifying value is
 * in the projection or added here. A connected player who has claimed nobody is not a row.
 */
function PlayersGroup({
  state,
  gmToken,
  onPreviewPlayers
}: Readonly<{ state: GmView; gmToken: string; onPreviewPlayers: () => void }>) {
  const { toast } = useToast();
  const builder = state.builderPolicy;
  /**
   * `playerRandom` is a Players setting: whether the people at this table may roll their own random
   * character (closed by default). The GM's own door is never gated by it. The other `builderPolicy`
   * fields ride along because `builder.set-policy` requires `allowedAbilityMethods` and keeps omitted
   * keys.
   */
  const setPlayerRandom = async (open: boolean) => {
    const result = await command("builder:set-policy", {
      allowedAbilityMethods: builder.allowedAbilityMethods,
      customFormula: builder.customFormula,
      maxLevel: builder.maxLevel,
      playerBuilder: builder.playerBuilder,
      playerRandom: open ? "open" : "gm-only"
    });
    if (!result.ok) toast(result.message ?? "That setting was rejected.", { tone: "error" });
  };
  const [tokenFor, setTokenFor] = useState<Readonly<{
    id: string;
    name: string;
    definitionId?: string;
    assetId: string | null;
  }> | null>(null);
  const claimed = state.actors.filter(
    (actor) => actor.kind === "player-character" && !actor.archived && actor.ownerSessionId !== null
  );

  const forceRelease = async (actorId: string, name: string) => {
    const result = await command("character:force-release", { actorId });
    if (result.ok) toast(`${name} is available to claim again.`, { tone: "success" });
    else toast(result.message ?? "That claim could not be released.", { tone: "error" });
  };

  return (
    <Group id="players" label="Players" gmOnly>
      <Row title="Random characters" help="You can always roll one. This is about whether they can." stacked>
        <Switch
          checked={builder.playerRandom === "open"}
          onChange={setPlayerRandom}
          label="Players can roll a random character for themselves"
        />
      </Row>
      {claimed.length === 0 ? (
        <p className="settings-empty">No players connected yet.</p>
      ) : (
        <ul className="settings-players">
          {claimed.map((actor) => (
            <li key={actor.id} className="settings-player">
              <Avatar
                name={actor.name}
                presence={
                  actor.presence === "online" ? "online" : actor.presence === "reconnecting" ? "away" : "offline"
                }
                size="sm"
              />
              <div className="settings-player-text">
                <span className="settings-player-name">{actor.name}</span>
                <span className="settings-player-meta">
                  {actor.presence === "online"
                    ? "Connected"
                    : actor.presence === "reconnecting"
                      ? "Reconnecting"
                      : "Away"}
                </span>
              </div>
              <div className="settings-player-actions">
                <Button variant="secondary" size="sm" onClick={onPreviewPlayers}>
                  See their view
                </Button>
                <Button variant="secondary" size="sm" onClick={() => forceRelease(actor.id, actor.name)}>
                  Force release
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setTokenFor({
                      id: actor.id,
                      name: actor.name,
                      ...(actor.definitionId ? { definitionId: actor.definitionId } : {}),
                      assetId: actor.tokenAssetId ?? null
                    })
                  }
                >
                  Set token image…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {tokenFor && (
        <TokenLibrary
          actorId={tokenFor.id}
          actorName={tokenFor.name}
          definitionId={tokenFor.definitionId ?? null}
          currentAssetId={tokenFor.assetId}
          token={gmToken}
          role="gm"
          onClose={() => setTokenFor(null)}
        />
      )}
    </Group>
  );
}

// The page

/**
 * A GM token is not yet a GM view: on a cold deep link to `/settings` the first state can still be
 * player-projected (no `rulesPolicy`, `stagingDefaults` or `combat.healthDisplay`) until the session
 * join lands. So check the GM-only fields `TableGroup` reads, not the role; the GM groups mount on
 * the next state.
 */
function gmViewOrNull(state: GmView | PlayerView | null): GmView | null {
  const view = state as GmView | null;
  if (!view) return null;
  const projected =
    view.rulesPolicy !== undefined && view.stagingDefaults !== undefined && view.combat?.healthDisplay !== undefined;
  return projected ? view : null;
}

export function SettingsPage({
  role,
  state,
  gmToken,
  onPreviewPlayers,
  onSignOut,
  onRevokeAll,
  busy = false
}: Readonly<{
  role: "gm" | "player";
  state: GmView | PlayerView | null;
  /** Present exactly when `role === "gm"`; the GM groups need it for the integrations and token doors. */
  gmToken?: string | null;
  onPreviewPlayers?: () => void;
  onSignOut?: () => void;
  onRevokeAll?: () => void;
  busy?: boolean;
}>) {
  const gm = role === "gm" && gmToken ? gmViewOrNull(state) : null;
  /* The heading stays fixed; the groups are the one scroll region. */
  return (
    <div className="settings-page pane-frame pane-scene scanlines frame-col anim-view">
      <div className="pane-sky" aria-hidden="true" />
      <header className="settings-head neon-beam">
        <h2>Settings</h2>
        <p>
          {role === "gm"
            ? "Your device, this table, and the people at it."
            : "Your device. The rest of the table is your GM's to set."}
        </p>
      </header>
      <div className="settings-body scroll-y frame-fill">
        <MineGroup />
        {gm && gmToken && (
          <TableGroup
            state={gm}
            gmToken={gmToken}
            onSignOut={onSignOut ?? (() => {})}
            onRevokeAll={onRevokeAll ?? (() => {})}
            busy={busy}
          />
        )}
        {gm && gmToken && (
          <PlayersGroup state={gm} gmToken={gmToken} onPreviewPlayers={onPreviewPlayers ?? (() => {})} />
        )}
      </div>
    </div>
  );
}

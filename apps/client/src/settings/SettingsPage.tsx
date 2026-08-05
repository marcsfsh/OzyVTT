import { useState } from "react";
import type { BuilderAbilityMethod, GmView, PlayerView, RuleExceptions, RuleFamily, RuleMode } from "@vtt/domain";
import {
  Avatar, Badge, Button, Eyebrow, Input, RevealSwitch, SegmentedControl, Select, Stepper, Switch, ThemeToggle, useToast
} from "@vtt/ui";
import { IntegrationsPanel } from "../integrations/IntegrationsPanel";
import { TokenLibrary } from "../tokens/TokenLibrary";
import { useRollPreference } from "../dice/roll-preference";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { setAutoArrange, useAutoArrange } from "./preferences";
import "./settings.css";

/**
 * **Settings — one tab, three groups, one page (D24).**
 *
 * Every knob that used to be somewhere else is here, and the two that had nowhere at all finally have a
 * home: the rules dial was buried in a mid-fight overflow menu (so the standing campaign setting could
 * only be reached during a fight), and `builderPolicy` — stored, projected, enforced server-side — had
 * no client control whatsoever. `/setup` folds in as the *Access & integrations* subsection (§B9.4):
 * nothing it held is lost.
 *
 * **Who sees what is structural, not a filter.** `SETTINGS_GROUPS` declares each group's audience and
 * the page renders only the groups a role may see, so a player's Settings page contains one group and
 * the GM-only controls are never mounted at all. The GM groups also take `state` as a `GmView`, which a
 * player projection is not — the type says the same thing the audience does.
 */

/** The page's shape as DATA, so a test can pin it without scraping the DOM (plan-3 §2.4). */
export const SETTINGS_GROUPS: ReadonlyArray<Readonly<{ id: "mine" | "table" | "players"; label: string; audience: "everyone" | "gm" }>> = [
  { id: "mine", label: "Mine", audience: "everyone" },
  { id: "table", label: "The table", audience: "gm" },
  { id: "players", label: "Players", audience: "gm" }
];

export function groupsFor(role: "gm" | "player"): typeof SETTINGS_GROUPS {
  return SETTINGS_GROUPS.filter((group) => role === "gm" || group.audience === "everyone");
}

/**
 * D6 — the dial's user-facing words. The WIRE stays `strict | assisted | freeform`: renaming an enum
 * that three schemas, the archive documents and the public API all speak would be a breaking change to
 * fix a copy problem. Copy is copy; this map is the whole of it.
 */
const DIAL_COPY: ReadonlyArray<Readonly<{ value: RuleMode; label: string; help: string }>> = [
  { value: "strict", label: "Enforce", help: "blocks illegal moves; you can allow them" },
  { value: "assisted", label: "Advise", help: "allows everything, leaves notes" },
  { value: "freeform", label: "Off", help: "no checks, no prompts" }
];
const dialLabel = (mode: RuleMode) => DIAL_COPY.find((entry) => entry.value === mode)?.label ?? mode;

/**
 * One toggle per SERVER rule family, never finer. The engine classifies every rule into these five
 * (`apps/server/src/rules-families.ts`, pinned by a totality test); a sixth switch here would promise a
 * split the engine cannot make.
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

const HEALTH_STYLES = [
  { value: "band", label: "Band" },
  { value: "bar", label: "Bar" },
  { value: "ring", label: "Ring" },
  { value: "aura", label: "Aura" }
] as const;

type Ack = Readonly<{ ok: boolean; message?: string }>;

/**
 * One settings group. The `--{id}` modifier is what the ≥1280 two-column rule places by name
 * (The table on the left, Mine + Players on the right — settings.css); `.surface-glass` is the
 * scene tier (§9): these panels stand on the surface's sky rather than on flat app ground.
 *
 * `gmOnly` takes the violet role rim (§9). It says something the GM cannot otherwise see on this
 * page: THESE are the groups a player is never handed — *Mine* renders for both roles, the other
 * two do not render at all without a GM token.
 *
 * A RIM IS NEVER THE ONLY SIGNAL, and the words come from this ONE place rather than each call
 * site, so the edge and the sentence cannot drift apart: `gmOnly` paints the rim and appends
 * "GM only" to the Eyebrow in the same breath. It shipped without the words first — the two
 * Eyebrows read "The table" and "Players", so the violet edge was the only thing separating the
 * GM-only groups from *Mine*, which is exactly the claim §9 makes and the markup did not have.
 * "GM only" unhyphenated is the reveal vocabulary's spelling (play-vocabulary.test.ts). The
 * Eyebrow is the section's accessible name, so a screen reader reaches it.
 */
function Group({ id, label, gmOnly = false, children }: Readonly<{ id: string; label: string; gmOnly?: boolean; children: React.ReactNode }>) {
  return <section className={`settings-group settings-group--${id} surface-glass${gmOnly ? " rim-gm" : ""}`} aria-labelledby={`settings-${id}`}>
    <Eyebrow id={`settings-${id}`}>{label}{gmOnly ? " · GM only" : ""}</Eyebrow>
    {children}
  </section>;
}

/** One labelled setting: a title, the control, and at most one line of help. */
function Row({ title, help, children, stacked = false }: Readonly<{ title: string; help?: string; children: React.ReactNode; stacked?: boolean }>) {
  return <div className={`settings-row${stacked ? " stacked" : ""}`}>
    <div className="settings-row-text">
      <span className="settings-row-title">{title}</span>
      {help && <span className="settings-row-help">{help}</span>}
    </div>
    <div className="settings-row-control">{children}</div>
  </div>;
}

// ───────────────────────────────── Mine (every role) ─────────────────────────────────

function MineGroup() {
  const { rollInput, setRollInput } = useRollPreference();
  return <Group id="mine" label="Mine">
    <Row title="Theme" help="This device.">
      <ThemeToggle />
    </Row>
    <Row title="How you roll" help="'I roll my dice' asks you to type what your physical dice show.">
      <SegmentedControl
        ariaLabel="How you roll"
        value={rollInput}
        onChange={(value) => setRollInput(value as "digital" | "manual")}
        options={[{ value: "digital", label: "Auto-roll" }, { value: "manual", label: "I roll my dice" }]}
      />
    </Row>
  </Group>;
}

// ───────────────────────────────── The table (GM only) ─────────────────────────────────

function TableGroup({ state, gmToken, onSignOut, onRevokeAll, busy }: Readonly<{
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

  /** Every write on this page is the same shape: emit, and say so only when it fails. */
  const send = (event: string, payload: Record<string, unknown>, failure: string) => {
    (socket.emit as (event: string, payload: unknown, ack: (result: Ack) => void) => void)(
      event, { commandId: newId(), ...payload }, (result) => { if (!result.ok) toast(result.message ?? failure, { tone: "error" }); }
    );
  };

  const setDial = (dial: RuleMode) => send("rules:set-policy", { dial, exceptions: policy.exceptions }, "The rules setting was rejected.");
  /**
   * A toggle ON pins that family Off whatever the dial says; OFF removes the key, which is what "follow
   * the dial" IS on the wire (an absent key). Exception beats dial, server-side — this control is a 1:1
   * map onto `rulesPolicy.exceptions`, never a second policy the client keeps.
   */
  const setException = (family: RuleFamily, off: boolean) => {
    const next: RuleExceptions = { ...policy.exceptions };
    if (off) next[family] = "freeform"; else delete next[family];
    send("rules:set-policy", { dial: policy.dial, exceptions: next }, "The rules exception was rejected.");
  };

  const setBuilderPolicy = (change: Partial<{ allowedAbilityMethods: readonly BuilderAbilityMethod[]; customFormula: string | null; maxLevel: number; playerBuilder: "open" | "gm-only" }>) =>
    send("builder:set-policy", {
      allowedAbilityMethods: builder.allowedAbilityMethods,
      customFormula: builder.customFormula,
      maxLevel: builder.maxLevel,
      playerBuilder: builder.playerBuilder,
      ...change
    }, "That builder setting was rejected.");

  const toggleMethod = (id: BuilderAbilityMethod, on: boolean) => {
    const next = on ? [...builder.allowedAbilityMethods, id] : builder.allowedAbilityMethods.filter((method) => method !== id);
    // The server requires at least one method; refusing here says why instead of bouncing a rejection.
    if (next.length === 0) { toast("Leave the players at least one way to set ability scores.", { tone: "error" }); return; }
    setBuilderPolicy({ allowedAbilityMethods: next });
  };

  const health = state.combat.healthDisplay;

  return <Group id="table" label="The table" gmOnly>
    <Row title="Rules assistant" help="Each fight starts from this and can be changed mid-fight on the Table." stacked>
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
          return <div key={family} className="settings-exception">
            <Switch checked={stored === "freeform"} onChange={(next) => setException(family, next)} label={label} />
            {/* A family the GM (or the shipped default) parked at Advise while the dial says Enforce is
                neither on nor off. Saying which it is beats a switch that looks the same either way. */}
            {stored && stored !== "freeform" && stored !== policy.dial && <Badge tone="info">{dialLabel(stored)}</Badge>}
          </div>;
        })}
      </div>
    </Row>

    <Row title="Max party level" help="Players can build and level their own characters up to this level.">
      <Stepper value={builder.maxLevel} min={1} max={20} aria-label="Max party level" onChange={(maxLevel) => setBuilderPolicy({ maxLevel })} />
    </Row>

    <Row title="Health display" help="Per-token overrides stay on the token's own menu." stacked>
      <div className="settings-inline">
        <Select
          value={health.style}
          aria-label="Health display style"
          onChange={(event) => send("encounter:set-health-display", { style: event.target.value, audience: health.audience }, "The health display was rejected.")}
        >
          {HEALTH_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
        </Select>
        <span className="settings-inline-label">Health is:</span>
        <SegmentedControl
          ariaLabel="Who sees health"
          value={health.audience}
          onChange={(value) => send("encounter:set-health-display", { style: health.style, audience: value }, "The health display was rejected.")}
          options={[{ value: "gm", label: "GM only" }, { value: "all", label: "Shown to players" }]}
        />
      </div>
    </Row>

    <Row title="New tokens" help="What a newly staged character or monster starts as." stacked>
      <RevealSwitch
        revealed={state.stagingDefaults.visibility === "public"}
        ariaLabel="New tokens shown to players"
        onChange={(revealed) => send("table:set-staging-defaults", { visibility: revealed ? "public" : "gm-only" }, "The staging default was rejected.")}
      />
      <Switch checked={autoArrange} onChange={setAutoArrange} label="Open new scenes for arranging automatically" />
      <p className="settings-note">Arranging is private to you — this device.</p>
    </Row>

    <Row title="Players' hits">
      <SegmentedControl
        ariaLabel="Players' hits"
        value={state.combat.playerDamageMode}
        onChange={(value) => send("encounter:set-player-damage-mode", { mode: value }, "That setting was rejected.")}
        options={[{ value: "proposal", label: "Applied by the GM" }, { value: "direct", label: "Applied immediately" }]}
      />
    </Row>

    <Row title="Players' initiative" help="When players roll their own initiative at the start of a fight.">
      <SegmentedControl
        ariaLabel="When turns start"
        value={state.combat.playerInitiativeMode}
        onChange={(value) => send("encounter:set-player-initiative-mode", { mode: value }, "That setting was rejected.")}
        options={[{ value: "immediate", label: "Start turns immediately" }, { value: "wait", label: "When everyone has rolled" }]}
      />
    </Row>

    <Row title="Builder policy" help="Who may build characters, and how their ability scores are set." stacked>
      <Switch
        checked={builder.playerBuilder === "open"}
        onChange={(open) => setBuilderPolicy({ playerBuilder: open ? "open" : "gm-only" })}
        label="Players can build & level their own characters"
      />
      <div className="settings-methods" role="group" aria-label="Ability score methods">
        {ABILITY_METHODS.map((method) => <Switch
          key={method.id}
          checked={builder.allowedAbilityMethods.includes(method.id)}
          onChange={(on) => toggleMethod(method.id, on)}
          label={method.label}
        />)}
      </div>
      {builder.allowedAbilityMethods.includes("custom") && <div className="settings-inline">
        <Input
          value={formula}
          aria-label="Custom ability formula"
          placeholder="4d6kh3"
          maxLength={160}
          onChange={(event) => setFormula(event.target.value)}
        />
        <Button variant="secondary" disabled={formula.trim() === (builder.customFormula ?? "")} onClick={() => setBuilderPolicy({ customFormula: formula.trim() || null })}>Save formula</Button>
      </div>}
    </Row>

    <div className="settings-subsection">
      <span className="settings-subhead">Access &amp; integrations</span>
      <IntegrationsPanel gmToken={gmToken} />
      <div className="settings-session">
        <Button variant="secondary" onClick={onSignOut} disabled={busy}>Sign out</Button>
        <Button variant="destructive" onClick={onRevokeAll} disabled={busy}>Revoke all GM sessions</Button>
      </div>
    </div>
  </Group>;
}

// ───────────────────────────────── Players (GM only) ─────────────────────────────────

/**
 * **Projection guard.** Every row is built from claim + presence the GM view already carries
 * (`GmActor.ownerSessionId`, `GmActor.presence`) — no session id, token, address or any other
 * player-identifying value exists in the projection, and none is added for this surface. A player who
 * has connected but claimed nobody is, by construction, not visible to the GM as a row: the table's
 * model of "a player" IS a claimed character.
 */
function PlayersGroup({ state, gmToken, onPreviewPlayers }: Readonly<{ state: GmView; gmToken: string; onPreviewPlayers: () => void }>) {
  const { toast } = useToast();
  const [tokenFor, setTokenFor] = useState<Readonly<{ id: string; name: string; definitionId?: string; assetId: string | null }> | null>(null);
  const claimed = state.actors.filter((actor) => actor.kind === "player-character" && !actor.archived && actor.ownerSessionId !== null);

  const forceRelease = (actorId: string, name: string) => {
    socket.emit("character:force-release", { commandId: newId(), actorId }, (result: Ack) => {
      if (result.ok) toast(`${name} is available to claim again.`, { tone: "success" });
      else toast(result.message ?? "That claim could not be released.", { tone: "error" });
    });
  };

  return <Group id="players" label="Players" gmOnly>
    {claimed.length === 0
      ? <p className="settings-empty">No players connected yet.</p>
      : <ul className="settings-players">
          {claimed.map((actor) => <li key={actor.id} className="settings-player">
            <Avatar name={actor.name} presence={actor.presence === "online" ? "online" : actor.presence === "reconnecting" ? "away" : "offline"} size="sm" />
            <div className="settings-player-text">
              <span className="settings-player-name">{actor.name}</span>
              <span className="settings-player-meta">{actor.presence === "online" ? "Connected" : actor.presence === "reconnecting" ? "Reconnecting" : "Away"}</span>
            </div>
            <div className="settings-player-actions">
              <Button variant="secondary" size="sm" onClick={onPreviewPlayers}>See their view</Button>
              <Button variant="secondary" size="sm" onClick={() => forceRelease(actor.id, actor.name)}>Force release</Button>
              <Button variant="secondary" size="sm" onClick={() => setTokenFor({ id: actor.id, name: actor.name, ...(actor.definitionId ? { definitionId: actor.definitionId } : {}), assetId: actor.tokenAssetId ?? null })}>Set token image…</Button>
            </div>
          </li>)}
        </ul>}
    {tokenFor && <TokenLibrary
      actorId={tokenFor.id}
      actorName={tokenFor.name}
      definitionId={tokenFor.definitionId ?? null}
      currentAssetId={tokenFor.assetId}
      token={gmToken}
      role="gm"
      onClose={() => setTokenFor(null)}
    />}
  </Group>;
}

// ───────────────────────────────── The page ─────────────────────────────────

/**
 * **A GM token is not yet a GM view.** `main.tsx` names this race where the table's scenes row
 * guards it: "the first state after login can still be player-projected ... until the session join
 * lands". On a COLD DEEP LINK to `/settings` that window is the first paint — the address
 * authenticates, a state arrives, and the join that upgrades the projection has not happened yet.
 * `PlayerView` carries `builderPolicy` verbatim but no `rulesPolicy`, no `stagingDefaults` and no
 * `combat.healthDisplay`, so `TableGroup` read `state.rulesPolicy.dial` on undefined and took the
 * whole page into the error boundary: "Cannot read properties of undefined (reading 'dial')",
 * reproduced 8/8 at 375x667 and 1280x900 (in-SPA navigation never hit it — by then the join has
 * landed).
 *
 * So guard the FIELDS, not the role, exactly as the scenes row guards `combat.scenes` with
 * `Array.isArray`: a state that does not carry the GM's own policy is not a `GmView` yet, whatever
 * the token says. The cost is one frame of a page with only *Mine* on it; the next state has the
 * fields and the GM groups mount. These three are the GM-only fields the two groups below actually
 * read — a projection either carries all of them or is not the GM's.
 */
function gmViewOrNull(state: GmView | PlayerView | null): GmView | null {
  const view = state as GmView | null;
  if (!view) return null;
  const projected = view.rulesPolicy !== undefined && view.stagingDefaults !== undefined && view.combat?.healthDisplay !== undefined;
  return projected ? view : null;
}

export function SettingsPage({ role, state, gmToken, onPreviewPlayers, onSignOut, onRevokeAll, busy = false }: Readonly<{
  role: "gm" | "player";
  state: GmView | PlayerView | null;
  /** Present exactly when `role === "gm"` — the GM groups need it for the integrations and token doors. */
  gmToken?: string | null;
  onPreviewPlayers?: () => void;
  onSignOut?: () => void;
  onRevokeAll?: () => void;
  busy?: boolean;
}>) {
  const gm = role === "gm" && gmToken ? gmViewOrNull(state) : null;
  /* THE FRAME (§7): the heading never moves, and the groups are the one region that scrolls.
     Settings no longer rides the shell's staged pane — it owns its column, its sky, and its
     scroller. */
  return <div className="settings-page pane-frame pane-scene scanlines frame-col anim-view">
    <div className="pane-sky" aria-hidden="true" />
    <header className="settings-head neon-beam">
      <h2>Settings</h2>
      <p>{role === "gm" ? "Your device, this table, and the people at it." : "Your device. The rest of the table is your GM's to set."}</p>
    </header>
    <div className="settings-body scroll-y frame-fill">
      <MineGroup />
      {gm && gmToken && <TableGroup state={gm} gmToken={gmToken} onSignOut={onSignOut ?? (() => {})} onRevokeAll={onRevokeAll ?? (() => {})} busy={busy} />}
      {gm && gmToken && <PlayersGroup state={gm} gmToken={gmToken} onPreviewPlayers={onPreviewPlayers ?? (() => {})} />}
    </div>
  </div>;
}

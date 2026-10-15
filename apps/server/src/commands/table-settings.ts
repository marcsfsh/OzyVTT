import type { PartyVisibility, RuleExceptions } from "@vtt/domain";
import {
  RulesSetPolicySchema,
  SetEnvironmentSchema,
  SetHealthDisplaySchema,
  SetPlayerDamageModeSchema,
  SetPlayerInitiativeModeSchema,
  SetRulesModeSchema,
  TableSetPartyVisibilitySchema,
  TableSetStagingDefaultsSchema
} from "@vtt/domain/commands";
import type { Kit } from "./kit.js";
import { defineCommand, type Committed } from "./pipeline.js";

// The GM's table-wide settings. Each change leaves an audit line in the feed.

// GM-only audit line per party-visibility tier. `off` removes the sheet, not the map or turn order.
const PARTY_VISIBILITY_LOG: Readonly<Record<PartyVisibility, string>> = {
  off: "Players no longer read anything of each other's sheets. Each other's characters stay on the map and in the turn order.",
  "name-and-class": "Players now see each other's name and class.",
  "full-sheet": "Players can now read each other's full sheets.",
  "sheet-and-resources": "Players can now read each other's full sheets and live resources."
};

/** GM-only audit text for a per-family exception set ("movement: freeform, slots: strict"), or "no exceptions". */
function describeRuleExceptions(exceptions: RuleExceptions): string {
  const entries = Object.entries(exceptions).filter(([, mode]) => mode !== undefined);
  return entries.length === 0 ? "no exceptions" : entries.map(([family, mode]) => `${family}: ${mode}`).join(", ");
}

/** Writes a setting's audit line once the change has committed. */
function audit(kit: Kit, committed: Committed, text: string, gmOnly = true) {
  if (!committed.duplicate) kit.context.appendLog({ kind: "encounter", text, gmOnly });
}

export const tableSettingCommands = [
  defineCommand({
    type: "encounter.set-rules-mode",
    operationId: "setRulesMode",
    description:
      "Sets the rules-engine enforcement mode (GM-grade only): `strict` rejects invalid structured actions with an overridable `error.details.blocked`, `assisted` allows them with logged warnings, `freeform` skips validation. Also settable at encounter start.",
    summary:
      "Set the LIVE fight's rules-engine enforcement mode (strict, assisted, freeform) and, optionally, its per-family exceptions (GM).",
    schema: SetRulesModeSchema,
    malformed: "The rules-mode command is malformed.",
    gmOnly: "Only the GM can change the rules mode.",
    async run({ request, execute }, kit) {
      const { mode, exceptions } = request;
      const committed = await execute((state) => {
        // Omitted exceptions leave the stored ones alone (additive field, not a reset).
        state.combat = {
          ...state.combat,
          rulesMode: mode,
          ...(exceptions === undefined ? {} : { ruleExceptions: { ...exceptions } })
        };
      });
      audit(
        kit,
        committed,
        `Rules mode set to ${mode}${exceptions === undefined ? "" : ` (${describeRuleExceptions(exceptions)})`}.`
      );
    }
  }),

  defineCommand({
    type: "rules.set-policy",
    operationId: "setRulesPolicy",
    description:
      "Sets the table's STANDING rules policy (GM-grade only): the dial every new fight starts from, plus per-family exceptions (movement, economy, resources, targeting, slots). This is campaign policy, not the live fight - use the rules-mode command to change the fight in progress. Omitting `exceptions` keeps the stored ones. The `slots` family ships as `assisted` so slot tracking advises rather than blocks until a GM opts in.",
    summary:
      "Set the table's standing rules policy - the dial and per-family exceptions every new fight starts from (GM).",
    schema: RulesSetPolicySchema,
    malformed: "The rules-policy command is malformed.",
    gmOnly: "Only the GM can set the rules policy.",
    // Campaign policy, so not on `combat`; the running fight is `encounter.set-rules-mode`'s.
    async run({ request, execute }, kit) {
      const { dial, exceptions } = request;
      const committed = await execute((state) => {
        state.rulesPolicy = {
          dial,
          exceptions: exceptions === undefined ? { ...state.rulesPolicy.exceptions } : { ...exceptions }
        };
      });
      audit(
        kit,
        committed,
        `Table rules policy set to ${dial}${exceptions === undefined ? "" : ` (${describeRuleExceptions(exceptions)})`}.`
      );
    }
  }),

  defineCommand({
    type: "table.set-staging-defaults",
    operationId: "setStagingDefaults",
    description:
      'Sets the table\'s staging defaults (GM-grade only): the token visibility a newly staged combatant starts at. A surface initializes its "Shown to players / GM only" toggle from this; the per-add `visibility` argument stays explicit on the wire, so a command still says exactly what it did.',
    summary: "Set the table's staging defaults: the token visibility a newly staged combatant starts at (GM).",
    schema: TableSetStagingDefaultsSchema,
    malformed: "The staging-defaults command is malformed.",
    gmOnly: "Only the GM can set the table's staging defaults.",
    // Stored only: surfaces initialize their toggles from it; a per-add `visibility` stays explicit.
    async run({ request, execute }, kit) {
      const { visibility } = request;
      const committed = await execute((state) => {
        state.stagingDefaults = { visibility };
      });
      audit(
        kit,
        committed,
        `New combatants now stage as ${visibility === "gm-only" ? "GM only" : "shown to players"}.`
      );
    }
  }),

  defineCommand({
    type: "table.set-party-visibility",
    operationId: "setPartyVisibility",
    description:
      "Sets how much a player sees of ANOTHER player's character (GM-grade only): `off` (no party surface - the combatant still appears on the map and in the turn order, but carries no class, no sheet and no resources), `name-and-class` (the identity card - the default), `full-sheet` (plus their read-only imported sheet) or `sheet-and-resources` (plus live spell slots, prepared spells, inventory, currency, hit dice and limited uses). The tier subtracts FIELDS, never combatants, and is applied SERVER-SIDE in the player projection - a withheld field is never sent. A player's own claimed character is unaffected at every tier.",
    summary:
      "Set how much a player sees of another player's character: nothing, name and class, the full sheet, or the sheet plus live resources (GM).",
    schema: TableSetPartyVisibilitySchema,
    malformed: "The party-visibility command is malformed.",
    gmOnly: "Only the GM can set what players see of each other.",
    // Enforced in `projectPlayerView`.
    async run({ request, execute }, kit) {
      const committed = await execute((state) => {
        state.partyVisibility = request.visibility;
      });
      audit(kit, committed, PARTY_VISIBILITY_LOG[request.visibility]);
    }
  }),

  defineCommand({
    type: "encounter.set-player-damage-mode",
    operationId: "setPlayerDamageMode",
    description:
      "Sets how a player's own confirmed hit reaches an enemy's HP (GM-grade only): `proposal` parks a GM-confirmed damage proposal (the default), `direct` applies the typed damage immediately server-side.",
    summary:
      "Set how a player's own hit reaches an enemy's HP: a GM-confirmed proposal or direct server-side apply (GM).",
    schema: SetPlayerDamageModeSchema,
    malformed: "The player-damage-mode command is malformed.",
    gmOnly: "Only the GM can change how players' hits apply damage.",
    async run({ request, execute }, kit) {
      const { mode } = request;
      const committed = await execute((state) => {
        state.combat = { ...state.combat, playerDamageMode: mode };
      });
      audit(
        kit,
        committed,
        `Players' hits now ${mode === "direct" ? "apply damage directly" : "wait for the GM to confirm"}.`
      );
    }
  }),

  defineCommand({
    type: "encounter.set-player-initiative-mode",
    operationId: "setPlayerInitiativeMode",
    description:
      "Sets how player-rolled initiative behaves (GM-grade only): `immediate` begins turns at once on a provisional order that re-sorts as players roll in, `wait` holds turn advancement until every player has rolled (or the GM rolls the rest).",
    summary: "Set whether player-rolled initiative begins turns immediately or waits for all players to roll (GM).",
    schema: SetPlayerInitiativeModeSchema,
    malformed: "The initiative-mode command is malformed.",
    gmOnly: "Only the GM can change how player initiative works.",
    async run({ request, execute }, kit) {
      const { mode } = request;
      const committed = await execute((state) => {
        state.combat = { ...state.combat, playerInitiativeMode: mode };
      });
      audit(
        kit,
        committed,
        `Player initiative now ${mode === "wait" ? "waits for everyone to roll" : "begins immediately"}.`
      );
    }
  }),

  defineCommand({
    type: "encounter.set-health-display",
    operationId: "setHealthDisplay",
    description:
      "Sets the table-wide default for how token health shows on the map (GM-grade only): `band` a coarse status badge, `bar` a thin HP bar, or `ring` a green-to-red ring; `audience` `gm` keeps a bar/ring on the GM map only, `all` shows it to players and the shared screen. Exact hit points never leave the GM - non-owners see only a coarse band-fraction. A single token can override this via the actor health-display command.",
    summary:
      "Set the table-wide default for how token health shows on the map: status badge, HP bar, or health ring, for the GM only or everyone (GM).",
    schema: SetHealthDisplaySchema,
    malformed: "The health-display command is malformed.",
    gmOnly: "Only the GM can change how health is shown.",
    async run({ request, execute }, kit) {
      const { style, audience } = request;
      const committed = await execute((state) => {
        state.combat = { ...state.combat, healthDisplay: { style, audience } };
      });
      audit(
        kit,
        committed,
        `Token health now shows as ${style === "band" ? "a status badge" : style === "bar" ? "an HP bar" : "a health ring"}${audience === "all" ? ", for everyone." : ", on the GM map only."}`
      );
    }
  }),

  defineCommand({
    type: "encounter.set-environment",
    operationId: "setEnvironment",
    description:
      "Toggles the underwater environment on the live encounter (GM-grade only; SRD Underwater Combat): melee attacks take Disadvantage unless they deal piercing damage, ranged attacks automatically miss beyond normal range, and every combatant resists fire damage.",
    summary:
      "Toggle the underwater environment: melee disadvantage unless piercing, ranged auto-miss beyond normal range, fire resistance for all (GM).",
    schema: SetEnvironmentSchema,
    malformed: "The environment command is malformed.",
    gmOnly: "Only the GM can change the encounter environment.",
    async run({ request, execute }, kit) {
      const { underwater } = request;
      const committed = await execute((state) => {
        state.combat = { ...state.combat, underwater };
      });
      // Public: the whole table fights under these rules.
      audit(
        kit,
        committed,
        underwater
          ? "The fight is now underwater: melee has Disadvantage unless it deals piercing damage, ranged attacks miss beyond normal range, and everyone resists fire."
          : "The fight is no longer underwater.",
        false
      );
    }
  })
];

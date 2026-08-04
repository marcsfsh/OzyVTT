import { z } from "zod";
import { AnnotationPointSchema, AnnotationShapeKindSchema, AnnotationVisibilitySchema, AskableCommandSchema, BuilderAbilityMethodSchema, EncounterTokenPositionSchema, RollPurposeSchema, RollVisibilitySchema, RuleExceptionsSchema, RuleModeSchema } from "@vtt/domain";
import { AbilitySchema, CharacterChoiceSchema, CharacterIdentitySchema, CurrencySchema, InventoryItemSchema, ProficienciesSchema } from "@vtt/schemas";

/**
 * Wire schemas for every game command, shared by BOTH transports: the Socket.IO handlers in
 * `server.ts` and the public HTTP API (`game-http.ts`) parse requests with these exact schemas, so
 * the two surfaces can never drift apart on what a command accepts. `commandId` doubles as the
 * idempotency receipt key in the store; `expectedRevision` is the optimistic-concurrency guard.
 *
 * Per-command credential scopes are public contract and live in `@vtt/api-contract`
 * (`GAME_COMMAND_SCOPES`); they are re-exported here for the registry and routes.
 */
export { GAME_COMMAND_SCOPES, type GameCommandType } from "@vtt/api-contract";

/**
 * A GM override of a rules block. The reason is OPTIONAL (D9): the override has to be one tap, so a
 * mandatory modal was the wrong shape. Audit lines fall back to "GM override" when none is given,
 * and old clients that always send a reason keep working unchanged - this is a loosening, not a break.
 */
export const RulesOverrideSchema = z.object({ reason: z.string().trim().min(1).max(300).optional() }).strict();
/** Per-family exceptions on the wire are STRICT: a misspelled family is a rejection, never a silent no-op. */
export const WireRuleExceptionsSchema = RuleExceptionsSchema.strict();
export const CommandIdentitySchema = z.object({ commandId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
// Turn navigation carries an optional confirmation flag: Next may rewrite history, Previous may discard an in-place change.
export const InitiativeNextSchema = z.object({ commandId: z.string().uuid(), confirmRewrite: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const InitiativePreviousSchema = z.object({ commandId: z.string().uuid(), confirmDiscard: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const EncounterStartSchema = z.object({
  commandId: z.string().uuid(),
  mapAssetId: z.string().uuid(),
  /** Omitted derives the combatants from the LIVE scene's staged list, server-side - the server owns who is in the staged fight, not the client's copy of it. Supplying entries stays valid and unchanged. */
  entries: z.array(z.object({ actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000).optional(), /** 2024 surprise: the combatant rolls initiative with disadvantage (SRD Surprise). */ surprised: z.boolean().optional() }).strict()).min(1).max(200).optional(),
  /** Rules-engine enforcement for this fight (ADR-0020); omitted seeds from the table's standing rules policy. */
  rulesMode: RuleModeSchema.optional(),
  /** Per-family exceptions for this fight; omitted seeds from the table's standing rules policy. */
  ruleExceptions: WireRuleExceptionsSchema.optional(),
  /** When true, claimed player-characters roll their own initiative (a provisional auto-roll parks them until they do). */
  playersRollInitiative: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const InitiativeScoreSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** A player rolls their own initiative (server rolls unless a manual d20 `natural` is given; adv/disadv supported). */
export const InitiativeRollSelfSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), natural: z.number().int().min(1).max(20).optional(), rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM rolls initiative for everyone still pending (begins a wait-mode fight). */
export const InitiativeRollRemainingSchema = z.object({ commandId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Table-wide policy for player-rolled initiative: begin immediately (roll in) or wait for all players first (GM). */
export const SetPlayerInitiativeModeSchema = z.object({ commandId: z.string().uuid(), mode: z.enum(["immediate", "wait"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AddCombatantSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), score: z.number().int().min(-1000).max(1000).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** `joinEncounter` lands the new combatant in the running fight (roster + initiative + tray token) in ONE command; ignored when no fight is running. */
export const ActorAddFromDefinitionSchema = z.object({ commandId: z.string().uuid(), definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200), visibility: z.enum(["public", "gm-only"]).default("public"), joinEncounter: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorImportDefinitionSchema = z.object({ commandId: z.string().uuid(), definition: z.unknown(), visibility: z.enum(["public", "gm-only"]).default("public"), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSubmitImportSchema = z.object({ commandId: z.string().uuid(), definition: z.unknown(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterResolveImportSchema = z.object({ commandId: z.string().uuid(), importId: z.string().max(120), approve: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorRemoveSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetTokenImageSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), tokenAssetId: z.string().uuid().nullable(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetActorSizeSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetActorVisibilitySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), visibility: z.enum(["public", "gm-only"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetActorArchivedSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), archived: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM shares (or un-shares) an ARCHIVED character's sheet with players as a read-only keepsake (D26); default hidden. */
export const SetActorSheetPreviewSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), enabled: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const HpAmountSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), amount: z.number().int().min(1).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/**
 * Damage keeps the legacy untyped `amount` for manual adjustments; the ADR-0020 typed path adds
 * optional `parts` (per-type components the server runs through defenses), the source attribution
 * that makes the log explainable, and the crit flag driving death-save failure ticks.
 */
export const ApplyDamageSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  amount: z.number().int().min(1).max(1000),
  parts: z.array(z.object({ amount: z.number().int().min(0).max(1000), type: z.string().min(1).max(40) }).strict()).min(1).max(9).optional(),
  sourceActorId: z.string().uuid().optional(),
  sourceActionId: z.string().regex(/^[a-z0-9-]+$/).max(120).optional(),
  sourceName: z.string().min(1).max(120).optional(),
  critical: z.boolean().optional(),
  /** Knocking out a creature (SRD): a drop to 0 leaves the target Unconscious and stable instead of dying/defeated. */
  nonlethal: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const TempHpSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), amount: z.number().int().min(0).max(1000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetHpSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), current: z.number().int().min(0).max(10000), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetConditionSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60), active: z.boolean(), level: z.number().int().min(1).max(6).optional(), /** Bypass a movement-rule rejection (standing from Prone costs half Speed); audited. */ override: RulesOverrideSchema.optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const TurnUseSchema = z.object({ commandId: z.string().uuid(), slot: z.enum(["action", "bonus-action"]), used: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActionResolveSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  actionId: z.string().regex(/^[a-z0-9-]+$/).max(120),
  targetIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  template: z.object({ shape: AnnotationShapeKindSchema, origin: AnnotationPointSchema, target: AnnotationPointSchema }).strict().optional(),
  conditionId: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  /** Explicit GM roll-mode choice; wins over the engine's advantage/disadvantage aggregation. */
  rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
  /** Bypass a rules-mode rejection; the reason is audited in the combat log and journal (ADR-0020). */
  override: RulesOverrideSchema.optional(),
  /** The escapable effect to break (Escape a Grapple builtin); defaults to the actor's first effect with an escape DC. */
  effectId: z.string().min(1).max(120).optional(),
  /** GM-adjudicated cover for the target (no line-of-sight engine): half +2, three-quarters +5 to AC and Dex saves; total can't be targeted (SRD Cover). */
  cover: z.enum(["half", "three-quarters", "total"]).optional(),
  /** Free-text annotation (the Ready action's trigger), shown in the granted effect's name. */
  note: z.string().trim().min(1).max(100).optional(),
  /** false previews the attack roll only (no damage/riders/economy) so the answerer can re-roll adv/disadv or confirm; the confirming call passes the shown `attackNatural`. Non-attack actions ignore it. */
  commit: z.boolean().default(true),
  /** Apply this exact d20 face for the attack instead of rolling - confirming a preview, or a hand-rolled die. */
  attackNatural: z.number().int().min(1).max(20).optional(),
  /** Hand-entered final attack TOTAL ("final total" manual mode) - used verbatim vs AC; pair with `critical` for a nat 20. */
  attackTotal: z.number().int().min(-50).max(100).optional(),
  /** Declares a natural 20 (critical hit) for the hand-entered-total path, where the natural die can't be inferred. */
  critical: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict().refine((payload) => payload.targetIds === undefined || payload.template === undefined, { message: "Provide either explicit targets or an area template, not both." })
  .refine((payload) => payload.attackNatural === undefined || payload.attackTotal === undefined, { message: "Supply either a natural d20 or a final total, not both." });
export const SaveAnswerSchema = z.object({ commandId: z.string().uuid(), saveId: z.string().uuid(), method: z.enum(["roll", "manual"]), total: z.number().int().min(-20).max(60).optional(), rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(), commit: z.boolean().default(true), legendaryResistance: z.boolean().default(false), expectedRevision: z.number().int().nonnegative().optional() }).strict()
  .refine((payload) => payload.method !== "manual" || payload.total !== undefined, { message: "A manual answer needs the rolled total." });
export const SaveDismissSchema = z.object({ commandId: z.string().uuid(), saveId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Answer a pending reaction prompt: use (spend the reaction - halve the parked damage, or swing the opportunity attack) or decline. `actionId` picks the melee action for a leaves-reach answer (default: first melee attack, else Unarmed Strike). */
export const ReactionAnswerSchema = z.object({ commandId: z.string().uuid(), reactionId: z.string().uuid(), use: z.boolean(), actionId: z.string().regex(/^[a-z0-9-]+$/).max(120).optional(), /** Opportunity attacks (leaves-reach): false previews the swing (roll only, nothing applied) so the answerer can re-roll adv/disadv or confirm; the confirm passes attackNatural. */ commit: z.boolean().default(true), rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(), attackNatural: z.number().int().min(1).max(20).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ReactionDismissSchema = z.object({ commandId: z.string().uuid(), reactionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Read-only availability lookup (no commandId - nothing mutates). */
export const ActorAvailableActionsSchema = z.object({ actorId: z.string().uuid() }).strict();
export const ContentActionsSchema = z.object({ definitionId: z.string().regex(/^[a-z0-9-]+$/).max(200) }).strict();
export const TurnReactionSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), used: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM absolute set of a legendary creature's spent legendary actions this round (manual escape hatch - structured legendary resolves spend automatically; the pool refills at the creature's own turn start). */
export const TurnLegendarySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), spent: z.number().int().min(0).max(10), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM-added house effect (ADR-0020); structured actions create richer instances via their `grants`/`onHit` declarations. */
export const EffectAddSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/).max(40)).max(8).optional(),
  duration: z.discriminatedUnion("type", [
    z.object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) }).strict(),
    z.object({ type: z.literal("until-source-next-turn") }).strict(),
    z.object({ type: z.literal("encounter") }).strict(),
    z.object({ type: z.literal("manual") }).strict()
  ]).optional(),
  modifiers: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("damage-bonus"), amount: z.number().int().min(-20).max(20), appliesTo: z.enum(["melee", "all"]).default("all") }).strict(),
    z.object({ type: z.literal("damage-resistance"), damageTypes: z.array(z.string().min(1).max(40)).min(1).max(20) }).strict(),
    z.object({ type: z.literal("attack-advantage") }).strict(),
    z.object({ type: z.literal("incoming-attack-advantage") }).strict(),
    z.object({ type: z.literal("attack-disadvantage") }).strict(),
    z.object({ type: z.literal("incoming-attack-disadvantage") }).strict(),
    z.object({ type: z.literal("save-advantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict(),
    z.object({ type: z.literal("save-disadvantage"), ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional() }).strict()
  ])).max(8).optional(),
  /** The granter concentrates to sustain this effect (SRD Concentration): one at a time; damage prompts a CON save; incapacitation breaks it. */
  concentration: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const EffectEndSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), effectId: z.string().min(1).max(120), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/**
 * Roll a death saving throw. The default (`commit: true`, no `naturalRoll`) rolls and applies in one
 * step - the legacy behavior. The uniform roll widget instead previews first: `commit: false` rolls
 * the d20 (honoring `rollMode` adv/disadv) and returns the projected pips WITHOUT touching them, then
 * a `commit: true` with the shown `naturalRoll` applies it - so death saves match the saving-throw
 * flow (roll, see, confirm; Adv/Disadv re-roll). A typed `naturalRoll` with `commit: true` is the
 * off-screen-die shortcut.
 */
export const DeathSaveRollSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), commit: z.boolean().default(true), rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(), naturalRoll: z.number().int().min(1).max(20).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Change the LIVE fight's dial, and optionally its per-family exceptions. Omitting `exceptions` leaves the stored ones untouched, so an old mode-only payload still means exactly what it always meant. */
export const SetRulesModeSchema = z.object({ commandId: z.string().uuid(), mode: RuleModeSchema, exceptions: WireRuleExceptionsSchema.optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/**
 * THE TAP IS THE ATTACK (D10). One command for "use this action", whatever the situation: the SERVER
 * decides whether it resolves in the fight, is refused because it is not this creature's turn, or rolls
 * as loose dice. `includeDamage` is opt-in so a sheet that renders its own damage chip cannot make the
 * same tap roll damage twice.
 */
export const ActionUseSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  actionId: z.string().regex(/^[a-z0-9-]+$/).max(120),
  targetIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
  /** Loose route only: also roll the action's damage parts in the same tap. Ignored in the fight, where the resolver rolls damage. */
  includeDamage: z.boolean().optional(),
  /** GM bypass of a rules block (including the off-turn refusal); reason optional (D9). Refused for players, like `action.resolve`. */
  override: RulesOverrideSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();

/**
 * THE SAVE CHIP ANSWERS THE QUESTION (D10). A sheet save chip used to roll a loose d20 that ignored an
 * open pending save entirely - the table watched a save happen and the tracker kept waiting for it.
 * This routes: a matching pending save is ANSWERED; with none open it is a loose, attributed save roll.
 */
export const SaveRollSchema = z.object({
  commandId: z.string().uuid(),
  actorId: z.string().uuid(),
  ability: AbilitySchema,
  rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
  /** A hand-entered final total (the off-screen die), used verbatim instead of rolling. */
  total: z.number().int().min(-50).max(100).optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();

/**
 * ASK THE GM (D8). The payload is the player's ORIGINAL command, verbatim - the server revalidates it
 * with that command's own schema before it goes anywhere, so `z.unknown()` here is a hand-off, not a
 * hole. The ask carries its own `commandId` so the ask itself is idempotent like every other command.
 */
export const RulesAskSchema = z.object({ commandId: z.string().uuid(), type: AskableCommandSchema, payload: z.unknown(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM answers a parked ask (D9): Allow re-runs the parked command with an override, Deny tells the player. The reason is OPTIONAL - one tap, never a mandatory modal. */
export const RulesAnswerSchema = z.object({ commandId: z.string().uuid(), askId: z.string().uuid(), allow: z.boolean(), reason: z.string().trim().min(1).max(300).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM sets the STANDING rules policy every new fight inherits (D7). Omitting `exceptions` keeps the stored ones (the `customFormula` tri-state precedent). */
export const RulesSetPolicySchema = z.object({ commandId: z.string().uuid(), dial: RuleModeSchema, exceptions: WireRuleExceptionsSchema.optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM sets the table's staging defaults (D2): the visibility a newly staged combatant's token starts at. */
export const TableSetStagingDefaultsSchema = z.object({ commandId: z.string().uuid(), visibility: z.enum(["public", "gm-only"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Table-wide policy for how a player's own confirmed hit reaches an enemy's HP (GM): a GM-confirmed proposal, or direct server-side apply. */
export const SetPlayerDamageModeSchema = z.object({ commandId: z.string().uuid(), mode: z.enum(["proposal", "direct"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** GM resolves a parked player-hit damage proposal: apply it (optionally overriding the total) or dismiss it. */
export const DamageResolveSchema = z.object({ commandId: z.string().uuid(), proposalId: z.string().uuid(), apply: z.boolean(), amount: z.number().int().min(0).max(1000).optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Table-wide default for how token health shows on the map (GM). */
export const SetHealthDisplaySchema = z.object({ commandId: z.string().uuid(), style: z.enum(["band", "bar", "ring", "aura"]), audience: z.enum(["gm", "all"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Per-token health-display override (GM); `display: null` clears the override so the token follows the table default. */
export const SetActorHealthDisplaySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), display: z.object({ style: z.enum(["band", "bar", "ring", "aura"]), audience: z.enum(["gm", "all"]) }).strict().nullable(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SetEnvironmentSchema = z.object({ commandId: z.string().uuid(), underwater: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Manual fog of war (GM-only). `sceneId` targets a parked scene's GM-private prep instead of the live table (the token-move pattern). */
export const FogSetEnabledSchema = z.object({ commandId: z.string().uuid(), enabled: z.boolean(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const FogPaintSchema = z.object({
  commandId: z.string().uuid(),
  op: z.enum(["reveal", "hide"]),
  rect: z.object({ x: z.number().finite().min(-100000).max(1_000_000), y: z.number().finite().min(-100000).max(1_000_000), width: z.number().finite().positive().max(1_000_000), height: z.number().finite().positive().max(1_000_000) }).strict(),
  sceneId: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const FogResetSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const ActorRestSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), kind: z.enum(["long", "short"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Spend Hit Point Dice to heal on a short rest (SRD 5.2.1: each die heals its roll + Con modifier, minimum 1). GM any actor; a player only their claimed character. */
export const ActorSpendHitDiceSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), count: z.number().int().min(1).max(40), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSetSlotSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), level: z.number().int().min(1).max(9), remaining: z.number().int().min(0).max(9), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSetPreparedSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), spellId: z.string().min(1).max(80), prepared: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSetInventorySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), item: InventoryItemSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSetCurrencySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), currency: CurrencySchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSetIdentitySchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), character: CharacterIdentitySchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const CharacterSetProficienciesSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), proficiencies: ProficienciesSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
/**
 * Create a character from CHOICES, not a finished sheet (phase-2 amendment): identity ids, base
 * scores + the background allocation, per-level HP entries, and the choices[] ledger as the literal
 * build input. The server validates every id against the content catalogs, resolves catalog-driven
 * picks through the shared `resolveCatalogChoice`, interprets feature riders, assembles the
 * ActorDefinition, and lands it through the import path (actorId = commandId; sheet keyed
 * `import-<actorId>`). Deeper cross-field validation (spreads, caps, catalog membership) lives in
 * `character-build.ts` where the content is at hand - this schema pins the wire shape.
 */
export const CharacterCreateSchema = z.object({
  commandId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  speciesId: z.string().regex(/^[a-z0-9-]+$/).max(80),
  backgroundId: z.string().regex(/^[a-z0-9-]+$/).max(80),
  classId: z.string().regex(/^[a-z0-9-]+$/).max(80),
  level: z.number().int().min(1).max(20),
  subclassId: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  abilityMethod: BuilderAbilityMethodSchema,
  baseScores: z.object({ str: z.number().int().min(1).max(30), dex: z.number().int().min(1).max(30), con: z.number().int().min(1).max(30), int: z.number().int().min(1).max(30), wis: z.number().int().min(1).max(30), cha: z.number().int().min(1).max(30) }).strict(),
  backgroundBonusAllocation: z.array(z.object({ ability: AbilitySchema, amount: z.number().int().min(1).max(3) }).strict()).max(3),
  hp: z.object({ mode: z.enum(["average", "entries"]), entries: z.array(z.number().int().min(1).max(12)).max(19).optional() }).strict(),
  choices: z.array(CharacterChoiceSchema).max(200),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
/**
 * Level a character up or down, or respec it outright (D13/D14). The shape is `CharacterCreateSchema`
 * minus the name (kept from the live actor) plus the actor to rebuild: level change and respec are
 * the same motion - the whole build is re-run from the ledger the client prefilled, and the server
 * re-validates all of it exactly as it validates a fresh create.
 */
export const CharacterRebuildSchema = CharacterCreateSchema.omit({ name: true }).extend({ actorId: z.string().uuid() }).strict();

/**
 * Roll six ability scores SERVER-SIDE (D14). The builder used to roll them in the browser, which is
 * a rule-2 violation the ledger has carried for months; the dice now come from the same authority
 * every other roll does, and land in the table feed like any other roll.
 */
export const BuilderRollAbilitiesSchema = z.object({
  commandId: z.string().uuid(),
  method: z.enum(["roll", "custom"]),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();

/**
 * GM sets the character-builder table policy (decision 10). `customFormula` semantics: omitted =
 * keep the stored formula, null = clear it, a string = validate through `validateAbilityFormula`
 * (the same dice grammar every other roll uses) and store it. Duplicated methods are rejected.
 */
export const BuilderSetPolicySchema = z.object({
  commandId: z.string().uuid(),
  allowedAbilityMethods: z.array(BuilderAbilityMethodSchema).min(1).max(4),
  customFormula: z.string().trim().min(1).max(160).nullable().optional(),
  /** Highest level this table builds to; omitted keeps the stored cap (same tri-state spirit as `customFormula`). */
  maxLevel: z.number().int().min(1).max(20).optional(),
  /** Whether players may run the builder themselves; omitted keeps the stored setting. */
  playerBuilder: z.enum(["open", "gm-only"]).optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict().superRefine((payload, context) => {
  if (new Set(payload.allowedAbilityMethods).size !== payload.allowedAbilityMethods.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["allowedAbilityMethods"], message: "Each ability method may be listed once." });
  }
});
export const DiceRollSchema = z.object({ commandId: z.string().uuid(), formula: z.string().min(1).max(160), purpose: RollPurposeSchema, visibility: RollVisibilitySchema, label: z.string().min(1).max(80).optional(), actorId: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const TokenMoveSchema = z.object({
  commandId: z.string().uuid(), actorId: z.string().uuid(), position: EncounterTokenPositionSchema.nullable(), sceneId: z.string().uuid().optional(),
  /** GM-grade bypass of a movement-rule rejection (speed budget); audited like every override. */
  override: RulesOverrideSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
/** GM-set walking speed; null clears to unknown (movement rules then skip for that combatant). */
export const ActorSetSpeedSchema = z.object({ commandId: z.string().uuid(), actorId: z.string().uuid(), speedFeet: z.number().int().min(0).max(500).nullable(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneNameSchema = z.string().trim().min(1).max(120);
/** `activate: true` goes live on the new scene in the same command (prepare-and-go), parking whatever was live - the same swap `scene.activate` performs. */
export const SceneCreateSchema = z.object({ commandId: z.string().uuid(), name: SceneNameSchema, mapAssetId: z.string().uuid(), combatantIds: z.array(z.string().uuid()).max(200), activate: z.boolean().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneRenameSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid(), name: SceneNameSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneIdSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/**
 * Make one recorded moment live (D25). `turnIndex` is an index into the archive document's `turns`
 * array - the same list the replay viewer scrubs through - not a timeline revision.
 */
export const ReplayLaunchSchema = z.object({ commandId: z.string().uuid(), archiveId: z.number().int().positive(), turnIndex: z.number().int().min(0).max(999), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const SceneSetCombatantsSchema = z.object({ commandId: z.string().uuid(), sceneId: z.string().uuid(), combatantIds: z.array(z.string().uuid()).max(200), expectedRevision: z.number().int().nonnegative().optional() }).strict();
/** Reorder the prepared-scene list to a permutation of the current scene ids (GM). Bounded by the domain scenes cap (20). */
export const SceneReorderSchema = z.object({ commandId: z.string().uuid(), order: z.array(z.string().uuid()).min(1).max(20), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationGeometryInputSchema = z.object({ origin: AnnotationPointSchema, target: AnnotationPointSchema }).strict();
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const AnnotationAddSchema = z.object({
  commandId: z.string().uuid(),
  kind: z.enum(["measurement", "shape"]),
  shape: AnnotationShapeKindSchema.optional(),
  geometry: AnnotationGeometryInputSchema,
  visibility: AnnotationVisibilitySchema.optional(),
  visibleToActorId: z.string().uuid().nullable().optional(),
  movableByOthers: z.boolean().optional(),
  color: HexColorSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict();
export const AnnotationPingSchema = z.object({ commandId: z.string().uuid(), point: AnnotationPointSchema, color: HexColorSchema.optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationColorSetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), color: HexColorSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationMoveSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), geometry: AnnotationGeometryInputSchema, expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationRemoveSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationVisibilitySetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), visibility: AnnotationVisibilitySchema, visibleToActorId: z.string().uuid().nullable().optional(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationMovableSetSchema = z.object({ commandId: z.string().uuid(), id: z.string().uuid(), movableByOthers: z.boolean(), expectedRevision: z.number().int().nonnegative().optional() }).strict();
export const AnnotationClearSchema = z.object({ commandId: z.string().uuid(), scope: z.enum(["mine", "players", "all"]), expectedRevision: z.number().int().nonnegative().optional() }).strict();

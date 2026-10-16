import { z } from "zod";
import { CharacterDraftSchema } from "./character-draft.js";
import {
  AnnotationPointSchema,
  AnnotationShapeKindSchema,
  AnnotationVisibilitySchema,
  AskableCommandSchema,
  BuilderAbilityMethodSchema,
  EncounterTokenPositionSchema,
  PartyVisibilitySchema,
  RollPurposeSchema,
  RollVisibilitySchema,
  RuleExceptionsSchema,
  RuleFamilySchema,
  RuleModeSchema
} from "./state.js";
import {
  AbilitySchema,
  CharacterChoiceSchema,
  CharacterIdentitySchema,
  CurrencySchema,
  EffectModifiersSchema,
  InventoryItemSchema,
  ProficienciesSchema
} from "@vtt/schemas";

// Wire schemas for every game command, shared by the socket handlers and the HTTP API. `commandId` is
// the idempotency key; `expectedRevision` the optimistic-concurrency guard.

/** A GM override of a rules block. The reason is optional so an override is one tap; audit lines fall back to "GM override". */
/** A GM override. `families` limits it to those kinds of block (an Allow names the one the GM was asked about);
 *  absent, it waives every block on the command. */
export const RulesOverrideSchema = z
  .object({
    reason: z.string().trim().min(1).max(300).optional(),
    families: z.array(RuleFamilySchema).min(1).max(5).optional()
  })
  .strict();
/** Per-family exceptions on the wire are strict: a misspelled family is a rejection, never a silent no-op. */
export const WireRuleExceptionsSchema = RuleExceptionsSchema.strict();
export const CommandIdentitySchema = z
  .object({ commandId: z.uuid(), expectedRevision: z.number().int().nonnegative().optional() })
  .strict();
// Turn navigation carries an optional confirmation flag: Next may rewrite history, Previous may discard an in-place change.
export const InitiativeNextSchema = z
  .object({
    commandId: z.uuid(),
    confirmRewrite: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const InitiativePreviousSchema = z
  .object({
    commandId: z.uuid(),
    confirmDiscard: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const EncounterStartSchema = z
  .object({
    commandId: z.uuid(),
    mapAssetId: z.uuid(),
    /** Omitted means the server derives combatants from the live scene's staged list rather than trusting the client's copy. */
    entries: z
      .array(
        z
          .object({
            actorId: z.uuid(),
            score: z.number().int().min(-1000).max(1000).optional(),
            /** 2024 surprise: the combatant rolls initiative with disadvantage (SRD Surprise). */ surprised: z
              .boolean()
              .optional()
          })
          .strict()
      )
      .min(1)
      .max(200)
      .optional(),
    /** Rules-engine enforcement for this fight (ADR-0020); omitted seeds from the table's standing rules policy. */
    rulesMode: RuleModeSchema.optional(),
    /** Per-family exceptions for this fight; omitted seeds from the table's standing rules policy. */
    ruleExceptions: WireRuleExceptionsSchema.optional(),
    /** When true, claimed player-characters roll their own initiative (a provisional auto-roll parks them until they do). */
    playersRollInitiative: z.boolean().optional(),
    /** SRD: one initiative roll for each group of identical monsters, so they act together. */
    groupMonsters: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const InitiativeScoreSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    score: z.number().int().min(-1000).max(1000),
    /** Orders combatants tied on `score` (higher acts first); the GM settles ties the dice don't. */
    tieBreaker: z.number().int().min(-1000).max(1000).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A player rolls their own initiative: the server rolls unless a manual d20 `natural` is given, under the roll mode
 *  the rules give (Surprise, conditions, features). `rollMode` is a GM override and is ignored from a player. */
export const InitiativeRollSelfSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    natural: z.number().int().min(1).max(20).optional(),
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM rolls initiative for everyone still pending (begins a wait-mode fight). */
export const InitiativeRollRemainingSchema = z
  .object({ commandId: z.uuid(), expectedRevision: z.number().int().nonnegative().optional() })
  .strict();
/** Table-wide policy for player-rolled initiative: begin immediately (roll in) or wait for all players first (GM). */
export const SetPlayerInitiativeModeSchema = z
  .object({
    commandId: z.uuid(),
    mode: z.enum(["immediate", "wait"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Alert's Initiative Swap, made by the GM for the table: two combatants trade initiative scores. */
export const InitiativeSwapSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    withActorId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AddCombatantSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    score: z.number().int().min(-1000).max(1000).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** `joinEncounter` lands the new combatant in the running fight (roster + initiative + tray token) in one command; ignored when no fight is running. */
export const ActorAddFromDefinitionSchema = z
  .object({
    commandId: z.uuid(),
    definitionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(200),
    visibility: z.enum(["public", "gm-only"]).default("public"),
    joinEncounter: z.boolean().optional(),
    /** The stat block's average hit points (the default), or its Hit Dice rolled on the server. */
    hitPoints: z.enum(["average", "roll"]).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const ActorImportDefinitionSchema = z
  .object({
    commandId: z.uuid(),
    definition: z.unknown(),
    visibility: z.enum(["public", "gm-only"]).default("public"),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSubmitImportSchema = z
  .object({
    commandId: z.uuid(),
    definition: z.unknown(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterResolveImportSchema = z
  .object({
    commandId: z.uuid(),
    importId: z.string().max(120),
    approve: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const ActorRemoveSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetTokenImageSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    tokenAssetId: z.uuid().nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetActorSizeSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetActorVisibilitySchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    visibility: z.enum(["public", "gm-only"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetActorArchivedSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    archived: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM shares (or un-shares) an archived character's sheet with players as a read-only keepsake; default hidden. */
export const SetActorSheetPreviewSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const HpAmountSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    amount: z.number().int().min(1).max(1000),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Untyped `amount` for manual adjustments; the typed path (ADR-0020) adds `parts`, source attribution
 *  and the crit flag that drives death-save failures. */
export const ApplyDamageSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    amount: z.number().int().min(1).max(1000),
    parts: z
      .array(z.object({ amount: z.number().int().min(0).max(1000), type: z.string().min(1).max(40) }).strict())
      .min(1)
      .max(9)
      .optional(),
    /** Manual entry's damage type: absent or "untyped" skips defenses; open text so homebrew types match. Ignored with `parts`. */
    damageType: z.string().trim().min(1).max(40).optional(),
    /** A hand-entered total that replaces what was rolled while keeping its types (the server re-weights `parts`). */
    damageOverride: z.number().int().min(0).max(1000).optional(),
    sourceActorId: z.uuid().optional(),
    sourceActionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120)
      .optional(),
    sourceName: z.string().min(1).max(120).optional(),
    critical: z.boolean().optional(),
    /** Knocking out a creature (SRD): a drop to 0 leaves the target Unconscious and stable instead of dying/defeated. */
    nonlethal: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TempHpSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    amount: z.number().int().min(0).max(1000),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetHpSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    /** Omitted with `maximum`: current hit points stay, up to the new maximum. */
    current: z.number().int().min(0).max(10000).optional(),
    /** A new hit point maximum, set before `current` (a tougher ogre, a Life Drain). */
    maximum: z.number().int().min(1).max(10000).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetConditionSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    conditionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60),
    active: z.boolean(),
    level: z.number().int().min(1).max(6).optional(),
    /** Bypass a rules rejection (standing from Prone costs half Speed, on your own turn; a condition someone else
     *  imposed is theirs to end); audited. */ override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TurnUseSchema = z
  .object({
    commandId: z.uuid(),
    slot: z.enum(["action", "bonus-action"]),
    used: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** One extra chosen for a hit: the offer's id, and a damage type or slot where the offer asks for one. */
export const HitOptionChoiceSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    damageType: z
      .string()
      .regex(/^[a-z]+$/)
      .max(40)
      .optional(),
    slotLevel: z.number().int().min(1).max(9).optional()
  })
  .strict();
export const ActionResolveSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    targetIds: z.array(z.uuid()).min(1).max(20).optional(),
    template: z
      .object({ shape: AnnotationShapeKindSchema, origin: AnnotationPointSchema, target: AnnotationPointSchema })
      .strict()
      .optional(),
    conditionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
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
    /** false previews the attack roll only (no damage/riders/economy) for re-roll or confirm; the confirm passes `attackNatural`. Non-attack actions ignore it. */
    commit: z.boolean().default(true),
    /** Apply this exact d20 face for the attack instead of rolling - confirming a preview, or a hand-rolled die. */
    attackNatural: z.number().int().min(1).max(20).optional(),
    /** Hand-entered final attack total, used verbatim vs AC; pair with `critical` for a nat 20. */
    attackTotal: z.number().int().min(-50).max(100).optional(),
    /** Declares a natural 20 (critical hit) for the hand-entered-total path, where the natural die can't be inferred. */
    critical: z.boolean().optional(),
    /** Push mastery (SRD "up to 10 feet"): how far to push on this hit, 0 to decline; absent pushes the full 10. */
    pushFeet: z.number().int().min(0).max(10).multipleOf(5).optional(),
    /** The spell slot to cast with (upcasting rolls that slot's dice); absent, the spell's own level, else the lowest
     *  above it with a slot left. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** Extras to add to this hit, from the preview's `hitOffers` (Sneak Attack, a smite and its slot, Divine Strike's
     *  type, a charge). Each is checked and spent with the hit; on a miss nothing is spent. */
    hitOptions: z.array(HitOptionChoiceSchema).max(6).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((payload) => payload.targetIds === undefined || payload.template === undefined, {
    error: "Provide either explicit targets or an area template, not both."
  })
  .refine((payload) => payload.attackNatural === undefined || payload.attackTotal === undefined, {
    error: "Supply either a natural d20 or a final total, not both."
  });
// The message `save.answer` surfaces for out-of-bounds hand-entered damage (it reports the zod issue's own text).
const SAVE_DAMAGE_BOUND = "Enter the damage as a whole number from 0 to 1000.";
export const SaveAnswerSchema = z
  .object({
    commandId: z.uuid(),
    saveId: z.uuid(),
    method: z.enum(["roll", "manual"]),
    total: z.number().int().min(-20).max(60).optional(),
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    commit: z.boolean().default(true),
    legendaryResistance: z.boolean().default(false),
    /** Hand-entered damage, applied before success halving with the proposal's types kept; a player may amend only their own character's save. */ damageOverride:
      z
        .number({ error: SAVE_DAMAGE_BOUND })
        .int(SAVE_DAMAGE_BOUND)
        .min(0, SAVE_DAMAGE_BOUND)
        .max(1000, SAVE_DAMAGE_BOUND)
        .optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((payload) => payload.method !== "manual" || payload.total !== undefined, {
    error: "A manual answer needs the rolled total."
  });
export const SaveDismissSchema = z
  .object({
    commandId: z.uuid(),
    saveId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Answer a pending reaction prompt: use (halve the parked damage, or swing the opportunity attack) or decline. `actionId` picks the melee action for a leaves-reach answer (default: first melee attack, else Unarmed Strike). */
export const ReactionAnswerSchema = z
  .object({
    commandId: z.uuid(),
    reactionId: z.uuid(),
    use: z.boolean(),
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120)
      .optional(),
    /** Opportunity attacks (leaves-reach): false previews the swing (roll only, nothing applied) so the answerer can re-roll adv/disadv or confirm; the confirm passes attackNatural. */ commit:
      z.boolean().default(true),
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    attackNatural: z.number().int().min(1).max(20).optional(),
    /** Push mastery (SRD "up to 10 feet"): how far to push on this hit, 0 to decline; absent pushes the full 10. */
    pushFeet: z.number().int().min(0).max(10).multipleOf(5).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const ReactionDismissSchema = z
  .object({
    commandId: z.uuid(),
    reactionId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Read-only availability lookup (no commandId - nothing mutates). */
export const ActorAvailableActionsSchema = z.object({ actorId: z.uuid() }).strict();
/** The movement read: how much of this turn's movement a combatant has left. */
export const ActorMovementSchema = z.object({ actorId: z.uuid() }).strict();
export const ContentActionsSchema = z
  .object({
    definitionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(200)
  })
  .strict();
export const TurnReactionSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    used: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM absolute set of a creature's spent legendary actions this round (manual escape hatch; structured resolves spend automatically). */
export const TurnLegendarySchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    spent: z.number().int().min(0).max(10),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM-added house effect (ADR-0020); structured actions create richer instances via their `grants`/`onHit` declarations. */
export const EffectAddSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    tags: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(40)
      )
      .max(8)
      .optional(),
    duration: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("rounds"), rounds: z.number().int().min(1).max(100) }).strict(),
        z.object({ type: z.literal("until-source-next-turn") }).strict(),
        z.object({ type: z.literal("encounter") }).strict(),
        z.object({ type: z.literal("manual") }).strict()
      ])
      .optional(),
    /** The shared modifier vocabulary, minus what an effect cannot give back when it ends. */
    modifiers: EffectModifiersSchema.optional(),
    /** The granter concentrates to sustain this effect (SRD Concentration): one at a time; damage prompts a CON save; incapacitation breaks it. */
    concentration: z.boolean().optional(),
    /** The creature the effect comes from: with `concentration`, the one concentrating on it (the Cleric who cast
     *  the Bless on the Fighter). Absent, a concentration effect is sustained by its bearer. */
    sourceActorId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const EffectEndSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    effectId: z.string().min(1).max(120),
    /** Bypass the rules block on ending an effect someone else imposed (an Allow from the GM); audited. */
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Death save. `commit: false` previews without touching pips; `commit: true` with the shown (or a
 *  physical) `naturalRoll` applies it; `commit: true` alone rolls and applies. */
export const DeathSaveRollSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    commit: z.boolean().default(true),
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    naturalRoll: z.number().int().min(1).max(20).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Change the live fight's rules mode and optionally its per-family exceptions. Omitted `exceptions` leaves the stored ones. */
export const SetRulesModeSchema = z
  .object({
    commandId: z.uuid(),
    mode: RuleModeSchema,
    exceptions: WireRuleExceptionsSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** "Use this action": the server decides resolve, refuse (off turn) or loose roll. `includeDamage` is opt-in
 *  so a sheet with its own damage chip can't roll damage twice. */
export const ActionUseSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    actionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(120),
    targetIds: z.array(z.uuid()).min(1).max(20).optional(),
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** Loose route only: also roll the action's damage parts in the same tap. Ignored in the fight, where the resolver rolls damage. */
    includeDamage: z.boolean().optional(),
    /** GM bypass of a rules block (including the off-turn refusal); reason optional. Refused for players. */
    override: RulesOverrideSchema.optional(),
    /** The spell slot to cast with; see `action.resolve`. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** A sheet save chip: answers a matching pending save, or with none open is a loose, attributed save roll. */
export const SaveRollSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    ability: AbilitySchema,
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** A hand-entered final total (the off-screen die), used verbatim instead of rolling. */
    total: z.number().int().min(-50).max(100).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** Ask the GM. `payload` is the original command, revalidated with its own schema before use. */
export const RulesAskSchema = z
  .object({
    commandId: z.uuid(),
    type: AskableCommandSchema,
    payload: z.unknown(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM answers a parked ask: Allow re-runs the command with an override, Deny tells the player. Reason optional. */
export const RulesAnswerSchema = z
  .object({
    commandId: z.uuid(),
    askId: z.uuid(),
    allow: z.boolean(),
    reason: z.string().trim().min(1).max(300).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM sets the standing rules policy every new fight inherits. Omitted `exceptions` keeps the stored ones. */
export const RulesSetPolicySchema = z
  .object({
    commandId: z.uuid(),
    dial: RuleModeSchema,
    exceptions: WireRuleExceptionsSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM sets the table's staging defaults: the visibility a newly staged combatant's token starts at. */
export const TableSetStagingDefaultsSchema = z
  .object({
    commandId: z.uuid(),
    visibility: z.enum(["public", "gm-only"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM sets how much a player sees of another player's character (tiers in `PartyVisibilitySchema`). */
export const TableSetPartyVisibilitySchema = z
  .object({
    commandId: z.uuid(),
    visibility: PartyVisibilitySchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Table-wide policy for how a player's own confirmed hit reaches an enemy's HP (GM): a GM-confirmed proposal, or direct server-side apply. */
export const SetPlayerDamageModeSchema = z
  .object({
    commandId: z.uuid(),
    mode: z.enum(["proposal", "direct"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM resolves a parked player-hit damage proposal: apply it (optionally overriding the total) or dismiss it. */
export const DamageResolveSchema = z
  .object({
    commandId: z.uuid(),
    proposalId: z.uuid(),
    apply: z.boolean(),
    amount: z.number().int().min(0).max(1000).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Table-wide default for how token health shows on the map (GM). */
export const SetHealthDisplaySchema = z
  .object({
    commandId: z.uuid(),
    style: z.enum(["band", "bar", "ring", "aura"]),
    audience: z.enum(["gm", "all"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Per-token health-display override (GM); `display: null` clears the override so the token follows the table default. */
export const SetActorHealthDisplaySchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    display: z
      .object({ style: z.enum(["band", "bar", "ring", "aura"]), audience: z.enum(["gm", "all"]) })
      .strict()
      .nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetEnvironmentSchema = z
  .object({
    commandId: z.uuid(),
    underwater: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Manual fog of war (GM-only). `sceneId` targets a parked scene's private prep instead of the live table. */
export const FogSetEnabledSchema = z
  .object({
    commandId: z.uuid(),
    enabled: z.boolean(),
    sceneId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A dragged rect in image pixels, before the server snaps and clamps it. */
const PaintRectSchema = z
  .object({
    x: z.number().min(-100000).max(1_000_000),
    y: z.number().min(-100000).max(1_000_000),
    width: z.number().positive().max(1_000_000),
    height: z.number().positive().max(1_000_000)
  })
  .strict();
export const FogPaintSchema = z
  .object({
    commandId: z.uuid(),
    op: z.enum(["reveal", "hide"]),
    rect: PaintRectSchema,
    sceneId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const FogResetSchema = z
  .object({
    commandId: z.uuid(),
    sceneId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Difficult terrain (GM-only): mark a dragged area difficult, or clear it. `sceneId` targets a parked scene. */
export const TerrainPaintSchema = z
  .object({
    commandId: z.uuid(),
    op: z.enum(["difficult", "clear"]),
    rect: PaintRectSchema,
    sceneId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TerrainResetSchema = z
  .object({
    commandId: z.uuid(),
    sceneId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const ActorRestSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    kind: z.enum(["long", "short"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Re-make a pick a feature allows on a rest (`replaces`); `id` must be one the original pick allowed. */
export const ActorRechooseSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    offer: z
      .string()
      .regex(/^[a-z0-9-]+(:[a-z0-9-]+)?$/)
      .max(80),
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Spend Hit Point Dice to heal on a short rest (SRD 5.2.1: each die heals its roll + Con modifier, minimum 1). GM any actor; a player only their claimed character. */
export const ActorSpendHitDiceSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    count: z.number().int().min(1).max(40),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetSlotSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    level: z.number().int().min(1).max(9),
    remaining: z.number().int().min(0).max(9),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetPreparedSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    spellId: z.string().min(1).max(80),
    prepared: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetInventorySchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    item: InventoryItemSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Moves one carried row, whole, from one character to another, with the charges it has spent (GM). */
export const CharacterGiveItemSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    toActorId: z.uuid(),
    itemId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetCurrencySchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    currency: CurrencySchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetIdentitySchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    character: CharacterIdentitySchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetProficienciesSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    proficiencies: ProficienciesSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Create a character from choices, not a finished sheet; `character-build.ts` validates and assembles it. */
export const CharacterCreateSchema = z
  .object({
    commandId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    speciesId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    backgroundId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    classId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    level: z.number().int().min(1).max(20),
    subclassId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    abilityMethod: BuilderAbilityMethodSchema,
    baseScores: z
      .object({
        str: z.number().int().min(1).max(30),
        dex: z.number().int().min(1).max(30),
        con: z.number().int().min(1).max(30),
        int: z.number().int().min(1).max(30),
        wis: z.number().int().min(1).max(30),
        cha: z.number().int().min(1).max(30)
      })
      .strict(),
    backgroundBonusAllocation: z
      .array(z.object({ ability: AbilitySchema, amount: z.number().int().min(1).max(3) }).strict())
      .max(3),
    /** "average" takes the fixed value, "entries" carries typed rolls per level (2..level), "roll" has the server
     *  throw every level that has no recorded roll. */
    hp: z
      .object({
        mode: z.enum(["average", "entries", "roll"]),
        entries: z.array(z.number().int().min(1).max(12)).max(19).optional()
      })
      .strict(),
    /** The `builder.roll-abilities` roll the "roll"/"custom" scores came from, when the table has players' rolls
     *  thrown by the server. */
    abilityRollId: z.uuid().optional(),
    choices: z.array(CharacterChoiceSchema).max(200),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A builder draft for the offers read: the identity so far, and the answers by offer key or a stored ledger. */
const BuilderContentIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
const OfferKeySchema = z.string().min(1).max(200);
export const BuilderOffersSchema = z
  .object({
    speciesId: BuilderContentIdSchema.optional(),
    backgroundId: BuilderContentIdSchema.optional(),
    classId: BuilderContentIdSchema.optional(),
    level: z.number().int().min(1).max(20),
    picks: z
      .record(OfferKeySchema, z.array(BuilderContentIdSchema).max(40))
      .refine((picks) => Object.keys(picks).length <= 200)
      .optional(),
    asiIncreases: z
      .record(
        OfferKeySchema,
        z.array(z.object({ ability: AbilitySchema, amount: z.number().int().min(1).max(2) }).strict()).max(2)
      )
      .refine((increases) => Object.keys(increases).length <= 40)
      .optional(),
    choices: z.array(CharacterChoiceSchema).max(200).optional()
  })
  .strict()
  .refine((draft) => !(draft.picks && draft.choices), "Send the answers as picks or as a ledger, not both.");

/** Level up/down or respec: `CharacterCreateSchema` minus the name, plus the actor. Fully re-validated. */
export const CharacterRebuildSchema = CharacterCreateSchema.omit({ name: true }).extend({ actorId: z.uuid() }).strict();

/** Parks the caller's in-progress build: one per player session, and one for the GM. */
export const CharacterDraftSaveSchema = z.object({ commandId: z.uuid(), draft: CharacterDraftSchema }).strict();
/** Drops the caller's parked build. */
export const CharacterDraftDiscardSchema = z.object({ commandId: z.uuid() }).strict();

/** Roll a whole character: only class (or none) and level cross the wire; everything else is drawn server-side. */
export const CharacterGenerateSchema = z
  .object({
    commandId: z.uuid(),
    level: z.number().int().min(1).max(20),
    classId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    name: z.string().trim().min(1).max(120).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** Roll six ability scores server-side; they land in the table feed like any roll. */
export const BuilderRollAbilitiesSchema = z
  .object({
    commandId: z.uuid(),
    method: z.enum(["roll", "custom"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** GM builder policy. `customFormula`: omitted keeps it, null clears it, a string is validated and stored. */
export const BuilderSetPolicySchema = z
  .object({
    commandId: z.uuid(),
    allowedAbilityMethods: z.array(BuilderAbilityMethodSchema).min(1).max(4),
    customFormula: z.string().trim().min(1).max(160).nullable().optional(),
    /** Highest level this table builds to; omitted keeps the stored cap. */
    maxLevel: z.number().int().min(1).max(20).optional(),
    /** Whether players may run the builder themselves; omitted keeps the stored setting. */
    playerBuilder: z.enum(["open", "gm-only"]).optional(),
    /** Whether players may roll a random character themselves; omitted keeps the stored setting. */
    playerRandom: z.enum(["open", "gm-only"]).optional(),
    /** Whether players may type their own dice for rolled scores and hit points; omitted keeps the stored setting. */
    typedRolls: z.enum(["open", "gm-only"]).optional(),
    /** Whether a rolled hit-point level is raised to the average; omitted keeps the stored setting. */
    hitPointRollFloor: z.enum(["none", "average"]).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((payload, context) => {
    if (new Set(payload.allowedAbilityMethods).size !== payload.allowedAbilityMethods.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedAbilityMethods"],
        message: "Each ability method may be listed once."
      });
    }
  });
export const DiceRollSchema = z
  .object({
    commandId: z.uuid(),
    formula: z.string().min(1).max(160),
    purpose: RollPurposeSchema,
    visibility: RollVisibilitySchema,
    label: z.string().min(1).max(80).optional(),
    actorId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TokenMoveSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    position: EncounterTokenPositionSchema.nullable(),
    sceneId: z.uuid().optional(),
    /** GM-grade bypass of a movement-rule rejection (speed budget); audited like every override. */
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM-set walking speed; null clears to unknown (movement rules then skip for that combatant). */
export const ActorSetSpeedSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    speedFeet: z.number().int().min(0).max(500).nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM-set Armor Class that replaces the one derived from equipment; null clears it back to the derived AC. */
export const ActorSetArmorClassSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    armorClass: z.number().int().min(1).max(40).nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SceneNameSchema = z.string().trim().min(1).max(120);
/** `activate: true` goes live on the new scene in the same command, parking whatever was live (as `scene.activate` does). */
export const SceneCreateSchema = z
  .object({
    commandId: z.uuid(),
    name: SceneNameSchema,
    mapAssetId: z.uuid(),
    combatantIds: z.array(z.uuid()).max(200),
    activate: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SceneRenameSchema = z
  .object({
    commandId: z.uuid(),
    sceneId: z.uuid(),
    name: SceneNameSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SceneIdSchema = z
  .object({
    commandId: z.uuid(),
    sceneId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Make one recorded moment live. `turnIndex` indexes the archive document's `turns`, not a timeline revision. */
export const ReplayLaunchSchema = z
  .object({
    commandId: z.uuid(),
    archiveId: z.number().int().positive(),
    turnIndex: z.number().int().min(0).max(999),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SceneSetCombatantsSchema = z
  .object({
    commandId: z.uuid(),
    sceneId: z.uuid(),
    combatantIds: z.array(z.uuid()).max(200),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Reorder the prepared-scene list to a permutation of the current scene ids (GM). Bounded by the domain scenes cap (20). */
export const SceneReorderSchema = z
  .object({
    commandId: z.uuid(),
    order: z.array(z.uuid()).min(1).max(20),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationGeometryInputSchema = z
  .object({ origin: AnnotationPointSchema, target: AnnotationPointSchema })
  .strict();
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const AnnotationAddSchema = z
  .object({
    commandId: z.uuid(),
    kind: z.enum(["measurement", "shape"]),
    shape: AnnotationShapeKindSchema.optional(),
    geometry: AnnotationGeometryInputSchema,
    visibility: AnnotationVisibilitySchema.optional(),
    visibleToActorId: z.uuid().nullable().optional(),
    movableByOthers: z.boolean().optional(),
    color: HexColorSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationPingSchema = z
  .object({
    commandId: z.uuid(),
    point: AnnotationPointSchema,
    color: HexColorSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationColorSetSchema = z
  .object({
    commandId: z.uuid(),
    id: z.uuid(),
    color: HexColorSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationMoveSchema = z
  .object({
    commandId: z.uuid(),
    id: z.uuid(),
    geometry: AnnotationGeometryInputSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationRemoveSchema = z
  .object({
    commandId: z.uuid(),
    id: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationVisibilitySetSchema = z
  .object({
    commandId: z.uuid(),
    id: z.uuid(),
    visibility: AnnotationVisibilitySchema,
    visibleToActorId: z.uuid().nullable().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationMovableSetSchema = z
  .object({
    commandId: z.uuid(),
    id: z.uuid(),
    movableByOthers: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const AnnotationClearSchema = z
  .object({
    commandId: z.uuid(),
    scope: z.enum(["mine", "players", "all"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

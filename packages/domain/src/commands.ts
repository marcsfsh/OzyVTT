import { z } from "zod";
import { CharacterDraftSchema } from "./character-draft.js";
import {
  AnnotationPointSchema,
  AnnotationShapeKindSchema,
  AnnotationVisibilitySchema,
  AskableCommandSchema,
  BuilderAbilityMethodSchema,
  DoorStateSchema,
  EncounterTokenPositionSchema,
  PartyVisibilitySchema,
  RollVisibilitySchema,
  RuleExceptionsSchema,
  RuleFamilySchema,
  RuleModeSchema,
  SceneEnvironmentSchema,
  SceneInitiativeDefaultsSchema,
  DiceModeSchema,
  ScenePlayerDiceSchema,
  TableRollPurposeSchema
} from "./state.js";
import {
  AbilitySchema,
  CastShapingSchema,
  CharacterChoiceSchema,
  CharacterIdentitySchema,
  CurrencySchema,
  DamageTypeSchema,
  EffectModifiersSchema,
  InventoryItemSchema,
  MAX_FAVOURITE_OPTIONS,
  ObjectStatsSchema,
  OptionIdSchema,
  ProficienciesSchema
} from "@vtt/schemas";
import { MAX_SOUND_EFFECTS, MAX_SOUND_LAYERS, MAX_SOUND_TRACKS, SoundVolumeSchema } from "./sound.js";

// Wire schemas for every game command, shared by the socket handlers and the HTTP API. `commandId` is
// the idempotency key; `expectedRevision` the optimistic-concurrency guard.

/** A GM override of a rules block. The reason is optional so an override is one tap; audit lines fall back to "GM override". */
/** A GM override. `families` limits it to those kinds of block (an Allow names the one the GM was asked about);
 *  absent, it waives every block on the command. */
export const RulesOverrideSchema = z
  .object({
    reason: z.string().trim().min(1).max(300).optional(),
    families: z.array(RuleFamilySchema).min(1).max(6).optional()
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
    /** Omitted means the server derives combatants from the live scene's staged list and ignores any client copy. */
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
    /** Party characters played at the table for this encounter (true) or on their players' devices (false), by id
     *  (ADR-0042). One left out takes its saved mark; a claimed character can't be played at the table. */
    atTable: z.record(z.uuid(), z.boolean()).optional(),
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
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    rolledTotal: z.number().int().min(-50).max(100).optional(),
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** Reroll the initiative die just thrown (SRD Heroic Inspiration), before the character's first turn: a player
     *  spends Heroic Inspiration to reroll one die, the GM rerolls freely. With `natural`, the face a physical reroll
     *  shows, for a die that was typed. */
    reroll: z.boolean().optional(),
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
/** SRD Initiative: "the players decide the order among tied characters". A player puts their own character
 *  directly ahead of another character tied on the same score. */
export const InitiativeOrderTieSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    beforeActorId: z.uuid(),
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
/** Takes a combatant out of the running fight (GM): its initiative entry and token go, and what it sustains ends. */
export const RemoveCombatantSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
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
/** `inFight` is the GM's second yes: releasing a character who is in the running fight. */
export const CharacterForceReleaseSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    inFight: z.literal(true).optional(),
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
/** GM switch: a legendary creature fights in its lair, with the lair's legendary counts (SRD 5.2.1). */
/** The GM marks a party character played at the table, or takes the mark off (ADR-0042). */
export const SetActorPlayedAtTableSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    playedAtTable: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SetActorLairSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    inLair: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM picks what a creature's stat block leaves to the GM (a half-dragon's Draconic Origin damage type, a commoner's
 *  Training skill); null clears it. */
export const SetActorPickSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    key: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    value: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .nullable(),
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
    /** Knocking out a creature (SRD): a drop to 0 leaves the target Unconscious and stable, neither dying nor defeated. */
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
    /** GM only, for Charmed or Frightened: the charmer or the source of fear, which the rules then read (a charmed
     *  creature can't harm its charmer; a frightened one can't move closer to its source). */
    sourceActorId: z.uuid().optional(),
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
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** The effects picked with it, from the offer's `effects` (Brutal Strike's Hamstring Blow, a Cunning Strike's
     *  Trip). */
    effects: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80)
      )
      .max(3)
      .optional()
  })
  .strict();
/** An answer to a roll the answerer has seen (`answers` on its preview): the answer's id, `subtract` to take an
 *  either-way die off (Boon of Fate), and the face a physical die shows when the answer rerolls a typed d20. */
export const RollAnswerChoiceSchema = z
  .object({
    id: z.string().min(1).max(160),
    subtract: z.boolean().optional(),
    face: z.number().int().min(1).max(20).optional()
  })
  .strict();
/** How a spell's caster shapes this casting: Metamagic options paid in Sorcery Points (Careful Spell's and Heightened
 *  Spell's creatures, Transmuted Spell's new damage type) and Sculpt Spells' protected creatures. The server checks each
 *  against the caster's picks, the spell and the points left, and spends them. Each option at most once. */
const CastShapingListSchema = z
  .array(CastShapingSchema)
  .max(4)
  .refine((list) => new Set(list.map((entry) => entry.id)).size === list.length, {
    error: "Choose each way to shape the spell at most once."
  });
const SummonSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(200);
/** What the user picks for a summon: the stat blocks and how many of each (Animate Objects may mix sizes), a form of a
 *  scaled stat block, the creature type a familiar takes, the damage type of a Draconic Spirit's breath and the
 *  Resistance it shares, and where the creatures appear. */
export const SummonPickSchema = z
  .object({
    picks: z
      .array(
        z
          .object({
            monsterId: SummonSlugSchema,
            form: SummonSlugSchema.optional(),
            count: z.number().int().min(1).max(20).optional()
          })
          .strict()
      )
      .min(1)
      .max(6)
      .optional(),
    creatureType: SummonSlugSchema.optional(),
    damageType: DamageTypeSchema.optional(),
    resistance: DamageTypeSchema.optional(),
    at: AnnotationPointSchema.optional(),
    /** Cast without Concentration, for 1 minute, where the caster may (a Draconic Sorcerer's Dragon Companion). */
    withoutConcentration: z.boolean().optional()
  })
  .strict();
/** A form a shape-shift takes: a bestiary id, a printed form's id, or `true` for the user's true form. */
const FormChoiceSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(200);
/** What a shape-shifting use picks: the form, a form per target, whether the user's gear melds or is worn, and the
 *  effect it takes among its options (Enlarge or Reduce). See `action.resolve`. */
const ShapeChoiceFields = {
  form: FormChoiceSchema.optional(),
  targetForms: z
    .array(z.object({ targetId: z.uuid(), form: FormChoiceSchema }).strict())
    .max(20)
    .optional(),
  gear: z.enum(["merged", "worn"]).optional(),
  option: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80)
    .optional(),
  creatureTypes: z
    .array(
      z
        .string()
        .regex(/^[a-z][a-z-]*$/)
        .max(40)
    )
    .min(1)
    .max(14)
    .optional()
};
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
    /** Several areas for an action that places more than one (Fire Storm's Cubes, Meteor Swarm's Spheres), each placed
     *  as `template` is: up to the area's `count`, each within the spell's range, touching another where the area says
     *  so. A creature under more than one is caught once. */
    templates: z
      .array(
        z
          .object({ shape: AnnotationShapeKindSchema, origin: AnnotationPointSchema, target: AnnotationPointSchema })
          .strict()
      )
      .min(1)
      .max(10)
      .optional(),
    conditionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
    /** The GM's choice of roll mode, which wins over the engine's count of Advantage and Disadvantage. Ignored from a
     *  player: the rules decide. */
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** Bypass a rules-mode rejection; the reason is audited in the combat log and journal (ADR-0020). */
    override: RulesOverrideSchema.optional(),
    /** The escapable effect to break (Escape a Grapple builtin); defaults to the actor's first effect with an escape DC. */
    effectId: z.string().min(1).max(120).optional(),
    /** GM-adjudicated cover for the target (no line-of-sight engine): half +2, three-quarters +5 to AC and Dex saves; total can't be targeted (SRD Cover). */
    cover: z.enum(["half", "three-quarters", "total"]).optional(),
    /** Free-text annotation (the Ready action's trigger), shown in the granted effect's name. */
    note: z.string().trim().min(1).max(100).optional(),
    /** Ready this spell for later (SRD Ready): its slot is spent and it is held with Concentration until
     *  the start of the caster's next turn; casting it off-turn then releases it with the Reaction. */
    ready: z.boolean().optional(),
    /** Take the action's own move before the rest of it ("The dragon moves up to half its Speed, and it makes one
     *  Rend attack"): the action's cost is spent and the move granted now, with no target; the action taken again
     *  afterwards makes the rest at no further cost. */
    moveFirst: z.boolean().optional(),
    /** The space an action with a `destination` sets its creature down in (a bulette's Deadly Leap, a kraken's Fling),
     *  as a point on the live map; the server snaps it and checks its reach, sight and occupants. */
    destination: AnnotationPointSchema.optional(),
    /** How high above the ground an action that lifts its target sets it (Telekinesis), in feet. */
    destinationAltitudeFeet: z.number().int().min(0).max(1000).optional(),
    /** GM only: the spell area a cast that ends spells is aimed at (Dispel Magic on a Moonbeam), from
     *  `combat.spellZones`. */
    zoneId: z.string().min(1).max(120).optional(),
    /** The door or wall on the live map a cast is aimed at (Knock, Arcane Lock, Mage Hand opening a door). */
    wallId: z.uuid().optional(),
    /** A light set on the live map that a cast lights or puts out (Druidcraft's Fire Play on a torch in a sconce). */
    lightId: z.uuid().optional(),
    /** false previews the attack roll only (no damage/riders/economy). The server holds the previewed d20, so a second
     *  preview of the same attack shows the same die, and the confirm (`commit: true`) uses it. Non-attack actions
     *  ignore it. */
    commit: z.boolean().default(true),
    /** A typed d20: the face a physical die shows (the one that counts, under Advantage or Disadvantage). A player may
     *  type one only while the table lets players type their dice, and not for an attack whose die the server threw. */
    attackNatural: z.number().int().min(1).max(20).optional(),
    /** GM only: a hand-entered final attack total, used verbatim vs AC; pair with `critical` for a nat 20 or `fumble`
     *  for a nat 1. */
    attackTotal: z.number().int().min(-50).max(100).optional(),
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    attackRolledTotal: z.number().int().min(-50).max(100).optional(),
    /** GM only: declares a natural 20 (critical hit) for the hand-entered-total path. */
    critical: z.boolean().optional(),
    /** GM only: declares a natural 1 (a miss whatever the total) for the hand-entered-total path. */
    fumble: z.boolean().optional(),
    /** With `commit: false`, throw the held attack d20 again: a player spends Heroic Inspiration to reroll one die (the
     *  lowest); the GM rerolls freely. */
    reroll: z.boolean().optional(),
    /** With `commit: false`, answer the held attack roll with one of the preview's `answers` (Peerless Skill, Stroke of
     *  Luck), which then counts in every later look and the confirm. */
    answer: RollAnswerChoiceSchema.optional(),
    /** With `commit: false`, roll the damage as well and hold its dice (SRD Empowered Spell, Heroic Inspiration: "after
     *  seeing the roll"): another look shows the same dice, and the confirm deals them. The extras a hit carries
     *  (`hitOptions`) roll at the confirm. */
    damageLook: z.boolean().optional(),
    /** With `damageLook`, answer the held damage with one of its `heldDamage.answers`: reroll the dice at these
     *  positions in `heldDamage.dice`. */
    damageAnswer: z
      .object({
        id: z.enum(["empowered-spell", "heroic-inspiration"]),
        dice: z.array(z.number().int().min(0).max(199)).min(1).max(20)
      })
      .strict()
      .optional(),
    /** The skill a check action is made with: Influence (Deception, Intimidation, Performance, Persuasion or Animal
     *  Handling), Search (Insight, Medicine, Perception or Survival) or Study (Arcana, History, Investigation, Nature or
     *  Religion). */
    skill: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60)
      .optional(),
    /** The ability a cast chooses: Hex's target has Disadvantage on ability checks made with it. */
    ability: AbilitySchema.optional(),
    /** The option picked for an action that offers several (Fire Shield's warm or chill, Bestow Curse's curse);
     *  absent, the first. */
    optionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    /** An option for each target, for an action that asks for one per target (Enhance Ability's ability for each
     *  creature); a target left out takes `optionId`. */
    targetOptions: z
      .record(
        z.uuid(),
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80)
      )
      .refine((options) => Object.keys(options).length <= 20, "At most 20 targets are given options.")
      .optional(),
    /** The carried weapon an action binds to (Magic Weapon's touched weapon, Shillelagh's club). */
    itemId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    /** The armor or weapon its target wears or carries that the action acts on (a rust monster's Antennae, Mending);
     *  absent, the target's worn armor, else its weapon in hand. */
    objectItemId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    /** Push mastery (SRD "up to 10 feet"): how far to push on this hit, 0 to decline; absent pushes the full 10. */
    pushFeet: z.number().int().min(0).max(10).multipleOf(5).optional(),
    /** Who the Temporary Hit Points of an action with `vitality` go to once its damage lands (Improved Potent
     *  Spellcasting): the user, or a creature within the range it names. Absent, the user. */
    vitalityTo: z.uuid().optional(),
    /** The creature in an action's area that regains its `areaHeal` (Land's Aid), checked to stand in one area with
     *  the creatures picked. Absent, nobody regains them. */
    aidTo: z.uuid().optional(),
    /** Tactical Master (Fighter 9): the Push, Sap or Slow property this attack takes in place of its weapon's own
     *  mastery, sent with every look at the attack and its confirm. Refused for a swing that can't take it. */
    mastery: z.enum(["push", "sap", "slow"]).optional(),
    /** The spell slot to cast with (upcasting rolls that slot's dice); absent, the spell's own level, else the lowest
     *  above it with a slot left. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** The damage type picked for an action that lets its caster choose (Chromatic Orb); absent, its first. */
    damageType: DamageTypeSchema.optional(),
    /** Extras to add to this hit, from the preview's `hitOffers` (Sneak Attack, a smite and its slot, Divine Strike's
     *  type, a charge). Each is checked and spent with the hit; on a miss nothing is spent. */
    hitOptions: z.array(HitOptionChoiceSchema).max(6).optional(),
    /** How much of its pool an action that lets its user choose spends (Lay on Hands' points); refused otherwise. 0 only
     *  beside `conditionIds`, which cost points of their own. */
    spend: z.number().int().min(0).max(100).optional(),
    /** The conditions an action with `conditionPicks` also ends on its target (Restoring Touch), each costing the
     *  points it names on top of `spend`. */
    conditionIds: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60)
      )
      .min(1)
      .max(8)
      .optional(),
    /** The Hit Points each target regains from a heal its user divides (Preserve Life, Mass Heal), by target id; they
     *  add up to the pool at most, and none past what the heal lets a target regain. Absent, the pool is split evenly. */
    healingShares: z
      .record(z.uuid(), z.number().int().min(0).max(1000))
      .refine((shares) => Object.keys(shares).length <= 20, "At most 20 targets share a heal.")
      .optional(),
    /** Knocking out a creature (SRD): a melee hit that drops the target to 0 leaves it at 1 Hit Point and Unconscious
     *  instead. Refused on any other attack. */
    knockOut: z.boolean().optional(),
    /** An Evoker's Overchannel (Wizard 14): a Wizard spell cast with a level 1 to 5 slot deals its maximum damage, the
     *  caster taking Necrotic damage for each use after the first before a Long Rest. Refused for anything else. */
    overchannel: z.boolean().optional(),
    /** A Thief's Fast Hands: an item's Utilize action, or a magic item's Magic action, taken as a Bonus Action.
     *  Refused for anyone without the feature and for any other action. */
    fastHands: z.boolean().optional(),
    shaping: CastShapingListSchema.optional(),
    /** What the user picks for an action that brings creatures onto the map (Find Familiar's form, Giant Insect's
     *  spider, Summon Dragon's breath and the Resistance it shares), and the point they appear at, within the action's
     *  range. The server checks each pick against what the action offers at the cast's level. */
    summon: SummonPickSchema.optional(),
    /** A familiar delivers this spell with a range of touch (SRD 5.2.1 Find Familiar): the touch is measured from the
     *  familiar, which must be within 100 feet of its caster and takes its Reaction. */
    deliveredBy: z.uuid().optional(),
    /** The form a shape-shift takes (Wild Shape's known form, Polymorph's Beast, a werewolf's wolf): a bestiary id, a
     *  printed form's id, or `true` for the true form. Refused when it isn't one the action allows. */
    form: FormChoiceSchema.optional(),
    /** A form for each target, where each may take its own (Animal Shapes); a target not named takes `form`. */
    targetForms: z
      .array(z.object({ targetId: z.uuid(), form: FormChoiceSchema }).strict())
      .max(20)
      .optional(),
    /** Whether the user's gear melds into its new form or is worn by it, where the action lets it choose. */
    gear: z.enum(["merged", "worn"]).optional(),
    /** The creature types a cast's barrier wards, among those its spell offers (Magic Circle, Hallow); absent, all of
     *  them. */
    creatureTypes: z
      .array(
        z
          .string()
          .regex(/^[a-z][a-z-]*$/)
          .max(40)
      )
      .min(1)
      .max(14)
      .optional(),
    /** The effect a use picks among those its action offers (Enlarge or Reduce); absent, the first. */
    option: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((payload) => payload.targetIds === undefined || payload.template === undefined, {
    error: "Provide explicit targets or an area template, and only one of the two."
  })
  .refine(
    (payload) => payload.templates === undefined || (payload.template === undefined && payload.targetIds === undefined),
    {
      error: "Provide several area templates, or one template or explicit targets."
    }
  )
  .refine((payload) => payload.attackNatural === undefined || payload.attackTotal === undefined, {
    error: "Supply a natural d20 or a final total, and only one of the two."
  })
  .refine((payload) => !(payload.critical === true && payload.fumble === true), {
    error: "A roll can't be both a natural 20 and a natural 1."
  });
// The message `save.answer` surfaces for out-of-bounds hand-entered damage (it reports the zod issue's own text).
const SAVE_DAMAGE_BOUND = "Enter the damage as a whole number from 0 to 1000.";
export const SaveAnswerSchema = z
  .object({
    commandId: z.uuid(),
    saveId: z.uuid(),
    /** "roll": the server throws the d20 (or takes `face`) and adds the save's modifier. "manual": GM only, `total` is
     *  the final total as the GM rules it. "fail": the creature chooses to fail without rolling (SRD Saving Throw). */
    method: z.enum(["roll", "manual", "fail"]),
    /** GM only, with `method: "manual"`: the final total, used as given. */
    total: z.number().int().min(-20).max(60).optional(),
    /** A typed d20 for `method: "roll"`: the face a physical die shows (the one that counts). A player may type one only
     *  while the table lets players type their dice, and not once the server has thrown this save's die. */
    face: z.number().int().min(1).max(20).optional(),
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    rolledTotal: z.number().int().min(-50).max(100).optional(),
    /** The GM's choice of roll mode, which wins over the engine's count. Ignored from a player. */
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** With `commit: false`, throw the held d20 again: a player spends Heroic Inspiration to reroll one die (the
     *  lowest); the GM rerolls freely. */
    reroll: z.boolean().optional(),
    /** With `commit: false`, answer the held save with one of the preview's `answers` (Indomitable, a Bardic
     *  Inspiration die), which then counts in every later look and the confirm. */
    answer: RollAnswerChoiceSchema.optional(),
    /** false previews: the d20 is thrown and held, so a later preview or the confirm uses the same die. */
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
    /** A strike (an opportunity attack, Retaliation): false previews the swing (roll only, nothing applied). The server
     *  holds the previewed d20, so the confirm uses it. */ commit: z.boolean().default(true),
    /** The GM's choice of roll mode for the strike. Ignored from a player. */
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** A typed d20 for the strike (see `action.resolve`). */
    attackNatural: z.number().int().min(1).max(20).optional(),
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    attackRolledTotal: z.number().int().min(-50).max(100).optional(),
    /** With `commit: false`, throw the held strike d20 again: Heroic Inspiration for a player, free for the GM. */
    reroll: z.boolean().optional(),
    /** Push mastery (SRD "up to 10 feet"): how far to push on this hit, 0 to decline; absent pushes the full 10. */
    pushFeet: z.number().int().min(0).max(10).multipleOf(5).optional(),
    /** The extras the swing's previewed hit offered that the answerer adds to it (Sneak Attack), sent with the confirm. */
    hitOptions: z.array(HitOptionChoiceSchema).max(6).optional(),
    /** Redirect Attack: the ally the attack turns to; Deflect Missile and Deflect Attacks: the creature the force turns
     *  on if the damage is reduced to 0 (Deflect Attacks spends a Focus Point on it). One of the prompt's
     *  `redirectChoices`. */
    redirectTo: z.uuid().optional(),
    /** The spell slot a reaction spell is cast with (Shield, Hellish Rebuke, Counterspell): absent, its own level or the
     *  lowest above it with a slot left. A higher slot upcasts it as a cast on the caster's turn does. */
    slotLevel: z.number().int().min(1).max(9).optional(),
    /** An answer to another creature's roll that may go either way (Improve Fate): take its die off the roll. */
    subtract: z.boolean().optional(),
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
/** Read-only availability lookup (no commandId: nothing mutates). */
export const ActorAvailableActionsSchema = z.object({ actorId: z.uuid() }).strict();
/** The movement read: how much of this turn's movement a combatant has left. */
export const ActorMovementSchema = z.object({ actorId: z.uuid() }).strict();
/** The next-level read: what a character's next level brings. Nothing mutates. */
export const CharacterNextLevelSchema = z.object({ actorId: z.uuid() }).strict();
export const ContentActionsSchema = z
  .object({
    definitionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(200)
  })
  .strict();
/** A stat block's actions to run, for one combatant built from it when `actorId` names one. */
export const ContentMonsterActionsQuerySchema = z
  .object({
    /** A combatant built from the stat block: its actions as it has them now, with what its items give. */
    actorId: z.uuid().optional()
  })
  .strict();
export const ContentMonsterActionsSchema = ContentActionsSchema.extend(ContentMonsterActionsQuerySchema.shape);
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
/** Death save. `commit: false` previews without touching pips, and the server holds the die; `commit: true` applies
 *  the held die, or rolls and applies when none is held. */
export const DeathSaveRollSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    commit: z.boolean().default(true),
    /** The GM's choice of roll mode. Ignored from a player. */
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** A typed d20: the face a physical die shows. A player may type one only while the table lets players type their
     *  dice, and not once the server has thrown this death save's die. */
    naturalRoll: z.number().int().min(1).max(20).optional(),
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    rolledTotal: z.number().int().min(-50).max(100).optional(),
    /** With `commit: false`, throw the held d20 again: Heroic Inspiration for a player, free for the GM. */
    reroll: z.boolean().optional(),
    /** With `commit: false`, answer the held death save with one of the preview's `answers` (the halfling's Luck). */
    answer: RollAnswerChoiceSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Stabilize a creature at 0 hit points (`actorId`), or wake one knocked out, by the aid `helperId` gives: first aid
 *  (a DC 10 Wisdom (Medicine) check), a Healer's Kit use, Spare the Dying, or the GM's own ruling (no helper). */
export const ActorStabilizeSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    method: z.enum(["medicine", "healers-kit", "spare-the-dying", "gm"]),
    helperId: z.uuid().optional(),
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method !== "gm" && value.helperId === undefined)
      context.addIssue({ code: "custom", path: ["helperId"], message: "Choose who gives the aid." });
  });
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
    /** How much of its pool an action that lets its user choose spends; see `action.resolve`. */
    spend: z.number().int().min(1).max(100).optional(),
    /** The damage type picked; see `action.resolve`. */
    damageType: DamageTypeSchema.optional(),
    /** How the spell's caster shapes the cast (Metamagic); see `action.resolve`. Refused on the loose route. */
    shaping: CastShapingListSchema.optional(),
    /** The form a shape-shift takes, and the rest of what it picks; see `action.resolve`. */
    ...ShapeChoiceFields,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** A sheet save chip: answers a matching pending save, or with none open is a loose, attributed save roll. */
export const SaveRollSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    ability: AbilitySchema,
    /** The GM's choice of roll mode. Ignored from a player. */
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** A typed d20: the face a physical die shows (see `save.answer`). */
    face: z.number().int().min(1).max(20).optional(),
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    rolledTotal: z.number().int().min(-50).max(100).optional(),
    /** GM only: a hand-entered final total, used as given. */
    total: z.number().int().min(-50).max(100).optional(),
    /** Throw the character's latest loose save of this ability again, while it is still the character's latest roll
     *  (SRD Heroic Inspiration: "reroll any die immediately after rolling it"): a player spends Heroic Inspiration to
     *  reroll one d20, the GM throws afresh; a typed save takes `face`. */
    reroll: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((payload) => payload.face === undefined || payload.total === undefined, {
    error: "Supply a typed d20 or a final total, and only one of the two."
  })
  .refine((payload) => payload.reroll !== true || payload.total === undefined, {
    error: "A reroll throws the die again; a final total can't come with it."
  });

const SkillOrToolIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);

/**
 * An ability check rolled on the server: an ability, a skill or a tool (or a tool with the skill it uses). The server
 * works out the bonus and the Advantage or Disadvantage from the rules, and records the roll.
 */
export const CheckRollSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    ability: AbilitySchema,
    skill: SkillOrToolIdSchema.optional(),
    tool: SkillOrToolIdSchema.optional(),
    /** The DC to beat; absent, the GM adjudicates. */
    dc: z.number().int().min(1).max(40).optional(),
    /** Who sees the roll. A player can't roll GM-only; a hidden creature's roll is always the GM's. */
    visibility: RollVisibilitySchema.default("public"),
    /** A typed d20: the face a physical die shows (the one that counts). Players only while the table lets them. */
    face: z.number().int().min(1).max(20).optional(),
    /** A typed total (ADR-0043): the d20 and the bonus the server works out, which the server turns back into the
     *  d20's face; dice an effect adds it still throws. A player sends one only while the table asks for totals. */
    rolledTotal: z.number().int().min(-50).max(100).optional(),
    /** The GM's choice of roll mode. Ignored from a player. */
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    /** The creature the check is about: one a Wisdom (Perception or Survival) check is made to find (the roller's
     *  Hunter's Mark on it gives Advantage), or one a Charisma check interacts with (its charmer, its attitude and
     *  Perfume give Advantage or Disadvantage). */
    findActorId: z.uuid().optional(),
    /** What the check relies on, when the GM says: a Blinded roller fails one that needs sight, a Deafened one one
     *  that needs hearing. */
    sense: z.enum(["sight", "hearing"]).optional(),
    /** The situations the roller says the check fits, from the sheet's list (a Book's topic, prying with a Crowbar). */
    situations: z.array(z.string().trim().min(3).max(80)).max(6).optional(),
    /** A piece of gear whose printed Utilize use this is (a Grappling Hook), with `use`. A tool's use names `tool`. */
    item: SkillOrToolIdSchema.optional(),
    /** Which of the tool's or gear's printed Utilize uses this is, by its place in the list: the server takes the
     *  record's DC, ability and skill. */
    use: z.number().int().min(0).max(9).optional(),
    /** Fast Hands (Thief): the Utilize use, or a Dexterity (Sleight of Hand) check, takes the Bonus Action. */
    bonusAction: z.boolean().optional(),
    /** The creature a use works for (the wearer of the footwear Cobbler's Tools modify); absent, the roller. */
    forActorId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((request) => request.use === undefined || request.tool !== undefined || request.item !== undefined, {
    message: "Name the tool or the item whose use this is.",
    path: ["use"]
  })
  .refine((request) => request.item === undefined || request.use !== undefined, {
    message: "An item's check is one of its uses: say which.",
    path: ["item"]
  });

/** Reroll one die of a character's latest check (the lowest), while it is still their latest roll: a player spends
 *  Heroic Inspiration; the GM rerolls freely. */
export const CheckRerollSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    /** The face the rerolled physical die shows, for a check that was typed. */
    face: z.number().int().min(1).max(20).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** Answer a character's latest check with one of its `answers` (Tactical Mind, a Bardic Inspiration die), while it is
 *  still their latest roll. */
export const CheckAnswerSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    answer: RollAnswerChoiceSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** The GM calls for a check or a save from one or several characters, with an optional DC. */
export const RollCallStartSchema = z
  .object({
    commandId: z.uuid(),
    kind: z.enum(["check", "save"]),
    ability: AbilitySchema,
    /** A check's skill or tool; a save takes neither. */
    skill: SkillOrToolIdSchema.optional(),
    tool: SkillOrToolIdSchema.optional(),
    /** Required for a save. */
    dc: z.number().int().min(1).max(40).optional(),
    actorIds: z.array(z.uuid()).min(1).max(20),
    /** A check the players roll blind: they see neither its result nor its DC. A save is never blind: its outcome
     *  lands on the character. */
    blind: z.boolean().optional(),
    /** What a check relies on: a Blinded character fails one that needs sight, a Deafened one one that needs
     *  hearing. */
    sense: z.enum(["sight", "hearing"]).optional(),
    /** The creature a check is about (Insight into its intentions), whose traits can weigh on it: a sphinx's
     *  Inscrutable gives the check Disadvantage. */
    aboutActorId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((payload) => payload.kind === "check" || payload.dc !== undefined, {
    error: "A saving throw needs a DC."
  })
  .refine((payload) => payload.kind === "check" || payload.blind !== true, {
    error: "A saving throw can't be rolled blind: its outcome lands on the character."
  })
  .refine(
    (payload) =>
      payload.kind === "check" ||
      (payload.skill === undefined && payload.tool === undefined && payload.sense === undefined),
    { error: "A saving throw takes no skill, tool or sense." }
  )
  .refine((payload) => new Set(payload.actorIds).size === payload.actorIds.length, {
    error: "Name each character once."
  });

/** A character answers a check call: the server rolls it (or takes the typed `face`). */
export const RollCallAnswerSchema = z
  .object({
    commandId: z.uuid(),
    callId: z.uuid(),
    actorId: z.uuid(),
    face: z.number().int().min(1).max(20).optional(),
    /** A typed total (see `check.roll`). */
    rolledTotal: z.number().int().min(-50).max(100).optional(),
    /** The situations the check fits, of those the call's card offers for the character (a Book's topic). */
    situations: z.array(z.string().trim().min(3).max(80)).max(6).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** The GM closes a call; the saves it opened that nobody answered are dismissed. */
export const RollCallCloseSchema = z
  .object({
    commandId: z.uuid(),
    callId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** The GM gives or takes a character's Heroic Inspiration. */
export const ActorSetHeroicInspirationSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    has: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** A character's player (or the GM) gives its second Heroic Inspiration to a player character who lacks one, or lets
 *  it go (`recipientId` null). */
export const ActorGiveHeroicInspirationSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    recipientId: z.uuid().nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** The GM awards XP: an amount to each recipient, and an even share of the defeated creatures' stat block XP. */
export const ActorAwardExperienceSchema = z
  .object({
    commandId: z.uuid(),
    actorIds: z.array(z.uuid()).min(1).max(12),
    amount: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    defeatedIds: z.array(z.uuid()).max(60).default([]),
    inLairIds: z.array(z.uuid()).max(60).default([]),
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
/** The controller of the creature whose turn it is puts what happens at once as the turn starts or ends in order:
 *  every step's key once, first to last. */
export const TurnOrderSchema = z
  .object({
    commandId: z.uuid(),
    stepsId: z.uuid(),
    order: z.array(z.string().min(1).max(200)).min(2).max(20),
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
/** GM sets how players' dice are entered (ADR-0043); an omitted kind keeps what is stored. */
export const TableSetPlayerDiceSchema = z
  .object({
    commandId: z.uuid(),
    d20: DiceModeSchema.optional(),
    damage: DiceModeSchema.optional(),
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
/** SRD Influence: a monster's or NPC's attitude toward the party (GM). Indifferent is the default. */
export const SetActorAttitudeSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    attitude: z.enum(["friendly", "indifferent", "hostile"]),
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
/** Manual fog of war (GM-only). `encounterId` targets a parked scene's private prep; without it, the live table. */
export const FogSetEnabledSchema = z
  .object({
    commandId: z.uuid(),
    enabled: z.boolean(),
    encounterId: z.uuid().optional(),
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
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const FogResetSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Traps (SRD 5.2.1 Gameplay Toolbox): the GM sets one of the toolbox's traps at a band of levels over a dragged area,
 *  hidden from the players. `encounterId` targets a parked scene. */
export const TrapPlaceSchema = z
  .object({
    commandId: z.uuid(),
    trapId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    /** The band of levels it is scaled for: 1 for levels 1-4, 2 for 5-10, 3 for 11-16, 4 for 17-20. */
    tier: z.number().int().min(1).max(4),
    rect: PaintRectSchema,
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM changes a trap: its band, the area its blast falls on (null: its own area), whether the party has found it,
 *  or arms or disarms it. */
export const TrapEditSchema = z
  .object({
    commandId: z.uuid(),
    trapId: z.uuid(),
    tier: z.number().int().min(1).max(4).optional(),
    blast: PaintRectSchema.nullable().optional(),
    found: z.boolean().optional(),
    state: z.enum(["armed", "disarmed"]).optional(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TrapRemoveSchema = z
  .object({
    commandId: z.uuid(),
    trapId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM sets off a trap whose trigger the map can't see (a needle in a lock), on a creature or on its area. */
export const TrapSpringSchema = z
  .object({
    commandId: z.uuid(),
    trapId: z.uuid(),
    actorId: z.uuid().nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A creature beside a found trap makes it safe one of the trap's ways (`disarmId`). */
export const TrapDisarmSchema = z
  .object({
    commandId: z.uuid(),
    trapId: z.uuid(),
    actorId: z.uuid(),
    disarmId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(40),
    /** Fast Hands (Thief): it takes the Bonus Action. */
    bonusAction: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM sets a scene's climate and weather (SRD 5.2.1 Gameplay Toolbox, Environmental Effects); what is left out
 *  stays as it was. */
export const EnvironmentSetSchema = z
  .object({
    commandId: z.uuid(),
    environment: SceneEnvironmentSchema.partial(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

/** Painted ground (GM-only): mark a dragged area as difficult terrain, still or running water, or slippery ice, or clear
 *  every kind from it. `encounterId` targets a parked scene. */
export const TerrainPaintSchema = z
  .object({
    commandId: z.uuid(),
    op: z.enum(["difficult", "water", "running-water", "ice", "clear"]),
    rect: PaintRectSchema,
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TerrainResetSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();

// Dynamic vision (ADR-0023). The GM's edits take `encounterId` to prep a parked scene, as fog and terrain do.
/** A map point in image pixels, before the server snaps and clamps it. */
const VisionPointWireSchema = z
  .object({ x: z.number().min(-100000).max(1_000_000), y: z.number().min(-100000).max(1_000_000) })
  .strict();
export const VisionSetEnabledSchema = z
  .object({
    commandId: z.uuid(),
    enabled: z.boolean(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const VisionSetAmbientSchema = z
  .object({
    commandId: z.uuid(),
    ambient: z.enum(["bright", "dim", "dark"]),
    /** The bright ambient light is sunlight (daylight outdoors). Left as it was when absent. */
    sunlight: z.boolean().optional(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** An area of light or obscurement painted over the ambient light: a rect (snapped to whole cells), or a circle for
 *  fog or magical Darkness. */
export const VisionAreaAddSchema = z
  .object({
    commandId: z.uuid(),
    kind: z.enum(["bright", "dim", "dark", "lightly-obscured", "heavily-obscured", "magical-darkness"]),
    sunlight: z.boolean().optional(),
    rect: z
      .object({
        x: z.number().min(-100000).max(1_000_000),
        y: z.number().min(-100000).max(1_000_000),
        width: z.number().min(-1_000_000).max(1_000_000),
        height: z.number().min(-1_000_000).max(1_000_000)
      })
      .strict()
      .optional(),
    circle: z
      .object({
        x: z.number().min(-100000).max(1_000_000),
        y: z.number().min(-100000).max(1_000_000),
        radiusFeet: z.number().positive().max(1000)
      })
      .strict()
      .optional(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((area) => (area.rect === undefined) !== (area.circle === undefined), {
    message: "Give the area a rectangle or a circle, not both."
  });
export const VisionAreaRemoveSchema = z
  .object({
    commandId: z.uuid(),
    areaId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Light or put out a light source a creature carries, lower or raise a Hooded Lantern's hood, or aim a Bullseye
 *  Lantern. */
export const ItemSetLightSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    itemId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    lit: z.boolean().optional(),
    hoodLowered: z.boolean().optional(),
    facingDegrees: z.number().min(-360).max(720).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine(
    (change) => change.lit !== undefined || change.hoodLowered !== undefined || change.facingDegrees !== undefined,
    { message: "Say whether to light it, hood it or aim it." }
  );
/** Its holder puts a carried item in one of its forms (a Rod of Lordly Might's flame blade), or back in its own form
 *  with null. */
export const ItemSetFormSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    itemId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    variantId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const VisionResetExploredSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A chain of walls, doors or windows: each pair of consecutive points is one segment. */
export const WallAddSchema = z
  .object({
    commandId: z.uuid(),
    kind: z.enum(["wall", "door", "window"]),
    points: z.array(VisionPointWireSchema).min(2).max(64),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const WallMoveSchema = z
  .object({
    commandId: z.uuid(),
    wallId: z.uuid(),
    a: VisionPointWireSchema,
    b: VisionPointWireSchema,
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const WallRemoveSchema = z
  .object({
    commandId: z.uuid(),
    wallId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const WallClearSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Open or close a door. A player may, for a door next to their own character's token on the live table. */
export const DoorSetOpenSchema = z
  .object({
    commandId: z.uuid(),
    wallId: z.uuid(),
    open: z.boolean(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM sets what keeps a door shut (locked, stuck, barred, jammed, sealed), its Arcane Lock and whether it is a
 *  secret door; null clears them all. */
export const DoorSetStateSchema = z
  .object({
    commandId: z.uuid(),
    wallId: z.uuid(),
    door: DoorStateSchema.nullable(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A creature beside a door picks its lock, forces it or jams it shut. */
export const DoorUseSchema = z
  .object({
    commandId: z.uuid(),
    wallId: z.uuid(),
    actorId: z.uuid(),
    /** Pick its lock (Thieves' Tools), force it, jam it with an Iron Spike, pry it open (Carpenter's or Smith's
     *  Tools), seal it (Carpenter's Tools), or push the button of the Immovable Rod that holds it (`release`). */
    how: z.enum(["pick", "force", "jam", "pry", "seal", "release"]),
    /** Another character helping with a Portable Ram (Advantage on the check). */
    helperId: z.uuid().optional(),
    /** Fast Hands (Thief): the use takes the Bonus Action. */
    bonusAction: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Where an object is: a wall or door of the live map, or what holds a creature (its effect). */
export const ObjectRefSchema = z.union([
  z.object({ wallId: z.uuid() }).strict(),
  z.object({ actorId: z.uuid(), effectId: z.string().min(1).max(120) }).strict()
]);
/** The GM gives a wall or door statistics as an object, or clears them (null). */
export const ObjectSetSchema = z
  .object({
    commandId: z.uuid(),
    wallId: z.uuid(),
    object: ObjectStatsSchema.nullable(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM deals typed damage to an object (a Fireball's fire on a door, a Wall of Ice panel). */
export const ObjectDamageSchema = z
  .object({
    commandId: z.uuid(),
    target: ObjectRefSchema,
    parts: z
      .array(z.object({ amount: z.number().int().min(0).max(10000), type: DamageTypeSchema }).strict())
      .min(1)
      .max(8),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A creature attacks an object with one of its attacks. */
export const ObjectAttackSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    actionId: z.string().min(1).max(120),
    target: ObjectRefSchema,
    rollMode: z.enum(["advantage", "disadvantage", "normal"]).nullable().optional(),
    override: RulesOverrideSchema.nullable().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A light placed on the map (`position`) or carried by a token (`actorId`). */
export const LightAddSchema = z
  .object({
    commandId: z.uuid(),
    position: VisionPointWireSchema.optional(),
    actorId: z.uuid().optional(),
    brightFeet: z.number().min(0).max(240),
    dimFeet: z.number().min(0).max(240),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((light) => (light.position === undefined) !== (light.actorId === undefined), {
    message: "Give the light a place on the map or a token to carry it. It can't have both."
  });
export const LightMoveSchema = z
  .object({
    commandId: z.uuid(),
    lightId: z.uuid(),
    position: VisionPointWireSchema,
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const LightRemoveSchema = z
  .object({
    commandId: z.uuid(),
    lightId: z.uuid(),
    encounterId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM's look through one creature's eyes, or the whole party's when `actorId` is absent. */
export const VisionPreviewSchema = z.object({ actorId: z.uuid().optional() }).strict();
/** What a prepared or live scene shows one audience: the shared screen, or with `actorId` that party character's
 *  player. */
export const ScenePreviewSchema = z.object({ encounterId: z.uuid(), actorId: z.uuid().optional() }).strict();
export const ActorRestSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    kind: z.enum(["long", "short"]),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Bring a dead creature back (GM): the hit points the revival gives, clamped to 1 and the maximum. */
export const ActorReviveSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    hitPoints: z.number().int().min(1).max(10000),
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
    /** For a pick of several (Weapon Mastery), the answer `id` takes the place of. */
    replacing: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
      .optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Spend Hit Point Dice to heal on a Short Rest (SRD 5.2.1: each die heals its roll + Con modifier, minimum 1). GM any actor; a player only their claimed character. */
export const ActorSpendHitDiceSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    count: z.number().int().min(1).max(40),
    /** Reroll one die of the character's latest spend instead, while it is still the character's latest roll (SRD
     *  Heroic Inspiration: "reroll any die immediately after rolling it"); `count` is ignored. */
    reroll: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A limited-use pool, as its counter is keyed (`uses.pool ?? action.id`), and how many uses to move. */
const PoolAmountFields = {
  commandId: z.uuid(),
  actorId: z.uuid(),
  poolId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(120),
  amount: z.number().int().min(1).max(100),
  expectedRevision: z.number().int().nonnegative().optional()
} as const;
/** Spend several uses of a pool at once: the character's player or the GM. */
export const ActorSpendUsesSchema = z.object(PoolAmountFields).strict();
/** Give back spent uses of a pool (GM). */
export const ActorRestoreUsesSchema = z.object(PoolAmountFields).strict();
/** Turns one resource into another, or recovers one, by a feature's rule (Font of Magic, Arcane Recovery): the slot it
 *  spends or makes (`level`, `pact` for a Pact Magic slot), the slots it recovers (`levels`), or how many uses or points
 *  (`count`). The server checks each against the feature. */
export const ActorConvertSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    conversionId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(60),
    level: z.number().int().min(1).max(9).optional(),
    pact: z.boolean().optional(),
    levels: z.array(z.number().int().min(1).max(9)).min(1).max(9).optional(),
    count: z.number().int().min(1).max(20).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A player asks the GM for a Long Rest for their character, or takes the ask back (`withdraw`). */
export const RestAskSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    withdraw: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM answers a Long Rest request: `approve` gives the rest now, otherwise it is turned down. */
export const RestAnswerSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    approve: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM rests several characters at once. Long: it opens, and it ends when the GM finishes it, which passes its
 *  8 hours. Short: it opens, each player spends Hit Dice on their own device, and it ends when the GM finishes it. */
export const RestPartySchema = z
  .object({
    commandId: z.uuid(),
    kind: z.enum(["short", "long"]),
    actorIds: z.array(z.uuid()).min(1).max(12),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((value) => new Set(value.actorIds).size === value.actorIds.length, {
    message: "Each character can rest only once.",
    path: ["actorIds"]
  });
/** A member of the party's Short Rest is done choosing (or not, with `done: false`). */
export const RestMarkDoneSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    done: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM ends the party's rest: `apply` gives its benefits and its time passes; otherwise it is called off. */
export const RestFinishSchema = z
  .object({
    commandId: z.uuid(),
    apply: z.boolean(),
    /** Which rest: absent, the Short Rest when one is under way, else the Long Rest. */
    kind: z.enum(["short", "long"]).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A member of the party's Long Rest that an interruption stopped takes it up again. */
export const RestResumeSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM interrupts one member's Long Rest (an hour of walking or other physical exertion). */
export const RestInterruptSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM moves game time forward, which the 16-hour rule between Long Rests reads. */
/** The GM starts or stops tracking food and water (SRD Malnutrition, Dehydration). */
export const SurvivalSetTrackingSchema = z
  .object({
    commandId: z.uuid(),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A character eats or drinks: a meal, a ration or a Goodberry; its fill at a source, or from its Waterskins. */
export const ActorNourishSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    food: z.enum(["meal", "ration", "goodberry", "bead"]).optional(),
    water: z.enum(["fill", "waterskin"]).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((request) => request.food !== undefined || request.water !== undefined, "Say what it eats or drinks.");
/** The GM starts or ends a creature's held breath (SRD Suffocation). */
export const ActorHoldBreathSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    holding: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const TimePassSchema = z
  .object({
    commandId: z.uuid(),
    hours: z.number().int().min(0).max(720).default(0),
    /** Minutes on top of the hours, so a group can skip the minute or the 10 minutes a spell lasts. */
    minutes: z.number().int().min(0).max(59).default(0),
    /** The party travels for that time at this pace (SRD 5.2.1 Travel Pace): the log says how far it went, and each
     *  traveller's checks read the pace until time passes without one. */
    pace: z.enum(["fast", "normal", "slow"]).optional(),
    /** The time is downtime: each character works up to 8 hours a day on its crafting projects. */
    downtime: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((request) => request.hours > 0 || request.minutes > 0, "Choose at least 1 minute.");
const CraftIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80);
/** A character starts making something in its downtime (SRD 5.2.1 Crafting): a catalog item, a Spell Scroll of a
 *  spell, or a magic item on its base, with the tool that makes it. */
export const CraftingStartSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    itemId: CraftIdSchema,
    /** The spell a Spell Scroll bears. */
    spellId: CraftIdSchema.optional(),
    /** What a magic weapon or armor is made on (a +1 Longsword's Longsword). */
    baseId: CraftIdSchema.optional(),
    /** The tool to make it with, when more than one can; absent, the first the character can work with. */
    toolId: CraftIdSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A character joins a project as a helper, or leaves it. */
export const CraftingHelpSchema = z
  .object({
    commandId: z.uuid(),
    projectId: z.uuid(),
    actorId: z.uuid(),
    helping: z.boolean(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM logs days of downtime work on a project, with no time passing on the clock. */
export const CraftingWorkSchema = z
  .object({
    commandId: z.uuid(),
    projectId: z.uuid(),
    days: z.number().int().min(1).max(250),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A project is called off. */
export const CraftingCancelSchema = z
  .object({
    commandId: z.uuid(),
    projectId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** What a character could start crafting now. */
export const ActorCraftingOffersSchema = z.object({ actorId: z.uuid() }).strict();

/** The hour of the day dawn comes on the game clock, or null for a Long Rest to stand in for the day. */
export const TimeSetDawnSchema = z
  .object({
    commandId: z.uuid(),
    hour: z.number().int().min(0).max(23).nullable(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const CharacterSetSlotSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    level: z.number().int().min(1).max(9),
    remaining: z.number().int().min(0).max(9),
    /** The Warlock's Pact Magic pool at `level`; without it, the spell slots. */
    pact: z.boolean().optional(),
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
/** Closes the prepare step a Long Rest opened: the prepared list stands until the next one. */
export const CharacterFinishPreparingSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    /** Closes the step a finished rest opened (recoveries and re-choices); without it, the Long Rest's prepare step. */
    rest: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Puts a spell on the prepared list in place of one the class chose: another spell of the class's list, or a
 *  Wizard's from the spellbook. */
export const CharacterSwapSpellSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    spellId: z.string().min(1).max(80),
    /** The spell on the sheet it replaces. */
    replaces: z.string().min(1).max(80),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Adds a Wizard spell to the spellbook: a pick the Wizard's levels give, or a copy from a Spell Scroll the character
 *  carries (`itemId`) or from another spellbook. */
export const CharacterAddToSpellbookSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    spellId: z.string().min(1).max(80),
    from: z.enum(["level", "scroll", "book"]),
    itemId: z.string().min(1).max(120).optional(),
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
/** Picks up the ammunition a character fired outside a fight: half of each row's fired pieces come back. */
export const CharacterRecoverAmmunitionSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
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
/** The GM marks a carried manual or tome studied by the character carrying it. */
export const CharacterStudyItemSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    itemId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The options a character pins to the sheet's turn card, in order. An empty list clears them. */
export const CharacterSetFavouritesSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    optionIds: z
      .array(OptionIdSchema)
      .max(MAX_FAVOURITE_OPTIONS, `Pin at most ${MAX_FAVOURITE_OPTIONS} options.`)
      .refine((ids) => new Set(ids).size === ids.length, "Each option may be pinned once."),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The Beast forms a Druid knows for Wild Shape (SRD Known Forms), as bestiary ids. A form already known may be
 *  replaced only after a Long Rest, one at a time; the GM may set any. */
export const CharacterSetKnownFormsSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    formIds: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(200)
      )
      .max(8, "A Druid knows at most 8 forms.")
      .refine((ids) => new Set(ids).size === ids.length, "Each form may be known once."),
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
/** The class each character level went to, in order: index 0 is level 1, the starting class. */
const ClassLevelsSchema = z
  .array(
    z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80)
  )
  .min(1)
  .max(20);

/** Create a character from choices; `character-build.ts` validates and assembles it. */
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
    /** A multiclass build: the class each character level went to, in order. Index 0 is level 1 and must be
     *  `classId`; the list is `level` long. Absent when every level is `classId`. */
    classLevels: ClassLevelsSchema.optional(),
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
    classLevels: ClassLevelsSchema.optional().describe(
      "A multiclass draft: the class each level went to, in order. Index 0 is level 1 and is `classId`; absent for one class."
    ),
    picks: z
      .record(OfferKeySchema, z.array(BuilderContentIdSchema).max(40))
      .refine((picks) => Object.keys(picks).length <= 200)
      .optional()
      .describe("Offer key to the option ids chosen for it."),
    asiIncreases: z
      .record(
        OfferKeySchema,
        z.array(z.object({ ability: AbilitySchema, amount: z.number().int().min(1).max(2) }).strict()).max(2)
      )
      .refine((increases) => Object.keys(increases).length <= 40)
      .optional()
      .describe("Offer key to the +2 split, for an Ability Score Improvement answered with `asi`."),
    choices: z
      .array(CharacterChoiceSchema)
      .max(200)
      .optional()
      .describe("A stored choice ledger, read back onto the offers it answers."),
    sheet: z
      .object({
        level: z.number().int().min(1).max(20),
        abilityScores: z
          .object({
            str: z.number().int().min(1).max(30),
            dex: z.number().int().min(1).max(30),
            con: z.number().int().min(1).max(30),
            int: z.number().int().min(1).max(30),
            wis: z.number().int().min(1).max(30),
            cha: z.number().int().min(1).max(30)
          })
          .strict()
      })
      .strict()
      .optional()
      .describe(
        "With `choices`: the stored sheet's own level and ability scores, so the reply's `abilities` can say how those scores were made."
      )
  })
  .strict()
  .refine(
    (draft) => !(draft.picks && draft.choices),
    "Send the answers as picks or as a ledger, and only one of the two."
  )
  .describe(
    "A character-builder draft: the identity chosen so far, and the answers by offer key or as a stored ledger, one of the two."
  );

/** The GM's See as: the builder's offers for this draft, as one player would get them. */
export const HomebrewSeeAsBuilderOffersSchema = z
  .object({ as: z.union([z.literal("everyone"), z.uuid()]), draft: BuilderOffersSchema })
  .strict();
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
    /** A multiclass character: each class with its levels, the starting class first; the levels add up to `level`. */
    classes: z
      .array(
        z
          .object({
            classId: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .max(80),
            level: z.number().int().min(1).max(20)
          })
          .strict()
      )
      .min(1)
      .max(4)
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
    purpose: TableRollPurposeSchema,
    visibility: RollVisibilitySchema,
    label: z.string().min(1).max(80).optional(),
    actorId: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Longest chat line, in code points after the server's clean-up (ADR-0038). */
export const CHAT_MAX_LENGTH = 500;
/** A chat line (ADR-0038). `actorId` names which claimed character speaks, needed when a player plays several.
 *  `whisperTo` makes it a whisper: a party character's id from the GM, or "gm" from a player. */
export const ChatSendSchema = z
  .object({
    commandId: z.uuid(),
    text: z.string().min(1).max(2000),
    actorId: z.uuid().optional(),
    whisperTo: z.union([z.uuid(), z.literal("gm")]).optional()
  })
  .strict();
/** Removes a chat line: its author's own, or any for the GM. `entryId` is the line's id as the reader holds it. */
export const ChatDeleteSchema = z
  .object({
    commandId: z.uuid(),
    entryId: z.number().int().nonnegative()
  })
  .strict();
/** How a token move travels (SRD Movement): on foot or by one of the special speeds, which spend movement; by
 *  teleportation, which spends none and provokes no Opportunity Attack; or moved by force (the GM's), neither. */
export const MoveModeSchema = z.enum(["walk", "fly", "swim", "climb", "burrow", "jump", "teleport", "forced"]);
export type MoveMode = z.infer<typeof MoveModeSchema>;

export const TokenMoveSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    position: EncounterTokenPositionSchema.nullable(),
    /** Absent: walking. A player may teleport only with the GM's go-ahead, and only the GM moves a creature by force. */
    mode: MoveModeSchema.optional(),
    /** Feet above the ground the move ends at; absent keeps the height it has. Rising or descending costs movement as
     *  distance does, and only flying, climbing, jumping, teleporting or a forced move changes it. */
    altitudeFeet: z.number().int().min(0).max(10000).optional(),
    encounterId: z.uuid().optional(),
    /** GM-grade bypass of a movement-rule rejection (speed budget); audited like every override. */
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** GM-set height of a token, free of movement: on a surface (a ledge, a balcony, a wall), or in the air flying or
 *  levitating. 0 puts it on the ground. */
export const TokenSetAltitudeSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    altitudeFeet: z.number().int().min(0).max(10000),
    /** What holds it up in the air; null or absent: it stands or clings on a surface. */
    airborne: z.enum(["fly", "levitate"]).nullable().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** The GM makes a creature fall (SRD Falling): from its height, or `feet` given, onto the ground or a lower ledge. */
export const ActorFallSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    /** How far it falls; absent, from the height it is at. */
    feet: z.number().int().min(1).max(10000).optional(),
    /** It falls into water or another liquid, which can halve the damage. */
    intoWater: z.boolean().optional(),
    /** The height it lands at; the ground when absent. */
    landingAltitudeFeet: z.number().int().min(0).max(10000).optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A creature climbs onto a mount (`mountId`) or off the one it rides (`mountId: null`), SRD 5.2.1 Mounted Combat. */
export const ActorMountSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    mountId: z.uuid().nullable(),
    /** SRD Mounted Combat: the rider controls the mount (it moves on the rider's Initiative and only Dashes, Disengages
     *  or Dodges), or lets it act on its own (an intelligent mount, a wild one). Absent: controlled. */
    control: z.enum(["controlled", "independent"]).optional(),
    /** GM-grade bypass of a movement-rule rejection (the half Speed it costs, a mount too small or too far). */
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A creature commands the creatures it summoned (SRD 5.2.1 Animate Dead: "you can take a Bonus Action to mentally
 *  command any creature you made with this spell"): those named, or every one the command reaches. */
export const SummonCommandSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    creatureIds: z.array(z.uuid()).min(1).max(20).optional(),
    /** GM-grade bypass of an economy rule (the action or Bonus Action it costs, its turn, its range). */
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A summoned creature's commander dismisses it: for good, or a familiar for now into its pocket dimension. */
export const SummonDismissSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    temporary: z.boolean().optional(),
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A familiar dismissed for now comes back to an unoccupied space within 30 feet of its commander. */
export const SummonRecallSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
    override: RulesOverrideSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** A commander sees through a summoned creature's eyes until the start of its next turn (a familiar). */
export const SummonLookSchema = z
  .object({
    commandId: z.uuid(),
    actorId: z.uuid(),
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
/** `activate: true` goes live on the new scene in the same command and parks whatever was live (as `encounter.activate` does). */
export const SceneCreateSchema = z
  .object({
    commandId: z.uuid(),
    name: SceneNameSchema,
    mapAssetId: z.uuid(),
    combatantIds: z.array(z.uuid()).max(200),
    activate: z.boolean().optional(),
    /** The fight's starting choices for Start the fight to read (ADR-0039). */
    initiativeDefaults: SceneInitiativeDefaultsSchema.optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Replaces a scene's starting choices for its fight; an empty object clears them (ADR-0039). */
export const SceneSetInitiativeDefaultsSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid(),
    initiativeDefaults: SceneInitiativeDefaultsSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** An encounter's own dice modes (ADR-0043), replacing what it had; a kind left out uses the table's. */
export const SceneSetPlayerDiceSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid(),
    playerDice: ScenePlayerDiceSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SceneRenameSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid(),
    name: SceneNameSchema,
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
export const SceneIdSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Make one recorded moment live. `turnIndex` indexes the archive document's `turns`. */
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
    encounterId: z.uuid(),
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
/** Places a spell's lingering area on the map (GM): one a player's cast left unplaced, or a new spot for it. Its
 *  zone acts there from then on (`SpellZone`). */
export const SpellZonePlaceSchema = z
  .object({
    commandId: z.uuid(),
    zoneId: z.string().min(1).max(120),
    template: z
      .object({ shape: AnnotationShapeKindSchema, origin: AnnotationPointSchema, target: AnnotationPointSchema })
      .strict(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict();
/** Ends a spell's lingering area (GM): the webs burned away, a guardian dismissed, or a ruling. */
export const SpellZoneEndSchema = z
  .object({
    commandId: z.uuid(),
    zoneId: z.string().min(1).max(120),
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

// ---------- The sound board (ADR-0024): GM-only, and kept in its own store, so none of these carry a game revision.

const SoundSlotInputSchema = z.object({ assetId: z.uuid(), volume: SoundVolumeSchema }).strict();
/** Replaces any part of the board's arrangement; a part left out stays as it is. */
export const SoundArrangeSchema = z
  .object({
    commandId: z.uuid(),
    masterVolume: SoundVolumeSchema.optional(),
    music: z
      .object({ tracks: z.array(SoundSlotInputSchema).max(MAX_SOUND_TRACKS), shuffle: z.boolean() })
      .strict()
      .optional(),
    ambient: z.array(SoundSlotInputSchema).max(MAX_SOUND_LAYERS).optional(),
    effects: z.array(SoundSlotInputSchema).max(MAX_SOUND_EFFECTS).optional()
  })
  .strict();
/** Starts the playlist (at `assetId`, or its top), an ambient layer, an effect, or a scene's saved sound. */
export const SoundPlaySchema = z
  .object({
    commandId: z.uuid(),
    target: z.enum(["music", "ambient", "effect", "encounter"]),
    assetId: z.uuid().optional(),
    encounterId: z.uuid().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.target === "ambient" || value.target === "effect") && !value.assetId)
      context.addIssue({ code: "custom", path: ["assetId"], message: "Name the sound to play." });
    if (value.target === "encounter" && !value.encounterId)
      context.addIssue({ code: "custom", path: ["encounterId"], message: "Name the encounter whose sound to play." });
  });
/** Stops the music, one ambient layer, or everything. */
export const SoundStopSchema = z
  .object({ commandId: z.uuid(), target: z.enum(["music", "ambient", "all"]), assetId: z.uuid().optional() })
  .strict()
  .superRefine((value, context) => {
    if (value.target === "ambient" && !value.assetId)
      context.addIssue({ code: "custom", path: ["assetId"], message: "Name the ambient layer to stop." });
  });
export const SoundNextTrackSchema = z.object({ commandId: z.uuid() }).strict();
export const SoundPauseSchema = z.object({ commandId: z.uuid(), paused: z.boolean() }).strict();
/** Saves what the board holds now as a scene's sound, clears it, or turns its start-when-live on or off. */
export const SoundScenePresetSchema = z
  .object({
    commandId: z.uuid(),
    encounterId: z.uuid(),
    preset: z.enum(["save-current", "clear"]).optional(),
    autoplay: z.boolean().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.preset === undefined && value.autoplay === undefined)
      context.addIssue({ code: "custom", path: ["preset"], message: "Say whether to save, clear or switch it." });
  });

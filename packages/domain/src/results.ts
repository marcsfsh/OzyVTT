import { z } from "zod";
import {
  ActionAreaSchema,
  ActionReactionSchema,
  CastShapingIdSchema,
  CharacterChoiceSchema,
  DamageTypeSchema,
  SaveConditionSchema,
  type CharacterChoice
} from "@vtt/schemas";
import { CharacterDraftSchema } from "./character-draft.js";
import { AbilityIdSchema, BuilderAbilityMethodSchema, RuleModeSchema, type AnnotationPoint } from "./state.js";
import type { PlayerView } from "./views.js";
import type { Wire } from "./wire.js";

/**
 * Why a command or read was refused, stable across rewording: branch on this, show the message. A
 * rules-mode block's code is instead the id of the rule that blocked it (`blocked.rule`). Over HTTP the
 * same code is `error.details.reason`, beside the envelope's coarse `error.code`.
 */
export type RefusalCode =
  | "not_joined"
  | "validation_failed"
  | "forbidden"
  | "not_found"
  | "stale_revision"
  | "needs_confirm"
  | "refused"
  | "history_review"
  | "scene_room_full"
  | "in_fight"
  | "unauthenticated"
  | "internal_error";
export type MutationResult = {
  ok: boolean;
  revision?: number;
  duplicate?: boolean;
  message?: string;
  /** Present on every refusal (`ok: false`). */
  code?: RefusalCode | (string & {});
  needsConfirm?: "rewrite-history" | "discard-changes";
  /** Present when a rules-mode validation blocked the command (ADR-0020); resend with override to bypass. */ blocked?: RulesBlocked;
};
export type DiceRollResult = MutationResult & { rollId?: string; hiddenFromRoller?: boolean };
/** A spellbook addition's reply: whether the spell is in the book now (a copy from a scroll can fail its check). */
export type SpellbookResult = MutationResult & { inBook?: boolean };
/** A conversion's reply: the line the table reads of what it did. */
export type ConversionResult = MutationResult & { line?: string };
export type EncounterStartEntry = Readonly<{
  actorId: string;
  score?: number;
  /** 2024 surprise: initiative rolls with disadvantage. */ surprised?: boolean;
}>;
export type AnnotationGeometryInput = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
export type AnnotationAddResult = MutationResult & { annotationId?: string };
export type ActorAddResult = MutationResult & { actorId?: string };
/** The sample characters one removal took away, and each it kept with the reason (a player holds it, or a fight uses
 *  it). */
export type SampleRemovalResult = MutationResult & {
  removed?: readonly string[];
  kept?: ReadonlyArray<Readonly<{ name: string; reason: string }>>;
};
export type SceneCreateResult = MutationResult & { sceneId?: string };

/** A way the roller may still change a roll it sees, sent back as `answer` with its next look: a Bardic Inspiration
 *  die, Indomitable's reroll, Stroke of Luck. */
export type RollAnswerOffer = Readonly<{
  /** What the answer names: the action's id, or `effect:<id>` for an effect that carries one. */
  id: string;
  name: string;
  /** What it does, for its button: "+1d8", "Reroll +9", "Reroll with Advantage", "The d20 becomes 20". */
  does: string;
  /** What using it spends ("a use", "the Reaction and a use"), or null. */
  cost: string | null;
  /** The die may be added or taken off (Boon of Fate); `subtract` on the answer takes it off. */
  either?: true;
  /** It rerolls the d20, so a typed roll's answer carries the face the physical reroll shows. */
  rerolls?: true;
}>;
/** An answer a roll took, as its result says it: "Bardic Inspiration +5", "Indomitable: rerolled". */
export type RollAnswered = Readonly<{ name: string; change: string }>;

/** Server-computed outcome of resolving a definition action (rolls already recorded in the roll history). */
export type ActionResolutionAttack = Readonly<{
  targetId: string;
  targetName: string;
  total: number;
  naturalRoll: number;
  targetAc: number | null;
  outcome: "crit" | "hit" | "miss" | "fumble" | "unknown";
  /** Cover's AC bonus folded into targetAc (SRD Cover: +2 half, +5 three-quarters). */ coverBonus?: number;
  /** A reaction's AC bonus folded into targetAc (Parry +2, Shield +5), and what gave it. */ reactionAcBonus?: Readonly<{
    amount: number;
    source: string;
  }>;
  /** Dice an effect adds to the roll, in `total` (Bless +1d4, Bane -1d4). A preview leaves `total` null: they roll
   *  when the attack is confirmed. */
  bonusDice?: ReadonlyArray<Readonly<{ label: string; dice: string; total: number | null }>>;
  /** What answered the roll after it was seen, already in `total` and `outcome`. */
  answered?: readonly RollAnswered[];
  /** On a preview, the answers the attacker may still give it. */
  answers?: readonly RollAnswerOffer[];
}>;
/** Every source behind an attack's advantage/disadvantage, so the table can see the math (ADR-0020). */
export type ActionRollMode = Readonly<{
  mode: "advantage" | "disadvantage" | "normal";
  advantage: readonly string[];
  disadvantage: readonly string[];
}>;
/** A feed line a resolve produced for the whole table (e.g. a push a rider caused), unlike `warnings`, which are
 * GM-only rules notes; anything players must not read stays in `warnings`. Two independent gates keep hidden
 * combatants out of player feeds: the resolver's `gmOnly` verdict, and `appendLog` (apps/server/src/server.ts)
 * re-checking `actorIds` for `visibility !== "public"`. A leak needs both to fail. */
export type ActionTableNarration = Readonly<{
  /** The feed row's kind, from the `CombatLogEntry` vocabulary. */
  kind: "movement" | "save" | "heal" | "effect";
  text: string;
  /** Everyone the line names. The feed keeps it from players when any of them is a hidden combatant. */
  actorIds: readonly string[];
  /** The resolver already knows this line names a hidden combatant; true forces the GM-only read. */
  gmOnly?: boolean;
}>;
/** An extra a hit can carry, offered on the attack's preview and chosen when it is confirmed (`hitOptions`): Sneak
 *  Attack, a smite, Divine Strike, a charge. Its dice join the hit's, so a crit doubles them. */
export type HitOffer = Readonly<{
  /** What the confirm names: the rider's action id, or `charge` for the attack's own run-up damage. */
  id: string;
  name: string;
  /** What it adds, for the label ("3d6 Piercing", "2d8 Radiant"). */
  dice: string;
  /** What choosing it spends ("a level 1 spell slot and your Bonus Action", "once per turn"), or null. */
  cost: string | null;
  /** Pick one when choosing it (Divine Strike: Necrotic or Radiant). */
  damageTypes?: readonly string[];
  /** The spell slots it can be cast with, lowest first (a smite). */
  slotLevels?: readonly number[];
  /** What the engine could not check, so the attacker vouches for it ("No map to check for an ally within 5 feet"). */
  unverified?: string;
  /** The save it opens on the target and what a failure deals, as sentences ("The target makes a Charisma saving
   *  throw. A failure deals 8d10 Psychic."). */
  save?: string;
  /** Effects to pick with it (Brutal Strike's Forceful Blow, a Cunning Strike's Trip), each with what it costs. */
  effects?: ReadonlyArray<HitOfferEffect>;
  /** How many different effects one hit may carry. */
  effectsChoose?: number;
  /** It is chosen with one effect or not at all (Open Hand Technique). */
  effectRequired?: true;
  /** It rolls the weapon's own dice again rather than adding any (Savage Attacker); `dice` names them. */
  rerolls?: true;
}>;
/** One effect a hit offer carries: its id, its name and what it costs ("-1d6"). */
export type HitOfferEffect = Readonly<{ id: string; name: string; cost?: string }>;
/** One extra chosen at confirm, and how. */
export type HitOptionChoice = Readonly<{
  id: string;
  damageType?: string;
  slotLevel?: number;
  effects?: readonly string[];
}>;
/** A way the roller may answer its own damage roll after seeing it, sent back as `damageAnswer` with the dice it
 *  picks: Empowered Spell rerolls up to `dice` of the spell's own dice, Heroic Inspiration one die of any. */
export type DamageAnswerOffer = Readonly<{
  id: "empowered-spell" | "heroic-inspiration";
  name: string;
  /** How many dice it may reroll. */
  dice: number;
  /** Only the action's own dice (`own` on the held dice), never a rider's. */
  ownOnly: boolean;
  /** What using it spends ("1 Sorcery Point", "Heroic Inspiration"), or null when it is free now. */
  cost: string | null;
}>;
/** A damage roll looked at before it counts (`damageLook`): its dice in the order thrown, which the confirm deals, what
 *  answered it, and what may still answer it. */
export type HeldDamageLook = Readonly<{
  dice: ReadonlyArray<Readonly<{ sides: number; face: number; own: boolean }>>;
  answered: readonly RollAnswered[];
  answers: readonly DamageAnswerOffer[];
  /** A heal's look (Cure Wounds, a potion): the Hit Points its roll restores, before what the healer's features add. */
  healing?: number;
}>;
/** The damage an action with no attack roll and no save owes one target (Magic Missile, a smite resolved alone). */
export type DamageTarget = Readonly<{
  targetId: string;
  targetName: string;
  parts: ReadonlyArray<Readonly<{ amount: number; type: string }>>;
  total: number;
}>;
export type ActionResolution = Readonly<{
  /** The action resolved, so the GM's apply can name it (`sourceActionId`) and what its damage drains lands. */
  actionId?: string;
  actionName: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  attack: ActionResolutionAttack | null;
  save: { ability: string; dc: number; targets: ReadonlyArray<{ targetId: string; targetName: string }> } | null;
  /** Rolled damage. `source` names an extra that rode the hit (Sneak Attack, Divine Smite); absent for the action's own. */
  damage: ReadonlyArray<{ formula: string; type: string; total: number; source?: string }>;
  damageTotal: number;
  crit: boolean;
  /** Advantage/disadvantage aggregation for the attack roll; absent when nothing contributed (plain 1d20). */
  rollMode?: ActionRollMode;
  /** Flat typed damage added by active effects (Rage +2 melee), included in damageTotal. */
  bonusDamage?: ReadonlyArray<{ amount: number; type: string; source: string }>;
  /** A melee hit can knock its target out (SRD Knocking Out a Creature): on a preview, offered; on a confirm, chosen,
   *  so the damage it owes leaves the target at 1 Hit Point and Unconscious if it would drop it to 0. */
  knockOut?: "offered" | "chosen";
  /** Source-linked effects the hit applied to targets (Bite: Grappled + Restrained). */
  effectsApplied?: ReadonlyArray<{
    targetId: string;
    targetName: string;
    name: string;
    conditionIds: readonly string[];
  }>;
  /** The self effect this action granted (Rage, Reckless Attack). */
  effectGranted?: Readonly<{ name: string; tags: readonly string[] }> | null;
  /** Remaining components of the open compound action after this resolve ("Attack 2 of 2" UI). */
  componentsRemaining?: Readonly<Record<string, number>> | null;
  /** Assisted-mode rule conflicts that were allowed through (also logged). */
  warnings?: readonly string[];
  /** Lines for the whole table to read (an accomplished push, the save a Topple forced); see `ActionTableNarration`. */
  tableNarration?: readonly ActionTableNarration[];
  /** Present when the GM overrode a strict-mode rejection; the override is logged and journaled. */
  overridden?: Readonly<{ rule: string; reason: string }> | null;
  /** Hit points the action restored (Cure Wounds): the one roll, and what each target regained, capped at its maximum. */
  healing?: Readonly<{
    total: number;
    targets: ReadonlyArray<Readonly<{ targetId: string; targetName: string; regained: number }>>;
  }> | null;
  /** On a previewed hit, the push its weapon mastery offers (SRD "up to 10 feet"); the confirm says how far with `pushFeet`. */
  push?: Readonly<{ targetName: string; maxFeet: number }> | null;
  /** Tactical Master: the weapon's own mastery, the properties that may take its place for this attack, and the one
   *  this look took. */
  masteryOptions?: Readonly<{
    own: Readonly<{ id: string; name: string }>;
    alternatives: ReadonlyArray<Readonly<{ id: "push" | "sap" | "slow"; name: string }>>;
    picked?: "push" | "sap" | "slow";
  }>;
  /** Reaction prompts this hit opened (Uncanny Dodge): the triggering damage waits on the answer. */
  reactionPrompts?: ReadonlyArray<
    Readonly<{ actorId: string; actorName: string; actionName: string; holdsDamage?: true }>
  >;
  /** An extra attack this swing opened (Cleave's swing at a second creature), for the result card to offer. */
  opens?: Readonly<{ actionId: string; actionName: string }>;
  /** The attack would hit, and the target's reaction (Parry, Shield) may still turn it into a miss. Nothing past the
   *  roll has happened yet: answering the prompt finishes the attack, damage included. */
  waitingOnReaction?: true;
  /** A builtin action's check roll (Hide vs DC 15; Influence/Search/Study with dc/success null: GM adjudicates). */
  check?: Readonly<{
    skill: string;
    total: number;
    naturalRoll: number;
    dc: number | null;
    success: boolean | null;
  }> | null;
  /** Effects this resolve ended as a rule consequence (attacking revealed Hiding; an off-turn action released a Ready). */
  effectsEnded?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; name: string }>>;
  /** An attack-roll preview: the d20 is shown but nothing is applied until confirmed or re-rolled. */
  preview?: boolean;
  /** On a previewed hit, the extras the attacker may add when confirming (`hitOptions`). */
  hitOffers?: readonly HitOffer[];
  /** On a previewed hit, the attacker may answer its damage roll after seeing it: a look (`damageLook`) rolls and holds
   *  the damage first. */
  damageLook?: "offered";
  /** A look at the damage before it counts: the dice the confirm deals, and the answers they may still take. */
  heldDamage?: HeldDamageLook;
  /** No attack roll and no save, but damage: what each target is owed, applied or proposed like a hit. A darts action
   *  (Magic Missile) owes each creature only what its own darts dealt. */
  damageTargets?: readonly DamageTarget[];
  /** The creatures this action brought onto the map (Summon Dragon's spirit), which appear on it for the table. */
  summoned?: ReadonlyArray<Readonly<{ actorId: string; name: string }>>;
}>;
/** A strict-mode rules rejection: what rule blocked the command and whether an override may bypass it. */
export type RulesBlocked = Readonly<{ rule: string; message: string; overridable: boolean }>;
export type ActionResolveResult = MutationResult & { resolution?: ActionResolution };
/** Typed damage as applied: per-part defenses, temp-HP absorption and any zero-HP transition. */
export type DamageApplication = Readonly<{
  totalRequested: number;
  totalApplied: number;
  parts: ReadonlyArray<{
    type: string;
    amount: number;
    adjusted: number;
    /** Both Resistance and Vulnerability: halved, then doubled (SRD Order of Application). */
    adjustment: "resistance" | "immunity" | "vulnerability" | "resistance-and-vulnerability" | null;
    adjustmentSource: string | null;
  }>;
  temporaryAbsorbed: number;
  hpBefore: number;
  hpAfter: number;
  /** Zero-HP machine outcomes (player characters). */
  droppedToZero: boolean;
  deathSaveFailuresAdded: number;
  instantDeath: boolean;
  /** A non-PC hit 0 HP: effects it sustained were ended (grapples released). */
  defeated: boolean;
  /** Flat `damage-reduction` taken off the hit before Resistance (SRD Order of Application); each part's `amount`
   *  is what was left of it. */
  flatReduction?: number;
}>;
export type DamageApplyResult = MutationResult & { applied?: DamageApplication };
export type DeathSaveResult = MutationResult & {
  deathSave?: Readonly<{
    naturalRoll: number;
    /** The face with what the save adds (Exhaustion, Bless's d4, an aura). */
    total?: number;
    outcome: "success" | "failure" | "critical-success" | "critical-failure";
    successes: number;
    failures: number;
    stable: boolean;
    dead: boolean;
    regainedConsciousness: boolean;
    /** false = previewed only (pips unchanged, awaiting confirmation); true = applied. */ committed: boolean;
    /** The d20 mode when it had Advantage or Disadvantage; absent for a plain roll. */ rollMode?:
      "advantage" | "disadvantage" | "normal";
    /** What gave the death save Advantage or Disadvantage. */ rollModeSources?: ActionRollMode;
    /** What answered the roll, already in its numbers. */ answered?: readonly RollAnswered[];
    /** On a preview, the answers the dying character may still give it. */ answers?: readonly RollAnswerOffer[];
  }>;
};
/** A check the server rolled. A blind roll's numbers stay with the GM: the roller gets `hiddenFromRoller` alone. */
export type CheckRollOutcome = Readonly<{
  /** "Dexterity (Stealth)", "Strength check", "Thieves' Tools (Dexterity)". */
  label: string;
  natural: number;
  total: number;
  dc: number | null;
  /** Null when there was no DC to beat. */
  success: boolean | null;
  /** What gave the check Advantage or Disadvantage; absent for a plain d20. */
  rollMode?: ActionRollMode;
  /** Reliable Talent counted a d20 of 9 or lower as 10. */
  reliableTalent?: true;
  /** Why it failed whatever it rolled (a Blinded roller's check that needs sight). */
  autoFailed?: string;
  /** The d20 was typed from a physical die. */
  typed?: true;
  /** What answered the check, already in its numbers. */
  answered?: readonly RollAnswered[];
  /** The answers the roller may still give it (`check.answer`). */
  answers?: readonly RollAnswerOffer[];
  rollId: string;
}>;
export type CheckRollResult = MutationResult & { check?: CheckRollOutcome; hiddenFromRoller?: boolean };
/** Outcome of giving aid to a creature at 0 hit points: stabilized, woken from a knock-out, or neither (a failed
 *  check). `check` is the Wisdom (Medicine) roll when first aid was the method. */
export type StabilizeResult = MutationResult & {
  stabilize?: Readonly<{
    stabilized: boolean;
    woke: boolean;
    check: Readonly<{ natural: number; total: number; dc: number }> | null;
  }>;
};
/** Outcome of answering a pending save; applied damage/condition already happened server-side when present. */
export type SaveAnswerResult = MutationResult & {
  outcome?: {
    success: boolean;
    total: number;
    dc: number;
    /** The d20 that counted; absent when no die was rolled. */ natural?: number;
    appliedDamage: number;
    conditionApplied: boolean;
    committed: boolean;
    /** Condition id that forced an automatic failure (Paralyzed on a Dex save); null/absent when rolled. */ autoFailed?:
      string | null;
    /** The trait that made it succeed without a roll (Greater Magic Resistance against a spell). */ autoSucceeded?: string;
    /** Advantage/disadvantage sources that shaped the save roll (Restrained, Dodge). */ rollMode?: ActionRollMode;
    /** The typed breakdown behind `appliedDamage`; absent when the save applied no damage. */ parts?: DamageApplication["parts"];
    /** Flat reduction taken off before Resistance. */ flatReduction?: number;
    /** What answered the save, already in its numbers. */ answered?: readonly RollAnswered[];
    /** On a preview, the answers the saving creature may still give it. */ answers?: readonly RollAnswerOffer[];
    /** The confirm waits on another creature's answer to the roll (Countercharm). */ awaitingAnswer?: true;
    /** The damage waits on the target's own reaction to taking it (Stone's Endurance). */ damageHeld?: true;
  };
};
/** A loose saving throw (none was owed): its total and d20, or the condition that failed it without a roll. */
export type LooseSaveOutcome = Readonly<{
  total: number;
  natural?: number;
  rollMode?: ActionRollMode;
  autoFailed?: string;
}>;
/** Outcome of answering a reaction prompt; any damage it settles is already applied server-side. A strike (an
 *  opportunity attack, Hellish Rebuke) and a parked attack finished by the answer carry their full `resolution`. */
export type ReactionAnswerResult = MutationResult & {
  outcome?: {
    used: boolean;
    appliedDamage: number;
    resolution?: ActionResolution;
    /** The typed breakdown behind `appliedDamage`. */ parts?: DamageApplication["parts"];
    flatReduction?: number;
  };
};
/** One action's strict-mode availability for an actor, with every violated rule named (server-computed; ADR-0020
 *  explainability), plus the action's display values. */
/** One way a spell's cast can be shaped, as the cast offers it: its cost in Sorcery Points, whether this spell can take
 *  it now and why not, whether it counts toward the options one spell may carry, the creatures it names (Careful
 *  Spell's up to the Charisma modifier, Heightened Spell's one, Sculpt Spells' 1 plus the spell's level, with
 *  `plusLevel` when that is 1 plus the slot's level), and the types Transmuted Spell can change to. */
const CastShapingOfferSchema = z.strictObject({
  id: CastShapingIdSchema,
  name: z.string(),
  cost: z.number().int().min(0).max(2),
  available: z.boolean(),
  reason: z.string().optional(),
  counted: z.boolean(),
  creatures: z
    .strictObject({ count: z.number().int().min(1).max(10), plusLevel: z.literal(true).optional() })
    .optional(),
  damageTypes: z.array(DamageTypeSchema).optional()
});
const CastShapingOffersSchema = z
  .strictObject({
    /** How many counted options one spell may carry: 1, or 2 while Sorcery Incarnate's Innate Sorcery is active. */
    limit: z.number().int().min(1).max(2),
    /** Sorcery Points left to pay with. */
    points: z.number().int().min(0),
    /** One option's cost is waived on this turn (Arcane Apotheosis). */
    free: z.literal(true).optional(),
    options: z.array(CastShapingOfferSchema)
  })
  .describe(
    "The ways the caster may shape this spell's cast (Metamagic options it knows, Sculpt Spells), each with its Sorcery Point cost and whether this spell can take it now. Send the picks as `action.resolve`'s `shaping`; the server checks them again."
  );
export type CastShapingOffers = Wire<z.infer<typeof CastShapingOffersSchema>>;
/** One form a shape-shift may take, as the sheet lists it. */
const FormOptionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  challengeRating: z.number().nullable(),
  size: z.string(),
  fly: z.boolean()
});
export const ActionAvailabilitySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  activation: z.enum(["action", "bonus-action", "reaction", "other"]),
  /** Whether strict mode would allow resolving this action right now (target-specific rules can't be pre-checked). */
  available: z.boolean().describe("Whether strict mode would allow resolving this action right now"),
  violations: z.array(
    z.strictObject({
      rule: z
        .string()
        .describe(
          "Machine-readable rule id, e.g. economy.action-used, feature.requires-effect, condition.incapacitated"
        ),
      message: z.string()
    })
  ),
  /** Limited-use spending left in the current scope; null when the action has no use limit. */
  usesRemaining: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Limited-use spending left; null when the action has no use limit"),
  /** Rolls left in the open compound-action instance for this action; null when no instance applies. */
  componentsRemaining: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Rolls left in the open compound-action instance; null when no instance applies"),
  /** True for the SRD generic actions every combatant can take (Dodge, Dash, Help, ...), which no stat block lists. */
  builtin: z
    .boolean()
    .optional()
    .describe("True for the SRD generic actions (Dodge, Dash, Help, Unarmed Strike, ...) every combatant can take"),
  /** Added to a hit and never taken alone (Sneak Attack, a smite): chosen on an attack's result. */
  ridesAHit: z.literal(true).optional(),
  // Display values only (ADR-0007); resolution recomputes from the id.
  description: z
    .string()
    .describe(
      "Display only. Every field from here down is read off the actor's effective action list, so it already carries the standing riders of what is equipped and attuned, which is what lets a client render an item-derived action (an amulet's cast, a +1 sword's swing) that is absent from the stat block entirely. None of it is what gets rolled: resolution takes `id` and recomputes through the same function, so a preview cannot disagree with the roll."
    ),
  attackBonus: z
    .number()
    .int()
    .nullable()
    .describe("To-hit including item riders; null when the action has no attack roll"),
  reachFeet: z.number().int().nullable(),
  rangeFeet: z.number().int().nullable(),
  rangeNormalFeet: z
    .number()
    .int()
    .nullable()
    .describe("Normal range band; shots beyond it up to rangeFeet roll at disadvantage"),
  targetRangeFeet: z
    .number()
    .int()
    .optional()
    .describe("How far its targets may be when it says so without an attack (Lay on Hands' touch is 5)"),
  attackCount: z.number().int().nullable(),
  saveAbility: z.string().nullable(),
  saveDc: z.number().int().nullable().describe("Save DC including item riders"),
  damage: z.array(z.strictObject({ formula: z.string(), type: z.string() })),
  usesLimit: z
    .number()
    .int()
    .nullable()
    .describe("Total limited uses including any item that raised the pool; null when unlimited"),
  usesPer: z.enum(["turn", "own-turn", "encounter", "long-rest", "short-rest", "recharge", "never", "time"]).nullable(),
  usesPool: z.string().nullable().describe("Shared pool key; actions naming one pool spend one counter"),
  /** How many uses one activation spends when it is more than one, or `chosen` when the user picks it each time. */
  useCost: z.union([z.number().int(), z.literal("chosen")]).nullable(),
  requiresEffectTag: z.string().nullable(),
  multiattack: z
    .array(z.strictObject({ actionId: z.string(), count: z.number().int(), or: z.array(z.string()).optional() }))
    .nullable(),
  reaction: ActionReactionSchema.nullable(),
  /** The hit points it restores (a potion's 2d4 + 2), for display. */
  healing: z
    .strictObject({ formula: z.string() })
    .nullable()
    .optional()
    .describe("The hit points the action restores (a potion's 2d4 + 2); null when it heals nothing"),
  /** How many creatures one use heals when it can be more than one (Prayer of Healing's five); null otherwise. */
  healTargets: z.number().int().nullable().optional(),
  /** Who a tap picks: one creature, several, or none (it acts on its user); null when nothing structured resolves. */
  targeting: z
    .enum(["none", "single", "multi"])
    .nullable()
    .optional()
    .describe(
      'Who a tap picks, as resolution takes it: "single" (an attack, a heal such as a potion, a grant aimed at a target), "multi" (a save, damage with no attack roll, or a grant on each creature it targets), "none" (it acts on its user: a self heal, Rage, a scroll of a spell with no target); null when nothing structured resolves. A builtin reports the targeting the stat block list gives it'
    ),
  /** Darts it makes, each assigned to a target (Magic Missile read from a scroll or cast from a wand). */
  darts: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "Darts the action makes, each dealing its damage to a target the caller assigns (Magic Missile, read from a scroll or cast from a wand); null otherwise"
    ),
  /** The damage types its caster picks from (Chromatic Orb). */
  damageTypes: z
    .array(DamageTypeSchema)
    .nullable()
    .optional()
    .describe(
      "The damage types the caster picks one of when it resolves (Chromatic Orb), sent as the resolve's `damageType`; null when the action deals its own"
    ),
  /** The conditions its caster picks one of for a failed save (Blindness/Deafness); `action.resolve`'s `conditionId`. */
  conditionChoices: z.array(SaveConditionSchema).optional(),
  /** What it asks its user to choose as it resolves: an option (Fire Shield's warm or chill), one for each target, or
   *  the carried weapon it binds to. */
  choices: z
    .strictObject({
      options: z.array(z.strictObject({ id: z.string(), name: z.string() })).optional(),
      optionsPerTarget: z.literal(true).optional(),
      bindsWeapon: z
        .strictObject({
          weaponIds: z.array(z.string()).optional(),
          melee: z.literal(true).optional(),
          ammunition: z.enum(["only", "also"]).optional()
        })
        .optional(),
      object: z
        .strictObject({ kinds: z.array(z.enum(["armor", "weapon"])), metal: z.literal(true).optional() })
        .optional()
    })
    .optional()
    .describe(
      "What the action asks its user to choose as it resolves: `options` (sent as the resolve's `optionId`, or `targetOptions` with one pick for each target when `optionsPerTarget`), `bindsWeapon`, the carried weapon its grant binds to (sent as `itemId`, limited to `weaponIds` and to Melee weapons when `melee`; `ammunition`: only a stack of ammunition (`only`), or one as well as a weapon (`also`)), and `object`, the target's armor or weapon it acts on (sent as `objectItemId`; absent, the target's worn armor, else its weapon in hand)"
    ),
  /** The skills a check action is made with, for the roller to pick (Search, Study, Influence, Escape a Grapple), and
   *  the tools its user may help with through Help with a Check, which carry their name. */
  checkSkills: z
    .array(z.strictObject({ id: z.string(), ability: AbilityIdSchema, name: z.string().optional() }))
    .optional(),
  /** The weapon mastery property this character uses with this swing (Graze on Borin's Greatsword): present only when
   *  the character chose the weapon's kind under Weapon Mastery. */
  mastery: z
    .strictObject({ id: z.string(), name: z.string() })
    .optional()
    .describe(
      "The weapon mastery property this swing carries (Graze on a Greatsword), present only when the character chose the weapon's kind under Weapon Mastery"
    ),
  /** Why it can't be used now, in one short sentence ("Not prepared."); present exactly when `available` is false. */
  reason: z
    .string()
    .optional()
    .describe(
      'Why it can\'t be used now, in one short sentence for the sheet ("Not prepared.", "No level 2 spell slots left.", "You used your Bonus Action this turn."). Present exactly when `available` is false. The character comes first (Stunned, 0 Hit Points), then the option itself, then the turn, then targeting; `violations` keeps the full account. A hint only: resolution checks again.'
    ),
  /** A Thief's Fast Hands can take this item action as a Bonus Action (`action.resolve`'s `fastHands`): whether that
   *  form can be used now, and why not. */
  fastHands: z
    .strictObject({ available: z.boolean(), reason: z.string().optional() })
    .optional()
    .describe(
      "A Thief's Fast Hands can take this item action (a Utilize action, or a magic item's Magic action) as a Bonus Action with `action.resolve`'s `fastHands`: whether that form can be used now, and why not"
    ),
  /** The ways its caster may shape this spell's cast (Metamagic, Sculpt Spells), for the cast to offer. */
  shaping: CastShapingOffersSchema.optional(),
  /** Its user may answer this action's damage roll after seeing it (Empowered Spell on a spell, Heroic Inspiration):
   *  `action.resolve` with `commit: false` and `damageLook` rolls the damage and holds it for the answer. */
  damageLook: z.literal(true).optional(),
  /** Its area grows by `feet` for each slot level above `level`, the spell's own (Fog Cloud's radius by 20), so the
   *  template drawn for a higher slot is the size the server places. */
  areaPerSlot: z.strictObject({ feet: z.number().int().min(1), level: z.number().int().min(0).max(9) }).optional(),
  /** The forms a shape-shift may take now, for the user to pick (`action.resolve`'s `form`): Wild Shape's known forms,
   *  the bestiary's Beasts for Polymorph, a werewolf's printed forms with its true form. Wild Shape also lists the
   *  forms its user may learn, how many it knows and whether a Long Rest opened one to replace. */
  forms: z
    .strictObject({
      options: z.array(FormOptionSchema),
      perTarget: z.literal(true).optional(),
      gearChoice: z.literal(true).optional(),
      learnable: z.array(FormOptionSchema).optional(),
      knownLimit: z.number().int().optional(),
      swapOpen: z.boolean().optional()
    })
    .optional()
    .describe(
      "The forms a shape-shift may take now, sent back as the resolve's `form` (or `targetForms`, one per target, when `perTarget`); `gearChoice` lets the user say whether its gear melds or is worn. For Wild Shape, the Beasts its user may learn (`learnable`), how many it knows (`knownLimit`) and whether one may be replaced now (`swapOpen`)"
    ),
  /** The effects a use picks one of (Enlarge or Reduce), or the form of the area a cast leaves (Wall of Fire's ring),
   *  sent back as the resolve's `option`; an option with an `area` is placed as that area. */
  options: z.array(z.strictObject({ id: z.string(), name: z.string(), area: ActionAreaSchema.optional() })).optional(),
  /** The creature types a cast's barrier may ward, for its user to pick one or more of (Magic Circle, Hallow); sent
   *  back as the resolve's `creatureTypes`, all of them when none is picked. */
  wardTypes: z.array(z.string()).optional(),
  /** Present when the option belongs off the turn list: `rider` changes a roll, a hit or a cast and is chosen with it
   *  (Savage Attacker, Sneak Attack), `rest` is used when a rest ends (Arcane Recovery), `automatic` the server runs
   *  (a spell area's later save). */
  passive: z
    .enum(["rider", "rest", "automatic"])
    .optional()
    .describe(
      "Present when the option belongs off a turn list: rider (it changes a roll, a hit or a cast and is chosen with it: Savage Attacker, Sneak Attack, Metamagic, Indomitable), rest (it is used when a rest ends: Arcane Recovery) or automatic (the server runs it: a spell area's later save). Absent for everything a creature takes on a turn."
    )
});
export type ActionAvailability = Wire<z.infer<typeof ActionAvailabilitySchema>>;
export type PassiveOption = NonNullable<ActionAvailability["passive"]>;
/** A roll's mode as the rules count it, with what grants each side, so the sheet can say why before the roll. */
const RollModeSummarySchema = z.strictObject({
  mode: z.enum(["advantage", "disadvantage", "normal"]),
  advantage: z.array(z.string()),
  disadvantage: z.array(z.string())
});
/** The sheet's derived numbers. Sent only via `actor:available-actions` (authorized per actor); `PlayerView` leaves them out. Every
 *  number is what the server would roll: Exhaustion, item riders and features included. */
const DerivedAbilityRowSchema = z.strictObject({
  ability: AbilityIdSchema,
  check: z
    .number()
    .int()
    .describe("The ability-check bonus the server rolls: item check-bonus riders and Exhaustion included"),
  checkMode: RollModeSummarySchema.describe(
    "Advantage or Disadvantage the rules give this ability's checks, with what grants each side (Poisoned, armor worn without training, Hex)"
  ),
  save: z
    .number()
    .int()
    .describe(
      "The save the server will actually roll, minus only per-save cover and an ally Paladin's aura (both depend on the moment)"
    ),
  saveMode: RollModeSummarySchema.describe("Advantage or Disadvantage the rules give this save, with its sources"),
  saveProficient: z.boolean(),
  saveFromItems: z
    .number()
    .int()
    .describe("The equipment share of `save`, so a sheet can say where the bonus came from"),
  /** The condition that makes a Strength or Dexterity save fail without a roll (Paralyzed); null otherwise. */
  saveAutoFails: z
    .string()
    .nullable()
    .describe(
      "The condition that makes a Strength or Dexterity save fail without a roll (Paralyzed, Stunned); null otherwise"
    )
});
export type DerivedAbilityRow = Wire<z.infer<typeof DerivedAbilityRowSchema>>;
/** `tier` is the effective tier: the sheet's base raised by any item grant. `sources` names the items that raised it.
 *  `reliableTalent`: a d20 of 9 or lower counts as 10 on this check. */
const DerivedSkillRowSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  ability: AbilityIdSchema.nullable(),
  tier: z
    .enum(["none", "proficient", "expertise"])
    .describe("The effective tier: the sheet's base tier raised by any item grant"),
  bonus: z
    .number()
    .int()
    .nullable()
    .describe(
      "What the server adds to the d20 (proficiency or Expertise, Jack of All Trades, a stat block's printed skill, riders, Exhaustion). Null only when the skill names no ability, the one case a sheet cannot roll it"
    ),
  sources: z.array(z.string()).describe('Item names that raised the tier, e.g. ["Circlet of Shadows"]'),
  mode: RollModeSummarySchema.describe(
    "Advantage or Disadvantage the rules give this skill's checks, with its sources"
  ),
  reliableTalent: z.boolean().describe("A d20 of 9 or lower counts as 10 on this check (Reliable Talent)")
});
export type DerivedSkillRow = Wire<z.infer<typeof DerivedSkillRowSchema>>;
/** A tool the character is proficient with, checked with the ability its SRD entry names. */
/** One printed Utilize use: what it does and its DC. */
const DerivedUtilizeUseSchema = z.strictObject({
  label: z.string(),
  dc: z.number().int().min(1).max(40),
  /** The skill the check uses with it (Thieves' Tools' lock: Sleight of Hand). */
  skill: z.string().optional().describe("The skill the check uses with it (Thieves' Tools' lock: Sleight of Hand)"),
  /** The use works for a creature its user picks within 5 feet (Cobbler's Tools' footwear), sent as `forActorId`. */
  forAnother: z
    .literal(true)
    .optional()
    .describe(
      "The use works for a creature its user picks within 5 feet (Cobbler's Tools' footwear), sent as `forActorId`"
    )
});
const DerivedToolRowSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  ability: AbilityIdSchema,
  bonus: z.number().int(),
  mode: RollModeSummarySchema,
  reliableTalent: z.boolean(),
  /** The character is proficient with the tool, so its checks add the Proficiency Bonus. */
  proficient: z
    .boolean()
    .describe("The character is proficient with the tool, so its checks add the Proficiency Bonus"),
  /** The tool is in the character's pack, which every use of it needs. */
  carried: z.boolean().describe("The tool is in the character's pack, which every use of it needs"),
  uses: z
    .array(DerivedUtilizeUseSchema)
    .describe(
      "What the tool's Utilize line lets it do, each with its printed DC (Thieves' Tools: Pick a lock, DC 15), rolled with `check.roll`'s `tool` and `use` (its place in this list). It needs the tool carried, and in a fight it takes the Utilize action. Empty when the tool prints none"
    )
});
export type DerivedToolRow = Wire<z.infer<typeof DerivedToolRowSchema>>;
/** A carried piece of gear's printed Utilize uses, each a check at its DC (a Grappling Hook's catch). */
const DerivedGearUsesSchema = z.strictObject({
  id: z.string().describe("The item's catalog id, sent as `check.roll`'s `item`"),
  name: z.string(),
  uses: z.array(
    DerivedUtilizeUseSchema.extend({
      ability: AbilityIdSchema,
      bonus: z.number().int().describe("The check's bonus"),
      mode: RollModeSummarySchema
    })
  )
});
export type DerivedGearUses = Wire<z.infer<typeof DerivedGearUsesSchema>>;
/** A situation the character's riders name for its checks (a Book's topic, prying with a Crowbar), offered as a toggle
 *  beside the checks. */
const DerivedSituationSchema = z.strictObject({
  situation: z.string().describe('The plain words, e.g. "consulting an accurate Book about its topic"'),
  source: z.string().describe("The item, feature or effect whose rider names it"),
  effect: z.string().describe('What it gives a check it fits, e.g. "+5" or "Advantage"'),
  abilities: z.array(AbilityIdSchema).describe("The abilities whose checks it can fit; empty for any"),
  skills: z.array(z.string()).describe("The skills whose checks it can fit; empty for any")
});
/** One damage type a defence covers, and what grants it (null for the stat block itself). */
const DerivedDefenceSchema = z.strictObject({
  type: z.string().describe('A damage type, e.g. "fire"'),
  source: z.string().nullable().describe("The feature, item or effect that grants it; null for the stat block itself")
});
export type DerivedDefence = Wire<z.infer<typeof DerivedDefenceSchema>>;
const ActorDerivedSheetSchema = z.strictObject({
  proficiencyBonus: z.number().int(),
  armorClass: z.number().int().describe("Live AC, already reconciled against worn armour and item riders"),
  initiative: z.number().int().describe("Live initiative bonus including item riders"),
  abilities: z.array(DerivedAbilityRowSchema),
  skills: z.array(DerivedSkillRowSchema),
  tools: z
    .array(DerivedToolRowSchema)
    .describe(
      "The tools the character is proficient with or carries that the SRD names an ability for, each with its check bonus"
    ),
  /** The carried gear with printed Utilize uses (a Grappling Hook's catch, tying a Rope's knot). */
  gearUses: z
    .array(DerivedGearUsesSchema)
    .describe("The carried gear with printed Utilize uses, each a check at its DC (a Grappling Hook's catch)"),
  /** A Thief's Fast Hands: a Utilize use, a magic item's Magic action and a Sleight of Hand check can be a Bonus
   *  Action. */
  fastHands: z
    .boolean()
    .describe(
      "A Thief's Fast Hands: a Utilize use, a magic item's Magic action and a Dexterity (Sleight of Hand) check can be taken as a Bonus Action"
    ),
  /** 10 plus the Wisdom (Perception) bonus, 5 more with Advantage on such checks or 5 less with Disadvantage. */
  passivePerception: z
    .number()
    .int()
    .describe(
      "10 plus the Wisdom (Perception) bonus, 5 more with Advantage on such checks or 5 less with Disadvantage"
    ),
  /** Speed now, before Dash: Exhaustion, Slow, armor too heavy for the wearer and Speed-0 conditions included; null
   *  when the sheet records none. */
  speedFeet: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Speed now, before Dash: Exhaustion, Slow, heavy armor and Speed-0 conditions included"),
  /** The damage defences in force outside any one hit: the stat block's, chosen features', items' and
   *  effects', as the damage pipeline reads them. */
  defences: z
    .strictObject({
      resistances: z.array(DerivedDefenceSchema),
      immunities: z.array(DerivedDefenceSchema),
      vulnerabilities: z.array(DerivedDefenceSchema)
    })
    .describe(
      "The damage defences in force outside any one hit, as the damage pipeline applies them: the stat block's, chosen features', items' and effects'. Petrified and underwater resistance are added per hit and are not listed."
    ),
  /** What standing `spell-save-dc` riders add to the bearer's spell save DC, and so to every action that uses it. */
  spellSaveDcBonus: z
    .number()
    .int()
    .describe(
      "What standing spell-save-dc riders (an item, a feat) add to the bearer's spell save DC, and so to every action that uses it. A printed DC is not raised."
    ),
  /** How many items the bearer can attune to at once: 3, or 4 with Use Magic Device. */
  attunementSlots: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("How many items the character can attune to at once: 3, or 4 with Use Magic Device"),
  /** What the creature carries against what it can; over capacity its Speed is at most 5 feet, over twice it 0. */
  carrying: z
    .strictObject({
      pounds: z
        .number()
        .min(0)
        .describe(
          "What its rows and coins weigh, in pounds (fifty coins to the pound), what its containers hold counted as they weigh it"
        ),
      capacity: z
        .number()
        .min(0)
        .describe("The most it can carry: Strength times 15 pounds for a Small or Medium creature, by size"),
      dragLimit: z.number().min(0).describe("The most it can drag, lift or push: twice its capacity")
    })
    .nullable()
    .describe(
      "What the creature carries against its carrying capacity. Beyond it, its Speed is no more than 5 feet, and beyond twice it 0. Null for a creature with no sheet or stat block"
    ),
  /** The weapon kinds chosen under Weapon Mastery, in the order chosen, each with the property it grants and the SRD
   *  text of what that property does. Empty for a sheet that records no such choice. */
  weaponMasteries: z
    .array(
      z.strictObject({
        weaponId: z.string().describe("The weapon kind, a catalog id such as greatsword"),
        weaponName: z.string(),
        mastery: z
          .strictObject({ id: z.string(), name: z.string(), description: z.string() })
          .describe("The mastery property the kind grants, with the SRD text of what it does")
      })
    )
    .describe(
      "The weapon kinds the character chose under Weapon Mastery, in the order chosen, whether or not it carries one. Empty for a sheet that records no such choice (an import)."
    ),
  /** The class table's printed columns no use counts, each class at its own level. */
  classColumns: z
    .array(
      z.strictObject({
        classId: z.string(),
        className: z.string().describe("The class as the sheet names it"),
        id: z.string().describe("The column's id, e.g. bardic-inspiration"),
        name: z.string().describe('The column as the class table prints it, e.g. "Bardic Die"'),
        value: z.string().describe('Its value at the character\'s level in that class, e.g. "d8", "3d6", "+2"')
      })
    )
    .describe(
      "The columns a class table prints that no use counts (the Bardic Die, Martial Arts, Sneak Attack, Rage Damage, Eldritch Invocations, Weapon Mastery), each class at the character's level in it. A column wired to a pool (Rages, Focus Points, Sorcery Points) is a use instead. Empty for a sheet with no class the catalog knows."
    ),
  situations: z
    .array(DerivedSituationSchema)
    .describe(
      "The situations the character's equipped items, features and effects name for its checks (a Book's topic, prying with a Crowbar), each with what it gives and the checks it can fit. A check roll that names one gets its rider; the GM judges whether the roll fits."
    )
});
export type ActorDerivedSheet = Wire<z.infer<typeof ActorDerivedSheetSchema>>;
export type DerivedWeaponMastery = ActorDerivedSheet["weaponMasteries"][number];
/** A pick this character may re-make on a rest (Circle of the Land's land after a Long Rest), with its options and
 *  the answer in force. */
const RechoiceSchema = z.strictObject({
  offer: z.string(),
  label: z.string(),
  per: z.enum(["short-rest", "long-rest"]),
  options: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  chosen: z.string().nullable(),
  /** A pick of several (Weapon Mastery's weapon kinds): the answers in force, each swapped by `replacing` it. */
  held: z.array(z.string()).optional(),
  /** How many of `held` one rest lets the character swap: Weapon Mastery's "change one of those" is 1. */
  swaps: z.number().int().min(1).optional()
});
export type Rechoice = Wire<z.infer<typeof RechoiceSchema>>;
/** What a prepared caster may change about its spells (SRD Spell Preparation by Class): for each class that changes its
 *  list after a Long Rest, the spells it may swap in for one the sheet lists (its class list for which it has slots, a
 *  Wizard's spellbook), and a Wizard's spellbook: the spells in it, how many more its levels add free, the highest
 *  level it can prepare, and the Wizard spells that could go in. Null for a sheet that can't be rebuilt here. */
const SpellChoicesSchema = z.strictObject({
  swaps: z.array(
    z.strictObject({
      classId: z.string(),
      className: z.string(),
      /** The sheet's spells this class chose, which a swap replaces. */
      replaces: z.array(z.string()),
      spellIds: z.array(z.string())
    })
  ),
  spellbook: z
    .strictObject({
      spellIds: z.array(z.string()),
      freeLeft: z.number().int().min(0),
      /** Free additions a feature gives for spells of one school, beyond the levels' (Evocation Savant's one each time
       *  a new level of spell slots opens). */
      freeOfSchool: z.strictObject({ school: z.string(), left: z.number().int().min(0) }).nullable(),
      maxLevel: z.number().int().min(0).max(9),
      addable: z.array(z.string())
    })
    .nullable()
});
export type SpellChoices = Wire<z.infer<typeof SpellChoicesSchema>>;
/** One way a character's feature turns one resource into another or recovers one (Font of Magic, Arcane Recovery), as
 *  `actor.convert` would apply it now: what it costs and gives, when it may be used, why it can't be now, and what
 *  the user picks. */
export const ConversionOfferSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** What it costs and what it gives, in a sentence. */
  line: z.string(),
  /** When it may be used: at any moment, as a Bonus Action or a Magic action on the character's turn in a fight, in
   *  the step a finished Short Rest opens, over a minute outside a fight, or from rolling Initiative to the end of the
   *  character's first turn. */
  timing: z.enum(["no-action", "bonus-action", "magic-action", "after-short-rest", "one-minute", "on-initiative"]),
  /** Why it can't be used now; null when it can. */
  reason: z.string().nullable(),
  pick: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    /** One slot to spend, from those left. */
    z.strictObject({
      kind: z.literal("slot"),
      options: z.array(z.strictObject({ level: z.number().int(), pact: z.boolean(), left: z.number().int() }))
    }),
    /** One slot to make, with what each costs. */
    z.strictObject({
      kind: z.literal("create-slot"),
      options: z.array(z.strictObject({ level: z.number().int(), cost: z.number().int() }))
    }),
    /** Spent slots to recover, their levels adding up to at most `budget`. */
    z.strictObject({
      kind: z.literal("recover-slots"),
      budget: z.number().int(),
      options: z.array(z.strictObject({ level: z.number().int(), spent: z.number().int() }))
    }),
    /** How many uses or points, from `min` to `max`. */
    z.strictObject({ kind: z.literal("count"), min: z.number().int(), max: z.number().int(), unit: z.string() })
  ])
});
export type ConversionOffer = Wire<z.infer<typeof ConversionOfferSchema>>;
/** What `actor:available-actions` answers: the table's rules mode, each action's availability, the sheet, and the
 *  picks the character may re-make on a rest. */
export const AvailableActionsReplySchema = z.strictObject({
  rulesMode: z.enum(["strict", "assisted", "freeform"]),
  actions: z.array(ActionAvailabilitySchema),
  derived: ActorDerivedSheetSchema.describe(
    "Display only, and the sheet's single source for every number beside a roll button. Derived from the actor's live loadout with the same functions the resolver uses, so a chip cannot disagree with the roll it starts: a circlet's granted expertise and an amulet's save bonus are already inside these numbers. Present on every response; a client should still tolerate its absence so it can talk to an older server. It rides this request, outside the broadcast game-state projection, on purpose: this endpoint already authorizes its caller for one named actor, so the block is never even computed for an actor the caller may not see."
  ),
  rechoices: z.array(RechoiceSchema),
  spellChoices: SpellChoicesSchema.nullable(),
  conversions: z
    .array(ConversionOfferSchema)
    .describe(
      "The ways the character's features turn one resource into another or recover one (Font of Magic, Arcane Recovery, restoring a use with a Rage), each with why it can't be used now; `actor.convert` applies one"
    )
});
export type AvailableActionsReply = Wire<z.infer<typeof AvailableActionsReplySchema>>;
export type ActorActionsAvailabilityResult = { ok: boolean; message?: string } & Partial<AvailableActionsReply>;

/** What `actor:movement` answers: whether a move spends this creature's movement right now, and how much is left. */
export const ActorMovementReplySchema = z.strictObject({
  /** True while combat runs, it is this creature's turn and movement rules are on. Otherwise moves are free. */
  counted: z.boolean(),
  /** This turn's movement budget (Speed after exhaustion, Slow and the like, plus Dash); null when unknown. */
  speedFeet: z.number().min(0).nullable(),
  usedFeet: z.number().min(0),
  /** What going over does: `strict` refuses the move, `assisted` lets it through with a warning. */
  enforcement: RuleModeSchema,
  /** The ways it can move this turn and each one's budget: walking always, a special speed when it has one, and
   *  climbing or swimming with Speed when it hasn't (`extraCost`: each foot costs an extra foot). */
  modes: z
    .array(
      z.strictObject({
        mode: z.enum(["walk", "fly", "swim", "climb", "burrow"]),
        budgetFeet: z.number().min(0),
        extraCost: z.boolean()
      })
    )
    .optional(),
  /** Prone: it can only crawl, each foot costing an extra foot (two in Difficult Terrain). */
  crawling: z.boolean().optional(),
  /** It drags a creature it grapples that isn't Tiny or two sizes smaller, each foot costing an extra foot. */
  dragging: z.boolean().optional(),
  /** A move an action or feature granted it for this turn, beside its own (Pounce, Tactical Shift): the feet left,
   *  the way it travels when only one, whether it provokes Opportunity Attacks, and whether it is a jump. */
  granted: z
    .strictObject({
      name: z.string(),
      feet: z.number().min(0),
      mode: z.enum(["walk", "fly", "swim", "climb", "burrow"]).optional(),
      provokes: z.boolean(),
      jump: z.boolean().optional()
    })
    .optional(),
  /** It passes through walls and creatures as through Difficult Terrain (a ghost's Incorporeal Movement). */
  throughWalls: z.boolean().optional(),
  /** How narrow an opening it passes with no extra movement: any gap (`point`: Amorphous, "as narrow as 1 inch"), or
   *  one a Tiny creature fits (`tiny`: a swarm). */
  opening: z.enum(["point", "tiny"]).optional(),
  /** Burrowing, it goes through walls: freely through earth and stone (`free`: Earth Glide), or at half its Burrow
   *  Speed (`half`: Tunneler). */
  burrowsThroughWalls: z.enum(["free", "half"]).optional(),
  /** Difficult Terrain costs it nothing extra (Freedom of Movement). */
  ignoresDifficultTerrain: z.boolean().optional(),
  /** It is on the Border Ethereal: the walls and creatures of the world it left are no obstacle, and it may rise or
   *  descend, each foot up or down costing an extra foot (Etherealness). */
  ethereal: z.boolean().optional(),
  /** A teleport granted it for this turn (Misty Step): up to `feet` to an unoccupied space it can see. */
  teleport: z.strictObject({ name: z.string(), feet: z.number().min(0) }).optional(),
  /** It may end a move in another creature's space (Air Form, a swarm), so no creature bars its way; a creature's
   *  space still costs as Difficult Terrain. */
  passesCreatures: z.boolean().optional(),
  /** It may pass through the space of any creature larger than itself, as Difficult Terrain, and not stop there
   *  (Halfling Nimbleness). */
  nimble: z.boolean().optional(),
  /** The swarms on the map the asker can see. Any creature may cross a swarm's space, as Difficult Terrain. */
  swarmIds: z.array(z.uuid()).max(200).optional(),
  /** The ground the spell areas the asker can see change for this mover, in grid cells near it, as the server charges
   *  it: Difficult Terrain (each cell), and where its footprint (named by its top-left cell) has its Speed halved,
   *  costs double again on the ground (Plant Growth), or pays double for a step toward an area's caster (Gust of
   *  Wind's Line, the caster's position in image pixels). `cleared`: cells whose painted Difficult Terrain an area lifts
   *  (Speak with Plants). */
  areaGround: z
    .strictObject({
      difficult: z.array(z.strictObject({ column: z.number().int(), row: z.number().int() })).max(4000),
      cleared: z
        .array(z.strictObject({ column: z.number().int(), row: z.number().int() }))
        .max(4000)
        .optional(),
      halved: z.array(z.strictObject({ column: z.number().int(), row: z.number().int() })).max(4000),
      costlyGround: z.array(z.strictObject({ column: z.number().int(), row: z.number().int() })).max(4000),
      toward: z
        .array(
          z.strictObject({
            caster: z.strictObject({ x: z.number(), y: z.number() }),
            cells: z.array(z.strictObject({ column: z.number().int(), row: z.number().int() })).max(4000)
          })
        )
        .max(10)
    })
    .optional()
});
export type ActorMovementReply = Wire<z.infer<typeof ActorMovementReplySchema>>;
export type ActorMovementResult = { ok: boolean; message?: string } & Partial<ActorMovementReply>;

/** What `character:next-level` answers: the level a character's next level-up reaches, the class it goes to (the one
 *  the Level page offers first), and short plain lines for what it brings. */
export const NextLevelReplySchema = z.strictObject({
  level: z.number().int().min(2).max(20).describe("The character level the next level-up reaches"),
  classId: z
    .string()
    .describe("The class that level goes to: the class of the last level taken, which the Level page offers first"),
  className: z.string(),
  classLevel: z.number().int().min(1).max(20).describe("That class's own level after the level-up"),
  lines: z
    .array(z.string())
    .describe(
      "Short plain lines in order: the Proficiency Bonus when it rises, each feature gained, each pick no feature names, spell slots, prepared spells and cantrips, a Wizard's spellbook spells, and the Hit Points the level adds (the die plus today's Constitution modifier and per-level riders, or the average)"
    )
});
export type NextLevelReply = Wire<z.infer<typeof NextLevelReplySchema>>;
export type NextLevelResult = MutationResult & Partial<NextLevelReply>;

/** One thing a character could start making: its raw materials and the 8-hour days of work it takes alone. */
const CraftOfferSchema = z.strictObject({
  id: z.string().describe("The catalog item, sent as `crafting.start`'s `itemId`"),
  name: z.string(),
  kind: z.enum(["item", "potion-of-healing", "spell-scroll", "magic-item"]),
  materialsCp: z.number().int().min(0).describe("What its raw materials cost, in copper pieces"),
  days: z.number().min(0).describe("The 8-hour days of work it takes one worker; helpers divide them"),
  baseIds: z
    .array(z.string())
    .optional()
    .describe("A magic weapon's or armor's choice of base, sent as `baseId`; the base's price is paid unless carried")
});
/** What `actor:crafting-offers` answers its owner or the GM (SRD 5.2.1 Crafting). */
export const CraftingOffersReplySchema = z.strictObject({
  tools: z
    .array(
      z.strictObject({
        toolId: z.string(),
        name: z.string(),
        carried: z.boolean().describe("The tool is in the pack, which crafting with it needs"),
        items: z.array(CraftOfferSchema)
      })
    )
    .describe("The tools the character is proficient with, each with what its Craft line makes and the price"),
  scrolls: z
    .strictObject({
      carried: z.boolean().describe("Calligrapher's Supplies are in the pack"),
      spells: z.array(
        z.strictObject({
          id: z.string(),
          name: z.string(),
          level: z.number().int().min(0).max(9),
          days: z.number(),
          materialsCp: z.number().int().min(0)
        })
      )
    })
    .nullable()
    .describe(
      "Scribing Spell Scrolls with proficiency in Arcana or with Calligrapher's Supplies: the prepared spells it can scribe, with the Spell Scroll Costs table's days and gold; null without the proficiency"
    ),
  magicItems: z
    .array(
      CraftOfferSchema.extend({
        rarity: z.string(),
        toolIds: z.array(z.string()).describe("The tools it can be made with that the character is proficient with")
      })
    )
    .describe("Magic items it can craft with Arcana proficiency and a tool it is proficient with"),
  purseCp: z.number().int().min(0).describe("What its purse holds, in copper pieces")
});
export type CraftingOffersReply = Wire<z.infer<typeof CraftingOffersReplySchema>>;
export type CraftingOffersResult = MutationResult & Partial<CraftingOffersReply>;

/** What `vision:preview` answers the GM: where one creature (or the whole party) sees now, as image-pixel polygons
 *  (`[x0, y0, x1, y1, ...]`), and the creatures it perceives. Empty while the scene's vision is off. */
export const VisionPreviewReplySchema = z.strictObject({
  enabled: z.boolean(),
  visible: z.array(z.array(z.number())),
  actorIds: z.array(z.string())
});
export type VisionPreviewReply = Wire<z.infer<typeof VisionPreviewReplySchema>>;
export type VisionPreviewResult = { ok: boolean; message?: string } & Partial<VisionPreviewReply>;

/**
 * What `scene:preview` answers the GM: what one audience would receive if the scene were live now, from the same
 * projections that build the real feeds. `screen` is the shared screen's map (its encounter and turn order, as the
 * presentation carries them); `player` is that character's player's combat and the creatures in it.
 */
export const ScenePreviewReplySchema = z.strictObject({
  sceneId: z.uuid(),
  live: z.boolean(),
  mapAssetId: z.uuid(),
  actorId: z.uuid().nullable(),
  screen: z.strictObject({ encounter: z.looseObject({}), initiative: z.looseObject({}) }).nullable(),
  player: z.strictObject({ combat: z.looseObject({}), actors: z.array(z.looseObject({})) }).nullable()
});
export type ScenePreviewReply = Omit<Wire<z.infer<typeof ScenePreviewReplySchema>>, "player" | "screen"> & {
  screen: { encounter: Record<string, unknown>; initiative: Record<string, unknown> } | null;
  player: { combat: PlayerView["combat"]; actors: PlayerView["actors"] } | null;
};
export type ScenePreviewResult = { ok: boolean; message?: string } & Partial<ScenePreviewReply>;
export type WallAddResult = MutationResult & { wallIds?: readonly string[] };
export type LightAddResult = MutationResult & { lightId?: string };
/** What working on a door came to: the line the table reads, and whether the door came open. */
export type DoorUseResult = MutationResult & { text?: string; opened?: boolean };
/** An attack on an object: hit or miss, and whether it broke. A player is told neither the object's Armor Class nor
 *  the Hit Points it has left. */
export type ObjectAttackResult = MutationResult & {
  outcome?: "hit" | "crit" | "miss";
  total?: number;
  damage?: number;
  destroyed?: boolean;
};

/** What `character:draft` answers: the caller's parked build and when it was last saved, or null for none. */
export const CharacterDraftReplySchema = z.strictObject({
  draft: z.strictObject({ draft: CharacterDraftSchema, updatedAt: z.iso.datetime() }).nullable()
});
export type CharacterDraftReply = Wire<z.infer<typeof CharacterDraftReplySchema>>;
export type CharacterDraftResult = { ok: boolean; message?: string } & Partial<CharacterDraftReply>;

/** Which builder step shows an offer: the step that chose its source. */
const BuilderOfferStepSchema = z.enum(["species", "background", "class", "features", "equipment"]);
export type BuilderOfferStep = z.infer<typeof BuilderOfferStepSchema>;

/** One pick the content asks a build for, as the server works it out for a draft (`builder:offers`). */
const BuilderOfferSchema = z.strictObject({
  /** Stable key into the draft's picks. */
  key: z.string().describe("Stable key the draft's answers are filed under"),
  step: BuilderOfferStepSchema,
  /** The feature that offers the pick; a choose-N list (class skills, background languages) has none. */
  featureId: z.string().nullable(),
  kind: z.string(),
  label: z.string(),
  help: z.string().nullable(),
  capacity: z.number().int().min(0),
  options: z.array(z.strictObject({ id: z.string(), name: z.string(), level: z.number().int().optional() })),
  maxSpellLevel: z.number().int().nullable(),
  /** The ceiling an ability-score pick from this offer may reach (an Epic Boon's 30); null is the SRD's 20. */
  maximum: z.number().int().nullable(),
  /** Character level stamped on this offer's ledger rows. */
  level: z.number().int().min(1).max(20),
  classId: z.string().nullable(),
  /** Set when the content offers nothing to pick here yet (a catalog gap, or no eligible earlier answer):
   *  the pick may be left open. */
  unresolvable: z.string().nullable().describe("Why nothing can be picked here yet; such an offer may be left open"),
  /** Option id -> why this build cannot usefully take it (already held, or no proficiency to build on).
   *  Shown disabled, so an earlier answer never vanishes. Null for kinds without the rule. */
  unavailable: z
    .record(z.string(), z.string())
    .nullable()
    .describe("Option id -> why this build cannot usefully take it (already held, or no proficiency)")
});
export type BuilderOffer = Wire<z.infer<typeof BuilderOfferSchema>>;

/** One ASI's split: at most two abilities, +1 or +2 each. Shared by the offers read's request and reply. */
export const BuilderAbilityIncreasesSchema = z
  .array(z.strictObject({ ability: AbilityIdSchema, amount: z.number().int().min(1).max(2) }))
  .max(2);
export type BuilderAbilityIncrease = Wire<z.infer<typeof BuilderAbilityIncreasesSchema>>[number];

/** A builder draft as the offers read takes it: the identity chosen so far plus either the answers by offer
 *  key (the wizard) or a stored ledger (a rebuild reading a character back). */
export type BuilderOffersRequest = Readonly<{
  speciesId?: string;
  backgroundId?: string;
  classId?: string;
  level: number;
  /** The class each character level went to, in order (index 0 is level 1); absent for one class. */
  classLevels?: readonly string[];
  picks?: Readonly<Record<string, readonly string[]>>;
  asiIncreases?: Readonly<Record<string, readonly BuilderAbilityIncrease[]>>;
  choices?: readonly CharacterChoice[];
  /** With `choices`, the stored sheet's level and ability scores: the reply then says how those scores were made. */
  sheet?: Readonly<{ level: number; abilityScores: Readonly<Record<BuilderAbility, number>> }>;
}>;
type BuilderAbility = z.infer<typeof AbilityIdSchema>;

/** How a stored character's ability scores were made: the ledger's record, or for a sheet built before the ledger
 *  kept one, the base scores and background increase that rebuild its totals (`derived`). */
const BuilderSheetAbilitiesSchema = z.strictObject({
  abilityMethod: BuilderAbilityMethodSchema,
  baseScores: z.record(AbilityIdSchema, z.number().int()),
  backgroundBonusAllocation: z.array(z.strictObject({ ability: AbilityIdSchema, amount: z.number().int() })),
  derived: z
    .boolean()
    .describe(
      "True when worked out from the sheet's totals; false when read from its ledger. A rebuild may re-send these whatever ability methods the table allows today."
    )
});

/** What the build offers, the answers it still accepts (picks it no longer offers are dropped), and the
 *  ledger rows those answers make, which `character.create` carries. */
export const BuilderOffersReplySchema = z.strictObject({
  offers: z.array(BuilderOfferSchema),
  picks: z.record(z.string(), z.array(z.string())).describe("The answers the build still accepts, by offer key"),
  asiIncreases: z.record(z.string(), BuilderAbilityIncreasesSchema),
  subclassId: z.string().nullable().describe("The subclass offer's answer"),
  choices: z.array(CharacterChoiceSchema).describe("The ledger rows these answers make: a create's `choices`"),
  /** For a draft that sent `sheet`: how that sheet's scores were made. Null when not asked, or when no base scores
   *  and background increase reproduce them. */
  abilities: BuilderSheetAbilitiesSchema.nullable().describe(
    "For a draft that sent `sheet`: how that sheet's ability scores were made, which a rebuild re-sends as the scores the character already has. The ledger's own record, or for a sheet built before the ledger kept one, the base scores and background increase that rebuild its totals exactly. Null when not asked, or when nothing reproduces them."
  )
});
export type BuilderOffersReply = Wire<z.infer<typeof BuilderOffersReplySchema>>;
export type BuilderOffersResult = MutationResult & Partial<BuilderOffersReply>;

import { z } from "zod";
import {
  ActionReactionSchema,
  CharacterChoiceSchema,
  DamageTypeSchema,
  SaveConditionSchema,
  type CharacterChoice
} from "@vtt/schemas";
import { CharacterDraftSchema } from "./character-draft.js";
import { AbilityIdSchema, BuilderAbilityMethodSchema, RuleModeSchema, type AnnotationPoint } from "./state.js";
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
}>;
/** One extra chosen at confirm, and how. */
export type HitOptionChoice = Readonly<{ id: string; damageType?: string; slotLevel?: number }>;
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
  /** Reaction prompts this hit opened (Uncanny Dodge): the triggering damage waits on the answer. */
  reactionPrompts?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; actionName: string }>>;
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
  /** No attack roll and no save, but damage: what each target is owed, applied or proposed like a hit. A darts action
   *  (Magic Missile) owes each creature only what its own darts dealt. */
  damageTargets?: readonly DamageTarget[];
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
  /** The d20 was typed from a physical die. */
  typed?: true;
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
export const ActionAvailabilitySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  activation: z.enum(["action", "bonus-action", "reaction", "other"]),
  /** Whether strict mode would allow resolving this action right now (target-specific rules can't be pre-checked). */
  available: z.boolean(),
  violations: z.array(z.strictObject({ rule: z.string(), message: z.string() })),
  /** Limited-use spending left in the current scope; null when the action has no use limit. */
  usesRemaining: z.number().int().min(0).nullable(),
  /** Rolls left in the open compound-action instance for this action; null when no instance applies. */
  componentsRemaining: z.number().int().min(0).nullable(),
  /** True for the SRD generic actions every combatant can take (Dodge, Dash, Help, ...), which no stat block lists. */
  builtin: z.boolean().optional(),
  /** Added to a hit and never taken alone (Sneak Attack, a smite): chosen on an attack's result. */
  ridesAHit: z.literal(true).optional(),
  // Display values only (ADR-0007); resolution recomputes from the id.
  description: z.string(),
  attackBonus: z.number().int().nullable(),
  reachFeet: z.number().int().nullable(),
  rangeFeet: z.number().int().nullable(),
  rangeNormalFeet: z.number().int().nullable(),
  attackCount: z.number().int().nullable(),
  saveAbility: z.string().nullable(),
  saveDc: z.number().int().nullable(),
  damage: z.array(z.strictObject({ formula: z.string(), type: z.string() })),
  usesLimit: z.number().int().nullable(),
  usesPer: z.enum(["turn", "own-turn", "encounter", "long-rest", "short-rest", "recharge"]).nullable(),
  usesPool: z.string().nullable(),
  /** How many uses one activation spends when it is more than one, or `chosen` when the user picks it each time. */
  useCost: z.union([z.number().int(), z.literal("chosen")]).nullable(),
  requiresEffectTag: z.string().nullable(),
  multiattack: z
    .array(z.strictObject({ actionId: z.string(), count: z.number().int(), or: z.array(z.string()).optional() }))
    .nullable(),
  reaction: ActionReactionSchema.nullable(),
  /** The hit points it restores (a potion's 2d4 + 2), for display. */
  healing: z.strictObject({ formula: z.string() }).nullable().optional(),
  /** How many creatures one use heals when it can be more than one (Prayer of Healing's five); null otherwise. */
  healTargets: z.number().int().nullable().optional(),
  /** Who a tap picks: one creature, several, or none (it acts on its user); null when nothing structured resolves. */
  targeting: z.enum(["none", "single", "multi"]).nullable().optional(),
  /** Darts it makes, each assigned to a target (Magic Missile read from a scroll or cast from a wand). */
  darts: z.number().int().nullable().optional(),
  /** The damage types its caster picks from (Chromatic Orb). */
  damageTypes: z.array(DamageTypeSchema).nullable().optional(),
  /** The conditions its caster picks one of for a failed save (Blindness/Deafness); `action.resolve`'s `conditionId`. */
  conditionChoices: z.array(SaveConditionSchema).optional(),
  /** The skills a check action is made with, for the roller to pick (Search, Study, Influence, Escape a Grapple). */
  checkSkills: z.array(z.strictObject({ id: z.string(), ability: AbilityIdSchema })).optional(),
  /** The weapon mastery property this character uses with this swing (Graze on Borin's Greatsword): present only when
   *  the character chose the weapon's kind under Weapon Mastery. */
  mastery: z.strictObject({ id: z.string(), name: z.string() }).optional(),
  /** Why it can't be used now, in one short sentence ("Not prepared."); present exactly when `available` is false. */
  reason: z.string().optional(),
  /** Present when the option belongs off the turn list: `rider` changes a roll, a hit or a cast and is chosen with it
   *  (Savage Attacker, Sneak Attack), `rest` is used when a rest ends (Arcane Recovery), `automatic` the server runs
   *  (a spell area's later save). */
  passive: z.enum(["rider", "rest", "automatic"]).optional()
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
  check: z.number().int(),
  checkMode: RollModeSummarySchema,
  save: z.number().int(),
  saveMode: RollModeSummarySchema,
  saveProficient: z.boolean(),
  saveFromItems: z.number().int(),
  /** The condition that makes a Strength or Dexterity save fail without a roll (Paralyzed); null otherwise. */
  saveAutoFails: z.string().nullable()
});
export type DerivedAbilityRow = Wire<z.infer<typeof DerivedAbilityRowSchema>>;
/** `tier` is the effective tier: the sheet's base raised by any item grant. `sources` names the items that raised it.
 *  `reliableTalent`: a d20 of 9 or lower counts as 10 on this check. */
const DerivedSkillRowSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  ability: AbilityIdSchema.nullable(),
  tier: z.enum(["none", "proficient", "expertise"]),
  bonus: z.number().int().nullable(),
  sources: z.array(z.string()),
  mode: RollModeSummarySchema,
  reliableTalent: z.boolean()
});
export type DerivedSkillRow = Wire<z.infer<typeof DerivedSkillRowSchema>>;
/** A tool the character is proficient with, checked with the ability its SRD entry names. */
const DerivedToolRowSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  ability: AbilityIdSchema,
  bonus: z.number().int(),
  mode: RollModeSummarySchema,
  reliableTalent: z.boolean()
});
export type DerivedToolRow = Wire<z.infer<typeof DerivedToolRowSchema>>;
/** One damage type a defence covers, and what grants it (null for the stat block itself). */
const DerivedDefenceSchema = z.strictObject({ type: z.string(), source: z.string().nullable() });
export type DerivedDefence = Wire<z.infer<typeof DerivedDefenceSchema>>;
const ActorDerivedSheetSchema = z.strictObject({
  proficiencyBonus: z.number().int(),
  armorClass: z.number().int(),
  initiative: z.number().int(),
  abilities: z.array(DerivedAbilityRowSchema),
  skills: z.array(DerivedSkillRowSchema),
  tools: z.array(DerivedToolRowSchema),
  /** 10 plus the Wisdom (Perception) bonus, 5 more with Advantage on such checks or 5 less with Disadvantage. */
  passivePerception: z.number().int(),
  /** Speed now, before Dash: Exhaustion, Slow, armor too heavy for the wearer and Speed-0 conditions included; null
   *  when the sheet records none. */
  speedFeet: z.number().int().min(0).nullable(),
  /** The damage defences in force outside any one hit: the stat block's, chosen features', items' and
   *  effects', as the damage pipeline reads them. */
  defences: z.strictObject({
    resistances: z.array(DerivedDefenceSchema),
    immunities: z.array(DerivedDefenceSchema),
    vulnerabilities: z.array(DerivedDefenceSchema)
  }),
  /** What standing `spell-save-dc` riders add to the bearer's spell save DC, and so to every action that uses it. */
  spellSaveDcBonus: z.number().int(),
  /** How many items the bearer can attune to at once: 3, or 4 with Use Magic Device. */
  attunementSlots: z.number().int().min(1).max(10),
  /** The weapon kinds chosen under Weapon Mastery, in the order chosen, each with the property it grants and the SRD
   *  text of what that property does. Empty for a sheet that records no such choice. */
  weaponMasteries: z.array(
    z.strictObject({
      weaponId: z.string(),
      weaponName: z.string(),
      mastery: z.strictObject({ id: z.string(), name: z.string(), description: z.string() })
    })
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
  chosen: z.string().nullable()
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
      maxLevel: z.number().int().min(0).max(9),
      addable: z.array(z.string())
    })
    .nullable()
});
export type SpellChoices = Wire<z.infer<typeof SpellChoicesSchema>>;
/** What `actor:available-actions` answers: the table's rules mode, each action's availability, the sheet, and the
 *  picks the character may re-make on a rest. */
export const AvailableActionsReplySchema = z.strictObject({
  rulesMode: z.enum(["strict", "assisted", "freeform"]),
  actions: z.array(ActionAvailabilitySchema),
  derived: ActorDerivedSheetSchema,
  rechoices: z.array(RechoiceSchema),
  spellChoices: SpellChoicesSchema.nullable()
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
  dragging: z.boolean().optional()
});
export type ActorMovementReply = Wire<z.infer<typeof ActorMovementReplySchema>>;
export type ActorMovementResult = { ok: boolean; message?: string } & Partial<ActorMovementReply>;

/** What `character:next-level` answers: the level a character's next level-up reaches, the class it goes to (the one
 *  the Level page offers first), and short plain lines for what it brings. */
export const NextLevelReplySchema = z.strictObject({
  level: z.number().int().min(2).max(20),
  classId: z.string(),
  className: z.string(),
  classLevel: z.number().int().min(1).max(20),
  lines: z.array(z.string())
});
export type NextLevelReply = Wire<z.infer<typeof NextLevelReplySchema>>;
export type NextLevelResult = MutationResult & Partial<NextLevelReply>;

/** What `vision:preview` answers the GM: where one creature (or the whole party) sees now, as image-pixel polygons
 *  (`[x0, y0, x1, y1, ...]`), and the creatures it perceives. Empty while the scene's vision is off. */
export const VisionPreviewReplySchema = z.strictObject({
  enabled: z.boolean(),
  visible: z.array(z.array(z.number())),
  actorIds: z.array(z.string())
});
export type VisionPreviewReply = Wire<z.infer<typeof VisionPreviewReplySchema>>;
export type VisionPreviewResult = { ok: boolean; message?: string } & Partial<VisionPreviewReply>;
export type WallAddResult = MutationResult & { wallIds?: readonly string[] };
export type LightAddResult = MutationResult & { lightId?: string };

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
  key: z.string(),
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
  unresolvable: z.string().nullable(),
  /** Option id -> why this build cannot usefully take it (already held, or no proficiency to build on).
   *  Shown disabled, so an earlier answer never vanishes. Null for kinds without the rule. */
  unavailable: z.record(z.string(), z.string()).nullable()
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
  derived: z.boolean()
});

/** What the build offers, the answers it still accepts (picks it no longer offers are dropped), and the
 *  ledger rows those answers make, which `character.create` carries. */
export const BuilderOffersReplySchema = z.strictObject({
  offers: z.array(BuilderOfferSchema),
  picks: z.record(z.string(), z.array(z.string())),
  asiIncreases: z.record(z.string(), BuilderAbilityIncreasesSchema),
  subclassId: z.string().nullable(),
  choices: z.array(CharacterChoiceSchema),
  /** For a draft that sent `sheet`: how that sheet's scores were made. Null when not asked, or when no base scores
   *  and background increase reproduce them. */
  abilities: BuilderSheetAbilitiesSchema.nullable()
});
export type BuilderOffersReply = Wire<z.infer<typeof BuilderOffersReplySchema>>;
export type BuilderOffersResult = MutationResult & Partial<BuilderOffersReply>;

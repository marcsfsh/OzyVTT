import type { CharacterChoice } from "@vtt/schemas";
import type { CatalogChoiceOption } from "./catalog-choice.js";
import type { AbilityId, AnnotationPoint } from "./state.js";

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
export type EncounterStartEntry = Readonly<{
  actorId: string;
  score?: number;
  /** 2024 surprise: initiative rolls with disadvantage. */ surprised?: boolean;
}>;
export type AnnotationGeometryInput = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
export type AnnotationAddResult = MutationResult & { annotationId?: string };
export type ActorAddResult = MutationResult & { actorId?: string };
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
  kind: "movement" | "save";
  text: string;
  /** Everyone the line names. The feed keeps it from players when any of them is a hidden combatant. */
  actorIds: readonly string[];
  /** The resolver already knows this line names a hidden combatant; true forces the GM-only read. */
  gmOnly?: boolean;
}>;
export type ActionResolution = Readonly<{
  actionName: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  attack: ActionResolutionAttack | null;
  save: { ability: string; dc: number; targets: ReadonlyArray<{ targetId: string; targetName: string }> } | null;
  damage: ReadonlyArray<{ formula: string; type: string; total: number }>;
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
  /** Reaction prompts this hit opened (Uncanny Dodge): the triggering damage waits on the answer instead of the apply button. */
  reactionPrompts?: ReadonlyArray<Readonly<{ actorId: string; actorName: string; actionName: string }>>;
  /** A builtin action's check roll (Hide vs DC 15; Influence/Search/Study with dc/success null - GM adjudicates). */
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
    adjustment: "resistance" | "immunity" | "vulnerability" | null;
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
  /** Flat `damage-reduction` taken once off the post-resistance total, floored at 0. */
  flatReduction?: number;
}>;
export type DamageApplyResult = MutationResult & { applied?: DamageApplication };
export type DeathSaveResult = MutationResult & {
  deathSave?: Readonly<{
    naturalRoll: number;
    outcome: "success" | "failure" | "critical-success" | "critical-failure";
    successes: number;
    failures: number;
    stable: boolean;
    dead: boolean;
    regainedConsciousness: boolean;
    /** false = previewed only (pips unchanged, awaiting confirmation); true = applied. */ committed: boolean;
    /** The d20 mode when adv/disadv was chosen; absent for a plain roll. */ rollMode?:
      "advantage" | "disadvantage" | "normal";
  }>;
};
/** Outcome of answering a pending save; applied damage/condition already happened server-side when present. */
export type SaveAnswerResult = MutationResult & {
  outcome?: {
    success: boolean;
    total: number;
    dc: number;
    appliedDamage: number;
    conditionApplied: boolean;
    committed: boolean;
    /** Condition id that forced an automatic failure (Paralyzed on a Dex save); null/absent when rolled. */ autoFailed?:
      string | null;
    /** Advantage/disadvantage sources that shaped the save roll (Restrained, Dodge). */ rollMode?: ActionRollMode;
    /** The typed breakdown behind `appliedDamage`; absent when the save applied no damage. */ parts?: DamageApplication["parts"];
    /** Flat reduction taken off the post-resistance total. */ flatReduction?: number;
  };
};
/** Outcome of answering a reaction prompt; the (halved or full) damage already applied server-side. A used opportunity attack carries its full attack `resolution`. */
export type ReactionAnswerResult = MutationResult & {
  outcome?: {
    used: boolean;
    appliedDamage: number;
    resolution?: ActionResolution;
    /** The typed breakdown behind `appliedDamage`. */ parts?: DamageApplication["parts"];
    flatReduction?: number;
  };
};
/** One action's strict-mode availability for an actor, with every violated rule named (server-computed; ADR-0020 explainability). */
export type ActionAvailability = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  /** Whether strict mode would allow resolving this action right now (target-specific rules can't be pre-checked). */
  available: boolean;
  violations: ReadonlyArray<{ rule: string; message: string }>;
  /** Limited-use spending left in the current scope; null when the action has no use limit. */
  usesRemaining: number | null;
  /** Rolls left in the open compound-action instance for this action; null when no instance applies. */
  componentsRemaining: number | null;
  /** True for the SRD generic actions every combatant can take (Dodge, Dash, Help, ...) - not on the stat block. */
  builtin?: boolean;
}>;
/** The sheet's derived numbers. Sent only via `actor:available-actions` (authorized per actor), not `PlayerView`. */
export type DerivedAbilityRow = Readonly<{
  ability: AbilityId;
  check: number;
  checkWithProficiency: number;
  save: number;
  saveProficient: boolean;
  saveFromItems: number;
}>;
/** `tier` is the effective tier: the sheet's base raised by any item grant. `sources` names the items that raised it. */
export type DerivedSkillRow = Readonly<{
  id: string;
  name: string;
  ability: AbilityId | null;
  tier: "none" | "proficient" | "expertise";
  bonus: number | null;
  sources: readonly string[];
}>;
export type ActorDerivedSheet = Readonly<{
  proficiencyBonus: number;
  armorClass: number;
  initiative: number;
  abilities: readonly DerivedAbilityRow[];
  skills: readonly DerivedSkillRow[];
}>;
export type ActorActionsAvailabilityResult = {
  ok: boolean;
  message?: string;
  rulesMode?: "strict" | "assisted" | "freeform";
  actions?: readonly ActionAvailability[];
  derived?: ActorDerivedSheet;
};

/** Which builder step shows an offer: the step that chose its source. */
export type BuilderOfferStep = "species" | "background" | "class" | "features" | "equipment";

/** One pick the content asks a build for, as the server works it out for a draft (`builder:offers`). */
export type BuilderOffer = Readonly<{
  /** Stable key into the draft's picks. */
  key: string;
  step: BuilderOfferStep;
  /** The feature that offers the pick; a choose-N list (class skills, background languages) has none. */
  featureId: string | null;
  kind: string;
  label: string;
  help: string | null;
  capacity: number;
  options: readonly CatalogChoiceOption[];
  maxSpellLevel: number | null;
  /** Character level stamped on this offer's ledger rows. */
  level: number;
  classId: string | null;
  /** Set when the content offers nothing to pick here yet (a catalog gap, or no eligible earlier answer):
   *  the pick may be left open. */
  unresolvable: string | null;
  /** Option id -> why this build cannot usefully take it (already held, or no proficiency to build on).
   *  Shown disabled rather than hidden, so an earlier answer never vanishes. Null for kinds without the rule. */
  unavailable: Readonly<Record<string, string>> | null;
}>;

export type BuilderAbilityIncrease = Readonly<{ ability: AbilityId; amount: number }>;

/** A builder draft as the offers read takes it: the identity chosen so far plus either the answers by offer
 *  key (the wizard) or a stored ledger (a rebuild reading a character back). */
export type BuilderOffersRequest = Readonly<{
  speciesId?: string;
  backgroundId?: string;
  classId?: string;
  level: number;
  picks?: Readonly<Record<string, readonly string[]>>;
  asiIncreases?: Readonly<Record<string, readonly BuilderAbilityIncrease[]>>;
  choices?: readonly CharacterChoice[];
}>;

/** What the build offers, the answers it still accepts (picks it no longer offers are dropped), and the
 *  ledger rows those answers make, which `character.create` carries. */
export type BuilderOffersReply = Readonly<{
  offers: readonly BuilderOffer[];
  picks: Readonly<Record<string, readonly string[]>>;
  asiIncreases: Readonly<Record<string, readonly BuilderAbilityIncrease[]>>;
  subclassId: string | null;
  choices: readonly CharacterChoice[];
}>;
export type BuilderOffersResult = MutationResult & Partial<BuilderOffersReply>;

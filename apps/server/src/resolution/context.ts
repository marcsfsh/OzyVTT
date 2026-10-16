import type {
  ActionResolution,
  ActionResolutionAttack,
  ActionRollMode,
  ActionTableNarration,
  GameState,
  RollRecord
} from "@vtt/domain";
import {
  abilityModifier as scoreModifier,
  type AttackKind,
  type DiceResolution,
  type RandomSource,
  type RiderContext
} from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog, EquipmentDerivation } from "../equipment-derivation.js";
import { recordRoll as recordRollInHistory, rolledTerms } from "../roll-history.js";
import type { RuleId, RulesOverride } from "../rules-families.js";
import type { MasterySwing } from "../weapon-mastery.js";
import type { BuiltinHandler } from "./builtins.js";
import type { EconomyPlan } from "./economy.js";

export type DefinitionAction = ActorDefinition["actions"][number];
export type LiveActor = GameState["actors"][number];

export type ResolveInput = Readonly<{
  actorId: string;
  targetIds: readonly string[];
  commandId: string;
  conditionId?: string | null;
  /** Explicit GM roll-mode choice; wins over the aggregated advantage/disadvantage sources. */
  rollMode?: "advantage" | "disadvantage" | "normal" | null;
  /** GM override of a rules-mode rejection; audited in the log and journal (ADR-0020). */
  override?: RulesOverride | null;
  /** The action came from the builtin catalog (not the stat block); enables the builtin special cases. */
  builtin?: boolean;
  /** Free-text annotation (the Ready action's trigger); folded into the granted effect's name. */
  note?: string | null;
  /** The escapable effect to break (Escape a Grapple); defaults to the actor's first effect with an escape DC. */
  effectId?: string | null;
  /** GM-adjudicated cover for the target (SRD Cover): half +2 / three-quarters +5 to AC and Dex saves; total blocks targeting. */
  cover?: "half" | "three-quarters" | "total" | null;
  /** false previews the attack roll only (no damage, riders, prompts or economy); the client confirms with `attackNatural`. */
  commit?: boolean;
  /** A confirmed or hand-rolled natural d20, used instead of rolling (preview confirm, manual dice). */
  attackNatural?: number;
  /** A hand-entered attack total, used verbatim vs AC. The natural die is unknown, so a crit is declared
   * via `critical` and there is no fumble. */
  attackTotal?: number;
  /** Explicit "this was a natural 20" (critical hit) for the hand-entered-total path. Ignored when a natural is supplied. */
  critical?: boolean;
  /** How this attack is made, for `attack-kind-is` riders. Melee/ranged/thrown are derived; opportunity and
   *  reaction can't be, so `reactions.ts` announces them here. */
  attackKinds?: readonly AttackKind[];
  /** Push mastery's chosen distance (0 declines); absent pushes the most the mastery allows. */
  pushFeet?: number;
}>;

export type ResolveDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  /** Who initiated this resolve; a player's resolve attributes recorded rolls to that player. Defaults to GM. */
  initiatorRole?: "gm" | "player";
  initiatorSessionId?: string;
  now: () => string;
  /** The attacker's full definition; multiattack composition and limited-use lookups need sibling actions. */
  definition?: ActorDefinition;
  /** Map distance in feet between two combatants' tokens; null when unmeasurable. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Resolves any combatant's definition (imported over bundled), to offer the target's declared reactions. */
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog where magic-item riders live; absent means every item is mundane. GM audience. */
  catalog?: EquipmentCatalog;
  /** SRD forced movement (Push): moves a combatant straight away from another and reports the distance, or
   *  null. Built by the operation layer, which has the grid (an opportunity attack's too). */
  pushToken?: (
    input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number }>
  ) => Readonly<{ value: number; unit: string }> | null;
}>;

type RollBase = Pick<
  RollRecord,
  | "commandId"
  | "initiatorSessionId"
  | "initiatorRole"
  | "initiatorLabel"
  | "label"
  | "actorId"
  | "visibility"
  | "createdAt"
>;

/** One resolve's inputs and everything its steps have decided so far. Each step reads what the earlier
 *  steps wrote and adds its own part; the result is read off the finished context. */
export type ResolveContext = {
  readonly state: GameState;
  /** The action as resolved; a builtin may rewrite it before anything rolls (Unarmed Strike). */
  action: DefinitionAction;
  readonly input: ResolveInput;
  readonly deps: ResolveDependencies;
  readonly attacker: LiveActor;
  readonly targets: readonly LiveActor[];
  /** The builtin's special cases; only for an action taken from the builtin catalog. */
  readonly builtin: BuiltinHandler | undefined;
  /** The attacker's equipment contribution. */
  readonly derivation: EquipmentDerivation;
  /** The effective action list, so pool limits and multiattack composition see item-derived actions. */
  readonly siblings: ReadonlyArray<DefinitionAction>;
  readonly riderItemId: string | null;
  readonly plan: EconomyPlan;
  overridden: { rule: RuleId; reason: string } | null;
  /** GM-adjudicated cover's bonus to AC and Dexterity saves (SRD Cover). */
  readonly coverBonus: number;
  /** Shared fields of every roll this resolve records; set once the action is final. */
  rollBase: RollBase;
  /** GM-only rules notes. */
  readonly warnings: string[];
  /** Narration for the whole table, for riders that changed the board; `warnings` is the GM-only channel.
   *  A sentence goes in exactly one of the two. */
  readonly tableNarration: ActionTableNarration[];
  rollMode: ActionRollMode | undefined;
  check: NonNullable<ActionResolution["check"]> | null;
  attack: ActionResolutionAttack | null;
  crit: boolean;
  /** The roll-specific facts riders filter on (attack kind, target size, damage types...). */
  riderFilters: Omit<Partial<RiderContext>, "moment">;
  readonly damage: Array<{ formula: string; type: string; total: number }>;
  readonly bonusDamage: Array<{ amount: number; type: string; source: string }>;
  /** The weapon mastery in force on this swing; null unless a mastery applies to an attack that rolled. */
  masterySwing: MasterySwing | null;
  readonly effectsApplied: Array<{
    targetId: string;
    targetName: string;
    name: string;
    conditionIds: readonly string[];
  }>;
  effectGranted: ActionResolution["effectGranted"];
  readonly effectsEnded: Array<{ actorId: string; actorName: string; name: string }>;
  readonly reactionPrompts: Array<{ actorId: string; actorName: string; actionName: string }>;
  /** A save a builtin forced (grapple, shove); an action's own `save` is reported from the action. */
  builtinSave: ActionResolution["save"];
  healing: ActionResolution["healing"];
};

/** Records one rolled formula in the shared history, attributed like every roll of this resolve. */
export function recordRoll(ctx: ResolveContext, resolution: DiceResolution, purpose: RollRecord["purpose"]): void {
  const record: RollRecord = {
    ...ctx.rollBase,
    id: ctx.deps.newRollId(),
    purpose,
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    ...rolledTerms(resolution),
    total: resolution.total
  };
  recordRollInHistory(ctx.state, record);
}

/** The natural face of a d20 test: the kept die under advantage or disadvantage. */
export function naturalFace(resolution: DiceResolution): number {
  const dice = resolution.terms.find((term) => term.kind === "dice")!;
  return (dice.dice.find((die) => die.kept) ?? dice.dice[0]).face;
}

type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** Ability modifier from the definition's scores; +0 when no definition is known (builtin fallback). */
export function abilityModifier(definition: ActorDefinition | undefined, ability: AbilityKey): number {
  return scoreModifier(definition?.abilityScores[ability] ?? 10);
}

const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;

/** A creature size's rank, smallest first; an unknown size counts as Medium. */
export function sizeRank(size: string | undefined): number {
  return SIZE_ORDER.indexOf((size ?? "medium") as (typeof SIZE_ORDER)[number]);
}

export function sizeAtMost(size: string | undefined, limit: string): boolean {
  return sizeRank(size) <= sizeRank(limit);
}

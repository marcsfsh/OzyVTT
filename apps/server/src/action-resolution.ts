import type { ActionResolution, GameState, RollRecord } from "@vtt/domain";
import { abilityModifier as scoreModifier, aggregateRollMode, collectRiders, parseDiceFormula, resolveDice, sumRiders, type AttackKind, type DiceExpression, type RandomSource, type RiderContext, type RiderMoment, type RollModeSource } from "@vtt/rules-5e";
import { toRollModes, type ActorDefinition } from "@vtt/schemas";
import { checkDieFor, checkRollMode } from "./ability-checks.js";
import { criticalThreshold, effectiveActions } from "./effective-actions.js";
import { deriveEquipment, sourceItemOf, weaponPropertiesOf, EMPTY_DERIVATION, UNARMED_STRIKE_ACTION_ID, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { effectiveModeFor, familyModeFor, overrideCovers, overrideReason, rememberOverride } from "./rules-families.js";
import { recordRoll as recordRollInHistory } from "./roll-history.js";
import { addEffect, endEffect, hasEffectTag } from "./effects.js";
import { conditionFrom, createPendingSaves, halfOnSuccessFrom, saveModifierFor } from "./saving-throws.js";
import { conditionLabel, exhaustionLevel, exhaustionPenalty, INCAPACITATING_CONDITIONS, isIncapacitated } from "./condition-rules.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { masteryHitEffects, masteryHitPushes, masteryHitSaves, masteryMissDamage, type MasterySwing } from "./weapon-mastery.js";

type DefinitionAction = ActorDefinition["actions"][number];
type LiveActor = GameState["actors"][number];
export type ResolveInput = Readonly<{
  actorId: string;
  targetIds: readonly string[];
  commandId: string;
  conditionId?: string | null;
  /** Explicit GM roll-mode choice; wins over the aggregated advantage/disadvantage sources. */
  rollMode?: "advantage" | "disadvantage" | "normal" | null;
  /** GM override of a rules-mode rejection; audited in the log and journal (ADR-0020). */
  override?: Readonly<{ reason?: string }> | null;
  /** The action came from the builtin catalog (not the stat block) - enables the builtin special cases. */
  builtin?: boolean;
  /** Free-text annotation (the Ready action's trigger); folded into the granted effect's name. */
  note?: string | null;
  /** The escapable effect to break (Escape a Grapple); defaults to the actor's first effect with an escape DC. */
  effectId?: string | null;
  /** GM-adjudicated cover for the target (SRD Cover): half +2 / three-quarters +5 to AC and Dex saves; total blocks targeting. */
  cover?: "half" | "three-quarters" | "total" | null;
  /** false previews the attack roll only (no damage/riders/prompts/economy); the client then confirms with `attackNatural`. Ignored by non-attack actions. */
  commit?: boolean;
  /** A confirmed or hand-rolled natural d20 for the attack - used instead of rolling (the preview→confirm reuse, and the manual path). */
  attackNatural?: number;
  /** The final attack TOTAL, hand-entered ("final total" manual mode) - used verbatim vs AC. When set, the natural
   * die can't be inferred, so a crit is DECLARED via `critical` rather than read off a nat 20 (and no fumble). */
  attackTotal?: number;
  /** Explicit "this was a natural 20" (critical hit) for the hand-entered-total path. Ignored when a natural is supplied. */
  critical?: boolean;
  /**
   * HOW this attack is being made, so a rider gated on `attack-kind-is` can match. Absent means an
   * ordinary on-turn attack; melee/ranged/thrown are still derived from the action's reach and range.
   *
   * This is the transport criterion 7 dies without. Nothing else in the resolve can tell an
   * opportunity attack from a turn attack: the chosen action is an ordinary melee attack with
   * `activation: "action"`, and the only indirect signal (`turnActorId !== attacker.id`) also covers
   * legendary actions, readied releases and GM improvisation. `reactions.ts` is the ONLY producer of
   * an opportunity attack in the codebase and it announces itself here.
   */
  attackKinds?: readonly AttackKind[];
}>;
export type ResolveDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  /** Who initiated this resolve: a player resolving their own claimed character's action attributes the
   * recorded rolls to that player (defaults to the GM for GM/integration-driven resolves). */
  initiatorRole?: "gm" | "player";
  initiatorSessionId?: string;
  now: () => string;
  hasCondition?: (id: string) => boolean;
  /** The attacker's full definition - multiattack composition and limited-use lookups need sibling actions. */
  definition?: ActorDefinition;
  /** Authoritative map distance in feet between two combatants' tokens; null when unmeasurable (no positions / no calibration). */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Resolves ANY combatant's definition (imported over bundled) - needed to offer the TARGET's declared reactions. */
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  /**
   * The item catalog, where magic-item riders live (never on the inventory row - see
   * `equipment-derivation.ts`). Absent = every item is mundane, the documented fail-open.
   * Resolve it for the GM audience: a player must still be able to roll their own cursed item.
   */
  catalog?: EquipmentCatalog;
  /**
   * SRD FORCED MOVEMENT (the Push mastery): move a combatant straight away from another one and
   * report how far it really went, or null when the map cannot express the distance.
   *
   * This file has no geometry and must not gain any - the map's one snapping implementation lives in
   * `token-placement.ts` (`docs/ai-context/map-grid.md`) and the operation layer has already fetched
   * the grid for its distance rules, so the callback is built THERE (`game-operations.ts`) and
   * `forced-movement.ts` does the arithmetic. It takes no direction and no destination: both are the
   * server's to derive, which is why nothing about a push crosses the wire.
   *
   * Optional, and its absence is honest rather than silent: `reactions.ts` resolves opportunity
   * attacks without geometry, so a pike that hits on a reaction narrates "move the token" instead of
   * moving it - and `reactionAnswer` drains these warnings into the GM's feed exactly as
   * `actionResolve` does, or the sentence would be a silent skip wearing a named absence's clothes.
   * Wiring the push itself needs the reaction operation to fetch the map first.
   */
  pushToken?: (input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number }>) => Readonly<{ value: number; unit: string }> | null;
}>;

/**
 * 2024 crit rule: double every dice term (modifiers once); `extraFirstTermDice` adds bonus weapon
 * dice to the first term (Savage Attacks) on top of the doubling.
 */
function criticalExpression(expression: DiceExpression, extraFirstTermDice = 0): DiceExpression {
  let firstDice = true;
  const terms = expression.terms.map((term) => {
    if (term.kind !== "dice") return term;
    const extra = firstDice ? extraFirstTermDice : 0;
    firstDice = false;
    return { ...term, count: term.count * 2 + extra };
  });
  const source = terms
    .map((term, index) => {
      const sign = term.sign === -1 ? "- " : index === 0 ? "" : "+ ";
      return `${sign}${term.kind === "dice" ? `${term.count}d${term.sides}` : term.value}`;
    })
    .join(" ");
  return { source, normalized: source.replace(/\s+/g, "").toLowerCase(), terms };
}

function recordRoll(state: GameState, resolution: ReturnType<typeof resolveDice>, base: Pick<RollRecord, "id" | "commandId" | "initiatorSessionId" | "initiatorRole" | "initiatorLabel" | "label" | "actorId" | "purpose" | "visibility" | "createdAt">) {
  let group = 0;
  const record: RollRecord = {
    ...base,
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    dice: resolution.terms.flatMap((term) => {
      if (term.kind !== "dice") return [];
      const currentGroup = group++;
      return term.dice.map((die) => ({ group: currentGroup, sides: term.sides, face: die.face, kept: die.kept, sign: term.sign }));
    }),
    modifiers: resolution.terms.filter((term): term is Extract<typeof term, { kind: "modifier" }> => term.kind === "modifier").map((term) => ({ value: term.value, sign: term.sign })),
    total: resolution.total
  };
  recordRollInHistory(state, record);
}

const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
function sizeAtMost(size: string | undefined, limit: string): boolean {
  return SIZE_ORDER.indexOf((size ?? "medium") as (typeof SIZE_ORDER)[number]) <= SIZE_ORDER.indexOf(limit as (typeof SIZE_ORDER)[number]);
}

type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";
/** Ability modifier from the definition's scores; +0 when no definition is known (documented builtin fallback). */
export function abilityModifier(definition: ActorDefinition | undefined, ability: AbilityKey): number {
  return scoreModifier(definition?.abilityScores[ability] ?? 10);
}

/** Skill bonus from the untyped open5e extension when the import carries one (mirrors saveModifierFor). */
function skillBonusFromExtension(definition: ActorDefinition | undefined, skill: string): number | null {
  const extension = definition?.extensions["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const bonus = (extension as { skills?: Record<string, unknown> }).skills?.[skill];
    if (typeof bonus === "number" && Number.isInteger(bonus) && bonus >= -20 && bonus <= 30) return bonus;
  }
  return null;
}

/** The builtin actions resolved as a plain check roll (SRD glossary [Action] entries). Hide is the only one with a fixed DC. */
const BUILTIN_CHECKS: Record<string, { label: string; ability: AbilityKey; skill?: string; dc: number | null }> = {
  hide: { label: "Dexterity (Stealth)", ability: "dex", skill: "stealth", dc: 15 },
  influence: { label: "Charisma (Influence)", ability: "cha", dc: null },
  search: { label: "Wisdom (Search)", ability: "wis", dc: null },
  study: { label: "Intelligence (Study)", ability: "int", dc: null }
};

type RuleViolation = Readonly<{ rule: string; message: string }>;
/** How this resolve settles the action economy once it succeeds. */
type EconomyPlan = Readonly<{
  markAction: boolean;
  markBonus: boolean;
  markReaction: boolean;
  /** The compound-action components remaining AFTER this resolve (null clears/leaves no instance). */
  instance: Readonly<{ actorId: string; components: Record<string, number> }> | null;
  /** Limited-use spend to record, keyed per scope. */
  spendUse: Readonly<{ key: string; per: "turn" | "encounter" | "long-rest" | "short-rest" | "recharge" }> | null;
  /** Legendary-action cost to add to the attacker's per-round pool (SRD Legendary Actions). */
  spendLegendary: Readonly<{ cost: number }> | null;
  /** Spell slot the action spends from the bearer's own pool (an item cast with `consumesSpellSlot`). */
  spendSpellSlot: Readonly<{ level: number }> | null;
}>;

/**
 * How many uses the counter this action spends from actually holds. An action that declares
 * `uses.pool` shares ONE counter with its siblings - a Cleric's Channel Divinity feeds Divine Spark,
 * Turn Undead AND Preserve Life - so its gate is the POOL's size: the largest limit any action
 * declaring that same pool (and rest scope) carries. Reading the shared counter but gating on the
 * action's own printed number told a Cleric 3 that Preserve Life ("1") had no uses left after a
 * single Divine Spark, even though two Channel Divinity charges were authored. An action with no
 * pool is its own pool and keeps its own limit, unchanged.
 *
 * Takes the SIBLING ACTION LIST rather than the definition, because the siblings that matter are the
 * EFFECTIVE ones: an item that raises a pool's limit does it by riding `uses.limit` on the derived
 * action, and reading `definition.actions` here would cap a pooled resource at the base number.
 */
export function useLimitFor(siblings: ReadonlyArray<DefinitionAction>, action: DefinitionAction): number {
  const uses = action.uses;
  if (!uses) return 0;
  if (!uses.pool) return uses.limit;
  return siblings.reduce((limit, candidate) => {
    const sibling = candidate.uses;
    return sibling && sibling.pool === uses.pool && sibling.per === uses.per ? Math.max(limit, sibling.limit) : limit;
  }, uses.limit);
}

/** The multiattack parents (sibling actions) that list `action` as a component. */
function multiattackParents(siblings: ReadonlyArray<DefinitionAction>, action: DefinitionAction): DefinitionAction[] {
  return siblings.filter((candidate) => candidate.multiattack?.some((component) => component.actionId === action.id) ?? false);
}

function componentMap(parent: DefinitionAction): Record<string, number> {
  const components: Record<string, number> = {};
  for (const entry of parent.multiattack ?? []) components[entry.actionId] = (components[entry.actionId] ?? 0) + entry.count;
  return components;
}

type EconomyEvaluation = Readonly<{
  violations: readonly RuleViolation[];
  softViolations: readonly RuleViolation[];
  plan: EconomyPlan;
  proseMultiattack: boolean;
  /** Informational notes that surface as warnings regardless of mode (ambiguous multiattack membership). */
  notes: readonly string[];
}>;

/**
 * Pure rules evaluation for one action: every violated rule (never throws) plus the economy plan a
 * successful resolve would commit. Shared by the resolve path (which applies the rules mode) and the
 * read-only availability projection, so what the API reports as blocked and what resolution rejects
 * can never drift. Economy/instance gating applies only on the attacker's own turn - off-turn
 * resolves (opportunity attacks, GM improvisation) stay ungated.
 */
export function evaluateActionEconomy(state: GameState, attacker: LiveActor, action: DefinitionAction, targetIds: readonly string[], definition: ActorDefinition | undefined, distanceFeet?: (actorIdA: string, actorIdB: string) => number | null, siblings: ReadonlyArray<DefinitionAction> = definition?.actions ?? []): EconomyEvaluation {
  const violations: RuleViolation[] = [];
  const softViolations: RuleViolation[] = [];
  const notes: string[] = [];
  const onOwnTurn = state.combat.turnActorId === attacker.id;
  const turn = state.combat.turn;
  // An actor whose stat block has a prose-only Multiattack can't be validated fairly: its extra
  // attacks live in text the engine can't see, so action-slot violations degrade to warnings.
  const proseMultiattack = siblings.some((candidate) => /multiattack/i.test(candidate.name) && !candidate.multiattack);

  // Incapacitation forbids all three activation kinds outright (SRD 2024 "Incapacitated").
  if (action.activation !== "other") {
    const incapacitating = attacker.conditions.find((condition) => (INCAPACITATING_CONDITIONS as readonly string[]).includes(condition.id));
    if (incapacitating) violations.push({ rule: "condition.incapacitated", message: `${attacker.name} is ${conditionLabel(incapacitating.id)} and can't take actions, bonus actions, or reactions.` });
    // A creature at 0 HP is down (a dying PC or a defeated monster) and can't act. Keyed on hp, not a
    // condition, so a defeated monster - which carries no incapacitating condition - is blocked too.
    else if (attacker.hp.current <= 0) violations.push({ rule: "condition.down", message: `${attacker.name} is down (0 HP) and can't take actions, bonus actions, or reactions.` });
  }

  if (action.requiresEffectTag && !hasEffectTag(attacker, action.requiresEffectTag)) {
    violations.push({ rule: "feature.requires-effect", message: `${action.name} requires an active ${conditionLabel(action.requiresEffectTag)} effect.` });
  }

  let spendUse: EconomyPlan["spendUse"] = null;
  if (action.uses) {
    const key = action.uses.pool ?? action.id;
    // The counter is keyed on the POOL, so the gate must be the pool's size too (see `useLimitFor`).
    const limit = useLimitFor(siblings, action);
    const spent = action.uses.per === "turn" ? (turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
    if (spent >= limit) {
      const scopeLabel = action.uses.per === "turn" ? "turn"
        : action.uses.per === "encounter" ? "encounter"
        : action.uses.per === "short-rest" ? "short rest"
        : action.uses.per === "recharge" ? `spent - recharges on ${action.uses.recharge}+ at the start of its turn`
        : "long rest";
      violations.push({ rule: "feature.no-uses-remaining", message: `${action.name}: no uses remaining (${action.uses.per === "recharge" ? scopeLabel : `${limit}/${scopeLabel}`}).` });
    }
    spendUse = { key, per: action.uses.per };
  }

  let markAction = false;
  let markBonus = false;
  let markReaction = false;
  let instance: EconomyPlan["instance"] = state.combat.turn.actionInstance;
  if (onOwnTurn && action.activation === "bonus-action") {
    if (turn.bonusActionUsed) violations.push({ rule: "economy.bonus-action-used", message: `${attacker.name} has already used a bonus action this turn.` });
    markBonus = true;
  } else if (onOwnTurn && action.activation === "action") {
    const active = instance && instance.actorId === attacker.id ? instance : null;
    if (!turn.actionUsed) {
      // Fresh action slot: open a compound instance when the action (or its multiattack parent) declares one.
      const parents = multiattackParents(siblings, action);
      let components: Record<string, number> | null = null;
      if (action.multiattack) {
        components = componentMap(action); // resolving the parent itself opens the full plan, no rolls consumed
      } else if (parents.length === 1) {
        components = componentMap(parents[0]);
        components[action.id] = (components[action.id] ?? 1) - 1;
      } else if (parents.length > 1) {
        if (action.attack && (action.attack.count ?? 1) > 1) components = { attack: (action.attack.count ?? 1) - 1 };
        notes.push(`${action.name} belongs to more than one Multiattack - tracking it standalone.`);
      } else if (action.attack && (action.attack.count ?? 1) > 1) {
        // Count-based attacks open a generic pool so Extra Attack can mix weapons legally.
        components = { attack: (action.attack.count ?? 1) - 1 };
      }
      markAction = true;
      // The instance stays in state even once exhausted (zeroed components) so a further resolve
      // gets the specific "no attacks remaining" rejection, not a generic "action already used".
      instance = components ? { actorId: attacker.id, components } : null;
    } else if (active) {
      const components = { ...active.components };
      const componentName = (id: string) => id === "attack" ? "attack" : siblings.find((candidate) => candidate.id === id)?.name ?? id;
      const leftovers = () => Object.entries(components).filter(([, count]) => count > 0).map(([id, count]) => `${count}× ${componentName(id)}`);
      if (action.multiattack) {
        // Tapping the Multiattack plan mid-instance is a continue, not a violation - a fresh
        // component resolve already opened the plan, so the GM never has to select it first.
        if (leftovers().length === 0) (proseMultiattack ? softViolations : violations).push({ rule: "economy.action-used", message: `${attacker.name} has no attacks remaining in this action.` });
      } else if ((components[action.id] ?? 0) > 0) {
        components[action.id] -= 1;
      } else if (action.attack && (components["attack"] ?? 0) > 0) {
        components["attack"] -= 1;
      } else {
        const named = leftovers();
        (proseMultiattack ? softViolations : violations).push({ rule: "economy.action-used", message: named.length > 0
          ? `${attacker.name} has no ${action.name} left in this action - remaining: ${named.join(", ")}.`
          : `${attacker.name} has no attacks remaining in this action.` });
      }
      instance = { actorId: attacker.id, components };
    } else {
      (proseMultiattack ? softViolations : violations).push({ rule: "economy.action-used", message: `${attacker.name} has already used an action this turn.` });
    }
  } else if (action.activation === "reaction") {
    if (state.combat.reactionsUsed.includes(attacker.id)) violations.push({ rule: "economy.reaction-used", message: `${attacker.name} has already used a reaction this round.` });
    markReaction = true;
  }

  // SRD Legendary Actions: taken at the end of OTHER creatures' turns, spending from the per-round
  // pool that refills when the legendary creature's own turn starts. Pool size comes from the
  // definition (every SRD legendary creature prints 3; imports without one default to 3).
  let spendLegendary: EconomyPlan["spendLegendary"] = null;
  if (action.legendary) {
    const cost = action.legendary.cost;
    const perRound = definition?.legendary?.actionsPerRound ?? 3;
    const spent = state.combat.legendaryUsed[attacker.id] ?? 0;
    if (onOwnTurn) violations.push({ rule: "legendary.own-turn", message: `Legendary actions are taken on other creatures' turns - not on ${attacker.name}'s own.` });
    if (spent + cost > perRound) violations.push({ rule: "legendary.no-actions-remaining", message: `${attacker.name} has ${Math.max(0, perRound - spent)} of ${perRound} legendary action${perRound === 1 ? "" : "s"} left this round${cost > 1 ? ` and ${action.name} costs ${cost}` : ""}.` });
    spendLegendary = { cost };
  }

  // An item cast authored with `consumesSpellSlot` spends the WEARER's own slot on top of the
  // item's charges (SRD staffs and the "expend a spell slot" wording). A creature with no pool at
  // that level is refused here rather than mid-resolution, in the same voice as an empty charge.
  let spendSpellSlot: EconomyPlan["spendSpellSlot"] = null;
  if (action.spellSlot) {
    const level = action.spellSlot.level;
    const slot = attacker.spellSlots?.find((entry) => entry.level === level);
    if (!slot || slot.remaining <= 0) {
      violations.push({ rule: "feature.no-spell-slot", message: `${action.name} spends a level-${level} spell slot - ${attacker.name} has none left.` });
    }
    spendSpellSlot = { level };
  }

  // Targeting restrictions the definition declares (Tail can't target the creature this crocodile grapples).
  if (action.targetRules?.includes("not-grappled-by-source")) {
    for (const targetId of targetIds) {
      const target = state.actors.find((candidate) => candidate.id === targetId);
      if (target?.effects.some((effect) => effect.sourceActorId === attacker.id && effect.tags.includes("grapple"))) {
        violations.push({ rule: "target.grappled-by-source", message: `${target.name} is grappled by ${attacker.name} and can't be targeted by ${action.name}.` });
      }
    }
  }

  // Range/reach (SRD Making an Attack / Range): checked only when the distance is measurable -
  // unplaced tokens or an uncalibrated map skip entirely (the unmeasurable pattern). A weapon with
  // both reach and range (thrown) is legal in either envelope; long-range disadvantage lives in
  // attackRollSources, not here.
  if (action.attack !== undefined && distanceFeet !== undefined) {
    const attackReach = action.attack.reachFeet;
    const attackRange = action.attack.rangeFeet;
    for (const targetId of targetIds) {
      const distance = distanceFeet(attacker.id, targetId);
      if (distance === null) continue;
      const targetName = state.actors.find((candidate) => candidate.id === targetId)?.name ?? "The target";
      const withinReach = attackReach !== undefined && distance <= attackReach + DISTANCE_TOLERANCE_FEET;
      const rounded = Math.round(distance * 10) / 10;
      if (withinReach) continue;
      if (attackRange !== undefined) {
        if (distance > attackRange + DISTANCE_TOLERANCE_FEET) violations.push({ rule: "range.out-of-range", message: `${targetName} is ${rounded} ft away, beyond the ${attackRange} ft maximum range.` });
        // SRD Underwater Combat: a ranged attack automatically misses beyond normal range.
        else if (state.combat.underwater) {
          const normal = action.attack.rangeNormalFeet ?? attackRange;
          if (distance > normal + DISTANCE_TOLERANCE_FEET) violations.push({ rule: "range.underwater", message: `${targetName} is ${rounded} ft away; underwater, ranged attacks automatically miss beyond normal range (${normal} ft).` });
        }
      } else if (attackReach !== undefined || attackRange === undefined) {
        const reach = attackReach ?? 5;
        if (distance > reach + DISTANCE_TOLERANCE_FEET) violations.push({ rule: "range.out-of-reach", message: `${targetName} is ${rounded} ft away, beyond ${attacker.name}'s ${reach} ft reach.` });
      }
    }
  }

  // Unarmed grapple/shove only work on targets at most one size larger (SRD Unarmed Strike).
  if (action.id === "unarmed-grapple" || action.id === "unarmed-shove-prone" || action.id === "unarmed-shove-push") {
    const attackerIndex = SIZE_ORDER.indexOf((attacker.size ?? "medium") as (typeof SIZE_ORDER)[number]);
    for (const targetId of targetIds) {
      const target = state.actors.find((candidate) => candidate.id === targetId);
      if (target && SIZE_ORDER.indexOf((target.size ?? "medium") as (typeof SIZE_ORDER)[number]) > attackerIndex + 1) {
        violations.push({ rule: "target.too-large-to-grapple", message: `${target.name} is more than one size larger than ${attacker.name} and can't be grappled or shoved.` });
      }
    }
  }

  // SRD Charmed: the charmed creature can't attack or target its charmer with harmful effects.
  // Enforceable only when the condition rides a source-linked effect naming the charmer.
  if (action.attack !== undefined || action.save !== undefined || action.damage.length > 0) {
    const charmers = attacker.effects.filter((effect) => effect.linkedConditionIds.includes("charmed") && effect.sourceActorId !== null);
    for (const targetId of targetIds) {
      const charmer = charmers.find((effect) => effect.sourceActorId === targetId);
      if (charmer) {
        const target = state.actors.find((candidate) => candidate.id === targetId);
        violations.push({ rule: "condition.charmed-charmer", message: `${attacker.name} is Charmed by ${target?.name ?? charmer.sourceName ?? "its charmer"} and can't target them with harmful effects.` });
      }
    }
  }

  return { violations, softViolations, plan: { markAction, markBonus, markReaction, instance, spendUse, spendLegendary, spendSpellSlot }, proseMultiattack, notes };
}

/**
 * Read-only availability projection over an actor's whole action list (the `available-actions` API):
 * per action, whether strict mode would allow it right now, every violated rule, and the remaining
 * limited uses / open-instance rolls. Target-specific rules (`targetRules`) can't be pre-checked
 * without a target and are deliberately absent here. Never mutates state.
 */
export function actionAvailability(state: GameState, attacker: LiveActor, actions: ReadonlyArray<DefinitionAction>, definition: ActorDefinition | undefined, builtin = false, siblings: ReadonlyArray<DefinitionAction> = definition?.actions ?? []): ReadonlyArray<{
  id: string; name: string; activation: DefinitionAction["activation"]; available: boolean;
  violations: ReadonlyArray<{ rule: string; message: string }>; usesRemaining: number | null; componentsRemaining: number | null; builtin?: boolean;
}> {
  return actions.map((action) => {
    const evaluation = evaluateActionEconomy(state, attacker, action, [], definition, undefined, siblings);
    let usesRemaining: number | null = null;
    if (action.uses) {
      const key = action.uses.pool ?? action.id;
      const spent = action.uses.per === "turn" ? (state.combat.turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
      // Same pool arithmetic as the gate above, so what the API reports remaining and what resolution
      // allows can never drift (the whole point of sharing `evaluateActionEconomy`).
      usesRemaining = Math.max(0, useLimitFor(siblings, action) - spent);
    }
    const instance = state.combat.turn.actionInstance;
    let componentsRemaining: number | null = null;
    if (instance && instance.actorId === attacker.id && state.combat.turnActorId === attacker.id && action.activation === "action" && !action.multiattack) {
      if (instance.components[action.id] !== undefined) componentsRemaining = instance.components[action.id];
      else if (action.attack && instance.components["attack"] !== undefined) componentsRemaining = instance.components["attack"];
    }
    return {
      id: action.id,
      name: action.name,
      activation: action.activation,
      available: evaluation.violations.length === 0,
      violations: evaluation.violations,
      usesRemaining,
      componentsRemaining,
      ...(builtin ? { builtin: true } : {}),
      /**
       * DISPLAY VALUES, and only display values (ADR-0007 additive-optional, no schemaVersion bump).
       *
       * `actions` here is the actor's EFFECTIVE list - `effectiveActions(definition, actor, catalog)`
       * at every call site - so these numbers already carry the standing riders of whatever the actor
       * has equipped and attuned. That is the whole point: they exist so a client can RENDER an
       * item-derived action (an Amulet of Message's cast, a +1 sword's swing) it otherwise could not
       * see at all, because `definition.actions` does not contain it.
       *
       * They are NOT what gets rolled. Resolution takes the `id` and recomputes everything through
       * the same `effectiveActions` call (CLAUDE.md rule 2), so a preview built from these can never
       * disagree with the roll - they are two reads of one function, not two computations.
       */
      description: action.description,
      attackBonus: action.attack?.bonus ?? null,
      reachFeet: action.attack?.reachFeet ?? null,
      rangeFeet: action.attack?.rangeFeet ?? null,
      rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
      attackCount: action.attack?.count ?? null,
      saveAbility: action.save?.ability ?? null,
      saveDc: action.save?.dc ?? null,
      damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
      usesLimit: action.uses ? useLimitFor(siblings, action) : null,
      usesPer: action.uses?.per ?? null,
      usesPool: action.uses?.pool ?? null,
      requiresEffectTag: action.requiresEffectTag ?? null,
      multiattack: action.multiattack ? action.multiattack.map((component) => ({ actionId: component.actionId, count: component.count })) : null,
      reaction: action.reaction ?? null
    };
  });
}

/**
 * Validate the resolve against the encounter's rules mode and plan its economy commitment
 * (ADR-0020). Strict rejects the first violation with an override path; assisted converts
 * violations to warnings; freeform skips validation.
 */
function planEconomy(state: GameState, attacker: LiveActor, action: DefinitionAction, input: ResolveInput, definition: ActorDefinition | undefined, warnings: string[], distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined, siblings: ReadonlyArray<DefinitionAction>): { plan: EconomyPlan; overridden: { rule: string; reason: string } | null } {
  const { violations, softViolations, plan, proseMultiattack, notes } = evaluateActionEconomy(state, attacker, action, input.targetIds, definition, distanceFeet, siblings);
  warnings.push(...notes);

  let overridden: { rule: string; reason: string } | null = null;
  // The mode is per FAMILY now, not per table: "don't police movement" must not also switch off the
  // action economy. A violation whose family is Off is simply not a violation for this table.
  const policed = [...violations, ...softViolations].filter((violation) => effectiveModeFor(state.combat, violation.rule) !== "freeform");
  if (policed.length > 0) {
    if (input.override) {
      overridden = { rule: policed[0].rule, reason: overrideReason(input.override) };
    } else {
      // A GM override earlier this turn covers that FAMILY for the rest of the creature's turn, so the
      // next block of the same kind isn't re-prompted. Every other family still re-prompts, so it stays
      // an explicit, audited call each time.
      const covered = (rule: string) => overrideCovers(state.combat.turn, rule);
      const blocking = violations.filter((violation) => !covered(violation.rule) && effectiveModeFor(state.combat, violation.rule) === "strict");
      if (blocking.length > 0) {
        throw new RulesBlockedError(blocking[0].rule, blocking[0].message);
      } else {
        warnings.push(...policed.filter((violation) => !covered(violation.rule)).map((violation) => violation.message));
        if (proseMultiattack && softViolations.length > 0) warnings.push(`${attacker.name}'s Multiattack is prose-only - extra attacks aren't validated.`);
      }
    }
  }

  return { plan, overridden };
}

/** Both sides' derived equipment plus the roll-specific filter facts, assembled once per attack. */
type RiderMomentContext = Readonly<{
  attacker: EquipmentDerivation;
  target: EquipmentDerivation;
  filters: Omit<Partial<RiderContext>, "moment">;
}>;

/**
 * Whether THIS swing is being made at range. A weapon carrying only one of the two is settled by
 * that alone; a Thrown weapon carries BOTH and needs the measured distance, so one used inside its
 * reach stays melee.
 *
 * When the distance is unmeasurable - no map loaded, a combatant not yet placed, an uncalibrated
 * grid, all ordinary at this table - a both-ways weapon resolves to RANGED. That is the reading
 * that keeps a mapless table safe: defaulting to melee hands a thrown javelin every melee-gated
 * rider on the sheet, a Paladin's Radiant Strikes among them. It is also the classification every
 * such weapon had before the SRD `properties` column reached the inventory row and gave these
 * derived actions a reach at all.
 *
 * Three rules ask this question - the kind filter below, the underwater disadvantage, and the
 * ranged-attack penalties - and they answered it three slightly different ways, which is how the
 * underwater rule came to disagree with the kind filter about an unmeasured javelin. One helper so
 * they cannot drift again.
 */
function attackUsedAsRanged(attack: { reachFeet?: number; rangeFeet?: number }, distance: number | null): boolean {
  if (attack.rangeFeet === undefined) return false;
  if (attack.reachFeet === undefined) return true;
  return distance === null || distance > attack.reachFeet + 1e-6;
}

/**
 * How this attack is being made. `melee` / `ranged` / `thrown` are derivable from the action's own
 * reach and range (see `attackUsedAsRanged` for the distance rule); `reaction` and `opportunity`
 * are NOT derivable and must be announced by the caller through `input.attackKinds` - which is
 * exactly what `reactions.ts` does for an opportunity attack.
 */
function attackKindsOf(action: DefinitionAction, input: ResolveInput, distance: number | null): AttackKind[] {
  const kinds = new Set<AttackKind>(input.attackKinds ?? []);
  const attack = action.attack;
  if (attack) {
    const melee = attack.reachFeet !== undefined;
    const ranged = attack.rangeFeet !== undefined;
    if (attackUsedAsRanged(attack, distance)) kinds.add("ranged");
    else if (melee) kinds.add("melee");
    if (melee && ranged) kinds.add("thrown");
  }
  // An action whose id IS the unarmed strike is an unarmed strike whether it came from the builtin
  // catalog or from the sheet. Gating this on `input.builtin` meant a Monk's own Martial Arts strike
  // - which SHADOWS the builtin by carrying its id - missed every `attack-kind-is: ["unarmed"]`
  // rider (the Paladin's Divine Smite among them) that the generic strike matched.
  if (action.id === UNARMED_STRIKE_ACTION_ID) kinds.add("unarmed");
  if (action.activation === "reaction") kinds.add("reaction");
  return [...kinds];
}

/** Advantage/disadvantage sources the engine can see; the explicit GM rollMode choice wins over all of them. */
function attackRollSources(state: GameState, attacker: LiveActor, target: LiveActor, action: DefinitionAction, deps: ResolveDependencies, moment: RiderMomentContext): { advantage: RollModeSource[]; disadvantage: RollModeSource[] } {
  const advantage: RollModeSource[] = [];
  const disadvantage: RollModeSource[] = [];
  const has = (actor: LiveActor, id: string) => actor.conditions.some((condition) => condition.id === id);
  const onOwnTurn = state.combat.turnActorId === attacker.id;

  // Effect modifiers, normalised through `toRollModes` so this reads ONE claim shape rather than
  // branching on eight variants. The `onOwnTurn` gate belongs to the LEGACY `attack-advantage`
  // variant ALONE - it is Reckless Attack semantics, not a general rule - so it is tested on the
  // variant, not on the normalised claim. The general `roll-mode` variant carries its own `when`.
  const activeEffects = (actor: LiveActor) => actor.effects.filter((effect) => !(effect.voidWhileIncapacitated && isIncapacitated(actor)));
  for (const effect of activeEffects(attacker)) {
    for (const modifier of effect.modifiers) {
      if (modifier.type === "attack-advantage" && !onOwnTurn) continue;
      for (const claim of toRollModes(modifier)) {
        if (claim.roll !== "attack") continue;
        (claim.mode === "advantage" ? advantage : disadvantage).push({ source: effect.id, label: effect.name });
      }
    }
  }
  for (const effect of activeEffects(target)) {
    for (const modifier of effect.modifiers) {
      for (const claim of toRollModes(modifier)) {
        if (claim.roll !== "incoming-attack") continue;
        (claim.mode === "advantage" ? advantage : disadvantage).push({ source: effect.id, label: `Target: ${effect.name}` });
      }
    }
  }

  // ITEM (and item-granted feat) riders, at the `on-attack-roll` moment.
  //
  // These are pushed OUTSIDE the `onOwnTurn` branch above, and that is load-bearing, not tidiness
  // waiting to happen. An opportunity attack happens off-turn BY DEFINITION, so a rider routed
  // through the legacy branch would be silently dropped - the dagger would be authored, displayed,
  // and inert, and would review as working. `onOwnTurn` is Reckless Attack semantics for the legacy
  // `attack-advantage` effect variant and belongs to that variant alone. Riders are gated by their
  // own `when`. DO NOT merge these loops.
  //
  // BOTH passes are collected. A rider with NO `when` is STANDING ("this cursed blade always rolls at
  // disadvantage") and would be invisible to a moment-only collection; `on-attack-roll` plus a filter
  // is the momentary form. The two are disjoint by construction, so nothing is counted twice.
  for (const pass of [null, "on-attack-roll"] as const) {
    for (const rider of collectRiders(moment.attacker.carriers, { ...moment.attacker.context, ...moment.filters, moment: pass })) {
      if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "attack" || rider.modifier.mode === undefined) continue;
      (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({ source: `item:${rider.sourceItemId ?? rider.label}`, label: rider.label });
    }
    // The TARGET's own gear (a Cloak of Displacement) claims `incoming-attack` against this attack.
    for (const rider of collectRiders(moment.target.carriers, { ...moment.target.context, moment: pass })) {
      if (rider.modifier.type !== "roll-mode" || rider.modifier.roll !== "incoming-attack" || rider.modifier.mode === undefined) continue;
      (rider.modifier.mode === "advantage" ? advantage : disadvantage).push({ source: `item:${rider.sourceItemId ?? rider.label}`, label: `Target: ${rider.label}` });
    }
  }

  if (has(attacker, "prone")) disadvantage.push({ source: "attacker-prone", label: "Attacker is Prone" });
  if (has(attacker, "restrained")) disadvantage.push({ source: "attacker-restrained", label: "Attacker is Restrained" });
  if (has(attacker, "poisoned")) disadvantage.push({ source: "attacker-poisoned", label: "Attacker is Poisoned" });
  if (has(attacker, "blinded")) disadvantage.push({ source: "attacker-blinded", label: "Attacker is Blinded" });
  // Frightened: SRD scopes the disadvantage to "while the source is in line of sight" - with no
  // vision system the engine applies it whenever the condition is active (documented simplification;
  // the GM's explicit rollMode wins when the source is out of sight).
  if (has(attacker, "frightened")) disadvantage.push({ source: "attacker-frightened", label: "Attacker is Frightened" });
  // Invisible as a condition (Hide grants it as a linked effect): unseen attackers get advantage,
  // attacks against the unseen get disadvantage. Seen-through (e.g. blindsight) is GM adjudication.
  if (has(attacker, "invisible")) advantage.push({ source: "attacker-invisible", label: "Attacker is Invisible" });
  if (has(target, "invisible")) disadvantage.push({ source: "target-invisible", label: "Target is Invisible" });
  // Grappled: disadvantage on attacks against anyone but the grappler. The grappler is known when
  // the condition rides a source-linked effect; a hand-set Grappled falls back to disadvantage
  // against everyone (conservative - the GM's rollMode overrides for the grappler).
  if (has(attacker, "grappled")) {
    const grapplerId = attacker.effects.find((effect) => effect.linkedConditionIds.includes("grappled"))?.sourceActorId ?? null;
    if (grapplerId === null) disadvantage.push({ source: "attacker-grappled", label: "Attacker is Grappled (grappler unknown)" });
    else if (target.id !== grapplerId) disadvantage.push({ source: "attacker-grappled", label: "Attacker is Grappled (target isn't the grappler)" });
  }
  if (has(target, "restrained")) advantage.push({ source: "target-restrained", label: "Target is Restrained" });
  if (has(target, "blinded")) advantage.push({ source: "target-blinded", label: "Target is Blinded" });
  if (has(target, "stunned")) advantage.push({ source: "target-stunned", label: "Target is Stunned" });
  if (has(target, "paralyzed")) advantage.push({ source: "target-paralyzed", label: "Target is Paralyzed" });
  if (has(target, "petrified")) advantage.push({ source: "target-petrified", label: "Target is Petrified" });
  if (has(target, "unconscious")) advantage.push({ source: "target-unconscious", label: "Target is Unconscious" });
  if (has(target, "prone")) {
    // 2024 rule: the incoming modifier is distance-based for every attack - advantage within 5 feet,
    // disadvantage beyond. Unknown distance (unplaced tokens, uncalibrated map) contributes nothing.
    const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
    if (distance !== null && distance <= 5) advantage.push({ source: "target-prone", label: "Target is Prone (within 5 ft)" });
    else if (distance !== null) disadvantage.push({ source: "target-prone", label: "Target is Prone (beyond 5 ft)" });
  }

  // SRD Underwater Combat: melee attacks take Disadvantage unless the weapon deals piercing damage
  // (the SRD's dagger/javelin/shortsword/spear/trident list, generalized to its shared damage type).
  if (state.combat.underwater && action.attack?.reachFeet !== undefined) {
    const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
    const usedAsRanged = attackUsedAsRanged(action.attack, distance);
    const piercing = action.damage.some((part) => part.type === "piercing");
    if (!usedAsRanged && !piercing) disadvantage.push({ source: "underwater-melee", label: "Underwater (non-piercing melee)" });
  }

  // Ranged-attack penalties (SRD Range / Ranged Attacks in Close Combat), only when this shot is
  // actually ranged (a thrown weapon used within its reach stays melee) and distance is measurable.
  if (action.attack?.rangeFeet !== undefined && deps.distanceFeet) {
    const distance = deps.distanceFeet(attacker.id, target.id);
    const usingMelee = !attackUsedAsRanged(action.attack, distance);
    if (!usingMelee) {
      const normal = action.attack.rangeNormalFeet;
      if (normal !== undefined && distance !== null && distance > normal + 1e-6) {
        disadvantage.push({ source: "long-range", label: `Long range (beyond ${normal} ft)` });
      }
      // An able enemy within 5 feet spoils the shot; "who can see you" stays GM adjudication.
      const enemyKind = attacker.kind === "player-character" ? "monster" : attacker.kind === "monster" ? "player-character" : null;
      if (enemyKind) {
        for (const entry of state.combat.initiative) {
          if (entry.actorId === attacker.id) continue;
          const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
          if (!enemy || enemy.kind !== enemyKind || isIncapacitated(enemy)) continue;
          const enemyDistance = deps.distanceFeet(attacker.id, enemy.id);
          if (enemyDistance !== null && enemyDistance <= 5 + 1e-6) {
            disadvantage.push({ source: "ranged-in-close-combat", label: `Enemy within 5 feet (${enemy.name})` });
            break;
          }
        }
      }
    }
  }
  return { advantage, disadvantage };
}

/**
 * Resolve a definition action on the server (ADR-0020): validate the action economy, compound-action
 * instance, feature requirements, and limited uses against the encounter's rules mode; aggregate
 * advantage/disadvantage with explainable sources; roll the attack against the target's AC (or
 * surface the save DC); roll typed damage with 2024 crit doubling plus declared critical bonus dice
 * and active damage-bonus effects; apply declared on-hit riders as source-linked effects; create
 * granted self effects (Rage); record every roll in the shared history; and commit the economy.
 * Damage is still PROPOSED to the GM - application stays an explicit actor:apply-damage carrying the
 * typed parts (propose→apply ladder), while conditions ride the save/rider carve-outs.
 */
export function resolveDefinitionAction(state: GameState, action: DefinitionAction, input: ResolveInput, deps: ResolveDependencies): ActionResolution {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before resolving actions.");
  const attacker = state.actors.find((item) => item.id === input.actorId);
  if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
  if (!state.combat.initiative.some((entry) => entry.actorId === input.actorId)) throw new CommandRejectedError("That combatant is not in this encounter.");
  const targets = input.targetIds.map((targetId) => {
    const target = state.actors.find((item) => item.id === targetId);
    if (!target || !state.combat.initiative.some((entry) => entry.actorId === targetId)) throw new CommandRejectedError("Every target must be in this encounter.");
    return target;
  });
  if (action.attack && targets.length !== 1) throw new CommandRejectedError("An attack roll resolves against exactly one target.");
  // A grant aimed at the action's target (Help) needs exactly one recipient.
  if (action.grants?.target === "target" && targets.length !== 1) throw new CommandRejectedError("Choose exactly one target for this action.");
  // LIMITED USES are themselves a structured effect: spending the charge IS the mechanic, and the
  // spend is what makes the pool trackable at the table. Action Surge, Indomitable, Arcane Recovery,
  // Relentless Endurance and the tiefling legacy tiers have nothing to roll - they have a counter -
  // and a self-only feature needs no target either. Without both carve-outs the counter the builder
  // now assembles could be displayed but never decremented (the same dead end 34 bundled monster
  // actions with `uses` and no roll already sit in).
  // A spell slot is the same kind of counter, so an item cast that spends one (and nothing else)
  // resolves for exactly the same reason a charge does.
  const spendsALimitedUse = action.uses !== undefined || action.spellSlot !== undefined;
  const structuredWithoutTargets = (action.grants !== undefined && action.grants.target !== "target") || action.multiattack !== undefined || spendsALimitedUse || input.builtin === true;
  if (targets.length === 0 && !structuredWithoutTargets && action.grants?.target !== "target") throw new CommandRejectedError("Choose at least one target.");
  if (!action.attack && !action.save && action.damage.length === 0 && action.grants === undefined && !spendsALimitedUse && input.builtin !== true) {
    if (action.multiattack === undefined) throw new CommandRejectedError("That action has no structured effect to resolve - run it from its description.");
  }

  const warnings: string[] = [];
  /**
   * THE TABLE'S OWN LINE (see `ActionTableNarration` in `@vtt/domain`). `warnings` is the GM's
   * channel - the operation layer writes every one of them `gmOnly: true` - so a rider that CHANGED
   * THE BOARD had no way to reach the players watching it happen. These do, through the same feed
   * `narrateTokenMove` narrates the GM's own drag into.
   *
   * ONE MOMENT, ONE ROW (D11). A sentence belongs to exactly one of the two arrays: the accomplished
   * push moved here and left `warnings`, and Topple's warning was cut back to the half - the DC - that
   * must not cross. Writing a sentence to both would print it twice in the GM's feed.
   */
  const tableNarration: Array<{ kind: "movement" | "save"; text: string; actorIds: readonly string[]; gmOnly?: boolean }> = [];
  // The attacker's whole equipment contribution, recomputed from (definition, inventory, catalog).
  // `siblings` is the EFFECTIVE action list - the economy's pool limits and multiattack composition
  // must see an item's derived actions and its raised `uses.limit`, or a charged item never recharges
  // and a pooled resource caps at the base number.
  const derivation = deriveEquipment(attacker, deps.definition, deps.catalog);
  const siblings = effectiveActions(deps.definition, attacker, deps.catalog);
  const riderItemId = sourceItemOf(action, derivation, attacker.inventory);
  let { plan, overridden } = planEconomy(state, attacker, action, input, deps.definition, warnings, deps.distanceFeet, siblings);

  // GM-adjudicated cover (SRD Cover - no line-of-sight engine, so the GM supplies the call and the
  // server applies the math): total cover can't be targeted directly; half/three-quarters add to AC
  // and Dexterity saves below.
  const coverBonus = input.cover === "half" ? 2 : input.cover === "three-quarters" ? 5 : 0;
  const coverMode = effectiveModeFor(state.combat, "cover.total");
  if (input.cover === "total" && coverMode !== "freeform") {
    if (coverMode === "strict" && !input.override && !overrideCovers(state.combat.turn, "cover.total")) throw new RulesBlockedError("cover.total", "The target has Total Cover and can't be targeted directly.");
    if (input.override && overridden === null) overridden = { rule: "cover.total", reason: overrideReason(input.override) };
    else warnings.push("The target has Total Cover - allowed per the rules mode.");
  }

  // Builtin Unarmed Strike: the attack math is actor-derived (SRD: Str modifier + Proficiency Bonus),
  // so the concrete attack is materialized at resolve time rather than declared in the catalog.
  // `input.builtin` is load-bearing, not decoration: a Monk's own strike SHADOWS this id with a
  // declared attack of its own (Martial Arts die, Dexterity or Strength), and overwriting it here
  // with Strength would put the class's whole point back where it was found.
  if (input.builtin && action.id === UNARMED_STRIKE_ACTION_ID) {
    action = { ...action, attack: { bonus: abilityModifier(deps.definition, "str") + (deps.definition?.proficiencyBonus ?? 0), reachFeet: 5 } };
  }

  // A hidden attacker's rolls stay GM-only; everyone else's fight in the open.
  const visibility = attacker.visibility === "gm-only" ? "gm-only" as const : "public" as const;
  const rollBase = { commandId: input.commandId, initiatorSessionId: deps.initiatorSessionId ?? deps.gmSessionId, initiatorRole: deps.initiatorRole ?? ("gm" as const), initiatorLabel: attacker.name, label: action.name, actorId: attacker.id, visibility, createdAt: deps.now() };

  // Builtin check-roll actions (Hide vs DC 15; Influence/Search/Study with the GM adjudicating):
  // one d20 + the actor's ability modifier (stealth skill bonus when the import carries one),
  // recorded in the shared history like every other roll.
  let check: NonNullable<ActionResolution["check"]> | null = null;
  let hiddenGranted: ActionResolution["effectGranted"] = null;
  const effectsEnded: Array<{ actorId: string; actorName: string; name: string }> = [];
  // Hoisted above the check branch (it used to be declared beside `attack`, below) so a CHECK can
  // explain its own advantage on the same field an attack does. Nothing reads it before here.
  let rollMode: ActionResolution["rollMode"];
  const checkSpec = input.builtin ? BUILTIN_CHECKS[action.id] : undefined;
  if (checkSpec) {
    let modifier = abilityModifier(deps.definition, checkSpec.ability);
    if (checkSpec.skill) {
      const skillBonus = skillBonusFromExtension(deps.definition, checkSpec.skill);
      if (skillBonus !== null) modifier = skillBonus;
    }
    modifier += exhaustionPenalty(attacker);
    // `roll-mode {roll: "check"}` reaches the DIE here (`ability-checks.ts`), which is the only place
    // it can: `checkRiderBonus` computes a displayed bonus and rolls nothing, so Boots of Elvenkind
    // could be worn, derived and shown while Hide still threw one d20. Narrowed by the builtin's own
    // ability AND skill so `ability-is`/`skill-is` match the check that is actually happening.
    const aggregated = checkRollMode(derivation, { ability: checkSpec.ability, ...(checkSpec.skill ? { skill: checkSpec.skill } : {}) });
    if (aggregated.mode !== "normal") rollMode = aggregated;
    const resolution = resolveDice(parseDiceFormula(`${checkDieFor(aggregated.mode)} ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`), deps.random);
    recordRoll(state, resolution, { ...rollBase, id: deps.newRollId(), purpose: "check" });
    const checkDice = resolution.terms.find((term): term is Extract<typeof term, { kind: "dice" }> => term.kind === "dice")!;
    const naturalCheckRoll = (checkDice.dice.find((die) => die.kept) ?? checkDice.dice[0]).face;
    const success = checkSpec.dc === null ? null : resolution.total >= checkSpec.dc;
    check = { skill: checkSpec.label, total: resolution.total, naturalRoll: naturalCheckRoll, dc: checkSpec.dc, success };
    if (action.id === "hide" && success === true) {
      // Hiding grants Invisible while hidden (SRD Hide); attacking ends it (see the reveal below).
      const effect = addEffect(state, attacker.id, {
        id: `${input.commandId}:hide`,
        name: "Hiding",
        tags: ["hidden"],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        sourceActionId: "hide",
        startedRound: state.combat.round,
        duration: { type: "manual" },
        endsWhenSourceDefeated: false,
        voidWhileIncapacitated: false,
        concentration: false,
        modifiers: [],
        linkedConditionIds: ["invisible"],
        escapeDc: null,
        onEnd: [],
        endsWithTag: null
      });
      hiddenGranted = { name: effect.name, tags: effect.tags };
    }
  }

  // Escape a Grapple (SRD Grappling): an action to roll the better of Athletics/Acrobatics against
  // the holding effect's escape DC; success ends the effect (and its linked Grappled/Restrained).
  if (input.builtin && action.id === "escape-grapple") {
    const escapable = (input.effectId ? attacker.effects.find((effect) => effect.id === input.effectId) : undefined)
      ?? attacker.effects.find((effect) => effect.escapeDc !== null);
    if (!escapable || escapable.escapeDc === null) throw new CommandRejectedError("No escapable effect (one with an escape DC) is active on this combatant.");
    const athletics = skillBonusFromExtension(deps.definition, "athletics") ?? abilityModifier(deps.definition, "str");
    const acrobatics = skillBonusFromExtension(deps.definition, "acrobatics") ?? abilityModifier(deps.definition, "dex");
    const modifier = Math.max(athletics, acrobatics) + exhaustionPenalty(attacker);
    // The SECOND place a check's d20 is thrown, and it gets the same consumer - a check path the
    // riders could not see would be a gap that reviews as working. "The better of Athletics or
    // Acrobatics" picks the ability too, so the rider is narrowed by the branch that actually won:
    // Gauntlets of Ogre Power help you shove out of a grapple, they do not help you tumble out.
    const escapeNarrow = athletics >= acrobatics ? { ability: "str" as const, skill: "athletics" } : { ability: "dex" as const, skill: "acrobatics" };
    const aggregated = checkRollMode(derivation, escapeNarrow);
    if (aggregated.mode !== "normal") rollMode = aggregated;
    const resolution = resolveDice(parseDiceFormula(`${checkDieFor(aggregated.mode)} ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`), deps.random);
    recordRoll(state, resolution, { ...rollBase, id: deps.newRollId(), purpose: "check" });
    const escapeDice = resolution.terms.find((term): term is Extract<typeof term, { kind: "dice" }> => term.kind === "dice")!;
    const success = resolution.total >= escapable.escapeDc;
    check = { skill: "Escape (Athletics/Acrobatics)", total: resolution.total, naturalRoll: (escapeDice.dice.find((die) => die.kept) ?? escapeDice.dice[0]).face, dc: escapable.escapeDc, success };
    if (success) {
      endEffect(state, attacker.id, escapable.id);
      effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name: escapable.name });
    }
  }

  let attack: ActionResolution["attack"] = null;
  let crit = false;
  // WHICH SPELL this action is, when it is one. `spell-id-is` matches against it, so it belongs on
  // BOTH branches: a spell that forces a save and rolls no attack ("when you cast Fireball") must
  // gate its riders exactly as an attack-roll cantrip does.
  const spellFilter = action.spellId === undefined ? {} : { spellId: action.spellId };
  // WHAT DAMAGE THIS ACTION DEALS belongs on both branches for the same reason `spellId` does, and
  // it used to be built only inside the attack-roll branch below. `damage-type-is` is a property of
  // the ACTION — `action.damage` is already known, the target is not consulted — so gating it on
  // "has an attack block AND exactly one target" was never a rule, it was where the code happened to
  // sit. The Sorcerer's Elemental Affinity is the record that shows the cost: "when you cast a spell
  // that deals Fire damage you can add your Charisma modifier" reaches Fire Bolt, which rolls an
  // attack, and never reached Burning Hands, which forces a save. Same feature, same damage type,
  // half the spells.
  const damageTypes = action.damage.map((part) => part.type);
  let riderFilters: Omit<Partial<RiderContext>, "moment"> = { sourceItemId: riderItemId, damageTypes, ...spellFilter };
  if (action.attack && targets.length === 1) {
    const target = targets[0];
    const targetDerivation = deriveEquipment(target, target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined, deps.catalog);
    riderFilters = {
      attackKinds: attackKindsOf(action, input, deps.distanceFeet?.(attacker.id, target.id) ?? null),
      weaponProperties: weaponPropertiesOf(riderItemId, attacker.inventory),
      damageTypes,
      targetSize: target.size ?? "medium",
      targetConditionIds: target.conditions.map((condition) => condition.id),
      sourceItemId: riderItemId,
      ...spellFilter
    };
    const sources = attackRollSources(state, attacker, target, action, deps, { attacker: derivation, target: targetDerivation, filters: riderFilters });
    const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
    const mode = input.rollMode ?? aggregated.mode;
    rollMode = input.rollMode
      ? { mode: input.rollMode, advantage: input.rollMode === "advantage" ? ["GM choice"] : [], disadvantage: input.rollMode === "disadvantage" ? ["GM choice"] : [] }
      : aggregated;
    // WHICH PASS OWNS WHICH RIDER. A STANDING `attack-bonus` (a +1 sword: no `when` at all) was
    // already folded into `action.attack.bonus` by `effectiveActions`, so the preview, the confirm
    // and the availability projection all quote the same number. Only the MOMENTARY ones - gated on
    // `on-attack-roll` plus a filter - are added here. The two sets are disjoint by construction:
    // `collectRiders(…, {moment: null})` excludes anything carrying a moment or a filter.
    const momentaryAttackBonus = sumRiders(collectRiders(derivation.carriers, { ...derivation.context, ...riderFilters, moment: "on-attack-roll" }), "attack-bonus");
    // Exhaustion applies −2 × level to every D20 Test (SRD 5.2.1); explained as a warning line so the wire shape stays unchanged.
    const bonus = action.attack.bonus + exhaustionPenalty(attacker) + momentaryAttackBonus;
    if (exhaustionLevel(attacker) > 0) warnings.push(`Exhaustion ${exhaustionLevel(attacker)}: −${2 * exhaustionLevel(attacker)} to the attack roll.`);
    const die = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
    // A preview (or a hand-rolled/confirmed d20) supplies the natural roll; otherwise roll it. The die is
    // recorded on the preview or the legacy one-shot, but NOT on a confirm (which reuses the shown roll).
    const isPreview = input.commit === false;
    const manualTotal = input.attackTotal !== undefined;
    let naturalRoll: number;
    let attackTotal: number;
    let declaredCrit = false;
    if (manualTotal) {
      // "Final total" manual entry: the player computed the whole total physically (bonuses and all), so it's
      // used verbatim vs AC and the natural die - hence a crit - can't be inferred; the crit is an explicit
      // flag. naturalRoll stays a sentinel (0 = "not a rolled die") so the result shows no misleading "nat".
      attackTotal = input.attackTotal!;
      declaredCrit = input.critical === true;
      naturalRoll = declaredCrit ? 20 : 0;
      if (isPreview) {
        const manual = resolveDice(parseDiceFormula(String(attackTotal)), () => attackTotal);
        recordRoll(state, manual, { ...rollBase, id: deps.newRollId(), purpose: "attack" });
      }
    } else if (input.attackNatural !== undefined) {
      naturalRoll = input.attackNatural;
      attackTotal = naturalRoll + bonus;
      if (isPreview) {
        const manual = resolveDice(parseDiceFormula(`1d20 ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}`), () => naturalRoll);
        recordRoll(state, manual, { ...rollBase, id: deps.newRollId(), purpose: "attack" });
      }
    } else {
      const attackResolution = resolveDice(parseDiceFormula(`${die} ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}`), deps.random);
      recordRoll(state, attackResolution, { ...rollBase, id: deps.newRollId(), purpose: "attack" });
      const diceTerm = attackResolution.terms.find((term): term is Extract<typeof term, { kind: "dice" }> => term.kind === "dice")!;
      naturalRoll = (diceTerm.dice.find((dieResult) => dieResult.kept) ?? diceTerm.dice[0]).face;
      attackTotal = attackResolution.total;
    }
    // Cover raises the effective AC (SRD Cover: +2 half, +5 three-quarters), shown in the result.
    const targetAc = target.armorClass !== undefined ? target.armorClass + coverBonus : null;
    // A declared crit (total mode) or a natural 20 (rolled/natural mode) crits; a nat 1 fumbles, but only when
    // a natural die is known (total mode has none, so it can only hit or miss on the total vs AC).
    // SRD crits on a natural 20; a `critical-range` rider can widen the threshold (19-20).
    const critFloor = criticalThreshold(derivation, attacker, action);
    crit = declaredCrit || (!manualTotal && naturalRoll >= critFloor);
    let outcome = crit ? "crit" as const
      : (!manualTotal && naturalRoll === 1) ? "fumble" as const
      : targetAc === null ? "unknown" as const
      : attackTotal >= targetAc ? "hit" as const : "miss" as const;
    // 2024: hitting an Unconscious OR Paralyzed creature from within 5 feet is a critical hit.
    if (outcome === "hit" && target.conditions.some((condition) => condition.id === "unconscious" || condition.id === "paralyzed")) {
      const distance = deps.distanceFeet?.(attacker.id, target.id) ?? null;
      if ((distance !== null && distance <= 5) || (distance === null && action.attack.reachFeet !== undefined)) {
        outcome = "crit";
        crit = true;
      }
    }
    attack = { targetId: target.id, targetName: target.name, total: attackTotal, naturalRoll, targetAc, outcome, ...(coverBonus > 0 ? { coverBonus } : {}) };
    // PREVIEW: the d20 is rolled and shown, but nothing is applied - no damage, riders, prompts, or
    // economy. The client offers Adv/Disadv/Confirm; confirming resolves for real with this natural roll
    // (the uniform roll widget, matching saving throws). Economy was validated above, so an illegal
    // attack is blocked before the preview roll, not after.
    if (isPreview) {
      return {
        actionName: action.name, activation: action.activation, attack,
        save: null, damage: [], damageTotal: 0, crit,
        ...(rollMode && (rollMode.advantage.length > 0 || rollMode.disadvantage.length > 0) ? { rollMode } : {}),
        effectGranted: null, componentsRemaining: null,
        ...(warnings.length > 0 ? { warnings } : {}),
        overridden, preview: true
      };
    }
  }

  // Damage is rolled unless the attack already whiffed outright.
  const damage: Array<{ formula: string; type: string; total: number }> = [];
  const bonusDamage: Array<{ amount: number; type: string; source: string }> = [];
  if (action.damage.length > 0 && (attack === null || attack.outcome === "crit" || attack.outcome === "hit" || attack.outcome === "unknown")) {
    let firstPart = true;
    for (const part of action.damage) {
      const expression = parseDiceFormula(part.formula);
      const extraCritDice = firstPart ? action.attack?.criticalBonusDice ?? 0 : 0;
      const rolled = resolveDice(crit ? criticalExpression(expression, extraCritDice) : expression, deps.random);
      recordRoll(state, rolled, { ...rollBase, id: deps.newRollId(), purpose: "damage" });
      damage.push({ formula: rolled.expression.source, type: part.type, total: rolled.total });
      firstPart = false;
    }
    // Flat damage bonuses from active effects (Rage +2 melee) land as their own explainable line.
    if (action.attack) {
      const melee = action.attack.reachFeet !== undefined || action.attack.rangeFeet === undefined;
      for (const effect of attacker.effects) {
        for (const modifier of effect.modifiers) {
          if (modifier.type === "damage-bonus" && (modifier.appliesTo === "all" || melee)) {
            bonusDamage.push({ amount: modifier.amount, type: damage[0]?.type ?? "untyped", source: effect.name });
          }
        }
      }
    }
  }
  /**
   * WEAPON MASTERY, first of two call sites. The rules themselves live in `weapon-mastery.ts` - one
   * registry keyed by slug, whose keys ARE the implemented set the derivation gates on - because a
   * mastery is a small rule at one moment of a swing and eight of them inline here is one hunk edited
   * eight times.
   *
   * The swing context is built once, here, and null unless a mastery is in force on an attack that
   * actually rolled: `attack !== null` is what guarantees the single target the SRD's masteries all
   * act on, so the handlers read the target off `attack` and have no way to name a second.
   *
   * The ON-MISS hook fires HERE, outside the damage block above, because Graze is the one mastery
   * that fires on a MISS and that block is gated on hit/crit/unknown by design.
   */
  const mastery = derivation.masteryByActionId[action.id];
  const masterySwing: MasterySwing | null = mastery && attack !== null
    ? {
        mastery, attack,
        attacker: { id: attacker.id, name: attacker.name },
        damageType: action.damage[0]?.type ?? "untyped",
        proficiencyBonus: deps.definition?.proficiencyBonus ?? 0,
        actionId: action.id,
        commandId: input.commandId,
        round: state.combat.round
      }
    : null;
  bonusDamage.push(...masteryMissDamage(masterySwing));

  // TYPED RIDER DAMAGE: criterion 1's "extra 1d4 lightning" and criterion 9's "extra 1d6 fire on a
  // critical hit". Neither existing channel can carry it - `bonusDamage` is flat integers only, and
  // `attack.criticalBonusDice` is a bare COUNT applied to the first damage part, so it cannot carry a
  // damage type. Rider dice therefore roll here and land as their own entries in `damage[]`, which
  // needs no wire-shape change, keeps `damageTotal` correct, and leaves the six existing
  // `bonusDamage` consumers untouched.
  //
  // 5e does not double dice added AFTER the attack, so a rider is NOT crit-doubled unless it opts in
  // with `doubleOnCritical`. `criticalExpression` doubles the action's own damage terms and is not
  // reused for these.
  if (attack === null || attack.outcome === "crit" || attack.outcome === "hit" || attack.outcome === "unknown") {
    const hit = attack !== null && (attack.outcome === "hit" || attack.outcome === "crit");
    // A rider with NO `when` fires on every damage roll of the action it is scoped to (that is what
    // "standing" means for a damage rider); `on-hit` and `on-critical-hit` narrow it to those moments.
    const passes: Array<RiderMoment | null> = [null, "on-damage-roll"];
    if (hit || attack === null) passes.push("on-hit");
    if (crit) passes.push("on-critical-hit");
    if (attack !== null && attack.outcome === "fumble") passes.push("on-critical-miss");
    const already = new Set<unknown>();
    for (const moment of passes) {
      for (const rider of collectRiders(derivation.carriers, { ...derivation.context, ...riderFilters, moment })) {
        // A MOMENT-GATED flat `damage-bonus` ("+7 Bludgeoning on a critical hit") lands as its own
        // explainable line beside Rage and Graze - flat integers with a source label are exactly
        // that channel. The `moment === null` skip is the double-count guard: a STANDING
        // damage-bonus was already folded into the formula by `withStandingRiders`, and the null
        // pass would re-collect it here. Typed as the damage it joins; no damage rolled, no bonus.
        if (rider.modifier.type === "damage-bonus") {
          if (moment === null || already.has(rider.modifier)) continue;
          const amount = rider.modifier.amount ?? 0;
          if (amount === 0 || damage.length === 0) continue;
          already.add(rider.modifier);
          bonusDamage.push({ amount, type: damage[0].type, source: rider.label });
          continue;
        }
        if (rider.modifier.type !== "extra-damage" || already.has(rider.modifier)) continue;
        // AN ABILITY MODIFIER IS AN AMOUNT, NOT A DIE. "Add your Charisma modifier to the damage"
        // (Agonizing Blast) resolves against the BEARER's own sheet at the roll, so no authored
        // constant could have said it. It rolls nothing - there is no die to record - and it is
        // never crit-doubled, because 5e doubles dice and this is a flat number.
        const abilityAmount = rider.modifier.abilityModifier === undefined
          ? 0 : abilityModifier(deps.definition, rider.modifier.abilityModifier);
        if (rider.modifier.formula === undefined && rider.modifier.abilityModifier === undefined) continue;
        already.add(rider.modifier);
        const type = rider.modifier.damageType ?? damage[0]?.type ?? "untyped";
        if (rider.modifier.formula === undefined) {
          if (abilityAmount === 0) continue; // a +0 modifier adds no entry and no noise to the card
          damage.push({ formula: String(abilityAmount), type, total: abilityAmount });
          warnings.push(`${rider.label}: +${abilityAmount} ${type} (${rider.modifier.abilityModifier!.toUpperCase()}).`);
          continue;
        }
        const expression = parseDiceFormula(rider.modifier.formula);
        const rolled = resolveDice(crit && rider.modifier.doubleOnCritical === true ? criticalExpression(expression) : expression, deps.random);
        recordRoll(state, rolled, { ...rollBase, id: deps.newRollId(), purpose: "damage" });
        const total = rolled.total + abilityAmount;
        damage.push({ formula: rolled.expression.source, type, total });
        warnings.push(`${rider.label}: +${total} ${type}.`);
      }
    }
  }
  // Builtin Unarmed Strike damage is flat (SRD: 1 + Str modifier Bludgeoning, no dice) - it rides
  // the explainable bonus-damage channel since the dice grammar has no zero-die formula. Again the
  // `input.builtin` gate is the thing keeping a Monk's declared Martial Arts die from being paid a
  // second, Strength-flavoured time.
  if (input.builtin && action.id === UNARMED_STRIKE_ACTION_ID && attack !== null && (attack.outcome === "crit" || attack.outcome === "hit")) {
    bonusDamage.push({ amount: Math.max(0, 1 + abilityModifier(deps.definition, "str")), type: "bludgeoning", source: "Unarmed Strike" });
  }

  // Declared on-hit riders (Bite: Grappled + Restrained, escape DC 15) apply as ONE source-linked
  // effect per rider - the condition carve-out class shared with save auto-apply (ADR-0020).
  const effectsApplied: Array<{ targetId: string; targetName: string; name: string; conditionIds: readonly string[] }> = [];
  if (action.onHit && attack !== null && (attack.outcome === "crit" || attack.outcome === "hit")) {
    const target = targets[0];
    action.onHit.forEach((rider, index) => {
      if (rider.maxTargetSize && !sizeAtMost(target.size, rider.maxTargetSize)) {
        warnings.push(`${target.name} is too large for ${action.name}'s ${rider.conditions.map((condition) => conditionLabel(condition.id)).join("/")} rider.`);
        return;
      }
      const conditionIds = rider.conditions.map((condition) => condition.id);
      const effect = addEffect(state, target.id, {
        id: `${input.commandId}:hit:${target.id}:${index}`,
        name: `${conditionLabel(conditionIds[0])} by ${attacker.name} (${action.name})`,
        tags: conditionIds.includes("grappled") ? ["grapple"] : [],
        sourceActorId: attacker.id,
        sourceName: attacker.name,
        sourceActionId: `${action.id}:${index}`,
        startedRound: state.combat.round,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        voidWhileIncapacitated: false,
        concentration: false,
        modifiers: [],
        linkedConditionIds: conditionIds,
        escapeDc: rider.escapeDc ?? null,
        onEnd: [],
        endsWithTag: null
      });
      effectsApplied.push({ targetId: target.id, targetName: target.name, name: effect.name, conditionIds });
    });
  }

  /**
   * WEAPON MASTERY, second call site: the ON-HIT hook (Sap today). It sits after the declared on-hit
   * riders because that is the order the two used to run in and the roll card lists `effectsApplied`
   * in the order it was filled.
   *
   * The handler BUILDS the effect and this loop ADDS it - `weapon-mastery.ts` deliberately imports
   * nothing at runtime so `equipment-derivation.ts` can depend on its registry keys without dragging
   * `effects.ts` into a leaf. `addEffect`'s RETURN is what gets narrated: it is idempotent by id, so a
   * retried command reports the effect that is really on the actor rather than the one just built.
   */
  for (const applied of masteryHitEffects(masterySwing)) {
    const effect = addEffect(state, applied.targetId, applied.effect);
    effectsApplied.push({ targetId: applied.targetId, targetName: applied.targetName, name: effect.name, conditionIds: applied.effect.linkedConditionIds });
  }

  /**
   * THE RESOLVER'S OWN HALF OF THE VIEWER GATE, for the table lines below. `appendLog`
   * (`server.ts`) already re-derives a row's GM-only-ness from its `actorIds` against live state, so
   * this is the SECOND, independent gate - the same belt-and-braces `tokenMove` runs, where
   * `narrateTokenMove` decides structurally that a hidden mover has no public line AND the caller
   * still passes the mover's id for the feed to check again.
   *
   * `!== "public"` rather than `=== "gm-only"`: an unknown actor and any visibility that is not
   * public both fail toward hiding the line, so a third visibility added later cannot leak through a
   * comparison written before it existed.
   */
  const namesAHiddenCombatant = (...actorIds: readonly string[]) =>
    actorIds.some((id) => state.actors.find((actor) => actor.id === id)?.visibility !== "public");

  /**
   * WEAPON MASTERY, third call site: the ON-HIT SAVE (Topple today). The handler computed the DC and
   * named the condition; this parks a real prompt through the SAME door every other save uses, so
   * answering it rolls the target's own Constitution save and applies Prone through `setCondition`.
   *
   * The prompt is NOT mirrored into this resolution's `save` field. That field means "this action
   * calls for a save", and the runner's note beneath it counts prompts by `actionName` - which for a
   * mastery is the mastery's, not the weapon's, so mirroring it there would print "All saving throws
   * for Quarterstaff resolved" over a Topple save that is still owed. Two narration lines say the true
   * thing instead, and the tracker row is where it is answered either way.
   *
   * THE TWO LINES ARE SPLIT BY WHAT MAY CROSS, not by convenience. The table's line names WHAT FORCED
   * THE SAVE - a Constitution save appearing in front of a player with nothing explaining it is the
   * gap this closes - and the GM's keeps the DC. The DC is the ATTACKER's number (8 + the modifier
   * that made the attack roll + their Proficiency Bonus), so printing it to the table would hand every
   * player a reading off a monster's stat block the moment a monster carries a topple weapon. The
   * target's OWN player still learns it, through the pending-save projection that has always carried
   * `dc` because you cannot roll against a number you were not told (`projections.ts`).
   */
  for (const forced of masteryHitSaves(masterySwing)) {
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: forced.actionName,
      ability: forced.ability,
      dc: forced.dc,
      targetIds: [forced.targetId],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionId: forced.conditionId,
      // A mastery fires on EVERY hit, and Extra Attack lands two of them inside one Attack action, so
      // this prompt is parked BESIDE its predecessor instead of replacing it (see `createPendingSaves`).
      // The warning below is written per hit; replacing here would print two saves and owe one.
      replaceExisting: false,
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
    const orTheCondition = forced.conditionId === null ? "" : ` or have the ${conditionLabel(forced.conditionId)} condition`;
    tableNarration.push({
      kind: "save",
      text: `${attacker.name}'s ${forced.actionName} forces ${forced.targetName} to make a ${forced.ability.toUpperCase()} save${orTheCondition}.`,
      actorIds: [attacker.id, forced.targetId],
      ...(namesAHiddenCombatant(attacker.id, forced.targetId) ? { gmOnly: true } : {})
    });
    warnings.push(`${forced.actionName}: ${forced.targetName}'s save is DC ${forced.dc} - the prompt is in the turn order.`);
  }

  /**
   * WEAPON MASTERY, fourth call site: FORCED MOVEMENT (Push today). The handler named the pair, the
   * distance and the SRD's size gate; the callback owns the geometry (see `pushToken` on
   * `ResolveDependencies`, and `forced-movement.ts` for why this is not `applyMovementRules`).
   *
   * `targets[0]` is the pushed creature and is the SAME creature `forced.targetId` names - an attack
   * resolves against exactly one target or this function has already thrown, so the size read here
   * cannot belong to anyone else. It is read the way the declared on-hit riders read theirs.
   *
   * EVERY failure degrades to a sentence, never a rejection: too large, unplaced, an uncalibrated
   * and unscaled map, a resolver with no callback, a map the fight has already left. A swing that hit
   * must not be undone because the map could not answer a geometry question, so the line tells the GM
   * to move the token - the builtin Shove's own shape.
   *
   * ONLY THE ACCOMPLISHED PUSH IS THE TABLE'S. A token that really moved is something every player
   * watched happen, so its sentence goes to the feed the whole table reads and leaves `warnings`
   * entirely - one moment, one row. The other three sentences stay GM-only and are not the same kind
   * of thing: two of them ("move the token", "the map has nowhere to put it") are INSTRUCTIONS to the
   * one person who can place a token, and the size gate reports a rule that stopped the board
   * changing at all. Sending an instruction to players would have them read it as an event.
   */
  for (const forced of masteryHitPushes(masterySwing)) {
    if (!sizeAtMost(targets[0].size, forced.maxTargetSize)) {
      // Capitalised to match how the SRD prints a creature size in prose ("Large or smaller").
      warnings.push(`${forced.targetName} is bigger than ${forced.maxTargetSize[0].toUpperCase()}${forced.maxTargetSize.slice(1)} and can't be pushed.`);
      continue;
    }
    const moved = deps.pushToken?.({ actorId: forced.targetId, awayFromActorId: forced.awayFromActorId, distanceFeet: forced.distanceFeet }) ?? null;
    // THE OUTCOMES ARE THREE, NOT TWO. Null is "the map could not answer" - unplaced, uncalibrated,
    // no callback, a map the fight has left - and only that one asks the GM to move the token by
    // hand. A measured ZERO is the opposite: the map DID answer, and `moveEncounterToken`'s own bounds
    // and footprint checks refused every square along that line (a token pinned at the edge, or a
    // regional map whose cell is wider than the shove), so telling the GM to move it 10 feet there
    // asks for a placement the map has already declined. Rounded before the comparison, the way
    // `narrateTokenMove` rounds a drag, so snapping dust cannot print "pushed 0 ft".
    if (moved === null) {
      warnings.push(`${forced.targetName} is pushed ${forced.distanceFeet} feet straight away from ${attacker.name} - move the token.`);
      continue;
    }
    const travelled = Math.round(moved.value * 10) / 10;
    if (travelled > 0) {
      // Every word here is already a player's to read: two public combatants' names, and a distance
      // between two token positions the player projection ships anyway (`projections.ts` filters the
      // token list to public actors, so a player could measure this move off their own screen).
      tableNarration.push({
        kind: "movement",
        text: `${forced.targetName} is pushed ${travelled} ${moved.unit} straight away from ${attacker.name}.`,
        actorIds: [attacker.id, forced.targetId],
        ...(namesAHiddenCombatant(attacker.id, forced.targetId) ? { gmOnly: true } : {})
      });
      continue;
    }
    warnings.push(`${forced.targetName} is pushed straight away from ${attacker.name}, but the map has nowhere to put it - the token stays where it is.`);
  }

  // Granted effects (Rage, Reckless Attack - self; Help - the chosen ally): replace-on-refresh,
  // end at 0 HP of the granter (can't be sustained while down).
  let effectGranted: ActionResolution["effectGranted"] = hiddenGranted;
  if (action.grants) {
    const grant = action.grants;
    const recipient = grant.target === "target" ? targets[0] : attacker;
    // The Ready action's free-text trigger travels in the effect name so the table sees it.
    const readyNote = input.builtin && action.id === "ready" && input.note ? `Readied: ${input.note.slice(0, 100)}` : null;
    // A concentration grant may end the granter's previous concentration; surface that as a warning line.
    const replaced: { kind: "effect" | "condition"; text: string; actorId: string }[] = [];
    const effect = addEffect(state, recipient.id, {
      id: `${input.commandId}:grant`,
      name: readyNote ?? grant.name ?? action.name,
      tags: grant.tags,
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration: grant.duration.type === "rounds" ? { type: "rounds", remaining: grant.duration.rounds } : grant.duration,
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: grant.modifiers,
      linkedConditionIds: [],
      escapeDc: null,
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration
    }, replaced);
    warnings.push(...replaced.map((event) => event.text));
    if (grant.target === "target") effectsApplied.push({ targetId: recipient.id, targetName: recipient.name, name: effect.name, conditionIds: [] });
    else effectGranted = { name: effect.name, tags: effect.tags };
  }

  // A hit against a combatant whose stat block declares a matching reaction (Uncanny Dodge) parks
  // the rolled damage in a pending prompt instead of the runner's apply button: answering "use"
  // spends the reaction and applies half, "decline" applies it in full (see reactions.ts). Freeform
  // mode stays prompt-free - reference-level play keeps the manual damage flow.
  const reactionPrompts: Array<{ actorId: string; actorName: string; actionName: string }> = [];
  // The reaction WINDOW is action economy (a reaction is spent), so it follows the economy family -
  // switching off movement policing must not also silence Uncanny Dodge.
  if (attack !== null && (attack.outcome === "crit" || attack.outcome === "hit") && familyModeFor(state.combat, "economy") !== "freeform" && deps.resolveDefinition) {
    const target = targets[0];
    const proposedParts = [
      ...damage.map((part) => ({ amount: part.total, type: part.type })),
      ...bonusDamage.map((part) => ({ amount: part.amount, type: part.type }))
    ].filter((part) => part.amount > 0);
    const proposedTotal = proposedParts.reduce((sum, part) => sum + part.amount, 0);
    const targetDefinition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    // The TARGET's effective list, not its definition's: a reaction an item grants (a missile-snaring
    // shield) has to be findable here or it never fires.
    const declared = effectiveActions(targetDefinition, target, deps.catalog).find((candidate) => candidate.activation === "reaction" && candidate.reaction?.trigger === "hit-by-attack" && candidate.reaction.response === "half-damage");
    const targetIncapacitated = target.conditions.some((condition) => (INCAPACITATING_CONDITIONS as readonly string[]).includes(condition.id));
    if (declared && proposedTotal > 0 && target.id !== attacker.id && !targetIncapacitated
      && !state.combat.reactionsUsed.includes(target.id)
      && state.combat.pendingReactions.length < 20) {
      state.combat = {
        ...state.combat,
        pendingReactions: [...state.combat.pendingReactions, {
          id: deps.newRollId(),
          kind: "hit-by-attack" as const,
          actorId: target.id,
          actionId: declared.id,
          actionName: declared.name,
          sourceActorId: attacker.id,
          sourceName: attacker.name,
          targetActorId: null,
          triggerCommandId: input.commandId,
          proposedDamage: proposedTotal,
          proposedDamageParts: proposedParts,
          critical: crit,
          createdAt: Date.parse(deps.now())
        }]
      };
      reactionPrompts.push({ actorId: target.id, actorName: target.name, actionName: declared.name });
    }
  }

  // Builtin Unarmed Strike grapple/shove (SRD): no attack roll - the target makes a Str or Dex save
  // (its better modifier, standing in for "its choice") vs DC 8 + Str modifier + Proficiency Bonus.
  // Failure applies the Grappled effect (with that DC as the escape DC) or Prone; a failed shove-push
  // is narrated for the GM to move the token 5 feet.
  let builtinSave: ActionResolution["save"] = null;
  if (input.builtin && (action.id === "unarmed-grapple" || action.id === "unarmed-shove-prone" || action.id === "unarmed-shove-push")) {
    if (targets.length !== 1) throw new CommandRejectedError("Choose exactly one target.");
    const target = targets[0];
    const dc = Math.max(1, 8 + abilityModifier(deps.definition, "str") + (deps.definition?.proficiencyBonus ?? 0));
    const targetDefinition = target.definitionId ? deps.resolveDefinition?.(target.definitionId) : undefined;
    const ability: "str" | "dex" = saveModifierFor(targetDefinition, "dex") >= saveModifierFor(targetDefinition, "str") ? "dex" : "str";
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: action.name,
      ability,
      dc,
      targetIds: [target.id],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionId: action.id === "unarmed-shove-prone" ? "prone" : null,
      ...(action.id === "unarmed-grapple" ? { onFailEffect: { name: `Grappled by ${attacker.name}`, tags: ["grapple"], linkedConditionIds: ["grappled"], escapeDc: dc, sourceActorId: attacker.id, sourceName: attacker.name } } : {}),
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
    if (action.id === "unarmed-shove-push") warnings.push(`On a failed save, ${target.name} is pushed 5 feet - move the token.`);
    builtinSave = { ability, dc, targets: [{ targetId: target.id, targetName: target.name }] };
  }

  // A save action leaves one pending save per target: prompts appear in the tracker rows, each
  // answered by rolling or typing a total, and the outcome auto-applies (see saving-throws.ts).
  if (action.save) {
    createPendingSaves(state, {
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      actionName: action.name,
      ability: action.save.ability,
      dc: action.save.dc,
      targetIds: targets.map((target) => target.id),
      proposedDamage: damage.reduce((sum, part) => sum + part.total, 0),
      proposedDamageParts: damage.map((part) => ({ amount: part.total, type: part.type })),
      // Cover adds to Dexterity saving throws (SRD Cover) - carried on the prompt.
      saveBonus: action.save.ability === "dex" ? coverBonus : 0,
      halfOnSuccess: halfOnSuccessFrom(action.description),
      // GM's explicit choice wins; otherwise auto-detect a condition from the action prose (only if the
      // bundle actually has it), so "…or be Poisoned" applies on a failed save without manual tagging.
      conditionId: input.conditionId ?? ((autoCondition) => autoCondition && (!deps.hasCondition || deps.hasCondition(autoCondition)) ? autoCondition : null)(conditionFrom(action.description)),
      newSaveId: deps.newRollId,
      createdAt: Date.parse(deps.now())
    });
  }

  // Commit the validated economy plan (ADR-0020): slots, the compound-action instance, limited uses.
  if (plan.markAction || plan.markBonus) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: state.combat.turn.actionUsed || plan.markAction, bonusActionUsed: state.combat.turn.bonusActionUsed || plan.markBonus, actionInstance: plan.instance ? { actorId: plan.instance.actorId, components: { ...plan.instance.components } } : null } };
  } else if (plan.instance !== state.combat.turn.actionInstance) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionInstance: plan.instance ? { actorId: plan.instance.actorId, components: { ...plan.instance.components } } : null } };
  }
  if (plan.markReaction) {
    state.combat = { ...state.combat, reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== attacker.id), attacker.id] };
  }
  // A GM override applies to that rule's whole FAMILY for the rest of this creature's turn, so the
  // next block of the same kind isn't re-prompted (D9 - one tap, no nagging). Every family is
  // remembered now, not just economy/range. Cleared on turn advance with the rest of `turn`.
  if (overridden) rememberOverride(state, overridden.rule);
  if (plan.spendLegendary) {
    state.combat = { ...state.combat, legendaryUsed: { ...state.combat.legendaryUsed, [attacker.id]: (state.combat.legendaryUsed[attacker.id] ?? 0) + plan.spendLegendary.cost } };
  }
  if (plan.spendSpellSlot) {
    const level = plan.spendSpellSlot.level;
    // Clamped, never negative: the economy pass above already refused an empty pool unless the GM
    // overrode it, and an override spends what is there rather than going into debt.
    attacker.spellSlots = (attacker.spellSlots ?? []).map((entry) => entry.level === level ? { ...entry, remaining: Math.max(0, entry.remaining - 1) } : entry);
  }
  if (plan.spendUse) {
    if (plan.spendUse.per === "turn") {
      const key = `${attacker.id}:${plan.spendUse.key}`;
      state.combat = { ...state.combat, turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [key]: (state.combat.turn.turnUses[key] ?? 0) + 1 } } };
    } else {
      attacker.actionUses = { ...attacker.actionUses, [plan.spendUse.key]: (attacker.actionUses[plan.spendUse.key] ?? 0) + 1 };
    }
  }

  // Attacking reveals you (SRD Hide): a resolved attack or save action ends the hidden effect -
  // the attack itself still enjoyed the Invisible advantage, which is the SRD's exact sequencing.
  if ((action.attack !== undefined || action.save !== undefined) && hasEffectTag(attacker, "hidden")) {
    const hiddenEffect = attacker.effects.find((effect) => effect.tags.includes("hidden"))!;
    endEffect(state, attacker.id, hiddenEffect.id);
    effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name: hiddenEffect.name });
  }
  // Ready release (SRD Ready): resolving anything off-turn while Readied spends the reaction and
  // ends the readied intent; the log ties the release to the ready.
  if (state.combat.turnActorId !== attacker.id && action.id !== "ready" && hasEffectTag(attacker, "readied")) {
    const readied = attacker.effects.find((effect) => effect.tags.includes("readied"))!;
    endEffect(state, attacker.id, readied.id);
    effectsEnded.push({ actorId: attacker.id, actorName: attacker.name, name: readied.name });
    if (!state.combat.reactionsUsed.includes(attacker.id)) {
      state.combat = { ...state.combat, reactionsUsed: [...state.combat.reactionsUsed, attacker.id] };
    } else {
      warnings.push(`${attacker.name}'s reaction was already spent - the readied action released without one.`);
    }
  }

  const damageTotal = damage.reduce((sum, part) => sum + part.total, 0) + bonusDamage.reduce((sum, part) => sum + part.amount, 0);
  return {
    actionName: action.name,
    activation: action.activation,
    attack,
    save: action.save ? { ability: action.save.ability, dc: action.save.dc, targets: targets.map((target) => ({ targetId: target.id, targetName: target.name })) } : builtinSave,
    damage,
    damageTotal,
    crit,
    ...(rollMode && (rollMode.advantage.length > 0 || rollMode.disadvantage.length > 0) ? { rollMode } : {}),
    ...(bonusDamage.length > 0 ? { bonusDamage } : {}),
    ...(effectsApplied.length > 0 ? { effectsApplied } : {}),
    effectGranted,
    componentsRemaining: state.combat.turn.actionInstance?.actorId === attacker.id && Object.values(state.combat.turn.actionInstance.components).some((remaining) => remaining > 0)
      ? state.combat.turn.actionInstance.components
      : null,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(tableNarration.length > 0 ? { tableNarration } : {}),
    overridden,
    ...(reactionPrompts.length > 0 ? { reactionPrompts } : {}),
    ...(check ? { check } : {}),
    ...(effectsEnded.length > 0 ? { effectsEnded } : {})
  };
}

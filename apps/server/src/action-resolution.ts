import type { ActionResolution, GameState, RollRecord } from "@vtt/domain";
import { aggregateRollMode, parseDiceFormula, resolveDice, type DiceExpression, type RandomSource, type RollModeSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { addEffect, endEffect, hasEffectTag } from "./effects.js";
import { conditionFrom, createPendingSaves, halfOnSuccessFrom, saveModifierFor } from "./saving-throws.js";
import { conditionLabel, exhaustionLevel, exhaustionPenalty, INCAPACITATING_CONDITIONS, isIncapacitated } from "./condition-rules.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";

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
  override?: Readonly<{ reason: string }> | null;
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
}>;
export type ResolveDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  gmSessionId: string;
  now: () => string;
  hasCondition?: (id: string) => boolean;
  /** The attacker's full definition - multiattack composition and limited-use lookups need sibling actions. */
  definition?: ActorDefinition;
  /** Authoritative map distance in feet between two combatants' tokens; null when unmeasurable (no positions / no calibration). */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Resolves ANY combatant's definition (imported over bundled) - needed to offer the TARGET's declared reactions. */
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
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

function recordRoll(state: GameState, resolution: ReturnType<typeof resolveDice>, base: Pick<RollRecord, "id" | "commandId" | "initiatorSessionId" | "initiatorLabel" | "actorId" | "purpose" | "visibility" | "createdAt">) {
  let group = 0;
  const record: RollRecord = {
    ...base,
    initiatorRole: "gm",
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
  state.rolls.push(record);
  if (state.rolls.length > 200) state.rolls.splice(0, state.rolls.length - 200);
}

const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
function sizeAtMost(size: string | undefined, limit: string): boolean {
  return SIZE_ORDER.indexOf((size ?? "medium") as (typeof SIZE_ORDER)[number]) <= SIZE_ORDER.indexOf(limit as (typeof SIZE_ORDER)[number]);
}

type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";
/** Ability modifier from the definition's scores; +0 when no definition is known (documented builtin fallback). */
export function abilityModifier(definition: ActorDefinition | undefined, ability: AbilityKey): number {
  const score = definition?.abilityScores[ability] ?? 10;
  return Math.floor((score - 10) / 2);
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
}>;

/** The multiattack parents (sibling actions) that list `action` as a component. */
function multiattackParents(definition: ActorDefinition | undefined, action: DefinitionAction): DefinitionAction[] {
  if (!definition) return [];
  return definition.actions.filter((candidate) => candidate.multiattack?.some((component) => component.actionId === action.id) ?? false);
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
export function evaluateActionEconomy(state: GameState, attacker: LiveActor, action: DefinitionAction, targetIds: readonly string[], definition: ActorDefinition | undefined, distanceFeet?: (actorIdA: string, actorIdB: string) => number | null): EconomyEvaluation {
  const violations: RuleViolation[] = [];
  const softViolations: RuleViolation[] = [];
  const notes: string[] = [];
  const onOwnTurn = state.combat.turnActorId === attacker.id;
  const turn = state.combat.turn;
  // An actor whose stat block has a prose-only Multiattack can't be validated fairly: its extra
  // attacks live in text the engine can't see, so action-slot violations degrade to warnings.
  const proseMultiattack = definition?.actions.some((candidate) => /multiattack/i.test(candidate.name) && !candidate.multiattack) ?? false;

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
    const spent = action.uses.per === "turn" ? (turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
    if (spent >= action.uses.limit) {
      const scopeLabel = action.uses.per === "turn" ? "turn"
        : action.uses.per === "encounter" ? "encounter"
        : action.uses.per === "short-rest" ? "short rest"
        : action.uses.per === "recharge" ? `spent - recharges on ${action.uses.recharge}+ at the start of its turn`
        : "long rest";
      violations.push({ rule: "feature.no-uses-remaining", message: `${action.name}: no uses remaining (${action.uses.per === "recharge" ? scopeLabel : `${action.uses.limit}/${scopeLabel}`}).` });
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
      const parents = multiattackParents(definition, action);
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
      const componentName = (id: string) => id === "attack" ? "attack" : definition?.actions.find((candidate) => candidate.id === id)?.name ?? id;
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

  return { violations, softViolations, plan: { markAction, markBonus, markReaction, instance, spendUse, spendLegendary }, proseMultiattack, notes };
}

/**
 * Read-only availability projection over an actor's whole action list (the `available-actions` API):
 * per action, whether strict mode would allow it right now, every violated rule, and the remaining
 * limited uses / open-instance rolls. Target-specific rules (`targetRules`) can't be pre-checked
 * without a target and are deliberately absent here. Never mutates state.
 */
export function actionAvailability(state: GameState, attacker: LiveActor, actions: ReadonlyArray<DefinitionAction>, definition: ActorDefinition | undefined, builtin = false): ReadonlyArray<{
  id: string; name: string; activation: DefinitionAction["activation"]; available: boolean;
  violations: ReadonlyArray<{ rule: string; message: string }>; usesRemaining: number | null; componentsRemaining: number | null; builtin?: boolean;
}> {
  return actions.map((action) => {
    const evaluation = evaluateActionEconomy(state, attacker, action, [], definition);
    let usesRemaining: number | null = null;
    if (action.uses) {
      const key = action.uses.pool ?? action.id;
      const spent = action.uses.per === "turn" ? (state.combat.turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
      usesRemaining = Math.max(0, action.uses.limit - spent);
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
      ...(builtin ? { builtin: true } : {})
    };
  });
}

/**
 * Validate the resolve against the encounter's rules mode and plan its economy commitment
 * (ADR-0020). Strict rejects the first violation with an override path; assisted converts
 * violations to warnings; freeform skips validation.
 */
function planEconomy(state: GameState, attacker: LiveActor, action: DefinitionAction, input: ResolveInput, definition: ActorDefinition | undefined, warnings: string[], distanceFeet?: (actorIdA: string, actorIdB: string) => number | null): { plan: EconomyPlan; overridden: { rule: string; reason: string } | null } {
  const mode = state.combat.rulesMode;
  const { violations, softViolations, plan, proseMultiattack, notes } = evaluateActionEconomy(state, attacker, action, input.targetIds, definition, distanceFeet);
  warnings.push(...notes);

  let overridden: { rule: string; reason: string } | null = null;
  const allViolations = [...violations, ...softViolations];
  if (mode !== "freeform" && allViolations.length > 0) {
    if (input.override) {
      overridden = { rule: allViolations[0].rule, reason: input.override.reason };
    } else {
      // A GM override earlier this turn (turn.rulesOverridden) covers the per-turn-repeatable families
      // for the rest of the creature's turn: action/bonus/reaction economy and positional range/reach.
      // Every other family (incapacitation, limited uses, legendary, cover, target-specific) still
      // re-prompts, so it stays an explicit, audited call each time.
      const covered = (rule: string) => state.combat.turn.rulesOverridden === true && (rule.startsWith("economy.") || rule.startsWith("range."));
      const blocking = violations.filter((violation) => !covered(violation.rule));
      if (mode === "strict" && blocking.length > 0) {
        throw new RulesBlockedError(blocking[0].rule, blocking[0].message);
      } else {
        warnings.push(...allViolations.filter((violation) => !covered(violation.rule)).map((violation) => violation.message));
        if (proseMultiattack && softViolations.length > 0) warnings.push(`${attacker.name}'s Multiattack is prose-only - extra attacks aren't validated.`);
      }
    }
  }

  return { plan, overridden };
}

/** Advantage/disadvantage sources the engine can see; the explicit GM rollMode choice wins over all of them. */
function attackRollSources(state: GameState, attacker: LiveActor, target: LiveActor, action: DefinitionAction, deps: ResolveDependencies): { advantage: RollModeSource[]; disadvantage: RollModeSource[] } {
  const advantage: RollModeSource[] = [];
  const disadvantage: RollModeSource[] = [];
  const has = (actor: LiveActor, id: string) => actor.conditions.some((condition) => condition.id === id);
  const onOwnTurn = state.combat.turnActorId === attacker.id;

  // Effect modifiers: attack-advantage is turn-scoped by definition (Reckless Attack semantics);
  // attack-disadvantage is always-on. voidWhileIncapacitated effects (Dodge) lapse per the SRD.
  const activeEffects = (actor: LiveActor) => actor.effects.filter((effect) => !(effect.voidWhileIncapacitated && isIncapacitated(actor)));
  for (const effect of activeEffects(attacker)) {
    if (onOwnTurn && effect.modifiers.some((modifier) => modifier.type === "attack-advantage")) advantage.push({ source: effect.id, label: effect.name });
    if (effect.modifiers.some((modifier) => modifier.type === "attack-disadvantage")) disadvantage.push({ source: effect.id, label: effect.name });
  }
  for (const effect of activeEffects(target)) {
    if (effect.modifiers.some((modifier) => modifier.type === "incoming-attack-advantage")) advantage.push({ source: effect.id, label: `Target: ${effect.name}` });
    if (effect.modifiers.some((modifier) => modifier.type === "incoming-attack-disadvantage")) disadvantage.push({ source: effect.id, label: `Target: ${effect.name}` });
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
    const usedAsRanged = action.attack.rangeFeet !== undefined && distance !== null && distance > action.attack.reachFeet + 1e-6;
    const piercing = action.damage.some((part) => part.type === "piercing");
    if (!usedAsRanged && !piercing) disadvantage.push({ source: "underwater-melee", label: "Underwater (non-piercing melee)" });
  }

  // Ranged-attack penalties (SRD Range / Ranged Attacks in Close Combat), only when this shot is
  // actually ranged (a thrown weapon used within its reach stays melee) and distance is measurable.
  if (action.attack?.rangeFeet !== undefined && deps.distanceFeet) {
    const distance = deps.distanceFeet(attacker.id, target.id);
    const usingMelee = action.attack.reachFeet !== undefined && distance !== null && distance <= action.attack.reachFeet + 1e-6;
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
  const structuredWithoutTargets = (action.grants !== undefined && action.grants.target !== "target") || action.multiattack !== undefined || input.builtin === true;
  if (targets.length === 0 && !structuredWithoutTargets && action.grants?.target !== "target") throw new CommandRejectedError("Choose at least one target.");
  if (!action.attack && !action.save && action.damage.length === 0 && action.grants === undefined && input.builtin !== true) {
    if (action.multiattack === undefined) throw new CommandRejectedError("That action has no structured effect to resolve - run it from its description.");
  }

  const warnings: string[] = [];
  let { plan, overridden } = planEconomy(state, attacker, action, input, deps.definition, warnings, deps.distanceFeet);

  // GM-adjudicated cover (SRD Cover - no line-of-sight engine, so the GM supplies the call and the
  // server applies the math): total cover can't be targeted directly; half/three-quarters add to AC
  // and Dexterity saves below.
  const coverBonus = input.cover === "half" ? 2 : input.cover === "three-quarters" ? 5 : 0;
  if (input.cover === "total" && state.combat.rulesMode !== "freeform") {
    if (state.combat.rulesMode === "strict" && !input.override) throw new RulesBlockedError("cover.total", "The target has Total Cover and can't be targeted directly.");
    if (input.override && overridden === null) overridden = { rule: "cover.total", reason: input.override.reason };
    else warnings.push("The target has Total Cover - allowed per the rules mode.");
  }

  // Builtin Unarmed Strike: the attack math is actor-derived (SRD: Str modifier + Proficiency Bonus),
  // so the concrete attack is materialized at resolve time rather than declared in the catalog.
  if (input.builtin && action.id === "unarmed-strike") {
    action = { ...action, attack: { bonus: abilityModifier(deps.definition, "str") + (deps.definition?.proficiencyBonus ?? 0), reachFeet: 5 } };
  }

  // A hidden attacker's rolls stay GM-only; everyone else's fight in the open.
  const visibility = attacker.visibility === "gm-only" ? "gm-only" as const : "public" as const;
  const rollBase = { commandId: input.commandId, initiatorSessionId: deps.gmSessionId, initiatorLabel: attacker.name, actorId: attacker.id, visibility, createdAt: deps.now() };

  // Builtin check-roll actions (Hide vs DC 15; Influence/Search/Study with the GM adjudicating):
  // one d20 + the actor's ability modifier (stealth skill bonus when the import carries one),
  // recorded in the shared history like every other roll.
  let check: NonNullable<ActionResolution["check"]> | null = null;
  let hiddenGranted: ActionResolution["effectGranted"] = null;
  const effectsEnded: Array<{ actorId: string; actorName: string; name: string }> = [];
  const checkSpec = input.builtin ? BUILTIN_CHECKS[action.id] : undefined;
  if (checkSpec) {
    let modifier = abilityModifier(deps.definition, checkSpec.ability);
    if (checkSpec.skill) {
      const skillBonus = skillBonusFromExtension(deps.definition, checkSpec.skill);
      if (skillBonus !== null) modifier = skillBonus;
    }
    modifier += exhaustionPenalty(attacker);
    const resolution = resolveDice(parseDiceFormula(`1d20 ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`), deps.random);
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
    const resolution = resolveDice(parseDiceFormula(`1d20 ${modifier < 0 ? "-" : "+"} ${Math.abs(modifier)}`), deps.random);
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
  let rollMode: ActionResolution["rollMode"];
  let crit = false;
  if (action.attack && targets.length === 1) {
    const target = targets[0];
    const sources = attackRollSources(state, attacker, target, action, deps);
    const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
    const mode = input.rollMode ?? aggregated.mode;
    rollMode = input.rollMode
      ? { mode: input.rollMode, advantage: input.rollMode === "advantage" ? ["GM choice"] : [], disadvantage: input.rollMode === "disadvantage" ? ["GM choice"] : [] }
      : aggregated;
    // Exhaustion applies −2 × level to every D20 Test (SRD 5.2.1); explained as a warning line so the wire shape stays unchanged.
    const bonus = action.attack.bonus + exhaustionPenalty(attacker);
    if (exhaustionLevel(attacker) > 0) warnings.push(`Exhaustion ${exhaustionLevel(attacker)}: −${2 * exhaustionLevel(attacker)} to the attack roll.`);
    const die = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
    // A preview (or a hand-rolled/confirmed d20) supplies the natural roll; otherwise roll it. The die is
    // recorded on the preview or the legacy one-shot, but NOT on a confirm (which reuses the shown roll).
    const isPreview = input.commit === false;
    let naturalRoll: number;
    let attackTotal: number;
    if (input.attackNatural !== undefined) {
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
    crit = naturalRoll === 20;
    let outcome = naturalRoll === 20 ? "crit" as const
      : naturalRoll === 1 ? "fumble" as const
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
  // Builtin Unarmed Strike damage is flat (SRD: 1 + Str modifier Bludgeoning, no dice) - it rides
  // the explainable bonus-damage channel since the dice grammar has no zero-die formula.
  if (input.builtin && action.id === "unarmed-strike" && attack !== null && (attack.outcome === "crit" || attack.outcome === "hit")) {
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
  if (attack !== null && (attack.outcome === "crit" || attack.outcome === "hit") && state.combat.rulesMode !== "freeform" && deps.resolveDefinition) {
    const target = targets[0];
    const proposedParts = [
      ...damage.map((part) => ({ amount: part.total, type: part.type })),
      ...bonusDamage.map((part) => ({ amount: part.amount, type: part.type }))
    ].filter((part) => part.amount > 0);
    const proposedTotal = proposedParts.reduce((sum, part) => sum + part.amount, 0);
    const targetDefinition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    const declared = targetDefinition?.actions.find((candidate) => candidate.activation === "reaction" && candidate.reaction?.trigger === "hit-by-attack" && candidate.reaction.response === "half-damage");
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
  // A GM override of a per-turn-repeatable rule (economy, or positional range/reach) applies for the
  // rest of this creature's turn, so the next action/bonus/reaction/attack isn't re-blocked for the
  // same family. Cleared on turn advance with the rest of `turn`.
  if (overridden && (overridden.rule.startsWith("economy.") || overridden.rule.startsWith("range."))) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, rulesOverridden: true } };
  }
  if (plan.spendLegendary) {
    state.combat = { ...state.combat, legendaryUsed: { ...state.combat.legendaryUsed, [attacker.id]: (state.combat.legendaryUsed[attacker.id] ?? 0) + plan.spendLegendary.cost } };
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
    overridden,
    ...(reactionPrompts.length > 0 ? { reactionPrompts } : {}),
    ...(check ? { check } : {}),
    ...(effectsEnded.length > 0 ? { effectsEnded } : {})
  };
}

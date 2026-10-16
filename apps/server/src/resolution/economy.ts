import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { effectiveSlot } from "@vtt/rules-5e";
import { conditionLabel, incapacitatingCondition } from "../condition-rules.js";
import { hasEffectTag } from "../effects.js";
import { RulesBlockedError } from "../game-store.js";
import { isItemActionId, itemActionRest, TWO_HANDED_SUFFIX } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  rememberOverride,
  type RuleId
} from "../rules-families.js";
import { builtinHandlerFor } from "./builtins.js";
import { sizeRank, type DefinitionAction, type LiveActor, type ResolveContext, type ResolveInput } from "./context.js";

type RuleViolation = Readonly<{ rule: RuleId; message: string }>;

/** How this resolve settles the action economy once it succeeds. */
export type EconomyPlan = Readonly<{
  markAction: boolean;
  markBonus: boolean;
  markReaction: boolean;
  /** The compound-action components remaining after this resolve (null leaves no instance). */
  instance: Readonly<{ actorId: string; components: Record<string, number> }> | null;
  /** The same for a compound bonus action (Flurry of Blows). */
  bonusInstance: Readonly<{ actorId: string; components: Record<string, number> }> | null;
  /** Limited-use spend to record, keyed per scope. */
  spendUse: Readonly<{ key: string; per: "turn" | "encounter" | "long-rest" | "short-rest" | "recharge" }> | null;
  /** Legendary-action cost to add to the attacker's per-round pool (SRD Legendary Actions). */
  spendLegendary: Readonly<{ cost: number }> | null;
  /** Spell slot the action spends from the bearer's own pool (an item cast with `consumesSpellSlot`). */
  spendSpellSlot: Readonly<{ level: number }> | null;
}>;

type EconomyEvaluation = Readonly<{
  violations: readonly RuleViolation[];
  softViolations: readonly RuleViolation[];
  plan: EconomyPlan;
  proseMultiattack: boolean;
  /** Informational notes that surface as warnings regardless of mode (ambiguous multiattack membership). */
  notes: readonly string[];
}>;

/** What every economy check reads, and the lists they report into (in check order). */
type Evaluation = Readonly<{
  state: GameState;
  attacker: LiveActor;
  action: DefinitionAction;
  targetIds: readonly string[];
  siblings: ReadonlyArray<DefinitionAction>;
  /** The slot level the caster asked for; see `castSlotLevel`. */
  slotLevel: number | undefined;
  onOwnTurn: boolean;
  /** A prose-only Multiattack hides extra attacks from the engine, so action-slot violations degrade to warnings. */
  proseMultiattack: boolean;
  violations: RuleViolation[];
  softViolations: RuleViolation[];
  notes: string[];
}>;

/** The limit of the counter this action spends from: for a shared `uses.pool`, the largest limit any
 *  sibling in that pool and rest scope declares. Takes the effective siblings so item bonuses count. */
export function useLimitFor(siblings: ReadonlyArray<DefinitionAction>, action: DefinitionAction): number {
  const uses = action.uses;
  if (!uses) return 0;
  if (!uses.pool) return uses.limit;
  return siblings.reduce((limit, candidate) => {
    const sibling = candidate.uses;
    return sibling && sibling.pool === uses.pool && sibling.per === uses.per ? Math.max(limit, sibling.limit) : limit;
  }, uses.limit);
}

/** Pure rules evaluation for one action: every violated rule plus the economy plan a successful resolve
 *  would commit. Shared with the availability projection so they can't drift. Economy gating applies
 *  only on the attacker's own turn. */
export function evaluateActionEconomy(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  targetIds: readonly string[],
  definition: ActorDefinition | undefined,
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null,
  siblings: ReadonlyArray<DefinitionAction> = definition?.actions ?? [],
  slotLevel?: number
): EconomyEvaluation {
  const evaluation: Evaluation = {
    state,
    attacker,
    action,
    targetIds,
    siblings,
    slotLevel,
    onOwnTurn: state.combat.turnActorId === attacker.id,
    proseMultiattack: siblings.some((candidate) => candidate.untrackedMultiattack === true),
    violations: [],
    softViolations: [],
    notes: []
  };
  checkAbleToAct(evaluation);
  checkExtraAttackOpened(evaluation);
  checkLoading(evaluation);
  checkHands(evaluation);
  const spendUse = checkLimitedUse(evaluation);
  const slots = checkActionSlots(evaluation);
  const spendLegendary = checkLegendary(evaluation, definition);
  const spendSpellSlot = checkSpellSlot(evaluation);
  checkTargeting(evaluation, distanceFeet);
  return {
    violations: evaluation.violations,
    softViolations: evaluation.softViolations,
    plan: { ...slots, spendUse, spendLegendary, spendSpellSlot },
    proseMultiattack: evaluation.proseMultiattack,
    notes: evaluation.notes
  };
}

/** Incapacitation and 0 HP forbid all three activation kinds (SRD 2024 "Incapacitated"); a required
 *  effect (Frenzy needs Rage) must be active. */
function checkAbleToAct({ attacker, action, violations }: Evaluation): void {
  if (action.activation !== "other") {
    const incapacitating = incapacitatingCondition(attacker);
    if (incapacitating !== null)
      violations.push({
        rule: "condition.incapacitated",
        message: `${attacker.name} is ${conditionLabel(incapacitating)} and can't take actions, bonus actions, or reactions.`
      });
    // At 0 HP a creature is down and can't act. Keyed on hp, so a defeated monster with no condition is blocked too.
    else if (attacker.hp.current <= 0)
      violations.push({
        rule: "condition.down",
        message: `${attacker.name} is down (0 HP) and can't take actions, bonus actions, or reactions.`
      });
  }
  if (action.requiresEffectTag && !hasEffectTag(attacker, action.requiresEffectTag)) {
    violations.push({
      rule: "feature.requires-effect",
      message: `${action.name} requires an active ${conditionLabel(action.requiresEffectTag)} effect.`
    });
  }
}

/** An extra attack (SRD Light, Cleave) is owed only once the swing that opens it has happened this turn: an attack
 *  with a different Light weapon in the Attack action, or a melee hit with the Cleave weapon. */
function checkExtraAttackOpened({ state, attacker, action, violations }: Evaluation): void {
  const extra = action.extraAttack;
  if (!extra) return;
  const opened = state.combat.turn.extraAttacks;
  if (extra.kind === "light") {
    const swung = opened?.light?.actorId === attacker.id ? opened.light.itemIds : [];
    const pair = (attacker.inventory.find((item) => item.id === extra.itemId)?.quantity ?? 1) >= 2;
    // "A different Light weapon": another item, or the second of a pair.
    if (!swung.some((itemId) => itemId !== extra.itemId || pair))
      violations.push({
        rule: "attack.light-needs-attack",
        message: `${action.name} follows an attack with a different Light weapon in the Attack action this turn.`
      });
    return;
  }
  const cleave = opened?.cleave;
  if (!cleave || cleave.actorId !== attacker.id || cleave.itemId !== extra.itemId)
    violations.push({
      rule: "attack.cleave-needs-hit",
      message: `${action.name} follows a melee hit with this weapon this turn.`
    });
}

/** The inventory row a weapon swing is made with (`item-<id>`, or a Versatile weapon's `item-<id>-two-handed`), or
 *  null for any other action. */
function swingItemOf(attacker: LiveActor, action: DefinitionAction) {
  if (!isItemActionId(action.id)) return null;
  const rest = itemActionRest(action.id);
  return (
    attacker.inventory.find(
      (item) => item.weapon !== undefined && (item.id === rest || `${item.id}-${TWO_HANDED_SUFFIX}` === rest)
    ) ?? null
  );
}

/** SRD: a Two-Handed weapon "requires two hands when you attack with it", and a Shield is strapped to one arm. Read
 *  from the row, since a magic shield's slot travels on its marker. The Lance's "unless mounted" is the GM's call. */
function checkHands({ attacker, action, violations }: Evaluation): void {
  const item = swingItemOf(attacker, action);
  if (!item) return;
  const twoHands =
    item.weapon?.properties?.includes("two-handed") === true ||
    itemActionRest(action.id) === `${item.id}-${TWO_HANDED_SUFFIX}`;
  if (!twoHands) return;
  const shield = attacker.inventory.find(
    (entry) =>
      entry.equipped &&
      entry.quantity > 0 &&
      entry.armor !== undefined &&
      effectiveSlot({ slot: entry.magic?.slot, category: entry.category }) === "shield"
  );
  if (shield)
    violations.push({
      rule: "attack.two-handed",
      message: `${item.name} needs two hands, and ${attacker.name} has ${shield.name} on one arm. Unequip the shield first.`
    });
}

/** SRD Loading: "You can fire only one piece of ammunition from a Loading weapon when you use an action ... to fire
 *  it, regardless of the number of attacks you can normally make." Extra Attack's other swings stay open for
 *  another weapon. */
function checkLoading({ state, attacker, action, onOwnTurn, violations }: Evaluation): void {
  if (!onOwnTurn || action.activation !== "action") return;
  const item = swingItemOf(attacker, action);
  if (!item?.weapon?.properties?.includes("loading")) return;
  const fired = state.combat.turn.extraAttacks?.loading;
  if (fired?.actorId === attacker.id && fired.itemIds.includes(item.id))
    violations.push({
      rule: "attack.loading",
      message: `${action.name} has the Loading property: it fires once per action. Use another weapon for the remaining attacks.`
    });
}

const USE_SCOPE_LABELS: Readonly<Record<"turn" | "encounter" | "short-rest" | "long-rest", string>> = {
  turn: "turn",
  encounter: "encounter",
  "short-rest": "short rest",
  "long-rest": "long rest"
};

function checkLimitedUse({ state, attacker, action, siblings, violations }: Evaluation): EconomyPlan["spendUse"] {
  if (!action.uses) return null;
  const uses = action.uses;
  const key = uses.pool ?? action.id;
  // The counter is keyed on the pool, so the gate is the pool's size (see `useLimitFor`).
  const limit = useLimitFor(siblings, action);
  const spent =
    uses.per === "turn" ? (state.combat.turn.turnUses[`${attacker.id}:${key}`] ?? 0) : (attacker.actionUses[key] ?? 0);
  if (spent >= limit) violations.push({ rule: "feature.no-uses-remaining", message: noUsesRemaining(action, limit) });
  return { key, per: uses.per };
}

/** Why a limited-use action is refused, in and out of a fight. */
export function noUsesRemaining(action: DefinitionAction, limit: number): string {
  const uses = action.uses!;
  return `${action.name}: no uses remaining (${
    uses.per === "recharge"
      ? `spent - recharges on ${uses.recharge}+ at the start of its turn`
      : `${limit}/${USE_SCOPE_LABELS[uses.per]}`
  }).`;
}

/** The action-slot multiattack parents (sibling actions) that list `action` as a component. A bonus-action plan
 *  (Flurry of Blows) is not one: its strikes come from the bonus instance, never from an Attack action. */
function multiattackParents(siblings: ReadonlyArray<DefinitionAction>, action: DefinitionAction): DefinitionAction[] {
  return siblings.filter(
    (candidate) =>
      candidate.activation !== "bonus-action" &&
      (candidate.multiattack?.some((component) => component.actionId === action.id) ?? false)
  );
}

function componentMap(parent: DefinitionAction): Record<string, number> {
  const components: Record<string, number> = {};
  for (const entry of parent.multiattack ?? [])
    components[entry.actionId] = (components[entry.actionId] ?? 0) + entry.count;
  return components;
}

type SlotPlan = Pick<EconomyPlan, "markAction" | "markBonus" | "markReaction" | "instance" | "bonusInstance">;

/** The action, bonus action and reaction slots, with the compound instance an action or bonus action opens or
 *  continues. */
function checkActionSlots(evaluation: Evaluation): SlotPlan {
  const { state, attacker, action, onOwnTurn, violations } = evaluation;
  const unchanged: SlotPlan = {
    markAction: false,
    markBonus: false,
    markReaction: false,
    instance: state.combat.turn.actionInstance,
    bonusInstance: state.combat.turn.bonusActionInstance
  };
  // An open compound bonus action (Flurry of Blows) spends its own strikes first, costing no further slot.
  const bonusOpen = state.combat.turn.bonusActionInstance;
  if (onOwnTurn && bonusOpen && bonusOpen.actorId === attacker.id && !action.multiattack) {
    const components = { ...bonusOpen.components };
    const key =
      (components[action.id] ?? 0) > 0 ? action.id : action.attack && (components.attack ?? 0) > 0 ? "attack" : null;
    if (key) {
      components[key] -= 1;
      return { ...unchanged, bonusInstance: { actorId: attacker.id, components } };
    }
  }
  if (onOwnTurn && action.activation === "bonus-action") {
    if (state.combat.turn.bonusActionUsed)
      violations.push({
        rule: "economy.bonus-action-used",
        message: `${attacker.name} has already used a bonus action this turn.`
      });
    // A compound bonus action opens its plan, which later swings spend (no rolls are consumed opening it).
    return {
      ...unchanged,
      markBonus: true,
      ...(action.multiattack ? { bonusInstance: { actorId: attacker.id, components: componentMap(action) } } : {})
    };
  }
  if (onOwnTurn && action.activation === "action") return checkActionSlot(evaluation);
  if (action.activation === "reaction") {
    if (state.combat.reactionsUsed.includes(attacker.id))
      violations.push({
        rule: "economy.reaction-used",
        message: `${attacker.name} has already used a reaction this round.`
      });
    return { ...unchanged, markReaction: true };
  }
  return unchanged;
}

function checkActionSlot({
  state,
  attacker,
  action,
  siblings,
  proseMultiattack,
  violations,
  softViolations,
  notes
}: Evaluation): SlotPlan {
  const slotViolations = proseMultiattack ? softViolations : violations;
  const current = state.combat.turn.actionInstance;
  const active = current && current.actorId === attacker.id ? current : null;
  if (!state.combat.turn.actionUsed) {
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
    // The instance stays even when exhausted so a further resolve gets "no attacks remaining".
    return {
      markAction: true,
      markBonus: false,
      markReaction: false,
      instance: components ? { actorId: attacker.id, components } : null,
      bonusInstance: state.combat.turn.bonusActionInstance
    };
  }
  const plan = {
    markAction: false,
    markBonus: false,
    markReaction: false,
    bonusInstance: state.combat.turn.bonusActionInstance
  };
  if (!active) {
    slotViolations.push({
      rule: "economy.action-used",
      message: `${attacker.name} has already used an action this turn.`
    });
    return { ...plan, instance: current };
  }
  const components = { ...active.components };
  const componentName = (id: string) =>
    id === "attack" ? "attack" : (siblings.find((candidate) => candidate.id === id)?.name ?? id);
  const leftovers = () =>
    Object.entries(components)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => `${count}× ${componentName(id)}`);
  if (action.multiattack) {
    // Tapping the Multiattack plan mid-instance is a continue, not a violation.
    if (leftovers().length === 0)
      slotViolations.push({
        rule: "economy.action-used",
        message: `${attacker.name} has no attacks remaining in this action.`
      });
  } else if ((components[action.id] ?? 0) > 0) {
    components[action.id] -= 1;
  } else if (action.attack && (components["attack"] ?? 0) > 0) {
    components["attack"] -= 1;
  } else {
    const named = leftovers();
    slotViolations.push({
      rule: "economy.action-used",
      message:
        named.length > 0
          ? `${attacker.name} has no ${action.name} left in this action - remaining: ${named.join(", ")}.`
          : `${attacker.name} has no attacks remaining in this action.`
    });
  }
  return { ...plan, instance: { actorId: attacker.id, components } };
}

/** SRD Legendary Actions: taken at the end of other creatures' turns from a per-round pool that refills
 *  on the creature's own turn. Pool size defaults to 3. */
function checkLegendary(
  { state, attacker, action, onOwnTurn, violations }: Evaluation,
  definition: ActorDefinition | undefined
): EconomyPlan["spendLegendary"] {
  if (!action.legendary) return null;
  const cost = action.legendary.cost;
  const perRound = definition?.legendary?.actionsPerRound ?? 3;
  const spent = state.combat.legendaryUsed[attacker.id] ?? 0;
  if (onOwnTurn)
    violations.push({
      rule: "legendary.own-turn",
      message: `Legendary actions are taken on other creatures' turns - not on ${attacker.name}'s own.`
    });
  if (spent + cost > perRound)
    violations.push({
      rule: "legendary.no-actions-remaining",
      message: `${attacker.name} has ${Math.max(0, perRound - spent)} of ${perRound} legendary action${perRound === 1 ? "" : "s"} left this round${cost > 1 ? ` and ${action.name} costs ${cost}` : ""}.`
    });
  return { cost };
}

/** A spell cast with a slot (a prepared spell, or an item cast with `consumesSpellSlot`) spends one from the
 *  caster's own pool at `castSlotLevel`; refused here if none remains or the slot is below the spell. */
function checkSpellSlot({ attacker, action, slotLevel, violations }: Evaluation): EconomyPlan["spendSpellSlot"] {
  if (!action.spellSlot) return null;
  const level = castSlotLevel(attacker, action.spellSlot.level, slotLevel);
  const slot = attacker.spellSlots?.find((entry) => entry.level === level);
  if (level < action.spellSlot.level)
    violations.push({
      rule: "feature.no-spell-slot",
      message: `${action.name} needs a slot of level ${action.spellSlot.level} or higher.`
    });
  else if (!slot || slot.remaining <= 0) {
    violations.push({
      rule: "feature.no-spell-slot",
      message: `${action.name} spends a level-${level} spell slot - ${attacker.name} has none left.`
    });
  }
  return { level };
}

/** The slot level a cast spends: the one asked for; else the spell's own level when a slot is left there; else the
 *  lowest above it with one left (a Warlock's Pact Magic slots are all one level). */
export function castSlotLevel(
  attacker: Pick<LiveActor, "spellSlots">,
  base: number,
  requested: number | undefined
): number {
  if (requested !== undefined) return requested;
  const open = (attacker.spellSlots ?? [])
    .filter((slot) => slot.level >= base && slot.remaining > 0)
    .map((slot) => slot.level)
    .sort((left, right) => left - right);
  return open[0] ?? base;
}

/** Who and what this action may target: declared target rules, range and reach, size limits and Charmed. */
function checkTargeting(
  evaluation: Evaluation,
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined
): void {
  const { state, attacker, action, targetIds, violations } = evaluation;
  const targets = targetIds.flatMap((targetId) => {
    const target = state.actors.find((candidate) => candidate.id === targetId);
    return target ? [target] : [];
  });

  // Targeting restrictions the definition declares (Tail can't target the creature this crocodile grapples).
  if (action.targetRules?.includes("not-grappled-by-source")) {
    for (const target of targets) {
      if (target.effects.some((effect) => effect.sourceActorId === attacker.id && effect.tags.includes("grapple"))) {
        violations.push({
          rule: "target.grappled-by-source",
          message: `${target.name} is grappled by ${attacker.name} and can't be targeted by ${action.name}.`
        });
      }
    }
  }

  if (action.attack !== undefined && distanceFeet !== undefined) checkRange(evaluation, distanceFeet);

  // Cleave (SRD): a second creature, within 5 feet of the first (when the map can tell).
  const first = action.extraAttack?.kind === "cleave" ? state.combat.turn.extraAttacks?.cleave : null;
  if (first && first.actorId === attacker.id) {
    for (const target of targets) {
      if (target.id === first.targetId) {
        violations.push({
          rule: "attack.cleave-same-target",
          message: `Cleave swings at another target, not ${target.name} again.`
        });
        continue;
      }
      const apart = distanceFeet?.(first.targetId, target.id) ?? null;
      if (apart !== null && apart > 5 + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "attack.cleave-too-far",
          message: `${target.name} is ${Math.round(apart * 10) / 10} ft from the target Cleave follows; it must be within 5 feet of it.`
        });
    }
  }

  // Unarmed grapple/shove only work on targets at most one size larger (SRD Unarmed Strike).
  if (builtinHandlerFor(action.id)?.atMostOneSizeLarger) {
    for (const target of targets) {
      if (sizeRank(target.size) > sizeRank(attacker.size) + 1) {
        violations.push({
          rule: "target.too-large-to-grapple",
          message: `${target.name} is more than one size larger than ${attacker.name} and can't be grappled or shoved.`
        });
      }
    }
  }

  // SRD Charmed: can't attack or harm the charmer. Enforceable only when the condition rides a
  // source-linked effect naming the charmer.
  if (action.attack !== undefined || action.save !== undefined || action.damage.length > 0) {
    const charmers = attacker.effects.filter(
      (effect) => effect.linkedConditionIds.includes("charmed") && effect.sourceActorId !== null
    );
    for (const targetId of targetIds) {
      const charmer = charmers.find((effect) => effect.sourceActorId === targetId);
      if (charmer) {
        const target = state.actors.find((candidate) => candidate.id === targetId);
        violations.push({
          rule: "condition.charmed-charmer",
          message: `${attacker.name} is Charmed by ${target?.name ?? charmer.sourceName ?? "its charmer"} and can't target them with harmful effects.`
        });
      }
    }
  }
}

/** Range/reach (SRD): checked only when distance is measurable. A thrown weapon is legal in either
 *  envelope; long-range disadvantage lives in the attack roll's sources. */
function checkRange(
  { state, attacker, action, targetIds, violations }: Evaluation,
  distanceFeet: (actorIdA: string, actorIdB: string) => number | null
): void {
  const attackReach = action.attack!.reachFeet;
  const attackRange = action.attack!.rangeFeet;
  for (const targetId of targetIds) {
    const distance = distanceFeet(attacker.id, targetId);
    if (distance === null) continue;
    const targetName = state.actors.find((candidate) => candidate.id === targetId)?.name ?? "The target";
    const withinReach = attackReach !== undefined && distance <= attackReach + DISTANCE_TOLERANCE_FEET;
    const rounded = Math.round(distance * 10) / 10;
    if (withinReach) continue;
    if (attackRange !== undefined) {
      if (distance > attackRange + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "range.out-of-range",
          message: `${targetName} is ${rounded} ft away, beyond the ${attackRange} ft maximum range.`
        });
      // SRD Underwater Combat: a ranged attack automatically misses beyond normal range.
      else if (state.combat.underwater) {
        const normal = action.attack!.rangeNormalFeet ?? attackRange;
        if (distance > normal + DISTANCE_TOLERANCE_FEET)
          violations.push({
            rule: "range.underwater",
            message: `${targetName} is ${rounded} ft away; underwater, ranged attacks automatically miss beyond normal range (${normal} ft).`
          });
      }
    } else {
      const reach = attackReach ?? 5;
      if (distance > reach + DISTANCE_TOLERANCE_FEET)
        violations.push({
          rule: "range.out-of-reach",
          message: `${targetName} is ${rounded} ft away, beyond ${attacker.name}'s ${reach} ft reach.`
        });
    }
  }
}

/** Validates against the rules mode and plans the economy commitment (ADR-0020): strict rejects with an
 *  override path, assisted warns, freeform skips. An override waives only the families it names. */
export function planEconomy(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  input: ResolveInput,
  definition: ActorDefinition | undefined,
  warnings: string[],
  distanceFeet: ((actorIdA: string, actorIdB: string) => number | null) | undefined,
  siblings: ReadonlyArray<DefinitionAction>
): { plan: EconomyPlan; overridden: { rule: RuleId; reason: string } | null } {
  const { violations, softViolations, plan, proseMultiattack, notes } = evaluateActionEconomy(
    state,
    attacker,
    action,
    input.targetIds,
    definition,
    distanceFeet,
    siblings,
    input.slotLevel
  );
  warnings.push(...notes);

  // The mode is per rule family: a violation whose family is Off is not a violation for this table.
  const policed = [...violations, ...softViolations].filter(
    (violation) => effectiveModeFor(state.combat, violation.rule) !== "freeform"
  );
  if (policed.length === 0) return { plan, overridden: null };
  // This command's override, or a GM override earlier this turn, covers its families; other families still
  // block or warn.
  const waived = policed.find((violation) => overrideWaives(input.override, violation.rule));
  const covered = (rule: RuleId) => overrideWaives(input.override, rule) || overrideCovers(state.combat.turn, rule);
  const blocking = violations.filter(
    (violation) => !covered(violation.rule) && effectiveModeFor(state.combat, violation.rule) === "strict"
  );
  if (blocking.length > 0) throw new RulesBlockedError(blocking[0].rule, blocking[0].message);
  warnings.push(...policed.filter((violation) => !covered(violation.rule)).map((violation) => violation.message));
  if (proseMultiattack && softViolations.some((violation) => !covered(violation.rule)))
    warnings.push(`${attacker.name}'s Multiattack is prose-only - extra attacks aren't validated.`);
  return { plan, overridden: waived ? { rule: waived.rule, reason: overrideReason(input.override) } : null };
}

/** Commits the validated economy plan (ADR-0020): slots, compound instance, limited uses, legendary
 *  actions and spell slots. A GM override covers its rule family for the rest of this creature's turn. */
export function commitEconomy({
  state,
  attacker,
  input,
  plan,
  overridden
}: Pick<ResolveContext, "state" | "attacker" | "plan" | "overridden"> & {
  input: Pick<ResolveInput, "override">;
}): void {
  const instance = plan.instance
    ? { actorId: plan.instance.actorId, components: { ...plan.instance.components } }
    : null;
  if (plan.markAction || plan.markBonus) {
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        actionUsed: state.combat.turn.actionUsed || plan.markAction,
        bonusActionUsed: state.combat.turn.bonusActionUsed || plan.markBonus,
        actionInstance: instance
      }
    };
  } else if (plan.instance !== state.combat.turn.actionInstance) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionInstance: instance } };
  }
  if (plan.bonusInstance !== state.combat.turn.bonusActionInstance) {
    const bonusInstance = plan.bonusInstance
      ? { actorId: plan.bonusInstance.actorId, components: { ...plan.bonusInstance.components } }
      : null;
    state.combat = { ...state.combat, turn: { ...state.combat.turn, bonusActionInstance: bonusInstance } };
  }
  if (plan.markReaction) {
    state.combat = {
      ...state.combat,
      reactionsUsed: [...state.combat.reactionsUsed.filter((id) => id !== attacker.id), attacker.id]
    };
  }
  // Cleared on turn advance.
  if (overridden) rememberOverride(state, overridden.rule, input.override);
  if (plan.spendLegendary) {
    state.combat = {
      ...state.combat,
      legendaryUsed: {
        ...state.combat.legendaryUsed,
        [attacker.id]: (state.combat.legendaryUsed[attacker.id] ?? 0) + plan.spendLegendary.cost
      }
    };
  }
  if (plan.spendSpellSlot) {
    const level = plan.spendSpellSlot.level;
    // Clamped at zero: an override spends what is there rather than going into debt.
    attacker.spellSlots = (attacker.spellSlots ?? []).map((entry) =>
      entry.level === level ? { ...entry, remaining: Math.max(0, entry.remaining - 1) } : entry
    );
  }
  if (plan.spendUse) {
    if (plan.spendUse.per === "turn") {
      const key = `${attacker.id}:${plan.spendUse.key}`;
      state.combat = {
        ...state.combat,
        turn: {
          ...state.combat.turn,
          turnUses: { ...state.combat.turn.turnUses, [key]: (state.combat.turn.turnUses[key] ?? 0) + 1 }
        }
      };
    } else {
      attacker.actionUses = {
        ...attacker.actionUses,
        [plan.spendUse.key]: (attacker.actionUses[plan.spendUse.key] ?? 0) + 1
      };
    }
  }
}

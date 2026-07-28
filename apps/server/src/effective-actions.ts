import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { collectRiders, sumRiders } from "@vtt/rules-5e";
import { deriveEquipment, sourceItemOf, type EquipmentCatalog, type EquipmentDerivation } from "./equipment-derivation.js";

/**
 * THE action list every actor-scoped consumer must read instead of `definition.actions`.
 *
 * `definition.actions` is the immutable base. `effectiveActions` layers the live loadout on top:
 * the derived weapon/charged/cast actions the equipped items add, and the STANDING riders folded
 * into the numbers the resolver reads verbatim (`attack.bonus`, `save.dc`, `uses.limit`,
 * `attack.criticalBonusDice`, `attack.critical-range`). Nothing is written back to the definition,
 * so unequipping the item simply makes the next call return the base numbers again.
 *
 * ONLY the standing pass is folded here. Riders that name a moment (`on-critical-hit`,
 * `on-attack-roll` + `attack-kind-is`) belong to the roll path and are collected there, at that
 * moment. The two sets are disjoint by construction - `collectRiders(…, {moment: null})` excludes
 * anything carrying a moment or a filter - so a rider can never be counted twice.
 *
 * THE SWEEP. Reading `definition.actions` in an actor-scoped context is now a bug. The verified
 * server-side sites, all converted:
 *
 *   game-operations.ts  the `action:resolve` lookup, the availability builtin dedupe, availability
 *   rests.ts            the short-rest / recharge re-arm  - MISS THIS AND CHARGES NEVER COME BACK
 *   encounter.ts        the per-encounter pool clear, and the start-of-turn recharge rolls
 *   action-resolution.ts useLimitFor, multiattackParents, proseMultiattack, componentName,
 *                       and the TARGET's declared reaction (an item-granted Uncanny Dodge)
 *   reactions.ts        the declared reaction lookup, and `fallbackMelee` - an item weapon must be
 *                       findable here or the opportunity attack swings an unarmed strike
 *   movement-rules.ts   the ENEMY's reach when deciding whether to prompt an opportunity attack
 *
 * `content-library.ts`'s `monsterActionSummaries` is correctly excluded: it is a bestiary browse
 * with no actor in hand.
 */
export function effectiveActions(definition: ActorDefinition | undefined, actor: Actor | undefined, catalog: EquipmentCatalog | undefined): readonly ActorAction[] {
  const base = definition?.actions ?? [];
  if (!actor || !catalog) return base;
  const derivation = deriveEquipment(actor, definition, catalog);
  if (derivation.carriers.length === 0 && derivation.actions.length === 0) return base;
  return [...base, ...derivation.actions].map((action) => withStandingRiders(action, derivation, actor));
}

/** Fold the standing riders that apply to ONE action into the numbers the resolver reads. */
export function withStandingRiders(action: ActorAction, derivation: EquipmentDerivation, actor: Actor): ActorAction {
  const sourceItemId = sourceItemOf(action, derivation, actor.inventory);
  const riders = collectRiders(derivation.carriers, { ...derivation.context, moment: null, sourceItemId });
  if (riders.length === 0) return action;

  const attackBonus = sumRiders(riders, "attack-bonus");
  const critDice = sumRiders(riders, "critical-bonus-dice") || riders.reduce((total, rider) => rider.modifier.type === "critical-bonus-dice" ? total + (rider.modifier.count ?? 0) : total, 0);
  const saveDc = sumRiders(riders, "spell-save-dc");
  const poolBonus = usesBonus(action, riders);
  if (attackBonus === 0 && critDice === 0 && saveDc === 0 && poolBonus === 0) return action;

  return {
    ...action,
    ...(action.attack && (attackBonus !== 0 || critDice !== 0)
      ? { attack: {
          ...action.attack,
          bonus: action.attack.bonus + attackBonus,
          // `criticalBonusDice` is schema-bounded 1-4; a rider must not push it out of range.
          ...(critDice !== 0 ? { criticalBonusDice: Math.max(1, Math.min(4, (action.attack.criticalBonusDice ?? 0) + critDice)) } : {})
        } }
      : {}),
    ...(action.save && saveDc !== 0 ? { save: { ...action.save, dc: Math.max(1, Math.min(40, action.save.dc + saveDc)) } } : {}),
    ...(action.uses && poolBonus !== 0 ? { uses: { ...action.uses, limit: Math.max(1, Math.min(20, action.uses.limit + poolBonus)) } } : {})
  };
}

/**
 * Criterion 6: "+1 use of Lay on Hands". `poolId` is the `actor.actionUses` KEY - `uses.pool ??
 * action.id` - which is the namespace the engine actually spends from and re-arms, deliberately NOT
 * `ClassLevelRow.classResources` (display-only content data with zero server reads: a rider pointed
 * at it would parse, store, project and change nothing).
 */
function usesBonus(action: ActorAction, riders: ReturnType<typeof collectRiders>): number {
  if (!action.uses) return 0;
  const key = action.uses.pool ?? action.id;
  return riders.reduce((total, rider) => rider.modifier.type === "resource-bonus" && rider.modifier.poolId === key ? total + (rider.modifier.amount ?? 0) : total, 0);
}

/** The natural-d20 threshold at or above which an attack crits (SRD 20; a rider can widen it). */
export function criticalThreshold(derivation: EquipmentDerivation, actor: Actor, action: ActorAction): number {
  const sourceItemId = sourceItemOf(action, derivation, actor.inventory);
  const riders = collectRiders(derivation.carriers, { ...derivation.context, moment: null, sourceItemId });
  return riders.reduce((lowest, rider) => rider.modifier.type === "critical-range" && rider.modifier.threshold !== undefined
    ? Math.min(lowest, Math.max(15, rider.modifier.threshold)) : lowest, 20);
}

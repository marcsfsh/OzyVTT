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
  const damageBonus = sumRiders(riders, "damage-bonus");
  const critDice = sumRiders(riders, "critical-bonus-dice") || riders.reduce((total, rider) => rider.modifier.type === "critical-bonus-dice" ? total + (rider.modifier.count ?? 0) : total, 0);
  const saveDc = sumRiders(riders, "spell-save-dc");
  const poolBonus = usesBonus(action, riders);
  const extraAttacks = extraAttacksFor(action, derivation, riders);
  if (attackBonus === 0 && damageBonus === 0 && critDice === 0 && saveDc === 0 && poolBonus === 0 && extraAttacks === 0) return action;

  return {
    ...action,
    ...(action.attack && (attackBonus !== 0 || critDice !== 0 || extraAttacks !== 0)
      ? { attack: {
          ...action.attack,
          bonus: action.attack.bonus + attackBonus,
          // `attack.count` is what `action-resolution.ts` turns into the generic `{ attack: n-1 }`
          // component pool, which is why raising it here is the whole of Extra Attack: the second
          // swing may legally be a DIFFERENT weapon, and a generic pool is exactly that rule.
          ...(extraAttacks !== 0 ? { count: Math.max(1, Math.min(10, (action.attack.count ?? 1) + extraAttacks)) } : {}),
          // `criticalBonusDice` is schema-bounded 1-4; a rider must not push it out of range.
          ...(critDice !== 0 ? { criticalBonusDice: Math.max(1, Math.min(4, (action.attack.criticalBonusDice ?? 0) + critDice)) } : {})
        } }
      : {}),
    ...(action.save && saveDc !== 0 ? { save: { ...action.save, dc: Math.max(1, Math.min(40, action.save.dc + saveDc)) } } : {}),
    ...(action.uses && poolBonus !== 0 ? { uses: { ...action.uses, limit: Math.max(1, Math.min(20, action.uses.limit + poolBonus)) } } : {}),
    // A standing `damage-bonus` (the "+1" of a +1 weapon) folds into the FIRST damage part's printed
    // formula - the same treatment `attack-bonus` gets three lines up, so the sheet, the roll and the
    // resolver all read one number. The constant rides the formula (never crit-doubled - 5e doubles
    // dice, and `criticalExpression` doubles only dice terms). Moment-gated damage-bonus riders are
    // NOT here (moment: null collection) - action-resolution.ts lands those as their own labelled
    // line at the moment they name.
    ...(action.damage.length > 0 && damageBonus !== 0
      ? { damage: action.damage.map((part, index) => index === 0 ? { ...part, formula: withFlatBonus(part.formula, damageBonus) } : part) }
      : {})
  };
}

/** Fold a flat bonus into a dice formula's trailing constant: "2d6 + 1" + 1 = "2d6 + 2", "1d4" + 1
    = "1d4 + 1", "1d8 + 1" - 1 = "1d8". The formula grammar here is the derivation's own output
    (`<dice> ± <constant>`), so a trailing signed integer is the whole of what can appear. */
function withFlatBonus(formula: string, bonus: number): string {
  const tail = /\s*([+-])\s*(\d+)\s*$/.exec(formula);
  const constant = tail ? (tail[1] === "-" ? -Number(tail[2]) : Number(tail[2])) : 0;
  const base = tail ? formula.slice(0, tail.index).trim() : formula.trim();
  const next = constant + bonus;
  if (next === 0) return base;
  return `${base} ${next > 0 ? "+" : "-"} ${Math.abs(next)}`;
}

/**
 * EXTRA ATTACK, at the only place it can possibly work.
 *
 * The rider was baked into the definition at build time for a year and reached NOTHING: the builder
 * raised `attack.count` on the actions a feature declares, and Fighter, Barbarian, Monk, Ranger and
 * Paladin declare none - their swings are derived from equipped inventory. Both halves of that gap
 * are closed here: `extra-attack` left `BUILDER_BAKED_MODIFIER_TYPES` (so a feature carrier now hands
 * it to `collectRiders` like any other standing rider), and this is the consumer.
 *
 * SCOPED TO WEAPON SWINGS, and that scope is load-bearing. The SRD grants the extra attack "whenever
 * you take the Attack action", so it must NOT multiply a wand's cast or an item action that merely
 * rolls to hit. `derivation.weaponActionIds` is the list `deriveEquipment` built from the equipped
 * weapons themselves, so the test is an identity check rather than a shape guess.
 *
 * A DEFINITION action that already declares its own `count` is left alone: a stat block that prints
 * "Multiattack: two claws" has said its number, and a monster does not hold class features anyway.
 *
 * MAX, NOT SUM. The Fighter's three riders are cumulative in the SRD's prose but absolute in their
 * counts - `extra-attack` is +1, `two-extra-attacks` is +2, `three-extra-attacks` is +3, each naming
 * the TOTAL extra swings at that tier. Today the class grants only the newest, so a sum would agree
 * by luck; the day a level row grants two of them (or a multiclass Fighter 11 / Ranger 5 holds both
 * the class's +2 and the Ranger's +1) a sum would silently hand out five attacks. `Math.max` is the
 * SRD's own rule for this: Extra Attack from two sources does not stack.
 */
function extraAttacksFor(action: ActorAction, derivation: EquipmentDerivation, riders: ReturnType<typeof collectRiders>): number {
  if (!action.attack || !derivation.weaponActionIds.includes(action.id)) return 0;
  return riders.reduce((most, rider) => rider.modifier.type === "extra-attack"
    ? Math.max(most, rider.modifier.count ?? 0) : most, 0);
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

/**
 * THE SHEET'S LIMITED-USE POOLS, as one flat list keyed by the counter the engine actually spends.
 *
 * `actor.actionUses` is a bare `Record<string, number>` of SPENT counts, and nothing on the wire ever
 * said what those keys were called or how high they went - so a client could show "3" and had no way
 * to know whether that was three of three or three of five, or that "channel-divinity" is the pool
 * two differently-named actions share. This is the missing half, and it is derived rather than
 * stored: no new state, nothing to migrate, nothing to keep in sync.
 *
 * `id` is EXACTLY `uses.pool ?? action.id` - the same key `useLimitFor` gates on, `usesBonus` raises,
 * `rests.ts` and `encounter.ts` re-arm, and `actionUses` is indexed by. Not a new namespace, and
 * deliberately not `ClassLevelRow.classResources`, which is a printed column (see its own note).
 *
 * `limit` is the max over the members sharing the pool AND the rest scope, which is `useLimitFor`'s
 * rule restated over the whole list rather than one action at a time: a Cleric 3's Channel Divinity
 * is 2, not the "1" printed on Preserve Life.
 *
 * `name` is the same-id action's when there is one (Second Wind, Action Surge), and otherwise the
 * slug title-cased - which is what a shared pool's own name always is, because the members are named
 * after the pool ("Channel Divinity: Turn Undead" shares "channel-divinity").
 *
 * TAKES AN ACTION LIST, so a caller holding the EFFECTIVE list gets item-raised limits and a caller
 * holding only the stored sheet gets the sheet's own. The player projection is the second: it has no
 * content catalog and must stay a pure function of GameState.
 */
export function actionPools(actions: readonly ActorAction[]): Array<{ id: string; name: string; limit: number; per: string }> {
  const pools = new Map<string, { id: string; name: string; limit: number; per: string }>();
  for (const action of actions) {
    if (!action.uses) continue;
    const id = action.uses.pool ?? action.id;
    const existing = pools.get(id);
    if (!existing) {
      pools.set(id, { id, name: action.id === id ? action.name : titleCase(id), limit: action.uses.limit, per: action.uses.per });
      continue;
    }
    // Same rule as `useLimitFor`: only a sibling in the same REST SCOPE raises the ceiling.
    if (existing.per === action.uses.per) existing.limit = Math.max(existing.limit, action.uses.limit);
    // A later action whose own id IS the pool key names it better than the derived title.
    if (action.id === id) existing.name = action.name;
  }
  return [...pools.values()];
}

const titleCase = (slug: string): string =>
  slug.split("-").filter(Boolean).map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");

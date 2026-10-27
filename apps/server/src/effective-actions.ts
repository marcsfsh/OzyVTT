import { picksFor, potentRangeFeet, potentVitality } from "./class-features.js";
import type { Actor } from "@vtt/domain";
import { MAX_ACTION_USES, type ActorAction, type ActorDefinition } from "@vtt/schemas";
import { abilityModifier, collectRiders, sumRiders, type RiderContext } from "@vtt/rules-5e";
import { withEmpoweredStrikes, withTakenActions } from "./builtin-actions.js";
import { atSpellUpLevel } from "./lasting-spells.js";
import {
  deriveEquipment,
  sourceItemOf,
  type EquipmentCatalog,
  type EquipmentDerivation
} from "./equipment-derivation.js";
import { spellbookRituals } from "./ritual-adept.js";
import { spellClassOf } from "./class-features.js";
import { grantedItemActions, grantedSpellActions } from "./granted-actions.js";
import { storedCastActions } from "./stored-casts.js";
import { divineInterventionCasts } from "./divine-intervention.js";
import { withHeadCount } from "./death-traits.js";
import { withPactWeaponAttacks } from "./pact-weapon.js";

/** The action list every actor-scoped consumer must read in place of `definition.actions`: item-derived
 *  actions plus standing riders (items, feats, features, live effects) folded into the numbers the resolver
 *  reads, and the effects of a row that takes two generic actions at once (`withTakenActions`). Nothing is written
 *  back. Moment-gated riders are collected on the roll path instead (the two sets are disjoint). */
export function effectiveActions(
  definition: ActorDefinition | undefined,
  actor: Actor | undefined,
  catalog: EquipmentCatalog | undefined
): readonly ActorAction[] {
  const declared = definition?.actions ?? [];
  // A spell's later action rolls at the level the spell is up at (Spiritual Weapon from a level 3 spell slot).
  const taken = declared.map((action) =>
    withHeadCount(
      withPotentVitality(
        withPotentRange(
          withEmpoweredStrikes(
            withAgonizingBlast(
              withEldritchSpear(atLevelUp(withTakenActions(action), actor, catalog), definition),
              definition
            ),
            definition
          ),
          definition,
          catalog
        ),
        definition,
        catalog
      ),
      definition,
      actor
    )
  );
  // A Wizard's Ritual Adept casts a ritual from its book that the sheet doesn't list.
  const rituals = spellbookRituals(definition, actor, catalog);
  // The definition's own list when nothing changed, so a caller holding it sees the same array.
  const unchanged = taken.every((action, index) => action === declared[index]);
  // What another creature's spell lets this one do while it lasts (Dragon's Breath's exhale).
  const granted = actor
    ? [
        ...grantedSpellActions(actor, catalog),
        ...storedCastActions(actor, catalog),
        ...grantedItemActions(actor, definition, catalog)
      ]
    : [];
  // A Cleric's Divine Intervention casts any Cleric spell of level 5 or lower.
  const divine = divineInterventionCasts(definition, catalog);
  const base =
    unchanged && rituals.length === 0 && granted.length === 0 && divine.length === 0
      ? declared
      : [...taken, ...rituals, ...granted, ...divine];
  if (!actor) return base;
  const derivation = deriveEquipment(actor, definition, catalog);
  if (derivation.carriers.length === 0 && derivation.actions.length === 0) return base;
  return [...base, ...derivation.actions].map((action) =>
    withPactWeaponAttacks(withStandingRiders(action, derivation, actor, definition), actor, definition)
  );
}

/** SRD Eldritch Spear: the cantrip picked for it reaches 30 feet farther for each Warlock level. Applied to the spell
 *  attack's range, where the engine measures it; a save cantrip's range stays the GM's. */
function withEldritchSpear(action: ActorAction, definition: ActorDefinition | undefined): ActorAction {
  const rangeFeet = action.attack?.rangeFeet;
  if (rangeFeet === undefined || action.spellId === undefined) return action;
  const level = definition?.character?.classes.find((entry) => entry.id === "warlock")?.level ?? 0;
  if (!picksFor(definition, "eldritch-spear", "cantrip").includes(action.spellId) || level === 0) return action;
  return { ...action, attack: { ...action.attack!, rangeFeet: rangeFeet + 30 * level } };
}

/** SRD Agonizing Blast: "Choose one of your known Warlock cantrips that deals damage. You can add your Charisma
 *  modifier to that spell's damage rolls", in the spell's own damage type, for each cantrip picked for it. Folded into
 *  the first damage roll, so a Critical Hit doesn't double it. */
function withAgonizingBlast(action: ActorAction, definition: ActorDefinition | undefined): ActorAction {
  if (action.spellId === undefined || action.damage.length === 0 || !definition) return action;
  if (!picksFor(definition, "agonizing-blast", "cantrip").includes(action.spellId)) return action;
  const charisma = abilityModifier(definition.abilityScores.cha);
  if (charisma === 0) return action;
  return {
    ...action,
    damage: action.damage.map((part, index) =>
      index === 0 ? { ...part, formula: withFlatBonus(part.formula, charisma) } : part
    )
  };
}

/** SRD Improved Elemental Fury, Improved Potent Spellcasting (Druid 15): "When you cast a Druid cantrip with a range of
 *  10 feet or greater, the spell's range increases by 300 feet." Applied to the spell attack's range; a cantrip with
 *  no attack has it added where its targets are checked (`resolution/spell-targets.ts`). */
function withPotentRange(
  action: ActorAction,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): ActorAction {
  const rangeFeet = action.attack?.rangeFeet;
  if (rangeFeet === undefined || rangeFeet < 10 || action.spellId === undefined) return action;
  const spell = catalog?.spellRecord?.(action.spellId);
  if (potentRangeFeet(definition, spell) === 0) return action;
  return { ...action, attack: { ...action.attack!, rangeFeet: rangeFeet + 300 } };
}

/** SRD Improved Blessed Strikes, Potent Spellcasting: "When you cast a Cleric cantrip and deal damage to a creature
 *  with it, you can give vitality to yourself or another creature within 60 feet of yourself, granting a number of
 *  Temporary Hit Points equal to twice your Wisdom modifier." */
function withPotentVitality(
  action: ActorAction,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): ActorAction {
  if (action.spellId === undefined || action.damage.length === 0 || action.vitality) return action;
  const amount = potentVitality(definition, catalog?.spellRecord?.(action.spellId));
  return amount > 0 ? { ...action, vitality: { rangeFeet: 60, amount } } : action;
}

/** A later action of a spell its caster has up at a higher level, rolled at that level; anything else unchanged. */
function atLevelUp(action: ActorAction, actor: Actor | undefined, catalog: EquipmentCatalog | undefined): ActorAction {
  const spell = actor && action.spellId ? catalog?.spellRecord?.(action.spellId) : undefined;
  return spell && actor ? atSpellUpLevel(action, spell, actor) : action;
}

/** Folds the standing riders that apply to one action into the numbers the resolver reads. */
export function withStandingRiders(
  action: ActorAction,
  derivation: EquipmentDerivation,
  actor: Actor,
  definition?: ActorDefinition
): ActorAction {
  const sourceItemId = sourceItemOf(action, derivation, actor.inventory);
  const all = collectRiders(derivation.carriers, { ...derivation.context, moment: null, sourceItemId });
  if (all.length === 0) return action;
  // A spellcasting rider that names a class reaches only the spells cast as that class (Innate Sorcery's DC).
  const spellClass = spellClassOf(definition, action.spellId);
  const riders = all.filter(
    (rider) =>
      (rider.modifier.type !== "spell-save-dc" && rider.modifier.type !== "spell-attack-bonus") ||
      rider.modifier.classId === undefined ||
      rider.modifier.classId === spellClass
  );

  // A wand of the war mage's bonus to spell attack rolls lands on every spell attack its bearer makes.
  const attackBonus =
    sumRiders(riders, "attack-bonus") +
    (action.spellId !== undefined && action.attack ? sumRiders(riders, "spell-attack-bonus") : 0);
  // What rides a hit adds dice to the weapon's damage, which carries the weapon's own bonus once (a Staff of
  // Striking's charge is 1d6 Force, not 1d6 + 3).
  const damageBonus = action.ridesHit ? 0 : sumRiders(riders, "damage-bonus");
  const critDice = riders.reduce(
    (total, rider) => (rider.modifier.type === "critical-bonus-dice" ? total + (rider.modifier.count ?? 0) : total),
    0
  );
  const saveDc = sumRiders(riders, "spell-save-dc");
  const poolBonus = usesBonus(action, riders);
  const extraAttacks = extraAttacksFor(action, derivation, riders);
  if (attackBonus === 0 && damageBonus === 0 && critDice === 0 && saveDc === 0 && poolBonus === 0 && extraAttacks === 0)
    return action;

  return {
    ...action,
    ...(action.attack && (attackBonus !== 0 || critDice !== 0 || extraAttacks !== 0)
      ? {
          attack: {
            ...action.attack,
            bonus: action.attack.bonus + attackBonus,
            // The resolver turns `attack.count` into a generic `{ attack: n-1 }` pool, so Extra Attack's second
            // swing may legally use a different weapon.
            ...(extraAttacks !== 0
              ? { count: Math.max(1, Math.min(10, (action.attack.count ?? 1) + extraAttacks)) }
              : {}),
            // `criticalBonusDice` is schema-bounded 1-4.
            ...(critDice !== 0
              ? { criticalBonusDice: Math.max(1, Math.min(4, (action.attack.criticalBonusDice ?? 0) + critDice)) }
              : {})
          }
        }
      : {}),
    // Only a DC that is the bearer's spell save DC rises; a printed one (a wand's DC 15) stays as printed.
    ...(action.save?.spellcasting && saveDc !== 0
      ? { save: { ...action.save, dc: Math.max(1, Math.min(40, action.save.dc + saveDc)) } }
      : {}),
    ...(action.uses && poolBonus !== 0
      ? { uses: { ...action.uses, limit: Math.max(1, Math.min(MAX_ACTION_USES, action.uses.limit + poolBonus)) } }
      : {}),
    // A standing `damage-bonus` (a +1 weapon) folds into the first damage part's formula, so sheet, roll
    // and resolver read one number; the constant is never crit-doubled. Moment-gated ones are added by
    // the resolver as their own line.
    ...(action.damage.length > 0 && damageBonus !== 0
      ? {
          damage: action.damage.map((part, index) =>
            index === 0 ? { ...part, formula: withFlatBonus(part.formula, damageBonus) } : part
          )
        }
      : {})
  };
}

/** Folds a flat bonus into a formula's trailing constant: "2d6 + 1" + 1 = "2d6 + 2", "1d8 + 1" - 1 = "1d8".
    The derivation only emits `<dice> ± <constant>`, so a trailing signed integer is all that can appear. */
function withFlatBonus(formula: string, bonus: number): string {
  const tail = /\s*([+-])\s*(\d+)\s*$/.exec(formula);
  const constant = tail ? (tail[1] === "-" ? -Number(tail[2]) : Number(tail[2])) : 0;
  const base = tail ? formula.slice(0, tail.index).trim() : formula.trim();
  const next = constant + bonus;
  if (next === 0) return base;
  return `${base} ${next > 0 ? "+" : "-"} ${Math.abs(next)}`;
}

/** Extra attacks, for weapon swings only (SRD: "whenever you take the Attack action"). A definition
 *  action declaring its own `count` is left alone. Max and no sum: each rider names the total extra swings
 *  at its tier, and Extra Attack from two sources doesn't stack. */
function extraAttacksFor(
  action: ActorAction,
  derivation: EquipmentDerivation,
  riders: ReturnType<typeof collectRiders>
): number {
  if (!action.attack || !derivation.weaponActionIds.includes(action.id)) return 0;
  return riders.reduce(
    (most, rider) => (rider.modifier.type === "extra-attack" ? Math.max(most, rider.modifier.count ?? 0) : most),
    0
  );
}

/** Extra uses from riders ("+1 use of Lay on Hands"), keyed by the `actor.actionUses` key the engine spends. */
function usesBonus(action: ActorAction, riders: ReturnType<typeof collectRiders>): number {
  if (!action.uses) return 0;
  const key = action.uses.pool ?? action.id;
  return riders.reduce(
    (total, rider) =>
      rider.modifier.type === "resource-bonus" && rider.modifier.poolId === key
        ? total + (rider.modifier.amount ?? 0)
        : total,
    0
  );
}

/** The natural-d20 threshold at or above which an attack crits (SRD 20; a rider can widen it). Standing riders (a
 *  keen weapon) and ones gated on the attack roll, which can name the kinds of attack they widen (Improved
 *  Critical: weapons and Unarmed Strikes) when the roll's filters are passed. */
export function criticalThreshold(
  derivation: EquipmentDerivation,
  actor: Actor,
  action: ActorAction,
  filters: Omit<Partial<RiderContext>, "moment"> = {}
): number {
  const sourceItemId = sourceItemOf(action, derivation, actor.inventory);
  const riders = [
    ...collectRiders(derivation.carriers, { ...derivation.context, moment: null, sourceItemId }),
    ...collectRiders(derivation.carriers, { ...derivation.context, ...filters, moment: "on-attack-roll", sourceItemId })
  ];
  return riders.reduce(
    (lowest, rider) =>
      rider.modifier.type === "critical-range" && rider.modifier.threshold !== undefined
        ? Math.min(lowest, Math.max(15, rider.modifier.threshold))
        : lowest,
    20
  );
}

/** The sheet's limited-use pools keyed by `uses.pool ?? action.id`, so a client can show "3 of 5".
 *  `limit` is the max over the pool and rest scope (as `useLimitFor`). Takes an action list so the
 *  player projection, which has no catalog, can pass the stored sheet's actions. */
export function actionPools(
  actions: readonly ActorAction[]
): Array<{ id: string; name: string; limit: number; per: string }> {
  const pools = new Map<string, { id: string; name: string; limit: number; per: string; named: boolean }>();
  for (const action of actions) {
    if (!action.uses) continue;
    const id = action.uses.pool ?? action.id;
    const existing = pools.get(id);
    if (!existing) {
      // A pool one action spends reads as that action ("Divine Smite (no slot)") until a second shares it.
      pools.set(id, { id, name: action.name, limit: action.uses.limit, per: action.uses.per, named: action.id === id });
      continue;
    }
    // Same rule as `useLimitFor`: only a sibling in the same rest scope raises the ceiling.
    if (existing.per === action.uses.per) existing.limit = Math.max(existing.limit, action.uses.limit);
    // An action whose own id is the pool key names it; several others share the derived title.
    if (action.id === id) Object.assign(existing, { name: action.name, named: true });
    else if (!existing.named) existing.name = titleCase(id);
  }
  return [...pools.values()].map(({ named: _named, ...pool }) => pool);
}

const titleCase = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");

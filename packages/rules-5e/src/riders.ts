/**
 * Pure rider evaluation - the ONE collector shared by every carrier (item, feature, feat, chosen
 * option) and every consumer (equipment reconciliation, the attack roll, the damage roll, saves).
 *
 * Like the rest of `@vtt/rules-5e` this file has no GameState, schema, or content knowledge: the
 * caller flattens whatever it has into a `RiderContext` of plain values and gets back the riders
 * that fire. ADR-0008 holds - `when` is an AND-list of at most four NAMED triggers with bounded
 * parameters. Nothing here parses an expression, and no string is ever evaluated.
 *
 * The types below are declared STRUCTURALLY on purpose. The authoring schemas (`FeatureModifier`,
 * `RiderTrigger`) live in `@vtt/content-srd-5.2.1` / `@vtt/schemas`, which this package must not
 * import (it is the leaf of the dependency graph, and the content package imports schemas). A Zod
 * type inferred from the matching spec shape is assignable to these, so nothing has to change here
 * when the authoring schemas land.
 */

export type RiderAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type ArmorWeight = "light" | "medium" | "heavy";
/** How an attack is being made. `reaction`/`opportunity` are only knowable from the resolve's caller. */
export type AttackKind = "melee" | "ranged" | "spell" | "unarmed" | "thrown" | "reaction" | "opportunity";

/** The named roll or event a rider fires at. At most one per rider (the spec's `.superRefine`). */
export type RiderMoment =
  | "on-attack-roll" | "on-hit" | "on-critical-hit" | "on-critical-miss" | "on-damage-roll"
  | "on-saving-throw" | "on-ability-check" | "on-initiative-roll" | "on-death-save"
  | "on-taking-damage" | "on-spell-cast";

const MOMENTS: ReadonlySet<string> = new Set<RiderMoment>([
  "on-attack-roll", "on-hit", "on-critical-hit", "on-critical-miss", "on-damage-roll",
  "on-saving-throw", "on-ability-check", "on-initiative-roll", "on-death-save",
  "on-taking-damage", "on-spell-cast"
]);
const FILTERS: ReadonlySet<string> = new Set([
  "attack-kind-is", "weapon-property-is", "damage-type-is", "ability-is", "skill-is",
  "spell-school-is", "spell-level-is", "versus-creature-type", "versus-size", "versus-condition"
]);
const DYNAMIC_GATES: ReadonlySet<string> = new Set(["while-effect-tag", "while-hp-at-or-below", "while-condition"]);

/** Which of the four kinds a trigger belongs to - the static table that decides a rider's layer. */
export function triggerKind(type: string): "static-gate" | "dynamic-gate" | "moment" | "filter" {
  if (MOMENTS.has(type)) return "moment";
  if (FILTERS.has(type)) return "filter";
  if (DYNAMIC_GATES.has(type)) return "dynamic-gate";
  return "static-gate";
}

/** One entry in a rider's `when` AND-list. Unknown types fail CLOSED (see `passes`). */
export type RiderTrigger = Readonly<{
  type: string;
  weights?: readonly ArmorWeight[];
  allowShield?: boolean;
  wielding?: boolean;
  classIds?: readonly string[];
  speciesIds?: readonly string[];
  kind?: "weapon" | "armor" | "tool" | "skill";
  ids?: readonly string[];
  tags?: readonly string[];
  percent?: number;
  conditionIds?: readonly string[];
  present?: boolean;
  kinds?: readonly AttackKind[];
  properties?: readonly string[];
  damageTypes?: readonly string[];
  abilities?: readonly RiderAbility[];
  skills?: readonly string[];
  schools?: readonly string[];
  levels?: readonly number[];
  creatureTypes?: readonly string[];
  sizes?: readonly string[];
}>;

/**
 * A typed numeric rider. The union is open-ended structurally (one `type` discriminant plus the
 * bounded fields every variant uses) so the eleven consumers can each read the two or three fields
 * they care about without a 21-arm switch, and so an authored variant this build does not yet read
 * is inert rather than a type error - the ADR-0008 fail-open the rest of the interpreter uses.
 */
export type RiderModifier = Readonly<{
  type: string;
  amount?: number;
  ability?: RiderAbility;
  whileArmored?: boolean;
  count?: number;
  feet?: number;
  formula?: string;
  damageType?: string;
  doubleOnCritical?: boolean;
  roll?: "attack" | "incoming-attack" | "save" | "check" | "initiative" | "death-save" | "concentration";
  mode?: "advantage" | "disadvantage";
  classId?: string;
  level?: number;
  poolId?: string;
  threshold?: number;
  sense?: string;
  appliesTo?: "melee" | "all";
  when?: readonly RiderTrigger[];
  scope?: "bearer" | "this-item";
}>;

/** One thing that carries riders: an equipped item, a feature, a feat. */
export type RiderCarrier = Readonly<{
  /** What the table sees in a roll explanation ("Dagger of Warding"). */
  label: string;
  modifiers: readonly RiderModifier[];
  /** Present for an item carrier; drives `scope: "this-item"` and the derivation's provenance. */
  sourceItemId?: string;
  /** Riders on a weapon default to `this-item` for the attack/damage/crit family (spec 3, `scope`). */
  isWeapon?: boolean;
}>;

export type ResolvedRider = Readonly<{ modifier: RiderModifier; label: string; sourceItemId?: string }>;

/** Everything a trigger can be evaluated against. Absent fields make their triggers fail closed. */
export type RiderContext = Readonly<{
  // ---- static gates ----
  attunedItemIds?: readonly string[];
  /** null = wearing no body armor. */
  armorWeight?: ArmorWeight | null;
  shieldEquipped?: boolean;
  classIds?: readonly string[];
  speciesId?: string | null;
  proficientWeapons?: readonly string[];
  proficientArmor?: readonly string[];
  proficientTools?: readonly string[];
  proficientSkills?: readonly string[];
  // ---- dynamic gates ----
  effectTags?: readonly string[];
  /** current / maximum, 0..1; absent = unknown, so `while-hp-at-or-below` fails closed. */
  hitPointFraction?: number;
  bearerConditionIds?: readonly string[];
  // ---- the moment, and its filters ----
  /** null selects the STANDING+CONDITIONAL pass (riders that name no moment); a value selects that moment. */
  moment: RiderMoment | null;
  attackKinds?: readonly AttackKind[];
  weaponProperties?: readonly string[];
  damageTypes?: readonly string[];
  ability?: RiderAbility;
  skill?: string;
  spellSchool?: string;
  spellLevel?: number;
  targetSize?: string;
  targetConditionIds?: readonly string[];
  targetCreatureType?: string;
  /** Which item this roll is being made WITH - `scope: "this-item"` matches against it. */
  sourceItemId?: string | null;
}>;

const overlaps = (allowed: readonly string[] | undefined, have: readonly string[] | undefined): boolean =>
  allowed !== undefined && have !== undefined && allowed.some((entry) => have.includes(entry));

/** Evaluate ONE trigger. An unrecognised trigger type fails CLOSED - a rider whose gate the engine
 *  cannot check must not fire, or an authored "while mounted" would silently become "always". */
function passes(trigger: RiderTrigger, context: RiderContext): boolean {
  switch (trigger.type) {
    // ---- static gates ----
    // `attuned` is redundant when the item's own attunement is required (the derivation already
    // gated on it); it exists for an optional-attunement item with one attunement-only rider.
    case "attuned":
      return context.sourceItemId != null && (context.attunedItemIds ?? []).includes(context.sourceItemId);
    case "while-armored":
      return context.armorWeight != null && (trigger.weights === undefined || trigger.weights.includes(context.armorWeight));
    case "while-unarmored":
      return context.armorWeight == null && (trigger.allowShield === true || context.shieldEquipped !== true);
    case "while-shield":
      return (trigger.wielding ?? true) === (context.shieldEquipped === true);
    case "while-character-is":
      return overlaps(trigger.classIds, context.classIds)
        || (trigger.speciesIds !== undefined && context.speciesId != null && trigger.speciesIds.includes(context.speciesId));
    case "while-proficient-with": {
      const have = trigger.kind === "weapon" ? context.proficientWeapons
        : trigger.kind === "armor" ? context.proficientArmor
        : trigger.kind === "tool" ? context.proficientTools
        : trigger.kind === "skill" ? context.proficientSkills : undefined;
      return overlaps(trigger.ids, have);
    }
    // ---- dynamic gates ----
    case "while-effect-tag":
      return overlaps(trigger.tags, context.effectTags);
    case "while-hp-at-or-below":
      return context.hitPointFraction !== undefined && trigger.percent !== undefined
        && context.hitPointFraction * 100 <= trigger.percent;
    case "while-condition": {
      const present = overlaps(trigger.conditionIds, context.bearerConditionIds);
      return (trigger.present ?? true) ? present : !present;
    }
    // ---- filters ----
    case "attack-kind-is":
      return overlaps(trigger.kinds as readonly string[] | undefined, context.attackKinds);
    case "weapon-property-is":
      return overlaps(trigger.properties, context.weaponProperties);
    case "damage-type-is":
      return overlaps(trigger.damageTypes, context.damageTypes);
    case "ability-is":
      return trigger.abilities !== undefined && context.ability !== undefined && trigger.abilities.includes(context.ability);
    case "skill-is":
      return trigger.skills !== undefined && context.skill !== undefined && trigger.skills.includes(context.skill);
    case "spell-school-is":
      return trigger.schools !== undefined && context.spellSchool !== undefined && trigger.schools.includes(context.spellSchool);
    case "spell-level-is":
      return trigger.levels !== undefined && context.spellLevel !== undefined && trigger.levels.includes(context.spellLevel);
    case "versus-creature-type":
      return trigger.creatureTypes !== undefined && context.targetCreatureType !== undefined && trigger.creatureTypes.includes(context.targetCreatureType);
    case "versus-size":
      return trigger.sizes !== undefined && context.targetSize !== undefined && trigger.sizes.includes(context.targetSize);
    case "versus-condition":
      return overlaps(trigger.conditionIds, context.targetConditionIds);
    default:
      return false;
  }
}

/**
 * `armor-class.whileArmored` is authored in shipped bundles and predates `when`. Normalise it into
 * the one evaluation path rather than branching twice (spec 8.4); the authored field is left alone.
 */
function gatesOf(modifier: RiderModifier): readonly RiderTrigger[] {
  const authored = modifier.when ?? [];
  return modifier.type === "armor-class" && modifier.whileArmored === true
    ? [...authored, { type: "while-armored" } as const]
    : authored;
}

/** Riders whose `scope` resolves to "this-item" - authored, or derived for a weapon's own family. */
const THIS_ITEM_BY_DEFAULT: ReadonlySet<string> = new Set(["attack-bonus", "extra-damage", "critical-range", "critical-bonus-dice", "damage-bonus"]);
function scopeOf(modifier: RiderModifier, carrier: RiderCarrier): "bearer" | "this-item" {
  if (modifier.scope !== undefined) return carrier.sourceItemId === undefined ? "bearer" : modifier.scope;
  return carrier.isWeapon === true && THIS_ITEM_BY_DEFAULT.has(modifier.type) ? "this-item" : "bearer";
}

/**
 * THE collector. Two passes, selected by `context.moment`:
 *
 * - `moment: null` - the STANDING + CONDITIONAL set: riders that name no moment and carry no
 *   filter, whose static and dynamic gates all pass. This is what `reconcileEquipment` and every
 *   plain numeric read (AC, save bonus, slot maxima, pool limits) asks for.
 * - `moment: "on-…"` - the MOMENTARY set: riders naming exactly that moment whose gates and
 *   filters all pass. This is what the attack, damage and save paths ask for.
 *
 * A filter with no moment is an authoring mistake the publish validator rejects; here it simply
 * never matches, so it cannot leak into the standing pass and become "always".
 */
export function collectRiders(carriers: readonly RiderCarrier[], context: RiderContext): readonly ResolvedRider[] {
  const collected: ResolvedRider[] = [];
  for (const carrier of carriers) {
    for (const modifier of carrier.modifiers) {
      const gates = gatesOf(modifier);
      const moment = gates.find((trigger) => triggerKind(trigger.type) === "moment");
      const hasFilter = gates.some((trigger) => triggerKind(trigger.type) === "filter");
      if (context.moment === null) {
        if (moment !== undefined || hasFilter) continue;
      } else if (moment?.type !== context.moment) continue;
      if (scopeOf(modifier, carrier) === "this-item" && (context.sourceItemId == null || context.sourceItemId !== carrier.sourceItemId)) continue;
      const itemContext = carrier.sourceItemId === undefined ? context : { ...context, sourceItemId: carrier.sourceItemId };
      if (!gates.every((trigger) => triggerKind(trigger.type) === "moment" || passes(trigger, itemContext))) continue;
      collected.push({ modifier, label: carrier.label, ...(carrier.sourceItemId !== undefined ? { sourceItemId: carrier.sourceItemId } : {}) });
    }
  }
  return collected;
}

/** Sum the `amount` of every collected rider of one type (the numeric families). Signed, so a curse subtracts. */
export function sumRiders(riders: readonly ResolvedRider[], type: string): number {
  return riders.reduce((total, rider) => rider.modifier.type === type ? total + (rider.modifier.amount ?? 0) : total, 0);
}

/**
 * SRD armor weight from the item's own AC fields. `ItemArmorSchema` records no weight class, but the
 * three SRD rules are exactly recoverable from the two fields it does record: heavy armor adds no
 * Dex, medium caps it at +2, light adds it uncapped.
 */
export function armorWeightOf(armor: Readonly<{ addDexModifier: boolean; dexModifierCap: number | null }>): ArmorWeight {
  if (!armor.addDexModifier) return "heavy";
  return armor.dexModifierCap === null ? "light" : "medium";
}

/**
 * The mechanical hook an item hangs on. `slot` is the explicit field; `category` is the open
 * identity slug and only its three engine-known literals fall back. A homebrew `category: "relic"`
 * with `slot: "armor"` therefore derives AC, while `category` goes back to being a browse facet.
 */
export function effectiveSlot(item: Readonly<{ slot?: string; category?: string }>): string {
  if (item.slot !== undefined) return item.slot;
  return item.category === "armor" || item.category === "shield" || item.category === "weapon" ? item.category : "none";
}

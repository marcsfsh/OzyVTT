/**
 * Pure rider evaluation: the one collector shared by every carrier (item, feature, feat, chosen option, live
 * effect) and every consumer (equipment reconciliation, attack, damage, saves, checks, speed). Callers flatten
 * state into a plain `RiderContext`; nothing here parses or evaluates a string (ADR-0008).
 *
 * Types are structural because this leaf package cannot import `@vtt/schemas` or the content package; their
 * inferred Zod types are assignable to these.
 */

export type RiderAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type ArmorWeight = "light" | "medium" | "heavy";
/** How an attack is being made. `reaction`/`opportunity` are only knowable from the resolve's caller. `weapon` is an
 *  attack with a weapon, as opposed to a spell, an Unarmed Strike or a monster's natural attack, and `melee-weapon`/
 *  `ranged-weapon` such an attack made in melee or at range. */
export type AttackKind =
  | "melee"
  | "ranged"
  | "spell"
  | "unarmed"
  | "thrown"
  | "reaction"
  | "opportunity"
  | "weapon"
  | "melee-weapon"
  | "ranged-weapon"
  | "two-handed"
  | "ranged-weapon-kind";

/** The named roll or event a rider fires at; at most one per rider. */
export type RiderMoment =
  | "on-attack-roll"
  | "on-hit"
  | "on-critical-hit"
  | "on-natural-20"
  | "on-damage-roll"
  | "on-saving-throw"
  | "on-ability-check"
  | "on-initiative-roll"
  | "on-taking-damage"
  | "on-healing";

const MOMENTS: ReadonlySet<string> = new Set<RiderMoment>([
  "on-attack-roll",
  "on-hit",
  "on-critical-hit",
  "on-natural-20",
  "on-damage-roll",
  "on-saving-throw",
  "on-ability-check",
  "on-initiative-roll",
  "on-taking-damage",
  "on-healing"
]);
const FILTERS: ReadonlySet<string> = new Set([
  "attack-kind-is",
  "weapon-property-is",
  "weapon-is",
  "versus-magic",
  "versus-spell",
  "damage-type-is",
  "ability-is",
  "skill-is",
  "spell-school-is",
  "spell-level-is",
  "spell-id-is",
  "versus-creature-type",
  "versus-size",
  "versus-condition",
  "by-effect-source",
  "source-creature-type-is",
  "versus-effect-source",
  "versus-marked",
  "versus-hurt",
  "versus-within",
  "spell-class-is",
  "sees-other",
  "seen-by-other",
  "other-lacks-sense",
  "situation-is"
]);
const DYNAMIC_GATES: ReadonlySet<string> = new Set(["while-effect-tag", "while-hp-at-or-below", "while-condition"]);

/** Which of the four kinds a trigger belongs to; decides a rider's layer. */
export function triggerKind(type: string): "static-gate" | "dynamic-gate" | "moment" | "filter" {
  if (MOMENTS.has(type)) return "moment";
  if (FILTERS.has(type)) return "filter";
  if (DYNAMIC_GATES.has(type)) return "dynamic-gate";
  return "static-gate";
}

/** One entry in a rider's `when` AND-list. Unknown types fail closed (see `passes`). */
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
  spellIds?: readonly string[];
  creatureTypes?: readonly string[];
  sizes?: readonly string[];
  /** `versus-within`: the farthest the target may stand from the bearer. */
  feet?: number;
  senses?: readonly string[];
  /** `situation-is`: the plain words the roller names a check by ("consulting an accurate Book about its topic"). */
  situation?: string;
}>;

/** A typed numeric rider, structurally open so each consumer reads only its fields and a variant this build
 * doesn't read yet is inert and still compiles. */
export type RiderModifier = Readonly<{
  type: string;
  amount?: number;
  /** `initiative`: the bearer's Proficiency Bonus on top of `amount` (Alert). */
  proficiencyBonus?: boolean;
  ability?: RiderAbility;
  whileArmored?: boolean;
  /** `unarmored-defense`: does the benefit survive a shield? */
  allowShield?: boolean;
  /** `base-armor-class`: the base AC it gives while no armor is worn (Robe of the Archmagi's 15). */
  base?: number;
  count?: number;
  feet?: number;
  formula?: string;
  /** `extra-damage` may name an ability, alone or beside dice: the bearer's modifier, resolved at the roll. */
  abilityModifier?: RiderAbility;
  damageType?: string;
  /** `damage-resistance` / `damage-vulnerability`. */
  damageTypes?: readonly string[];
  doubleOnCritical?: boolean;
  roll?: "attack" | "incoming-attack" | "save" | "check" | "initiative" | "concentration" | "death-save";
  mode?: "advantage" | "disadvantage";
  classId?: string;
  level?: number;
  poolId?: string;
  threshold?: number;
  sense?: string;
  /** `special-speed`: the way of moving it gives, at `feet` or equal to Speed, and whether a flier hovers. */
  movement?: "fly" | "swim" | "climb" | "burrow";
  equalToSpeed?: boolean;
  hover?: boolean;
  /** `movement`: how the bearer falls and jumps ("safe-fall", "leap"), with a leap's `costFeet` and a multiplier's
   *  `times`. */
  rule?: string;
  costFeet?: number;
  times?: number;
  /** `attack-bonus` / `save-bonus` / `check-bonus` / `damage-bonus`: dice rolled on top of `amount` ("1d4"), or taken
   *  off ("-1d4"); `damage-reduction`: dice rolled as the damage lands. */
  dice?: string;
  /** `check-bonus`: the least its `abilityModifier` part counts as (Thaumaturge's +1). `d20-minimum`: the face a lower
   *  d20 counts as. */
  minimum?: number;
  /** `d20-minimum`: only on a check that uses a proficiency (Reliable Talent). */
  proficientOnly?: boolean;
  /** `total-minimum`: the ability whose score a lower total counts as (Indomitable Might's Strength). */
  abilityScore?: RiderAbility;
  /** `ability-score-minimum`: the least the score counts as ("Your Strength is 19"). */
  score?: number;
  /** `ability-score`: the most an increase takes the score to (20 when absent). */
  maximum?: number;
  /** `ignores-cover`: the most cover the attack sets aside. */
  degree?: "half" | "three-quarters";
  /** `speed-minimum`: armor's Strength requirement takes nothing from it either. */
  ignoresArmor?: boolean;
  /** `damage-bonus`: a penalty that leaves the damage at 1 or more (Reduce). */
  leavesOne?: boolean;
  /** `damage-reduction`: once a turn, on an effect (Resistance). */
  oncePerTurn?: boolean;
  /** `healing-bonus`: the slot's level is added, on a spell cast with a slot. */
  perSlotLevel?: boolean;
  /** `healing-bonus`: the bearer regains it, once its healing reaches another creature (Blessed Healer). */
  self?: boolean;
  /** `spell-ward`: the schools and spells that can't reach the bearer, and whether its own side's spells still do. */
  schools?: readonly string[];
  spellIds?: readonly string[];
  alliesAllowed?: boolean;
  when?: readonly RiderTrigger[];
  scope?: "bearer" | "this-item";
}>;

/** One thing that carries riders: an equipped item, a feature, a feat, a live effect. */
export type RiderCarrier = Readonly<{
  /** What the table sees in a roll explanation ("Dagger of Warding", "Raging"). */
  label: string;
  modifiers: readonly RiderModifier[];
  /** Present for an item carrier; drives `scope: "this-item"` and the derivation's provenance. */
  sourceItemId?: string;
  /** Present for a live effect, so a roll card can name the effect it came from. */
  sourceEffectId?: string;
  /** Riders on a weapon default to `this-item` for the attack/damage/crit family. */
  isWeapon?: boolean;
  /** SRD "Combining Game Effects": carriers sharing a key are one game effect, so `sumRiders` takes the most potent
   * contribution with no sum (two Slows are -10). */
  stackKey?: string;
}>;

export type ResolvedRider = Readonly<{
  modifier: RiderModifier;
  label: string;
  sourceItemId?: string;
  sourceEffectId?: string;
  stackKey?: string;
}>;

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
  /** null selects the standing + conditional pass (riders naming no moment); a value selects that moment. */
  moment: RiderMoment | null;
  attackKinds?: readonly AttackKind[];
  weaponProperties?: readonly string[];
  damageTypes?: readonly string[];
  ability?: RiderAbility;
  skill?: string;
  spellSchool?: string;
  spellLevel?: number;
  /** Which spell is being cast, for `spell-id-is`. Absent = not a spell, so the filter fails closed. */
  spellId?: string;
  targetSize?: string;
  targetConditionIds?: readonly string[];
  targetCreatureType?: string;
  /** Which item this roll is made with; `scope: "this-item"` matches against it. */
  sourceItemId?: string | null;
  /** The riders being read sit on an effect the roller put on its bearer (Hunter's Mark on the creature it hits);
   *  `by-effect-source` passes only then. */
  fromEffectSource?: boolean;
  /** The creature type of the creature on the other side: the attacker, for an attack against the bearer, or the
   *  creature whose effect forces its save. `source-creature-type-is` reads it. */
  sourceCreatureType?: string;
  /** The riders being read sit on an effect whose source is the roll's target (Bestow Curse on the cursed creature,
   *  attacking its caster); `versus-effect-source` passes only then. */
  targetIsEffectSource?: boolean;
  /** The tags of the effects the bearer put on the target (its grapple, its Hunter's Mark), for `versus-marked`. */
  targetMarkTags?: readonly string[];
  /** The target is missing some of its Hit Points, for `versus-hurt`. */
  targetHurt?: boolean;
  /** The map's distance from the bearer to the target, for `versus-within`; absent where it can't measure. */
  targetDistanceFeet?: number;
  /** The class the bearer casts the spell as (its sheet entry's class), for `spell-class-is`. */
  spellClassId?: string;
  /** Whether the bearer can see the other creature in the roll, and it the bearer (the server's sight). */
  seesOther?: boolean;
  seenByOther?: boolean;
  /** The senses the other creature perceives the bearer with, within their range ("blindsight", "truesight"). */
  otherSenses?: readonly string[];
  /** The situations the roller says this check fits, for `situation-is`. */
  situations?: readonly string[];
  /** The weapon the attack is made with: its catalog id and the base a magic weapon is bound to, for `weapon-is`. */
  weaponIds?: readonly string[];
  /** The save is against a spell or another magical effect (`versus-magic`), and against a spell (`versus-spell`). */
  magicalSource?: boolean;
  spellSource?: boolean;
}>;

const overlaps = (allowed: readonly string[] | undefined, have: readonly string[] | undefined): boolean =>
  allowed !== undefined && have !== undefined && allowed.some((entry) => have.includes(entry));

/** Evaluate one trigger. Unknown types fail closed, so an unsupported gate ("while mounted") never becomes "always". */
function passes(trigger: RiderTrigger, context: RiderContext): boolean {
  switch (trigger.type) {
    // ---- static gates ----
    // `attuned` matters for an optional-attunement item with one attunement-only rider.
    case "attuned":
      return context.sourceItemId != null && (context.attunedItemIds ?? []).includes(context.sourceItemId);
    case "while-armored":
      return (
        context.armorWeight != null && (trigger.weights === undefined || trigger.weights.includes(context.armorWeight))
      );
    case "while-unarmored":
      return context.armorWeight == null && (trigger.allowShield === true || context.shieldEquipped !== true);
    case "while-shield":
      return (trigger.wielding ?? true) === (context.shieldEquipped === true);
    case "while-character-is":
      return (
        overlaps(trigger.classIds, context.classIds) ||
        (trigger.speciesIds !== undefined &&
          context.speciesId != null &&
          trigger.speciesIds.includes(context.speciesId))
      );
    case "while-proficient-with": {
      const have =
        trigger.kind === "weapon"
          ? context.proficientWeapons
          : trigger.kind === "armor"
            ? context.proficientArmor
            : trigger.kind === "tool"
              ? context.proficientTools
              : trigger.kind === "skill"
                ? context.proficientSkills
                : undefined;
      return overlaps(trigger.ids, have);
    }
    // ---- dynamic gates ----
    case "while-effect-tag":
      return overlaps(trigger.tags, context.effectTags);
    case "while-hp-at-or-below":
      return (
        context.hitPointFraction !== undefined &&
        trigger.percent !== undefined &&
        context.hitPointFraction * 100 <= trigger.percent
      );
    case "while-condition": {
      const present = overlaps(trigger.conditionIds, context.bearerConditionIds);
      return (trigger.present ?? true) ? present : !present;
    }
    // ---- filters ----
    case "attack-kind-is":
      return overlaps(trigger.kinds as readonly string[] | undefined, context.attackKinds);
    case "weapon-property-is":
      return overlaps(trigger.properties, context.weaponProperties);
    case "weapon-is":
      return overlaps(trigger.ids, context.weaponIds);
    case "versus-magic":
      return context.magicalSource === true;
    case "versus-spell":
      return context.spellSource === true;
    case "damage-type-is":
      return overlaps(trigger.damageTypes, context.damageTypes);
    case "ability-is":
      return (
        trigger.abilities !== undefined && context.ability !== undefined && trigger.abilities.includes(context.ability)
      );
    case "skill-is":
      return trigger.skills !== undefined && context.skill !== undefined && trigger.skills.includes(context.skill);
    case "spell-school-is":
      return (
        trigger.schools !== undefined &&
        context.spellSchool !== undefined &&
        trigger.schools.includes(context.spellSchool)
      );
    case "spell-level-is":
      return (
        trigger.levels !== undefined && context.spellLevel !== undefined && trigger.levels.includes(context.spellLevel)
      );
    case "spell-id-is":
      return (
        trigger.spellIds !== undefined && context.spellId !== undefined && trigger.spellIds.includes(context.spellId)
      );
    case "versus-creature-type":
      return (
        trigger.creatureTypes !== undefined &&
        context.targetCreatureType !== undefined &&
        trigger.creatureTypes.includes(context.targetCreatureType)
      );
    case "versus-size":
      return (
        trigger.sizes !== undefined && context.targetSize !== undefined && trigger.sizes.includes(context.targetSize)
      );
    case "versus-condition":
      return overlaps(trigger.conditionIds, context.targetConditionIds);
    case "by-effect-source":
      return context.fromEffectSource === true;
    case "source-creature-type-is":
      return (
        trigger.creatureTypes !== undefined &&
        context.sourceCreatureType !== undefined &&
        trigger.creatureTypes.includes(context.sourceCreatureType)
      );
    case "versus-effect-source":
      return context.targetIsEffectSource === true;
    case "versus-marked":
      return overlaps(trigger.tags, context.targetMarkTags);
    case "versus-hurt":
      return context.targetHurt === true;
    case "versus-within":
      return (
        trigger.feet !== undefined &&
        context.targetDistanceFeet !== undefined &&
        context.targetDistanceFeet <= trigger.feet + 0.5
      );
    case "spell-class-is":
      return (
        trigger.classIds !== undefined &&
        context.spellClassId !== undefined &&
        trigger.classIds.includes(context.spellClassId)
      );
    case "sees-other":
      return context.seesOther === true;
    case "seen-by-other":
      return context.seenByOther === true;
    case "other-lacks-sense":
      return (
        trigger.senses !== undefined &&
        context.otherSenses !== undefined &&
        !trigger.senses.some((sense) => context.otherSenses!.includes(sense))
      );
    case "situation-is":
      return trigger.situation !== undefined && (context.situations ?? []).includes(trigger.situation);
    default:
      return false;
  }
}

/** Folds the legacy `armor-class.whileArmored` flag into the `when` path. */
function gatesOf(modifier: RiderModifier): readonly RiderTrigger[] {
  const authored = modifier.when ?? [];
  return modifier.type === "armor-class" && modifier.whileArmored === true
    ? [...authored, { type: "while-armored" } as const]
    : authored;
}

/** Riders that default to `scope: "this-item"` on a weapon. */
const THIS_ITEM_BY_DEFAULT: ReadonlySet<string> = new Set([
  "attack-bonus",
  "extra-damage",
  "critical-range",
  "critical-bonus-dice",
  "damage-bonus"
]);
function scopeOf(modifier: RiderModifier, carrier: RiderCarrier): "bearer" | "this-item" {
  if (modifier.scope !== undefined) return carrier.sourceItemId === undefined ? "bearer" : modifier.scope;
  return carrier.isWeapon === true && THIS_ITEM_BY_DEFAULT.has(modifier.type) ? "this-item" : "bearer";
}

/**
 * Collect the riders that fire, in one of two passes chosen by `context.moment`:
 * - `null`: standing + conditional riders (no moment, no filter) whose gates pass; used for AC, save bonus,
 *   slot maxima and pool limits.
 * - `"on-…"`: riders naming exactly that moment whose gates and filters pass; used by attack, damage, saves.
 * A filter without a moment never matches, so it cannot leak into the standing pass.
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
      if (
        scopeOf(modifier, carrier) === "this-item" &&
        (context.sourceItemId == null || context.sourceItemId !== carrier.sourceItemId)
      )
        continue;
      const itemContext =
        carrier.sourceItemId === undefined ? context : { ...context, sourceItemId: carrier.sourceItemId };
      if (!gates.every((trigger) => triggerKind(trigger.type) === "moment" || passes(trigger, itemContext))) continue;
      collected.push({
        modifier,
        label: carrier.label,
        ...(carrier.sourceItemId !== undefined ? { sourceItemId: carrier.sourceItemId } : {}),
        ...(carrier.sourceEffectId !== undefined ? { sourceEffectId: carrier.sourceEffectId } : {}),
        ...(carrier.stackKey !== undefined ? { stackKey: carrier.stackKey } : {})
      });
    }
  }
  return collected;
}

/** Probe modifier type used only inside `gatePasses`. */
const GATE_PROBE_TYPE = "__gate-probe";

/**
 * Whether a standing gate holds now, for a grant's `when` (resistances, immunities, proficiencies). Runs the
 * list through `collectRiders`' standing pass, with no second evaluator, so items and feats can't drift;
 * unknown triggers, moments and filters all read false, so an uncheckable gate never grants.
 * Pass the item's id as `sourceItemId` for an item's grants so `attuned` binds to it; omit it for features.
 */
export function gatePasses(
  when: readonly RiderTrigger[] | undefined,
  context: Omit<RiderContext, "moment">,
  sourceItemId?: string
): boolean {
  if (when === undefined || when.length === 0) return true;
  const carrier: RiderCarrier = {
    label: "",
    modifiers: [{ type: GATE_PROBE_TYPE, when, scope: "bearer" }],
    ...(sourceItemId !== undefined ? { sourceItemId } : {})
  };
  return collectRiders([carrier], { ...context, moment: null }).length > 0;
}

/** The more potent of two contributions from one game effect: the larger magnitude; on an opposite-sign tie the
 *  minimum, so a boon can't displace a penalty. */
function morePotent(held: number, candidate: number): number {
  if (Math.abs(candidate) > Math.abs(held)) return candidate;
  if (Math.abs(candidate) < Math.abs(held)) return held;
  return Math.min(held, candidate);
}

/** Sum the `amount` of every collected rider of one type. Signed, so a curse subtracts. Riders sharing a
 *  `stackKey` count once, at their most potent. */
export function sumRiders(riders: readonly ResolvedRider[], type: string): number {
  let total = 0;
  const stacked = new Map<string, number>();
  for (const rider of riders) {
    if (rider.modifier.type !== type) continue;
    const amount = rider.modifier.amount ?? 0;
    if (rider.stackKey === undefined) {
      total += amount;
      continue;
    }
    const held = stacked.get(rider.stackKey);
    stacked.set(rider.stackKey, held === undefined ? amount : morePotent(held, amount));
  }
  for (const amount of stacked.values()) total += amount;
  return total;
}

/** The dice riders of one type add to a roll (Bless's "+1d4", Bane's "-1d4"), each with its label, in collection
 *  order. Read beside `sumRiders`, which sums the flat `amount`s. Riders sharing a `stackKey` count once (two
 *  Blesses add one d4). */
export function diceRiders(
  riders: readonly ResolvedRider[],
  type: string
): Array<Readonly<{ label: string; dice: string }>> {
  const counted = new Set<string>();
  return riders.flatMap((rider) => {
    if (rider.modifier.type !== type || rider.modifier.dice === undefined) return [];
    if (rider.stackKey !== undefined) {
      if (counted.has(rider.stackKey)) return [];
      counted.add(rider.stackKey);
    }
    return [{ label: rider.label, dice: rider.modifier.dice }];
  });
}

/** Dice riders as terms to append to a d20 test's formula (" + 1d4 - 1d4"). */
export function diceRiderTerms(dice: ReadonlyArray<Readonly<{ dice: string }>>): string {
  return dice.map((entry) => (entry.dice.startsWith("-") ? ` - ${entry.dice.slice(1)}` : ` + ${entry.dice}`)).join("");
}

/** SRD armor weight from the item's AC fields: heavy adds no Dex, medium caps it at +2, light adds it uncapped. */
export function armorWeightOf(
  armor: Readonly<{ addDexModifier: boolean; dexModifierCap: number | null }>
): ArmorWeight {
  if (!armor.addDexModifier) return "heavy";
  return armor.dexModifierCap === null ? "light" : "medium";
}

/** The mechanical slot: explicit `slot` first, else `category` when it is "armor", "shield" or "weapon". */
export function effectiveSlot(item: Readonly<{ slot?: string; category?: string }>): string {
  if (item.slot !== undefined) return item.slot;
  return item.category === "armor" || item.category === "shield" || item.category === "weapon" ? item.category : "none";
}

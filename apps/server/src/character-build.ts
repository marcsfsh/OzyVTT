import type { BuilderPolicy } from "@vtt/domain";
import { CatalogChoiceError, extraPickAmount, resolveCatalogChoice, resolvePickChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import {
  ActorDefinitionSchema,
  type ActorAction, type ActorDefinition, type CharacterChoice, type InventoryItem
} from "@vtt/schemas";
import {
  ABILITIES, ABILITY_ROLL_FORMULA, abilityModifier, armorClassFromEquipment, hitDieFaces, hitPointPool,
  isPointBuyLegal, proficiencyBonusForLevel, spellAttackBonus, spellSaveDc, STANDARD_ARRAY,
  validateAbilityFormula, type Ability, type ClassProgressionTable
} from "@vtt/rules-5e";
import type {
  BackgroundReference, ClassLevelRow, ClassReference, FeatReference, FeatureModifier, FeatureOption,
  FeatureRecord, SpeciesReference, SpellReference, SubclassReference
} from "@vtt/content-srd-5.2.1";
import { featurePicks, NAMED_PICK_BUDGET_KEYS } from "@vtt/content-srd-5.2.1";
import type { ContentView } from "./content-library.js";
import { BUILDER_BAKED_MODIFIER_TYPES, UNARMED_STRIKE_ACTION_ID, type CharacterFeatureRef } from "./equipment-derivation.js";
import { bindTemplateItem } from "./inventory.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * Server-side character assembly for `character.create`. The client sends choices, never a finished
 * sheet, so only the server interprets feature riders. Validates every id and pick through the same
 * `resolveCatalogChoice` the wizard uses, interprets riders (unmodeled mechanics stay prose, ADR-0008),
 * assembles the `ActorDefinition` with `@vtt/rules-5e` math and re-validates it.
 *
 * Ledger-row conventions (the wizard writes the same rows):
 *   - kind = a feature's `choice.kind` (`payload.featureId` disambiguates same-kind offers);
 *   - "skill"/"tool"/"language" also match the class/background/species choose-N lists;
 *   - "subclass" mirrors `subclassId`; "lineage" picks the species lineage;
 *   - "asi-or-feat" with id "asi" carries `payload.increases`; any other id is a feat (as are
 *     "feat" / "fighting-style" rows);
 *   - "cantrip" / "spell" without a featureId fill the class's cantripsKnown / preparedCount budgets;
 *   - "equipment" names one class and one background starting-equipment option;
 *   - "size" (optional) picks among the species' sizes; defaults to medium.
 */

export type CharacterCreateRequestInput = Readonly<{
  name: string;
  speciesId: string;
  backgroundId: string;
  classId: string;
  level: number;
  subclassId?: string;
  abilityMethod: BuilderPolicy["allowedAbilityMethods"][number];
  baseScores: Readonly<Record<Ability, number>>;
  backgroundBonusAllocation: ReadonlyArray<Readonly<{ ability: Ability; amount: number }>>;
  hp: Readonly<{ mode: "average" | "entries"; entries?: readonly number[] }>;
  choices: readonly CharacterChoice[];
}>;

/** Where a granted feature came from, for `definition.character.features`. `null` = already recorded on `character.feats`. */
type CharacterFeatureOrigin = Readonly<{ kind: CharacterFeatureRef["kind"]; sourceId: string }>;

function reject(message: string): never { throw new CommandRejectedError(message); }
function dedupe(values: readonly string[]): string[] { return [...new Set(values)]; }

/** SRD: Magic Initiate repeats only with a different spell list, and each list is its own feat id here. */
function repeatsOnlyWithADifferentSpellList(feat: FeatReference): boolean {
  return featurePicks(feat.feature).some((pick) => pick.fromCatalog?.endsWith("-spells") ?? false);
}

// Choice offers: everything the content asks the player to pick, with its legal options.

/** One pick the content offers; `capacity` is choose x times-granted. `unresolvable` marks a catalog gap:
 *  the pick is optional, but a row targeting it still fails with the resolver's error. */
export type ChoiceOffer = {
  key: string;
  featureId: string | null;
  /** Other feature ids a `payload.featureId` tag may name (an option's pick also accepts its parent feature). */
  featureAliases: readonly string[];
  kind: string;
  capacity: number;
  options: ReadonlySet<string>;
  /** Spell level per option id, when the options came from a `*-spells` catalog (drives maxSpellLevel). */
  optionLevels: ReadonlyMap<string, number> | null;
  /** Inline options carrying their own mechanics (Divine Order's roles); null when the ids are bare. */
  optionRecords: readonly FeatureOption[] | null;
  unresolvable: string | null;
  repeatable: boolean;
  maxSpellLevel: number | null;
  /** Floor on an option's spell level: Mystic Arcanum is "one level 6 spell", so both bounds are 6. */
  minSpellLevel: number | null;
  /** The ceiling an ability-score pick from this offer may reach; null = the SRD's 20 (epic boons say 30). */
  maximum: number | null;
  label: string;
  /** The character level(s) this offer's picks belong to, one per grant (`[4, 8, 12, 16]` for an ASI).
   *  Not used for validation; writers record it so `level-ledger.ts` can prefill level-up. */
  levels: readonly number[];
  /** The class a pick belongs to, or null for species/background/origin decisions. */
  classId: string | null;
  taken: string[];
};

function offerOf(partial: Pick<ChoiceOffer, "key" | "kind" | "capacity" | "options" | "label"> & Partial<ChoiceOffer>): ChoiceOffer {
  return {
    featureId: null, featureAliases: [], optionLevels: null, optionRecords: null, unresolvable: null,
    maxSpellLevel: null, minSpellLevel: null, maximum: null, repeatable: false, levels: [1], classId: null, taken: [], ...partial
  };
}

/** The level a pick at index `index` of this offer belongs to - see `ChoiceOffer.levels`. */
export function levelOfPick(offer: Pick<ChoiceOffer, "levels" | "capacity">, index: number): number {
  const perGrant = Math.max(1, Math.ceil(offer.capacity / Math.max(1, offer.levels.length)));
  return offer.levels[Math.min(offer.levels.length - 1, Math.floor(index / perGrant))] ?? 1;
}

// Whether an option lies inside the offer's spell-level window (ceiling, floor or both); unknown level reads as 0.
const withinSpellWindow = (offer: Pick<ChoiceOffer, "optionLevels" | "maxSpellLevel" | "minSpellLevel">, id: string): boolean => {
  const level = offer.optionLevels?.get(id) ?? 0;
  return (offer.maxSpellLevel === null || level <= offer.maxSpellLevel)
    && (offer.minSpellLevel === null || level >= offer.minSpellLevel);
};

/** Exported for the random generator so it draws from exactly the ids `matchRow` accepts. */
export const withinOfferSpellWindow = withinSpellWindow;

/** Every budget an `extraPicks` grant may name by fixed key (a feature's own pick is `feature:<id>`):
 *  six offer keys plus the `class-cantrips` / `class-spells` columns. Shared with the wizard. */
export const NAMED_PICK_BUDGETS = NAMED_PICK_BUDGET_KEYS;
export type NamedPickBudget = (typeof NAMED_PICK_BUDGETS)[number];

/** A chosen inline option is a feature with identical rider fields, so one interpreter handles both. */
function optionAsFeature(option: FeatureOption): FeatureRecord {
  return {
    id: option.id, name: option.name, description: option.description, tags: option.tags,
    actions: option.actions, effects: option.effects, modifiers: option.modifiers,
    // Listed explicitly rather than spread, so a field added to one carrier but not the other is a type error.
    extraPicks: option.extraPicks,
    replaces: option.replaces,
    ...(option.uses ? { uses: option.uses } : {}),
    ...(option.grants ? { grants: option.grants } : {}),
    // Options cannot nest further options; restate `from` because the feature-level type requires it.
    ...(option.choice ? { choice: { ...option.choice, from: option.choice.from } } : {})
  };
}

// Feature-rider interpretation (bounded vocabulary; unmodeled mechanics stay prose, ADR-0008).

type BuildContext = Readonly<{
  level: number;
  proficiencyBonus: number;
  finalScores: Record<Ability, number>;
  spellcastingAbility: Ability | null;
  /** The class table's printed row for this level; what `scaling: {type: "class-resource"}` reads. */
  classResources: ClassLevelRow["classResources"];
}>;

type InterpretedFeatures = {
  actions: ActorAction[];
  traits: Array<{ name: string; description: string }>;
  grantedSkills: string[];
  grantedExpertise: string[];
  grantedTools: string[];
  grantedLanguages: string[];
  grantedArmor: string[];
  grantedWeapons: string[];
  grantedSaves: Ability[];
  damageResistances: string[];
  damageImmunities: string[];
  conditionImmunities: string[];
  grantedSpells: Array<{ id: string; level: number | undefined; alwaysPrepared: boolean; ability: Ability | undefined }>;
  hitPointsPerLevel: number;
  speedBonus: number;
  armorClassBonus: number;
  /** Flat AC that applies only while body armor is worn (Defense fighting style). */
  armorClassBonusWhileArmored: number;
  initiativeBonus: number;
  unarmoredDefense: { ability: Ability; allowShield: boolean } | null;
};

// Rider ownership: of the `FeatureModifierSchema` variants, this fold bakes some and the roll-time
// collector owns the rest. Both halves are named so neither can grow a hole.

// Compile-time check that every literal in `BUILDER_BAKED_MODIFIER_TYPES` is in the vocabulary
// (`equipment-derivation.ts` cannot name `FeatureModifier`).
BUILDER_BAKED_MODIFIER_TYPES satisfies readonly FeatureModifier["type"][];
type CarrierRiderType = Exclude<FeatureModifier["type"], (typeof BUILDER_BAKED_MODIFIER_TYPES)[number]>;

/** The roll-time half of the rider partition; a `Record` so a new variant must be assigned or the build
 *  fails. These reach the table as rider carriers via `deriveEquipment`. Values record where each is
 *  consumed ("unread": no consumer yet). */
const CARRIER_RIDER_DISPOSITION: Readonly<Record<CarrierRiderType, "standing" | "at-its-moment" | "unread" | "display-only">> = {
  "attack-bonus": "standing",        // effective-actions folds it into attack.bonus; action-resolution adds the on-attack-roll half
  "save-bonus": "standing",          // saving-throws.ts saveRiderBonus (standing + on-saving-throw)
  "spell-save-dc": "standing",       // effective-actions folds it into save.dc
  "spell-slot": "standing",          // spellSlotMaxima, via derivation.spellSlots
  "resource-bonus": "standing",      // effective-actions usesBonus raises uses.limit
  "critical-range": "standing",      // effective-actions criticalThreshold
  "critical-bonus-dice": "standing", // effective-actions folds it into attack.criticalBonusDice
  "extra-attack": "standing",        // effective-actions extraAttacksFor raises attack.count on a weapon swing
  "roll-mode": "at-its-moment",      // attacks (action-resolution), saves (saving-throws), initiative (encounter)
  "extra-damage": "at-its-moment",   // action-resolution rolls it as its own typed damage entry
  "damage-bonus": "standing",        // effective-actions folds it into the first damage part's formula; a moment-gated one lands as a bonusDamage line in action-resolution
  "check-bonus": "standing",         // actor-derived.ts checkRiderBonus, into every check and skill row
  "spell-attack-bonus": "unread",    // reaches derivation.spellAttackBonus; no spell-attack path reads it yet
  "damage-reduction": "at-its-moment", // hit-points.ts damageReductionFor, applied to the total after resistances
  "sense": "display-only"            // like `darkvision`: the trait prose carries it; no definition field models senses
};

/** No-op for riders the roll-time collector owns; the parameter type proves `default:` covers only those. */
function ownedByTheRollTimeCollector(modifier: { type: CarrierRiderType }): string {
  return CARRIER_RIDER_DISPOSITION[modifier.type];
}

/** Resolve a feature's limited uses to a flat count using the character's own numbers. */
function resolvedUseLimit(uses: NonNullable<FeatureRecord["uses"]>, context: BuildContext): number {
  if (uses.limit !== undefined) return uses.limit;
  const scaling = uses.scaling!;
  if (scaling.type === "proficiency-bonus") return context.proficiencyBonus;
  if (scaling.type === "ability-modifier") return Math.max(scaling.minimum, abilityModifier(context.finalScores[scaling.ability]));
  if (scaling.type === "class-resource") {
    // The printed class column at this level is the count; a dice-string amount ("3d6") resolves to 0.
    const amount = context.classResources.find((resource) => resource.id === scaling.id)?.amount;
    return typeof amount === "number" ? amount : 0;
  }
  const rows = [...scaling.table].filter((row) => row.level <= context.level).sort((left, right) => left.level - right.level);
  return rows.length > 0 ? rows[rows.length - 1].limit : 0;
}

/** A feature action as a definition action, resolving the rider templates' to-hit and DC from the character's numbers. */
function interpretAction(feature: FeatureRecord, action: FeatureRecord["actions"][number], context: BuildContext): ActorAction {
  const { attack, save, damageByLevel, ...carried } = action;
  const assembled: Record<string, unknown> = { ...carried };
  if (attack) {
    const ability = attack.ability === "spellcasting" ? context.spellcastingAbility : attack.ability;
    if (!ability) reject(`"${feature.name}" attacks with the spellcasting ability, but this class has no spellcasting.`);
    const { ability: _ability, proficient, ...attackRest } = attack;
    assembled.attack = { bonus: abilityModifier(context.finalScores[ability]) + (proficient ? context.proficiencyBonus : 0), ...attackRest };
  }
  if (save) {
    if (save.dc === "spellcasting" && context.spellcastingAbility === null) reject(`"${feature.name}" uses the spell save DC, but this class has no spellcasting.`);
    // `FeatureSaveDcSchema` has three forms: "spellcasting", a number, and `{base, ability,
    // proficiencyBonus}` (Dragonborn Breath Weapon, 8 + CON + PB). All must resolve to a number.
    const dc = save.dc === "spellcasting"
      ? spellSaveDc(context.finalScores[context.spellcastingAbility!], context.proficiencyBonus)
      : typeof save.dc === "number"
        ? save.dc
        : save.dc.base + abilityModifier(context.finalScores[save.dc.ability]) + (save.dc.proficiencyBonus ? context.proficiencyBonus : 0);
    assembled.save = { ability: save.ability, dc };
  }
  if (damageByLevel && damageByLevel.length > 0) {
    const rows = [...damageByLevel].filter((row) => row.level <= context.level).sort((left, right) => left.level - right.level);
    if (rows.length > 0) assembled.damage = [{ formula: rows[rows.length - 1].formula, type: rows[rows.length - 1].type }];
  }
  // The feature's limited uses ride the action when the action declares none of its own.
  if (feature.uses && assembled.uses === undefined) {
    const limit = resolvedUseLimit(feature.uses, context);
    if (limit >= 1) {
      assembled.uses = { limit: Math.min(20, limit), per: feature.uses.per, ...(feature.uses.pool ? { pool: feature.uses.pool } : {}) };
    }
  }
  return assembled as ActorAction;
}

/** The action id a spell resolves through (`spells[].actionId`); namespaced so it cannot collide with a feature action. */
const spellActionId = (spellId: string): string => `spell-${spellId}`;

// `DiceFormulaSchema`'s shape, used to skip an unusable printed column here instead of failing the
// whole build at schema validation.
const DICE_FORMULA = /^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i;

/**
 * The server-resolved action for one known cantrip, or null. Cantrips only, since a leveled spell
 * action would need a slot the sheet can't express. A roll counts as damage only with a damage type,
 * and an action is minted only for typed damage or a save (save outranks attack). Not scaled by
 * character level, to match the effect the sheet prints.
 */
function cantripActionFor(spell: SpellReference, numbers: Readonly<{ attackBonus: number; saveDc: number }>): ActorAction | null {
  if (spell.level !== 0) return null;
  const typedDamage = spell.damage.roll !== null && spell.damage.types.length > 0;
  if (!typedDamage && spell.save === null) return null;
  const activation: ActorAction["activation"] =
    /bonus/i.test(spell.castingTime) ? "bonus-action"
      : /reaction/i.test(spell.castingTime) ? "reaction"
        : /^action$/i.test(spell.castingTime.trim()) ? "action" : "other";
  return {
    id: spellActionId(spell.id),
    name: spell.name,
    activation,
    description: spell.description.slice(0, 12000),
    damage: typedDamage ? [{ formula: spell.damage.roll!, type: spell.damage.types[0] }] : [],
    ...(spell.save !== null
      ? { save: { ability: spell.save, dc: numbers.saveDc } }
      : spell.attackRoll ? { attack: { bonus: numbers.attackBonus } } : {}),
    // `spell-id-is` riders (Agonizing Blast) match on this field alone.
    spellId: spell.id
  } as ActorAction;
}

/** Mints and links (`spells[].actionId`) an action for each cantrip that has one; mutates the list in place. */
function linkCantripActions(
  spells: Array<Record<string, unknown>>, into: ActorAction[],
  numbers: Readonly<{ attackBonus: number; saveDc: number }>, library: ContentView
): void {
  for (const entry of spells) {
    const record = library.spellRecord(String(entry.id));
    const action = record ? cantripActionFor(record, numbers) : null;
    if (!action || into.some((existing) => existing.id === action.id)) continue;
    into.push(action);
    entry.actionId = action.id;
  }
}

/** The Martial Arts unarmed strike from the printed `classResources` column, or null without one. Uses
 *  the better of DEX or STR (SRD Dexterous Attacks). A non-dice amount keeps the generic builtin.
 *  Limitation: Monk weapons don't get the die or DEX, and Flurry of Blows stays prose. */
function martialArtsStrike(context: BuildContext): ActorAction | null {
  const die = context.classResources.find((resource) => resource.id === "martial-arts")?.amount;
  if (typeof die !== "string" || !DICE_FORMULA.test(die)) return null;
  const modifier = Math.max(abilityModifier(context.finalScores.str), abilityModifier(context.finalScores.dex));
  return {
    id: UNARMED_STRIKE_ACTION_ID,
    name: "Unarmed Strike",
    activation: "action",
    description: `A strike with your body. You roll your Martial Arts die (${die}) in place of the normal damage, and use Dexterity or Strength for the attack and damage rolls - whichever is higher. (SRD 5.2.1, Martial Arts)`,
    attack: { bonus: modifier + context.proficiencyBonus, reachFeet: 5 },
    damage: [{ formula: modifier === 0 ? die : `${die} ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}`, type: "bludgeoning" }]
  } as ActorAction;
}

/** Interprets one feature's riders into the running build. Prose always lands as a trait; riders add mechanics on top. */
function interpretFeature(feature: FeatureRecord, into: InterpretedFeatures, context: BuildContext): void {
  into.traits.push({ name: feature.name, description: feature.description });
  for (const action of feature.actions) {
    const interpreted = interpretAction(feature, action, context);
    if (!into.actions.some((existing) => existing.id === interpreted.id)) into.actions.push(interpreted);
  }
  // A feature with no action gets a synthesized activation when a rider needs a trigger (an effect grant)
  // or it has limited uses (so the pool is trackable and rests can reset it by action id).
  const synthesizedUses = feature.uses ? Math.min(20, resolvedUseLimit(feature.uses, context)) : 0;
  const carriesUses = feature.uses !== undefined && synthesizedUses >= 1;
  if (feature.actions.length === 0 && (feature.effects.length > 0 || carriesUses) && !into.actions.some((existing) => existing.id === feature.id)) {
    into.actions.push({
      id: feature.id, name: feature.name, activation: "other",
      description: feature.description.slice(0, 12000), damage: [],
      ...(feature.effects.length > 0 ? { grants: feature.effects[0] } : {}),
      ...(carriesUses ? { uses: { limit: synthesizedUses, per: feature.uses!.per, ...(feature.uses!.pool ? { pool: feature.uses!.pool } : {}) } } : {})
    } as unknown as ActorAction);
  }
  // Only ungated grants are baked; gated ones need live actor state and are recomputed by `deriveEquipment`.
  // Gated blocks naming spells are refused at authoring, since spells are baked only here.
  if (feature.grants && (feature.grants.when?.length ?? 0) === 0) {
    into.grantedSkills.push(...feature.grants.skills);
    into.grantedExpertise.push(...feature.grants.expertise);
    into.grantedTools.push(...feature.grants.tools);
    into.grantedLanguages.push(...feature.grants.languages);
    into.grantedArmor.push(...feature.grants.armor);
    into.grantedWeapons.push(...feature.grants.weapons);
    into.grantedSaves.push(...feature.grants.saves);
    into.damageResistances.push(...feature.grants.damageResistances);
    into.damageImmunities.push(...feature.grants.damageImmunities);
    into.conditionImmunities.push(...feature.grants.conditionImmunities);
    into.grantedSpells.push(...feature.grants.spells.map((spell) => ({ id: spell.id, level: spell.level, alwaysPrepared: spell.alwaysPrepared, ability: spell.ability })));
  }
  for (const modifier of feature.modifiers) {
    switch (modifier.type) {
      // Already applied in step 5c, which must precede `interpretAction` reading `context.finalScores`
      // for this feature's DC. Kept as an explicit case to document the partition.
      case "ability-score": break;
      case "hit-points-per-level": into.hitPointsPerLevel += modifier.amount; break;
      case "speed": into.speedBonus += modifier.amount; break;
      // Defense is "+1 AC while wearing armor": a `whileArmored` rider waits for step 11, which knows the
      // final loadout. An unconditional rider applies either way.
      case "armor-class":
        if (modifier.whileArmored) into.armorClassBonusWhileArmored += modifier.amount;
        else into.armorClassBonus += modifier.amount;
        break;
      case "initiative": into.initiativeBonus += modifier.amount; break;
      case "unarmored-defense": into.unarmoredDefense = { ability: modifier.ability, allowShield: modifier.allowShield }; break;
      case "darkvision": break; // display-only: the trait prose carries the senses; no definition field models them
      // The roll-time variants; see `CARRIER_RIDER_DISPOSITION`.
      default: ownedByTheRollTimeCollector(modifier); break;
    }
  }
}

// Validation helpers.

const spreadKey = (amounts: readonly number[]) => [...amounts].sort((left, right) => right - left).join("/");

function validateBaseScores(input: CharacterCreateRequestInput, policy: BuilderPolicy): void {
  if (!policy.allowedAbilityMethods.includes(input.abilityMethod)) {
    reject(`The table's builder policy does not allow the "${input.abilityMethod}" ability method.`);
  }
  const values = ABILITIES.map((ability) => input.baseScores[ability]);
  if (input.abilityMethod === "standard-array") {
    if ([...values].sort((a, b) => b - a).join(",") !== [...STANDARD_ARRAY].join(",")) {
      reject(`Standard-array scores must be exactly ${STANDARD_ARRAY.join(", ")} in some order.`);
    }
    return;
  }
  if (input.abilityMethod === "point-buy") {
    if (!isPointBuyLegal(values)) reject("Those scores are not a legal point-buy spread (8-15, within the 27-point budget).");
    return;
  }
  // "roll" and "custom": the server cannot verify dice it did not throw (physical dice are supported),
  // so it bound-checks each score against what the formula can produce.
  if (input.abilityMethod === "custom" && !policy.customFormula) {
    reject("The custom ability method needs the GM to configure a formula first (builder policy).");
  }
  const formula = input.abilityMethod === "custom" ? policy.customFormula! : ABILITY_ROLL_FORMULA;
  const check = validateAbilityFormula(formula);
  if (!check.ok) reject(`The configured ability formula is unusable: ${check.message}`);
  for (const [index, value] of values.entries()) {
    if (value < check.minimum || value > check.maximum) {
      reject(`A ${formula} roll produces ${check.minimum}-${check.maximum}; ${ABILITIES[index].toUpperCase()} ${value} is outside that range.`);
    }
  }
}

function validateBackgroundAllocation(input: CharacterCreateRequestInput, background: BackgroundReference): void {
  const options = background.abilityOptions;
  if (!options) {
    if (input.backgroundBonusAllocation.length > 0) reject(`${background.name} grants no ability increases, but an allocation was supplied.`);
    return;
  }
  if (input.backgroundBonusAllocation.length === 0) reject(`${background.name} grants ability increases - choose a +2/+1 or +1/+1/+1 spread.`);
  const abilities = input.backgroundBonusAllocation.map((entry) => entry.ability);
  if (new Set(abilities).size !== abilities.length) reject("Background ability increases must go to distinct abilities.");
  for (const ability of abilities) {
    if (!options.from.includes(ability)) reject(`${background.name} increases ${options.from.map((a) => a.toUpperCase()).join("/")}, not ${ability.toUpperCase()}.`);
  }
  const spread = spreadKey(input.backgroundBonusAllocation.map((entry) => entry.amount));
  if (!options.spreads.some((legal) => spreadKey(legal) === spread)) {
    reject(`${background.name} allows ${options.spreads.map((legal) => `+${legal.join("/+")}`).join(" or ")}; got +${spread.replace(/\//g, "/+")}.`);
  }
}

/** Deduped `{kind, sourceId, id}` triples for every granted feature with an origin, in grant order.
 *  Truncated at the schema's 80 rather than rejecting an oversized homebrew class. */
function dedupeFeatureRefs(
  granted: ReadonlyArray<{ record: FeatureRecord; origin: CharacterFeatureOrigin | null }>
): CharacterFeatureRef[] {
  const seen = new Set<string>();
  const refs: CharacterFeatureRef[] = [];
  for (const { record, origin } of granted) {
    if (!origin) continue; // already on `character.feats`; a second carrier would double its riders
    const ref = { id: record.id, kind: origin.kind, sourceId: origin.sourceId };
    const key = `${ref.kind} ${ref.sourceId} ${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs.slice(0, 80);
}

/** Features the class's level rows 1..level grant, with grant counts and grant levels, plus the row for `level`. */
function grantedClassFeatures(entry: ClassReference, level: number): { features: Map<string, { record: FeatureRecord; count: number; levels: number[] }>; row: ClassLevelRow } {
  const byId = new Map(entry.features.map((feature) => [feature.id, feature]));
  const granted = new Map<string, { record: FeatureRecord; count: number; levels: number[] }>();
  for (const row of entry.levelTable.filter((candidate) => candidate.level <= level)) {
    for (const featureId of row.features) {
      const existing = granted.get(featureId);
      granted.set(featureId, { record: byId.get(featureId)!, count: (existing?.count ?? 0) + 1, levels: [...(existing?.levels ?? []), row.level] });
    }
  }
  // A replacing feature (Indomitable 9/13/17) supersedes its predecessor once granted.
  for (const { record } of [...granted.values()]) {
    if (record.replacesFeatureId && granted.has(record.replacesFeatureId)) granted.delete(record.replacesFeatureId);
  }
  return { features: granted, row: entry.levelTable[level - 1] };
}

// The build. `library` is always an audience-scoped view, so a player can never build against (or
// name) a homebrew record the GM has not made player-visible.

/** Rolled HP entries as ledger rows (level N is entry N-2), replacing any already in the input. */
export function hitPointRollRows(input: Pick<CharacterCreateRequestInput, "hp" | "choices">): CharacterChoice[] {
  if (input.hp.mode !== "entries") return [];
  return (input.hp.entries ?? []).map((roll, index) => ({ level: index + 2, kind: "hp-roll", id: "hp", payload: { roll } }));
}

/** Rolled HP recovered from a stored ledger, or null when any level lacks a roll (the caller uses the average). */
export function storedHitPointRolls(choices: readonly CharacterChoice[], level: number): number[] | null {
  const rolls: number[] = [];
  for (let candidate = 2; candidate <= level; candidate += 1) {
    const row = choices.find((entry) => entry.kind === "hp-roll" && entry.level === candidate);
    const roll = row?.payload?.roll;
    if (typeof roll !== "number" || !Number.isInteger(roll) || roll < 1) return null;
    rolls.push(roll);
  }
  return rolls;
}

/** Everything steps 1-4 settled. The random generator picks from this same surface, so its picks and
 *  the validator cannot diverge. */
export type ServerOfferSurvey = Readonly<{
  offers: readonly ChoiceOffer[];
  classRecord: ClassReference;
  species: SpeciesReference;
  background: BackgroundReference;
  subclass: SubclassReference | null;
  lineage: SpeciesReference["lineages"][number] | null;
  originFeat: FeatReference | null;
  levelRow: ClassLevelRow;
  /** Every feature held so far with its provenance (the origin feat and chosen feats carry `origin: null`). */
  granted: ReadonlyArray<{ record: FeatureRecord; count: number; origin: CharacterFeatureOrigin | null }>;
  chosenFeats: readonly FeatReference[];
  /** Every feat id already held: the cross-offer duplicate guard. */
  heldFeatIds: ReadonlySet<string>;
  extraPickBudgets: ReadonlyMap<string, number>;
  preparedSpellRows: readonly CharacterChoice[];
  classCantripRows: readonly CharacterChoice[];
  /** The printed level-row columns, before `extraPickBudgets` is added (step 9 does that sum). */
  printedCantrips: number;
  printedPrepared: number;
  catalogs: CatalogChoiceCatalogs;
  progression: ClassProgressionTable;
  /** Ability scores after background and species bonuses, before any ASI or feature rider. */
  scoresBeforeIncreases: Record<Ability, number>;
  proficiencyBonus: number;
}>;

const CLASS_CANTRIP_BUDGET: NamedPickBudget = "class-cantrips";
const CLASS_SPELL_BUDGET: NamedPickBudget = "class-spells";

/** Runs steps 1-4 of `buildCharacterDefinition` without requiring the ledger to answer the offers yet. */
export function computeServerOffers(input: CharacterCreateRequestInput, library: ContentView, policy: BuilderPolicy): ServerOfferSurvey {
  return surveyBuild(input, library, policy, "offers");
}

function surveyBuild(input: CharacterCreateRequestInput, library: ContentView, policy: BuilderPolicy, mode: "build" | "offers"): ServerOfferSurvey {
  const catalogs = library.catalogChoiceCatalogs();
  const progression: ClassProgressionTable = library.classProgressionTable();

  // ---- 1. Identity ids resolve against the catalogs. ----
  // No multiclass prerequisite check: the input is single-class and SRD minimums apply to a second class.
  const classRecord: ClassReference = library.classRecord(input.classId) ?? reject(`No class "${input.classId}" is in the content catalog.`);
  const species: SpeciesReference = library.speciesRecord(input.speciesId) ?? reject(`No species "${input.speciesId}" is in the content catalog.`);
  const background: BackgroundReference = library.backgroundRecord(input.backgroundId) ?? reject(`No background "${input.backgroundId}" is in the content catalog.`);
  let subclass: SubclassReference | null = null;
  if (input.level >= classRecord.subclassLevel) {
    if (!input.subclassId) reject(`A level-${input.level} ${classRecord.name} has a ${classRecord.subclassLabel ?? "subclass"} (chosen at level ${classRecord.subclassLevel}).`);
    subclass = library.subclassRecord(input.subclassId!) ?? reject(`No subclass "${input.subclassId}" is in the content catalog.`);
    if (subclass.classId !== classRecord.id) reject(`${subclass.name} is a ${subclass.classId} subclass, not a ${classRecord.name} one.`);
  } else if (input.subclassId) {
    reject(`${classRecord.name} chooses its ${classRecord.subclassLabel ?? "subclass"} at level ${classRecord.subclassLevel}; a level-${input.level} character has none.`);
  }
  for (const row of input.choices) {
    if (row.level > input.level) reject(`A choice is recorded at level ${row.level}, above the character's level ${input.level}.`);
  }

  // ---- 2. Ability scores: method legality, base values, the background's printed spread. ----
  validateBaseScores(input, policy);
  validateBackgroundAllocation(input, background);
  const finalScores = { ...input.baseScores } as Record<Ability, number>;
  for (const entry of input.backgroundBonusAllocation) {
    finalScores[entry.ability] += entry.amount;
    if (finalScores[entry.ability] > 20) reject(`${entry.ability.toUpperCase()} would be ${finalScores[entry.ability]}; ability scores cannot be raised above 20.`);
  }
  for (const bonus of species.abilityBonuses) finalScores[bonus.ability] = Math.min(20, finalScores[bonus.ability] + bonus.amount);

  // Proficiency bonus tracks total character level (the multiclass rule), which equals class level here.
  const proficiencyBonus = proficiencyBonusForLevel(input.level);
  const { features: classFeatures, row: levelRow } = grantedClassFeatures(classRecord, input.level);

  // ---- 3. Collect every granted feature (class rows, subclass, species + lineage, background, origin feat). ----
  const chosenLineageId = input.choices.find((row) => row.kind === "lineage")?.id ?? null;
  const lineage = chosenLineageId
    ? species.lineages.find((candidate) => candidate.id === chosenLineageId) ?? reject(`"${species.name}" has no lineage "${chosenLineageId}".`)
    : null;
  // In "offers" mode the lineage may still be unanswered; answering it is the caller's job.
  if (mode === "build" && !chosenLineageId && species.traits.some((trait) => trait.choice?.kind === "lineage")) reject(`${species.name} asks for a lineage choice.`);
  const subclassFeatures = (subclass?.features ?? []).filter((feature) => (feature.level ?? subclass?.subclassLevel ?? classRecord.subclassLevel) <= input.level);
  const originFeat: FeatReference | null = background.originFeatId
    ? library.featRecord(background.originFeatId) ?? reject(`${background.name} grants unknown feat "${background.originFeatId}".`)
    : null;
  // Every feat this character already holds, granted or chosen - the cross-offer duplicate guard in pass A.
  const heldFeatIds = new Set<string>(originFeat ? [originFeat.id] : []);
  // `origin` becomes `definition.character.features` (how roll-time riders reach the table); null means
  // already on `character.feats`. `ORIGIN_STEP`: where origin picks sit in the wizard's grid.
  const ORIGIN_STEP = { levels: [1], classId: null } as const;
  const subclassStep = (record: FeatureRecord) => ({ levels: [record.level ?? subclass?.subclassLevel ?? classRecord.subclassLevel], classId: classRecord.id });
  const granted: Array<{ record: FeatureRecord; count: number; origin: CharacterFeatureOrigin | null; where?: { levels: readonly number[]; classId: string | null } }> = [
    ...[...classFeatures.values()].map((entry) => ({ ...entry, origin: { kind: "class", sourceId: classRecord.id } as const, where: { levels: entry.levels, classId: classRecord.id } })),
    ...subclassFeatures.map((record) => ({ record, count: 1, origin: { kind: "subclass", sourceId: subclass!.id } as const, where: subclassStep(record) })),
    ...species.traits.map((record) => ({ record, count: 1, origin: { kind: "species", sourceId: species.id } as const, where: ORIGIN_STEP })),
    ...(lineage?.traits ?? []).map((record) => ({ record, count: 1, origin: { kind: "lineage", sourceId: lineage!.id } as const, where: ORIGIN_STEP })),
    ...background.features.map((record) => ({ record, count: 1, origin: { kind: "background", sourceId: background.id } as const, where: ORIGIN_STEP })),
    ...(originFeat ? [{ record: originFeat.feature, count: 1, origin: null, where: ORIGIN_STEP }] : [])
  ];

  // ---- 4. Build the choice offers and match every ledger row against them. ----
  // Pass A settles chosen feats first, since a feat can ask for picks that pass B must see.
  const offers: ChoiceOffer[] = [];
  const listOffer = (key: NamedPickBudget, kind: string, label: string, list: { choose: number; from: readonly string[]; fromCatalog?: string } | undefined, classId: string | null) => {
    if (!list || list.choose <= 0) return;
    // A choose-N list may draw on an open catalog too (the species' Standard Languages), resolved through
    // the same `resolveCatalogChoice` the wizard uses; a catalog gap defers the pick.
    const options = new Set(list.from);
    let unresolvable: string | null = null;
    if (list.fromCatalog) {
      try {
        for (const option of resolveCatalogChoice(list.fromCatalog, catalogs)) options.add(option.id);
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        if (options.size === 0) unresolvable = error.message;
      }
    }
    offers.push(offerOf({ key, kind, capacity: list.choose, options, unresolvable, label, classId }));
  };
  listOffer("class-skills", "skill", `${classRecord.name} skills`, classRecord.skillChoices, classRecord.id);
  listOffer("class-tools", "tool", `${classRecord.name} tools`, classRecord.toolChoices, classRecord.id);
  listOffer("background-skills", "skill", `${background.name} skills`, background.skillChoices, null);
  listOffer("background-tools", "tool", `${background.name} tools`, background.toolChoices, null);
  listOffer("background-languages", "language", `${background.name} languages`, background.languageChoices, null);
  listOffer("species-languages", "language", `${species.name} languages`, species.languageChoices, null);
  // Whether an option is already in the ledger (what `options[].requires` gates on), scoped the way
  // `matchRow` scopes a row.
  const ledgerAnswered = (offerKey: string, optionId: string): boolean => {
    const featureId = offerKey.startsWith("feature:") ? offerKey.slice("feature:".length).replace(/\/\d+$/, "") : null;
    return input.choices.some((row) =>
      row.id === optionId
      && (featureId === null || (row.payload && typeof row.payload.featureId === "string" && row.payload.featureId === featureId)));
  };
  /** Options a gate determined rather than offered; drained into `granted` once every offer is built. */
  const determined: Array<{ option: FeatureOption; parentId: string; where: { levels: readonly number[]; classId: string | null } }> = [];
  /** What a budget already holds, read off the ledger (narrowed by `fromPicks`). */
  const NAMED_BUDGET_KIND: Readonly<Record<string, string>> = {
    "class-cantrips": "cantrip", "class-spells": "spell", "class-skills": "skill", "class-tools": "tool",
    "background-skills": "skill", "background-tools": "tool", "background-languages": "language", "species-languages": "language"
  };
  const answersFor = (offerKey: string): string[] => {
    if (offerKey.startsWith("feature:")) {
      const featureId = offerKey.slice("feature:".length).replace(/\/\d+$/, "");
      return input.choices.filter((row) => row.payload && row.payload.featureId === featureId).map((row) => row.id);
    }
    const kind = NAMED_BUDGET_KIND[offerKey];
    if (!kind) return [];
    return input.choices.filter((row) => row.kind === kind && !(row.payload && typeof row.payload.featureId === "string")).map((row) => row.id);
  };
  type OfferStep = Readonly<{ levels: readonly number[]; classId: string | null }>;
  const featureOffer = (record: FeatureRecord, count: number, featureAliases: readonly string[] = [], where: OfferStep = ORIGIN_STEP): void => {
    // Every pick the record owes becomes its own offer; the first keeps the plain `feature:<id>` key,
    // later ones take `/2`, `/3`, ...
    featurePicks(record).forEach((choice, index) => featurePickOffer(record, choice, index, count, featureAliases, where));
  };
  const featurePickOffer = (
    record: FeatureRecord, choice: NonNullable<FeatureRecord["choice"]>, index: number, count: number, featureAliases: readonly string[], where: OfferStep
  ): void => {
    if (choice.choose * count === 0) return;
    let options: ReadonlySet<string>;
    let optionLevels: ReadonlyMap<string, number> | null = null;
    let unresolvable: string | null = null;
    // Inline `options` carry their own mechanics. When both a catalog and bespoke options are authored
    // the offer is their union, matching the wizard.
    const named = choice.from ?? [];
    // Options drawn from the character's own earlier answers ("one of your known Warlock cantrips"),
    // read from `input.choices`, which is complete before any pass runs.
    if (choice.fromPicks) {
      try {
        const resolved = resolvePickChoice(choice.fromPicks, answersFor(choice.fromPicks.offer), catalogs);
        options = new Set(resolved.map((option) => option.id));
        if (resolved.some((option) => option.level !== undefined)) optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Nothing eligible chosen yet: defer like an unresolvable catalog; a row targeting it is still refused.
        options = new Set();
        unresolvable = error.message;
      }
    }
    else if (named.length > 0 && choice.fromCatalog) {
      const union = new Set(named);
      options = union;
      try {
        const resolved = resolveCatalogChoice(choice.fromCatalog, catalogs);
        for (const option of resolved) union.add(option.id);
        if (resolved.some((option) => option.level !== undefined)) optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        // The bespoke half still stands when the catalog half is a content gap.
        if (!(error instanceof CatalogChoiceError)) throw error;
      }
    }
    else if (named.length > 0) options = new Set(named);
    else if (!choice.fromCatalog) {
      // `{kind, choose, from: []}` passes the content schema but cannot resolve; reject it as bad content
      // instead of letting a raw TypeError reach the client.
      reject(`"${record.name}" offers a "${choice.kind}" choice with no options - its content record needs a non-empty "from" list or a "fromCatalog" slug.`);
    } else {
      try {
        const resolved = resolveCatalogChoice(choice.fromCatalog!, catalogs);
        options = new Set(resolved.map((option) => option.id));
        if (resolved.some((option) => option.level !== undefined)) optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Partial-content gap: the pick is deferred, but a row targeting it still fails with the resolver's message.
        options = new Set();
        unresolvable = error.message;
      }
    }
    /** Options gated on an earlier answer: unmet gates drop out, and if the survivors exactly fill the
     *  capacity they are adopted without pushing an offer. */
    let optionRecords = choice.options ?? null;
    if (optionRecords?.some((option) => option.requires)) {
      const legal = optionRecords.filter((option) => !option.requires || ledgerAnswered(option.requires.offer, option.requires.id));
      optionRecords = legal;
      options = new Set(legal.map((option) => option.id));
      if (legal.length === choice.choose * count) {
        for (const option of legal) determined.push({ option, parentId: record.id, where });
        return;
      }
    }
    offers.push(offerOf({
      key: index === 0 ? `feature:${record.id}` : `feature:${record.id}/${index + 1}`,
      featureId: record.id, featureAliases, kind: choice.kind, capacity: choice.choose * count,
      options, optionLevels, optionRecords, unresolvable, repeatable: choice.repeatable,
      maxSpellLevel: choice.maxSpellLevel ?? null, minSpellLevel: choice.minSpellLevel ?? null, maximum: choice.maximum ?? null, label: record.name,
      levels: where.levels, classId: where.classId
    }));
  };
  for (const { record, count, where } of granted) featureOffer(record, count, [], where);

  /** Adopts determined options; a queue, because an adopted option may determine another. */
  while (determined.length > 0) {
    const { option, parentId, where } = determined.shift()!;
    const asFeature = optionAsFeature(option);
    granted.push({ record: asFeature, count: 1, origin: { kind: "option", sourceId: parentId } });
    featureOffer(asFeature, 1, [parentId], where);
  }

  /** Extra picks raise a budget rather than grant an outcome. Grants add up; each is folded in as soon as
   *  its source is settled, because `matchRow` refuses picks over `capacity`. */
  const extraPickBudgets = new Map<string, number>();
  const grantExtraPicks = (record: FeatureRecord, count: number): void => {
    for (const grant of record.extraPicks) {
      // `extraPickAmount` is shared with the wizard so a scaled budget cannot be computed two ways.
      const amount = extraPickAmount(grant, classRecord.levelTable, input.level) * count;
      extraPickBudgets.set(grant.offer, (extraPickBudgets.get(grant.offer) ?? 0) + amount);
      // `class-cantrips` / `class-spells` are level-row columns read at step 9, so no matching offer is not yet an error.
      const offer = offers.find((candidate) => candidate.key === grant.offer);
      if (offer) offer.capacity += amount;
    }
  };
  for (const { record, count } of granted) grantExtraPicks(record, count);

  const featureTagOf = (row: CharacterChoice): string | null =>
    row.payload && typeof row.payload.featureId === "string" ? row.payload.featureId : null;
  const matchRow = (row: CharacterChoice, candidates: readonly ChoiceOffer[]): ChoiceOffer => {
    const featureTag = featureTagOf(row);
    const scoped = featureTag ? candidates.filter((offer) => offer.featureId === featureTag || offer.featureAliases.includes(featureTag)) : candidates;
    if (scoped.length === 0) reject(featureTag ? `No feature "${featureTag}" offers a "${row.kind}" choice.` : `Nothing in this build offers a "${row.kind}" choice.`);
    const gap = scoped.find((offer) => offer.unresolvable !== null);
    if (gap && !scoped.some((offer) => offer.options.has(row.id))) reject(`This build needs "${gap.label}" resolved, but ${gap.unresolvable}`);
    // Outside the spell-level window: say which bound and by how much.
    const outOfWindow = scoped.find((offer) => offer.options.has(row.id) && !withinSpellWindow(offer, row.id));
    if (outOfWindow && !scoped.some((offer) => offer.options.has(row.id) && withinSpellWindow(offer, row.id))) {
      const level = outOfWindow.optionLevels?.get(row.id) ?? 0;
      reject(outOfWindow.minSpellLevel !== null && level < outOfWindow.minSpellLevel
        ? `"${row.id}" is level ${level}, below the minimum spell level (${outOfWindow.minSpellLevel}) for "${outOfWindow.label}".`
        : `"${row.id}" is level ${level}, above the maximum spell level (${outOfWindow.maxSpellLevel}) for "${outOfWindow.label}".`);
    }
    const offer = scoped.find((candidate) =>
      candidate.options.has(row.id)
      && withinSpellWindow(candidate, row.id)
      && candidate.taken.length < candidate.capacity
      && (candidate.repeatable || !candidate.taken.includes(row.id)));
    if (!offer) {
      const anyHolds = scoped.some((candidate) => candidate.options.has(row.id));
      reject(anyHolds
        ? `The "${row.kind}" pick "${row.id}" exceeds what this build may choose (${scoped.map((candidate) => `${candidate.label}: ${candidate.capacity}`).join(", ")}).`
        : `"${row.id}" is not an offered option for the "${row.kind}" choice (${scoped.map((candidate) => candidate.label).join(", ")}).`);
    }
    offer.taken.push(row.id);
    return offer;
  };

  /** The single grant the just-taken row belongs to, so a feat taken at level 8 records its picks at 8. */
  const stepOfPick = (offer: ChoiceOffer): OfferStep =>
    ({ levels: [levelOfPick(offer, Math.max(0, offer.taken.length - 1))], classId: offer.classId });

  // Pass A: feat selections. "asi" is the built-in shorthand (payload.increases).
  const FEAT_KINDS = new Set(["feat", "fighting-style", "asi-or-feat"]);
  const chosenFeats: FeatReference[] = [];
  /** Where each chosen feat was taken; a feat's own picks belong to that offer's level/class. */
  const chosenFeatSteps: OfferStep[] = [];
  /** Inline options answered to a feat-kinded pick (Blessed Warrior, Druidic Warrior). */
  const chosenInlineStyles: FeatureRecord[] = [];
  for (const row of input.choices) {
    if (!FEAT_KINDS.has(row.kind)) continue;
    if (row.kind === "asi-or-feat" && row.id === "asi") {
      const offer = offers.find((candidate) => candidate.kind === "asi-or-feat" && candidate.taken.length < candidate.capacity)
        ?? reject(`No Ability Score Improvement is available to spend at level ${row.level}.`);
      offer.taken.push(row.id);
      continue;
    }
    const matched = matchRow(row, offers.filter((offer) => offer.kind === row.kind));
    // A feat-kinded pick may be answered by an inline option (Blessed Warrior beside the Fighting Style
    // catalog); it is interpreted like any chosen option in pass A2.
    const inlineOption = matched.optionRecords?.find((candidate) => candidate.id === row.id);
    if (inlineOption) {
      const asFeature = optionAsFeature(inlineOption);
      granted.push({ record: asFeature, count: 1, origin: matched.featureId ? { kind: "option", sourceId: matched.featureId } : null });
      featureOffer(asFeature, 1, matched.featureId ? [matched.featureId] : [], stepOfPick(matched));
      chosenInlineStyles.push(asFeature);
      continue;
    }
    const feat = library.featRecord(row.id) ?? reject(`No feat "${row.id}" is in the content catalog.`);
    // The same feat may not be taken twice across different offers (`repeatable:false` only guards one
    // offer). The held set includes the background's granted origin feat.
    if (heldFeatIds.has(feat.id)) {
      if (!feat.repeatable) reject(`${feat.name} is already on this character - a feat can only be taken once unless it says it is repeatable.`);
      if (repeatsOnlyWithADifferentSpellList(feat)) reject(`${feat.name} may be taken again only with a DIFFERENT spell list - choose another one.`);
    }
    heldFeatIds.add(feat.id);
    chosenFeats.push(feat);
    chosenFeatSteps.push(stepOfPick(matched));
  }
  // Chosen feats' features join the granted set: their choices become offers for pass B.
  for (const [index, feat] of chosenFeats.entries()) {
    granted.push({ record: feat.feature, count: 1, origin: null }); // recorded on `character.feats`
    featureOffer(feat.feature, 1, [], chosenFeatSteps[index]);
  }
  for (const feat of chosenFeats) grantExtraPicks(feat.feature, 1);
  for (const record of chosenInlineStyles) grantExtraPicks(record, 1);

  // Pass A2: picks whose options carry their own mechanics (Divine Order, Giant Ancestry, Blessed
  // Strikes). Settled before pass B because a chosen option can itself ask for a pick.
  const optionKinds = new Set(offers.filter((offer) => offer.optionRecords !== null).map((offer) => offer.kind));
  const chosenOptionFeatures: FeatureRecord[] = [];
  for (const row of input.choices) {
    if (!optionKinds.has(row.kind) || FEAT_KINDS.has(row.kind)) continue;
    const offer = matchRow(row, offers.filter((candidate) => candidate.kind === row.kind));
    const option = offer.optionRecords?.find((candidate) => candidate.id === row.id);
    if (!option) continue; // a bare id in a mixed-kind offer: provenance only, nothing to interpret
    const asFeature = optionAsFeature(option);
    // Recorded under the parent feature's id, which is where the catalog indexes the option.
    granted.push({ record: asFeature, count: 1, origin: offer.featureId ? { kind: "option", sourceId: offer.featureId } : null });
    // The option's own pick is keyed on the option id, with the parent feature id as an accepted alias.
    featureOffer(asFeature, 1, offer.featureId ? [offer.featureId] : [], stepOfPick(offer));
    chosenOptionFeatures.push(asFeature);
  }
  // Folded after the loop so the result does not depend on ledger order.
  for (const record of chosenOptionFeatures) grantExtraPicks(record, 1);

  // A budget key that names nothing is an authoring error and fails loudly; checked against this
  // build's real offers plus the two printed class columns.
  const printedCantrips = levelRow.cantripsKnown ?? 0;
  const printedPrepared = levelRow.preparedCount ?? levelRow.spellsKnown ?? 0;
  const namesARealBudget = (key: string): boolean =>
    offers.some((candidate) => candidate.key === key)
    || (key === CLASS_CANTRIP_BUDGET && printedCantrips > 0)
    || (key === CLASS_SPELL_BUDGET && printedPrepared > 0);
  for (const key of extraPickBudgets.keys()) {
    if (namesARealBudget(key)) continue;
    reject(`A feature grants an extra pick to "${key}", which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`);
  }
  // A `replaces` clause naming no pick this build has is the same authoring error.
  for (const { record } of granted) {
    for (const clause of record.replaces) {
      if (namesARealBudget(clause.offer)) continue;
      reject(`"${record.name}" says a pick to "${clause.offer}" may be replaced, which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`);
    }
  }

  // Pass B: everything else. Class spells/cantrips (step 9), equipment, size and the subclass row aren't
  // offers. `hp-roll` rows are build output, so an echoed ledger is accepted.
  const separateKinds = new Set(["equipment", "size", "hp-roll"]);
  const preparedSpellRows: CharacterChoice[] = [];
  const classCantripRows: CharacterChoice[] = [];
  for (const row of input.choices) {
    if (separateKinds.has(row.kind) || FEAT_KINDS.has(row.kind) || optionKinds.has(row.kind)) continue; // optionKinds were settled in pass A2
    if (row.kind === "subclass") {
      if (row.id !== input.subclassId) reject(`The subclass choice row ("${row.id}") disagrees with the chosen subclass "${input.subclassId ?? "none"}".`);
      const offer = offers.find((candidate) => candidate.kind === "subclass");
      if (offer) offer.taken.push(row.id);
      continue;
    }
    if (row.kind === "spell" || row.kind === "cantrip") {
      const featureTag = featureTagOf(row);
      const featureOffers = offers.filter((offer) => offer.kind === row.kind && offer.featureId !== null);
      const scoped = featureTag ? featureOffers.filter((offer) => offer.featureId === featureTag || offer.featureAliases.includes(featureTag)) : [];
      if (scoped.length > 0) { matchRow(row, scoped); continue; }
      if (featureTag) reject(`No feature "${featureTag}" offers a "${row.kind}" choice.`);
      (row.kind === "spell" ? preparedSpellRows : classCantripRows).push(row);
      continue;
    }
    matchRow(row, offers.filter((offer) => offer.kind === row.kind));
  }
  return {
    offers, classRecord, species, background, subclass, lineage, originFeat, levelRow, granted,
    chosenFeats, heldFeatIds, extraPickBudgets, preparedSpellRows, classCantripRows,
    printedCantrips, printedPrepared, catalogs, progression, scoresBeforeIncreases: finalScores, proficiencyBonus
  };
}

export function buildCharacterDefinition(input: CharacterCreateRequestInput, library: ContentView, policy: BuilderPolicy): ActorDefinition {
  const survey = surveyBuild(input, library, policy, "build");
  const {
    offers, classRecord, species, background, subclass, lineage, originFeat, levelRow, granted,
    chosenFeats, extraPickBudgets, preparedSpellRows, classCantripRows,
    printedCantrips, printedPrepared, catalogs, progression, proficiencyBonus
  } = survey;
  const finalScores = survey.scoresBeforeIncreases;

  // Completeness check: every offer answered. Not in the survey, because the generator surveys
  // half-answered builds on purpose.
  for (const offer of offers) {
    if (offer.kind === "subclass" || offer.unresolvable !== null) continue; // payload-mirrored / content-gap-deferred
    if (offer.taken.length !== offer.capacity) {
      reject(`"${offer.label}" needs ${offer.capacity} pick(s) of kind "${offer.kind}"; got ${offer.taken.length}.`);
    }
  }

  // ---- 5. Ability increases: the "asi" shorthand's payload, then chosen ability-score picks. ----
  for (const row of input.choices.filter((candidate) => candidate.kind === "asi-or-feat" && candidate.id === "asi")) {
    const payload = row.payload as { increases?: unknown } | undefined;
    if (!Array.isArray(payload?.increases) || payload.increases.length === 0) reject("An ASI choice needs payload.increases ([{ability, amount}]).");
    let total = 0;
    for (const increase of payload.increases as ReadonlyArray<{ ability?: unknown; amount?: unknown }>) {
      const ability = ABILITIES.find((candidate) => candidate === increase.ability) ?? reject("An ASI increase names an unknown ability.");
      const amount = typeof increase.amount === "number" && Number.isInteger(increase.amount) && increase.amount >= 1 && increase.amount <= 2
        ? increase.amount : reject("An ASI increase must be +1 or +2.");
      total += amount;
      finalScores[ability] += amount;
      if (finalScores[ability] > 20) reject(`${ability.toUpperCase()} would be ${finalScores[ability]}; the Ability Score Improvement cannot raise a score above 20.`);
    }
    if (total !== 2) reject("An Ability Score Improvement grants exactly +2 (one ability +2, or two abilities +1).");
  }
  // Each consumed "ability-score" pick is +1 (the choice vocabulary carries no amount). The ceiling is
  // the offer's `maximum` (epic boons allow 30), not a fixed 20.
  for (const offer of offers.filter((candidate) => candidate.kind === "ability-score")) {
    for (const taken of offer.taken) {
      const ability = ABILITIES.find((candidate) => candidate === taken) ?? reject(`"${taken}" is not an ability.`);
      finalScores[ability] = Math.min(offer.maximum ?? 20, finalScores[ability] + 1);
    }
  }
  for (const feat of chosenFeats) {
    if (feat.prerequisite?.level !== undefined && input.level < feat.prerequisite.level) reject(`${feat.name} requires level ${feat.prerequisite.level}.`);
    for (const minimum of feat.prerequisite?.abilityScores ?? []) {
      if (finalScores[minimum.ability] < minimum.minimum) reject(`${feat.name} requires ${minimum.ability.toUpperCase()} ${minimum.minimum}.`);
    }
    // `requires` slugs beyond level/ability minimums are prose-adjudicated (ADR-0008 fail-open).
  }

  // ---- 5c. Feature `ability-score` riders, before any feature is interpreted: `interpretAction`
  // derives DCs from `finalScores`, so capstones (Primal Champion) must already apply. ----
  for (const { record } of granted) {
    for (const modifier of record.modifiers) {
      if (modifier.type !== "ability-score") continue;
      finalScores[modifier.ability] = Math.min(modifier.maximum ?? 20, finalScores[modifier.ability] + modifier.amount);
    }
  }

  // ---- 6. Interpret every granted feature. Roll-time riders reach the table as carriers. ----
  const casting = subclass?.spellcasting ?? classRecord.spellcasting ?? null;
  const context: BuildContext = { level: input.level, proficiencyBonus, finalScores, spellcastingAbility: casting?.ability ?? null, classResources: levelRow.classResources };
  const interpreted: InterpretedFeatures = {
    actions: [], traits: [], grantedSkills: [], grantedExpertise: [], grantedTools: [], grantedLanguages: [],
    grantedArmor: [], grantedWeapons: [], grantedSaves: [], damageResistances: [], damageImmunities: [],
    conditionImmunities: [], grantedSpells: [], hitPointsPerLevel: 0, speedBonus: 0,
    armorClassBonus: 0, armorClassBonusWhileArmored: 0, initiativeBonus: 0, unarmoredDefense: null
  };
  for (const { record } of granted) interpretFeature(record, interpreted, context);
  // Martial Arts runs after the features so an id a feature already declared keeps it.
  const strike = martialArtsStrike(context);
  if (strike && !interpreted.actions.some((existing) => existing.id === strike.id)) interpreted.actions.push(strike);
  // `definition.character.features`, deduped on `{kind, sourceId, id}` so no record gets two carriers.
  // `origin: null` rows are skipped: they are already on `character.feats`.
  const heldFeatures = dedupeFeatureRefs(granted);

  // ---- 7. Hit points: rules-5e pool math; "entries" applies the product default max(roll, average). ----
  const conModifier = abilityModifier(finalScores.con);
  const faces = hitDieFaces(classRecord.hitDie);
  const classLevels = [{ classId: classRecord.id, level: input.level, hitDie: classRecord.hitDie }];
  let hitPointMaximum: number;
  if (input.hp.mode === "average") {
    hitPointMaximum = hitPointPool(classLevels, conModifier, "average", [], progression);
  } else {
    const entries = input.hp.entries ?? [];
    if (entries.length !== input.level - 1) reject(`Rolled hit points need exactly ${input.level - 1} entries (levels 2-${input.level}); got ${entries.length}.`);
    for (const entry of entries) {
      if (!Number.isInteger(entry) || entry < 1 || entry > faces) reject(`A ${classRecord.hitDie} hit-point roll must be 1-${faces}; got ${entry}.`);
    }
    // Product rule: rolling can only help, max(roll, average).
    hitPointMaximum = hitPointPool(classLevels, conModifier, "max-of-both", entries, progression);
  }
  hitPointMaximum = Math.max(1, hitPointMaximum + interpreted.hitPointsPerLevel * input.level);

  // ---- 8. Proficiencies: class saves + every consumed pick + fixed grants from all sources. ----
  const takenOf = (kind: string) => offers.filter((offer) => offer.kind === kind).flatMap((offer) => offer.taken);
  // "skill-or-tool" picks (the Skilled feat) split by what the id actually is in the skills catalog.
  const skillIds = new Set(catalogs.skills.map((skill) => skill.id));
  const skillOrTool = takenOf("skill-or-tool");
  const skillTaken = [...takenOf("skill"), ...skillOrTool.filter((id) => skillIds.has(id)), ...background.skillProficiencies, ...interpreted.grantedSkills];
  const expertiseTaken = [...takenOf("expertise"), ...interpreted.grantedExpertise];
  for (const skill of expertiseTaken) {
    if (!skillTaken.includes(skill)) reject(`Expertise in "${skill}" requires proficiency in it first.`);
  }
  const proficiencies = {
    saves: dedupe([...classRecord.savingThrows, ...interpreted.grantedSaves]),
    skills: dedupe(skillTaken).map((id) => ({ id, proficiency: expertiseTaken.includes(id) ? "expertise" : "proficient" })),
    armor: dedupe([...classRecord.armorProficiencies, ...interpreted.grantedArmor]),
    weapons: dedupe([...classRecord.weaponProficiencies, ...interpreted.grantedWeapons]),
    tools: dedupe([...classRecord.toolProficiencies, ...takenOf("tool"), ...skillOrTool.filter((id) => !skillIds.has(id)), ...background.toolProficiencies, ...interpreted.grantedTools]),
    languages: dedupe([...species.languages, ...takenOf("language"), ...background.languages, ...interpreted.grantedLanguages])
  };

  // ---- 9. Spellcasting: the class's level row (slots, cantrips, prepared cap) + chosen + granted spells. ----
  // Feature-consumed spell/cantrip picks join the list outside the class budgets.
  const featureSpellPicks = offers.filter((offer) => offer.kind === "spell" && offer.featureId !== null).flatMap((offer) => offer.taken);
  const featureCantripPicks = offers.filter((offer) => offer.kind === "cantrip" && offer.featureId !== null).flatMap((offer) => offer.taken);
  const grantedSpellEntry = (grantedSpell: InterpretedFeatures["grantedSpells"][number]) => {
    const record = library.spellRecord(grantedSpell.id);
    return { id: grantedSpell.id, name: record?.name ?? grantedSpell.id, level: grantedSpell.level ?? record?.level ?? 0, prepared: true, alwaysPrepared: grantedSpell.alwaysPrepared };
  };
  let spellcasting: Record<string, unknown> | undefined;
  if (casting) {
    const listSlug = `${casting.spellListId ?? classRecord.id}-spells`;
    let listOptions: Map<string, { id: string; name: string; level?: number }>;
    try {
      listOptions = new Map(resolveCatalogChoice(listSlug, catalogs).map((option) => [option.id, option]));
    } catch (error) {
      if (error instanceof CatalogChoiceError) reject(`The ${classRecord.name} spell list could not be resolved: ${error.message}`);
      throw error;
    }
    // Pact Magic is N slots all of one level, rising by replacing that level, so `pactSlots` replaces
    // `spellSlots` rather than merging with it.
    const slots = levelRow.pactSlots
      ? (levelRow.pactSlots.slots > 0 ? [{ level: levelRow.pactSlots.level, max: levelRow.pactSlots.slots }] : [])
      : (levelRow.spellSlots ?? []).map((count, index) => ({ level: index + 1, max: count })).filter((slot) => slot.max > 0);
    const maxSlotLevel = slots.reduce((highest, slot) => Math.max(highest, slot.level), 0);
    // SRD: an always-prepared granted spell doesn't count against the prepared limit, so the grant wins
    // and a matching pick is not charged to the cap.
    const alwaysPreparedGrants = new Set(interpreted.grantedSpells.filter((granted) => granted.alwaysPrepared).map((granted) => granted.id));
    const chargedCantripRows = classCantripRows.filter((row) => !alwaysPreparedGrants.has(row.id));
    const chargedPreparedRows = preparedSpellRows.filter((row) => !alwaysPreparedGrants.has(row.id));
    // The printed row plus granted extras (Thaumaturge's extra cantrip); the wizard composes the same sum.
    const cantripCap = printedCantrips + (extraPickBudgets.get(CLASS_CANTRIP_BUDGET) ?? 0);
    if (chargedCantripRows.length > cantripCap) reject(`${classRecord.name} knows ${cantripCap} cantrips at level ${input.level}; got ${chargedCantripRows.length}.`);
    const preparedCap = printedPrepared + (extraPickBudgets.get(CLASS_SPELL_BUDGET) ?? 0);
    if (chargedPreparedRows.length > preparedCap) reject(`${classRecord.name} ${casting.prepares === "prepared" ? "prepares" : "knows"} ${preparedCap} spells at level ${input.level}; got ${chargedPreparedRows.length}.`);
    const spells: Array<Record<string, unknown>> = [];
    // Every id the ledger claimed, so "chosen twice" still rejects when both rows defer to one grant.
    const claimedSpellIds = new Set<string>();
    for (const row of classCantripRows) {
      const option = listOptions.get(row.id) ?? reject(`"${row.id}" is not on the ${classRecord.name} spell list.`);
      if (option.level !== 0) reject(`"${row.id}" is a level-${option.level} spell, not a cantrip.`);
      if (claimedSpellIds.has(option.id)) reject(`"${row.id}" is chosen twice.`);
      claimedSpellIds.add(option.id);
      if (alwaysPreparedGrants.has(option.id)) continue; // the grant supplies it, uncharged
      spells.push({ id: option.id, name: option.name, level: 0, prepared: true, alwaysPrepared: true });
    }
    for (const row of preparedSpellRows) {
      const option = listOptions.get(row.id) ?? reject(`"${row.id}" is not on the ${classRecord.name} spell list.`);
      const spellLevel = option.level ?? 0;
      if (spellLevel < 1) reject(`"${row.id}" is a cantrip - record it as a "cantrip" choice.`);
      if (spellLevel > maxSlotLevel) reject(`"${row.id}" is level ${spellLevel}, above the highest slot level (${maxSlotLevel}) at ${classRecord.name} ${input.level}.`);
      if (claimedSpellIds.has(option.id)) reject(`"${row.id}" is chosen twice.`);
      claimedSpellIds.add(option.id);
      if (alwaysPreparedGrants.has(option.id)) continue; // the grant supplies it, uncharged and always prepared
      spells.push({ id: option.id, name: option.name, level: spellLevel, prepared: true, alwaysPrepared: false, classId: classRecord.id });
    }
    // A feature pick that duplicates an always-prepared grant defers to the grant, like a class pick.
    for (const id of featureCantripPicks) {
      const record = library.spellRecord(id);
      if (!alwaysPreparedGrants.has(id) && !spells.some((existing) => existing.id === id)) spells.push({ id, name: record?.name ?? id, level: record?.level ?? 0, prepared: true, alwaysPrepared: true });
    }
    for (const id of featureSpellPicks) {
      const record = library.spellRecord(id);
      if (!alwaysPreparedGrants.has(id) && !spells.some((existing) => existing.id === id)) spells.push({ id, name: record?.name ?? id, level: record?.level ?? 1, prepared: true, alwaysPrepared: false, classId: classRecord.id });
    }
    for (const grantedSpell of interpreted.grantedSpells) {
      if (!spells.some((existing) => existing.id === grantedSpell.id)) spells.push(grantedSpellEntry(grantedSpell));
    }
    const saveDc = spellSaveDc(finalScores[casting.ability], proficiencyBonus);
    const attackBonus = spellAttackBonus(finalScores[casting.ability], proficiencyBonus);
    // Cantrips become actions with this caster's numbers; the sheet sends only an id.
    linkCantripActions(spells, interpreted.actions, { attackBonus, saveDc }, library);
    // Top-level fields stay populated (the schema demands the combined pool when per-class slots exist).
    spellcasting = {
      ability: casting.ability, saveDc, attackBonus, slots,
      // `prepared` is the composed cap the sheet shows.
      classes: [{ classId: classRecord.id, ability: casting.ability, saveDc, attackBonus, slots, ...(levelRow.preparedCount !== undefined ? { prepared: preparedCap } : {}) }],
      spells
    };
  } else {
    if (preparedSpellRows.length > 0 || classCantripRows.length > 0) reject(`${classRecord.name} has no spell list to choose spells from.`);
    const extraSpells = [
      ...interpreted.grantedSpells.map(grantedSpellEntry),
      ...featureCantripPicks.map((id) => { const record = library.spellRecord(id); return { id, name: record?.name ?? id, level: record?.level ?? 0, prepared: true, alwaysPrepared: true }; }),
      ...featureSpellPicks.map((id) => { const record = library.spellRecord(id); return { id, name: record?.name ?? id, level: record?.level ?? 1, prepared: true, alwaysPrepared: true }; })
    ].filter((spell, index, all) => all.findIndex((other) => other.id === spell.id) === index);
    if (extraSpells.length > 0) {
      // A non-caster with granted/feat spells: model them so the sheet can cast them.
      const ability = interpreted.grantedSpells.find((spell) => spell.ability)?.ability ?? "int";
      const saveDc = spellSaveDc(finalScores[ability], proficiencyBonus);
      const attackBonus = spellAttackBonus(finalScores[ability], proficiencyBonus);
      // A non-caster's cantrip gets an action too, using the fallback ability above.
      linkCantripActions(extraSpells, interpreted.actions, { attackBonus, saveDc }, library);
      spellcasting = {
        ability, saveDc, attackBonus,
        slots: [],
        spells: extraSpells
      };
    }
  }

  // ---- 10. Starting inventory: the chosen class + background equipment options, catalog-resolved. ----
  const equipmentRows = input.choices.filter((row) => row.kind === "equipment");
  const inventory: InventoryItem[] = [];
  let goldPieces = 0;
  const consumeEquipmentOption = (source: "class" | "background", options: ClassReference["startingEquipment"]) => {
    if (options.length === 0) return;
    const optionIds = new Set(options.map((option) => option.id));
    const matches = equipmentRows.filter((row) => optionIds.has(row.id));
    if (matches.length !== 1) reject(`Choose exactly one ${source} equipment option (${options.map((option) => option.id).join(", ")}).`);
    const chosen = options.find((option) => option.id === matches[0].id)!;
    goldPieces += chosen.goldPieces;
    for (const item of chosen.items) {
      const existing = inventory.find((candidate) => candidate.id === item.id);
      if (existing) { existing.quantity += item.quantity; continue; }
      // A cataloged item carries its mechanics; an unknown item stays display-only (ADR-0008 fail-open).
      const record = library.equipmentRecord(item.id);
      // Starting equipment mints without a picker, so template items go through the same server-side bind:
      // a single-base template auto-binds, a multi-base one stays unbound for the sheet's chooser.
      inventory.push(bindTemplateItem({
        id: item.id, name: record?.name ?? item.name, quantity: item.quantity,
        equipped: record ? record.category === "armor" || record.category === "shield" || record.category === "weapon" : false,
        attuned: false,
        ...(record?.weightLb !== null && record?.weightLb !== undefined ? { weightEach: record.weightLb } : {}),
        ...(record?.description ? { description: record.description.slice(0, 4000) } : {}),
        ...(record ? { category: record.category } : {}),
        // `mastery` is not copied: it resolves against the catalog and is gated on the bearer having unlocked
        // this weapon. Omit `properties` when the catalog records none (absent means "not recorded").
        ...(record?.weapon ? { weapon: { category: record.weapon.category, damageDice: record.weapon.damageDice, damageType: record.weapon.damageType, rangeFeet: record.weapon.rangeFeet, longRangeFeet: record.weapon.longRangeFeet, ...(record.weapon.properties ? { properties: [...record.weapon.properties] } : {}) } } : {}),
        ...(record?.armor ? { armor: { acBase: record.armor.acBase, addDexModifier: record.armor.addDexModifier, dexModifierCap: record.armor.dexModifierCap, stealthDisadvantage: record.armor.stealthDisadvantage, strengthRequired: record.armor.strengthRequired } } : {})
      }, { catalog: { equipmentRecord: (id) => library.equipmentRecord(id), featRecord: () => undefined } }));
    }
  };
  consumeEquipmentOption("class", classRecord.startingEquipment);
  consumeEquipmentOption("background", background.startingEquipment);
  const strayEquipment = equipmentRows.find((row) =>
    !classRecord.startingEquipment.some((option) => option.id === row.id) && !background.startingEquipment.some((option) => option.id === row.id));
  if (strayEquipment) reject(`"${strayEquipment.id}" is not a ${classRecord.name} or ${background.name} equipment option.`);
  // Only one body armor stays equipped (two would fight over derived AC); keep the best base.
  const equippedArmor = inventory.filter((item) => item.category === "armor" && item.equipped);
  for (const extra of equippedArmor.sort((left, right) => (right.armor?.acBase ?? 0) - (left.armor?.acBase ?? 0)).slice(1)) extra.equipped = false;

  // ---- 11. Size, speed, AC, initiative, Extra Attack. ----
  const sizeRow = input.choices.find((row) => row.kind === "size");
  const size: ActorDefinition["size"] = sizeRow
    ? ((species.sizes as readonly string[]).includes(sizeRow.id)
      ? sizeRow.id as ActorDefinition["size"]
      : reject(`${species.name} may be ${species.sizes.join(" or ")}, not "${sizeRow.id}".`))
    : (species.sizes.includes("medium") ? "medium" : species.sizes[0]);
  const speedFeet = Math.max(0, species.speedFeet + interpreted.speedBonus);
  const dexModifier = abilityModifier(finalScores.dex);
  // The same AC function `instantiate` re-runs. Unarmored Defense is passed into the equipment step
  // because a shield alone makes it answer; `allowShield` decides whether it still applies.
  const unarmoredDefense = interpreted.unarmoredDefense
    ? { bonus: abilityModifier(finalScores[interpreted.unarmoredDefense.ability]), allowShield: interpreted.unarmoredDefense.allowShield }
    : null;
  const equipmentAc = armorClassFromEquipment(dexModifier, inventory, unarmoredDefense);
  const unarmoredAc = unarmoredDefense ? 10 + dexModifier + unarmoredDefense.bonus : null;
  const wearingArmor = inventory.some((item) => item.equipped && item.category === "armor" && item.armor);
  // The flat non-equipment part of AC travels in the definition's extension bag so `instantiate` can
  // re-derive AC from the live loadout without dropping it (`armorClassRiderOf` in actor-roster.ts).
  const armorClassRider = interpreted.armorClassBonus + (wearingArmor ? interpreted.armorClassBonusWhileArmored : 0);
  const armorClass = (equipmentAc ?? unarmoredAc ?? 10 + dexModifier) + armorClassRider;
  const initiativeBonus = dexModifier + interpreted.initiativeBonus;

  // ---- 12. Assemble, validate through the canonical schema, done. ----
  const summary = [`Level ${input.level} ${species.name}${lineage ? ` (${lineage.name})` : ""} ${classRecord.name}${subclass ? ` (${subclass.name})` : ""}`, background.name].join(" · ").slice(0, 280);
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "OzyVTT Character Builder", version: "1" },
    name: input.name,
    summary,
    size,
    abilityScores: finalScores,
    proficiencyBonus,
    armorClass,
    hitPoints: { maximum: hitPointMaximum, formula: `${input.level}d${faces}` },
    initiativeBonus,
    speedFeet,
    actions: interpreted.actions,
    token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
    // Every feature lands as a trait. `unarmoredDefense` (stored as the ability) survives AC re-derivation.
    extensions: {
      "open5e.srd-2024": {
        traits: interpreted.traits,
        ...(armorClassRider !== 0 ? { armorClassBonus: armorClassRider } : {}),
        ...(interpreted.unarmoredDefense ? { unarmoredDefense: { ability: interpreted.unarmoredDefense.ability, allowShield: interpreted.unarmoredDefense.allowShield } } : {})
      }
    },
    ...(interpreted.damageResistances.length > 0 ? { damageResistances: dedupe(interpreted.damageResistances) } : {}),
    ...(interpreted.damageImmunities.length > 0 ? { damageImmunities: dedupe(interpreted.damageImmunities) } : {}),
    ...(interpreted.conditionImmunities.length > 0 ? { conditionImmunities: dedupe(interpreted.conditionImmunities) } : {}),
    character: {
      classes: [{ id: classRecord.id, name: classRecord.name, level: input.level, hitDie: classRecord.hitDie, ...(subclass ? { subclass: { id: subclass.id, name: subclass.name } } : {}) }],
      race: { id: species.id, name: species.name, ...(lineage ? { subrace: { id: lineage.id, name: lineage.name } } : {}) },
      background: { id: background.id, name: background.name },
      feats: [
        ...(originFeat ? [{ id: originFeat.id, name: originFeat.name, description: originFeat.feature.description.slice(0, 4000) }] : []),
        ...chosenFeats.map((feat) => ({ id: feat.id, name: feat.name, description: feat.feature.description.slice(0, 4000) }))
      ],
      // Ids and provenance only; riders stay on the catalog record and are recomputed on every read.
      features: heldFeatures,
      // The provenance ledger verbatim (level-up and respec prefill from it), plus the rolled hit points
      // so a level-down/level-up round trip can restore the character.
      choices: [...input.choices.filter((row) => row.kind !== "hp-roll"), ...hitPointRollRows(input)]
    },
    proficiencies,
    ...(spellcasting ? { spellcasting } : {}),
    startingInventory: inventory,
    startingCurrency: { cp: 0, sp: 0, ep: 0, gp: goldPieces, pp: 0 }
  });
}

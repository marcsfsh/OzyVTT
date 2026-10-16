import type { BuilderPolicy } from "@vtt/domain";
import { CatalogChoiceError, resolveCatalogChoice } from "@vtt/domain";
import {
  ActorDefinitionSchema,
  type ActorAction,
  type ActorDefinition,
  type CharacterChoice,
  type InventoryItem
} from "@vtt/schemas";
import {
  ABILITIES,
  abilityModifier,
  armorClassFromEquipment,
  hitDieFaces,
  hitPointPool,
  spellAttackBonus,
  spellSaveDc,
  type Ability
} from "@vtt/rules-5e";
import {
  cantripScalingOf,
  cantripTierAt,
  type ClassLevelRow,
  type ClassReference,
  type FeatureRecord,
  type Modifier,
  type SpellReference
} from "@vtt/content-srd-5.2.1";
import {
  CLASS_CANTRIP_BUDGET,
  CLASS_SPELL_BUDGET,
  surveyForBuild,
  type CharacterFeatureOrigin
} from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { BUILDER_BAKED_MODIFIER_TYPES, type CharacterFeatureRef } from "./equipment-derivation.js";
import { spellCastMechanics, UNARMED_STRIKE_ACTION_ID } from "./item-actions.js";
import { bindTemplateItem } from "./inventory.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * Server-side character assembly for `character.create`. The client sends choices, never a finished
 * sheet, so only the server interprets feature riders. Validates every id and pick through the offer
 * survey the builder is served (`character-offers.ts`), interprets riders (unmodeled mechanics stay
 * prose, ADR-0008), assembles the `ActorDefinition` with `@vtt/rules-5e` math and re-validates it.
 *
 * Ledger-row conventions (`builder-offers.ts` writes the wizard's rows; the generator writes the same):
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

function reject(message: string): never {
  throw new CommandRejectedError(message);
}
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
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
  grantedSpells: Array<{
    id: string;
    level: number | undefined;
    alwaysPrepared: boolean;
    ability: Ability | undefined;
    /** A free casting's uses (the granting feature's own); null for at will; absent when only a slot casts it. */
    free?: ActorAction["uses"] | null;
    withSlot: boolean;
  }>;
  hitPointsPerLevel: number;
  speedBonus: number;
  armorClassBonus: number;
  /** Flat AC that applies only while body armor is worn (Defense fighting style). */
  armorClassBonusWhileArmored: number;
  initiativeBonus: number;
  unarmoredDefense: { ability: Ability; allowShield: boolean } | null;
};

// Rider ownership: of the `ModifierSchema` variants, this fold bakes some and the roll-time collector owns
// the rest. Both halves are named so neither can grow a hole.
type CarrierRiderType = Exclude<Modifier["type"], (typeof BUILDER_BAKED_MODIFIER_TYPES)[number]>;

/** The roll-time half of the rider partition; a `Record` so a new variant must be assigned or the build
 *  fails. These reach the table as rider carriers via `deriveEquipment`. Values record where each is
 *  consumed ("unread": no consumer yet). */
const CARRIER_RIDER_DISPOSITION: Readonly<
  Record<CarrierRiderType, "standing" | "at-its-moment" | "unread" | "display-only">
> = {
  "attack-bonus": "standing", // effective-actions folds it into attack.bonus; action-resolution adds the on-attack-roll half
  "save-bonus": "standing", // saving-throws.ts saveRiderBonus (standing + on-saving-throw)
  "spell-save-dc": "standing", // effective-actions folds it into save.dc where the DC is the spell save DC
  "spell-slot": "standing", // spellSlotMaxima, via derivation.spellSlots
  "resource-bonus": "standing", // effective-actions usesBonus raises uses.limit
  "critical-range": "standing", // effective-actions criticalThreshold
  "critical-bonus-dice": "standing", // effective-actions folds it into attack.criticalBonusDice
  "extra-attack": "standing", // effective-actions extraAttacksFor raises attack.count on a weapon swing
  "roll-mode": "at-its-moment", // rollModeClaims: attacks, saves, checks, initiative
  "extra-damage": "at-its-moment", // resolution/damage.ts rolls it as its own typed damage entry
  "damage-bonus": "standing", // effective-actions folds it into the first damage part's formula; a moment-gated one lands as a bonusDamage line in resolution/damage.ts
  "check-bonus": "standing", // checkRiderBonus, into every check and skill row and the builtin checks
  "spell-attack-bonus": "unread", // no spell-attack path reads it yet
  "damage-reduction": "at-its-moment", // hit-points.ts damageReductionFor, applied to the total after resistances
  "damage-resistance": "standing", // derivation.damageResistances, beside the definition's own
  "damage-vulnerability": "standing", // derivation.damageVulnerabilities, beside the definition's own
  sense: "display-only" // like `darkvision`: the trait prose carries it; no definition field models senses
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
  if (scaling.type === "ability-modifier")
    return Math.max(scaling.minimum, abilityModifier(context.finalScores[scaling.ability]));
  if (scaling.type === "class-resource") {
    // The printed class column at this level is the count; a dice-string amount ("3d6") resolves to 0.
    const amount = context.classResources.find((resource) => resource.id === scaling.id)?.amount;
    return typeof amount === "number" ? amount : 0;
  }
  const rows = [...scaling.table]
    .filter((row) => row.level <= context.level)
    .sort((left, right) => left.level - right.level);
  return rows.length > 0 ? rows[rows.length - 1].limit : 0;
}

/** A feature action as a definition action, resolving the rider templates' to-hit and DC from the character's numbers. */
function interpretAction(
  feature: FeatureRecord,
  action: FeatureRecord["actions"][number],
  context: BuildContext
): ActorAction {
  const { attack, save, damageByLevel, multiattackByLevel, ...carried } = action;
  const assembled: Record<string, unknown> = { ...carried };
  if (attack) {
    const ability = attack.ability === "spellcasting" ? context.spellcastingAbility : attack.ability;
    if (!ability)
      reject(`"${feature.name}" attacks with the spellcasting ability, but this class has no spellcasting.`);
    const { ability: _ability, proficient, ...attackRest } = attack;
    assembled.attack = {
      bonus: abilityModifier(context.finalScores[ability]) + (proficient ? context.proficiencyBonus : 0),
      ...attackRest
    };
  }
  if (save) {
    if (save.dc === "spellcasting" && context.spellcastingAbility === null)
      reject(`"${feature.name}" uses the spell save DC, but this class has no spellcasting.`);
    // `FeatureSaveDcSchema` has three forms: "spellcasting", a number, and `{base, ability,
    // proficiencyBonus}` (Dragonborn Breath Weapon, 8 + CON + PB). All must resolve to a number.
    const dc =
      save.dc === "spellcasting"
        ? spellSaveDc(context.finalScores[context.spellcastingAbility!], context.proficiencyBonus)
        : typeof save.dc === "number"
          ? save.dc
          : save.dc.base +
            abilityModifier(context.finalScores[save.dc.ability]) +
            (save.dc.proficiencyBonus ? context.proficiencyBonus : 0);
    assembled.save = { ...save, dc, ...(save.dc === "spellcasting" ? { spellcasting: true } : {}) };
  }
  if (damageByLevel && damageByLevel.length > 0) {
    const rows = [...damageByLevel]
      .filter((row) => row.level <= context.level)
      .sort((left, right) => left.level - right.level);
    if (rows.length > 0)
      assembled.damage = [{ formula: rows[rows.length - 1].formula, type: rows[rows.length - 1].type }];
  }
  const plan = (multiattackByLevel ?? []).filter((row) => row.level <= context.level).sort((a, b) => a.level - b.level);
  if (plan.length > 0) assembled.multiattack = plan[plan.length - 1].multiattack;
  // The feature's limited uses ride the action when the action declares none of its own.
  if (feature.uses && assembled.uses === undefined) {
    const limit = resolvedUseLimit(feature.uses, context);
    if (limit >= 1) {
      assembled.uses = {
        limit: Math.min(20, limit),
        per: feature.uses.per,
        ...(feature.uses.pool ? { pool: feature.uses.pool } : {})
      };
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
 * and an action is minted only for typed damage or a save (save outranks attack). Scaled by character
 * level from the printed rows (Fire Bolt's 2d10 at 5, Eldritch Blast's second beam), as the sheet is.
 */
function cantripActionFor(
  spell: SpellReference,
  numbers: Readonly<{ attackBonus: number; saveDc: number; characterLevel: number }>
): ActorAction | null {
  if (spell.level !== 0) return null;
  const tier = cantripTierAt(cantripScalingOf(spell.castingOptions), numbers.characterLevel);
  const mechanics = spellCastMechanics(
    spell,
    { attackBonus: numbers.attackBonus, saveDc: numbers.saveDc, bearersDc: true, modifier: 0 },
    {
      roll: tier?.damageRoll ?? null,
      ...(tier?.targetCount && spell.effect?.attacks ? { attacks: tier.targetCount } : {})
    }
  );
  if (mechanics.damage.length === 0 && !mechanics.save) return null;
  return {
    id: spellActionId(spell.id),
    name: spell.name,
    activation: activationOf(spell.castingTime),
    description: spell.description.slice(0, 12000),
    ...mechanics,
    ...(spell.area ? { area: spell.area } : {}),
    ...(spell.effect?.reaction ? { reaction: spell.effect.reaction } : {}),
    // `spell-id-is` riders (Agonizing Blast) match on this field alone.
    spellId: spell.id
  } as ActorAction;
}

/** The action economy a casting time names ("1 action", "1 bonus action", "1 reaction, which you take when..."). */
function activationOf(castingTime: string): ActorAction["activation"] {
  if (/bonus/i.test(castingTime)) return "bonus-action";
  if (/reaction/i.test(castingTime)) return "reaction";
  return /^(?:1 )?action$/i.test(castingTime.trim()) ? "action" : "other";
}

type CasterNumbers = Readonly<{ attackBonus: number; saveDc: number; characterLevel: number; modifier: number }>;

/**
 * A leveled spell as an action. Cast with a slot, it carries `spellSlot` at the spell's level, which the economy
 * spends (a higher slot on request, upcasting the dice). Cast without one (`free`), it spends the granting
 * feature's uses, or nothing at will. Null for an at-will cast with nothing to resolve.
 */
function leveledSpellActionFor(
  spell: SpellReference,
  numbers: CasterNumbers,
  free?: ActorAction["uses"] | null
): ActorAction | null {
  const mechanics = spellCastMechanics(
    spell,
    { attackBonus: numbers.attackBonus, saveDc: numbers.saveDc, bearersDc: true, modifier: numbers.modifier },
    {}
  );
  // A reaction the table can offer (Shield) is something to resolve too.
  const resolvable =
    mechanics.damage.length > 0 ||
    mechanics.save !== undefined ||
    mechanics.healing !== undefined ||
    mechanics.attack ||
    spell.effect?.reaction !== undefined;
  if (free === null && !resolvable) return null;
  const freeCast = free !== undefined;
  return {
    id: freeCast ? `${spellActionId(spell.id)}-free` : spellActionId(spell.id),
    name: freeCast ? `${spell.name} (no slot)` : spell.name,
    activation: activationOf(spell.castingTime),
    description: spell.description.slice(0, 12000),
    ...mechanics,
    ...(spell.area ? { area: spell.area } : {}),
    // A reaction spell's trigger rides its action, so the table offers it (Shield when an attack would hit).
    ...(spell.effect?.reaction ? { reaction: spell.effect.reaction } : {}),
    ...(freeCast ? (free ? { uses: free } : {}) : { spellSlot: { level: spell.level } }),
    spellId: spell.id
  } as ActorAction;
}

/** `ActorDefinitionSchema`'s cap on a sheet's actions; spells past it keep their sheet entry without an action. */
const MAX_DEFINITION_ACTIONS = 100;

/**
 * Mints and links each spell's actions: a cantrip's (`actionId`), a leveled spell's slot cast (`actionId`, when the
 * sheet has slots and the spell may use one) and a grant's free cast (`freeActionId`). Mutates the list in place.
 */
function linkSpellActions(
  spells: Array<Record<string, unknown>>,
  into: ActorAction[],
  numbers: CasterNumbers,
  library: ContentView,
  granted: InterpretedFeatures["grantedSpells"],
  hasSlots: boolean
): void {
  for (const entry of spells) {
    const record = library.spellRecord(String(entry.id));
    if (!record) continue;
    const mint = (action: ActorAction | null, key: "actionId" | "freeActionId") => {
      if (!action || into.length >= MAX_DEFINITION_ACTIONS || into.some((existing) => existing.id === action.id))
        return;
      into.push(action);
      entry[key] = action.id;
    };
    if (record.level === 0) {
      mint(cantripActionFor(record, numbers), "actionId");
      continue;
    }
    if (hasSlots && entry.withSlot !== false) mint(leveledSpellActionFor(record, numbers), "actionId");
    const grant = granted.find((candidate) => candidate.id === record.id && candidate.free !== undefined);
    if (grant) mint(leveledSpellActionFor(record, numbers, grant.free), "freeActionId");
  }
}

/** The Martial Arts unarmed strike from the printed `classResources` column, or null without one. Uses
 *  the better of DEX or STR (SRD Dexterous Attacks). A non-dice amount keeps the generic builtin. Monk weapons
 *  get the same rule at read time from `character.martialArts` (see `weaponAction`). */
/** The printed Martial Arts die at this level ("1d8"), or null when the class prints none. */
function martialArtsDieOf(context: BuildContext): string | null {
  const die = context.classResources.find((resource) => resource.id === "martial-arts")?.amount;
  return typeof die === "string" && /^1d(?:4|6|8|10|12)$/.test(die) ? die : null;
}

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
    damage: [
      {
        formula: modifier === 0 ? die : `${die} ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}`,
        type: "bludgeoning"
      }
    ]
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
  // The counter of a free-cast grant (Divine Smite once per Long Rest) rides its spell's free-cast action instead.
  const freeUses: ActorAction["uses"] | undefined = carriesUses
    ? { limit: synthesizedUses, per: feature.uses!.per, pool: feature.uses!.pool ?? feature.id }
    : undefined;
  const freeCastGrant = feature.grants?.spells.some((spell) => spell.withoutSlot === "free") === true;
  if (
    feature.actions.length === 0 &&
    (feature.effects.length > 0 || (carriesUses && !freeCastGrant)) &&
    !into.actions.some((existing) => existing.id === feature.id)
  ) {
    into.actions.push({
      id: feature.id,
      name: feature.name,
      activation: "other",
      description: feature.description.slice(0, 12000),
      damage: [],
      ...(feature.effects.length > 0 ? { grants: feature.effects[0] } : {}),
      ...(carriesUses
        ? {
            uses: {
              limit: synthesizedUses,
              per: feature.uses!.per,
              ...(feature.uses!.pool ? { pool: feature.uses!.pool } : {})
            }
          }
        : {})
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
    into.grantedSpells.push(
      ...feature.grants.spells.map((spell) => ({
        id: spell.id,
        level: spell.level,
        alwaysPrepared: spell.alwaysPrepared,
        ability: spell.ability,
        withSlot: spell.withSlot,
        ...(spell.withoutSlot === "at-will" ? { free: null } : {}),
        // A free casting with no counter to spend is refused at build rather than cast without limit.
        ...(spell.withoutSlot === "free"
          ? { free: freeUses ?? reject(`"${feature.name}" casts ${spell.id} without a slot but has no uses to spend.`) }
          : {})
      }))
    );
  }
  for (const modifier of feature.modifiers) {
    switch (modifier.type) {
      // Already applied in step 5c, which must precede `interpretAction` reading `context.finalScores`
      // for this feature's DC. Kept as an explicit case to document the partition.
      case "ability-score":
        break;
      case "hit-points-per-level":
        into.hitPointsPerLevel += modifier.amount;
        break;
      case "speed":
        into.speedBonus += modifier.amount;
        break;
      // Defense is "+1 AC while wearing armor": a `whileArmored` rider waits for step 11, which knows the
      // final loadout. An unconditional rider applies either way.
      case "armor-class":
        if (modifier.whileArmored) into.armorClassBonusWhileArmored += modifier.amount;
        else into.armorClassBonus += modifier.amount;
        break;
      case "initiative":
        into.initiativeBonus += modifier.amount + (modifier.proficiencyBonus ? context.proficiencyBonus : 0);
        break;
      case "unarmored-defense":
        into.unarmoredDefense = { ability: modifier.ability, allowShield: modifier.allowShield };
        break;
      case "darkvision":
        break; // display-only: the trait prose carries the senses; no definition field models them
      // The roll-time variants; see `CARRIER_RIDER_DISPOSITION`.
      default:
        ownedByTheRollTimeCollector(modifier);
        break;
    }
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

// The build. `library` is always an audience-scoped view, so a player can never build against (or
// name) a homebrew record the GM has not made player-visible.

/** Rolled HP entries as ledger rows (level N is entry N-2), replacing any already in the input. */
export function hitPointRollRows(input: Pick<CharacterCreateRequestInput, "hp" | "choices">): CharacterChoice[] {
  if (input.hp.mode !== "entries") return [];
  return (input.hp.entries ?? []).map((roll, index) => ({
    level: index + 2,
    kind: "hp-roll",
    id: "hp",
    payload: { roll }
  }));
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

export function buildCharacterDefinition(
  input: CharacterCreateRequestInput,
  library: ContentView,
  policy: BuilderPolicy
): ActorDefinition {
  const survey = surveyForBuild(input, library, policy);
  const {
    offers,
    classRecord,
    species,
    background,
    subclass,
    lineage,
    originFeat,
    levelRow,
    granted,
    chosenFeats,
    extraPickBudgets,
    preparedSpellRows,
    classCantripRows,
    printedCantrips,
    printedPrepared,
    catalogs,
    progression,
    proficiencyBonus
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
    if (!Array.isArray(payload?.increases) || payload.increases.length === 0)
      reject("An ASI choice needs payload.increases ([{ability, amount}]).");
    let total = 0;
    for (const increase of payload.increases as ReadonlyArray<{ ability?: unknown; amount?: unknown }>) {
      const ability =
        ABILITIES.find((candidate) => candidate === increase.ability) ??
        reject("An ASI increase names an unknown ability.");
      const amount =
        typeof increase.amount === "number" &&
        Number.isInteger(increase.amount) &&
        increase.amount >= 1 &&
        increase.amount <= 2
          ? increase.amount
          : reject("An ASI increase must be +1 or +2.");
      total += amount;
      finalScores[ability] += amount;
      if (finalScores[ability] > 20)
        reject(
          `${ability.toUpperCase()} would be ${finalScores[ability]}; the Ability Score Improvement cannot raise a score above 20.`
        );
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
    if (feat.prerequisite?.level !== undefined && input.level < feat.prerequisite.level)
      reject(`${feat.name} requires level ${feat.prerequisite.level}.`);
    for (const minimum of feat.prerequisite?.abilityScores ?? []) {
      if (finalScores[minimum.ability] < minimum.minimum)
        reject(`${feat.name} requires ${minimum.ability.toUpperCase()} ${minimum.minimum}.`);
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
  const context: BuildContext = {
    level: input.level,
    proficiencyBonus,
    finalScores,
    spellcastingAbility: casting?.ability ?? null,
    classResources: levelRow.classResources
  };
  const interpreted: InterpretedFeatures = {
    actions: [],
    traits: [],
    grantedSkills: [],
    grantedExpertise: [],
    grantedTools: [],
    grantedLanguages: [],
    grantedArmor: [],
    grantedWeapons: [],
    grantedSaves: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    grantedSpells: [],
    hitPointsPerLevel: 0,
    speedBonus: 0,
    armorClassBonus: 0,
    armorClassBonusWhileArmored: 0,
    initiativeBonus: 0,
    unarmoredDefense: null
  };
  for (const { record } of granted) interpretFeature(record, interpreted, context);
  // Martial Arts runs after the features so an id a feature already declared keeps it.
  const strike = martialArtsStrike(context);
  const martialArtsDie = strike ? martialArtsDieOf(context) : null;
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
    if (entries.length !== input.level - 1)
      reject(
        `Rolled hit points need exactly ${input.level - 1} entries (levels 2-${input.level}); got ${entries.length}.`
      );
    for (const entry of entries) {
      if (!Number.isInteger(entry) || entry < 1 || entry > faces)
        reject(`A ${classRecord.hitDie} hit-point roll must be 1-${faces}; got ${entry}.`);
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
  const skillTaken = [
    ...takenOf("skill"),
    ...skillOrTool.filter((id) => skillIds.has(id)),
    ...background.skillProficiencies,
    ...interpreted.grantedSkills
  ];
  // A pick of something the character already has, or the same pick twice, would be merged away below and the
  // pick lost; the builder greys these out, so a payload that sends one is refused rather than quietly shortened.
  const refuseRepeatPicks = (kind: string, picked: readonly string[], fixed: readonly string[]) => {
    const held = new Set(fixed);
    for (const id of picked) {
      if (held.has(id)) reject(`The ${kind} "${id}" is taken more than once; pick a different ${kind}.`);
      held.add(id);
    }
  };
  refuseRepeatPicks(
    "skill",
    [...takenOf("skill"), ...skillOrTool.filter((id) => skillIds.has(id))],
    [...background.skillProficiencies, ...interpreted.grantedSkills]
  );
  refuseRepeatPicks(
    "tool",
    [...takenOf("tool"), ...skillOrTool.filter((id) => !skillIds.has(id))],
    [...classRecord.toolProficiencies, ...background.toolProficiencies, ...interpreted.grantedTools]
  );
  refuseRepeatPicks("language", takenOf("language"), [
    ...species.languages,
    ...background.languages,
    ...interpreted.grantedLanguages
  ]);
  const expertiseTaken = [...takenOf("expertise"), ...interpreted.grantedExpertise];
  for (const skill of expertiseTaken) {
    if (!skillTaken.includes(skill)) reject(`Expertise in "${skill}" requires proficiency in it first.`);
  }
  const proficiencies = {
    saves: dedupe([...classRecord.savingThrows, ...interpreted.grantedSaves]),
    skills: dedupe(skillTaken).map((id) => ({
      id,
      proficiency: expertiseTaken.includes(id) ? "expertise" : "proficient"
    })),
    armor: dedupe([...classRecord.armorProficiencies, ...interpreted.grantedArmor]),
    weapons: dedupe([...classRecord.weaponProficiencies, ...interpreted.grantedWeapons]),
    tools: dedupe([
      ...classRecord.toolProficiencies,
      ...takenOf("tool"),
      ...skillOrTool.filter((id) => !skillIds.has(id)),
      ...background.toolProficiencies,
      ...interpreted.grantedTools
    ]),
    languages: dedupe([
      ...species.languages,
      ...takenOf("language"),
      ...background.languages,
      ...interpreted.grantedLanguages
    ])
  };

  // ---- 9. Spellcasting: the class's level row (slots, cantrips, prepared cap) + chosen + granted spells. ----
  // Feature-consumed spell/cantrip picks join the list outside the class budgets.
  const featureSpellPicks = offers
    .filter((offer) => offer.kind === "spell" && offer.featureId !== null)
    .flatMap((offer) => offer.taken);
  const featureCantripPicks = offers
    .filter((offer) => offer.kind === "cantrip" && offer.featureId !== null)
    .flatMap((offer) => offer.taken);
  const grantedSpellEntry = (grantedSpell: InterpretedFeatures["grantedSpells"][number]) => {
    const record = library.spellRecord(grantedSpell.id);
    return {
      id: grantedSpell.id,
      name: record?.name ?? grantedSpell.id,
      level: grantedSpell.level ?? record?.level ?? 0,
      prepared: true,
      alwaysPrepared: grantedSpell.alwaysPrepared,
      ...(grantedSpell.withSlot ? {} : { withSlot: false })
    };
  };
  let spellcasting: Record<string, unknown> | undefined;
  if (casting) {
    const listSlug = `${casting.spellListId ?? classRecord.id}-spells`;
    let listOptions: Map<string, { id: string; name: string; level?: number }>;
    try {
      listOptions = new Map(resolveCatalogChoice(listSlug, catalogs).map((option) => [option.id, option]));
    } catch (error) {
      if (error instanceof CatalogChoiceError)
        reject(`The ${classRecord.name} spell list could not be resolved: ${error.message}`);
      throw error;
    }
    // Pact Magic is N slots all of one level, rising by replacing that level, so `pactSlots` replaces
    // `spellSlots` rather than merging with it.
    const slots = levelRow.pactSlots
      ? levelRow.pactSlots.slots > 0
        ? [{ level: levelRow.pactSlots.level, max: levelRow.pactSlots.slots }]
        : []
      : (levelRow.spellSlots ?? [])
          .map((count, index) => ({ level: index + 1, max: count }))
          .filter((slot) => slot.max > 0);
    const maxSlotLevel = slots.reduce((highest, slot) => Math.max(highest, slot.level), 0);
    // SRD: an always-prepared granted spell doesn't count against the prepared limit, so the grant wins
    // and a matching pick is not charged to the cap.
    const alwaysPreparedGrants = new Set(
      interpreted.grantedSpells.filter((granted) => granted.alwaysPrepared).map((granted) => granted.id)
    );
    const chargedCantripRows = classCantripRows.filter((row) => !alwaysPreparedGrants.has(row.id));
    const chargedPreparedRows = preparedSpellRows.filter((row) => !alwaysPreparedGrants.has(row.id));
    // The printed row plus granted extras (Thaumaturge's extra cantrip); the wizard composes the same sum.
    const cantripCap = printedCantrips + (extraPickBudgets.get(CLASS_CANTRIP_BUDGET) ?? 0);
    if (chargedCantripRows.length > cantripCap)
      reject(
        `${classRecord.name} knows ${cantripCap} cantrips at level ${input.level}; got ${chargedCantripRows.length}.`
      );
    const preparedCap = printedPrepared + (extraPickBudgets.get(CLASS_SPELL_BUDGET) ?? 0);
    if (chargedPreparedRows.length > preparedCap)
      reject(
        `${classRecord.name} ${casting.prepares === "prepared" ? "prepares" : "knows"} ${preparedCap} spells at level ${input.level}; got ${chargedPreparedRows.length}.`
      );
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
      if (spellLevel > maxSlotLevel)
        reject(
          `"${row.id}" is level ${spellLevel}, above the highest slot level (${maxSlotLevel}) at ${classRecord.name} ${input.level}.`
        );
      if (claimedSpellIds.has(option.id)) reject(`"${row.id}" is chosen twice.`);
      claimedSpellIds.add(option.id);
      if (alwaysPreparedGrants.has(option.id)) continue; // the grant supplies it, uncharged and always prepared
      spells.push({
        id: option.id,
        name: option.name,
        level: spellLevel,
        prepared: true,
        alwaysPrepared: false,
        classId: classRecord.id
      });
    }
    // A feature pick that duplicates an always-prepared grant defers to the grant, like a class pick.
    for (const id of featureCantripPicks) {
      const record = library.spellRecord(id);
      if (!alwaysPreparedGrants.has(id) && !spells.some((existing) => existing.id === id))
        spells.push({ id, name: record?.name ?? id, level: record?.level ?? 0, prepared: true, alwaysPrepared: true });
    }
    for (const id of featureSpellPicks) {
      const record = library.spellRecord(id);
      if (!alwaysPreparedGrants.has(id) && !spells.some((existing) => existing.id === id))
        spells.push({
          id,
          name: record?.name ?? id,
          level: record?.level ?? 1,
          prepared: true,
          alwaysPrepared: false,
          classId: classRecord.id
        });
    }
    for (const grantedSpell of interpreted.grantedSpells) {
      if (!spells.some((existing) => existing.id === grantedSpell.id)) spells.push(grantedSpellEntry(grantedSpell));
    }
    const saveDc = spellSaveDc(finalScores[casting.ability], proficiencyBonus);
    const attackBonus = spellAttackBonus(finalScores[casting.ability], proficiencyBonus);
    // Spells become actions with this caster's numbers; the sheet sends only an id.
    linkSpellActions(
      spells,
      interpreted.actions,
      { attackBonus, saveDc, characterLevel: input.level, modifier: abilityModifier(finalScores[casting.ability]) },
      library,
      interpreted.grantedSpells,
      slots.length > 0
    );
    // Top-level fields stay populated (the schema demands the combined pool when per-class slots exist).
    spellcasting = {
      ability: casting.ability,
      saveDc,
      attackBonus,
      slots,
      // `prepared` is the composed cap the sheet shows.
      classes: [
        {
          classId: classRecord.id,
          ability: casting.ability,
          saveDc,
          attackBonus,
          slots,
          ...(levelRow.preparedCount !== undefined ? { prepared: preparedCap } : {})
        }
      ],
      spells
    };
  } else {
    if (preparedSpellRows.length > 0 || classCantripRows.length > 0)
      reject(`${classRecord.name} has no spell list to choose spells from.`);
    const extraSpells = [
      ...interpreted.grantedSpells.map(grantedSpellEntry),
      ...featureCantripPicks.map((id) => {
        const record = library.spellRecord(id);
        return { id, name: record?.name ?? id, level: record?.level ?? 0, prepared: true, alwaysPrepared: true };
      }),
      ...featureSpellPicks.map((id) => {
        const record = library.spellRecord(id);
        return { id, name: record?.name ?? id, level: record?.level ?? 1, prepared: true, alwaysPrepared: true };
      })
    ].filter((spell, index, all) => all.findIndex((other) => other.id === spell.id) === index);
    if (extraSpells.length > 0) {
      // A non-caster with granted/feat spells: model them so the sheet can cast them.
      const ability = interpreted.grantedSpells.find((spell) => spell.ability)?.ability ?? "int";
      const saveDc = spellSaveDc(finalScores[ability], proficiencyBonus);
      const attackBonus = spellAttackBonus(finalScores[ability], proficiencyBonus);
      // A non-caster's spells get actions too, using the fallback ability above; with no slots, only free casts.
      linkSpellActions(
        extraSpells,
        interpreted.actions,
        { attackBonus, saveDc, characterLevel: input.level, modifier: abilityModifier(finalScores[ability]) },
        library,
        interpreted.grantedSpells,
        false
      );
      spellcasting = {
        ability,
        saveDc,
        attackBonus,
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
    if (matches.length !== 1)
      reject(`Choose exactly one ${source} equipment option (${options.map((option) => option.id).join(", ")}).`);
    const chosen = options.find((option) => option.id === matches[0].id)!;
    goldPieces += chosen.goldPieces;
    for (const item of chosen.items) {
      const existing = inventory.find((candidate) => candidate.id === item.id);
      if (existing) {
        existing.quantity += item.quantity;
        continue;
      }
      // A cataloged item carries its mechanics; an unknown item stays display-only (ADR-0008 fail-open).
      const record = library.equipmentRecord(item.id);
      // Starting equipment mints without a picker, so template items go through the same server-side bind:
      // a single-base template auto-binds, a multi-base one stays unbound for the sheet's chooser.
      inventory.push(
        bindTemplateItem(
          {
            id: item.id,
            name: record?.name ?? item.name,
            quantity: item.quantity,
            equipped: record
              ? record.category === "armor" || record.category === "shield" || record.category === "weapon"
              : false,
            attuned: false,
            ...(record?.weightLb !== null && record?.weightLb !== undefined ? { weightEach: record.weightLb } : {}),
            ...(record?.description ? { description: record.description.slice(0, 4000) } : {}),
            ...(record ? { category: record.category } : {}),
            // `mastery` is not copied: it resolves against the catalog and is gated on the bearer having unlocked
            // this weapon. Omit `properties` when the catalog records none (absent means "not recorded").
            ...(record?.weapon
              ? {
                  weapon: {
                    category: record.weapon.category,
                    damageDice: record.weapon.damageDice,
                    damageType: record.weapon.damageType,
                    rangeFeet: record.weapon.rangeFeet,
                    longRangeFeet: record.weapon.longRangeFeet,
                    ...(record.weapon.properties ? { properties: [...record.weapon.properties] } : {})
                  }
                }
              : {}),
            ...(record?.armor
              ? {
                  armor: {
                    acBase: record.armor.acBase,
                    addDexModifier: record.armor.addDexModifier,
                    dexModifierCap: record.armor.dexModifierCap,
                    stealthDisadvantage: record.armor.stealthDisadvantage,
                    strengthRequired: record.armor.strengthRequired
                  }
                }
              : {})
          },
          { catalog: { equipmentRecord: (id) => library.equipmentRecord(id), featRecord: () => undefined } }
        )
      );
    }
  };
  consumeEquipmentOption("class", classRecord.startingEquipment);
  consumeEquipmentOption("background", background.startingEquipment);
  const strayEquipment = equipmentRows.find(
    (row) =>
      !classRecord.startingEquipment.some((option) => option.id === row.id) &&
      !background.startingEquipment.some((option) => option.id === row.id)
  );
  if (strayEquipment)
    reject(`"${strayEquipment.id}" is not a ${classRecord.name} or ${background.name} equipment option.`);
  // Only one body armor stays equipped (two would fight over derived AC); keep the best base.
  const equippedArmor = inventory.filter((item) => item.category === "armor" && item.equipped);
  for (const extra of equippedArmor
    .sort((left, right) => (right.armor?.acBase ?? 0) - (left.armor?.acBase ?? 0))
    .slice(1))
    extra.equipped = false;

  // ---- 11. Size, speed, AC, initiative, Extra Attack. ----
  const sizeRow = input.choices.find((row) => row.kind === "size");
  const size: ActorDefinition["size"] = sizeRow
    ? (species.sizes as readonly string[]).includes(sizeRow.id)
      ? (sizeRow.id as ActorDefinition["size"])
      : reject(`${species.name} may be ${species.sizes.join(" or ")}, not "${sizeRow.id}".`)
    : species.sizes.includes("medium")
      ? "medium"
      : species.sizes[0];
  const speedFeet = Math.max(0, species.speedFeet + interpreted.speedBonus);
  const dexModifier = abilityModifier(finalScores.dex);
  // The same AC function `instantiate` re-runs. Unarmored Defense is passed into the equipment step
  // because a shield alone makes it answer; `allowShield` decides whether it still applies.
  const unarmoredDefense = interpreted.unarmoredDefense
    ? {
        bonus: abilityModifier(finalScores[interpreted.unarmoredDefense.ability]),
        allowShield: interpreted.unarmoredDefense.allowShield
      }
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
  const summary = [
    `Level ${input.level} ${species.name}${lineage ? ` (${lineage.name})` : ""} ${classRecord.name}${subclass ? ` (${subclass.name})` : ""}`,
    background.name
  ]
    .join(" · ")
    .slice(0, 280);
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
        ...(interpreted.unarmoredDefense
          ? {
              unarmoredDefense: {
                ability: interpreted.unarmoredDefense.ability,
                allowShield: interpreted.unarmoredDefense.allowShield
              }
            }
          : {})
      }
    },
    ...(interpreted.damageResistances.length > 0 ? { damageResistances: dedupe(interpreted.damageResistances) } : {}),
    ...(interpreted.damageImmunities.length > 0 ? { damageImmunities: dedupe(interpreted.damageImmunities) } : {}),
    ...(interpreted.conditionImmunities.length > 0
      ? { conditionImmunities: dedupe(interpreted.conditionImmunities) }
      : {}),
    character: {
      classes: [
        {
          id: classRecord.id,
          name: classRecord.name,
          level: input.level,
          hitDie: classRecord.hitDie,
          ...(subclass ? { subclass: { id: subclass.id, name: subclass.name } } : {})
        }
      ],
      race: {
        id: species.id,
        name: species.name,
        ...(lineage ? { subrace: { id: lineage.id, name: lineage.name } } : {})
      },
      background: { id: background.id, name: background.name },
      ...(martialArtsDie ? { martialArts: { die: martialArtsDie } } : {}),
      feats: [
        ...(originFeat
          ? [{ id: originFeat.id, name: originFeat.name, description: originFeat.feature.description.slice(0, 4000) }]
          : []),
        ...chosenFeats.map((feat) => ({
          id: feat.id,
          name: feat.name,
          description: feat.feature.description.slice(0, 4000)
        }))
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

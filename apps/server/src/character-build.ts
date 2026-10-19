import type { BuilderPolicy } from "@vtt/domain";
import { CatalogChoiceError, resolveCatalogChoice, withArticle } from "@vtt/domain";
import {
  ActorDefinitionSchema,
  MAX_ACTION_USES,
  type ActorAction,
  type ActorDefinition,
  type CharacterChoice,
  type InventoryItem
} from "@vtt/schemas";
import {
  ABILITIES,
  abilityModifier,
  armorClassFromEquipment,
  formulaPlus,
  hitDieFaces,
  hitPointPool,
  multiclassShortfalls,
  multiclassShortfallText,
  spellAttackBonus,
  spellSaveDc,
  type Ability,
  type UnarmoredDefense
} from "@vtt/rules-5e";
import {
  cantripScalingOf,
  cantripTierAt,
  featurePicks,
  type ClassLevelRow,
  type ClassReference,
  type FeatureRecord,
  type Modifier,
  type SpellReference
} from "@vtt/content-srd-5.2.1";
import {
  CLASS_LEVELS_KIND,
  classLevelsRow,
  levelOfPick,
  SPELLCASTING_ABILITY_KIND,
  spellSlotsOf,
  surveyForBuild,
  type BuildClass,
  type CharacterFeatureOrigin
} from "./character-offers.js";
import type { ContentView } from "./content-library.js";
import { BUILDER_BAKED_MODIFIER_TYPES, type CharacterFeatureRef } from "./equipment-derivation.js";
import {
  isLongCastingTime,
  laterSpellAction,
  ritualSpellActionId,
  spellCastMechanics,
  UNARMED_STRIKE_ACTION_ID
} from "./item-actions.js";
import { bindTemplateItem } from "./inventory.js";
import { BUILDER_SOURCE_NAME } from "./actor-roster.js";
import { featHoldings, featPrerequisiteFailure } from "./feat-prerequisites.js";
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
 *   - "spellcasting-ability" names the ability a species' or a feat's spells are cast with;
 *   - "equipment" names one class and one background starting-equipment option;
 *   - "size" (optional) picks among the species' sizes; defaults to medium;
 *   - "hp-roll" and "ability-scores" are build output: the rolled hit points per level, and the ability method, base
 *     scores and background increase, so a rebuild re-sends what the character was made with.
 */

export type CharacterCreateRequestInput = Readonly<{
  name: string;
  speciesId: string;
  backgroundId: string;
  /** The starting class: the class taken at level 1. */
  classId: string;
  /** The total character level. */
  level: number;
  /** The starting class's subclass; a later class names its own in its `subclass` ledger row. */
  subclassId?: string;
  /** The class each character level went to, in order (index 0 is level 1); absent when every level is `classId`. */
  classLevels?: readonly string[];
  abilityMethod: BuilderPolicy["allowedAbilityMethods"][number];
  baseScores: Readonly<Record<Ability, number>>;
  backgroundBonusAllocation: ReadonlyArray<Readonly<{ ability: Ability; amount: number }>>;
  hp: Readonly<{ mode: "average" | "entries"; entries?: readonly number[] }>;
  choices: readonly CharacterChoice[];
  /** Set by a rebuild that re-sends the ability scores its sheet recorded: the table's allowed methods govern new
   *  scores, so a character made under an earlier policy can still level. */
  keepsRecordedScores?: boolean;
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
    /** Whose spellcasting ability casts it; see `SpellSource`. */
    source: SpellSource;
  }>;
  /** The free casting a feature with limited uses gives the spell picked for it (Magic Initiate's level 1 spell). */
  pickedSpellUses: Map<string, NonNullable<ActorAction["uses"]>>;
  /** Hit points the features add: each `hit-points-per-level` rider times the level that scales it (a Sorcerer level
   *  for Draconic Resilience, the character level for Tough). */
  hitPointBonus: number;
  speedBonus: number;
  armorClassBonus: number;
  /** Flat AC that applies only while body armor is worn (Defense fighting style). */
  armorClassBonusWhileArmored: number;
  initiativeBonus: number;
  /** Every alternative AC calculation (a Monk's and a Barbarian's Unarmored Defense, Draconic Resilience). */
  unarmoredDefenses: Array<{ ability: Ability; allowShield: boolean }>;
  /** The class that minted each action and use-pool id (null for species, background and feats). */
  idOwners: Map<string, string | null>;
};

/**
 * The id a class feature's action or use pool takes: its own, unless an earlier class already uses it, as a
 * Paladin's Channel Divinity beside a Cleric's does. Then it takes its class's suffix, so each class keeps "this
 * class's Channel Divinity" uses.
 */
function ownId(id: string, classId: string | null, into: InterpretedFeatures): string {
  const owner = into.idOwners.get(id);
  const own = owner !== undefined && owner !== null && classId !== null && owner !== classId ? `${id}-${classId}` : id;
  if (!into.idOwners.has(own)) into.idOwners.set(own, classId);
  return own;
}

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
  "short-rest-regain": "standing", // rests.ts gives the pool's uses back when a Short Rest ends
  "critical-range": "standing", // effective-actions criticalThreshold
  "critical-bonus-dice": "standing", // effective-actions folds it into attack.criticalBonusDice
  "extra-attack": "standing", // effective-actions extraAttacksFor raises attack.count on a weapon swing
  "armor-class": "standing", // storedArmorClass, via derivation.armorClass, so Defense follows the armor worn now
  "attunement-slots": "standing", // inventory.ts, the attunement limit
  "special-speed": "standing", // speed.ts specialSpeedsOf, the movement modes
  movement: "standing", // falling.ts and jumping.ts: safe falls, leaps and jump distance
  "roll-mode": "at-its-moment", // rollModeClaims: attacks, saves, checks, initiative
  "extra-damage": "at-its-moment", // resolution/damage.ts rolls it as its own typed damage entry
  "damage-bonus": "standing", // effective-actions folds it into the first damage part's formula; a moment-gated one lands as a bonusDamage line in resolution/damage.ts
  "check-bonus": "standing", // checkRiderBonus, into every check and skill row and the builtin checks
  "spell-attack-bonus": "standing", // effective-actions folds it into a spell attack's bonus
  "damage-reduction": "at-its-moment", // hit-points.ts damageReductionsFor, taken off the hit before resistances
  "damage-resistance": "standing", // derivation.damageResistances, beside the definition's own
  "damage-vulnerability": "standing", // derivation.damageVulnerabilities, beside the definition's own
  sense: "display-only" // like `darkvision`: the trait prose carries it; no definition field models senses
};

/** Where a modifier type is consumed, for the coverage manifest (`srd-coverage.ts`): baked by the builder, read at a
 *  roll, or read by nothing yet. `darkvision` is baked, but only to be displayed, like `sense`. */
export function modifierDisposition(
  type: Modifier["type"]
): "baked" | "standing" | "at-its-moment" | "unread" | "display-only" {
  if (type === "darkvision") return "display-only";
  return (BUILDER_BAKED_MODIFIER_TYPES as readonly string[]).includes(type)
    ? "baked"
    : CARRIER_RIDER_DISPOSITION[type as CarrierRiderType];
}

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

/** A feature action as a definition action. The rider templates' to-hit and DC come from the character's numbers. */
function interpretAction(
  feature: FeatureRecord,
  action: FeatureRecord["actions"][number],
  context: BuildContext
): ActorAction {
  const { attack, save, damageByLevel, multiattackByLevel, healingByLevel, adds, grantScaling, ...carried } = action;
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
  const healingRows = (healingByLevel ?? [])
    .filter((row) => row.level <= context.level)
    .sort((left, right) => left.level - right.level);
  if (healingRows.length > 0)
    assembled.healing = { ...(action.healing ?? {}), formula: healingRows[healingRows.length - 1].formula };
  // "1d10 plus your Fighter level", "add your Wisdom modifier": read off the character as it is built.
  if (adds) {
    const bonus =
      (adds.classLevel ?? 0) * context.level +
      (adds.abilityModifier ? abilityModifier(context.finalScores[adds.abilityModifier]) : 0) +
      (adds.proficiencyBonus ? context.proficiencyBonus : 0);
    const damage = assembled.damage as ActorAction["damage"] | undefined;
    if (damage && damage.length > 0)
      assembled.damage = [{ ...damage[0], formula: formulaPlus(damage[0].formula, bonus) }, ...damage.slice(1)];
    const healing = assembled.healing as ActorAction["healing"];
    if (healing) assembled.healing = { ...healing, formula: formulaPlus(healing.formula, bonus) };
  }
  // The grant's damage bonus is the printed column at this level (Rage Damage), and the sheet says the number.
  if (grantScaling && action.grants) {
    const amount = context.classResources.find((resource) => resource.id === grantScaling.resource);
    if (typeof amount?.amount === "number") {
      assembled.grants = {
        ...action.grants,
        modifiers: action.grants.modifiers.map((modifier) =>
          modifier.type === "damage-bonus" ? { ...modifier, amount: amount.amount as number } : modifier
        )
      };
      assembled.description = `${action.description} ${amount.name}: +${amount.amount}.`.slice(0, 12000);
    }
  }
  // The feature's limited uses ride the action when the action declares none of its own.
  if (feature.uses && assembled.uses === undefined) {
    const limit = resolvedUseLimit(feature.uses, context);
    if (limit >= 1) {
      assembled.uses = {
        limit: Math.min(MAX_ACTION_USES, limit),
        per: feature.uses.per,
        ...(feature.uses.pool ? { pool: feature.uses.pool } : {})
      };
    }
  }
  return assembled as ActorAction;
}

/** The action id a spell resolves through (`spells[].actionId`); namespaced so it cannot collide with a feature action. */
const spellActionId = (spellId: string): string => `spell-${spellId}`;

// `DiceFormulaSchema`'s shape, used to skip an unusable printed column here, so the whole build doesn't fail
// at schema validation.
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
  // A cantrip that lasts and acts later (Produce Flame) is cast to start it, with nothing to roll.
  if (mechanics.damage.length === 0 && !mechanics.save && (spell.effect?.laterActions ?? []).length === 0) return null;
  return {
    id: spellActionId(spell.id),
    name: spell.name,
    activation: activationOf(spell.castingTime),
    description: spell.description.slice(0, 12000),
    ...mechanics,
    // A healing area heals up to a number of creatures the caster picks (Mass Cure Wounds' six), so it is picked.
    ...(spell.area && !mechanics.healing ? { area: spell.area } : {}),
    ...(spell.effect?.reaction ? { reaction: spell.effect.reaction } : {}),
    // `spell-id-is` riders (Agonizing Blast) match on this field alone.
    spellId: spell.id
  } as ActorAction;
}

/** The action economy a casting time names ("Action", "Bonus Action", "Reaction, which you take when..."). A casting
 *  time of a minute or more takes the Magic action on each turn of it (SRD "Longer Casting Times"), so it is an action
 *  too, refused while Incapacitated. */
function activationOf(castingTime: string): ActorAction["activation"] {
  if (/bonus/i.test(castingTime)) return "bonus-action";
  if (/reaction/i.test(castingTime)) return "reaction";
  if (/^(?:1 )?action\b/i.test(castingTime.trim()) || isLongCastingTime(castingTime)) return "action";
  return "other";
}

type CasterNumbers = Readonly<{ attackBonus: number; saveDc: number; characterLevel: number; modifier: number }>;

/**
 * A leveled spell as an action. Cast with a slot, it carries `spellSlot` at the spell's level, which the economy
 * spends (a higher slot on request upcasts the dice). Cast without one (`free`), it spends the granting
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
    mechanics.grants !== undefined ||
    spell.effect?.reaction !== undefined ||
    // A spell that lasts and acts on later turns (Flame Blade) is cast to start it.
    (spell.effect?.laterActions ?? []).length > 0;
  if (free === null && !resolvable) return null;
  const freeCast = free !== undefined;
  return {
    id: freeCast ? `${spellActionId(spell.id)}-free` : spellActionId(spell.id),
    name: freeCast ? `${spell.name} (no slot)` : spell.name,
    activation: activationOf(spell.castingTime),
    description: spell.description.slice(0, 12000),
    ...mechanics,
    // A healing area heals up to a number of creatures the caster picks (Mass Cure Wounds' six), so it is picked.
    ...(spell.area && !mechanics.healing ? { area: spell.area } : {}),
    // A reaction spell's trigger rides its action, so the table offers it (Shield when an attack would hit).
    ...(spell.effect?.reaction ? { reaction: spell.effect.reaction } : {}),
    ...(freeCast ? (free ? { uses: free } : {}) : { spellSlot: { level: spell.level } }),
    spellId: spell.id
  } as ActorAction;
}

/** A slot cast as a Ritual: the same spell with no slot, 10 minutes longer, so the Magic action on each turn of it. */
function ritualActionOf(cast: ActorAction, spell: SpellReference): ActorAction {
  const { spellSlot: _slot, ...rest } = cast;
  return {
    ...rest,
    id: ritualSpellActionId(spell.id),
    name: `${spell.name} (ritual)`,
    activation: "action"
  };
}

/** The tag of a feature whose spell picks go to the spellbook to be prepared, and never straight onto the prepared list
 *  (Evocation Savant). */
const SPELLBOOK_TAG = "spellbook";

/** `ActorDefinitionSchema`'s cap on a sheet's actions; spells past it keep their sheet entry without an action. */
const MAX_DEFINITION_ACTIONS = 100;

/** One spell on the sheet while it is assembled: the definition's entry, plus whose ability casts it and its free
 *  casting (the uses it spends; null at will; absent when only a slot casts it). Both are dropped from the sheet. */
type SpellEntry = {
  id: string;
  name: string;
  level: number;
  prepared: boolean;
  alwaysPrepared: boolean;
  withSlot?: false;
  classId?: string;
  actionId?: string;
  freeActionId?: string;
  ritualActionId?: string;
  source: SpellSource;
  free?: ActorAction["uses"] | null;
};

/**
 * Mints and links each spell's actions: a cantrip's (`actionId`), a leveled spell's slot cast (`actionId`, when the
 * sheet has slots and the spell may use one), its Ritual cast (`ritualActionId`), a free cast (`freeActionId`) and
 * what it lets its caster do later, each with the numbers of the ability its source casts with. Mutates the list in
 * place.
 */
function linkSpellActions(
  spells: SpellEntry[],
  into: ActorAction[],
  numbersOf: (source: SpellSource) => CasterNumbers,
  library: ContentView,
  hasSlots: boolean
): void {
  for (const entry of spells) {
    const record = library.spellRecord(entry.id);
    if (!record) continue;
    const numbers = numbersOf(entry.source);
    const mint = (action: ActorAction | null, key: "actionId" | "freeActionId" | "ritualActionId") => {
      if (!action || into.length >= MAX_DEFINITION_ACTIONS || into.some((existing) => existing.id === action.id))
        return;
      into.push(action);
      entry[key] = action.id;
    };
    if (record.level === 0) mint(cantripActionFor(record, numbers), "actionId");
    else {
      if (hasSlots && entry.withSlot !== false) {
        const cast = leveledSpellActionFor(record, numbers);
        mint(cast, "actionId");
        // SRD Rituals: a prepared ritual spell can be cast without a slot and takes 10 minutes longer.
        if (cast && record.ritual) mint(ritualActionOf(cast, record), "ritualActionId");
      }
      if (entry.free !== undefined) mint(leveledSpellActionFor(record, numbers, entry.free), "freeActionId");
    }
    // What the spell lets its caster do once it is up (Produce Flame's hurl, Spirit Guardians' save), with no slot.
    const tier =
      record.level === 0 ? cantripTierAt(cantripScalingOf(record.castingOptions), numbers.characterLevel) : null;
    for (const later of record.effect?.laterActions ?? []) {
      const action = laterSpellAction(
        record,
        later,
        { attackBonus: numbers.attackBonus, saveDc: numbers.saveDc, bearersDc: true, modifier: numbers.modifier },
        { roll: tier?.damageRoll ?? null }
      );
      if (into.length < MAX_DEFINITION_ACTIONS && !into.some((existing) => existing.id === action.id))
        into.push(action);
    }
  }
}

/** The sheet's spell entry without the build-only fields. */
const sheetSpell = ({ source: _source, free: _free, ...entry }: SpellEntry) => entry;

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
    description: `A strike with your body. You roll your Martial Arts die (${die}) in place of the normal damage, and use Dexterity or Strength for the attack and damage rolls, whichever is higher. (SRD 5.2.1, Martial Arts)`,
    attack: { bonus: modifier + context.proficiencyBonus, reachFeet: 5 },
    damage: [
      {
        formula: modifier === 0 ? die : `${die} ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}`,
        type: "bludgeoning"
      }
    ]
  } as ActorAction;
}

/**
 * Whose spellcasting ability a spell is cast with: one class's (SRD Multiclassing: "you use the spellcasting ability of
 * that class"), the species' (its traits and lineage share one pick, Elven Lineage), or one feat's (Magic Initiate).
 */
type SpellSource = `class:${string}` | "species" | `feat:${string}`;

/**
 * Interprets one feature's riders into the running build. Prose always lands as a trait; riders add mechanics on top.
 * `classId` is the class whose level scales it (null for species, background and feats), and `className` names a
 * second class's action when its id is taken.
 */
function interpretFeature(
  feature: FeatureRecord,
  into: InterpretedFeatures,
  context: BuildContext,
  source: SpellSource,
  classId: string | null = null,
  className: string | null = null
): void {
  into.traits.push({ name: feature.name, description: feature.description });
  /** An action or pool id as this class owns it, and the action's name when that id had to change. */
  const owned = (id: string) => ownId(id, classId, into);
  const renamed = (action: { id: string; name: string }, own: string) =>
    own === action.id || !className ? action.name : `${action.name} (${className})`;
  const ownedUses = (uses: ActorAction["uses"] | undefined): ActorAction["uses"] | undefined =>
    uses?.pool ? { ...uses, pool: owned(uses.pool) } : uses;
  for (const action of feature.actions) {
    const interpreted = interpretAction(feature, action, context);
    const id = owned(interpreted.id);
    const uses = ownedUses(interpreted.uses);
    const own = { ...interpreted, id, name: renamed(interpreted, id), ...(uses ? { uses } : {}) } as ActorAction;
    if (!into.actions.some((existing) => existing.id === own.id)) into.actions.push(own);
  }
  // A feature with no action gets a synthesized activation when a rider needs a trigger (an effect grant)
  // or it has limited uses (so the pool is trackable and rests can reset it by action id).
  const synthesizedUses = feature.uses ? Math.min(MAX_ACTION_USES, resolvedUseLimit(feature.uses, context)) : 0;
  const carriesUses = feature.uses !== undefined && synthesizedUses >= 1;
  // The counter of a free-cast grant (Divine Smite once per Long Rest) rides its spell's free-cast action instead.
  const freeUses: ActorAction["uses"] | undefined = carriesUses
    ? { limit: synthesizedUses, per: feature.uses!.per, pool: owned(feature.uses!.pool ?? feature.id) }
    : undefined;
  const freeCastGrant = feature.grants?.spells.some((spell) => spell.withoutSlot === "free") === true;
  // A spell picked for a feature with limited uses is cast with them (Magic Initiate once per Long Rest, Mystic
  // Arcanum), so the counter rides that spell's free-cast action, with no action of its own.
  const freeCastPick = carriesUses && featurePicks(feature).some((pick) => pick.kind === "spell");
  if (freeCastPick) into.pickedSpellUses.set(feature.id, freeUses!);
  const synthesizedId = owned(feature.id);
  if (
    feature.actions.length === 0 &&
    (feature.effects.length > 0 || (carriesUses && !freeCastGrant && !freeCastPick)) &&
    !into.actions.some((existing) => existing.id === synthesizedId)
  ) {
    into.actions.push({
      id: synthesizedId,
      name: renamed(feature, synthesizedId),
      activation: "other",
      description: feature.description.slice(0, 12000),
      damage: [],
      ...(feature.effects.length > 0 ? { grants: feature.effects[0] } : {}),
      ...(carriesUses
        ? {
            uses: {
              limit: synthesizedUses,
              per: feature.uses!.per,
              ...(feature.uses!.pool ? { pool: owned(feature.uses!.pool) } : {})
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
        source,
        ...(spell.withoutSlot === "at-will" ? { free: null } : {}),
        // A free casting with no counter to spend is refused at build, so nothing casts without limit.
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
      // Per level of whatever scales the feature: Draconic Resilience counts Sorcerer levels, Tough every level.
      case "hit-points-per-level":
        into.hitPointBonus += modifier.amount * context.level;
        break;
      // A gated one (Unarmored Movement) waits for the live loadout: `deriveEquipment` carries it to the movement rules.
      case "speed":
        if ((modifier.when?.length ?? 0) === 0) into.speedBonus += modifier.amount;
        break;
      // Only the starting AC printed on the definition. The live AC collects these riders from the feature
      // itself (`storedArmorClass`), so Defense follows whatever armor is worn later.
      case "armor-class":
        if (modifier.whileArmored) into.armorClassBonusWhileArmored += modifier.amount;
        else into.armorClassBonus += modifier.amount;
        break;
      case "initiative":
        into.initiativeBonus += modifier.amount + (modifier.proficiencyBonus ? context.proficiencyBonus : 0);
        break;
      // Each one is a way to calculate AC; step 11 uses the best, since only one applies at a time (SRD Multiclassing).
      case "unarmored-defense":
        if (
          !into.unarmoredDefenses.some(
            (entry) => entry.ability === modifier.ability && entry.allowShield === modifier.allowShield
          )
        )
          into.unarmoredDefenses.push({ ability: modifier.ability, allowShield: modifier.allowShield });
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
 *  Truncated at the schema's 80, so an oversized homebrew class is still accepted. */
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
// name) a homebrew record the GM has not shared with one of that player's characters.

/** Rolled HP entries as ledger rows (level N is entry N-2), in place of any already in the input. A multiclass sheet's
 *  rows name the class each roll was for, so a later rebuild reuses a roll only where that class still is. */
export function hitPointRollRows(
  input: Pick<CharacterCreateRequestInput, "hp" | "choices">,
  sequence: readonly string[] = []
): CharacterChoice[] {
  if (input.hp.mode !== "entries") return [];
  const multiclass = new Set(sequence).size > 1;
  return (input.hp.entries ?? []).map((roll, index) => ({
    level: index + 2,
    ...(multiclass && sequence[index + 1] ? { classId: sequence[index + 1] } : {}),
    kind: "hp-roll",
    id: "hp",
    payload: { roll }
  }));
}

/** The ledger row recording how the ability scores were made: the method, the base scores and the background's
 *  increase, which a rebuild re-sends and never recomputes from the sheet's totals. */
export const ABILITY_SCORES_KIND = "ability-scores";

export function abilityScoresRow(
  input: Pick<CharacterCreateRequestInput, "abilityMethod" | "baseScores" | "backgroundBonusAllocation">
): CharacterChoice {
  return {
    level: 1,
    kind: ABILITY_SCORES_KIND,
    id: input.abilityMethod,
    payload: {
      baseScores: { ...input.baseScores },
      backgroundBonusAllocation: input.backgroundBonusAllocation.map((entry) => ({ ...entry }))
    }
  };
}

/** The stored ability row read back, or null for a sheet built before it was recorded. */
export function storedAbilityScores(
  choices: readonly CharacterChoice[]
): Pick<CharacterCreateRequestInput, "abilityMethod" | "baseScores" | "backgroundBonusAllocation"> | null {
  const row = choices.find((entry) => entry.kind === ABILITY_SCORES_KIND);
  const payload = row?.payload as { baseScores?: unknown; backgroundBonusAllocation?: unknown } | undefined;
  const base = payload?.baseScores as Partial<Record<Ability, unknown>> | undefined;
  if (!row || !base || !ABILITIES.every((ability) => typeof base[ability] === "number")) return null;
  if (!["standard-array", "point-buy", "roll", "custom"].includes(row.id)) return null;
  const allocation = Array.isArray(payload?.backgroundBonusAllocation) ? payload.backgroundBonusAllocation : [];
  return {
    abilityMethod: row.id as CharacterCreateRequestInput["abilityMethod"],
    baseScores: Object.fromEntries(ABILITIES.map((ability) => [ability, base[ability] as number])) as Record<
      Ability,
      number
    >,
    backgroundBonusAllocation: allocation.filter(
      (entry): entry is { ability: Ability; amount: number } =>
        typeof entry === "object" &&
        entry !== null &&
        ABILITIES.includes((entry as { ability?: unknown }).ability as Ability) &&
        typeof (entry as { amount?: unknown }).amount === "number"
    )
  };
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
    classes,
    sequence,
    classRecord,
    species,
    background,
    lineage,
    originFeat,
    granted,
    chosenFeats,
    classSpells,
    strayClassSpellRows,
    catalogs,
    progression,
    proficiencyBonus
  } = survey;
  const finalScores = survey.scoresBeforeIncreases;
  const startingId = classRecord.id;
  const classOf = new Map(classes.map((entry) => [entry.record.id, entry]));

  // Completeness check: every offer answered. Not in the survey, because the generator surveys
  // half-answered builds on purpose.
  for (const offer of offers) {
    if (offer.kind === "subclass" || offer.unresolvable !== null) continue; // payload-mirrored / content-gap-deferred
    if (offer.taken.length !== offer.capacity) {
      reject(`"${offer.label}" needs ${offer.capacity} pick(s) of kind "${offer.kind}"; got ${offer.taken.length}.`);
    }
  }

  // ---- 5. Ability increases, feat prerequisites and multiclass prerequisites, level by level: a feat taken at a
  // level is checked against the scores just before that level's increases, its own included, and so is a class
  // taken there (SRD: 13 in the primary ability of the new class and of every current class). ----
  const increases: Array<{ level: number; ability: Ability; amount: number; maximum: number; source: string }> = [];
  const asiRows = input.choices.filter((candidate) => candidate.kind === "asi-or-feat" && candidate.id === "asi");
  for (const [index, row] of asiRows.entries()) {
    // The improvement's own class level sets when it lands, so a row can't move an increase ahead of a class it
    // qualifies for.
    const level = survey.asiLevels[index] ?? row.level;
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
      increases.push({ level, ability, amount, maximum: 20, source: "the Ability Score Improvement" });
    }
    if (total !== 2) reject("An Ability Score Improvement grants exactly +2 (one ability +2, or two abilities +1).");
  }
  // Each consumed "ability-score" pick is +1 (the choice vocabulary carries no amount). The ceiling is
  // the offer's `maximum` (epic boons allow 30), which isn't always 20.
  for (const offer of offers.filter((candidate) => candidate.kind === "ability-score")) {
    offer.taken.forEach((taken, index) => {
      const ability = ABILITIES.find((candidate) => candidate === taken) ?? reject(`"${taken}" is not an ability.`);
      increases.push({
        level: levelOfPick(offer, index),
        ability,
        amount: 1,
        maximum: offer.maximum ?? 20,
        source: offer.label
      });
    });
  }
  const holdings = featHoldings({ classes, granted });
  const featChecks = [
    ...(originFeat ? [{ feat: originFeat, level: 1 }] : []),
    ...chosenFeats.map((feat, index) => ({ feat, level: survey.chosenFeatLevels[index] ?? input.level }))
  ];
  for (let level = 1; level <= input.level; level += 1) {
    const joining = classes.find((entry, index) => index > 0 && entry.characterLevels[0] === level);
    if (joining) {
      const current = classes.filter((entry) => entry.characterLevels[0] < level).map((entry) => entry.record);
      const shortfalls = multiclassShortfalls(finalScores, joining.record, current);
      if (shortfalls.length > 0)
        reject(
          `To take ${joining.record.name} at level ${level}: ${multiclassShortfallText(finalScores, joining.record, shortfalls)}`
        );
    }
    for (const check of featChecks.filter((candidate) => candidate.level === level)) {
      const failure = featPrerequisiteFailure(check.feat, { ...holdings, level, scores: finalScores });
      if (failure) reject(failure);
    }
    for (const increase of increases.filter((candidate) => candidate.level === level)) {
      finalScores[increase.ability] += increase.amount;
      // Refused and never clamped, so a pick past the ceiling is never silently lost.
      if (finalScores[increase.ability] > increase.maximum)
        reject(
          `${increase.ability.toUpperCase()} would be ${finalScores[increase.ability]}; ${increase.source} cannot raise a score above ${increase.maximum}. Choose another ability.`
        );
    }
  }

  // ---- 5c. Feature `ability-score` riders, before any feature is interpreted: `interpretAction`
  // derives DCs from `finalScores`, so capstones (Primal Champion) must already apply. ----
  for (const { record } of granted) {
    for (const modifier of record.modifiers) {
      if (modifier.type !== "ability-score") continue;
      finalScores[modifier.ability] = Math.min(modifier.maximum ?? 20, finalScores[modifier.ability] + modifier.amount);
    }
  }

  // ---- 6. Interpret every granted feature. Roll-time riders reach the table as carriers. A class's feature reads
  // that class's own level and table row ("1d10 plus your Fighter level"); species, background and feat features
  // read the character level. ----
  const castingOf = (entry: BuildClass) => entry.subclass?.spellcasting ?? entry.record.spellcasting ?? null;
  const leadCasting = classes.map(castingOf).find((casting) => casting !== null) ?? null;
  const classContexts = new Map(
    classes.map((entry): [string, BuildContext] => [
      entry.record.id,
      {
        level: entry.level,
        proficiencyBonus,
        finalScores,
        spellcastingAbility: castingOf(entry)?.ability ?? null,
        classResources: entry.row.classResources
      }
    ])
  );
  const characterContext: BuildContext = {
    level: input.level,
    proficiencyBonus,
    finalScores,
    spellcastingAbility: (castingOf(classes[0]) ?? leadCasting)?.ability ?? null,
    classResources: classes[0].row.classResources
  };
  const contextOf = (classId: string | null): BuildContext =>
    (classId === null ? undefined : classContexts.get(classId)) ?? characterContext;
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
    pickedSpellUses: new Map(),
    hitPointBonus: 0,
    speedBonus: 0,
    armorClassBonus: 0,
    armorClassBonusWhileArmored: 0,
    initiativeBonus: 0,
    unarmoredDefenses: [],
    idOwners: new Map()
  };
  // Whose spellcasting ability a feature's spells use: the species' traits share one, each feat has its own.
  const speciesFeatureIds = new Set([...species.traits, ...(lineage?.traits ?? [])].map((trait) => trait.id));
  const featFeatureIds = new Set([originFeat, ...chosenFeats].flatMap((feat) => (feat ? [feat.feature.id] : [])));
  const sourceOfFeature = (featureId: string | null, classId: string | null): SpellSource =>
    featureId !== null && speciesFeatureIds.has(featureId)
      ? "species"
      : featureId !== null && featFeatureIds.has(featureId)
        ? `feat:${featureId}`
        : `class:${classId ?? startingId}`;
  const spellSourceOf = (
    record: FeatureRecord,
    origin: CharacterFeatureOrigin | null,
    classId: string | null
  ): SpellSource =>
    origin === null
      ? `feat:${record.id}`
      : origin.kind === "species" || origin.kind === "lineage"
        ? "species"
        : origin.kind === "option"
          ? sourceOfFeature(origin.sourceId, classId)
          : `class:${classId ?? startingId}`;
  for (const { record, origin, classId } of granted)
    interpretFeature(
      record,
      interpreted,
      contextOf(classId),
      spellSourceOf(record, origin, classId),
      classId,
      classId === null ? null : (classOf.get(classId)?.record.name ?? null)
    );
  // Martial Arts reads its own class's column (a Monk's), and runs after the features so an id a feature already
  // declared keeps it.
  const martialContext = [...classContexts.values()].find((context) => martialArtsDieOf(context) !== null);
  const strike = martialContext ? martialArtsStrike(martialContext) : null;
  const martialArtsDie = strike && martialContext ? martialArtsDieOf(martialContext) : null;
  if (strike && !interpreted.actions.some((existing) => existing.id === strike.id)) interpreted.actions.push(strike);
  // `definition.character.features`, deduped on `{kind, sourceId, id}` so no record gets two carriers.
  // `origin: null` rows are skipped: they are already on `character.feats`.
  const heldFeatures = dedupeFeatureRefs(granted);

  // ---- 7. Hit points: rules-5e pool math over the levels in the order taken. Only the starting class's level 1
  // takes its die's maximum (SRD Multiclassing: "You gain the level 1 Hit Points for a class only when your total
  // character level is 1"); every other level, in whichever class, is that class's average or a roll of its die. A
  // rolled level counts the roll (SRD); a table may raise it to the average (`builderPolicy.hitPointRollFloor`). ----
  const conModifier = abilityModifier(finalScores.con);
  const levelDice = sequence.map((classId) => classOf.get(classId)!.record.hitDie);
  const perLevel = sequence.map((classId, index) => ({ classId, level: 1, hitDie: levelDice[index] }));
  let hitPointMaximum: number;
  if (input.hp.mode === "average") {
    hitPointMaximum = hitPointPool(perLevel, conModifier, "average", [], progression);
  } else {
    const entries = input.hp.entries ?? [];
    if (entries.length !== input.level - 1)
      reject(
        `Rolled hit points need exactly ${input.level - 1} entries (levels 2-${input.level}); got ${entries.length}.`
      );
    entries.forEach((entry, index) => {
      const die = levelDice[index + 1];
      const faces = hitDieFaces(die);
      if (!Number.isInteger(entry) || entry < 1 || entry > faces)
        reject(`A ${die} hit-point roll must be 1-${faces}; got ${entry}.`);
    });
    const mode = policy.hitPointRollFloor === "average" ? "max-of-both" : "roll";
    hitPointMaximum = hitPointPool(perLevel, conModifier, mode, entries, progression);
  }
  hitPointMaximum = Math.max(1, hitPointMaximum + interpreted.hitPointBonus);

  // ---- 8. Proficiencies: the starting class's saves and training, the multiclass training of every later class
  // (SRD: "you gain only some of the new class's starting proficiencies"), every consumed pick, and fixed grants. ----
  const laterClasses = classes.slice(1);
  const multiclassTraining = (field: "armor" | "weapons" | "tools") =>
    laterClasses.flatMap((entry) => entry.record.multiclassProficiencies?.[field] ?? []);
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
  // pick lost; the builder greys these out, so a payload that sends one is refused and never quietly shortened.
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
    [
      ...classRecord.toolProficiencies,
      ...multiclassTraining("tools"),
      ...background.toolProficiencies,
      ...interpreted.grantedTools
    ]
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
    armor: dedupe([...classRecord.armorProficiencies, ...multiclassTraining("armor"), ...interpreted.grantedArmor]),
    weapons: dedupe([
      ...classRecord.weaponProficiencies,
      ...multiclassTraining("weapons"),
      ...interpreted.grantedWeapons
    ]),
    tools: dedupe([
      ...classRecord.toolProficiencies,
      ...multiclassTraining("tools"),
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

  // ---- 9. Spellcasting: each casting class's own row (cantrips, prepared cap, the highest level it prepares, its
  // list and ability) over one shared slot pool, plus chosen and granted spells. ----
  // Feature-consumed spell/cantrip picks join the list outside the class budgets and are always prepared (Magic
  // Initiate, Magical Discoveries); a feature with limited uses casts its pick free with them. A feature tagged
  // "spellbook" (Evocation Savant) adds spells to prepare from instead.
  const featurePicksOf = (kind: "spell" | "cantrip") =>
    offers
      .filter((offer) => offer.kind === kind && offer.featureId !== null)
      .flatMap((offer) => offer.taken.map((id) => ({ id, featureId: offer.featureId!, classId: offer.classId })));
  const spellbookFeatures = new Set(
    granted.filter(({ record }) => record.tags.includes(SPELLBOOK_TAG)).map(({ record }) => record.id)
  );
  const castingClassIds = new Set(classSpells.map((budget) => budget.classId));
  /** The casting class a source casts as, or null for a species, a feat, or a class that casts nothing. */
  const castingClassOf = (source: SpellSource): string | null => {
    const classId = source.startsWith("class:") ? source.slice("class:".length) : null;
    return classId !== null && castingClassIds.has(classId) ? classId : null;
  };
  const pickedEntry = (
    pick: Readonly<{ id: string; featureId: string; classId: string | null }>,
    kind: "spell" | "cantrip"
  ): SpellEntry => {
    const record = library.spellRecord(pick.id);
    const source = sourceOfFeature(pick.featureId, pick.classId);
    const spellbook = spellbookFeatures.has(pick.featureId);
    const uses = kind === "spell" ? interpreted.pickedSpellUses.get(pick.featureId) : undefined;
    const castsAs = castingClassOf(source);
    return {
      id: pick.id,
      name: record?.name ?? pick.id,
      level: record?.level ?? (kind === "cantrip" ? 0 : 1),
      prepared: !spellbook,
      alwaysPrepared: !spellbook,
      ...(castsAs ? { classId: castsAs } : {}),
      source,
      ...(uses ? { free: uses } : {})
    };
  };
  const featureCantripEntries = featurePicksOf("cantrip").map((pick) => pickedEntry(pick, "cantrip"));
  const featureSpellEntries = featurePicksOf("spell").map((pick) => pickedEntry(pick, "spell"));
  const grantedSpellEntry = (grantedSpell: InterpretedFeatures["grantedSpells"][number]): SpellEntry => {
    const record = library.spellRecord(grantedSpell.id);
    return {
      id: grantedSpell.id,
      name: record?.name ?? grantedSpell.id,
      level: grantedSpell.level ?? record?.level ?? 0,
      prepared: true,
      alwaysPrepared: grantedSpell.alwaysPrepared,
      ...(grantedSpell.withSlot ? {} : { withSlot: false as const }),
      source: grantedSpell.source,
      ...(grantedSpell.free !== undefined ? { free: grantedSpell.free } : {})
    };
  };
  /** Adds a spell once; a second source of the same spell adds only its free casting. */
  const addSpell = (spells: SpellEntry[], entry: SpellEntry) => {
    const existing = spells.find((candidate) => candidate.id === entry.id);
    if (!existing) spells.push(entry);
    else if (existing.free === undefined && entry.free !== undefined) {
      existing.free = entry.free;
      existing.prepared = true;
      existing.alwaysPrepared = true;
    }
  };
  // The ability each source casts with: a class's own, the species' or a feat's chosen one, else an ability the grant
  // names, else the first caster's (a non-caster falls back to the first of those, then Intelligence).
  const chosenAbility = new Map<SpellSource, Ability>();
  for (const offer of offers) {
    if (offer.kind !== SPELLCASTING_ABILITY_KIND) continue;
    const ability = ABILITIES.find((candidate) => candidate === offer.taken[0]);
    const source = sourceOfFeature(offer.featureId, offer.classId);
    if (ability && !chosenAbility.has(source)) chosenAbility.set(source, ability);
  }
  const grantAbility = new Map<SpellSource, Ability>();
  for (const grantedSpell of interpreted.grantedSpells)
    if (grantedSpell.ability && !grantAbility.has(grantedSpell.source))
      grantAbility.set(grantedSpell.source, grantedSpell.ability);
  const casterAbility = new Map(classSpells.map((budget) => [budget.classId, budget.casting.ability] as const));
  const fallbackAbility: Ability =
    classSpells[0]?.casting.ability ?? [...chosenAbility.values(), ...grantAbility.values()][0] ?? "int";
  const abilityOf = (source: SpellSource): Ability =>
    (castingClassOf(source) !== null ? casterAbility.get(castingClassOf(source)!) : undefined) ??
    chosenAbility.get(source) ??
    grantAbility.get(source) ??
    fallbackAbility;
  const numbersOf = (source: SpellSource): CasterNumbers => {
    const score = finalScores[abilityOf(source)];
    return {
      attackBonus: spellAttackBonus(score, proficiencyBonus),
      saveDc: spellSaveDc(score, proficiencyBonus),
      characterLevel: input.level,
      modifier: abilityModifier(score)
    };
  };
  for (const row of strayClassSpellRows) {
    const named = classOf.get(row.classId ?? startingId);
    reject(
      named
        ? `${named.record.name} has no spell list to choose spells from.`
        : `"${row.id}" is chosen for "${row.classId}", a class this character has no levels in.`
    );
  }
  let spellcasting: Record<string, unknown> | undefined;
  if (classSpells.length > 0) {
    const { slots, pact } = spellSlotsOf(classes);
    // SRD: an always-prepared granted spell doesn't count against the prepared limit, so the grant wins
    // and a matching pick is not charged to the cap. A feature's always-prepared spell (Magic Initiate) counts too.
    const alwaysPreparedGrants = new Set([
      ...interpreted.grantedSpells.filter((entry) => entry.alwaysPrepared).map((entry) => entry.id),
      ...featureSpellEntries.filter((entry) => entry.alwaysPrepared).map((entry) => entry.id)
    ]);
    const spells: SpellEntry[] = [];
    // Every id the ledger claimed, and for which class, so "chosen twice" still rejects when both rows defer to one
    // grant. A spell sits on the sheet once, so two classes cannot both prepare it.
    const claimedBy = new Map<string, string>();
    for (const budget of classSpells) {
      const entry = classOf.get(budget.classId)!;
      let listOptions: Map<string, { id: string; name: string; level?: number }>;
      try {
        listOptions = new Map(resolveCatalogChoice(budget.listSlug, catalogs).map((option) => [option.id, option]));
      } catch (error) {
        if (error instanceof CatalogChoiceError)
          reject(`The ${budget.className} spell list could not be resolved: ${error.message}`);
        throw error;
      }
      const chargedCantripRows = budget.cantripRows.filter((row) => !alwaysPreparedGrants.has(row.id));
      const chargedPreparedRows = budget.spellRows.filter((row) => !alwaysPreparedGrants.has(row.id));
      // The printed row plus granted extras (Thaumaturge's extra cantrip); the wizard composes the same sum.
      if (chargedCantripRows.length > budget.cantrips)
        reject(
          `${budget.className} knows ${budget.cantrips} cantrips at level ${entry.level}; got ${chargedCantripRows.length}.`
        );
      if (chargedPreparedRows.length > budget.prepared)
        reject(
          `${budget.className} ${budget.casting.prepares === "prepared" ? "prepares" : "knows"} ${budget.prepared} spells at level ${entry.level}; got ${chargedPreparedRows.length}.`
        );
      const claim = (row: CharacterChoice) => {
        const earlier = claimedBy.get(row.id);
        if (earlier === budget.className) reject(`"${row.id}" is chosen twice.`);
        if (earlier !== undefined)
          reject(`"${row.id}" is already chosen for ${earlier}; a spell is on the sheet once.`);
        claimedBy.set(row.id, budget.className);
      };
      for (const row of budget.cantripRows) {
        const option = listOptions.get(row.id) ?? reject(`"${row.id}" is not on the ${budget.className} spell list.`);
        if (option.level !== 0) reject(`"${row.id}" is a level ${option.level} spell. Record it as a spell choice.`);
        claim(row);
        if (alwaysPreparedGrants.has(option.id)) continue; // the grant supplies it, uncharged
        spells.push({
          id: option.id,
          name: option.name,
          level: 0,
          prepared: true,
          alwaysPrepared: true,
          source: `class:${budget.classId}`
        });
      }
      for (const row of budget.spellRows) {
        const option = listOptions.get(row.id) ?? reject(`"${row.id}" is not on the ${budget.className} spell list.`);
        const spellLevel = option.level ?? 0;
        if (spellLevel < 1) reject(`"${row.id}" is a cantrip. Record it as a "cantrip" choice.`);
        if (spellLevel > budget.maxSlotLevel)
          reject(
            `"${row.id}" is level ${spellLevel}, above the highest slot level (${budget.maxSlotLevel}) at ${budget.className} ${entry.level}.`
          );
        claim(row);
        if (alwaysPreparedGrants.has(option.id)) continue; // the grant supplies it, uncharged and always prepared
        spells.push({
          id: option.id,
          name: option.name,
          level: spellLevel,
          prepared: true,
          alwaysPrepared: false,
          classId: budget.classId,
          source: `class:${budget.classId}`
        });
      }
    }
    for (const entry of [...featureCantripEntries, ...featureSpellEntries]) addSpell(spells, entry);
    for (const grantedSpell of interpreted.grantedSpells) addSpell(spells, grantedSpellEntry(grantedSpell));
    const lead = classSpells[0];
    const { saveDc, attackBonus } = numbersOf(`class:${lead.classId}`);
    // Spells become actions with the numbers of the ability their source casts with; the sheet sends only an id.
    linkSpellActions(spells, interpreted.actions, numbersOf, library, slots.length > 0 || pact !== null);
    // Top-level fields stay populated (the schema demands the combined pool when per-class slots exist); a lone
    // caster also records the pool as its own.
    spellcasting = {
      ability: lead.casting.ability,
      saveDc,
      attackBonus,
      slots,
      ...(pact ? { pact } : {}),
      // `prepared` is the composed cap the sheet shows.
      classes: classSpells.map((budget) => {
        const numbers = numbersOf(`class:${budget.classId}`);
        return {
          classId: budget.classId,
          ability: budget.casting.ability,
          saveDc: numbers.saveDc,
          attackBonus: numbers.attackBonus,
          ...(classSpells.length === 1 ? { slots } : {}),
          ...(classOf.get(budget.classId)!.row.preparedCount !== undefined ? { prepared: budget.prepared } : {})
        };
      }),
      spells: spells.map(sheetSpell)
    };
  } else {
    const extraSpells: SpellEntry[] = [];
    for (const entry of [
      ...interpreted.grantedSpells.map(grantedSpellEntry),
      ...featureCantripEntries,
      ...featureSpellEntries
    ])
      addSpell(extraSpells, entry);
    if (extraSpells.length > 0) {
      // A non-caster with granted/feat spells: model them so the sheet can cast them. With no slots, only the
      // free casts are actions.
      const { saveDc, attackBonus } = numbersOf(`class:${startingId}`);
      linkSpellActions(extraSpells, interpreted.actions, numbersOf, library, false);
      spellcasting = {
        ability: fallbackAbility,
        saveDc,
        attackBonus,
        slots: [],
        spells: extraSpells.map(sheetSpell)
      };
    }
  }

  // ---- 10. Starting inventory: the starting class's and the background's equipment options, catalog-resolved. A
  // class taken later brings no equipment. ----
  const equipmentRows = input.choices.filter((row) => row.kind === "equipment");
  const inventory: InventoryItem[] = [];
  let goldPieces = 0;
  const consumeEquipmentOption = (
    source: "class" | "background",
    options: ClassReference["startingEquipment"],
    toolChoices: readonly string[]
  ) => {
    if (options.length === 0) return;
    const optionIds = new Set(options.map((option) => option.id));
    const matches = equipmentRows.filter((row) => optionIds.has(row.id));
    if (matches.length !== 1)
      reject(`Choose exactly one ${source} equipment option (${options.map((option) => option.id).join(", ")}).`);
    const chosen = options.find((option) => option.id === matches[0].id)!;
    goldPieces += chosen.goldPieces;
    // A kit item that is one of this source's tool choices is the tool chosen there ("Gaming Set (same as above)").
    const chosenTools = [...(offers.find((offer) => offer.key === `${source}-tools`)?.taken ?? [])];
    const items = chosen.items.map((item) => {
      if (!toolChoices.includes(item.id) || chosenTools.length === 0 || chosenTools.includes(item.id)) return item;
      const tool = chosenTools.shift()!;
      return { ...item, id: tool, name: library.equipmentRecord(tool)?.name ?? item.name };
    });
    for (const item of items) {
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
            ...(record?.description ? { description: record.description.slice(0, 12000) } : {}),
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
                    ...(record.weapon.melee !== undefined ? { melee: record.weapon.melee } : {}),
                    ...(record.weapon.versatileDice ? { versatileDice: record.weapon.versatileDice } : {}),
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
  consumeEquipmentOption("class", classRecord.startingEquipment, classRecord.toolChoices?.from ?? []);
  consumeEquipmentOption("background", background.startingEquipment, background.toolChoices?.from ?? []);
  const strayEquipment = equipmentRows.find(
    (row) =>
      !classRecord.startingEquipment.some((option) => option.id === row.id) &&
      !background.startingEquipment.some((option) => option.id === row.id)
  );
  if (strayEquipment)
    reject(`"${strayEquipment.id}" is not ${withArticle(classRecord.name)} or ${background.name} equipment option.`);
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
      : reject(`${species.name} may be ${species.sizes.join(" or ")}. Choose one of those sizes.`)
    : species.sizes.includes("medium")
      ? "medium"
      : species.sizes[0];
  const speedFeet = Math.max(0, species.speedFeet + interpreted.speedBonus);
  const dexModifier = abilityModifier(finalScores.dex);
  // The same AC function `instantiate` re-runs. Unarmored Defense is passed into the equipment step
  // because a shield alone makes it answer; `allowShield` decides whether it still applies. With several ways to
  // calculate AC only one applies at a time (SRD Multiclassing), so the best one for this loadout is used.
  const unarmoredDefenses = interpreted.unarmoredDefenses.map((entry) => ({
    bonus: abilityModifier(finalScores[entry.ability]),
    allowShield: entry.allowShield
  }));
  const equipmentAc = bestArmorClass(dexModifier, inventory, unarmoredDefenses);
  const unarmoredAc = 10 + dexModifier + Math.max(0, ...unarmoredDefenses.map((entry) => entry.bonus));
  const wearingArmor = inventory.some((item) => item.equipped && item.category === "armor" && item.armor);
  // The starting AC the definition prints; the live AC is re-derived from what is worn (`storedArmorClass`).
  const armorClassRider = interpreted.armorClassBonus + (wearingArmor ? interpreted.armorClassBonusWhileArmored : 0);
  const armorClass = (equipmentAc ?? unarmoredAc) + armorClassRider;
  const initiativeBonus = dexModifier + interpreted.initiativeBonus;

  // ---- 12. Assemble, validate through the canonical schema, done. ----
  const classLine = classes
    .map(
      (entry) =>
        `${entry.record.name}${classes.length > 1 ? ` ${entry.level}` : ""}${entry.subclass ? ` (${entry.subclass.name})` : ""}`
    )
    .join(" / ");
  const summary = [
    `Level ${input.level} ${species.name}${lineage ? ` (${lineage.name})` : ""} ${classLine}`,
    background.name
  ]
    .join(" · ")
    .slice(0, 280);
  const sequenceRow = classLevelsRow(sequence);
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: BUILDER_SOURCE_NAME, version: "1" },
    name: input.name,
    summary,
    size,
    abilityScores: finalScores,
    proficiencyBonus,
    armorClass,
    // The one-term formula can only name one die; a multiclass sheet's Hit Dice come from its class rows.
    hitPoints: {
      maximum: hitPointMaximum,
      ...(classes.length === 1 ? { formula: `${input.level}d${hitDieFaces(classRecord.hitDie)}` } : {})
    },
    initiativeBonus,
    speedFeet,
    actions: interpreted.actions,
    token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
    // Every feature lands as a trait. `unarmoredDefense` (stored as the ability) survives AC re-derivation.
    extensions: {
      "open5e.srd-2024": {
        traits: interpreted.traits,
        ...(interpreted.unarmoredDefenses.length > 0 ? { unarmoredDefense: interpreted.unarmoredDefenses[0] } : {}),
        ...(interpreted.unarmoredDefenses.length > 1 ? { unarmoredDefenses: interpreted.unarmoredDefenses } : {})
      }
    },
    ...(interpreted.damageResistances.length > 0 ? { damageResistances: dedupe(interpreted.damageResistances) } : {}),
    ...(interpreted.damageImmunities.length > 0 ? { damageImmunities: dedupe(interpreted.damageImmunities) } : {}),
    ...(interpreted.conditionImmunities.length > 0
      ? { conditionImmunities: dedupe(interpreted.conditionImmunities) }
      : {}),
    character: {
      classes: classes.map((entry) => ({
        id: entry.record.id,
        name: entry.record.name,
        level: entry.level,
        hitDie: entry.record.hitDie,
        ...(entry.subclass ? { subclass: { id: entry.subclass.id, name: entry.subclass.name } } : {})
      })),
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
      // so a level-down/level-up round trip can restore the character, and a multiclass sheet's level order.
      choices: [
        ...input.choices.filter(
          (row) => row.kind !== "hp-roll" && row.kind !== ABILITY_SCORES_KIND && row.kind !== CLASS_LEVELS_KIND
        ),
        abilityScoresRow(input),
        ...(sequenceRow ? [sequenceRow] : []),
        ...hitPointRollRows(input, sequence)
      ]
    },
    proficiencies,
    ...(spellcasting ? { spellcasting } : {}),
    startingInventory: inventory,
    startingCurrency: { cp: 0, sp: 0, ep: 0, gp: goldPieces, pp: 0 }
  });
}

/** The best Armor Class equipped items give with any one of these alternative calculations (or none), or null when
 *  nothing equipped answers (no armor or shield). */
function bestArmorClass(
  dexModifier: number,
  inventory: readonly InventoryItem[],
  unarmoredDefenses: readonly UnarmoredDefense[]
): number | null {
  const options = [null, ...unarmoredDefenses].map((unarmored) =>
    armorClassFromEquipment(dexModifier, inventory, unarmored)
  );
  const answered = options.filter((value): value is number => value !== null);
  return answered.length > 0 ? Math.max(...answered) : null;
}

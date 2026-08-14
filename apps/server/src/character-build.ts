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
 * SERVER-SIDE character assembly for `character.create` (task packet, phase-2 amendment). The client
 * sends CHOICES - identity ids, base scores + the background allocation, per-level HP entries, and
 * the `choices[]` provenance ledger - never a finished sheet: feature riders are deliberately
 * withheld from the wire, so only the server can interpret them (CLAUDE.md rule 2). This module:
 *
 *   1. validates every id against the content catalogs, and every catalog-driven pick through the
 *      SAME `resolveCatalogChoice` the wizard renders from (QA blocker B1) - an unknown id rejects
 *      loudly, never a silent skip;
 *   2. interprets each granted feature's structured riders (actions with derived attack/save
 *      numbers, limited uses, grants, typed modifiers, effect grants) into the definition, bounded
 *      to the authored vocabulary - anything unmodeled stays prose per ADR-0008, landing in the
 *      `extensions` traits block the sheet already renders for imported characters;
 *   3. assembles the canonical `ActorDefinition` with `@vtt/rules-5e` math everywhere (HP pool,
 *      proficiency bonus, spell DC/attack, AC from equipment - the same function `instantiate`
 *      re-runs, so the two can never disagree), stores the ledger verbatim for level-up/respec, and
 *      re-validates the result through `ActorDefinitionSchema`.
 *
 * The caller lands the result through `importActorDefinition`, so the `import-<actorId>` keying that
 * light-edit / removal / orphan-cleanup depend on is satisfied by construction.
 *
 * Ledger-row conventions this interpreter reads (all open slugs; the wizard writes the same rows):
 *   - kind = a feature's own `choice.kind` -> validated against that feature's `from`/`fromCatalog`
 *     options (disambiguate two same-kind offers with `payload.featureId`);
 *   - kind "skill"/"tool"/"language" also match the class/background/species choose-N lists;
 *   - kind "subclass" mirrors the top-level `subclassId`; kind "lineage" picks the species lineage;
 *   - kind "asi-or-feat" with id "asi" carries `payload.increases: [{ability, amount}]` (+2 total);
 *     any other id is a feat resolved from the catalog (as are "feat" / "fighting-style" rows);
 *   - kind "cantrip" / "spell" (without a featureId) fill the class's level-row budgets
 *     (cantripsKnown / preparedCount) from the class's spell list;
 *   - kind "equipment" names ONE class and ONE background starting-equipment option id;
 *   - kind "size" (optional) picks among the species' printed sizes; defaults to medium.
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

/**
 * SRD "Repeatable" on a feat means the same feat may simply be taken again (Ability Score
 * Improvement, Skilled) - EXCEPT Magic Initiate, whose repeat clause reads "you must choose a
 * different spell list each time". In this catalog a spell list IS a separate feat id
 * (magic-initiate-cleric / -druid / -wizard), and a `<list>-spells` catalog slug is how a feature
 * names one - the same convention step 9 resolves the class spell list through. So for such a feat
 * "a different spell list" reads exactly as "a different feat id", and repeating the same id is not
 * legal. If the content vocabulary later carries an explicit repeat constraint, this is the one
 * place that has to change.
 */
function repeatsOnlyWithADifferentSpellList(feat: FeatReference): boolean {
  return featurePicks(feat.feature).some((pick) => pick.fromCatalog?.endsWith("-spells") ?? false);
}

// ---------------------------------------------------------------------------------------------
// Choice offers: everything the content ASKED the player to pick, with its legal options.
// ---------------------------------------------------------------------------------------------

/**
 * One pick the content offers. `capacity` is choose x times-granted (the Fighter's ASI feature is
 * granted once per ASI level). `unresolvable` marks a fromCatalog slug that resolved to nothing -
 * a partial-content gap (no fighting-style feats authored yet): the pick is NOT required, but any
 * ledger row that targets it still fails with the resolver's own loud error, never a silent accept.
 */
export type ChoiceOffer = {
  key: string;
  featureId: string | null;
  /**
   * Other feature ids a `payload.featureId` tag may name for this offer. A pick offered BY a chosen
   * option (Divine Order's Thaumaturge asks for an extra Cleric cantrip) is keyed on the OPTION's id,
   * but the wizard may just as reasonably tag the row with the parent feature ("divine-order"), so
   * both are accepted rather than rejecting a ledger that is unambiguous either way.
   */
  featureAliases: readonly string[];
  kind: string;
  capacity: number;
  options: ReadonlySet<string>;
  /** Spell level per option id, when the options came from a `*-spells` catalog (drives maxSpellLevel). */
  optionLevels: ReadonlyMap<string, number> | null;
  /** Inline options carrying their OWN mechanics (Divine Order's roles, Giant Ancestry's boons); null when the ids are bare. */
  optionRecords: readonly FeatureOption[] | null;
  unresolvable: string | null;
  repeatable: boolean;
  maxSpellLevel: number | null;
  /** FLOOR on an option's spell level. Mystic Arcanum is "one level 6 spell", not "6 or lower"; both bounds set to 6 make it exact. */
  minSpellLevel: number | null;
  /** The ceiling an ability-score pick from this offer may reach; null = the SRD's 20 (epic boons say 30). */
  maximum: number | null;
  label: string;
  /**
   * The character LEVEL(S) this offer's picks belong to - one entry per grant, so a feature granted
   * at 4/8/12/16 reads `[4, 8, 12, 16]` while everything else reads `[1]` or `[<its grant level>]`.
   *
   * Nothing in the validation path reads this: a row's own `level` is only bound-checked against the
   * character's. It exists for the WRITERS - the random generator records the level each pick was
   * really made at, so `level-ledger.ts` (which matches a stored row to a wizard offer on the tuple
   * `(level, kind, classId, featureId)`) can prefill a generated character's level-up exactly as it
   * prefills a hand-built one. The wizard's own convention is mirrored: species, background and the
   * two class proficiency lists are level 1; a class feature takes its grant level; a subclass
   * feature takes `feature.level ?? subclassLevel`; a chosen feat's own picks take THE ONE GRANT
   * that took the feat (`stepOfPick`).
   *
   * That last clause used to read "inherit the offer that took the feat", meaning the whole array -
   * and the claim above was false because of it: `levelOfPick` resolves index 0 of an inherited
   * `[4, 8, 12, 16]`, so a Grappler taken at the level-8 ASI wrote its ability-score row at level 4
   * and the level-up wizard re-asked for it. The docstring is the specification; where it and the
   * code disagreed, the code was the defect.
   */
  levels: readonly number[];
  /** The class a pick belongs to, or null for species/background/origin decisions - the wizard's `classId` on the row. */
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

/**
 * IS THIS OPTION INSIDE THE OFFER'S SPELL-LEVEL WINDOW - a ceiling, a floor, or both.
 *
 * `maxSpellLevel` alone let a level-11 Warlock spend a level-6 Mystic Arcanum on a cantrip, because
 * "choose one level 6 Warlock spell" was only ever expressible as "level 6 or lower". Both bounds set
 * to the same number make the pick exact. An option with no known level reads as 0, exactly as the
 * ceiling has always treated it.
 */
const withinSpellWindow = (offer: Pick<ChoiceOffer, "optionLevels" | "maxSpellLevel" | "minSpellLevel">, id: string): boolean => {
  const level = offer.optionLevels?.get(id) ?? 0;
  return (offer.maxSpellLevel === null || level <= offer.maxSpellLevel)
    && (offer.minSpellLevel === null || level >= offer.minSpellLevel);
};

/** `withinSpellWindow`, for the random generator - so it draws from exactly the ids `matchRow` will accept. */
export const withinOfferSpellWindow = withinSpellWindow;

/**
 * EVERY PICK BUDGET AN `extraPicks` GRANT MAY NAME BY A FIXED KEY - the eight that are not a
 * particular feature's own pick (which is spelled `feature:<featureId>` and validated against the
 * features this build actually has).
 *
 * Six of them are the `listOffer` keys immediately below, and `listOffer` is typed to this union so
 * the list and the calls cannot drift apart. The last two are the printed CLASS COLUMNS rather than
 * offers - `cantripsKnown` and `preparedCount`/`spellsKnown`, read at step 9 - which is exactly why
 * an unmatched key cannot simply be "no offer has this key".
 *
 * These strings are also the wizard's own offer keys, verbatim (`build-payload.ts` `computeOffers`),
 * AND the suggestions the homebrew editor's `extraPicks` offer box shows. That is the whole
 * agreement: one namespace, spelled ONCE - in the content package beside `PickBudgetKeySchema`,
 * where the third consumer can reach it without importing this server module - so a grant the
 * editor offers is a grant the wizard honours is a grant this validator honours.
 */
export const NAMED_PICK_BUDGETS = NAMED_PICK_BUDGET_KEYS;
export type NamedPickBudget = (typeof NAMED_PICK_BUDGETS)[number];

/**
 * A chosen inline option IS a feature: identical rider fields, identical meanings (see the content
 * package's `FeatureOptionSchema`). Re-shaping it into a `FeatureRecord` means one interpreter runs
 * for class features, species traits, feats AND chosen options - no second code path to keep honest.
 */
function optionAsFeature(option: FeatureOption): FeatureRecord {
  return {
    id: option.id, name: option.name, description: option.description, tags: option.tags,
    actions: option.actions, effects: option.effects, modifiers: option.modifiers,
    // A chosen option raises a budget exactly as a feature does (Thaumaturge's extra Cleric cantrip).
    // Listed explicitly rather than spread, so a field added to one carrier and forgotten on the
    // other is a TYPE error here instead of a rider that silently stops arriving.
    extraPicks: option.extraPicks,
    replaces: option.replaces,
    ...(option.uses ? { uses: option.uses } : {}),
    ...(option.grants ? { grants: option.grants } : {}),
    // An option's own choice cannot nest further options (the vocabulary is depth-limited), but the
    // feature-level type states `from` explicitly because its schema derives it - restate it here.
    ...(option.choice ? { choice: { ...option.choice, from: option.choice.from } } : {})
  };
}

// ---------------------------------------------------------------------------------------------
// Feature-rider interpretation (bounded vocabulary; unmodeled mechanics stay prose - ADR-0008).
// ---------------------------------------------------------------------------------------------

type BuildContext = Readonly<{
  level: number;
  proficiencyBonus: number;
  finalScores: Record<Ability, number>;
  spellcastingAbility: Ability | null;
  /** The class table's printed row for THIS level - what `scaling: {type: "class-resource"}` reads. */
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
  /** Flat AC that only applies while body armor is worn (the Defense fighting style's "+1 while you wear armor"). */
  armorClassBonusWhileArmored: number;
  initiativeBonus: number;
  unarmoredDefense: { ability: Ability; allowShield: boolean } | null;
};

// ---------------------------------------------------------------------------------------------
// WHO OWNS WHICH RIDER. The vocabulary is 21 variants (`FeatureModifierSchema`); this fold owns 8
// and the roll-time collector owns the other 13. Both halves are named, so neither can grow a hole.
// ---------------------------------------------------------------------------------------------

/**
 * Compile-time claim that every literal in `BUILDER_BAKED_MODIFIER_TYPES` is really in the authored
 * vocabulary. `equipment-derivation.ts` cannot name `FeatureModifier` (it declares its rider views
 * structurally on purpose), so the check has to happen here - and without it a typo in that list
 * would leave `CarrierRiderType` below silently over-wide instead of failing.
 */
BUILDER_BAKED_MODIFIER_TYPES satisfies readonly FeatureModifier["type"][];
type CarrierRiderType = Exclude<FeatureModifier["type"], (typeof BUILDER_BAKED_MODIFIER_TYPES)[number]>;

/**
 * THE OTHER HALF OF THE PARTITION, and the reason it is a `Record` rather than a comment: TypeScript
 * requires a key for EVERY member of `CarrierRiderType`, so adding a 22nd variant to
 * `FeatureModifierSchema` without deciding who reads it stops this file compiling.
 *
 * These fourteen are NOT folded into the definition, because a build-time number cannot express them:
 * `roll-mode` is advantage at a moment, `critical-range` is a threshold the attack path reads,
 * `extra-damage` is dice rolled on a hit, `spell-slot`/`resource-bonus` are live maxima. They reach
 * the table as RIDER CARRIERS instead - `deriveEquipment` turns the character's `character.feats`
 * into carriers with no `sourceItemId`, and the same `collectRiders` that serves a magic item serves
 * them. That is why `interpretFeature` does not grow fourteen new cases.
 *
 * The value records where each is actually consumed, so an authored rider that reaches nothing is a
 * KNOWN gap rather than a surprise. `"unread"` means the vocabulary and the collector carry it but no
 * consumer applies it YET - the same for an item, so it is a pre-existing engine gap, not a feat one.
 */
const CARRIER_RIDER_DISPOSITION: Readonly<Record<CarrierRiderType, "standing" | "at-its-moment" | "unread" | "display-only">> = {
  "attack-bonus": "standing",        // effective-actions folds it into attack.bonus; action-resolution adds the on-attack-roll half
  "save-bonus": "standing",          // saving-throws.ts saveRiderBonus (standing + on-saving-throw)
  "spell-save-dc": "standing",       // effective-actions folds it into save.dc
  "spell-slot": "standing",          // spellSlotMaxima, via derivation.spellSlots
  "resource-bonus": "standing",      // effective-actions usesBonus raises uses.limit
  "critical-range": "standing",      // effective-actions criticalThreshold
  "critical-bonus-dice": "standing", // effective-actions folds it into attack.criticalBonusDice
  // MOVED HERE FROM THE BAKED HALF, and the move is the fix. Baking raised `attack.count` on the
  // actions a FEATURE declares; the five classes that get Extra Attack declare none, so it reached
  // nothing at all. `withStandingRiders` now raises the count on the DERIVED weapon swings instead -
  // the only actions the SRD's "whenever you take the Attack action" can mean.
  "extra-attack": "standing",        // effective-actions extraAttacksFor raises attack.count on a weapon swing
  "roll-mode": "at-its-moment",      // attacks (action-resolution), saves (saving-throws), initiative (encounter)
  "extra-damage": "at-its-moment",   // action-resolution rolls it as its own typed damage entry
  "damage-bonus": "standing",        // effective-actions folds it into the first damage part's formula; a moment-gated one lands as a bonusDamage line in action-resolution
  "check-bonus": "standing",         // actor-derived.ts checkRiderBonus, into every check and skill row
  "spell-attack-bonus": "unread",    // reaches derivation.spellAttackBonus; no spell-attack path reads it yet
  "damage-reduction": "at-its-moment", // hit-points.ts damageReductionFor, applied to the total after resistances
  "sense": "display-only"            // like `darkvision`: the trait prose carries it; no definition field models senses
};

/**
 * The intentional NO-OP for a rider the roll-time collector owns, named so the `default` case below
 * reads as a decision instead of a fallthrough.
 *
 * THE GUARD IS THE PARAMETER TYPE. In `default:` the modifier is narrowed to exactly the variants no
 * `case` claimed, so passing it here asserts at COMPILE time that each of them is in the partition
 * above. The thirteen riders this fix restores were lost precisely because that switch had no
 * `default` and nothing anywhere named the variants it did not handle.
 */
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
    // The printed column IS the number, read at this character's level - so Rage 3 and Rage 4 need
    // no `by-level` table beside the table they would be copying. A dice-string amount (Sneak Attack
    // "3d6") is damage, not a count of uses, and resolves to the same 0 an unmatched row gives.
    const amount = context.classResources.find((resource) => resource.id === scaling.id)?.amount;
    return typeof amount === "number" ? amount : 0;
  }
  const rows = [...scaling.table].filter((row) => row.level <= context.level).sort((left, right) => left.level - right.level);
  return rows.length > 0 ? rows[rows.length - 1].limit : 0;
}

/** A feature action -> a definition action, deriving to-hit / DC from the character's own numbers (the rider TEMPLATES name an ability; the builder resolves the number). */
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
    // `FeatureSaveDcSchema` has THREE forms, not two: the "spellcasting" literal, a printed number,
    // and a derived `{base, ability, proficiencyBonus}` - the shape Dragonborn's Breath Weapon uses
    // (8 + CON + PB). Only the literal was resolved, so the object fell through to `ActionSchema`,
    // which requires a number, and EVERY Dragonborn character failed to build with
    // `actions[].save.dc: Expected number, received object`. One of nine species was uncreatable.
    // The attack branch above already resolves its own template; this mirrors it.
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
  // The FEATURE's limited uses ride the action when the action declares none of its own.
  if (feature.uses && assembled.uses === undefined) {
    const limit = resolvedUseLimit(feature.uses, context);
    if (limit >= 1) {
      assembled.uses = { limit: Math.min(20, limit), per: feature.uses.per, ...(feature.uses.pool ? { pool: feature.uses.pool } : {}) };
    }
  }
  return assembled as ActorAction;
}

/**
 * The action id a spell resolves through - `spells[].actionId`, and the key `structuredActionFor`
 * looks the sheet's Cast button up by. Namespaced like the derivation's `item-<id>` so a spell action
 * and a feature action can never be mistaken for each other.
 */
const spellActionId = (spellId: string): string => `spell-${spellId}`;

/**
 * `DiceFormulaSchema`'s own shape, restated here as the GUARD on a printed content column before it
 * becomes an action's damage. The schema would reject it too - but at the end of the build, as a
 * parse failure on a character that is otherwise legal, rather than as a fail-open skip here.
 */
const DICE_FORMULA = /^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i;

/**
 * ONE KNOWN CANTRIP -> THE ACTION THAT RESOLVES IT, or null when it has nothing to resolve.
 *
 * The builder minted no spell actions at all, and the hole was not cosmetic: `spells[].actionId` was
 * never written, so the sheet's `structuredActionFor` found nothing, `castCantrip` fell through to a
 * bare client-side `rollFlat`, and a Warlock's Eldritch Blast rolled 1d10 on the CLIENT with no
 * attack roll, no Charisma and - because `ActorAction.spellId` is what `spell-id-is` matches - no
 * Agonizing Blast. That is a rule-2 violation reached through an absence, and the whole Agonizing
 * Blast proof stood on a hand-written `ELDRITCH_BLAST` object because there was no other way to get
 * one.
 *
 * CANTRIPS ONLY, and the boundary is not timidity - it is that a LEVELED spell action would have to
 * say which slot it spends, and no field on the finished sheet can. Measured, against the real
 * bundles: a Warlock 5's only slots are LEVEL 3 (Pact Magic replaces the column rather than filling
 * it), so `spellSlot` taken from the spell's own level refuses a Bane the character may legally
 * cast; and Ascendant Step's Levitate is a granted casting the SRD says costs no slot at all, yet on
 * `spells[]` it is indistinguishable from a prepared one. Omitting `spellSlot` instead would put a
 * slot-free cast of every leveled spell in the Actions runner. A cantrip is at will, so none of that
 * arises. `docs/ai-ledger/known-bugs.md` carries the leveled half.
 *
 * WHAT COUNTS AS RESOLVABLE, and why it is not simply "it has a damage roll". `SpellReference` carries
 * ONE `damage.roll` and the extractor fills it from whatever die the prose names - for Guidance that
 * is the +1d4 bonus die, not damage. So a roll becomes damage only when the record also names a
 * damage TYPE, and an action is minted only when there is typed damage or a saving throw. Sorcerous
 * Burst (1d8 of a type the caster chooses at cast time) mints nothing and keeps today's loose roll:
 * `attackRoll` is prose-extracted - it is true for BLESS - so a to-hit chip on its strength alone
 * would be a wrong number on screen. A SAVE outranks an attack for the same reason (Vicious Mockery
 * carries both flags; the SRD mechanic is the save).
 *
 * NOT SCALED BY CHARACTER LEVEL. `castingOptions`' `player_level_N` rows (Fire Bolt's 3d10, Eldritch
 * Blast's beams) are read by nothing today - the sheet's own `spellEffectAt` consults them only for
 * an UPCAST - so scaling here would make the action and the effect printed beside it disagree.
 * Recorded in `known-bugs.md` rather than half-fixed here.
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
    // WHICH spell this is. `spell-id-is` matches on it and on nothing else, so Agonizing Blast
    // ("when you cast Eldritch Blast") reaches the damage only because this field is set.
    spellId: spell.id
  } as ActorAction;
}

/**
 * Mint an action for every cantrip on the finished spell list that has one, and LINK it
 * (`spells[].actionId` - the field the sheet resolves a Cast tap through, and the one it groups its
 * "Spell actions" section by; both were written by nothing before this).
 *
 * Mutates the list it is handed because it is already a half-built literal at both call sites
 * (step 9's `spells` and its non-caster twin), and the alternative is two copies of this loop. An id
 * a feature action already took wins and the cantrip keeps today's loose roll - the `spell-`
 * namespace makes that a theoretical collision, not one this content has.
 */
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

/**
 * MARTIAL ARTS: THE UNARMED STRIKE THIS CHARACTER ACTUALLY SWINGS, or null for a class that prints no
 * Martial Arts column.
 *
 * A built Monk had no unarmed strike of its own. The only one anywhere was the generic builtin, whose
 * numbers are hard-coded to Strength + Proficiency Bonus to hit and 1 + Strength Bludgeoning
 * (`action-resolution.ts`) - so a Monk 5 with DEX 15 and STR 12 swung at +3 for 2 damage while the
 * printed Martial Arts column said 1d8 and the class's own text says to use Dexterity. It was not in
 * `weaponActionIds` either, so Extra Attack could not reach it, and Flurry of Blows spent a Focus
 * Point to grant "two Unarmed Strikes" that existed as nothing the engine could roll.
 *
 * READ FROM THE PRINTED COLUMN, not restated beside it. `classResources` already carries
 * `{id: "martial-arts", amount: "1d6"}` at the character's own level (1d8 at 5, 1d10 at 11, 1d12 at
 * 17), which is exactly the table a `damageByLevel` list authored in the content overlay would be
 * copying - and copying a printed table is how the two get to disagree. This also means the rule is
 * CONTENT-DRIVEN rather than a hard-coded "if monk": a homebrew class that prints the column gets it.
 *
 * DEXTERITY OR STRENGTH, whichever is better - "Dexterous Attacks", stated as the SRD states it. The
 * feature vocabulary's `attack.ability` names ONE ability and has no "better of" form, which is the
 * second reason this is minted here rather than authored: the builder holds the finished scores.
 *
 * A NON-DICE amount is skipped rather than trusted. The column is authored text; a homebrew class
 * printing "1d6 or 1d8" must not make every character of that class unbuildable at the schema
 * (ADR-0008 fail-open) - it simply keeps the generic builtin.
 *
 * WHAT IS STILL PROSE, and it is the OTHER half of the same feature: Martial Arts also gives the die
 * and Dexterity to MONK WEAPONS, and those are derived from live inventory in `deriveEquipment`,
 * which holds no class table and so cannot know the die. Flurry's two strikes as a Bonus Action are
 * prose for a different reason - `multiattack` opens its component pool only for an `activation:
 * "action"` (`evaluateActionEconomy`), so a bonus-action parent would track nothing. Both are in
 * `docs/ai-ledger/known-bugs.md`.
 */
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

/** Interpret ONE feature's riders into the running build. Prose (name + description) ALWAYS lands as a trait; riders only add mechanics on top. */
function interpretFeature(feature: FeatureRecord, into: InterpretedFeatures, context: BuildContext): void {
  into.traits.push({ name: feature.name, description: feature.description });
  for (const action of feature.actions) {
    const interpreted = interpretAction(feature, action, context);
    if (!into.actions.some((existing) => existing.id === interpreted.id)) into.actions.push(interpreted);
  }
  // A feature with NO action of its own but with a rider that needs a trigger gets a synthesized
  // activation, so the sheet can actually use it. Two riders qualify:
  //   - an effect grant (EffectGrant IS modeled vocabulary; a rider with no trigger would be inert);
  //   - LIMITED USES. `interpretAction` was the only consumer of `feature.uses`, so every authored
  //     feature that prints a use count but no action (Action Surge, Indomitable, Arcane Recovery,
  //     Divine Intervention, Relentless Endurance, Overchannel, the six tiefling legacy tiers, ...)
  //     landed as prose with no trackable pool at all. A pool that recharges on a rest is exactly
  //     the mechanic the rest/encounter code already resets by action id, so it belongs here.
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
  // A GATED grants block is NOT baked, and this is the one place that decides it.
  //
  // Baking means writing the ids into the definition, where nothing ever re-reads the condition -
  // so a block gated on "while you are wearing armour" would become "always", which is the exact
  // over-grant `FeatureGrantsSchema.when` exists to end. The gate reads live actor state and this
  // build has no actor: no inventory, no conditions, no current hit points. So a gated block is left
  // for `deriveEquipment`'s `characterGatedGrants`, which recomputes it whole on every read and
  // therefore honours the gate on every read.
  //
  // THE TWO HALVES PARTITION TEN OF THE ELEVEN LISTS EXACTLY - ungated here, gated there, so none of
  // those ten is granted twice or dropped. `spells` is the ELEVENTH and it is NOT part of that
  // partition: `takeGrants` has no spell channel to hand one to, because the line below bakes a
  // granted spell into `spellcasting` (the row, the prepared cap, a cantrip's action, and for a
  // character with no class list the whole caster block) rather than recomputing it. A GATED block
  // naming spells used to lose them here without a word - gating `high-elf-cantrip` deleted
  // `spellcasting` outright. It is now refused at authoring instead (`grantedSpellGateMessage`),
  // which is what lets this branch push all eleven lists and still be complete: no block that
  // reaches it can carry both a `when` and a spell.
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
      // ALREADY APPLIED, in step 5c, before this loop was allowed to run - and it has to be, because
      // the `interpretAction` call above this switch has already read `context.finalScores` to derive
      // this very feature's save DC. Collecting it here for a later fold is what made a level-20
      // capstone invisible to the DC it raises. Left as an explicit no-op case rather than deleted:
      // the switch is the partition's own record of who owns each of the eight baked variants.
      case "ability-score": break;
      case "hit-points-per-level": into.hitPointsPerLevel += modifier.amount; break;
      case "speed": into.speedBonus += modifier.amount; break;
      // The Defense fighting style is "+1 AC WHILE you're wearing armor", so an `armor-class` rider
      // that sets `whileArmored` is held back for step 11, which is the only place that knows the
      // final loadout. An unconditional rider (a ring of protection) applies either way.
      case "armor-class":
        if (modifier.whileArmored) into.armorClassBonusWhileArmored += modifier.amount;
        else into.armorClassBonus += modifier.amount;
        break;
      case "initiative": into.initiativeBonus += modifier.amount; break;
      case "unarmored-defense": into.unarmoredDefense = { ability: modifier.ability, allowShield: modifier.allowShield }; break;
      case "darkvision": break; // display-only: the trait prose carries the senses; no definition field models them
      // The other THIRTEEN. Not folded here on purpose - see `CARRIER_RIDER_DISPOSITION`. A feat
      // reaches them through `deriveEquipment`'s feat carriers and the shared `collectRiders`; a
      // class/species/background feature does NOT yet (see the note at the head of step 6).
      default: ownedByTheRollTimeCollector(modifier); break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Validation helpers.
// ---------------------------------------------------------------------------------------------

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
  // "roll" and "custom": the server cannot verify dice it did not throw (manual physical dice are a
  // supported path), so it bound-checks every score against what the formula can produce.
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

/**
 * The `{kind, sourceId, id}` triples for every granted feature that has an origin, deduped and in
 * grant order. Issue `2e`: this array IS the sheet's claim on its feature records, and without it
 * `characterFeatureCarriers` reads `features ?? []` and finds nothing to build a carrier from - the
 * shape of the bug this closes, where a class feature's roll-time riders were authored, validated,
 * and then silently dropped.
 *
 * BOUNDED at the schema's 80, and the truncation is deliberate rather than a `reject`: the array is
 * an additive mechanical enrichment, so a hypothetical 81-feature homebrew class must lose the 81st
 * feature's riders rather than lose the ability to build the character at all. Nothing in the SRD
 * comes close - the fattest bundled level-20 sheet is well under half of it - so this is a guard, not
 * a live limit, and `features-cap` in `feature-riders.test.ts` pins the real headroom.
 */
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

/**
 * The feature records the class's level rows 1..level grant (with grant counts AND the levels those
 * grants landed at), plus the row for `level` itself.
 *
 * `levels` exists so a recorded choice row can name the level it was really made at. The wizard
 * splits a feature granted four times into four offers, one per grant level (`feature:<id>@<level>`
 * for an ASI), and `level-ledger.ts` reads a stored row back by matching `(level, kind, classId,
 * featureId)` - so a ledger that put every ASI at level 1 would be un-prefillable in the level-up
 * flow. This side keeps ONE offer of capacity choose x count and hands the levels along with it.
 */
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

// ---------------------------------------------------------------------------------------------
// The build.
// ---------------------------------------------------------------------------------------------

/**
 * `library` is an audience-scoped view, never the whole `ContentLibrary`: every `*Record(...)`
 * lookup below then reads the CALLER's catalog automatically, so a player can never build against -
 * or even successfully name - a homebrew record the GM has not made player-visible.
 */
/**
 * The rolled hit-point entries as ledger rows: one per level from 2 up. Level N's roll is the entry
 * at index N-2, which is the same alignment `buildCharacterDefinition` validates against
 * ("exactly level - 1 entries, levels 2..level"). Any row the input already carries is dropped
 * first, so a rebuild that echoes its own prefill never doubles them.
 */
export function hitPointRollRows(input: Pick<CharacterCreateRequestInput, "hp" | "choices">): CharacterChoice[] {
  if (input.hp.mode !== "entries") return [];
  return (input.hp.entries ?? []).map((roll, index) => ({ level: index + 2, kind: "hp-roll", id: "hp", payload: { roll } }));
}

/**
 * Rolled hit points recovered FROM a stored ledger, for a rebuild at `level`.
 *
 * Returns `null` when any level in 2..level has no recorded roll - a character built before this
 * was recorded, or a PDF import with no ledger at all. The caller then rebuilds on the AVERAGE,
 * which is the honest answer: the product floor is max(roll, average), so an old rolled character
 * can lose maximum hit points on its first rebuild, and no dice are ever invented to hide that.
 */
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

/**
 * EVERYTHING STEPS 1-4 SETTLED - the offers this build really has, with the ledger rows already
 * matched against them, plus the records and budgets steps 5-12 read.
 *
 * This is the surface the RANDOM GENERATOR answers (issue `2d`). It exists so the generator picks
 * from the same offers `buildCharacterDefinition` will validate its picks against: a divergence
 * between what the generator may choose and what the validator will accept is the same bug class as
 * `computeOffers` vs this module, and the plan's rule is that such a divergence is always the bug.
 * Reuse, never fork - there is exactly one function that knows what a build is asking for.
 */
export type ServerOfferSurvey = Readonly<{
  offers: readonly ChoiceOffer[];
  classRecord: ClassReference;
  species: SpeciesReference;
  background: BackgroundReference;
  subclass: SubclassReference | null;
  lineage: SpeciesReference["lineages"][number] | null;
  originFeat: FeatReference | null;
  levelRow: ClassLevelRow;
  /** Every feature this build holds so far, with its provenance (the origin feat and chosen feats carry `origin: null`). */
  granted: ReadonlyArray<{ record: FeatureRecord; count: number; origin: CharacterFeatureOrigin | null }>;
  chosenFeats: readonly FeatReference[];
  /** Every feat id already held - the cross-offer duplicate guard a generator must respect too. */
  heldFeatIds: ReadonlySet<string>;
  extraPickBudgets: ReadonlyMap<string, number>;
  preparedSpellRows: readonly CharacterChoice[];
  classCantripRows: readonly CharacterChoice[];
  /** The printed level-row columns, BEFORE `extraPickBudgets` composes on top (step 9 does that sum). */
  printedCantrips: number;
  printedPrepared: number;
  catalogs: CatalogChoiceCatalogs;
  progression: ClassProgressionTable;
  /** Ability scores after the background spread and species bonuses, BEFORE any ASI or feature rider. */
  scoresBeforeIncreases: Record<Ability, number>;
  proficiencyBonus: number;
}>;

const CLASS_CANTRIP_BUDGET: NamedPickBudget = "class-cantrips";
const CLASS_SPELL_BUDGET: NamedPickBudget = "class-spells";

/**
 * The offers a build has, WITHOUT requiring the ledger to have answered them yet.
 *
 * Identical code to the first four steps of `buildCharacterDefinition` because it IS those steps:
 * `surveyBuild(..., "offers")` runs them and stops, and `buildCharacterDefinition` runs them and
 * carries on. The two rejections a partial ledger would otherwise trip - "your species asks for a
 * lineage" and "this offer needs N picks" - are completeness checks the caller owns rather than
 * conditions the offers depend on, so they are the caller's to make.
 */
export function computeServerOffers(input: CharacterCreateRequestInput, library: ContentView, policy: BuilderPolicy): ServerOfferSurvey {
  return surveyBuild(input, library, policy, "offers");
}

function surveyBuild(input: CharacterCreateRequestInput, library: ContentView, policy: BuilderPolicy, mode: "build" | "offers"): ServerOfferSurvey {
  const catalogs = library.catalogChoiceCatalogs();
  const progression: ClassProgressionTable = library.classProgressionTable();

  // ---- 1. Identity ids resolve against the catalogs (unknown ids reject loudly). ----
  // NO multiclass prerequisite check here, deliberately. `CharacterCreateRequestInput` carries ONE
  // `classId` and ONE `level`: a Phase-2 character is single-class by construction, and the SRD
  // attaches ability minimums to TAKING A SECOND CLASS, never to a starting class - enforcing them
  // on creation would reject legal level-1 characters. `meetsMulticlassPrerequisites`
  // (`@vtt/rules-5e` class-data.ts) and the wire's `multiclassPrerequisites` are therefore correct
  // but uncalled until the second class entry exists (packet phase 6, level-up). The intent is
  // pinned by a test in `apps/server/test/character-build.test.ts` so the gap stays a documented
  // sequencing fact rather than a forgotten check.
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

  // Rules-derived, not the printed column: proficiency bonus tracks TOTAL character level (the
  // multiclass rule), which equals the class level here; a homebrew row that disagrees is display-only.
  const proficiencyBonus = proficiencyBonusForLevel(input.level);
  const { features: classFeatures, row: levelRow } = grantedClassFeatures(classRecord, input.level);

  // ---- 3. Collect every granted feature (class rows, subclass, species + lineage, background, origin feat). ----
  const chosenLineageId = input.choices.find((row) => row.kind === "lineage")?.id ?? null;
  const lineage = chosenLineageId
    ? species.lineages.find((candidate) => candidate.id === chosenLineageId) ?? reject(`"${species.name}" has no lineage "${chosenLineageId}".`)
    : null;
  // In "offers" mode the lineage is simply not chosen YET - the species trait's own `lineage` offer
  // is in the list below, unanswered, and answering it is what the caller is here to do.
  if (mode === "build" && !chosenLineageId && species.traits.some((trait) => trait.choice?.kind === "lineage")) reject(`${species.name} asks for a lineage choice.`);
  const subclassFeatures = (subclass?.features ?? []).filter((feature) => (feature.level ?? subclass?.subclassLevel ?? classRecord.subclassLevel) <= input.level);
  const originFeat: FeatReference | null = background.originFeatId
    ? library.featRecord(background.originFeatId) ?? reject(`${background.name} grants unknown feat "${background.originFeatId}".`)
    : null;
  // Every feat this character already holds, granted or chosen - the cross-offer duplicate guard in pass A.
  const heldFeatIds = new Set<string>(originFeat ? [originFeat.id] : []);
  /**
   * Every granted feature, WITH ITS PROVENANCE (issue `2e`).
   *
   * `origin` is not decoration: it becomes `definition.character.features`, which is the only way a
   * class/subclass/species/lineage/background feature's 13 ROLL-TIME riders can reach the table.
   * `interpretFeature` below folds the other 8 at build time; the rest are read back through
   * `deriveEquipment`'s `characterFeatureCarriers`, exactly as a feat's are read through
   * `character.feats`. A bare id would not do - `unarmored-defense` is a Barbarian feature AND a
   * Monk feature with different mechanics - so the pair `{kind, sourceId}` travels with each id.
   *
   * `origin: null` means "recorded elsewhere": the origin feat and every chosen feat are already on
   * `character.feats`, and recording them a second time here would double every rider they carry.
   */
  /** Where a granted feature's own picks sit in the wizard's `(level, classId)` grid - see `ChoiceOffer.levels`. */
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

  // ---- 4. Build the choice offers and match every ledger row against them (two passes). ----
  // Pass A settles which FEATS were taken (feat / fighting-style / asi-or-feat rows), because a
  // chosen feat's feature can itself ask for picks (the ASI feat's ability-score rows, Magic
  // Initiate's cantrips, Skilled's skills) - those second-order offers must exist before pass B
  // matches the remaining rows.
  const offers: ChoiceOffer[] = [];
  const listOffer = (key: NamedPickBudget, kind: string, label: string, list: { choose: number; from: readonly string[]; fromCatalog?: string } | undefined, classId: string | null) => {
    if (!list || list.choose <= 0) return;
    // A "choose N" LIST may draw on an open catalog too, exactly as a feature's choice may - the
    // species language budget every character is owed ("Common plus two languages from the Standard
    // Languages table") is nineteen ids nobody should copy onto nine species records. Resolved
    // through the SAME `resolveCatalogChoice` the wizard renders with, and a gap in the catalog half
    // defers the pick with the resolver's own message rather than accepting anything silently.
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
  /**
   * IS THIS OPTION ALREADY IN THE LEDGER - the read `options[].requires` gates on.
   *
   * Scoped the way `matchRow` scopes a row: a `feature:<id>` offer key matches only rows tagged with
   * that feature, so "you chose Divine Strike for Blessed Strikes" cannot be satisfied by an
   * unrelated row that happens to share the option id.
   */
  const ledgerAnswered = (offerKey: string, optionId: string): boolean => {
    const featureId = offerKey.startsWith("feature:") ? offerKey.slice("feature:".length).replace(/\/\d+$/, "") : null;
    return input.choices.some((row) =>
      row.id === optionId
      && (featureId === null || (row.payload && typeof row.payload.featureId === "string" && row.payload.featureId === featureId)));
  };
  /** Options a gate DETERMINED rather than offered; drained into `granted` once every offer is built. */
  const determined: Array<{ option: FeatureOption; parentId: string; where: { levels: readonly number[]; classId: string | null } }> = [];
  /**
   * WHAT A BUDGET ALREADY HOLDS, straight off the ledger - the source `fromPicks` narrows.
   *
   * A `feature:<id>` key means the rows tagged with that feature. A NAMED budget is spelled in the
   * ledger only as an untagged row of its kind, which is exactly how pass B fills the class cantrip
   * and prepared-spell budgets; the two skill budgets are indistinguishable there and always have
   * been (both land in one proficiency list), so a `fromPicks` over `class-skills` reads the
   * background's too. Every SRD use is `class-cantrips`, where there is no such ambiguity.
   */
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
    // EVERY pick the record owes, not just the first. A record may promise two (Magic Initiate's two
    // cantrips AND its level-1 spell), and each becomes its own offer with its own kind, capacity and
    // spell-level ceiling. The FIRST keeps the plain `feature:<id>` key so every existing ledger row,
    // `extraPicks` target and alias resolves exactly as before; later picks take `/2`, `/3`, ... .
    featurePicks(record).forEach((choice, index) => featurePickOffer(record, choice, index, count, featureAliases, where));
  };
  const featurePickOffer = (
    record: FeatureRecord, choice: NonNullable<FeatureRecord["choice"]>, index: number, count: number, featureAliases: readonly string[], where: OfferStep
  ): void => {
    if (choice.choose * count === 0) return;
    let options: ReadonlySet<string>;
    let optionLevels: ReadonlyMap<string, number> | null = null;
    let unresolvable: string | null = null;
    // Inline `options` carry their own mechanics; the content schema derives `from` from their ids,
    // so the id list below is identical either way and only the RIDERS need the extra reference.
    // A CATALOG **PLUS** ONE BESPOKE OPTION: `from` (which `options` derives) used to short-circuit,
    // so "a Fighting Style feat OR Blessed Warrior" could not be said and both variants were
    // unpickable. When both are authored the offer is their UNION, matching the wizard exactly.
    const named = choice.from ?? [];
    // THE OPTIONS ARE THE CHARACTER'S OWN EARLIER ANSWERS. "Choose one of your known Warlock
    // cantrips that deals damage" - a list no catalog holds, read straight off the ledger and
    // narrowed by a closed predicate. Resolved from `input.choices`, which is the whole ledger and
    // is available before any pass runs, so this needs no fourth pass and no ordering rule.
    if (choice.fromPicks) {
      try {
        const resolved = resolvePickChoice(choice.fromPicks, answersFor(choice.fromPicks.offer), catalogs);
        options = new Set(resolved.map((option) => option.id));
        if (resolved.some((option) => option.level !== undefined)) optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Nothing eligible chosen yet: DEFER, exactly as an unresolvable catalog does. A row that
        // targets it is still refused, with this reason - never a silent accept.
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
      // A schema-legal but unusable record: `{kind, choose, from: []}` passes the content schema's
      // "needs from OR fromCatalog" refinement (an empty array is truthy), then asks the resolver to
      // resolve `undefined`. That used to be a raw TypeError - not a CatalogChoiceError, not a
      // CommandRejectedError - so the socket handler echoed an internal message to the client.
      // Reject it as content, loudly and actionably, the way every other bad record rejects.
      reject(`"${record.name}" offers a "${choice.kind}" choice with no options - its content record needs a non-empty "from" list or a "fromCatalog" slug.`);
    } else {
      try {
        const resolved = resolveCatalogChoice(choice.fromCatalog!, catalogs);
        options = new Set(resolved.map((option) => option.id));
        if (resolved.some((option) => option.level !== undefined)) optionLevels = new Map(resolved.map((option) => [option.id, option.level ?? 0]));
      } catch (error) {
        if (!(error instanceof CatalogChoiceError)) throw error;
        // Partial-content gap: the pick is deferred, not required - but any row that targets it
        // still fails with the resolver's own loud message (never a silent accept).
        options = new Set();
        unresolvable = error.message;
      }
    }
    /**
     * AN OPTION GATED ON AN EARLIER ANSWER, and the pick that therefore is not a pick.
     *
     * "The option you chose for Blessed Strikes grows more powerful" - the later feature's options
     * are each legal only for one earlier answer, so the ledger already decides which applies. Two
     * things follow, and only the second is new:
     *
     *   1. an option whose gate is unmet leaves the offer entirely (it was never offerable);
     *   2. when the survivors exactly FILL the capacity, the answer is a consequence rather than a
     *      choice - so it is ADOPTED here and no offer is pushed at all. Rendering a card with one
     *      option on it is worse than the prose this replaces, which is precisely why the ruling was
     *      specified and not built.
     *
     * The gate reads `input.choices` directly, which is the whole ledger and is available before any
     * pass runs - so gating needs no new ordering constraint. Only choices that actually carry a gate
     * take this path, so no existing record's behaviour changes.
     */
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

  /**
   * ADOPT the options an earlier answer DETERMINED - the second half of the gating rule above.
   *
   * Drained as a queue rather than a loop over a fixed list, because an adopted option is itself a
   * feature and may in turn determine another. Each one joins `granted`, so its riders, its printed
   * text and any budget it raises land exactly as a CHOSEN option's do - one code path, not two.
   */
  while (determined.length > 0) {
    const { option, parentId, where } = determined.shift()!;
    const asFeature = optionAsFeature(option);
    granted.push({ record: asFeature, count: 1, origin: { kind: "option", sourceId: parentId } });
    featureOffer(asFeature, 1, [parentId], where);
  }

  /**
   * EXTRA PICKS - a feature (or a chosen option) that raises a budget instead of granting an outcome.
   *
   * "You know one extra cantrip from the Cleric spell list" promises a pick the player still gets to
   * MAKE. Nothing in the vocabulary could say that: `grants` names an outcome, and a second `choice`
   * cannot be scoped ("your class's skill list" is not a catalog slug), so the printed level row was
   * the only capacity there was and every such promise was unreachable.
   *
   * COMPOSITION IS ADDITION, over the printed row AND over every grant naming the same budget - two
   * features each granting +1 yield +2, because nothing here overwrites. `count` multiplies for the
   * same reason a repeated feature's `choose` does: a feature granted at four levels grants four times.
   *
   * FOLDED IN AS EACH SOURCE IS SETTLED, not once at the end, because a raised offer has to be raised
   * BEFORE rows are matched against it - `matchRow` refuses the pick that exceeds `capacity`. Granted
   * features are folded here, chosen feats after pass A, chosen options after pass A2; each of those
   * is the earliest point at which that source is known.
   */
  const extraPickBudgets = new Map<string, number>();
  const grantExtraPicks = (record: FeatureRecord, count: number): void => {
    for (const grant of record.extraPicks) {
      // `extraPickAmount` is the SHARED resolver - the same function the wizard calls, so a budget
      // that follows the printed column (Eldritch Invocations 1 -> 10, Weapon Mastery 3 -> 6) cannot
      // be computed two ways. A flat grant is `grant.amount`; a scaled one reads `classRecord`'s own
      // level table at this character's level.
      const amount = extraPickAmount(grant, classRecord.levelTable, input.level) * count;
      extraPickBudgets.set(grant.offer, (extraPickBudgets.get(grant.offer) ?? 0) + amount);
      // The two class budgets (`class-cantrips`, `class-spells`) are not offers - they are the level
      // row's own columns, read at step 9 - so a key that matches no offer here is not yet an error.
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
    // OUT OF THE SPELL-LEVEL WINDOW, and no sibling offer would take it either: say which bound and by
    // how much. The floor is what makes Mystic Arcanum exact ("a level 6 Warlock spell"); before it,
    // an eleventh-level Warlock could spend the level-6 arcanum on Eldritch Blast.
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

  /**
   * WHERE THE ROW `matchRow` JUST TOOK ACTUALLY SITS - ONE grant, not the offer's whole list.
   *
   * A feature granted at 4/8/12/16 is ONE offer here with `levels: [4, 8, 12, 16]`, and handing that
   * whole array to a second-order offer said "this pick belongs to all four levels at once".
   * `levelOfPick` then resolves index 0 of it, so a Grappler taken at the level-8 ASI wrote its
   * ability-score row at level 4 - and `level-ledger.ts`, which matches on `(level, kind, classId,
   * featureId)`, never prefilled it. The wizard has no such problem: it mints one offer PER ASI level.
   *
   * `matchRow` has already pushed this row, so its index in the offer is `taken.length - 1` - the
   * same index `rowFor` stamps the row itself with. Both writers emit their rows in grant order
   * (the generator answers the offer's outstanding picks in index order; `buildChoiceRows` walks the
   * wizard's per-level offers in level order), so index and level agree by construction.
   */
  const stepOfPick = (offer: ChoiceOffer): OfferStep =>
    ({ levels: [levelOfPick(offer, Math.max(0, offer.taken.length - 1))], classId: offer.classId });

  // Pass A: feat selections. "asi" is the built-in shorthand (payload.increases) that stays legal
  // even while the catalog's own Ability Score Improvement feat is the richer path.
  const FEAT_KINDS = new Set(["feat", "fighting-style", "asi-or-feat"]);
  const chosenFeats: FeatReference[] = [];
  /** Where each chosen feat was taken - a feat's OWN picks belong to the level/class of the offer that took it. */
  const chosenFeatSteps: OfferStep[] = [];
  /** Inline options answered to a FEAT-kinded pick (Blessed Warrior, Druidic Warrior). */
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
    // A CATALOG PLUS ONE BESPOKE OPTION: the answer to a feat-kinded pick may be an INLINE option
    // rather than a feat (Paladin's Blessed Warrior sits beside the whole Fighting Style catalog).
    // It is interpreted exactly as pass A2 interprets any chosen option - same code path, same
    // reshape - because "a chosen option IS a feature" does not stop being true here.
    const inlineOption = matched.optionRecords?.find((candidate) => candidate.id === row.id);
    if (inlineOption) {
      const asFeature = optionAsFeature(inlineOption);
      granted.push({ record: asFeature, count: 1, origin: matched.featureId ? { kind: "option", sourceId: matched.featureId } : null });
      featureOffer(asFeature, 1, matched.featureId ? [matched.featureId] : [], stepOfPick(matched));
      chosenInlineStyles.push(asFeature);
      continue;
    }
    const feat = library.featRecord(row.id) ?? reject(`No feat "${row.id}" is in the content catalog.`);
    // The SAME feat may not be taken twice across DIFFERENT offers. `repeatable:false` on a choice
    // only ever guarded within one offer, so a Human Acolyte could spend Versatile on the feat the
    // background already grants (interpreting Magic Initiate twice - 7 cantrips instead of 5) and a
    // Champion could take "defense" from both of its fighting-style offers. The held set includes
    // the background's origin feat, which is granted rather than chosen.
    if (heldFeatIds.has(feat.id)) {
      if (!feat.repeatable) reject(`${feat.name} is already on this character - a feat can only be taken once unless it says it is repeatable.`);
      if (repeatsOnlyWithADifferentSpellList(feat)) reject(`${feat.name} may be taken again only with a DIFFERENT spell list - choose another one.`);
    }
    heldFeatIds.add(feat.id);
    chosenFeats.push(feat);
    chosenFeatSteps.push(stepOfPick(matched));
  }
  // The chosen feats' features join the granted set: their own choices become offers for pass B,
  // and their riders/prose interpret exactly like any class or species feature.
  for (const [index, feat] of chosenFeats.entries()) {
    granted.push({ record: feat.feature, count: 1, origin: null }); // recorded on `character.feats`
    featureOffer(feat.feature, 1, [], chosenFeatSteps[index]);
  }
  for (const feat of chosenFeats) grantExtraPicks(feat.feature, 1);
  for (const record of chosenInlineStyles) grantExtraPicks(record, 1);

  // Pass A2: picks whose OPTIONS carry their own mechanics - Divine Order's two sacred roles, Giant
  // Ancestry's six boons, Blessed Strikes' two forms. Settled here, before pass B, for exactly the
  // reason feats are: a chosen option can itself ask for a pick (Thaumaturge's extra Cleric cantrip),
  // and that second-order offer has to exist before pass B matches the remaining rows. Without this,
  // a chosen option was validated and written to the ledger and then thrown away - the Protector
  // Cleric got no martial weapons or heavy armour, the Goliath's chosen boon no action.
  const optionKinds = new Set(offers.filter((offer) => offer.optionRecords !== null).map((offer) => offer.kind));
  const chosenOptionFeatures: FeatureRecord[] = [];
  for (const row of input.choices) {
    if (!optionKinds.has(row.kind) || FEAT_KINDS.has(row.kind)) continue;
    const offer = matchRow(row, offers.filter((candidate) => candidate.kind === row.kind));
    const option = offer.optionRecords?.find((candidate) => candidate.id === row.id);
    if (!option) continue; // a bare id in a mixed-kind offer: provenance only, nothing to interpret
    const asFeature = optionAsFeature(option);
    // An option's riders ride the bearer exactly as its parent feature's do, so it is recorded too -
    // keyed under the PARENT feature's id, which is where the catalog indexes it.
    granted.push({ record: asFeature, count: 1, origin: offer.featureId ? { kind: "option", sourceId: offer.featureId } : null });
    // The option's own pick is keyed on the option id, with the parent feature id as an accepted alias.
    featureOffer(asFeature, 1, offer.featureId ? [offer.featureId] : [], stepOfPick(offer));
    chosenOptionFeatures.push(asFeature);
  }
  // Folded AFTER the loop, not inside it, so one option raising another option's pick does not depend
  // on the order the ledger happens to list them in.
  for (const record of chosenOptionFeatures) grantExtraPicks(record, 1);

  /**
   * A BUDGET KEY THAT NAMES NOTHING IS AN AUTHORING ERROR, and it fails loudly here.
   *
   * This is the whole reason the vocabulary exists: a rider that parses, validates, is written to the
   * ledger and then adds zero is indistinguishable from working, and 226 records authored on top of
   * one would each look correct in review. Every key is checked against the offers this build really
   * has plus the two printed class columns - reality, not a second hand-maintained list of legal keys
   * that would drift away from the offers it claims to describe.
   */
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
  /**
   * A `replaces` CLAUSE NAMING NOTHING IS THE SAME AUTHORING ERROR, and fails the same way.
   *
   * "You can replace one of these" is worth nothing if the thing it replaces is not a pick this
   * build has - the clause would parse, ship, and let a player re-choose a budget that does not
   * exist. One offer-key namespace means one check, so this reuses the test `extraPicks` uses rather
   * than growing a second list of legal keys beside it.
   */
  for (const { record } of granted) {
    for (const clause of record.replaces) {
      if (namesARealBudget(clause.offer)) continue;
      reject(`"${record.name}" says a pick to "${clause.offer}" may be replaced, which is not a pick this build has. Name one of ${NAMED_PICK_BUDGETS.map((budget) => `"${budget}"`).join(", ")}, or a feature's own pick ("feature:<featureId>").`);
    }
  }

  // Pass B: everything else. Rows the offer machinery does not own: the class's own prepared
  // spells / cantrips (level-row budgets, step 9), equipment options (step 10), an optional size
  // pick (step 11), and the subclass mirror row. A "spell"/"cantrip" row WITH payload.featureId
  // belongs to that feature's offer (Evocation Savant, Magic Initiate); without one it fills the
  // class budgets.
  //
  // `hp-roll` is here for a THIRD reason and it closes a real hole: those rows are the ledger's own
  // record of the dice (D14), written by `hitPointRollRows` from `input.hp.entries` and re-derived
  // from them on every build. They are an OUTPUT, never a pick - and until this line, a caller who
  // echoed a stored ledger back verbatim (which is exactly what "the provenance ledger, VERBATIM -
  // level-up and respec prefill from exactly these rows" invites) was answered with `Nothing in this
  // build offers a "hp-roll" choice.` The wizard never hit it because `buildChoiceRows` re-derives
  // its rows from offers and so drops them by accident; nothing else was so lucky. Ignoring them on
  // the way IN is what makes step 12's "filter them out and re-add" honest.
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

  // EVERY OFFER ANSWERED - the completeness check. It closes step 4 rather than opening step 5, and
  // it lives here rather than in the survey because a survey of a HALF-ANSWERED build is exactly
  // what the generator asks for: "what is still unpicked" is its loop condition, not an error.
  for (const offer of offers) {
    if (offer.kind === "subclass" || offer.unresolvable !== null) continue; // payload-mirrored / content-gap-deferred
    if (offer.taken.length !== offer.capacity) {
      reject(`"${offer.label}" needs ${offer.capacity} pick(s) of kind "${offer.kind}"; got ${offer.taken.length}.`);
    }
  }

  // ---- 5. Ability increases: the "asi" shorthand's payload, then chosen ability-score picks (+1 each, cap 20). ----
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
  // A consumed "ability-score" pick (the ASI feat's choose-2, a boon's choose-1) is +1 to that
  // ability - the choice vocabulary carries no amount, so one point per pick is the only reading that
  // fits every printed use.
  //
  // THE CEILING IS THE OFFER'S, not a constant. This clamp was `Math.min(20, ...)`, which made all
  // seven epic-boon feats do nothing at all: "increase one ability score by 1, to a maximum of 30"
  // is taken at level 19 by a character whose score is already 20, so every point was clamped away
  // silently. The modifier path beside this one has honoured `maximum` all along; the CHOICE path
  // had no field to honour until `FeatureChoiceSchema` grew one.
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

  /**
   * ---- 5c. Feature `ability-score` riders, BEFORE any feature is interpreted. ----
   *
   * ORDER IS THE WHOLE POINT, and getting it wrong was a real wrong number on a real sheet.
   * `interpretAction` derives every attack bonus and save DC from `context.finalScores` AT THE MOMENT
   * `interpretFeature` runs (see the `save.dc.ability` branch). This fold used to happen after that
   * loop, so a capstone that raises the very ability one of the character's own DCs is derived from
   * was invisible to it. Measured, at level 20, on the two features where it bites:
   *
   *   - Barbarian: Primal Champion (+4 STR/CON) -> Intimidating Presence read DC 19; SRD says 21.
   *   - Monk: Body and Mind (+4 DEX/WIS)        -> Stunning Strike read DC 18; SRD says 20.
   *
   * Same `granted` list, same `feature.modifiers`, same `maximum` clamp (the epic boons' 30,
   * everything else's 20) - this is the IDENTICAL fold, moved early enough to be read. Relative order
   * against step 5's ASI and choice-driven increases is unchanged: those still land first.
   */
  for (const { record } of granted) {
    for (const modifier of record.modifiers) {
      if (modifier.type !== "ability-score") continue;
      finalScores[modifier.ability] = Math.min(modifier.maximum ?? 20, finalScores[modifier.ability] + modifier.amount);
    }
  }

  // ---- 6. Interpret every granted feature (class, subclass, species, background, chosen feats). ----
  // This fold owns 8 of the 21 rider variants; the other 13 are roll-time and reach the table as
  // RIDER CARRIERS (see `CARRIER_RIDER_DISPOSITION`). A feat gets there because `character.feats`
  // records its id; a class/subclass/species/lineage/background feature and a chosen inline OPTION
  // get there because `heldFeatures` below records theirs. Both halves are read by the same
  // `collectRiders` a magic item's riders go through - see `deriveEquipment`.
  const casting = subclass?.spellcasting ?? classRecord.spellcasting ?? null;
  const context: BuildContext = { level: input.level, proficiencyBonus, finalScores, spellcastingAbility: casting?.ability ?? null, classResources: levelRow.classResources };
  const interpreted: InterpretedFeatures = {
    actions: [], traits: [], grantedSkills: [], grantedExpertise: [], grantedTools: [], grantedLanguages: [],
    grantedArmor: [], grantedWeapons: [], grantedSaves: [], damageResistances: [], damageImmunities: [],
    conditionImmunities: [], grantedSpells: [], hitPointsPerLevel: 0, speedBonus: 0,
    armorClassBonus: 0, armorClassBonusWhileArmored: 0, initiativeBonus: 0, unarmoredDefense: null
  };
  for (const { record } of granted) interpretFeature(record, interpreted, context);
  // MARTIAL ARTS. Read from the class's own printed column, after the features so an id a feature
  // already declared keeps it (the dedupe every other action here gets).
  const strike = martialArtsStrike(context);
  if (strike && !interpreted.actions.some((existing) => existing.id === strike.id)) interpreted.actions.push(strike);
  /**
   * WHICH FEATURE RECORDS THIS SHEET HOLDS - the payload of `definition.character.features`, and the
   * whole reason `origin` rides along on every `granted` row (issue `2e`).
   *
   * `origin: null` is skipped deliberately: the origin feat and every chosen feat are ALREADY on
   * `character.feats`, whose carriers `deriveEquipment` builds separately. Recording them here too
   * would build a second carrier for the same record and double every rider on it.
   *
   * Deduped on the full `{kind, sourceId, id}` triple, because `granted` may legitimately name one
   * record twice (a level row that grants a feature again for its count, an option reachable from two
   * offers) and a carrier per duplicate would apply its riders twice.
   */
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
    // Product default (decision 9 / phase-2 carry-along): rolling can only help - max(roll, average), stated explicitly.
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

  // ---- 9. Spellcasting: the class's own level row (slots, cantrips, prepared cap) + chosen + granted spells. ----
  // Feature-consumed spell/cantrip picks (Evocation Savant, Magic Initiate) join the list OUTSIDE
  // the class budgets: the budgets govern only the class's own picks (the untagged rows).
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
    // Pact Magic is not a sparse nine-column row: it is N slots that are ALL of one level, and it
    // rises by replacing that level rather than by adding columns (a Warlock 5 has two level-3
    // slots and no level-1 or level-2 slots at all). `pactSlots` therefore REPLACES `spellSlots`
    // rather than merging with it. This branch was unreachable until the Warlock existed - a
    // Warlock built before it silently came out with an empty caster block.
    const slots = levelRow.pactSlots
      ? (levelRow.pactSlots.slots > 0 ? [{ level: levelRow.pactSlots.level, max: levelRow.pactSlots.slots }] : [])
      : (levelRow.spellSlots ?? []).map((count, index) => ({ level: index + 1, max: count })).filter((slot) => slot.max > 0);
    const maxSlotLevel = slots.reduce((highest, slot) => Math.max(highest, slot.level), 0);
    // SRD: a feature-granted ALWAYS-prepared spell (a Life Domain spell, a racial spell) is always
    // ready and "doesn't count against the number of spells you can prepare". Appending the grants
    // LAST and skipping ids already present did the opposite: a domain spell the player also listed
    // stayed `alwaysPrepared: false` AND ate one of their prepared slots. The grant wins, and the
    // matching pick is not charged to the cap.
    const alwaysPreparedGrants = new Set(interpreted.grantedSpells.filter((granted) => granted.alwaysPrepared).map((granted) => granted.id));
    const chargedCantripRows = classCantripRows.filter((row) => !alwaysPreparedGrants.has(row.id));
    const chargedPreparedRows = preparedSpellRows.filter((row) => !alwaysPreparedGrants.has(row.id));
    // THE PRINTED ROW PLUS WHAT WAS GRANTED, never the row alone. Divine Order's Thaumaturge reads
    // "you know one extra cantrip from the Cleric spell list", and a cap read solely off
    // `cantripsKnown` refuses the fourth cantrip the text just promised - the client's
    // `computeOffers` composes the identical sum for the offer it renders, and a divergence between
    // the two is always the bug (the wizard offers 4, this refuses the build at Create).
    const cantripCap = printedCantrips + (extraPickBudgets.get(CLASS_CANTRIP_BUDGET) ?? 0);
    if (chargedCantripRows.length > cantripCap) reject(`${classRecord.name} knows ${cantripCap} cantrips at level ${input.level}; got ${chargedCantripRows.length}.`);
    const preparedCap = printedPrepared + (extraPickBudgets.get(CLASS_SPELL_BUDGET) ?? 0);
    if (chargedPreparedRows.length > preparedCap) reject(`${classRecord.name} ${casting.prepares === "prepared" ? "prepares" : "knows"} ${preparedCap} spells at level ${input.level}; got ${chargedPreparedRows.length}.`);
    const spells: Array<Record<string, unknown>> = [];
    // Every id the ledger claimed, whether or not it produced an entry - so "chosen twice" still
    // rejects for a pair of rows that both defer to the same grant.
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
    // A feature pick that duplicates an always-prepared grant defers to the grant for the same reason
    // a class pick does (below): the grant is the stronger, uncharged form.
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
    // THE CANTRIPS BECOME ACTIONS. Every number on them is this caster's own, derived here and read
    // verbatim by the resolver - the sheet sends an id and nothing else (rule 2).
    linkCantripActions(spells, interpreted.actions, { attackBonus, saveDc }, library);
    // Top-level fields stay populated (the documented resolution order's step 3, and the schema's
    // superRefine demands the combined pool when per-class slots exist); the per-class entry rides along.
    spellcasting = {
      ability: casting.ability, saveDc, attackBonus, slots,
      // `prepared` is the budget the SHEET shows, so it is the composed cap for the same reason the
      // check above is - a sheet reading 6 beside seven legally prepared spells is the same lie.
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
      // A non-caster with granted/feat spells (High Elf cantrip, Magic Initiate): model them so the
      // sheet can cast them. The ability comes from the grant when one names it.
      const ability = interpreted.grantedSpells.find((spell) => spell.ability)?.ability ?? "int";
      const saveDc = spellSaveDc(finalScores[ability], proficiencyBonus);
      const attackBonus = spellAttackBonus(finalScores[ability], proficiencyBonus);
      // A Fighter's Magic Initiate cantrip is a spell this character really casts, so it earns the
      // same action a caster's does - the fallback ability above is its numbers.
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
      // A cataloged item carries its mechanics (weapon/armor blocks -> sheet attacks and derived
      // AC); an item the catalog does not know stays display-only (ADR-0008 fail-open) - the
      // authored option already names it, so the player still receives it.
      const record = library.equipmentRecord(item.id);
      // C9 (2026-08-14 review): this is a PICKLESS minting path, so a template item named in
      // starting equipment routes through the same server-side bind the picker path gets - a
      // single-base template auto-binds here exactly per the ruling, and a multi-base one stays
      // unbound with the sheet's chooser as the designed pick. Without this the row arrived
      // equipped and dead, quietly contradicting the documented auto-bind.
      inventory.push(bindTemplateItem({
        id: item.id, name: record?.name ?? item.name, quantity: item.quantity,
        equipped: record ? record.category === "armor" || record.category === "shield" || record.category === "weapon" : false,
        attuned: false,
        ...(record?.weightLb !== null && record?.weightLb !== undefined ? { weightEach: record.weightLb } : {}),
        ...(record?.description ? { description: record.description.slice(0, 4000) } : {}),
        ...(record ? { category: record.category } : {}),
        // `properties` rides along, `mastery` deliberately does not: properties are read off the
        // INVENTORY row (`weaponPropertiesOf`), while a mastery resolves against the catalog by item
        // id and is gated on the bearer having unlocked THIS weapon, so copying it here would put an
        // unearned behaviour on the sheet. Omit the key entirely when the catalog records none -
        // absent means "not recorded", which is not the same claim as an empty list.
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
  // Only ONE body armor stays equipped (two would fight over derived AC); keep the best base.
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
  // The SAME AC function `instantiate` re-runs on import (risk 3): equipment first, then Unarmored
  // Defense while nothing is worn, then the unarmored 10 + DEX floor; flat riders stack on top.
  const equipmentAc = armorClassFromEquipment(dexModifier, inventory);
  const unarmoredAc = interpreted.unarmoredDefense ? 10 + dexModifier + abilityModifier(finalScores[interpreted.unarmoredDefense.ability]) : null;
  const wearingArmor = inventory.some((item) => item.equipped && item.category === "armor" && item.armor);
  // The flat, NON-equipment part of this character's AC. `instantiate` re-derives AC from the live
  // loadout, so it has to be told about the rider or it silently drops it (task-packet risk 3):
  // it travels in the definition's open extension bag, the same fail-open channel that already
  // carries an import's skills and saves. `armorClassRiderOf` in actor-roster.ts is the reader.
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
    // The prose layer: EVERY feature lands as a trait (riders only ADD mechanics on top), in the
    // extensions block CharacterSheet.tsx already renders for imported sheets.
    extensions: { "open5e.srd-2024": { traits: interpreted.traits, ...(armorClassRider !== 0 ? { armorClassBonus: armorClassRider } : {}) } },
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
      // Ids and provenance ONLY - never the riders themselves, which stay on the catalog record and
      // are recomputed on every read. This is what lets a class/subclass/species/lineage/background
      // feature's 13 roll-time riders reach the table (`2e`); see `dedupeFeatureRefs`.
      features: heldFeatures,
      // The provenance ledger, VERBATIM - level-up and respec prefill from exactly these rows -
      // plus the ROLLED HIT POINTS (D14). The rolls used to be consumed and forgotten, so a
      // level-down/level-up round trip could not restore the character it started from: nothing
      // anywhere remembered what the dice had said. `choices` is an open-slug array, so recording
      // them needs no schema change and every existing reader ignores rows it does not know.
      choices: [...input.choices.filter((row) => row.kind !== "hp-roll"), ...hitPointRollRows(input)]
    },
    proficiencies,
    ...(spellcasting ? { spellcasting } : {}),
    startingInventory: inventory,
    startingCurrency: { cp: 0, sp: 0, ep: 0, gp: goldPieces, pp: 0 }
  });
}

import type { BuilderPolicy } from "@vtt/domain";
import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
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
  BackgroundReference, ClassLevelRow, ClassReference, FeatReference, FeatureRecord, SpeciesReference, SubclassReference
} from "@vtt/content-srd-5.2.1";
import type { ContentLibrary } from "./content-library.js";
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

function reject(message: string): never { throw new CommandRejectedError(message); }
function dedupe(values: readonly string[]): string[] { return [...new Set(values)]; }

// ---------------------------------------------------------------------------------------------
// Choice offers: everything the content ASKED the player to pick, with its legal options.
// ---------------------------------------------------------------------------------------------

/**
 * One pick the content offers. `capacity` is choose x times-granted (the Fighter's ASI feature is
 * granted once per ASI level). `unresolvable` marks a fromCatalog slug that resolved to nothing -
 * a partial-content gap (no fighting-style feats authored yet): the pick is NOT required, but any
 * ledger row that targets it still fails with the resolver's own loud error, never a silent accept.
 */
type ChoiceOffer = {
  key: string;
  featureId: string | null;
  kind: string;
  capacity: number;
  options: ReadonlySet<string>;
  /** Spell level per option id, when the options came from a `*-spells` catalog (drives maxSpellLevel). */
  optionLevels: ReadonlyMap<string, number> | null;
  unresolvable: string | null;
  repeatable: boolean;
  maxSpellLevel: number | null;
  label: string;
  taken: string[];
};

function offerOf(partial: Pick<ChoiceOffer, "key" | "kind" | "capacity" | "options" | "label"> & Partial<ChoiceOffer>): ChoiceOffer {
  return { featureId: null, optionLevels: null, unresolvable: null, maxSpellLevel: null, repeatable: false, taken: [], ...partial };
}

// ---------------------------------------------------------------------------------------------
// Feature-rider interpretation (bounded vocabulary; unmodeled mechanics stay prose - ADR-0008).
// ---------------------------------------------------------------------------------------------

type BuildContext = Readonly<{
  level: number;
  proficiencyBonus: number;
  finalScores: Record<Ability, number>;
  spellcastingAbility: Ability | null;
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
  abilityIncreases: Array<{ ability: Ability; amount: number; maximum: number | undefined }>;
  hitPointsPerLevel: number;
  speedBonus: number;
  armorClassBonus: number;
  initiativeBonus: number;
  extraAttacks: number;
  unarmoredDefense: { ability: Ability; allowShield: boolean } | null;
};

/** Resolve a feature's limited uses to a flat count using the character's own numbers. */
function resolvedUseLimit(uses: NonNullable<FeatureRecord["uses"]>, context: BuildContext): number {
  if (uses.limit !== undefined) return uses.limit;
  const scaling = uses.scaling!;
  if (scaling.type === "proficiency-bonus") return context.proficiencyBonus;
  if (scaling.type === "ability-modifier") return Math.max(scaling.minimum, abilityModifier(context.finalScores[scaling.ability]));
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
    const dc = save.dc === "spellcasting" ? spellSaveDc(context.finalScores[context.spellcastingAbility!], context.proficiencyBonus) : save.dc;
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

/** Interpret ONE feature's riders into the running build. Prose (name + description) ALWAYS lands as a trait; riders only add mechanics on top. */
function interpretFeature(feature: FeatureRecord, into: InterpretedFeatures, context: BuildContext): void {
  into.traits.push({ name: feature.name, description: feature.description });
  for (const action of feature.actions) {
    const interpreted = interpretAction(feature, action, context);
    if (!into.actions.some((existing) => existing.id === interpreted.id)) into.actions.push(interpreted);
  }
  // An effect grant with no action to carry it gets a synthesized activation, so the sheet can
  // actually grant it (EffectGrant IS modeled vocabulary; a rider with no trigger would be inert).
  if (feature.effects.length > 0 && feature.actions.length === 0 && !into.actions.some((existing) => existing.id === feature.id)) {
    into.actions.push({
      id: feature.id, name: feature.name, activation: "other",
      description: feature.description.slice(0, 12000), damage: [], grants: feature.effects[0]
    } as unknown as ActorAction);
  }
  if (feature.grants) {
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
      case "ability-score": into.abilityIncreases.push({ ability: modifier.ability, amount: modifier.amount, maximum: modifier.maximum }); break;
      case "hit-points-per-level": into.hitPointsPerLevel += modifier.amount; break;
      case "speed": into.speedBonus += modifier.amount; break;
      case "armor-class": into.armorClassBonus += modifier.amount; break;
      case "initiative": into.initiativeBonus += modifier.amount; break;
      case "extra-attack": into.extraAttacks += modifier.count; break;
      case "unarmored-defense": into.unarmoredDefense = { ability: modifier.ability, allowShield: modifier.allowShield }; break;
      case "darkvision": break; // display-only: the trait prose carries the senses; no definition field models them
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

/** The feature records the class's level rows 1..level grant (with grant counts), plus the row for `level` itself. */
function grantedClassFeatures(entry: ClassReference, level: number): { features: Map<string, { record: FeatureRecord; count: number }>; row: ClassLevelRow } {
  const byId = new Map(entry.features.map((feature) => [feature.id, feature]));
  const granted = new Map<string, { record: FeatureRecord; count: number }>();
  for (const row of entry.levelTable.filter((candidate) => candidate.level <= level)) {
    for (const featureId of row.features) {
      const existing = granted.get(featureId);
      granted.set(featureId, { record: byId.get(featureId)!, count: (existing?.count ?? 0) + 1 });
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

export function buildCharacterDefinition(input: CharacterCreateRequestInput, library: ContentLibrary, policy: BuilderPolicy): ActorDefinition {
  const catalogs = library.catalogChoiceCatalogs();
  const progression: ClassProgressionTable = library.classProgressionTable();

  // ---- 1. Identity ids resolve against the catalogs (unknown ids reject loudly). ----
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
  if (!chosenLineageId && species.traits.some((trait) => trait.choice?.kind === "lineage")) reject(`${species.name} asks for a lineage choice.`);
  const subclassFeatures = (subclass?.features ?? []).filter((feature) => (feature.level ?? subclass?.subclassLevel ?? classRecord.subclassLevel) <= input.level);
  const originFeat: FeatReference | null = background.originFeatId
    ? library.featRecord(background.originFeatId) ?? reject(`${background.name} grants unknown feat "${background.originFeatId}".`)
    : null;
  const granted: Array<{ record: FeatureRecord; count: number }> = [
    ...classFeatures.values(),
    ...subclassFeatures.map((record) => ({ record, count: 1 })),
    ...species.traits.map((record) => ({ record, count: 1 })),
    ...(lineage?.traits ?? []).map((record) => ({ record, count: 1 })),
    ...background.features.map((record) => ({ record, count: 1 })),
    ...(originFeat ? [{ record: originFeat.feature, count: 1 }] : [])
  ];

  // ---- 4. Build the choice offers and match every ledger row against them (two passes). ----
  // Pass A settles which FEATS were taken (feat / fighting-style / asi-or-feat rows), because a
  // chosen feat's feature can itself ask for picks (the ASI feat's ability-score rows, Magic
  // Initiate's cantrips, Skilled's skills) - those second-order offers must exist before pass B
  // matches the remaining rows.
  const offers: ChoiceOffer[] = [];
  const listOffer = (key: string, kind: string, label: string, list: { choose: number; from: readonly string[] } | undefined) => {
    if (list && list.choose > 0) offers.push(offerOf({ key, kind, capacity: list.choose, options: new Set(list.from), label }));
  };
  listOffer("class-skills", "skill", `${classRecord.name} skills`, classRecord.skillChoices);
  listOffer("class-tools", "tool", `${classRecord.name} tools`, classRecord.toolChoices);
  listOffer("background-skills", "skill", `${background.name} skills`, background.skillChoices);
  listOffer("background-tools", "tool", `${background.name} tools`, background.toolChoices);
  listOffer("background-languages", "language", `${background.name} languages`, background.languageChoices);
  listOffer("species-languages", "language", `${species.name} languages`, species.languageChoices);
  const featureOffer = (record: FeatureRecord, count: number): void => {
    const choice = record.choice;
    if (!choice || choice.choose * count === 0) return;
    let options: ReadonlySet<string>;
    let optionLevels: ReadonlyMap<string, number> | null = null;
    let unresolvable: string | null = null;
    if (choice.from && choice.from.length > 0) options = new Set(choice.from);
    else {
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
    offers.push(offerOf({
      key: `feature:${record.id}`, featureId: record.id, kind: choice.kind, capacity: choice.choose * count,
      options, optionLevels, unresolvable, repeatable: choice.repeatable, maxSpellLevel: choice.maxSpellLevel ?? null, label: record.name
    }));
  };
  for (const { record, count } of granted) featureOffer(record, count);

  const featureTagOf = (row: CharacterChoice): string | null =>
    row.payload && typeof row.payload.featureId === "string" ? row.payload.featureId : null;
  const matchRow = (row: CharacterChoice, candidates: readonly ChoiceOffer[]): void => {
    const featureTag = featureTagOf(row);
    const scoped = featureTag ? candidates.filter((offer) => offer.featureId === featureTag) : candidates;
    if (scoped.length === 0) reject(featureTag ? `No feature "${featureTag}" offers a "${row.kind}" choice.` : `Nothing in this build offers a "${row.kind}" choice.`);
    const gap = scoped.find((offer) => offer.unresolvable !== null);
    if (gap && !scoped.some((offer) => offer.options.has(row.id))) reject(`This build needs "${gap.label}" resolved, but ${gap.unresolvable}`);
    const overLevel = scoped.find((offer) => offer.options.has(row.id) && offer.maxSpellLevel !== null && (offer.optionLevels?.get(row.id) ?? 0) > offer.maxSpellLevel);
    if (overLevel && !scoped.some((offer) => offer.options.has(row.id) && (offer.maxSpellLevel === null || (offer.optionLevels?.get(row.id) ?? 0) <= offer.maxSpellLevel))) {
      reject(`"${row.id}" is level ${overLevel.optionLevels?.get(row.id)}, above the maximum spell level (${overLevel.maxSpellLevel}) for "${overLevel.label}".`);
    }
    const offer = scoped.find((candidate) =>
      candidate.options.has(row.id)
      && (candidate.maxSpellLevel === null || (candidate.optionLevels?.get(row.id) ?? 0) <= candidate.maxSpellLevel)
      && candidate.taken.length < candidate.capacity
      && (candidate.repeatable || !candidate.taken.includes(row.id)));
    if (!offer) {
      const anyHolds = scoped.some((candidate) => candidate.options.has(row.id));
      reject(anyHolds
        ? `The "${row.kind}" pick "${row.id}" exceeds what this build may choose (${scoped.map((candidate) => `${candidate.label}: ${candidate.capacity}`).join(", ")}).`
        : `"${row.id}" is not an offered option for the "${row.kind}" choice (${scoped.map((candidate) => candidate.label).join(", ")}).`);
    }
    offer.taken.push(row.id);
  };

  // Pass A: feat selections. "asi" is the built-in shorthand (payload.increases) that stays legal
  // even while the catalog's own Ability Score Improvement feat is the richer path.
  const FEAT_KINDS = new Set(["feat", "fighting-style", "asi-or-feat"]);
  const chosenFeats: FeatReference[] = [];
  for (const row of input.choices) {
    if (!FEAT_KINDS.has(row.kind)) continue;
    if (row.kind === "asi-or-feat" && row.id === "asi") {
      const offer = offers.find((candidate) => candidate.kind === "asi-or-feat" && candidate.taken.length < candidate.capacity)
        ?? reject(`No Ability Score Improvement is available to spend at level ${row.level}.`);
      offer.taken.push(row.id);
      continue;
    }
    matchRow(row, offers.filter((offer) => offer.kind === row.kind));
    chosenFeats.push(library.featRecord(row.id) ?? reject(`No feat "${row.id}" is in the content catalog.`));
  }
  // The chosen feats' features join the granted set: their own choices become offers for pass B,
  // and their riders/prose interpret exactly like any class or species feature.
  for (const feat of chosenFeats) {
    granted.push({ record: feat.feature, count: 1 });
    featureOffer(feat.feature, 1);
  }

  // Pass B: everything else. Rows the offer machinery does not own: the class's own prepared
  // spells / cantrips (level-row budgets, step 9), equipment options (step 10), an optional size
  // pick (step 11), and the subclass mirror row. A "spell"/"cantrip" row WITH payload.featureId
  // belongs to that feature's offer (Evocation Savant, Magic Initiate); without one it fills the
  // class budgets.
  const separateKinds = new Set(["equipment", "size"]);
  const preparedSpellRows: CharacterChoice[] = [];
  const classCantripRows: CharacterChoice[] = [];
  for (const row of input.choices) {
    if (separateKinds.has(row.kind) || FEAT_KINDS.has(row.kind)) continue;
    if (row.kind === "subclass") {
      if (row.id !== input.subclassId) reject(`The subclass choice row ("${row.id}") disagrees with the chosen subclass "${input.subclassId ?? "none"}".`);
      const offer = offers.find((candidate) => candidate.kind === "subclass");
      if (offer) offer.taken.push(row.id);
      continue;
    }
    if (row.kind === "spell" || row.kind === "cantrip") {
      const featureTag = featureTagOf(row);
      const featureOffers = offers.filter((offer) => offer.kind === row.kind && offer.featureId !== null);
      const scoped = featureTag ? featureOffers.filter((offer) => offer.featureId === featureTag) : [];
      if (scoped.length > 0) { matchRow(row, scoped); continue; }
      if (featureTag) reject(`No feature "${featureTag}" offers a "${row.kind}" choice.`);
      (row.kind === "spell" ? preparedSpellRows : classCantripRows).push(row);
      continue;
    }
    matchRow(row, offers.filter((offer) => offer.kind === row.kind));
  }
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
  // ability, capped at 20 - the choice vocabulary carries no amount, so one point per pick is the
  // only reading that fits every printed use; raising past 20 (epic boons) stays unmodeled for now.
  for (const offer of offers.filter((candidate) => candidate.kind === "ability-score")) {
    for (const taken of offer.taken) {
      const ability = ABILITIES.find((candidate) => candidate === taken) ?? reject(`"${taken}" is not an ability.`);
      finalScores[ability] = Math.min(20, finalScores[ability] + 1);
    }
  }
  for (const feat of chosenFeats) {
    if (feat.prerequisite?.level !== undefined && input.level < feat.prerequisite.level) reject(`${feat.name} requires level ${feat.prerequisite.level}.`);
    for (const minimum of feat.prerequisite?.abilityScores ?? []) {
      if (finalScores[minimum.ability] < minimum.minimum) reject(`${feat.name} requires ${minimum.ability.toUpperCase()} ${minimum.minimum}.`);
    }
    // `requires` slugs beyond level/ability minimums are prose-adjudicated (ADR-0008 fail-open).
  }

  // ---- 6. Interpret every granted feature (class, subclass, species, background, chosen feats). ----
  const casting = subclass?.spellcasting ?? classRecord.spellcasting ?? null;
  const context: BuildContext = { level: input.level, proficiencyBonus, finalScores, spellcastingAbility: casting?.ability ?? null };
  const interpreted: InterpretedFeatures = {
    actions: [], traits: [], grantedSkills: [], grantedExpertise: [], grantedTools: [], grantedLanguages: [],
    grantedArmor: [], grantedWeapons: [], grantedSaves: [], damageResistances: [], damageImmunities: [],
    conditionImmunities: [], grantedSpells: [], abilityIncreases: [], hitPointsPerLevel: 0, speedBonus: 0,
    armorClassBonus: 0, initiativeBonus: 0, extraAttacks: 0, unarmoredDefense: null
  };
  for (const { record } of granted) interpretFeature(record, interpreted, context);
  for (const increase of interpreted.abilityIncreases) {
    finalScores[increase.ability] = Math.min(increase.maximum ?? 20, finalScores[increase.ability] + increase.amount);
  }

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
    const slots = (levelRow.spellSlots ?? []).map((count, index) => ({ level: index + 1, max: count })).filter((slot) => slot.max > 0);
    const maxSlotLevel = slots.reduce((highest, slot) => Math.max(highest, slot.level), 0);
    const cantripCap = levelRow.cantripsKnown ?? 0;
    if (classCantripRows.length > cantripCap) reject(`${classRecord.name} knows ${cantripCap} cantrips at level ${input.level}; got ${classCantripRows.length}.`);
    const preparedCap = levelRow.preparedCount ?? levelRow.spellsKnown ?? 0;
    if (preparedSpellRows.length > preparedCap) reject(`${classRecord.name} ${casting.prepares === "prepared" ? "prepares" : "knows"} ${preparedCap} spells at level ${input.level}; got ${preparedSpellRows.length}.`);
    const spells: Array<Record<string, unknown>> = [];
    for (const row of classCantripRows) {
      const option = listOptions.get(row.id) ?? reject(`"${row.id}" is not on the ${classRecord.name} spell list.`);
      if (option.level !== 0) reject(`"${row.id}" is a level-${option.level} spell, not a cantrip.`);
      if (spells.some((existing) => existing.id === option.id)) reject(`"${row.id}" is chosen twice.`);
      spells.push({ id: option.id, name: option.name, level: 0, prepared: true, alwaysPrepared: true });
    }
    for (const row of preparedSpellRows) {
      const option = listOptions.get(row.id) ?? reject(`"${row.id}" is not on the ${classRecord.name} spell list.`);
      const spellLevel = option.level ?? 0;
      if (spellLevel < 1) reject(`"${row.id}" is a cantrip - record it as a "cantrip" choice.`);
      if (spellLevel > maxSlotLevel) reject(`"${row.id}" is level ${spellLevel}, above the highest slot level (${maxSlotLevel}) at ${classRecord.name} ${input.level}.`);
      if (spells.some((existing) => existing.id === option.id)) reject(`"${row.id}" is chosen twice.`);
      spells.push({ id: option.id, name: option.name, level: spellLevel, prepared: true, alwaysPrepared: false, classId: classRecord.id });
    }
    for (const id of featureCantripPicks) {
      const record = library.spellRecord(id);
      if (!spells.some((existing) => existing.id === id)) spells.push({ id, name: record?.name ?? id, level: record?.level ?? 0, prepared: true, alwaysPrepared: true });
    }
    for (const id of featureSpellPicks) {
      const record = library.spellRecord(id);
      if (!spells.some((existing) => existing.id === id)) spells.push({ id, name: record?.name ?? id, level: record?.level ?? 1, prepared: true, alwaysPrepared: false, classId: classRecord.id });
    }
    for (const grantedSpell of interpreted.grantedSpells) {
      if (!spells.some((existing) => existing.id === grantedSpell.id)) spells.push(grantedSpellEntry(grantedSpell));
    }
    const saveDc = spellSaveDc(finalScores[casting.ability], proficiencyBonus);
    const attackBonus = spellAttackBonus(finalScores[casting.ability], proficiencyBonus);
    // Top-level fields stay populated (the documented resolution order's step 3, and the schema's
    // superRefine demands the combined pool when per-class slots exist); the per-class entry rides along.
    spellcasting = {
      ability: casting.ability, saveDc, attackBonus, slots,
      classes: [{ classId: classRecord.id, ability: casting.ability, saveDc, attackBonus, slots, ...(levelRow.preparedCount !== undefined ? { prepared: levelRow.preparedCount } : {}) }],
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
      spellcasting = {
        ability,
        saveDc: spellSaveDc(finalScores[ability], proficiencyBonus),
        attackBonus: spellAttackBonus(finalScores[ability], proficiencyBonus),
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
      inventory.push({
        id: item.id, name: record?.name ?? item.name, quantity: item.quantity,
        equipped: record ? record.category === "armor" || record.category === "shield" || record.category === "weapon" : false,
        attuned: false,
        ...(record?.weightLb !== null && record?.weightLb !== undefined ? { weightEach: record.weightLb } : {}),
        ...(record?.description ? { description: record.description.slice(0, 4000) } : {}),
        ...(record ? { category: record.category } : {}),
        ...(record?.weapon ? { weapon: { category: record.weapon.category, damageDice: record.weapon.damageDice, damageType: record.weapon.damageType, rangeFeet: record.weapon.rangeFeet, longRangeFeet: record.weapon.longRangeFeet } } : {}),
        ...(record?.armor ? { armor: { acBase: record.armor.acBase, addDexModifier: record.armor.addDexModifier, dexModifierCap: record.armor.dexModifierCap, stealthDisadvantage: record.armor.stealthDisadvantage, strengthRequired: record.armor.strengthRequired } } : {})
      });
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
  const armorClass = (equipmentAc ?? unarmoredAc ?? 10 + dexModifier) + interpreted.armorClassBonus;
  const initiativeBonus = dexModifier + interpreted.initiativeBonus;
  if (interpreted.extraAttacks > 0) {
    // The modeled vocabulary for Extra Attack is `attack.count`; weapon attacks themselves ride the
    // equipped inventory (the sheet derives them), so the count lands on interpreted attack actions.
    for (const action of interpreted.actions) {
      if (action.attack) action.attack = { ...action.attack, count: Math.min(10, (action.attack.count ?? 1) + interpreted.extraAttacks) };
    }
  }

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
    extensions: { "open5e.srd-2024": { traits: interpreted.traits } },
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
      // The provenance ledger, VERBATIM - level-up and respec prefill from exactly these rows.
      choices: [...input.choices]
    },
    proficiencies,
    ...(spellcasting ? { spellcasting } : {}),
    startingInventory: inventory,
    startingCurrency: { cp: 0, sp: 0, ep: 0, gp: goldPieces, pp: 0 }
  });
}

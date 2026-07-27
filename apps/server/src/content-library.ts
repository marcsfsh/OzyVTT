import type { CatalogChoiceCatalogs, ContentActionSummary, ContentBackgroundSummary, ContentChoiceList, ContentClassLevelRow, ContentClassSummary, ContentConditionSummary, ContentEquipmentSummary, ContentFeatSummary, ContentFeatureSummary, ContentMonsterSummary, ContentNameBundle, ContentSkillSummary, ContentSpeciesSummary, ContentSpellcastingSummary, ContentSpellSummary, ContentStartingEquipmentOption, ContentSubclassSummary } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { progressionTableFromClasses, type ClassProgressionTable } from "@vtt/rules-5e";
import { loadAttribution, loadBackgrounds, loadClasses, loadConditions, loadEquipment, loadFeats, loadMonsterDefinitions, loadNames, loadSkills, loadSpecies, loadSpells, loadSubclasses, type BackgroundReference, type ClassLevelRow, type ClassReference, type ContentSpellcasting, type EquipmentReference, type FeatReference, type FeatureRecord, type SpeciesReference, type SpellReference, type SubclassReference } from "@vtt/content-srd-5.2.1";
import { parseAreaProse } from "./area-targeting.js";

/**
 * Read-only access to the bundled SRD content for command handlers. Loaded once per process;
 * the bundle is validated by the content package's own loaders. Clients never import the
 * content package - they receive these wire shapes from the server (ADR-0001/0015).
 */
export class ContentLibrary {
  private readonly byId = new Map<string, ActorDefinition>();
  private readonly summaries: ContentMonsterSummary[];
  readonly attribution: string;

  constructor() {
    for (const definition of loadMonsterDefinitions()) {
      if (definition.source.externalId) this.byId.set(definition.source.externalId, definition);
    }
    this.summaries = [...this.byId.entries()]
      .map(([id, definition]) => {
        const extension = definition.extensions["open5e.srd-2024"] as { challengeRating?: number; type?: string } | undefined;
        return {
          id,
          name: definition.name,
          challengeRating: extension?.challengeRating ?? 0,
          type: extension?.type ?? "unknown",
          size: definition.size,
          armorClass: definition.armorClass,
          hitPoints: definition.hitPoints.maximum
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    this.attribution = loadAttribution().attribution;
  }

  monsterSummaries(): readonly ContentMonsterSummary[] { return this.summaries; }
  monster(definitionId: string): ActorDefinition | undefined { return this.byId.get(definitionId); }
  conditionSummaries(): readonly ContentConditionSummary[] { return conditionSummaries; }
  hasCondition(conditionId: string): boolean { return conditionIds.has(conditionId); }
  skillSummaries(): readonly ContentSkillSummary[] { return skillSummaries; }
  spellSummaries(): readonly ContentSpellSummary[] { return spellSummaries; }
  equipmentSummaries(): readonly ContentEquipmentSummary[] { return equipmentSummaries; }
  classSummaries(): readonly ContentClassSummary[] { return classSummaries; }
  subclassSummaries(): readonly ContentSubclassSummary[] { return subclassSummaries; }
  speciesSummaries(): readonly ContentSpeciesSummary[] { return speciesSummaries; }
  backgroundSummaries(): readonly ContentBackgroundSummary[] { return backgroundSummaries; }
  featSummaries(): readonly ContentFeatSummary[] { return featSummaries; }
  nameBundles(): readonly ContentNameBundle[] { return nameBundles; }
  monsterAction(definitionId: string, actionId: string): ActorDefinition["actions"][number] | undefined {
    return this.byId.get(definitionId)?.actions.find((action) => action.id === actionId);
  }
  monsterActionSummaries(definitionId: string): readonly ContentActionSummary[] | undefined {
    return this.byId.get(definitionId)?.actions.map(actionSummaryOf);
  }

  // ---------- Character-builder assembly surface (server-side ONLY - riders never reach the wire) ----------

  /** The wire catalogs `resolveCatalogChoice` reads - the server validates character.create choices through the SAME resolver the wizard renders from. */
  catalogChoiceCatalogs(): CatalogChoiceCatalogs {
    return { classes: classSummaries, subclasses: subclassSummaries, species: speciesSummaries, feats: featSummaries, spells: spellSummaries, equipment: equipmentSummaries, skills: skillSummaries };
  }
  /** The rules progression table with every AUTHORED class adapted in (bundle wins; SRD rows remain the fallback for un-authored classes). */
  classProgressionTable(): ClassProgressionTable { return progressionTable; }
  /** Full bundle records (riders included) for the server-side feature interpreter. Never projected to a client. */
  classRecord(id: string): ClassReference | undefined { return classRecords.get(id); }
  subclassRecord(id: string): SubclassReference | undefined { return subclassRecords.get(id); }
  speciesRecord(id: string): SpeciesReference | undefined { return speciesRecords.get(id); }
  backgroundRecord(id: string): BackgroundReference | undefined { return backgroundRecords.get(id); }
  featRecord(id: string): FeatReference | undefined { return featRecords.get(id); }
  equipmentRecord(id: string): EquipmentReference | undefined { return equipmentRecords.get(id); }
  spellRecord(id: string): SpellReference | undefined { return spellRecords.get(id); }
}

/** One flattening for both content sources (bundled + imported), so the runner's wire shape can't fork. */
export function actionSummaryOf(action: ActorDefinition["actions"][number]): ContentActionSummary {
  return {
    id: action.id,
    name: action.name,
    activation: action.activation,
    description: action.description,
    attackBonus: action.attack?.bonus ?? null,
    reachFeet: action.attack?.reachFeet ?? null,
    rangeFeet: action.attack?.rangeFeet ?? null,
    rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
    saveAbility: action.save?.ability ?? null,
    saveDc: action.save?.dc ?? null,
    damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
    area: parseAreaProse(action.description),
    attackCount: action.attack?.count ?? null,
    usesLimit: action.uses?.limit ?? null,
    usesPer: action.uses?.per ?? null,
    usesRecharge: action.uses?.recharge ?? null,
    usesPool: action.uses?.pool ?? null,
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack ?? null,
    grants: action.grants !== undefined,
    reaction: action.reaction ?? null,
    ...(action.legendary ? { legendaryCost: action.legendary.cost } : {})
  };
}

const conditionSummaries: readonly ContentConditionSummary[] = loadConditions().map(({ id, name, description }) => ({ id, name, description }));
const conditionIds = new Set(conditionSummaries.map((condition) => condition.id));

/** "V, S, M (a pinch of soot)" from the structured components, or "None" for a spell with no components. */
function spellComponentsText(components: ReturnType<typeof loadSpells>[number]["components"]): string {
  const parts = [components.verbal ? "V" : null, components.somatic ? "S" : null, components.material ? "M" : null].filter((part): part is string => part !== null);
  const base = parts.join(", ");
  const material = components.material && components.materialText ? ` (${components.materialText})` : "";
  return base ? `${base}${material}` : "None";
}
/** SRD upcast rows are typed "slot_level_N"; keep only those (cantrip character-level scaling is not a cast-at option) and surface the slot level the sheet keys on. */
function slotCastingOptions(options: ReturnType<typeof loadSpells>[number]["castingOptions"]): ContentSpellSummary["castingOptions"] {
  return options.flatMap((option) => {
    const match = /^slot_level_(\d+)$/.exec(option.type);
    return match ? [{ level: Number(match[1]), damageRoll: option.damageRoll, targetCount: option.targetCount }] : [];
  });
}
const spellSummaries: readonly ContentSpellSummary[] = loadSpells()
  .map((spell) => ({
    id: spell.id, name: spell.name, level: spell.level, school: spell.school, castingTime: spell.castingTime,
    rangeText: spell.range.text, componentsText: spellComponentsText(spell.components), duration: spell.duration,
    concentration: spell.concentration, ritual: spell.ritual, description: spell.description, higherLevel: spell.higherLevel,
    // The spell-list link (which class lists this spell is on) - what the builder's spell step
    // filters by, paired with the class record's spellcasting.spellListId. Dropping this severed
    // the list in both directions (phase-2 QA must-fix).
    classes: spell.classes,
    damageRoll: spell.damage.roll, damageTypes: spell.damage.types, castingOptions: slotCastingOptions(spell.castingOptions)
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

// Skill catalog: reference text + the ability each check uses (the content loader fills the SRD
// mapping when the bundle row predates the ability column, so `ability` is null only for a genuinely
// unmapped homebrew row). This endpoint is what retires the client's hardcoded SKILL_ABILITY table.
const skillSummaries: readonly ContentSkillSummary[] = loadSkills().map((skill) => ({
  id: skill.id, name: skill.name, description: skill.description, ability: skill.ability ?? null
}));

// The wire shape mirrors EquipmentReference one-to-one (the content package already folds weapons/armor
// in and sorts by name), so the server just re-emits it as the transport-owned type.
const equipmentSummaries: readonly ContentEquipmentSummary[] = loadEquipment().map((item) => ({
  id: item.id, name: item.name, category: item.category, costGp: item.costGp, weightLb: item.weightLb, description: item.description,
  weapon: item.weapon ?? null, armor: item.armor ?? null
}));

// ---------- Character-builder catalogs ----------
//
// This is THE merge point for builder content, the same role `loadEquipment()` plays for gear: one
// catalog per type, mapped once from the bundle records into the transport-owned wire shapes. GM
// homebrew becomes another source folded in here (`source: "homebrew"`), never a fork (ADR-0016).
//
// Each row is the browse-and-pick PROJECTION of its bundle record. The structured riders on a
// feature - granted actions, effects, modifiers, limited uses - are deliberately not on the wire:
// the server applies them when it builds the character, so the wizard cannot become a second,
// divergent rules engine (CLAUDE.md rule 2). Prose, level, tags, and the pick a feature asks for are
// what a client needs to render and collect choices.
//
// NOTE: the bundles currently carry a partial SRD slice (task packet phase 1.1 seed content) - full
// transcription is phases 2 and 5. A short catalog here is missing CONTENT, never a missing endpoint.
/**
 * A feature's pick as the wizard needs it. Inline `options` carry their authored name (an id alone
 * makes the client titleize - `clouds-jaunt` renders as "Clouds Jaunt") and any SECOND-ORDER pick the
 * option owes: choosing Cleric Divine Order's "thaumaturge" grants an extra cantrip, and without that
 * nested choice on the wire the wizard reports the step complete and the server refuses the build.
 * Riders (actions/grants/modifiers/uses) stay server-side - only what the player must SEE travels.
 */
const choiceSummaryOf = (choice: FeatureRecord["choice"]): ContentFeatureSummary["choice"] => choice
  ? {
      kind: choice.kind, choose: choice.choose, from: choice.from ?? [], fromCatalog: choice.fromCatalog ?? null, maxSpellLevel: choice.maxSpellLevel ?? null,
      options: (choice.options ?? []).map((option) => ({
        id: option.id, name: option.name, description: option.description,
        // One level of nesting only, matching the schema's own bound: a nested choice cannot itself carry options.
        choice: option.choice ? { kind: option.choice.kind, choose: option.choice.choose, from: option.choice.from ?? [], fromCatalog: option.choice.fromCatalog ?? null, maxSpellLevel: option.choice.maxSpellLevel ?? null, options: [] } : null
      }))
    }
  : null;

const featureSummaryOf = (feature: FeatureRecord, grantedAtLevels: readonly number[] = []): ContentFeatureSummary => ({
  id: feature.id,
  name: feature.name,
  level: feature.level ?? null,
  description: feature.description,
  tags: feature.tags,
  choice: choiceSummaryOf(feature.choice),
  grantedAtLevels
});

/** feature id -> every level row that grants it, in order. The client's repeat count. */
const grantLevelsOf = (levelTable: ClassReference["levelTable"]): ReadonlyMap<string, number[]> => {
  const levels = new Map<string, number[]>();
  for (const row of levelTable) {
    for (const featureId of row.features) {
      const existing = levels.get(featureId);
      if (existing) existing.push(row.level);
      else levels.set(featureId, [row.level]);
    }
  }
  return levels;
};
// The whole bundle, not just its label: a label can be shown but never turned into inventory, so the
// wizard's "take option A" had nothing to add. Items and the "or take N gp" alternative both travel.
const equipmentOptionsOf = (options: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<{ id: string; name: string; quantity: number }>; goldPieces: number }>): readonly ContentStartingEquipmentOption[] =>
  options.map((option) => ({ id: option.id, label: option.label, items: option.items.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity })), goldPieces: option.goldPieces }));
// The printed 20-row table as DISPLAY data. Optional columns become null ("this class has no such
// column") rather than 0, so the wizard can tell "no cantrips" from "zero cantrips at this level".
const levelRowOf = (row: ClassLevelRow): ContentClassLevelRow => ({
  level: row.level, proficiencyBonus: row.proficiencyBonus,
  spellSlots: row.spellSlots ? [...row.spellSlots] : null,
  pactSlots: row.pactSlots ? { level: row.pactSlots.level, slots: row.pactSlots.slots } : null,
  cantripsKnown: row.cantripsKnown ?? null, spellsKnown: row.spellsKnown ?? null,
  preparedFormula: row.preparedFormula ?? null, preparedCount: row.preparedCount ?? null,
  classResources: row.classResources.map((resource) => ({ id: resource.id, name: resource.name, amount: resource.amount }))
});
const byName = <T extends { name: string }>(left: T, right: T) => left.name.localeCompare(right.name);
/** A bundle "choose N from" list -> the wire shape (null = the record offers no such choice). */
const choiceListOf = (list: Readonly<{ choose: number; from: readonly string[] }> | undefined): ContentChoiceList | null =>
  list ? { choose: list.choose, from: list.from } : null;
/** A class/subclass spellcasting header -> the wire shape. The structured riders stay server-side as ever; this is the caster step's display data plus the spell-list link. */
const spellcastingSummaryOf = (spellcasting: ContentSpellcasting | undefined): ContentSpellcastingSummary | null =>
  spellcasting
    ? { ability: spellcasting.ability, prepares: spellcasting.prepares, ritual: spellcasting.ritual, focus: spellcasting.focus, progression: spellcasting.multiclassProgression, spellListId: spellcasting.spellListId ?? null }
    : null;

const classSummaries: readonly ContentClassSummary[] = loadClasses().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  hitDie: entry.hitDie, statPriority: entry.statPriority, primaryAbilities: entry.primaryAbilities, savingThrows: entry.savingThrows,
  skillChoiceCount: entry.skillChoices.choose, skillChoices: entry.skillChoices.from,
  // Armor/weapon/tool training and the multiclass rules were authored but never crossed the wire -
  // the wizard's proficiency summary and multiclass gating had no data path (phase-2 QA must-fix).
  armorProficiencies: entry.armorProficiencies, weaponProficiencies: entry.weaponProficiencies, toolProficiencies: entry.toolProficiencies,
  toolChoices: choiceListOf(entry.toolChoices),
  multiclassProficiencies: entry.multiclassProficiencies
    ? { armor: entry.multiclassProficiencies.armor, weapons: entry.multiclassProficiencies.weapons, tools: entry.multiclassProficiencies.tools, skillChoices: choiceListOf(entry.multiclassProficiencies.skills) }
    : null,
  multiclassPrerequisites: entry.multiclassPrerequisites
    ? { mode: entry.multiclassPrerequisites.mode, minimums: entry.multiclassPrerequisites.minimums.map((minimum) => ({ ability: minimum.ability, minimum: minimum.minimum })) }
    : null,
  subclassLevel: entry.subclassLevel, subclassLabel: entry.subclassLabel ?? null, asiLevels: entry.asiLevels,
  spellcastingAbility: entry.spellcasting?.ability ?? null, spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  spellcasting: spellcastingSummaryOf(entry.spellcasting),
  levelTable: entry.levelTable.map(levelRowOf),
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  // The level table is the ONLY place that knows a feature repeats, and it does not travel with a
  // feature list on the wire - so the repeat count is resolved here and carried per feature.
  features: (() => {
    const grants = grantLevelsOf(entry.levelTable);
    return entry.features.map((feature) => featureSummaryOf(feature, grants.get(feature.id) ?? []));
  })()
})).sort(byName);

const subclassSummaries: readonly ContentSubclassSummary[] = loadSubclasses().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, classId: entry.classId, summary: entry.summary ?? null, description: entry.description ?? null,
  subclassLevel: entry.subclassLevel ?? null,
  spellcastingAbility: entry.spellcasting?.ability ?? null, spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  spellcasting: spellcastingSummaryOf(entry.spellcasting),
  features: entry.features.map((feature) => featureSummaryOf(feature))
})).sort(byName);

// Species traits and lineage traits are the same FeatureRecord shape; the lineage's own traits are
// folded into `features` so a client renders one list (the lineage row keeps its identity for picking).
const speciesSummaries: readonly ContentSpeciesSummary[] = loadSpecies().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  sizes: entry.sizes, speedFeet: entry.speedFeet, darkvisionFeet: entry.darkvisionFeet, creatureType: entry.creatureType,
  // Ability increases as DATA (empty for every SRD 5.2.1 species - they live on the background);
  // the wire carries whatever the record declares so 2014-style/homebrew species work unchanged.
  abilityBonuses: entry.abilityBonuses.map((bonus) => ({ ability: bonus.ability, amount: bonus.amount })),
  abilityBonusChoice: entry.abilityBonusChoice
    ? { choose: entry.abilityBonusChoice.choose, amount: entry.abilityBonusChoice.amount, from: entry.abilityBonusChoice.from }
    : null,
  languages: entry.languages, languageChoices: choiceListOf(entry.languageChoices),
  lineages: entry.lineages.map((lineage) => ({ id: lineage.id, name: lineage.name, description: lineage.description ?? null })),
  features: [...entry.traits, ...entry.lineages.flatMap((lineage) => lineage.traits)].map((feature) => featureSummaryOf(feature))
})).sort(byName);

const backgroundSummaries: readonly ContentBackgroundSummary[] = loadBackgrounds().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  abilityOptions: entry.abilityOptions ? { from: entry.abilityOptions.from, spreads: entry.abilityOptions.spreads } : null,
  originFeatId: entry.originFeatId ?? null,
  skillProficiencies: entry.skillProficiencies, skillChoices: choiceListOf(entry.skillChoices),
  toolProficiencies: entry.toolProficiencies, toolChoices: choiceListOf(entry.toolChoices),
  languages: entry.languages, languageChoices: choiceListOf(entry.languageChoices),
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  features: entry.features.map((feature) => featureSummaryOf(feature))
})).sort(byName);

// A feat IS a feature plus catalog metadata - hence the single `feature`, not a list. Prerequisites
// travel as structured data AND prose; the server remains the authority on whether one is met.
const featSummaries: readonly ContentFeatSummary[] = loadFeats().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  category: entry.category, repeatable: entry.repeatable,
  prerequisiteLevel: entry.prerequisite?.level ?? null,
  prerequisiteAbilities: entry.prerequisite?.abilityScores ?? [],
  prerequisiteRequires: entry.prerequisite?.requires ?? [],
  prerequisiteText: entry.prerequisite?.text ?? null,
  feature: featureSummaryOf(entry.feature)
})).sort(byName);

const nameBundles: readonly ContentNameBundle[] = loadNames().map((entry) => ({
  speciesId: entry.speciesId, source: entry.source,
  pools: entry.pools.map((pool) => ({ id: pool.id, label: pool.label, names: pool.names }))
}));

// ---------- Server-side assembly indexes (full records, riders included - never on the wire) ----------
// The bundle-driven progression table: authored classes drive the rules math through the adapter,
// with the static SRD rows remaining the fallback for classes not authored yet (known-bugs M2 -
// a homebrew or authored class must never silently fall back to d8/none/4-8-12-16 defaults).
const progressionTable: ClassProgressionTable = progressionTableFromClasses(loadClasses());
const classRecords = new Map(loadClasses().map((entry) => [entry.id, entry]));
const subclassRecords = new Map(loadSubclasses().map((entry) => [entry.id, entry]));
const speciesRecords = new Map(loadSpecies().map((entry) => [entry.id, entry]));
const backgroundRecords = new Map(loadBackgrounds().map((entry) => [entry.id, entry]));
const featRecords = new Map(loadFeats().map((entry) => [entry.id, entry]));
const equipmentRecords = new Map(loadEquipment().map((entry) => [entry.id, entry]));
const spellRecords = new Map(loadSpells().map((entry) => [entry.id, entry]));

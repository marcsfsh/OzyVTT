import type { ContentActionSummary, ContentBackgroundSummary, ContentClassLevelRow, ContentClassSummary, ContentConditionSummary, ContentEquipmentSummary, ContentFeatSummary, ContentFeatureSummary, ContentMonsterSummary, ContentNameBundle, ContentSpeciesSummary, ContentSpellSummary, ContentStartingEquipmentOption, ContentSubclassSummary } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadAttribution, loadBackgrounds, loadClasses, loadConditions, loadEquipment, loadFeats, loadMonsterDefinitions, loadNames, loadSpecies, loadSpells, loadSubclasses, type ClassLevelRow, type FeatureRecord } from "@vtt/content-srd-5.2.1";
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
    damageRoll: spell.damage.roll, damageTypes: spell.damage.types, castingOptions: slotCastingOptions(spell.castingOptions)
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

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
const featureSummaryOf = (feature: FeatureRecord): ContentFeatureSummary => ({
  id: feature.id,
  name: feature.name,
  level: feature.level ?? null,
  description: feature.description,
  tags: feature.tags,
  choice: feature.choice
    ? { kind: feature.choice.kind, choose: feature.choice.choose, from: feature.choice.from ?? [], fromCatalog: feature.choice.fromCatalog ?? null }
    : null
});
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

const classSummaries: readonly ContentClassSummary[] = loadClasses().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  hitDie: entry.hitDie, statPriority: entry.statPriority, primaryAbilities: entry.primaryAbilities, savingThrows: entry.savingThrows,
  skillChoiceCount: entry.skillChoices.choose, skillChoices: entry.skillChoices.from,
  subclassLevel: entry.subclassLevel, subclassLabel: entry.subclassLabel ?? null, asiLevels: entry.asiLevels,
  spellcastingAbility: entry.spellcasting?.ability ?? null, spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  levelTable: entry.levelTable.map(levelRowOf),
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  features: entry.features.map(featureSummaryOf)
})).sort(byName);

const subclassSummaries: readonly ContentSubclassSummary[] = loadSubclasses().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, classId: entry.classId, summary: entry.summary ?? null, description: entry.description ?? null,
  subclassLevel: entry.subclassLevel ?? null,
  spellcastingAbility: entry.spellcasting?.ability ?? null, spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  features: entry.features.map(featureSummaryOf)
})).sort(byName);

// Species traits and lineage traits are the same FeatureRecord shape; the lineage's own traits are
// folded into `features` so a client renders one list (the lineage row keeps its identity for picking).
const speciesSummaries: readonly ContentSpeciesSummary[] = loadSpecies().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  sizes: entry.sizes, speedFeet: entry.speedFeet, darkvisionFeet: entry.darkvisionFeet, creatureType: entry.creatureType,
  languages: entry.languages,
  lineages: entry.lineages.map((lineage) => ({ id: lineage.id, name: lineage.name, description: lineage.description ?? null })),
  features: [...entry.traits, ...entry.lineages.flatMap((lineage) => lineage.traits)].map(featureSummaryOf)
})).sort(byName);

const backgroundSummaries: readonly ContentBackgroundSummary[] = loadBackgrounds().map((entry) => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  abilityOptions: entry.abilityOptions ? { from: entry.abilityOptions.from, spreads: entry.abilityOptions.spreads } : null,
  originFeatId: entry.originFeatId ?? null,
  skillProficiencies: entry.skillProficiencies, toolProficiencies: entry.toolProficiencies, languages: entry.languages,
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  features: entry.features.map(featureSummaryOf)
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

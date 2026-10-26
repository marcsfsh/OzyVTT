import type {
  CatalogChoiceCatalogs,
  ContentActionSummary,
  ContentBackgroundSummary,
  ContentChoiceList,
  ContentClassLevelRow,
  ContentClassSummary,
  ContentConditionSummary,
  ContentGlossaryEntry,
  ContentEquipmentSummary,
  ContentFeatSummary,
  ContentFeatureSummary,
  ContentLanguageSummary,
  ContentMonsterSummary,
  ContentNameBundle,
  ContentSkillSummary,
  ContentSpeciesSummary,
  ContentSpellcastingSummary,
  ContentSpellSummary,
  ContentStartingEquipmentOption,
  ContentSubclassSummary
} from "@vtt/domain";
import { actionChoicesOf, choosesAbility } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { progressionTableFromClasses, type ClassProgressionTable } from "@vtt/rules-5e";
import {
  applySpellListOverlay,
  featurePicks,
  loadAttribution,
  loadBackgrounds,
  loadClasses,
  loadConditions,
  loadGlossary,
  loadEquipment,
  loadFeats,
  loadLanguages,
  loadMonsterDefinitions,
  loadSummonStatBlocks,
  loadNames,
  loadSkills,
  loadSpecies,
  loadSpells,
  cantripScalingOf,
  slotCastingOptionsOf,
  loadSubclasses,
  type BackgroundReference,
  type ClassLevelRow,
  type ClassReference,
  type ContentSpellcasting,
  type EquipmentReference,
  type FeatReference,
  type FeatureOption,
  type FeatureRecord,
  type SpeciesReference,
  type SpellListReference,
  type SpellReference,
  type SubclassReference
} from "@vtt/content-srd-5.2.1";
import { spellComponentsText } from "@vtt/content-srd-5.2.1/spell-effect";
import { withTakenActions } from "./builtin-actions.js";
import { hitRiderOf } from "./resolution/hit-riders.js";
import type { CharacterFeatureRef } from "./equipment-derivation.js";
import { statblockFacts } from "./statblock-facts.js";
import { withMonsterSpells } from "./monster-spells.js";

/** The characters a player session reads as: the party characters it has claimed, or the ones a GM preview names. A
 *  reader with no character reads what everyone reads. */
export type ContentReader = Readonly<{ characterIds: readonly string[] }>;

/**
 * Who reads a catalog. `gm` is the GM's browsing (pickers, the bestiary, the GM's builder): every published record in
 * a pack that is on. `play` is play-time resolution of what is already on a sheet or the map: every published record,
 * whatever its pack's switch, so a character keeps what it has. A reader is one player session: the published records
 * in packs that are on and shown to everyone or to one of its characters. The public viewer never reads content.
 */
export type ContentAudience = "gm" | "play" | ContentReader;

/** The cache key of an audience: one per distinct set of characters, whatever order they come in. */
export function audienceKey(audience: ContentAudience): string {
  return typeof audience === "string" ? audience : `reader:${[...new Set(audience.characterIds)].sort().join(",")}`;
}

/** What a published homebrew record a reader may receive looks like: who it is shown to and whether its pack is on. */
export type HomebrewReach = Readonly<{
  audience: "hidden" | "everyone" | "characters";
  characterIds: readonly string[];
  packEnabled: boolean;
}>;

/** Whether `audience` receives a published, live record with this reach. The one rule every catalog follows. */
export function audienceReceives(audience: ContentAudience, reach: HomebrewReach): boolean {
  if (audience === "play") return true;
  if (!reach.packEnabled) return false;
  if (audience === "gm") return true;
  if (reach.audience === "everyone") return true;
  if (reach.audience !== "characters") return false;
  return reach.characterIds.some((id) => audience.characterIds.includes(id));
}

/** Published, non-deleted homebrew for one audience, in the SRD's own bundle shapes (ADR-0016). Drafts are
 *  never in a merged catalog; only the homebrew router's GM-only reads reach them. */
export type HomebrewCatalogSlice = Readonly<{
  classes: readonly ClassReference[];
  subclasses: readonly SubclassReference[];
  species: readonly SpeciesReference[];
  backgrounds: readonly BackgroundReference[];
  feats: readonly FeatReference[];
  spells: readonly SpellReference[];
  equipment: readonly EquipmentReference[];
  monsters: readonly ActorDefinition[];
  /** Membership overlays applied over the generated spell bundle at the merge point, never edits to it. */
  spellLists: readonly SpellListReference[];
}>;

/** The empty slice: an SRD-only catalog. */
export const EMPTY_HOMEBREW_SLICE: HomebrewCatalogSlice = Object.freeze({
  classes: [],
  subclasses: [],
  species: [],
  backgrounds: [],
  feats: [],
  spells: [],
  equipment: [],
  monsters: [],
  spellLists: []
});

/** What `ContentLibrary` needs from the homebrew store; an interface so tests can supply a fake. */
export interface HomebrewContentSource {
  /** Bumped inside every write transaction; -1 until the store's initialize() completes. */
  readonly revision: number;
  /** Published, non-deleted records this audience receives (`audienceReceives`). Never drafts. Two audiences that
   *  receive the same records may get the same slice object, so their catalogs are built once. */
  publishedFor(audience: ContentAudience): HomebrewCatalogSlice;
  /** Any monster row regardless of status/deletion; see ContentLibrary.monsterForInstance. */
  monsterForInstance(id: string): ActorDefinition | undefined;
}

/** Everything the server reads from the merged catalog, already scoped to one audience. */
export interface ContentView {
  readonly audience: ContentAudience;
  readonly attribution: string;
  conditionSummaries(): readonly ContentConditionSummary[];
  /** The SRD Rules Glossary; bundled text only, the same for every audience. */
  glossaryEntries(): readonly ContentGlossaryEntry[];
  hasCondition(conditionId: string): boolean;
  skillSummaries(): readonly ContentSkillSummary[];
  languageSummaries(): readonly ContentLanguageSummary[];
  spellSummaries(): readonly ContentSpellSummary[];
  equipmentSummaries(): readonly ContentEquipmentSummary[];
  classSummaries(): readonly ContentClassSummary[];
  subclassSummaries(): readonly ContentSubclassSummary[];
  speciesSummaries(): readonly ContentSpeciesSummary[];
  backgroundSummaries(): readonly ContentBackgroundSummary[];
  featSummaries(): readonly ContentFeatSummary[];
  nameBundles(): readonly ContentNameBundle[];
  monsterSummaries(): readonly ContentMonsterSummary[];
  /** Browse path: honours draft/published/visible/deleted. Play-time lookups use ContentLibrary.monsterForInstance. */
  monster(definitionId: string): ActorDefinition | undefined;
  monsterActionSummaries(definitionId: string): readonly ContentActionSummary[] | undefined;

  // ---------- Character-builder assembly surface (server-side only; riders never reach the wire) ----------

  /** The catalogs `resolveCatalogChoice` reads, so the server validates choices with the same resolver the wizard uses. */
  catalogChoiceCatalogs(): CatalogChoiceCatalogs;
  /** The rules progression table with every authored class adapted in; SRD rows are the fallback for un-authored classes. */
  classProgressionTable(): ClassProgressionTable;
  /** Full bundle records (riders included) for the server-side feature interpreter. Never projected to a client. */
  classRecord(id: string): ClassReference | undefined;
  subclassRecord(id: string): SubclassReference | undefined;
  speciesRecord(id: string): SpeciesReference | undefined;
  backgroundRecord(id: string): BackgroundReference | undefined;
  featRecord(id: string): FeatReference | undefined;
  /** The feature or inline option a sheet's `character.features` entry names, so its roll-time riders reach the table. */
  featureRecord(ref: CharacterFeatureRef): FeatureRecord | FeatureOption | undefined;
  equipmentRecord(id: string): EquipmentReference | undefined;
  spellRecord(id: string): SpellReference | undefined;
}

/** Read-only access to the bundled SRD content plus GM homebrew; clients get wire shapes from the server,
 *  never the content package (ADR-0001/0015). Catalogs are read only via `forAudience(audience)` with a
 *  required argument, so no call site can skip the audience decision. */
export class ContentLibrary {
  readonly attribution: string;
  private readonly views = new Map<string, ContentView>();
  /** Built catalogs by the slice they were built from: audiences that receive the same records share one. */
  private data = new WeakMap<HomebrewCatalogSlice, CatalogData>();
  /** Sentinel below every real revision (a store reports -1 while uninitialised). */
  private builtAt = -2;

  constructor(private readonly homebrew?: HomebrewContentSource) {
    this.attribution = loadAttribution().attribution;
  }

  /** The merged catalog for this audience, cached and rebuilt when the homebrew store's revision moves (a
   *  read before the store initialises builds an SRD-only view). */
  forAudience(audience: ContentAudience): ContentView {
    const revision = this.homebrew?.revision ?? 0;
    if (revision !== this.builtAt) {
      this.views.clear();
      this.data = new WeakMap();
      this.builtAt = revision;
    }
    const key = audienceKey(audience);
    const cached = this.views.get(key);
    if (cached) return cached;
    // Readers come and go with claims; a long session can't grow the cache without bound.
    if (this.views.size >= MAX_CACHED_VIEWS) this.views.clear();
    const view = viewOf(audience, this.catalogData(this.homebrew?.publishedFor(audience)), this.attribution);
    this.views.set(key, view);
    return view;
  }

  /** This audience's catalog over an adjusted homebrew slice, built uncached: the "what if" a publish gate asks
   *  (a record's pending edits without its live body, the table after a record is removed). */
  forAudienceAdjusted(
    audience: ContentAudience,
    adjust: (slice: HomebrewCatalogSlice) => HomebrewCatalogSlice
  ): ContentView {
    const adjusted = adjust(this.homebrew?.publishedFor(audience) ?? EMPTY_HOMEBREW_SLICE);
    return viewOf(audience, sliceIsEmpty(adjusted) ? SRD_ONLY_CATALOG : buildCatalogData(adjusted), this.attribution);
  }

  /** Play-time only and audience-free: resolves any homebrew monster row (even draft or deleted) so a live
   *  actor keeps its actions mid-fight. Never use it for browse. */
  monsterForInstance(definitionId: string): ActorDefinition | undefined {
    const bundled = SRD_ONLY_CATALOG.monstersById.get(definitionId) ?? summonStatBlocks().get(definitionId);
    if (bundled) return bundled;
    const homebrew = this.homebrew?.monsterForInstance(definitionId);
    // Its spells as cast actions, as the catalog gives a bundled stat block's.
    return homebrew
      ? withMonsterSpells(homebrew, (spellId) => this.forAudience("play").spellRecord(spellId))
      : undefined;
  }

  private catalogData(slice: HomebrewCatalogSlice | undefined): CatalogData {
    // No homebrew: every audience shares the module-level SRD catalog.
    if (!slice || sliceIsEmpty(slice)) return SRD_ONLY_CATALOG;
    const known = this.data.get(slice);
    if (known) return known;
    const built = buildCatalogData(slice);
    this.data.set(slice, built);
    return built;
  }
}

/** Distinct audiences kept at once; a table has the GM, play and a handful of players. */
const MAX_CACHED_VIEWS = 64;

/** One flattening for bundled and imported definitions, so the runner's wire shape can't fork. */
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
    ...(action.targets?.rangeFeet !== undefined ? { targetRangeFeet: action.targets.rangeFeet } : {}),
    saveAbility: action.save?.ability ?? null,
    saveDc: action.save?.dc ?? null,
    damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
    area: action.area ?? null,
    attackCount: action.attack?.count ?? null,
    usesLimit: action.uses?.limit ?? null,
    usesPer: action.uses?.per ?? null,
    usesRecharge: action.uses?.recharge ?? null,
    usesPool: action.uses?.pool ?? null,
    ...(action.uses?.afterHours !== undefined ? { usesAfterHours: action.uses.afterHours } : {}),
    ...(action.useCost !== undefined ? { useCost: action.useCost } : {}),
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack ?? null,
    // A row taking two generic actions at once (Step of the Wind) grants their effects when it resolves.
    grants: withTakenActions(action).grants !== undefined,
    reaction: action.reaction ?? null,
    ...(action.legendary ? { legendaryCost: action.legendary.cost } : {}),
    ...(action.legendary?.oncePerRound ? { legendaryOncePerRound: true as const } : {}),
    ...(action.move?.first ? { moveFirst: true as const } : {}),
    ...(action.replacesAttack ? { replacesAttack: true as const } : {}),
    ...(hitRiderOf(action) ? { ridesAHit: true as const } : {}),
    ...(action.darts !== undefined ? { darts: action.darts } : {}),
    ...(action.damageTypes !== undefined ? { damageTypes: [...action.damageTypes] } : {}),
    ...(action.save?.conditionChoices ? { conditionChoices: [...action.save.conditionChoices] } : {}),
    // A cure that ends one condition of several asks which (Lesser Restoration).
    ...(action.endsOneCondition && action.endsConditions ? { conditionChoices: [...action.endsConditions] } : {}),
    ...(choosesAbility(action) ? { choosesAbility: true } : {}),
    ...(action.vitality ? { vitality: { ...action.vitality } } : {}),
    ...(action.areaHeal ? { areaHeal: { ...action.areaHeal } } : {}),
    // What it asks for as it resolves; a self grant that asks is aimed at no one, so the pick comes before the tap.
    ...(actionChoicesOf(action) ? { choices: actionChoicesOf(action)! } : {}),
    ...(actionChoicesOf(action) && action.grants?.target === "self" ? { targeting: "none" as const } : {}),
    // A heal for others picks its targets: one (Divine Spark's healing), or several for a divided pool (Preserve Life).
    ...(action.healing && !action.healing.self
      ? { targeting: action.healing.divided ? ("multi" as const) : ("single" as const) }
      : {}),
    // So does a touch that ends a condition (Lay on Hands' cure).
    ...(action.endsConditions && !action.healing ? { targeting: "single" as const } : {}),
    // A stat block's spell list: its numbers head the casts that follow it.
    ...(action.castsSpells && !action.castsSpells.self
      ? {
          spellList: {
            ability: action.castsSpells.ability,
            saveDc: action.castsSpells.saveDc,
            attackBonus: action.castsSpells.attackBonus
          }
        }
      : {}),
    ...(action.spellId !== undefined ? { spellId: action.spellId } : {})
  };
}

/** A stat block's rows, each cast from a spell list marked with the list it belongs to (`castFrom`), so the list
 *  can show its spells under it. */
export function actionSummariesOf(actions: ActorDefinition["actions"]): ContentActionSummary[] {
  const listOf = new Map<string, string>();
  for (const action of actions)
    if (action.castsSpells && !action.castsSpells.self)
      for (const entry of action.castsSpells.spells) listOf.set(entry.id, action.id);
  return actions.map((action) => {
    const list = listOf.get(action.id);
    return { ...actionSummaryOf(action), ...(list !== undefined ? { castFrom: list } : {}) };
  });
}

// ---------- Character-builder catalogs ----------
// One wire catalog per type, homebrew folded in (ADR-0016). Feature riders stay off the wire: the
// server applies them when building.
/** A feature's pick for the wizard: inline options carry their name and any nested pick they owe. */
type WireChoice = ContentFeatureSummary["choices"][number];
/** `{offer, amount}` or `{offer, scaling}`, filled out for a wire type that has both. */
const extraPickSummaryOf = (grants: FeatureRecord["extraPicks"]): ContentFeatureSummary["extraPicks"] =>
  grants.map((grant) => ({ offer: grant.offer, amount: grant.amount ?? null, scaling: grant.scaling ?? null }));

const choiceSummaryOf = (choice: FeatureRecord["choice"]): WireChoice | null =>
  choice
    ? {
        kind: choice.kind,
        choose: choice.choose,
        from: choice.from ?? [],
        fromCatalog: choice.fromCatalog ?? null,
        maxSpellLevel: choice.maxSpellLevel ?? null,
        minSpellLevel: choice.minSpellLevel ?? null,
        fromPicks: choice.fromPicks ? { offer: choice.fromPicks.offer, where: choice.fromPicks.where ?? null } : null,
        options: (choice.options ?? []).map((option) => {
          // One level of nesting only, as in the schema: a nested choice cannot carry options.
          const nested = featurePicks(option).map((pick) => ({
            kind: pick.kind,
            choose: pick.choose,
            from: pick.from ?? [],
            fromCatalog: pick.fromCatalog ?? null,
            maxSpellLevel: pick.maxSpellLevel ?? null,
            minSpellLevel: pick.minSpellLevel ?? null,
            fromPicks: pick.fromPicks ? { offer: pick.fromPicks.offer, where: pick.fromPicks.where ?? null } : null,
            options: []
          }));
          return {
            id: option.id,
            name: option.name,
            description: option.description,
            // The gate travels so the wizard filters options the way the server will (`FeatureOptionSchema.requires`).
            requires: option.requires ? { offer: option.requires.offer, id: option.requires.id } : null,
            choices: nested,
            // The budget a chosen option raises, so the wizard lets the player make the extra pick.
            extraPicks: extraPickSummaryOf(option.extraPicks)
          };
        })
      }
    : null;

const featureSummaryOf = (feature: FeatureRecord, grantedAtLevels: readonly number[] = []): ContentFeatureSummary => {
  // Every pick a record owes, in order.
  const picks = featurePicks(feature).map((pick) => choiceSummaryOf(pick)!);
  return {
    id: feature.id,
    name: feature.name,
    level: feature.level ?? null,
    description: feature.description,
    tags: feature.tags,
    choices: picks,
    grantedAtLevels,
    extraPicks: extraPickSummaryOf(feature.extraPicks)
  };
};

/** Feature id to every level row that grants it, in order: the client's repeat count. */
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
// The whole bundle (items and the "or take N gp" alternative), so the wizard can turn an option into inventory.
const equipmentOptionsOf = (
  options: ReadonlyArray<{
    id: string;
    label: string;
    items: ReadonlyArray<{ id: string; name: string; quantity: number }>;
    goldPieces: number;
  }>
): readonly ContentStartingEquipmentOption[] =>
  options.map((option) => ({
    id: option.id,
    label: option.label,
    items: option.items.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity })),
    goldPieces: option.goldPieces
  }));
// The printed 20-row table as display data. A missing column is null and a printed zero is 0, so "no cantrips" differs
// from "zero cantrips at this level".
const levelRowOf = (row: ClassLevelRow): ContentClassLevelRow => ({
  level: row.level,
  proficiencyBonus: row.proficiencyBonus,
  spellSlots: row.spellSlots ? [...row.spellSlots] : null,
  pactSlots: row.pactSlots ? { level: row.pactSlots.level, slots: row.pactSlots.slots } : null,
  cantripsKnown: row.cantripsKnown ?? null,
  spellsKnown: row.spellsKnown ?? null,
  preparedFormula: row.preparedFormula ?? null,
  preparedCount: row.preparedCount ?? null,
  classResources: row.classResources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    amount: resource.amount
  }))
});
const byName = <T extends { name: string }>(left: T, right: T) => left.name.localeCompare(right.name);

/** A bundle "choose N from" list as the wire shape (null when the record offers no such choice). */
const choiceListOf = (
  list: Readonly<{ choose: number; from: readonly string[]; fromCatalog?: string }> | undefined
): ContentChoiceList | null =>
  list ? { choose: list.choose, from: list.from, fromCatalog: list.fromCatalog ?? null } : null;
/** A spellcasting header as the wire shape: display data plus the spell-list link. Riders stay server-side. */
const spellcastingSummaryOf = (spellcasting: ContentSpellcasting | undefined): ContentSpellcastingSummary | null =>
  spellcasting
    ? {
        ability: spellcasting.ability,
        prepares: spellcasting.prepares,
        ritual: spellcasting.ritual,
        focus: spellcasting.focus,
        progression: spellcasting.multiclassProgression,
        spellListId: spellcasting.spellListId ?? null
      }
    : null;

const classSummaryOf = (entry: ClassReference): ContentClassSummary => ({
  id: entry.id,
  name: entry.name,
  source: entry.source,
  summary: entry.summary ?? null,
  description: entry.description ?? null,
  hitDie: entry.hitDie,
  statPriority: entry.statPriority,
  primaryAbilities: entry.primaryAbilities,
  savingThrows: entry.savingThrows,
  skillChoiceCount: entry.skillChoices.choose,
  skillChoices: entry.skillChoices.from,
  armorProficiencies: entry.armorProficiencies,
  weaponProficiencies: entry.weaponProficiencies,
  toolProficiencies: entry.toolProficiencies,
  toolChoices: choiceListOf(entry.toolChoices),
  multiclassProficiencies: entry.multiclassProficiencies
    ? {
        armor: entry.multiclassProficiencies.armor,
        weapons: entry.multiclassProficiencies.weapons,
        tools: entry.multiclassProficiencies.tools,
        skillChoices: choiceListOf(entry.multiclassProficiencies.skills),
        toolChoices: choiceListOf(entry.multiclassProficiencies.toolChoices)
      }
    : null,
  multiclassPrerequisites: entry.multiclassPrerequisites
    ? {
        mode: entry.multiclassPrerequisites.mode,
        minimums: entry.multiclassPrerequisites.minimums.map((minimum) => ({
          ability: minimum.ability,
          minimum: minimum.minimum
        }))
      }
    : null,
  subclassLevel: entry.subclassLevel,
  subclassLabel: entry.subclassLabel ?? null,
  asiLevels: entry.asiLevels,
  spellcastingAbility: entry.spellcasting?.ability ?? null,
  spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  spellcasting: spellcastingSummaryOf(entry.spellcasting),
  levelTable: entry.levelTable.map(levelRowOf),
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  // Only the level table knows a feature repeats, so the repeat count is resolved here per feature.
  features: (() => {
    const grants = grantLevelsOf(entry.levelTable);
    return entry.features.map((feature) => featureSummaryOf(feature, grants.get(feature.id) ?? []));
  })()
});

const subclassSummaryOf = (entry: SubclassReference): ContentSubclassSummary => ({
  id: entry.id,
  name: entry.name,
  source: entry.source,
  classId: entry.classId,
  summary: entry.summary ?? null,
  description: entry.description ?? null,
  subclassLevel: entry.subclassLevel ?? null,
  spellcastingAbility: entry.spellcasting?.ability ?? null,
  spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  spellcasting: spellcastingSummaryOf(entry.spellcasting),
  features: entry.features.map((feature) => featureSummaryOf(feature))
});

// Lineage traits are folded into `features` so a client renders one list.
const speciesSummaryOf = (entry: SpeciesReference): ContentSpeciesSummary => ({
  id: entry.id,
  name: entry.name,
  source: entry.source,
  summary: entry.summary ?? null,
  description: entry.description ?? null,
  sizes: entry.sizes,
  speedFeet: entry.speedFeet,
  darkvisionFeet: entry.darkvisionFeet,
  creatureType: entry.creatureType,
  // Ability increases as data (empty for SRD 5.2.1 species; they live on the background), so
  // 2014-style and homebrew species still work.
  abilityBonuses: entry.abilityBonuses.map((bonus) => ({ ability: bonus.ability, amount: bonus.amount })),
  abilityBonusChoice: entry.abilityBonusChoice
    ? {
        choose: entry.abilityBonusChoice.choose,
        amount: entry.abilityBonusChoice.amount,
        from: entry.abilityBonusChoice.from
      }
    : null,
  languages: entry.languages,
  languageChoices: choiceListOf(entry.languageChoices),
  lineages: entry.lineages.map((lineage) => ({
    id: lineage.id,
    name: lineage.name,
    description: lineage.description ?? null
  })),
  features: [...entry.traits, ...entry.lineages.flatMap((lineage) => lineage.traits)].map((feature) =>
    featureSummaryOf(feature)
  )
});

const backgroundSummaryOf = (entry: BackgroundReference): ContentBackgroundSummary => ({
  id: entry.id,
  name: entry.name,
  source: entry.source,
  summary: entry.summary ?? null,
  description: entry.description ?? null,
  abilityOptions: entry.abilityOptions
    ? { from: entry.abilityOptions.from, spreads: entry.abilityOptions.spreads }
    : null,
  originFeatId: entry.originFeatId ?? null,
  skillProficiencies: entry.skillProficiencies,
  skillChoices: choiceListOf(entry.skillChoices),
  toolProficiencies: entry.toolProficiencies,
  toolChoices: choiceListOf(entry.toolChoices),
  languages: entry.languages,
  languageChoices: choiceListOf(entry.languageChoices),
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  features: entry.features.map((feature) => featureSummaryOf(feature))
});

// A feat is a feature plus catalog metadata. Prerequisites travel as data and prose; the server
// decides whether one is met.
const featSummaryOf = (entry: FeatReference): ContentFeatSummary => ({
  id: entry.id,
  name: entry.name,
  source: entry.source,
  summary: entry.summary ?? null,
  description: entry.description ?? null,
  category: entry.category,
  repeatable: entry.repeatable,
  prerequisiteLevel: entry.prerequisite?.level ?? null,
  prerequisiteAbilities: entry.prerequisite?.abilityScores ?? [],
  prerequisiteRequires: entry.prerequisite?.requires ?? [],
  prerequisiteText: entry.prerequisite?.text ?? null,
  feature: featureSummaryOf(entry.feature)
});

/** A container's printed limits, allow-listed for the catalog. */
const containerSummary = (
  container: NonNullable<EquipmentReference["container"]>
): NonNullable<ContentEquipmentSummary["container"]> => ({
  ...(container.capacityLb !== undefined ? { capacityLb: container.capacityLb } : {}),
  ...(container.pieces ? { pieces: container.pieces.count } : {}),
  ...(container.compartments
    ? {
        compartments: container.compartments.map((compartment) => ({
          id: compartment.id,
          name: compartment.name,
          ...(compartment.capacityLb !== undefined ? { capacityLb: compartment.capacityLb } : {}),
          ...(compartment.count !== undefined ? { count: compartment.count } : {})
        }))
      }
    : {}),
  ...(container.weighsLb !== undefined ? { weighsLb: container.weighsLb } : {}),
  ...(container.retrieval ? { retrieval: container.retrieval } : {})
});

const nameBundleOf = (entry: ReturnType<typeof loadNames>[number]): ContentNameBundle => ({
  speciesId: entry.speciesId,
  source: entry.source,
  pools: entry.pools.map((pool) => ({ id: pool.id, label: pool.label, names: pool.names }))
});

/** SRD rows then this audience's homebrew. Never mutates a cached `loadX()` result. */
const merged = <T>(srd: readonly T[], homebrew: readonly T[]): readonly T[] =>
  homebrew.length === 0 ? srd : [...srd, ...homebrew];

const sliceIsEmpty = (slice: HomebrewCatalogSlice): boolean =>
  slice.classes.length === 0 &&
  slice.subclasses.length === 0 &&
  slice.species.length === 0 &&
  slice.backgrounds.length === 0 &&
  slice.feats.length === 0 &&
  slice.spells.length === 0 &&
  slice.equipment.length === 0 &&
  slice.monsters.length === 0 &&
  // A spell-list overlay changes spells' `classes`, so a slice holding only lists is not empty.
  slice.spellLists.length === 0;

/** All derived catalog structures for one audience. Homebrew must reach the summaries, record maps and
 *  progression table together, or a homebrew class silently gets SRD defaults. */
function buildCatalogData(homebrew: HomebrewCatalogSlice) {
  const classes = merged(loadClasses(), homebrew.classes);
  const subclasses = merged(loadSubclasses(), homebrew.subclasses);
  const species = merged(loadSpecies(), homebrew.species);
  const backgrounds = merged(loadBackgrounds(), homebrew.backgrounds);
  const feats = merged(loadFeats(), homebrew.feats);
  // The spell-list overlay, applied per audience: stamps each list id into its members' `classes`,
  // which `resolveCatalogChoice("<listId>-spells")` filters on. Only this audience's lists contribute,
  // or a GM-only list's id would leak through a player-visible spell.
  const spells = applySpellListOverlay(merged(loadSpells(), homebrew.spells), homebrew.spellLists);
  const equipment = merged(loadEquipment(), homebrew.equipment);

  const conditionSummaries: readonly ContentConditionSummary[] = loadConditions().map(({ id, name, description }) => ({
    id,
    name,
    description
  }));

  // Skill reference text + the ability each check uses (null only for an unmapped homebrew row).
  const skillSummaries: readonly ContentSkillSummary[] = loadSkills().map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    ability: skill.ability ?? null
  }));

  // The SRD languages, as data so a `languageChoices` budget has a list to offer.
  const languageSummaries: readonly ContentLanguageSummary[] = loadLanguages().map((language) => ({
    id: language.id,
    name: language.name,
    description: language.description,
    table: language.table
  }));

  const spellSummaries: readonly ContentSpellSummary[] = spells
    .map((spell) => ({
      id: spell.id,
      name: spell.name,
      source: spell.source,
      level: spell.level,
      school: spell.school,
      castingTime: spell.castingTime,
      rangeText: spell.range.text,
      componentsText: spellComponentsText(spell.components),
      duration: spell.duration,
      // Facts the `fromPicks` predicates read. Feet only when the printed range is a distance (not Self/Touch).
      attackRoll: spell.attackRoll,
      rangeFeet: spell.range.unit === "feet" || spell.range.unit === "foot" ? spell.range.distance : null,
      concentration: spell.concentration,
      ritual: spell.ritual,
      description: spell.description,
      higherLevel: spell.higherLevel,
      // The spell-list link the builder's spell step filters by, paired with spellcasting.spellListId.
      classes: spell.classes,
      damageRoll: spell.damage.roll,
      damageTypes: spell.damage.types,
      castingOptions: slotCastingOptionsOf(spell.castingOptions),
      cantripScaling: spell.level === 0 ? cantripScalingOf(spell.castingOptions) : []
    }))
    .sort(byName);

  // Mirrors EquipmentReference one-to-one, re-emitted as the transport-owned type.
  const equipmentSummaries: readonly ContentEquipmentSummary[] = equipment.map((item) => ({
    id: item.id,
    name: item.name,
    source: item.source,
    category: item.category,
    costGp: item.costGp,
    weightLb: item.weightLb,
    description: item.description,
    weapon: item.weapon ?? null,
    armor: item.armor ?? null,
    // The template eligibility list, for the base chooser. Printed SRD text plus resolved ids; nothing GM-secret.
    appliesTo: item.appliesTo ?? null,
    // Rarity and attunement are what the printed line in the description already says, so they are public to every
    // reader who receives the item.
    rarity: item.rarity ?? null,
    attunement: item.attunement
      ? { required: item.attunement.required, restrictedTo: [...item.attunement.restrictedTo] }
      : null,
    // The types the GM may pick for its resistance, as printed; the pick itself is the GM's, on the row.
    ...(item.damageTypeChoice ? { damageTypeChoice: [...item.damageTypeChoice] } : {}),
    // The levels a Spell Scroll can bear, as its name says, for the picker's spell step.
    ...(item.spellScroll ? { spellScroll: { ...item.spellScroll } } : {}),
    // A manual's or tome's study, as its text prints it, so the GM's sheet can offer it.
    ...(item.study ? { study: { ...item.study } } : {}),
    // The uses one copy holds (a Healer's Kit's ten), which its row counts down.
    ...(item.uses?.limit !== undefined && item.uses.per === "never" ? { uses: { limit: item.uses.limit } } : {}),
    // The kinds its text lists (an Ioun Stone's stones) or the forms its holder picks (a Rod of Lordly Might's), by
    // name only: what a carried copy is stays on its row.
    ...(item.variants
      ? {
          variants: item.variants.map((variant) => ({ id: variant.id, name: variant.name })),
          variantChoice: {
            by: item.variantChoice?.by ?? ("gm" as const),
            ...(item.variantChoice?.activation ? { activation: item.variantChoice.activation } : {})
          }
        }
      : {}),
    // How it sheds light, as its own text says: whether it is lit on the row, has a hood to lower or a Cone to aim.
    ...(item.light
      ? {
          light: {
            ...(item.light.always ? { always: true as const } : {}),
            ...(item.light.hooded ? { hooded: true as const } : {}),
            ...(item.light.cone ? { cone: true as const } : {})
          }
        }
      : {}),
    // What a container holds, as its text prints it, for the sheet's load and compartments.
    ...(item.container ? { container: containerSummary(item.container) } : {})
  }));

  const monstersById = new Map<string, ActorDefinition>();
  // A monster's `source` is bundle provenance, so where it came from is recorded as it is merged.
  const homebrewMonsterIds = new Set<string>();
  // A stat block's spells become cast actions here, from this audience's spells, so every reader sees them.
  const spellsById = new Map(spells.map((spell) => [spell.id, spell]));
  for (const definition of loadMonsterDefinitions())
    if (definition.source.externalId)
      monstersById.set(
        definition.source.externalId,
        withMonsterSpells(definition, (spellId) => spellsById.get(spellId))
      );
  for (const definition of homebrew.monsters)
    if (definition.source.externalId) {
      homebrewMonsterIds.add(definition.source.externalId);
      monstersById.set(
        definition.source.externalId,
        withMonsterSpells(definition, (spellId) => spellsById.get(spellId))
      );
    }
  const monsterSummaries: readonly ContentMonsterSummary[] = [...monstersById.entries()]
    .map(([id, definition]) => {
      const facts = statblockFacts(definition);
      return {
        id,
        name: definition.name,
        source: homebrewMonsterIds.has(id) ? ("homebrew" as const) : ("srd" as const),
        challengeRating: facts.challengeRating ?? 0,
        experiencePoints: facts.experiencePoints,
        type: facts.creatureType ?? "unknown",
        size: definition.size,
        armorClass: definition.armorClass,
        hitPoints: definition.hitPoints.maximum
      };
    })
    .sort(byName);

  return {
    conditionSummaries,
    conditionIds: new Set(conditionSummaries.map((condition) => condition.id)),
    skillSummaries,
    languageSummaries,
    spellSummaries,
    equipmentSummaries,
    classSummaries: classes.map(classSummaryOf).sort(byName) as readonly ContentClassSummary[],
    subclassSummaries: subclasses.map(subclassSummaryOf).sort(byName) as readonly ContentSubclassSummary[],
    speciesSummaries: species.map(speciesSummaryOf).sort(byName) as readonly ContentSpeciesSummary[],
    backgroundSummaries: backgrounds.map(backgroundSummaryOf).sort(byName) as readonly ContentBackgroundSummary[],
    featSummaries: feats.map(featSummaryOf).sort(byName) as readonly ContentFeatSummary[],
    nameBundles: loadNames().map(nameBundleOf),
    monstersById,
    monsterSummaries,
    // ---------- Server-side assembly indexes (full records, riders included; never on the wire) ----------
    // Authored classes drive the rules math; static SRD rows are the fallback for classes not authored yet.
    progressionTable: progressionTableFromClasses(classes),
    classRecords: new Map(classes.map((entry) => [entry.id, entry])),
    subclassRecords: new Map(subclasses.map((entry) => [entry.id, entry])),
    speciesRecords: new Map(species.map((entry) => [entry.id, entry])),
    backgroundRecords: new Map(backgrounds.map((entry) => [entry.id, entry])),
    featRecords: new Map(feats.map((entry) => [entry.id, entry])),
    featureRecords: featureIndexOf(classes, subclasses, species, backgrounds),
    equipmentRecords: new Map(equipment.map((entry) => [entry.id, entry])),
    spellRecords: new Map(spells.map((entry) => [entry.id, entry]))
  };
}

/** Every feature and inline option keyed by `{kind, sourceId, id}` (ids repeat across classes). First
 *  write wins, so the index is deterministic. */
function featureIndexOf(
  classes: readonly ClassReference[],
  subclasses: readonly SubclassReference[],
  species: readonly SpeciesReference[],
  backgrounds: readonly BackgroundReference[]
): Map<string, FeatureRecord | FeatureOption> {
  const index = new Map<string, FeatureRecord | FeatureOption>();
  const put = (kind: CharacterFeatureRef["kind"], sourceId: string, feature: FeatureRecord) => {
    const key = featureKey({ kind, sourceId, id: feature.id });
    if (!index.has(key)) index.set(key, feature);
    // Inline options use the same rider vocabulary; recorded as kind "option" under the parent feature's id.
    for (const option of feature.choice?.options ?? []) {
      const optionKey = featureKey({ kind: "option", sourceId: feature.id, id: option.id });
      if (!index.has(optionKey)) index.set(optionKey, option);
    }
  };
  for (const entry of classes) for (const feature of entry.features) put("class", entry.id, feature);
  for (const entry of subclasses) for (const feature of entry.features) put("subclass", entry.id, feature);
  for (const entry of species) {
    for (const trait of entry.traits) put("species", entry.id, trait);
    for (const lineage of entry.lineages) for (const trait of lineage.traits) put("lineage", lineage.id, trait);
  }
  for (const entry of backgrounds) for (const feature of entry.features) put("background", entry.id, feature);
  return index;
}

const featureKey = (ref: CharacterFeatureRef) => `${ref.kind} ${ref.sourceId} ${ref.id}`;

type CatalogData = ReturnType<typeof buildCatalogData>;

/** The SRD-only catalog, built once at import. */
const SRD_ONLY_CATALOG: CatalogData = buildCatalogData(EMPTY_HOMEBREW_SLICE);

let summonBlocks: ReadonlyMap<string, ActorDefinition> | null = null;
/** The stat blocks the SRD prints inside its summoning spells, by id: resolved in play, never browsed (`summons.ts`
 *  brings them onto the map, scaled to the cast). */
function summonStatBlocks(): ReadonlyMap<string, ActorDefinition> {
  summonBlocks ??= new Map(
    loadSummonStatBlocks().flatMap((definition) =>
      definition.source.externalId ? [[definition.source.externalId, definition] as const] : []
    )
  );
  return summonBlocks;
}

/** A thin per-audience wrapper over built catalog data; audiences that merge to the same data share it. */
/** The glossary is bundled SRD text alone (no homebrew), so one copy serves every view. */
const glossaryEntries: readonly ContentGlossaryEntry[] = loadGlossary().map(({ id, name, tag, description }) => ({
  id,
  name,
  tag,
  description
}));

function viewOf(audience: ContentAudience, data: CatalogData, attribution: string): ContentView {
  return {
    audience,
    attribution,
    conditionSummaries: () => data.conditionSummaries,
    glossaryEntries: () => glossaryEntries,
    hasCondition: (conditionId) => data.conditionIds.has(conditionId),
    skillSummaries: () => data.skillSummaries,
    languageSummaries: () => data.languageSummaries,
    spellSummaries: () => data.spellSummaries,
    equipmentSummaries: () => data.equipmentSummaries,
    classSummaries: () => data.classSummaries,
    subclassSummaries: () => data.subclassSummaries,
    speciesSummaries: () => data.speciesSummaries,
    backgroundSummaries: () => data.backgroundSummaries,
    featSummaries: () => data.featSummaries,
    nameBundles: () => data.nameBundles,
    monsterSummaries: () => data.monsterSummaries,
    monster: (definitionId) => data.monstersById.get(definitionId),
    monsterActionSummaries: (definitionId) => {
      const definition = data.monstersById.get(definitionId);
      return definition ? actionSummariesOf(definition.actions) : undefined;
    },
    catalogChoiceCatalogs: () => ({
      classes: data.classSummaries,
      subclasses: data.subclassSummaries,
      species: data.speciesSummaries,
      feats: data.featSummaries,
      spells: data.spellSummaries,
      equipment: data.equipmentSummaries,
      skills: data.skillSummaries,
      languages: data.languageSummaries
    }),
    classProgressionTable: () => data.progressionTable,
    classRecord: (id) => data.classRecords.get(id),
    subclassRecord: (id) => data.subclassRecords.get(id),
    speciesRecord: (id) => data.speciesRecords.get(id),
    backgroundRecord: (id) => data.backgroundRecords.get(id),
    featRecord: (id) => data.featRecords.get(id),
    featureRecord: (ref) => data.featureRecords.get(featureKey(ref)),
    equipmentRecord: (id) => data.equipmentRecords.get(id),
    spellRecord: (id) => data.spellRecords.get(id)
  };
}

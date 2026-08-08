import type { CatalogChoiceCatalogs, ContentActionSummary, ContentBackgroundSummary, ContentChoiceList, ContentClassLevelRow, ContentClassSummary, ContentConditionSummary, ContentEquipmentSummary, ContentFeatSummary, ContentFeatureSummary, ContentLanguageSummary, ContentMonsterSummary, ContentNameBundle, ContentSkillSummary, ContentSpeciesSummary, ContentSpellcastingSummary, ContentSpellSummary, ContentStartingEquipmentOption, ContentSubclassSummary } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { progressionTableFromClasses, type ClassProgressionTable } from "@vtt/rules-5e";
import { applySpellListOverlay, featurePicks, loadAttribution, loadBackgrounds, loadClasses, loadConditions, loadEquipment, loadFeats, loadLanguages, loadMonsterDefinitions, loadNames, loadSkills, loadSpecies, loadSpells, loadSubclasses, type BackgroundReference, type ClassLevelRow, type ClassReference, type ContentSpellcasting, type EquipmentReference, type FeatReference, type FeatureRecord, type SpeciesReference, type SpellListReference, type SpellReference, type SubclassReference } from "@vtt/content-srd-5.2.1";
import type { CharacterFeatureRef, FeatureRecordLike } from "./equipment-derivation.js";
import { parseAreaProse } from "./area-targeting.js";

/**
 * Who is reading a catalog. GM-grade principals (a GM session, or the GM's own integration
 * credential) may see homebrew the GM has published but not made player-visible; everyone else
 * sees only player-visible records. There is deliberately NO third "viewer" audience: the public
 * table viewer never reaches a content read at all.
 */
export type ContentAudience = "gm" | "player";

/**
 * Published, non-deleted homebrew records for ONE audience, already parsed into the SAME bundle
 * shapes the SRD uses - one schema per type, shared by bundle and homebrew, never a fork
 * (ADR-0016). The merge below is therefore a concat.
 *
 * DRAFTS ARE ABSENT BY CONSTRUCTION. A draft is in no merged catalog for any audience; it is
 * reachable only through the homebrew router's own GM-only reads. That is the structural half of
 * the visibility guarantee - there is no filter here to forget, because there is no draft here to
 * filter.
 */
export type HomebrewCatalogSlice = Readonly<{
  classes: readonly ClassReference[];
  subclasses: readonly SubclassReference[];
  species: readonly SpeciesReference[];
  backgrounds: readonly BackgroundReference[];
  feats: readonly FeatReference[];
  spells: readonly SpellReference[];
  equipment: readonly EquipmentReference[];
  monsters: readonly ActorDefinition[];
  /** Membership overlays, applied over the generated spell bundle at the merge point - never an edit to it. */
  spellLists: readonly SpellListReference[];
}>;

/** The identity slice: what every catalog reads today, before any homebrew store exists. */
export const EMPTY_HOMEBREW_SLICE: HomebrewCatalogSlice = Object.freeze({
  classes: [], subclasses: [], species: [], backgrounds: [], feats: [], spells: [], equipment: [], monsters: [], spellLists: []
});

/**
 * What `ContentLibrary` needs from the homebrew store - an interface, not the store class, so tests
 * (and this slice, which has no store yet) can supply a fake.
 */
export interface HomebrewContentSource {
  /** In-memory counter, bumped inside every write transaction; -1 until the store's initialize() completes. */
  readonly revision: number;
  /** Published, non-deleted records this audience may browse. Never drafts (see HomebrewCatalogSlice). */
  publishedFor(audience: ContentAudience): HomebrewCatalogSlice;
  /** Any monster row regardless of status/deleted_at - the live-instance escape hatch. See ContentLibrary.monsterForInstance. */
  monsterForInstance(id: string): ActorDefinition | undefined;
}

/**
 * Everything the server reads from the merged catalog, already scoped to one audience. Every
 * accessor on this interface is safe to serve to that audience by construction: the scoping
 * happened once, when the view was built, rather than at each of the several dozen call sites.
 */
export interface ContentView {
  readonly audience: ContentAudience;
  readonly attribution: string;
  conditionSummaries(): readonly ContentConditionSummary[];
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
  /** BROWSE path - honours draft/published/visible/deleted. Play-time lookups use ContentLibrary.monsterForInstance. */
  monster(definitionId: string): ActorDefinition | undefined;
  monsterActionSummaries(definitionId: string): readonly ContentActionSummary[] | undefined;

  // ---------- Character-builder assembly surface (server-side ONLY - riders never reach the wire) ----------

  /** The wire catalogs `resolveCatalogChoice` reads - the server validates character.create choices through the SAME resolver the wizard renders from. */
  catalogChoiceCatalogs(): CatalogChoiceCatalogs;
  /** The rules progression table with every AUTHORED class adapted in (bundle wins; SRD rows remain the fallback for un-authored classes). */
  classProgressionTable(): ClassProgressionTable;
  /** Full bundle records (riders included) for the server-side feature interpreter. Never projected to a client. */
  classRecord(id: string): ClassReference | undefined;
  subclassRecord(id: string): SubclassReference | undefined;
  speciesRecord(id: string): SpeciesReference | undefined;
  backgroundRecord(id: string): BackgroundReference | undefined;
  featRecord(id: string): FeatReference | undefined;
  /** The class/subclass/species/lineage/background feature (or inline option) a sheet's `character.features` entry names - the read that lets a feature's ROLL-TIME riders reach the table. */
  featureRecord(ref: CharacterFeatureRef): FeatureRecordLike | undefined;
  equipmentRecord(id: string): EquipmentReference | undefined;
  spellRecord(id: string): SpellReference | undefined;
}

/**
 * Read-only access to the bundled SRD content - plus any GM homebrew - for command handlers. The
 * bundle is loaded once per process and validated by the content package's own loaders. Clients
 * never import the content package: they receive these wire shapes from the server (ADR-0001/0015).
 *
 * There is deliberately NO defaulted accessor on this class. The only way to read a catalog is
 * `forAudience(audience)` with a REQUIRED argument, so `tsc` enumerates every call site in `src`
 * and the compiler becomes the auditor. A defaulted `audience = "player"` parameter would be safer
 * by default but would still let a new call site silently miss the decision; a required argument
 * cannot be missed. (`apps/server/tsconfig.json` now includes `test` as well, so the compiler
 * enumerates test call sites too - the visibility regression test still enumerates the operations
 * object itself rather than a hand-written list, because that catches a MISSING call, not a wrong one.)
 */
export class ContentLibrary {
  readonly attribution: string;
  private readonly views = new Map<ContentAudience, ContentView>();
  /** Sentinel below every real revision (a store reports -1 while uninitialised), so nothing is ever mistaken for built. */
  private builtAt = -2;

  constructor(private readonly homebrew?: HomebrewContentSource) {
    this.attribution = loadAttribution().attribution;
  }

  /**
   * The merged catalog this audience may read. Cached per audience and rebuilt only when the
   * homebrew store's revision moves - the store is constructed synchronously but initialises
   * asynchronously, so a pre-initialize read builds an SRD-only view (revision -1) and the first
   * read after initialize rebuilds it. No construction-order change is needed anywhere.
   */
  forAudience(audience: ContentAudience): ContentView {
    const revision = this.homebrew?.revision ?? 0;
    if (revision !== this.builtAt) {
      this.views.clear();
      this.builtAt = revision;
    }
    const cached = this.views.get(audience);
    if (cached) return cached;
    const slice = this.homebrew?.publishedFor(audience);
    // No homebrew at all: both audiences read the SAME module-level SRD catalog, so the path every
    // existing table takes costs exactly what it did before homebrew existed.
    const data = slice && !sliceIsEmpty(slice) ? buildCatalogData(slice) : SRD_ONLY_CATALOG;
    const view = viewOf(audience, data, this.attribution);
    this.views.set(audience, view);
    return view;
  }

  /**
   * PLAY-TIME resolution only, and deliberately audience-free: resolves ANY homebrew monster row -
   * draft, unpublished or soft-deleted - so a live actor never loses its actions, typed defences or
   * recharge behaviour mid-fight. Those are all read from the definition per use rather than copied
   * onto the actor, and every one of those call sites returns/skips on `undefined`, so without this
   * carve-out soft-deleting a creature would silently disarm every token of it already on the table.
   *
   * Never use it for browse - browse goes through `forAudience(...).monster(id)`. The bundle is
   * consulted first: a minted homebrew id can never collide with an SRD id, so an id that resolves
   * in the bundle IS the bundle's.
   */
  monsterForInstance(definitionId: string): ActorDefinition | undefined {
    return SRD_ONLY_CATALOG.monstersById.get(definitionId) ?? this.homebrew?.monsterForInstance(definitionId);
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

/** "V, S, M (a pinch of soot)" from the structured components, or "None" for a spell with no components. */
function spellComponentsText(components: SpellReference["components"]): string {
  const parts = [components.verbal ? "V" : null, components.somatic ? "S" : null, components.material ? "M" : null].filter((part): part is string => part !== null);
  const base = parts.join(", ");
  const material = components.material && components.materialText ? ` (${components.materialText})` : "";
  return base ? `${base}${material}` : "None";
}
/** SRD upcast rows are typed "slot_level_N"; keep only those (cantrip character-level scaling is not a cast-at option) and surface the slot level the sheet keys on. */
function slotCastingOptions(options: SpellReference["castingOptions"]): ContentSpellSummary["castingOptions"] {
  return options.flatMap((option) => {
    const match = /^slot_level_(\d+)$/.exec(option.type);
    return match ? [{ level: Number(match[1]), damageRoll: option.damageRoll, targetCount: option.targetCount }] : [];
  });
}

// ---------- Character-builder catalogs ----------
//
// This is THE merge point for builder content, the same role `loadEquipment()` plays for gear: one
// catalog per type, mapped once from the bundle records into the transport-owned wire shapes. GM
// homebrew is another source folded in here (`source: "homebrew"` on the record), never a fork
// (ADR-0016).
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
type WireChoice = NonNullable<ContentFeatureSummary["choice"]>;
/** `{offer, amount}` or `{offer, scaling}` - one of the two, filled out for a wire type that has both. */
const extraPickSummaryOf = (grants: FeatureRecord["extraPicks"]): ContentFeatureSummary["extraPicks"] =>
  grants.map((grant) => ({ offer: grant.offer, amount: grant.amount ?? null, scaling: grant.scaling ?? null }));

const choiceSummaryOf = (choice: FeatureRecord["choice"]): WireChoice | null => choice
  ? {
      kind: choice.kind, choose: choice.choose, from: choice.from ?? [], fromCatalog: choice.fromCatalog ?? null, maxSpellLevel: choice.maxSpellLevel ?? null, minSpellLevel: choice.minSpellLevel ?? null,
      options: (choice.options ?? []).map((option) => {
        // One level of nesting only, matching the schema's own bound: a nested choice cannot itself carry options.
        const nested = featurePicks(option).map((pick) => ({
          kind: pick.kind, choose: pick.choose, from: pick.from ?? [], fromCatalog: pick.fromCatalog ?? null, maxSpellLevel: pick.maxSpellLevel ?? null, minSpellLevel: pick.minSpellLevel ?? null, options: []
        }));
        return {
          id: option.id, name: option.name, description: option.description,
          choice: nested[0] ?? null,
          choices: nested,
          // The budget a CHOSEN option raises. Travels for the same reason its `choice` does: without
          // it the wizard caps the player at the printed level row and the extra pick Thaumaturge
          // promises ("one extra cantrip from the Cleric spell list") cannot be selected at all.
          extraPicks: extraPickSummaryOf(option.extraPicks)
        };
      })
    }
  : null;

const featureSummaryOf = (feature: FeatureRecord, grantedAtLevels: readonly number[] = []): ContentFeatureSummary => {
  // EVERY pick, not just the first: a record may owe several (Magic Initiate's two cantrips AND its
  // level-1 spell), and `choice` is kept as the first so callers that only ever wanted one are unchanged.
  const picks = featurePicks(feature).map((pick) => choiceSummaryOf(pick)!);
  return {
    id: feature.id,
    name: feature.name,
    level: feature.level ?? null,
    description: feature.description,
    tags: feature.tags,
    choice: picks[0] ?? null,
    choices: picks,
    grantedAtLevels,
    extraPicks: extraPickSummaryOf(feature.extraPicks)
  };
};

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

/** The extension key challenge rating and creature type actually live under. */
export const STATBLOCK_EXTENSION = "open5e.srd-2024";
/**
 * A creature's bestiary facts, read from the ONE bag that carries them.
 *
 * Exported because the publish gate must refuse exactly what this function cannot find, and it used
 * to read a different key (`vtt.statblock`) first. That divergence had a name and a symptom: a
 * monster carrying only `vtt.statblock` published clean and then listed as "CR 0 - unknown", which
 * is the precise failure the guard exists to prevent. One reader, both call sites, no drift.
 */
export function statblockFacts(definition: ActorDefinition): { challengeRating: number | null; creatureType: string | null } {
  const extension = (definition.extensions ?? {})[STATBLOCK_EXTENSION];
  const bag = (extension && typeof extension === "object" ? extension : {}) as { challengeRating?: unknown; type?: unknown };
  // Narrowed, not cast: the bag is untyped by design, so a string CR would otherwise reach the wire
  // where `ContentMonsterSummary` declares a number. Null means "the bestiary has nothing to show",
  // which is the exact condition the publish gate refuses.
  return {
    challengeRating: typeof bag.challengeRating === "number" ? bag.challengeRating : null,
    creatureType: typeof bag.type === "string" && bag.type.length > 0 ? bag.type : null
  };
}

/** A bundle "choose N from" list -> the wire shape (null = the record offers no such choice). */
const choiceListOf = (list: Readonly<{ choose: number; from: readonly string[]; fromCatalog?: string }> | undefined): ContentChoiceList | null =>
  list ? { choose: list.choose, from: list.from, fromCatalog: list.fromCatalog ?? null } : null;
/** A class/subclass spellcasting header -> the wire shape. The structured riders stay server-side as ever; this is the caster step's display data plus the spell-list link. */
const spellcastingSummaryOf = (spellcasting: ContentSpellcasting | undefined): ContentSpellcastingSummary | null =>
  spellcasting
    ? { ability: spellcasting.ability, prepares: spellcasting.prepares, ritual: spellcasting.ritual, focus: spellcasting.focus, progression: spellcasting.multiclassProgression, spellListId: spellcasting.spellListId ?? null }
    : null;

const classSummaryOf = (entry: ClassReference): ContentClassSummary => ({
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
});

const subclassSummaryOf = (entry: SubclassReference): ContentSubclassSummary => ({
  id: entry.id, name: entry.name, source: entry.source, classId: entry.classId, summary: entry.summary ?? null, description: entry.description ?? null,
  subclassLevel: entry.subclassLevel ?? null,
  spellcastingAbility: entry.spellcasting?.ability ?? null, spellcastingProgression: entry.spellcasting?.multiclassProgression ?? null,
  spellcasting: spellcastingSummaryOf(entry.spellcasting),
  features: entry.features.map((feature) => featureSummaryOf(feature))
});

// Species traits and lineage traits are the same FeatureRecord shape; the lineage's own traits are
// folded into `features` so a client renders one list (the lineage row keeps its identity for picking).
const speciesSummaryOf = (entry: SpeciesReference): ContentSpeciesSummary => ({
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
});

const backgroundSummaryOf = (entry: BackgroundReference): ContentBackgroundSummary => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  abilityOptions: entry.abilityOptions ? { from: entry.abilityOptions.from, spreads: entry.abilityOptions.spreads } : null,
  originFeatId: entry.originFeatId ?? null,
  skillProficiencies: entry.skillProficiencies, skillChoices: choiceListOf(entry.skillChoices),
  toolProficiencies: entry.toolProficiencies, toolChoices: choiceListOf(entry.toolChoices),
  languages: entry.languages, languageChoices: choiceListOf(entry.languageChoices),
  startingEquipmentOptions: equipmentOptionsOf(entry.startingEquipment),
  features: entry.features.map((feature) => featureSummaryOf(feature))
});

// A feat IS a feature plus catalog metadata - hence the single `feature`, not a list. Prerequisites
// travel as structured data AND prose; the server remains the authority on whether one is met.
const featSummaryOf = (entry: FeatReference): ContentFeatSummary => ({
  id: entry.id, name: entry.name, source: entry.source, summary: entry.summary ?? null, description: entry.description ?? null,
  category: entry.category, repeatable: entry.repeatable,
  prerequisiteLevel: entry.prerequisite?.level ?? null,
  prerequisiteAbilities: entry.prerequisite?.abilityScores ?? [],
  prerequisiteRequires: entry.prerequisite?.requires ?? [],
  prerequisiteText: entry.prerequisite?.text ?? null,
  feature: featureSummaryOf(entry.feature)
});

const nameBundleOf = (entry: ReturnType<typeof loadNames>[number]): ContentNameBundle => ({
  speciesId: entry.speciesId, source: entry.source,
  pools: entry.pools.map((pool) => ({ id: pool.id, label: pool.label, names: pool.names }))
});

/**
 * SRD rows first, this audience's homebrew appended. NEVER mutates a `loadX()` result: the content
 * package caches parsed bundles BY IDENTITY (`loadClasses()` returns the same array object every
 * call, asserted by its own bundle test), so an in-place push would corrupt every later reader.
 */
const merged = <T>(srd: readonly T[], homebrew: readonly T[]): readonly T[] => homebrew.length === 0 ? srd : [...srd, ...homebrew];

const sliceIsEmpty = (slice: HomebrewCatalogSlice): boolean =>
  slice.classes.length === 0 && slice.subclasses.length === 0 && slice.species.length === 0 && slice.backgrounds.length === 0
  && slice.feats.length === 0 && slice.spells.length === 0 && slice.equipment.length === 0 && slice.monsters.length === 0
  // A published spell-list overlay carries no records of its own but DOES change every spell's
  // `classes` array, so a slice holding only lists is not empty. Omitting this line is a silent
  // failure of exactly the kind this module is full of: the list would publish, the GM would see it
  // in the library, and no spell would ever join it.
  && slice.spellLists.length === 0;

/**
 * Every derived catalog structure for one audience's merged content, built once. Homebrew must land
 * in the SUMMARIES, the seven RECORD MAPS and the PROGRESSION TABLE together: the progression table
 * is derived from the class list independently of the summaries, so a merge that touched only the
 * summary path would produce a class the wizard displays and the builder accepts but whose hit die,
 * ASI levels and caster progression silently came from the SRD defaults (d8 / none / 4-8-12-16) -
 * wrong numbers, not errors. That is known-bugs M2 reintroduced at a different seam.
 */
function buildCatalogData(homebrew: HomebrewCatalogSlice) {
  const classes = merged(loadClasses(), homebrew.classes);
  const subclasses = merged(loadSubclasses(), homebrew.subclasses);
  const species = merged(loadSpecies(), homebrew.species);
  const backgrounds = merged(loadBackgrounds(), homebrew.backgrounds);
  const feats = merged(loadFeats(), homebrew.feats);
  /**
   * The spell-list overlay is applied HERE, once, PER AUDIENCE - the single line that makes a
   * homebrew spell list real. `spells.v1.json` is generated from vendored CC-BY fixtures, so
   * membership can never be an edit to the bundle; a `SpellListReference` declares membership and
   * this fold stamps the list id into each member's `classes` array, which is exactly what
   * `resolveCatalogChoice("<listId>-spells")` already filters on. Nothing downstream learns that
   * overlays exist.
   *
   * PER AUDIENCE IS LOAD-BEARING: only lists in THIS audience's slice contribute. A GM-only list
   * stamping its id into a player-visible spell would leak the list's existence and its id through
   * `/v1/content/spells` - the same leak class as serving the record itself, one indirection away.
   */
  const spells = applySpellListOverlay(merged(loadSpells(), homebrew.spells), homebrew.spellLists);
  const equipment = merged(loadEquipment(), homebrew.equipment);

  const conditionSummaries: readonly ContentConditionSummary[] = loadConditions().map(({ id, name, description }) => ({ id, name, description }));

  // Skill catalog: reference text + the ability each check uses (the content loader fills the SRD
  // mapping when the bundle row predates the ability column, so `ability` is null only for a genuinely
  // unmapped homebrew row). This endpoint is what retires the client's hardcoded SKILL_ABILITY table.
  const skillSummaries: readonly ContentSkillSummary[] = loadSkills().map((skill) => ({
    id: skill.id, name: skill.name, description: skill.description, ability: skill.ability ?? null
  }));

  // The 19 SRD languages with the table each is printed in. Published as DATA (not prose in the
  // rules text) because a `languageChoices` budget needs a list: without one, "Common plus two
  // languages" - owed to every character by Character Creation - was never offered to anybody.
  const languageSummaries: readonly ContentLanguageSummary[] = loadLanguages().map((language) => ({
    id: language.id, name: language.name, description: language.description, table: language.table
  }));

  const spellSummaries: readonly ContentSpellSummary[] = spells
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
    .sort(byName);

  // The wire shape mirrors EquipmentReference one-to-one (the content package already folds weapons/armor
  // in and sorts by name), so the server just re-emits it as the transport-owned type.
  const equipmentSummaries: readonly ContentEquipmentSummary[] = equipment.map((item) => ({
    id: item.id, name: item.name, category: item.category, costGp: item.costGp, weightLb: item.weightLb, description: item.description,
    weapon: item.weapon ?? null, armor: item.armor ?? null
  }));

  const monstersById = new Map<string, ActorDefinition>();
  for (const definition of merged(loadMonsterDefinitions(), homebrew.monsters)) {
    if (definition.source.externalId) monstersById.set(definition.source.externalId, definition);
  }
  const monsterSummaries: readonly ContentMonsterSummary[] = [...monstersById.entries()]
    .map(([id, definition]) => {
      const facts = statblockFacts(definition);
      return {
        id,
        name: definition.name,
        challengeRating: facts.challengeRating ?? 0,
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
    // ---------- Server-side assembly indexes (full records, riders included - never on the wire) ----------
    // The bundle-driven progression table: authored classes drive the rules math through the adapter,
    // with the static SRD rows remaining the fallback for classes not authored yet (known-bugs M2 -
    // a homebrew or authored class must never silently fall back to d8/none/4-8-12-16 defaults).
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

/**
 * Every class / subclass / species / lineage / background FEATURE, plus every inline choice OPTION,
 * addressable by the `{kind, sourceId, id}` triple a sheet's `character.features` records (issue
 * `2e` - a feature's 13 roll-time riders reach the table only if the sheet can name the record).
 *
 * KEYED ON ALL THREE, not on the id. A bare id is genuinely ambiguous in the bundled SRD alone:
 * `unarmored-defense` is both a Barbarian and a Monk feature and the two differ mechanically,
 * `weapon-mastery` belongs to five classes, `spellcasting` to seven, `epic-boon` to all twelve.
 * An id-keyed map would hand a Monk the Barbarian's riders - silently, and only sometimes.
 *
 * First write wins on a duplicate key, so the index is deterministic whatever order homebrew merges
 * in; an exact triple collision would mean two records claiming the same identity, which the
 * homebrew id rules already prevent.
 */
function featureIndexOf(
  classes: readonly ClassReference[], subclasses: readonly SubclassReference[],
  species: readonly SpeciesReference[], backgrounds: readonly BackgroundReference[]
): Map<string, FeatureRecordLike> {
  const index = new Map<string, FeatureRecordLike>();
  const put = (kind: CharacterFeatureRef["kind"], sourceId: string, feature: FeatureRecord) => {
    const key = featureKey({ kind, sourceId, id: feature.id });
    if (!index.has(key)) index.set(key, feature as FeatureRecordLike);
    // A feature's inline options carry the identical `featureRiders` vocabulary and are chosen the
    // same way; the builder records them as kind "option" under their PARENT FEATURE's id.
    for (const option of feature.choice?.options ?? []) {
      const optionKey = featureKey({ kind: "option", sourceId: feature.id, id: option.id });
      if (!index.has(optionKey)) index.set(optionKey, option as unknown as FeatureRecordLike);
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

/** The one catalog every table reads today: SRD only, built once at import exactly as before. */
const SRD_ONLY_CATALOG: CatalogData = buildCatalogData(EMPTY_HOMEBREW_SLICE);

/** A thin per-audience wrapper over already-built catalog data - the data is what costs, so audiences that merge to the same thing share it. */
function viewOf(audience: ContentAudience, data: CatalogData, attribution: string): ContentView {
  return {
    audience,
    attribution,
    conditionSummaries: () => data.conditionSummaries,
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
    monsterActionSummaries: (definitionId) => data.monstersById.get(definitionId)?.actions.map(actionSummaryOf),
    catalogChoiceCatalogs: () => ({ classes: data.classSummaries, subclasses: data.subclassSummaries, species: data.speciesSummaries, feats: data.featSummaries, spells: data.spellSummaries, equipment: data.equipmentSummaries, skills: data.skillSummaries, languages: data.languageSummaries }),
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

import type { HomebrewContentType, HomebrewValidationIssue, HomebrewValidity } from "@vtt/api-contract";
import { CatalogChoiceError, resolveCatalogChoice, withArticle, type CatalogChoiceCatalogs } from "@vtt/domain";
import {
  DAMAGE_ROLL_MOMENTS,
  HEALING_MOMENTS,
  RIDER_TRIGGER_KINDS,
  type ActorDefinition,
  type Modifier
} from "@vtt/schemas";
import {
  CONDITION_IDS,
  DAMAGE_TYPE_IDS,
  featurePicks,
  HOMEBREW_BODY_SCHEMAS,
  resolveSpellLists,
  spellListMemberIds,
  type BackgroundReference,
  type ClassReference,
  type ContentSpellcasting,
  type EquipmentReference,
  type FeatReference,
  type FeatureChoice,
  type FeatureOption,
  type FeatureOptionChoice,
  type FeatureRecord,
  type SpeciesReference,
  type SpellListReference,
  type SpellReference,
  type SubclassReference
} from "@vtt/content-srd-5.2.1";
import type { ContentLibrary, ContentView } from "./content-library.js";
import { STATBLOCK_EXTENSION, statblockFacts } from "./statblock-facts.js";
import { homebrewIdProblem } from "./homebrew-ids.js";
import { sliceReplacing, type HomebrewAuthoredIndex, type HomebrewBody, type HomebrewStore } from "./homebrew-store.js";
import { plainSchemaIssue } from "@vtt/content-srd-5.2.1/homebrew-issues";

/**
 * The publish gate: runs only on Publish (drafts may be invalid) and returns field paths plus messages. Most
 * homebrew mistakes otherwise fail silently in play. Tiers run in order, each only if the last passed:
 * 1. the record's own Zod schema; 2. identity (`hb-`, length, slug, opaque monsters); 3. referential (names
 * resolve; class/subclass rules ask only whether the partner is authored); 4. unsupported-but-parsing shapes.
 * Every message is a sentence a GM reads (`homebrew-issues.ts` in the content package turns the schema's findings into one): records are
 * named, and no id, slug or schema word reaches the GM.
 */

export type HomebrewValidationContext = Readonly<{
  /** The merged GM catalog: already spell-list-overlaid, so `spellSummaries()` carries real membership. */
  catalog: ContentView;
  /** Published spell-list overlays, so a list under validation resolves in the graph it will join. */
  spellLists: readonly SpellListReference[];
  /** Required so no caller can reintroduce the class/subclass publish deadlock. */
  authored: HomebrewAuthoredIndex;
}>;

type Issue = HomebrewValidationIssue;
type Path = (string | number)[];
type Add = (path: Path, message: string) => void;
/** Named record header shared by every authorable type, so messages can say which record is wrong. */
type Owner = Readonly<{ id: string; name: string }>;

/** Self-derived slugs name this unpublished record, so they are answered from the record or the authorship index. */
type SelfCatalog = Readonly<{ slug: string; count: number; whenEmpty: string }> | undefined;

/** The context plus the two things worth resolving once per record, so no check repeats them. */
type Checks = Readonly<{
  catalog: ContentView;
  spellLists: readonly SpellListReference[];
  authored: HomebrewAuthoredIndex;
  catalogs: CatalogChoiceCatalogs;
  add: Add;
}>;

/** The same schemas the bundle is parsed through (ADR-0016); `satisfies` keeps the two type vocabularies aligned. */
const SCHEMAS = HOMEBREW_BODY_SCHEMAS satisfies Record<
  HomebrewContentType,
  {
    safeParse: (value: unknown) => { success: boolean };
  }
> as Record<
  HomebrewContentType,
  {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: unknown;
      error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
    };
  }
>;

/** `recordId` is on every issue because pack import reports many records at once; single publishes pass null. */
export function validateForPublish(
  type: HomebrewContentType,
  body: unknown,
  context: HomebrewValidationContext,
  recordId: string | null = null
): HomebrewValidity {
  const issues: Issue[] = [];
  const add: Add = (path, message) => {
    issues.push({ path, message, recordId });
  };

  // Tier 1: the record's own schema.
  const parsed = SCHEMAS[type].safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error?.issues ?? []) issues.push(plainSchemaIssue(issue, body, recordId));
    return { valid: false, issues, warnings: [] };
  }

  // Tier 2: identity. Read the id from the raw body: `ActorDefinitionSchema` strips `id`.
  const id = idOf(body);
  if (homebrewIdProblem(id, type))
    add(["id"], "This record's id can't be used here. Make a copy of the record, which gets a new id.");

  // Tiers 3 and 4, per type.
  const checks: Checks = {
    catalog: context.catalog,
    spellLists: context.spellLists,
    authored: context.authored,
    catalogs: context.catalog.catalogChoiceCatalogs(),
    add
  };
  const record = parsed.data;
  switch (type) {
    case "class":
      classIssues(record as ClassReference, checks);
      break;
    case "subclass":
      subclassIssues(record as SubclassReference, checks);
      break;
    case "species":
      speciesIssues(record as SpeciesReference, checks);
      break;
    case "background":
      backgroundIssues(record as BackgroundReference, checks);
      break;
    case "feat":
      featIssues(record as FeatReference, checks);
      break;
    case "monster":
      monsterIssues(record as ActorDefinition, id, checks);
      break;
    case "spell-list":
      spellListIssues(record as SpellListReference, checks);
      break;
    // `SpellReference.classes` entries are open membership tags; a priced material may name gear.
    case "spell":
      spellIssues(record as SpellReference, checks);
      break;
    case "equipment":
      equipmentIssues(record as EquipmentReference, checks);
      break;
  }

  return { valid: issues.length === 0, issues, warnings: slugWarnings(record, recordId) };
}

const SRD_DAMAGE_TYPES: ReadonlySet<string> = new Set(DAMAGE_TYPE_IDS);
const SRD_CONDITIONS: ReadonlySet<string> = new Set(CONDITION_IDS);
const DAMAGE_TYPE_LISTS: ReadonlySet<string> = new Set([
  "damageResistances",
  "damageImmunities",
  "damageVulnerabilities"
]);

/**
 * Damage-type and condition slugs the SRD does not know. The columns are open, so a homebrew "void" damage type
 * is legal and publishes, but a typo ("fier") would match nothing at the table, so the GM gets a warning.
 * Walks the parsed record by key, which reaches every grant list, action damage part and on-hit
 * condition whatever the record type.
 */
function slugWarnings(record: unknown, recordId: string | null): Issue[] {
  const warnings: Issue[] = [];
  const check = (slug: unknown, path: Path, known: ReadonlySet<string>, kind: string) => {
    if (typeof slug !== "string" || known.has(slug.trim().toLowerCase())) return;
    warnings.push({
      path,
      recordId,
      message: `${capitalisedWord(slug)} is not an SRD ${kind}. It still publishes, but it matches only ${withArticle(kind)} spelled exactly the same way, so check the spelling.`
    });
  };
  const walk = (node: unknown, path: Path): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const at = [...path, key];
      if (DAMAGE_TYPE_LISTS.has(key) && Array.isArray(value))
        value.forEach((slug, index) => check(slug, [...at, index], SRD_DAMAGE_TYPES, "damage type"));
      else if (key === "conditionImmunities" && Array.isArray(value))
        value.forEach((slug, index) => check(slug, [...at, index], SRD_CONDITIONS, "condition"));
      // An action's damage parts ({formula, type}) and a spell's damage block ({roll, types}).
      else if (key === "damage" && Array.isArray(value))
        value.forEach((part, index) => {
          if (part && typeof part === "object" && "formula" in part)
            check((part as { type?: unknown }).type, [...at, index, "type"], SRD_DAMAGE_TYPES, "damage type");
        });
      else if (
        key === "damage" &&
        value &&
        typeof value === "object" &&
        Array.isArray((value as { types?: unknown }).types)
      )
        (value as { types: unknown[] }).types.forEach((slug, index) =>
          check(slug, [...at, "types", index], SRD_DAMAGE_TYPES, "damage type")
        );
      // An on-hit rider's conditions ({id, level?}).
      else if (key === "conditions" && Array.isArray(value))
        value.forEach((entry, index) => {
          if (entry && typeof entry === "object" && "id" in entry)
            check((entry as { id?: unknown }).id, [...at, index, "id"], SRD_CONDITIONS, "condition");
        });
      walk(value, at);
    }
  };
  walk(record, []);
  return warnings;
}

/** An open slug as a word in a sentence: "void" reads "Void", "storm-ash" reads "Storm ash". */
function capitalisedWord(slug: string): string {
  const words = slug.trim().replace(/-/g, " ");
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : words;
}

/** A record's name for a message, from the catalog, or what to call it when the id names nothing. */
function nameOf(checks: Checks, id: string, fallback: string): string {
  return (
    checks.catalog.equipmentRecord(id)?.name ??
    checks.catalog.spellRecord(id)?.name ??
    checks.catalog.classRecord(id)?.name ??
    checks.spellLists.find((list) => list.id === id)?.name ??
    fallback
  );
}

/** The record's identity as stored: `normalizeBody` forces `body.id` to the row's primary key. */
function idOf(body: unknown): string {
  const value = (body as { id?: unknown } | null)?.id;
  return typeof value === "string" ? value : "";
}

// Per-type checks

function classIssues(entry: ClassReference, checks: Checks) {
  spellcastingIssues(entry.spellcasting, entry, ["spellcasting"], checks);
  // Only the level table knows a feature repeats; capacity is `choose x (times granted)`.
  const grants = new Map<string, number>();
  for (const row of entry.levelTable)
    for (const featureId of row.features) grants.set(featureId, (grants.get(featureId) ?? 0) + 1);
  // Published subclasses plus authored drafts: a subclass must exist, published or not.
  const subclassIds = new Set([
    ...checks.catalog
      .subclassSummaries()
      .filter((summary) => summary.classId === entry.id)
      .map((summary) => summary.id),
    ...checks.authored.subclassIdsFor(entry.id)
  ]);
  const self: SelfCatalog = {
    slug: `${entry.id}-subclasses`,
    count: subclassIds.size,
    whenEmpty: `no subclass belongs to ${entry.name} yet. Make one first: a copy of an SRD subclass with this class picked is the quick way. It has to exist, published or not.`
  };
  entry.features.forEach((feature, index) => {
    const granted = grants.get(feature.id) ?? 0;
    // A choice-bearing feature no level grants makes an uncreatable character: the wizard offers the
    // pick, but `grantedClassFeatures` builds offers from the level table alone and Create then fails.
    if (featurePicks(feature).length > 0 && granted === 0) {
      checks.add(
        ["features", index],
        `${feature.name} asks the player to choose, but no level in the level table grants it, so the character builder would offer the pick and then refuse to make the character. Add ${feature.name} to a level, or remove its choice.`
      );
      return;
    }
    featureIssues(feature, ["features", index], checks, granted, self);
  });
  startingEquipmentIssues(entry.startingEquipment, ["startingEquipment"], checks);
  if (entry.skillChoices.from.length < entry.skillChoices.choose) {
    checks.add(
      ["skillChoices", "from"],
      `${entry.name} asks for ${entry.skillChoices.choose} skills but offers only ${entry.skillChoices.from.length}.`
    );
  }
  slotIssues(entry, checks);
}

/**
 * A class that casts spells must give spell slots (or pact slots) from level 1, as every SRD caster does, or the
 * builder makes a caster with nothing to cast with. A full caster picked on a blank class used to leave every row empty.
 */
function slotIssues(entry: ClassReference, checks: Checks) {
  if (!entry.spellcasting) return;
  const index = entry.levelTable.findIndex((row) => row.level === 1);
  const first = index >= 0 ? entry.levelTable[index] : undefined;
  const hasSlots = (first?.spellSlots ?? []).some((count) => count > 0) || first?.pactSlots !== undefined;
  if (!hasSlots)
    checks.add(
      ["levelTable", Math.max(0, index), "spellSlots"],
      `${entry.name} casts spells, but its level 1 row gives no spell slots. Fill in the slots, or pick how it casts again.`
    );
}

function subclassIssues(entry: SubclassReference, checks: Checks) {
  const parent = checks.catalog.classRecord(entry.classId);
  // Authored is enough (a published subclass of a draft class is inert); a class id that names nothing is refused.
  if (!parent && !checks.authored.has("class", entry.classId)) {
    checks.add(
      ["classId"],
      `The class ${entry.name} belongs to is not in this table. Make that class first (it can stay a draft), or pick another one.`
    );
  } else if (!parent && entry.spellcasting) {
    // The check below needs the class's level table, which only a published class has here.
    checks.add(
      ["spellcasting"],
      `A spellcasting subclass is checked against its class's spell slots, and the class ${entry.name} belongs to is still a draft. Publish the class first. Its subclasses can stay drafts.`
    );
  } else if (parent && entry.spellcasting) {
    // A subclass's own `levelTable` is not applied yet, so it cannot give a non-caster class spell slots.
    const classCasts = parent.levelTable.some(
      (row) => (row.spellSlots?.length ?? 0) > 0 || row.pactSlots !== undefined
    );
    if (!classCasts) {
      checks.add(
        ["spellcasting"],
        `${parent.name} has no spell slots in its level table, and a subclass's own table is not used yet, so ${entry.name} would make a caster with no slots. Subclasses that add spellcasting to a class without it are not supported yet.`
      );
    }
  }
  spellcastingIssues(entry.spellcasting, entry, ["spellcasting"], checks);
  entry.features.forEach((feature, index) => featureIssues(feature, ["features", index], checks, 1));
}

function speciesIssues(entry: SpeciesReference, checks: Checks) {
  const seen = new Set<string>();
  entry.lineages.forEach((lineage, index) => {
    if (seen.has(lineage.id))
      checks.add(
        ["lineages", index, "id"],
        `Two lineages of ${entry.name} share one id, so only the first would ever be granted. Give ${lineage.name} its own.`
      );
    seen.add(lineage.id);
    // Lineage traits are flattened untagged, so a choice there would be offered for every lineage.
    lineage.traits.forEach((trait, traitIndex) => {
      if (featurePicks(trait).length > 0)
        checks.add(
          ["lineages", index, "traits", traitIndex, "choice"],
          `${trait.name} asks the player to choose from inside a lineage. Lineage traits cannot carry choices yet. Move the choice up to a species trait.`
        );
    });
  });

  const self: SelfCatalog = {
    slug: `${entry.id}-lineages`,
    count: entry.lineages.length,
    whenEmpty: `${entry.name} asks for a lineage but has none. Add the lineages.`
  };
  entry.traits.forEach((trait, index) => {
    featureIssues(trait, ["traits", index], checks, 1, self);
    const plural = (trait.choices?.length ?? 0) > 0;
    featurePicks(trait).forEach((choice, pickIndex) => {
      const pickPath: Path = plural ? ["traits", index, "choices", pickIndex] : ["traits", index, "choice"];
      if (choice.fromCatalog !== `${entry.id}-lineages` && choice.kind !== "lineage") return;
      // The build finds the chosen lineage by the literal kind "lineage"; any other kind never grants its traits.
      if (choice.kind !== "lineage")
        checks.add(
          [...pickPath, "kind"],
          `${trait.name} picks a lineage, so mark its choice as a lineage choice, or the chosen lineage's traits are never granted.`
        );
      if (choice.fromCatalog !== `${entry.id}-lineages`)
        checks.add(
          [...pickPath, "fromCatalog"],
          `${trait.name} picks a lineage, so its options must be the lineages of ${entry.name}.`
        );
    });
  });
}

function backgroundIssues(entry: BackgroundReference, checks: Checks) {
  // Otherwise this only fails inside `character-build.ts`, deep in the wizard.
  if (entry.originFeatId && !checks.catalog.featRecord(entry.originFeatId)) {
    checks.add(
      ["originFeatId"],
      `The origin feat of ${entry.name} is not published in this table. Publish the origin feat before the background that grants it.`
    );
  }
  entry.features.forEach((feature, index) => featureIssues(feature, ["features", index], checks, 1));
  startingEquipmentIssues(entry.startingEquipment, ["startingEquipment"], checks);
}

function featIssues(entry: FeatReference, checks: Checks) {
  featureIssues(entry.feature, ["feature"], checks, 1);
}

function monsterIssues(definition: ActorDefinition, id: string, checks: Checks) {
  definition.actions.forEach((action, index) =>
    riderIssues(action.grants?.modifiers, ["actions", index, "grants", "modifiers"], action.name, checks)
  );
  if (definition.schemaId !== "vtt.actor-monster") {
    checks.add(["schemaId"], `${definition.name} is not a monster stat block. Make it from New homebrew as a monster.`);
  }
  // `source.externalId` becomes `Actor.definitionId`; the store forces it, so a mismatch means a bypassed store.
  if (definition.source.externalId !== id) {
    checks.add(
      ["source", "externalId"],
      `${definition.name} names a different record than its own, so its tokens on the map would find no stat block. Make a copy of it, which sets this right.`
    );
  }
  // Uses the bestiary's own `statblockFacts`, so the guard cannot pass what the list would show as "CR 0 unknown".
  const facts = statblockFacts(definition);
  if (facts.challengeRating === null)
    checks.add(
      ["extensions", STATBLOCK_EXTENSION, "challengeRating"],
      `${definition.name} has no challenge rating, so the bestiary would list it as CR 0. Pick its challenge rating.`
    );
  if (facts.creatureType === null)
    checks.add(
      ["extensions", STATBLOCK_EXTENSION, "type"],
      `${definition.name} has no creature type, so the bestiary would list it with none and a search by type would never find it. Pick its creature type.`
    );
}

/** A template's `appliesTo.baseIds` must resolve to items with the stats the bind copies (weapon or armor), or to
 *  the kinds of ammunition a piece of magic ammunition can be. */
/** A priced or consumed material that names gear must name gear the catalog holds, or no carried item would be it
 *  (a name it matches still could). */
function spellIssues(spell: SpellReference, checks: Checks) {
  (spell.components.costly ?? []).forEach((material, row) =>
    (material.itemIds ?? []).forEach((itemId, index) => {
      if (checks.catalog.equipmentRecord(itemId) === undefined)
        checks.add(
          ["components", "costly", row, "itemIds", index],
          `${spell.name}'s material ${material.name} names an item this table doesn't have. Pick one from the equipment list, or leave the items out and let its name match what a character carries.`
        );
    })
  );
}

function equipmentIssues(item: EquipmentReference, checks: Checks) {
  riderBlockIssues(item, [], item.name, checks);
  // An item's riders reach the sheet through equipment derivation, which has no arm for granted spells.
  if ((item.grants?.spells ?? []).length > 0)
    checks.add(
      ["grants", "spells"],
      `${item.name} grants spells, but an item's granted spells never reach a sheet. List them under Spells it casts, which the sheet can cast from.`
    );
  const appliesTo = item.appliesTo;
  if (!appliesTo) return;
  if (item.category === "ammunition") {
    appliesTo.baseIds.forEach((baseId, index) => {
      if (checks.catalog.equipmentRecord(baseId)?.ammunition === undefined)
        checks.add(
          ["appliesTo", "baseIds", index],
          `${nameOf(checks, baseId, "One of the items it applies to")} is not a kind of ammunition, such as Arrows or Crossbow Bolts, so ${item.name} could never be made from it.`
        );
    });
    return;
  }
  if (item.category !== "weapon" && item.category !== "armor") {
    checks.add(
      ["appliesTo"],
      `${item.name} lists items it applies to, so its category must be weapon, armor or ammunition, since those are what it can be made from.`
    );
    return;
  }
  if (item.category === "weapon" ? item.weapon != null : item.armor != null) {
    checks.add(
      ["appliesTo"],
      `${item.name} has both its own ${item.category} stats and a list of items it applies to. Give it one of the two. Its own stats make it one ${item.category}, and the list takes its stats from the item the player picks.`
    );
  }
  const summaries = checks.catalog.equipmentSummaries();
  appliesTo.baseIds.forEach((baseId, index) => {
    const base = summaries.find((entry) => entry.id === baseId);
    if (!base) {
      checks.add(
        ["appliesTo", "baseIds", index],
        `One of the items ${item.name} applies to is not in this table, so it could never be made from it. Pick a ${item.category} from the list, or publish that item first.`
      );
      return;
    }
    // A shield's armor block holds its +2 as acBase, so binding a template to it would set AC to 2.
    if (item.category === "armor" && base.category === "shield") {
      checks.add(
        ["appliesTo", "baseIds", index],
        `${base.name} is a Shield, and a Shield can't be one of the items ${item.name} applies to, since its +2 would replace the armor's Armor Class. Make the magic Shield an item of its own.`
      );
      return;
    }
    if (item.category === "weapon" ? !base.weapon : !base.armor) {
      checks.add(
        ["appliesTo", "baseIds", index],
        `${base.name} has no ${item.category} stats to copy, so ${item.name} could never be made from it.`
      );
    }
  });
}

function spellListIssues(list: SpellListReference, checks: Checks) {
  const spells = checks.catalog.spellSummaries();
  // Resolve alongside the published lists: `basedOn` may name a peer.
  const peers = [list, ...checks.spellLists.filter((other) => other.id !== list.id)];
  const resolution = resolveSpellLists(peers, spells);
  if (resolution.cyclicListIds.includes(list.id)) {
    checks.add(
      ["basedOn"],
      `The lists ${list.name} starts from lead back to ${list.name} itself, so none of them count. Remove one of them.`
    );
  }
  list.basedOn.forEach((base, index) => {
    if (resolution.unknownBasedOn.includes(base))
      checks.add(
        ["basedOn", index],
        `${nameOf(checks, base, "One of the lists it starts from")} has no spells, so starting ${list.name} from it adds none.`
      );
  });
  // `resolveCatalogChoice` refuses an empty option set, so a caster on an empty list cannot be created.
  if ((resolution.memberIds.get(list.id)?.size ?? 0) === 0) {
    checks.add(
      ["add"],
      `${list.name} has no spells, and a caster on an empty list can't be made at all. Add spells, or start it from another list.`
    );
  }
}

// Shared checks

/** A caster must name a non-empty spell list; unset, the build falls back to `<classId>-spells` and fails. */
function spellcastingIssues(spellcasting: ContentSpellcasting | undefined, owner: Owner, path: Path, checks: Checks) {
  if (!spellcasting) return;
  const listId = spellcasting.spellListId;
  if (!listId) {
    checks.add(
      [...path, "spellListId"],
      `${owner.name} casts spells but has no spell list, so the builder would find no spells. Pick a spell list, such as the Wizard's, or publish one.`
    );
    return;
  }
  // `spellSummaries()` is already overlaid with published lists, so it matches what the build will resolve.
  const members = spellListMemberIds(listId, checks.spellLists, checks.catalog.spellSummaries());
  if (members.size === 0) {
    checks.add(
      [...path, "spellListId"],
      `${nameOf(checks, listId, "The spell list it uses")} has no spells in this table, so a character of ${owner.name} couldn't be made at all. Publish the spell list and its spells first.`
    );
  }
}

/** Every `fromCatalog` slug a feature or one of its inline options names must resolve to a non-empty
    list. Paths name the spelling the record used (`choice` or `choices[i]`). */
function featureIssues(
  feature: FeatureRecord,
  path: Path,
  checks: Checks,
  grants: number,
  self: SelfCatalog = undefined
) {
  const plural = (feature.choices?.length ?? 0) > 0;
  featurePicks(feature).forEach((pick, pickIndex) => {
    const pickPath: Path = plural ? [...path, "choices", pickIndex] : [...path, "choice"];
    choiceIssues(pick, pickPath, feature.name, checks, grants, self);
    (pick.options ?? []).forEach((option, index) => {
      const optionPlural = (option.choices?.length ?? 0) > 0;
      featurePicks(option).forEach((nested, nestedIndex) => {
        choiceIssues(
          nested,
          optionPlural
            ? [...pickPath, "options", index, "choices", nestedIndex]
            : [...pickPath, "options", index, "choice"],
          `${option.name} (${feature.name})`,
          checks,
          grants,
          self
        );
      });
      riderBlockIssues(option, [...pickPath, "options", index], `${option.name} (${feature.name})`, checks);
    });
  });
  riderBlockIssues(feature, path, feature.name, checks);
}

/** The modifiers a rider block carries: its own, its effects', and the effects its actions grant. */
function riderBlockIssues(
  block: FeatureRecord | FeatureOption | EquipmentReference,
  path: Path,
  label: string,
  checks: Checks
) {
  riderIssues(block.modifiers, [...path, "modifiers"], label, checks);
  block.effects.forEach((effect, index) =>
    riderIssues(effect.modifiers, [...path, "effects", index, "modifiers"], label, checks)
  );
  block.actions.forEach((action, index) =>
    riderIssues(action.grants?.modifiers, [...path, "actions", index, "grants", "modifiers"], label, checks)
  );
  // An item's kinds carry riders of their own (an Ioun Stone's stones).
  if ("variants" in block)
    (block.variants ?? []).forEach((variant, index) => {
      const at: Path = [...path, "variants", index];
      const named = `${variant.name} (${label})`;
      riderIssues(variant.modifiers, [...at, "modifiers"], named, checks);
      variant.effects.forEach((effect, effectIndex) =>
        riderIssues(effect.modifiers, [...at, "effects", effectIndex, "modifiers"], named, checks)
      );
      variant.actions.forEach((action, actionIndex) =>
        riderIssues(action.grants?.modifiers, [...at, "actions", actionIndex, "grants", "modifiers"], named, checks)
      );
    });
}

/** The moments each reader collects, for the modifiers whose reader is narrower than the vocabulary: a damage
 *  rider fires only inside the damage roll, and a defence is read standing. A gate on any other moment would
 *  publish and then never apply. */
const MOMENTS_READ: Partial<Record<Modifier["type"], readonly string[]>> = {
  "damage-bonus": DAMAGE_ROLL_MOMENTS,
  "extra-damage": DAMAGE_ROLL_MOMENTS,
  "damage-die-minimum": DAMAGE_ROLL_MOMENTS,
  "damage-resistance": [],
  "damage-vulnerability": [],
  "damage-immunity": [],
  "ignores-resistance": [],
  "advantage-denied": [],
  "ability-score-minimum": [],
  "base-armor-class": [],
  "speed-minimum": [],
  "ignores-cover": ["on-attack-roll"],
  "no-critical-hits": ["on-attack-roll"],
  "healing-received-maximized": [],
  "healing-dice-maximized": HEALING_MOMENTS,
  "healing-bonus": HEALING_MOMENTS,
  "d20-minimum": ["on-ability-check", "on-saving-throw"],
  "total-minimum": ["on-ability-check", "on-saving-throw"],
  "damage-reduction": ["on-taking-damage"]
};

/** A moment in the words the publish gate uses. */
const MOMENT_WORDS: Readonly<Record<string, string>> = {
  "on-ability-check": "on an ability check",
  "on-saving-throw": "on a saving throw",
  "on-healing": "when the bearer heals",
  "on-taking-damage": "when the bearer takes damage"
};

/** Riders that parse but would never take effect. Checked here because Zod cannot refine inside a
 *  discriminated union. */
function riderIssues(modifiers: readonly Modifier[] | undefined, path: Path, label: string, checks: Checks) {
  (modifiers ?? []).forEach((modifier, index) => {
    const read = MOMENTS_READ[modifier.type];
    const moment = (modifier.when ?? []).find((trigger) => RIDER_TRIGGER_KINDS[trigger.type] === "moment")?.type;
    if (read !== undefined && moment !== undefined && !read.includes(moment)) {
      checks.add(
        [...path, index],
        read.length === 0
          ? `A modifier of ${label} waits for a moment in a roll, but a defence is read before any roll, so it would never apply. Remove the moment, or make it depend on a state, such as an effect or a condition.`
          : read === DAMAGE_ROLL_MOMENTS
            ? `A damage modifier of ${label} waits for a moment the damage roll never reaches, so it would add nothing. Make it apply on a hit or on the damage roll, or remove the moment for a bonus that always applies.`
            : `A modifier of ${label} waits for a moment its rule never reaches, so it would never apply. Make it apply ${read.map((entry) => MOMENT_WORDS[entry] ?? entry).join(" or ")}, or remove the moment.`
      );
    }
    if (modifier.type === "extra-damage" && modifier.formula === undefined && modifier.abilityModifier === undefined) {
      checks.add(
        [...path, index],
        `An extra damage modifier of ${label} has no dice and no ability modifier, so it would add nothing. Fill in one of the two.`
      );
    }
    if (modifier.type === "damage-reduction" && modifier.amount === 0 && modifier.dice === undefined)
      checks.add(
        [...path, index],
        `A damage reduction of ${label} takes off 0 and no dice, so it would reduce nothing. Give it an amount or dice.`
      );
    if (modifier.type === "check-bonus" && modifier.minimum !== undefined && modifier.abilityModifier === undefined)
      checks.add(
        [...path, index],
        `An ability check bonus of ${label} has a least amount but no ability modifier for it to apply to. Pick the ability, or remove the least amount.`
      );
    if (modifier.type === "healing-bonus" && modifier.amount === 0 && modifier.perSlotLevel !== true)
      checks.add(
        [...path, index],
        `More healing from ${label} adds 0 and not the slot's level, so it would add nothing. Give it an amount or add the slot's level.`
      );
  });
}

function choiceIssues(
  choice: FeatureChoice | FeatureOptionChoice | undefined,
  path: Path,
  label: string,
  checks: Checks,
  grants: number,
  self: SelfCatalog
) {
  if (!choice) return;
  let optionCount: number;
  if (self && choice.fromCatalog === self.slug) {
    // Self-referential: answered from the record under validation, which the catalog cannot see yet.
    if (self.count === 0) {
      checks.add([...path, "fromCatalog"], `${label} offers a choice, but ${self.whenEmpty}`);
      return;
    }
    optionCount = self.count;
  } else if (choice.fromCatalog) {
    try {
      optionCount = resolveCatalogChoice(choice.fromCatalog, checks.catalogs).length;
    } catch (error) {
      if (!(error instanceof CatalogChoiceError)) throw error;
      // At build time this is swallowed into `unresolvable` and the pick silently disappears.
      checks.add(
        [...path, "fromCatalog"],
        `${label} offers a choice whose list of options is empty in this table, so the pick would never appear. Pick another list of options.`
      );
      return;
    }
  } else {
    optionCount = choice.from?.length ?? 0;
  }
  // The build requires exactly `choose x grants` picks, so too few distinct options can never complete.
  const capacity = choice.choose * Math.max(1, grants);
  if (!choice.repeatable && optionCount > 0 && optionCount < capacity) {
    checks.add(
      path,
      `${label} asks for ${capacity} different ${capacity === 1 ? "pick" : "picks"} but offers only ${optionCount}, so the character could never be finished.`
    );
  }
}

/** A starting-equipment item id that resolves to nothing grants no attack and no AC, and says nothing. */
function startingEquipmentIssues(
  options: ReadonlyArray<{ label: string; items: ReadonlyArray<{ id: string }> }>,
  path: Path,
  checks: Checks
) {
  options.forEach((option, optionIndex) => {
    option.items.forEach((item, itemIndex) => {
      if (!checks.catalog.equipmentRecord(item.id)) {
        checks.add(
          [...path, optionIndex, "items", itemIndex, "id"],
          `One of the items in starting equipment ${option.label} is not in this table, so it would give nothing. Pick it again from the list.`
        );
      }
    });
  });
}

// The router seam

/** Always validates against the GM catalog, resolved per call so a just-published record is visible. */
/**
 * A "what if" for the gate: the table with one record's live body left out, optionally replaced by another body
 * (its pending edits going live), or archived outright so it no longer counts as authored either.
 */
export type HomebrewValidationScenario = Readonly<{
  without: string;
  replacement?: Readonly<{ type: HomebrewContentType; body: HomebrewBody }>;
  archived?: boolean;
}>;

/** The catalog and published spell lists of a scenario, for one audience. */
export type ScenarioCatalogs = (
  scenario: HomebrewValidationScenario,
  audience?: "gm" | "play"
) => Readonly<{ catalog: ContentView; spellLists: readonly SpellListReference[] }>;

/** Builds a scenario's catalogs over the live library and store. */
export function scenarioCatalogs(
  library: Pick<ContentLibrary, "forAudienceAdjusted">,
  store: Pick<HomebrewStore, "publishedFor">
): ScenarioCatalogs {
  return (scenario, audience = "play") => {
    const adjust = (slice: Parameters<typeof sliceReplacing>[0]) =>
      sliceReplacing(slice, scenario.without, scenario.replacement);
    return {
      catalog: library.forAudienceAdjusted(audience, adjust),
      spellLists: adjust(store.publishedFor(audience)).spellLists
    };
  };
}

/** The authorship index with one record gone, for a scenario that archives it. */
function authoredWithout(index: HomebrewAuthoredIndex, id: string): HomebrewAuthoredIndex {
  return {
    has: (type, candidate) => candidate !== id && index.has(type, candidate),
    subclassIdsFor: (classId) => new Set([...index.subclassIdsFor(classId)].filter((candidate) => candidate !== id))
  };
}

/** A published record in a pack that is switched off, as the gate's warning names it. */
export type OffPackRecord = Readonly<{ name: string; packName: string }>;

/**
 * The gate reads the table with every pack on (`play`), so a record that needs one from a pack that is off still
 * publishes. What fails only once the switched-off packs leave the catalog (`gm`) comes back as a warning at the same
 * path, naming the record and its pack where the path holds that record's id.
 */
export function createHomebrewValidator(source: {
  forAudience: (audience: "gm" | "play") => ContentView;
  /** Catalogs for a scenario; without it, every validation reads the live table. */
  forScenario?: ScenarioCatalogs;
  publishedSpellLists: (audience?: "gm" | "play") => readonly SpellListReference[];
  /** Drafts included: the gate asks about authorship alone. */
  authoredIndex: () => HomebrewAuthoredIndex;
  /** Published records in packs that are off, by id. Without it, no pack is ever off. */
  offPackRecords?: () => ReadonlyMap<string, OffPackRecord>;
}) {
  const contextFor = (audience: "gm" | "play", scenario: HomebrewValidationScenario | undefined) => {
    const adjusted = scenario && source.forScenario ? source.forScenario(scenario, audience) : null;
    const authored = source.authoredIndex();
    return {
      catalog: adjusted?.catalog ?? source.forAudience(audience),
      spellLists: adjusted?.spellLists ?? source.publishedSpellLists(audience),
      authored: scenario?.archived ? authoredWithout(authored, scenario.without) : authored
    };
  };
  return (type: HomebrewContentType, body: unknown, scenario?: HomebrewValidationScenario): HomebrewValidity => {
    const validity = validateForPublish(type, body, contextFor("play", scenario));
    const offPack = source.offPackRecords?.() ?? new Map<string, OffPackRecord>();
    if (!validity.valid || offPack.size === 0) return validity;
    const onOnly = validateForPublish(type, body, contextFor("gm", scenario));
    if (onOnly.valid) return validity;
    const warnings = onOnly.issues.map((issue) => {
      const named = offPack.get(String(valueAt(body, issue.path) ?? ""));
      return {
        path: issue.path,
        recordId: issue.recordId,
        message: named
          ? `Needs ${named.name} from ${named.packName}, which is switched off. Turn that pack on in Sources to use it.`
          : "Needs a record from a pack that is switched off. Turn that pack on in Sources to use it."
      };
    });
    return { ...validity, warnings: [...validity.warnings, ...warnings] };
  };
}

/** The value a path names in a body, or undefined. */
function valueAt(body: unknown, path: readonly (string | number)[]): unknown {
  let node = body;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

import type { HomebrewContentType, HomebrewValidationIssue, HomebrewValidity } from "@vtt/api-contract";
import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import { DAMAGE_ROLL_MOMENTS, RIDER_TRIGGER_KINDS, type ActorDefinition, type Modifier } from "@vtt/schemas";
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
  type SubclassReference
} from "@vtt/content-srd-5.2.1";
import type { ContentLibrary, ContentView } from "./content-library.js";
import { STATBLOCK_EXTENSION, statblockFacts } from "./statblock-facts.js";
import { homebrewIdProblem } from "./homebrew-ids.js";
import { sliceReplacing, type HomebrewAuthoredIndex, type HomebrewBody, type HomebrewStore } from "./homebrew-store.js";

/**
 * The publish gate: runs only on Publish (drafts may be invalid) and returns field paths plus messages. Most
 * homebrew mistakes otherwise fail silently in play. Tiers run in order, each only if the last passed:
 * 1. the record's own Zod schema; 2. identity (`hb-`, length, slug, opaque monsters); 3. referential (names
 * resolve; class/subclass rules ask only whether the partner is authored); 4. unsupported-but-parsing shapes.
 */

export type HomebrewValidationContext = Readonly<{
  /** The merged GM catalog - already spell-list-overlaid, so `spellSummaries()` carries real membership. */
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

/** The context plus the two things worth resolving once per record rather than once per check. */
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
    for (const issue of parsed.error?.issues ?? []) {
      add(
        issue.path.map((key) => (typeof key === "number" ? key : String(key))),
        issue.message
      );
    }
    return { valid: false, issues, warnings: [] };
  }

  // Tier 2: identity. Read the id from the raw body: `ActorDefinitionSchema` strips `id`.
  const id = idOf(body);
  const problem = homebrewIdProblem(id, type);
  if (problem) add(["id"], `This record's id "${id}" ${problem}. Re-create the record rather than editing its id.`);

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
    // A spell names no other record: `SpellReference.classes` entries are open membership tags.
    case "spell":
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
 * is legal and publishes, but a typo ("fier") would match nothing at the table, so the GM is told rather than
 * refused. Walks the parsed record by key, which reaches every grant list, action damage part and on-hit
 * condition whatever the record type.
 */
function slugWarnings(record: unknown, recordId: string | null): Issue[] {
  const warnings: Issue[] = [];
  const check = (slug: unknown, path: Path, known: ReadonlySet<string>, kind: string) => {
    if (typeof slug !== "string" || known.has(slug.trim().toLowerCase())) return;
    warnings.push({
      path,
      recordId,
      message: `"${slug}" is not an SRD ${kind}. It still publishes, but it only matches a ${kind} spelled exactly the same way, so check the spelling.`
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
  // Published subclasses plus authored drafts: a subclass must exist, not be published.
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
    whenEmpty: `no subclass names "${entry.name}" yet. Create one first (duplicating an SRD subclass and picking this class is the quick way) - it does not have to be published, it only has to exist.`
  };
  entry.features.forEach((feature, index) => {
    const granted = grants.get(feature.id) ?? 0;
    // A choice-bearing feature no level grants makes an uncreatable character: the wizard offers the
    // pick, but `grantedClassFeatures` builds offers from the level table alone and Create then fails.
    if (featurePicks(feature).length > 0 && granted === 0) {
      checks.add(
        ["features", index],
        `"${feature.name}" asks the player to choose, but no level in the table grants it - the character builder would offer the pick and then refuse to create the character. Add "${feature.id}" to a level in the level table, or remove its choice.`
      );
      return;
    }
    featureIssues(feature, ["features", index], checks, granted, self);
  });
  startingEquipmentIssues(entry.startingEquipment, ["startingEquipment"], checks);
  if (entry.skillChoices.from.length < entry.skillChoices.choose) {
    checks.add(
      ["skillChoices", "from"],
      `This class asks for ${entry.skillChoices.choose} skills but offers only ${entry.skillChoices.from.length}.`
    );
  }
}

function subclassIssues(entry: SubclassReference, checks: Checks) {
  const parent = checks.catalog.classRecord(entry.classId);
  // Authored, not published (a published subclass of a draft class is inert); a class id naming nothing is refused.
  if (!parent && !checks.authored.has("class", entry.classId)) {
    checks.add(
      ["classId"],
      `No class "${entry.classId}" exists. Create the class this subclass belongs to (it can stay a draft), or point this at an existing one.`
    );
  } else if (!parent && entry.spellcasting) {
    // The check below needs the class's level table, which only a published class has here.
    checks.add(
      ["spellcasting"],
      `A spellcasting subclass can only be checked against a published class's spell slots, and "${entry.classId}" is still a draft. Publish the class first - it does not need its subclasses published.`
    );
  } else if (parent && entry.spellcasting) {
    // A subclass's own `levelTable` is not applied yet, so it cannot give a non-caster class spell slots.
    const classCasts = parent.levelTable.some(
      (row) => (row.spellSlots?.length ?? 0) > 0 || row.pactSlots !== undefined
    );
    if (!classCasts) {
      checks.add(
        ["spellcasting"],
        `"${parent.name}" has no spell slots in its level table, and a subclass's own table is not applied yet - this subclass would create a caster with no slots. Third-caster subclasses are not supported yet.`
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
        `Two lineages share the id "${lineage.id}"; only the first would ever be granted.`
      );
    seen.add(lineage.id);
    // Lineage traits are flattened untagged, so a choice there would be offered for every lineage.
    lineage.traits.forEach((trait, traitIndex) => {
      if (featurePicks(trait).length > 0)
        checks.add(
          ["lineages", index, "traits", traitIndex, "choice"],
          `"${trait.name}" asks the player a question from inside a lineage. Lineage traits cannot carry choices yet - move the choice up to a species trait.`
        );
    });
  });

  const self: SelfCatalog = {
    slug: `${entry.id}-lineages`,
    count: entry.lineages.length,
    whenEmpty: `"${entry.name}" asks for a lineage but declares none.`
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
          `A lineage pick must use the kind "lineage" (this one uses "${choice.kind}"), or the chosen lineage's traits are silently never granted.`
        );
      if (choice.fromCatalog !== `${entry.id}-lineages`)
        checks.add(
          [...pickPath, "fromCatalog"],
          `A lineage pick must read from "${entry.id}-lineages" (this one reads "${choice.fromCatalog ?? "an inline list"}").`
        );
    });
  });
}

function backgroundIssues(entry: BackgroundReference, checks: Checks) {
  // Otherwise this only fails inside `character-build.ts`, deep in the wizard.
  if (entry.originFeatId && !checks.catalog.featRecord(entry.originFeatId)) {
    checks.add(
      ["originFeatId"],
      `No feat "${entry.originFeatId}" is in the catalog. Publish the origin feat before the background that grants it.`
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
    checks.add(
      ["schemaId"],
      `A homebrew creature must be a "vtt.actor-monster" stat block (this one is "${definition.schemaId}").`
    );
  }
  // `source.externalId` becomes `Actor.definitionId`; the store forces it, so a mismatch means a bypassed store.
  if (definition.source.externalId !== id) {
    checks.add(
      ["source", "externalId"],
      `This creature's content id ("${definition.source.externalId ?? "missing"}") disagrees with its record id ("${id}"); its live tokens would resolve to nothing.`
    );
  }
  // Uses the bestiary's own `statblockFacts`, so the guard cannot pass what the list would show as "CR 0 - unknown".
  const facts = statblockFacts(definition);
  if (facts.challengeRating === null)
    checks.add(
      ["extensions"],
      `This creature has no challenge rating, so the bestiary would list it as CR 0. Put a numeric "challengeRating" in the "${STATBLOCK_EXTENSION}" extension bag.`
    );
  if (facts.creatureType === null)
    checks.add(
      ["extensions"],
      `This creature has no creature type, so the bestiary would list it as "unknown" and type search would never find it. Put a "type" in the "${STATBLOCK_EXTENSION}" extension bag.`
    );
}

/** A template's `appliesTo.baseIds` must resolve to items with the stats the bind copies (weapon or armor), or to
 *  the kinds of ammunition a piece of magic ammunition can be. */
function equipmentIssues(item: EquipmentReference, checks: Checks) {
  riderBlockIssues(item, [], item.name, checks);
  // An item's riders reach the sheet through equipment derivation, which has no arm for granted spells.
  if ((item.grants?.spells ?? []).length > 0)
    checks.add(
      ["grants", "spells"],
      `"${item.name}" grants spells, but an item's granted spells never reach a sheet. Give it a "casts" entry instead, which the sheet can cast from.`
    );
  const appliesTo = item.appliesTo;
  if (!appliesTo) return;
  if (item.category === "ammunition") {
    appliesTo.baseIds.forEach((baseId, index) => {
      if (checks.catalog.equipmentRecord(baseId)?.ammunition === undefined)
        checks.add(
          ["appliesTo", "baseIds", index],
          `"${baseId}" is not a kind of ammunition (Arrows, Crossbow Bolts...), so "${item.name}" could never be bound to it.`
        );
    });
    return;
  }
  if (item.category !== "weapon" && item.category !== "armor") {
    checks.add(
      ["appliesTo"],
      `"${item.name}" has an "applies to" list but its category is "${item.category}" - a template must be a weapon, an armor or ammunition, because those are what a bind can make it.`
    );
    return;
  }
  if (item.category === "weapon" ? item.weapon != null : item.armor != null) {
    checks.add(
      ["appliesTo"],
      `"${item.name}" has both its own ${item.category} stats and an "applies to" list. Give it one or the other: fixed stats make it one specific ${item.category}; the list makes it a template whose stats come from the player's pick.`
    );
  }
  const summaries = checks.catalog.equipmentSummaries();
  appliesTo.baseIds.forEach((baseId, index) => {
    const base = summaries.find((entry) => entry.id === baseId);
    if (!base) {
      checks.add(
        ["appliesTo", "baseIds", index],
        `"${baseId}" is not in the equipment catalog, so "${item.name}" could never be bound to it. Name a real ${item.category} id, or publish the base first.`
      );
      return;
    }
    // A shield's armor block holds its +2 as acBase, so binding a template to it would set AC to 2.
    if (item.category === "armor" && base.category === "shield") {
      checks.add(
        ["appliesTo", "baseIds", index],
        `"${baseId}" is a shield, and a shield cannot be a template's base - its armor block carries its +2 bonus, not a body AC. Make the magic shield its own fixed item instead.`
      );
      return;
    }
    if (item.category === "weapon" ? !base.weapon : !base.armor) {
      checks.add(
        ["appliesTo", "baseIds", index],
        `"${baseId}" has no ${item.category} stats to copy, so "${item.name}" could never be bound to it.`
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
      'This list\'s "based on" chain loops back to itself, so the whole chain is ignored. Break the loop.'
    );
  }
  list.basedOn.forEach((base, index) => {
    if (resolution.unknownBasedOn.includes(base))
      checks.add(["basedOn", index], `Nothing is on the "${base}" list, so basing this one on it adds no spells.`);
  });
  // `resolveCatalogChoice` refuses an empty option set, so a caster on an empty list cannot be created.
  if ((resolution.memberIds.get(list.id)?.size ?? 0) === 0) {
    checks.add(
      ["add"],
      "This spell list resolves to no spells. A caster pointed at an empty list cannot be created at all - add spell ids, base it on an existing list, or tag spells with this list's id."
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
      `"${owner.name}" casts spells but names no spell list, so the builder would look for a list called "${owner.id}" and find nothing. Name an existing list (for example "wizard") or publish one.`
    );
    return;
  }
  // `spellSummaries()` is already overlaid with published lists, matching what the build will resolve.
  const members = spellListMemberIds(listId, checks.spellLists, checks.catalog.spellSummaries());
  if (members.size === 0) {
    checks.add(
      [...path, "spellListId"],
      `No spells are on the "${listId}" list, so a ${owner.name} could not be created at all. Publish the spell list (and its spells) first.`
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
          `${feature.name} / ${option.name}`,
          checks,
          grants,
          self
        );
      });
      riderBlockIssues(option, [...pickPath, "options", index], `${feature.name} / ${option.name}`, checks);
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
}

/** The moments each reader collects, for the modifiers whose reader is narrower than the vocabulary: a damage
 *  rider fires only inside the damage roll, and a defence is read standing. A gate on any other moment would
 *  publish and then never apply. */
const MOMENTS_READ: Partial<Record<Modifier["type"], readonly string[]>> = {
  "damage-bonus": DAMAGE_ROLL_MOMENTS,
  "extra-damage": DAMAGE_ROLL_MOMENTS,
  "damage-resistance": [],
  "damage-vulnerability": []
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
          ? `"${label}" gates a ${modifier.type} on "${moment}", but a defence is read before any roll, so it would publish and then never apply. Drop the moment, or gate it on a state (while-effect-tag, while-condition, ...).`
          : `"${label}" gates a ${modifier.type} on "${moment}", a moment the damage roll never collects - it would publish and then add nothing, ever. Gate it on ${read.map((entry) => `"${entry}"`).join(", ")} instead (or drop the moment for an always-on bonus).`
      );
    }
    if (modifier.type === "extra-damage" && modifier.formula === undefined && modifier.abilityModifier === undefined) {
      checks.add(
        [...path, index],
        `"${label}" has an extra-damage rider with neither a dice \`formula\` nor an \`abilityModifier\`, so it would add nothing.`
      );
    }
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
      checks.add([...path, "fromCatalog"], `"${label}" reads its options from "${self.slug}", but ${self.whenEmpty}`);
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
        `"${label}" reads its options from "${choice.fromCatalog}", which resolves to nothing: ${error.message}`
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
      `"${label}" asks for ${capacity} distinct pick(s) but offers only ${optionCount}; the character could never be completed.`
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
          `No equipment "${item.id}" is in the catalog, so "${option.label}" would grant nothing for it.`
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

/** The catalog and published spell lists of a scenario. */
export type ScenarioCatalogs = (
  scenario: HomebrewValidationScenario
) => Readonly<{ catalog: ContentView; spellLists: readonly SpellListReference[] }>;

/** Builds a scenario's catalogs over the live library and store. */
export function scenarioCatalogs(
  library: Pick<ContentLibrary, "forAudienceAdjusted">,
  store: Pick<HomebrewStore, "publishedFor">
): ScenarioCatalogs {
  return (scenario) => {
    const adjust = (slice: Parameters<typeof sliceReplacing>[0]) =>
      sliceReplacing(slice, scenario.without, scenario.replacement);
    return {
      catalog: library.forAudienceAdjusted("gm", adjust),
      spellLists: adjust(store.publishedFor("gm")).spellLists
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

export function createHomebrewValidator(source: {
  forAudience: (audience: "gm" | "player") => ContentView;
  /** Catalogs for a scenario; without it, every validation reads the live table. */
  forScenario?: ScenarioCatalogs;
  publishedSpellLists: () => readonly SpellListReference[];
  /** Drafts included: the gate asks about authorship, not publication. */
  authoredIndex: () => HomebrewAuthoredIndex;
}) {
  return (type: HomebrewContentType, body: unknown, scenario?: HomebrewValidationScenario): HomebrewValidity => {
    const adjusted = scenario && source.forScenario ? source.forScenario(scenario) : null;
    const authored = source.authoredIndex();
    return validateForPublish(type, body, {
      catalog: adjusted?.catalog ?? source.forAudience("gm"),
      spellLists: adjusted?.spellLists ?? source.publishedSpellLists(),
      authored: scenario?.archived ? authoredWithout(authored, scenario.without) : authored
    });
  };
}

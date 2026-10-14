import type { HomebrewContentType, HomebrewValidationIssue, HomebrewValidity } from "@vtt/api-contract";
import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import { type ActorDefinition } from "@vtt/schemas";
import {
  featurePicks, HOMEBREW_BODY_SCHEMAS,
  resolveSpellLists, spellListMemberIds,
  type BackgroundReference, type ClassReference, type ContentSpellcasting, type EquipmentReference, type FeatReference,
  type FeatureChoice, type FeatureModifier, type FeatureOptionChoice, type FeatureRecord, type SpeciesReference,
  type SpellListReference, type SubclassReference
} from "@vtt/content-srd-5.2.1";
import { STATBLOCK_EXTENSION, statblockFacts, type ContentView } from "./content-library.js";
import { homebrewIdProblem } from "./homebrew-ids.js";
import type { HomebrewAuthoredIndex } from "./homebrew-store.js";

/**
 * The publish gate. A DRAFT MAY BE INVALID (decision 7) - that is what drafts are for - so nothing
 * here runs until the GM presses Publish, and when it does the answer has to be actionable: a
 * machine-addressable `path` into the authored record plus a sentence the GM can act on.
 *
 * The gate exists because of ONE property of this codebase: almost every way a homebrew record can
 * be wrong fails SILENTLY at play time rather than loudly at authoring time.
 *
 *   - a typo'd `fromCatalog` slug is swallowed into `unresolvable` on both the client and the server
 *     and the pick simply DISAPPEARS while the build succeeds. Right for partially-authored SRD
 *     content; exactly wrong for homebrew, where the author made the mistake.
 *   - a caster whose spell list resolves to nothing is not a bad picker, it is a HARD
 *     `character.create` rejection - `resolveCatalogChoice` refuses to return an empty option list.
 *     The GM must hear that from the publish button, not from a player who cannot roll a character.
 *   - a `startingEquipment` item id that resolves to nothing grants no attack and no AC, silently.
 *   - a species lineage choice whose `kind` is not the literal string "lineage" validates, records
 *     the pick, and then never grants the lineage's traits.
 *
 * Four tiers, in order; a later tier only runs when the earlier one passed, because a
 * cross-reference check against a body that failed its own schema reports noise on top of the real
 * error.
 *
 *   1. SCHEMA        the record's own Zod schema - the SAME one the SRD bundle is parsed through.
 *   2. IDENTITY      `hb-` prefixed, <= 60 characters, slug-legal, and (monsters) self-consistent.
 *   3. REFERENTIAL   every id this record names resolves in the merged GM catalog - except the two
 *                    class/subclass rules, which ask whether the other record has been AUTHORED,
 *                    because demanding publication in both directions deadlocked both.
 *   4. UNSUPPORTED   shapes that parse and are then read by nothing.
 *
 * DELIBERATELY NOT HERE: the plan's tier of ADVISORIES (fields that parse and do nothing -
 * `classResources`, `preparedFormula`, `abilityBonusChoice`, `effects[1..3]`, ...).
 * `HomebrewValiditySchema` is `.strict()` with exactly `{ valid, issues }`, so a warning has nowhere
 * to travel and emitting one as an issue would BLOCK a publish that should succeed. Carrying
 * advisories needs a `warnings` array on the contract; filed, not smuggled.
 */

export type HomebrewValidationContext = Readonly<{
  /** The merged GM catalog - already spell-list-overlaid, so `spellSummaries()` carries real membership. */
  catalog: ContentView;
  /** Published spell-list overlays, so a list under validation resolves in the graph it will join. */
  spellLists: readonly SpellListReference[];
  /**
   * Who has been AUTHORED, drafts included. Required, not optional: the two rules that read it are
   * the two that deadlocked publishing entirely, and an optional field would let a call site quietly
   * reinstate the deadlock. A caller with no store passes `EMPTY_AUTHORED_INDEX`.
   */
  authored: HomebrewAuthoredIndex;
}>;

type Issue = HomebrewValidationIssue;
type Path = (string | number)[];
type Add = (path: Path, message: string) => void;
/** Named record header shared by every authorable type, so the messages can say what is wrong with WHAT. */
type Owner = Readonly<{ id: string; name: string }>;

/**
 * How a catalog slug DERIVED FROM THE RECORD'S OWN ID resolves.
 *
 * `resolveCatalogChoice` answers `<classId>-subclasses` and `<speciesId>-lineages` by looking the
 * owning record up in the published catalog - and the record being validated is a DRAFT, so it is not
 * there. Without this, every class would fail publish with "No class hb-... is in the catalog".
 *
 * These two families - and only these two - are therefore answered from the record itself (a
 * species' lineages) or from the authorship index (a class's subclasses), which is also what makes
 * the message useful ("no subclasses name this class yet" rather than "no class"). `-spells` keys on
 * a spell-list id, `-feats` on a free category slug, and `skills`/`weapons` are global, so none of
 * them are self-referential and none need this.
 *
 * ORDERING IS NOT PART OF THE ANSWER, and getting that wrong is how this file used to make the
 * headline feature unusable. Counting only PUBLISHED subclasses here, while `subclassIssues`
 * demanded a PUBLISHED class, left a perfect deadlock in both directions: duplicate Fighter and
 * publish and you are told to publish a subclass first; duplicate Champion, re-point it, publish,
 * and you are told to publish the class first. The carve-out above did not prevent that deadlock, it
 * relocated it. Both rules now read authorship rather than publication - a record that EXISTS
 * satisfies them, whatever state it is in - which is the honest question anyway: publishing is not
 * playing, and a published record whose partner is still a draft is inert (drafts are in no merged
 * catalog), not dangerous.
 */
type SelfCatalog = Readonly<{ slug: string; count: number; whenEmpty: string }> | undefined;

/** The context plus the two things worth resolving once per record rather than once per check. */
type Checks = Readonly<{
  catalog: ContentView;
  spellLists: readonly SpellListReference[];
  authored: HomebrewAuthoredIndex;
  catalogs: CatalogChoiceCatalogs;
  add: Add;
}>;

/**
 * ONE schema per type - the very schemas `loadClasses()` and friends parse the bundle through
 * (ADR-0016: one shape, never a fork). A body that passes here parses identically when
 * `publishedFor` reads it back, which is what makes the store's fail-soft drop a
 * schema-tightening alarm rather than a routine occurrence.
 *
 * THE MAP ITSELF NOW LIVES IN THE CONTENT PACKAGE, and the reason is the publish bug this file used
 * to be the far end of. The editor's own "why is Publish disabled" checklist was a hand-written
 * DESCRIPTION of what these schemas require, so it green-lit bodies tier 1 refused and the GM met
 * the refusal as a 409 reading "Required" with no subject. The checklist now imports
 * `HOMEBREW_BODY_SCHEMAS` and runs the same parse; the `satisfies` below is what keeps the two type
 * vocabularies (`HomebrewContentType` on the wire, `HomebrewBodyType` in the content package) from
 * drifting apart without failing to compile.
 */
const SCHEMAS = HOMEBREW_BODY_SCHEMAS satisfies Record<HomebrewContentType, {
  safeParse: (value: unknown) => { success: boolean };
}> as Record<HomebrewContentType, {
  safeParse: (value: unknown) => {
    success: boolean; data?: unknown;
    error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
  };
}>;

/**
 * Validate a stored body for publication.
 *
 * `recordId` rides on every issue because the same function serves pack import, where one response
 * carries issues from many records. A single-record publish passes null - the contract's documented
 * meaning - present-but-null, so a consumer never branches on key presence.
 */
export function validateForPublish(
  type: HomebrewContentType, body: unknown, context: HomebrewValidationContext, recordId: string | null = null
): HomebrewValidity {
  const issues: Issue[] = [];
  const add: Add = (path, message) => { issues.push({ path, message, recordId }); };

  // ---- Tier 1: the record's own schema. ----
  const parsed = SCHEMAS[type].safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error?.issues ?? []) {
      add(issue.path.map((key) => (typeof key === "number" ? key : String(key))), issue.message);
    }
    return { valid: false, issues };
  }

  // ---- Tier 2: identity. ----
  // Read the id from the RAW body, never the parsed one: `ActorDefinitionSchema` has no `id` field
  // and strips it, so a monster's identity would vanish exactly where it matters most.
  const id = idOf(body);
  const problem = homebrewIdProblem(id, type);
  if (problem) add(["id"], `This record's id "${id}" ${problem}. Re-create the record rather than editing its id.`);

  // ---- Tiers 3 and 4, per type. ----
  const checks: Checks = { catalog: context.catalog, spellLists: context.spellLists, authored: context.authored, catalogs: context.catalog.catalogChoiceCatalogs(), add };
  const record = parsed.data;
  switch (type) {
    case "class": classIssues(record as ClassReference, checks); break;
    case "subclass": subclassIssues(record as SubclassReference, checks); break;
    case "species": speciesIssues(record as SpeciesReference, checks); break;
    case "background": backgroundIssues(record as BackgroundReference, checks); break;
    case "feat": featIssues(record as FeatReference, checks); break;
    case "monster": monsterIssues(record as ActorDefinition, id, checks); break;
    case "spell-list": spellListIssues(record as SpellListReference, checks); break;
    // A spell names no other record. `SpellReference.classes` entries are open membership TAGS (a
    // list that does not exist yet is not an error - it may be authored later), and
    // `EquipmentReferenceSchema` is the one `.strict()` content schema, so a typo'd key is already
    // a tier-1 failure rather than a silently-stripped one. Since C9, an EQUIPMENT record CAN name
    // other records - a template's `appliesTo.baseIds` - so it grew the referential arm below.
    case "spell": break;
    case "equipment": equipmentIssues(record as EquipmentReference, checks); break;
  }

  return { valid: issues.length === 0, issues };
}

/** The record's identity as stored: `normalizeBody` forces `body.id` to the row's primary key. */
function idOf(body: unknown): string {
  const value = (body as { id?: unknown } | null)?.id;
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------------------------
// Per-type checks
// ---------------------------------------------------------------------------------------------

function classIssues(entry: ClassReference, checks: Checks) {
  spellcastingIssues(entry.spellcasting, entry, ["spellcasting"], checks);
  // The level table is the ONLY place that knows a feature repeats, and capacity is
  // `choose x (times granted)`. Resolve the repeat count here, where the table is in hand.
  const grants = new Map<string, number>();
  for (const row of entry.levelTable) for (const featureId of row.features) grants.set(featureId, (grants.get(featureId) ?? 0) + 1);
  // Published subclasses AND authored drafts, unioned by id so a published homebrew subclass (which
  // is in both) is not counted twice. Drafts count because a class does not need a PUBLISHED
  // subclass to be publishable - it needs one to exist, and the pair can then publish in either
  // order. See `SelfCatalog`.
  const subclassIds = new Set([
    ...checks.catalog.subclassSummaries().filter((summary) => summary.classId === entry.id).map((summary) => summary.id),
    ...checks.authored.subclassIdsFor(entry.id)
  ]);
  const self: SelfCatalog = {
    slug: `${entry.id}-subclasses`,
    count: subclassIds.size,
    whenEmpty: `no subclass names "${entry.name}" yet. Create one first (duplicating an SRD subclass and picking this class is the quick way) - it does not have to be published, it only has to exist.`
  };
  entry.features.forEach((feature, index) => {
    const granted = grants.get(feature.id) ?? 0;
    // A CHOICE-BEARING FEATURE THAT NO LEVEL ROW GRANTS IS AN UNCREATABLE CHARACTER, and it used to
    // publish clean because this line invented a grant count (`?? 1`) for a feature the table never
    // grants. Everything downstream then disagreed with itself: the wire carries
    // `grantedAtLevels: []`, the wizard reads that as "granted once" and OFFERS the pick (and blocks
    // Create until it is answered), while `grantedClassFeatures` in `character-build.ts` builds its
    // offers from the LEVEL TABLE ALONE and never makes a matching one - so Create fails with
    // `No feature "..." offers a "skill" choice.` and the character can never be made. Refuse it
    // here, where the GM can fix it, and say which of the two edits fixes it.
    if (featurePicks(feature).length > 0 && granted === 0) {
      checks.add(["features", index], `"${feature.name}" asks the player to choose, but no level in the table grants it - the character builder would offer the pick and then refuse to create the character. Add "${feature.id}" to a level in the level table, or remove its choice.`);
      return;
    }
    featureIssues(feature, ["features", index], checks, granted, self);
  });
  startingEquipmentIssues(entry.startingEquipment, ["startingEquipment"], checks);
  if (entry.skillChoices.from.length < entry.skillChoices.choose) {
    checks.add(["skillChoices", "from"], `This class asks for ${entry.skillChoices.choose} skills but offers only ${entry.skillChoices.from.length}.`);
  }
}

function subclassIssues(entry: SubclassReference, checks: Checks) {
  const parent = checks.catalog.classRecord(entry.classId);
  // AUTHORED, not published. "Publish the class before its subclasses" was the second jaw of the
  // deadlock, and it never earned its keep: the merged catalogs expose published records only, so a
  // published subclass whose class is still a draft is unreachable by every consumer - the wizard
  // filters subclasses by class and `resolveCatalogChoice("<classId>-subclasses")` does the same -
  // which makes it inert, not dangerous. What IS worth catching is a class id that names NOTHING, a
  // typo that would silently strand the subclass forever; that check survives intact below.
  if (!parent && !checks.authored.has("class", entry.classId)) {
    checks.add(["classId"], `No class "${entry.classId}" exists. Create the class this subclass belongs to (it can stay a draft), or point this at an existing one.`);
  } else if (!parent && entry.spellcasting) {
    // The ONE case that still wants an order, and it is not a deadlock: the check below needs the
    // class's level table, which only a published class has here. The class side no longer waits for
    // anything, so "publish the class first" is always available.
    checks.add(["spellcasting"], `A spellcasting subclass can only be checked against a published class's spell slots, and "${entry.classId}" is still a draft. Publish the class first - it does not need its subclasses published.`);
  } else if (parent && entry.spellcasting) {
    // TIER 4, and it is a DEFERRAL wearing a rejection's clothes. A subclass's own `levelTable` is
    // dead data today - nothing reads it: not the builder, not the catalog projection, not the wire
    // summary. So a third-caster subclass on a non-caster class produces a character with zero
    // slots, no spell picker, and a rejection on every prepared spell. Refusing to publish it is
    // strictly better than shipping that. Delete this branch when the table overlay lands.
    const classCasts = parent.levelTable.some((row) => (row.spellSlots?.length ?? 0) > 0 || row.pactSlots !== undefined);
    if (!classCasts) {
      checks.add(["spellcasting"], `"${parent.name}" has no spell slots in its level table, and a subclass's own table is not applied yet - this subclass would create a caster with no slots. Third-caster subclasses are not supported yet.`);
    }
  }
  spellcastingIssues(entry.spellcasting, entry, ["spellcasting"], checks);
  entry.features.forEach((feature, index) => featureIssues(feature, ["features", index], checks, 1));
}

function speciesIssues(entry: SpeciesReference, checks: Checks) {
  const seen = new Set<string>();
  entry.lineages.forEach((lineage, index) => {
    if (seen.has(lineage.id)) checks.add(["lineages", index, "id"], `Two lineages share the id "${lineage.id}"; only the first would ever be granted.`);
    seen.add(lineage.id);
    // `content-library.ts` flattens lineage traits into ONE features list with no lineage tag, so a
    // choice on a lineage trait is offered for EVERY lineage and the build then rejects the picks the
    // player could not have avoided making. Refuse it rather than ship an uncreatable species.
    lineage.traits.forEach((trait, traitIndex) => {
      if (featurePicks(trait).length > 0) checks.add(["lineages", index, "traits", traitIndex, "choice"], `"${trait.name}" asks the player a question from inside a lineage. Lineage traits cannot carry choices yet - move the choice up to a species trait.`);
    });
  });

  const self: SelfCatalog = { slug: `${entry.id}-lineages`, count: entry.lineages.length, whenEmpty: `"${entry.name}" asks for a lineage but declares none.` };
  entry.traits.forEach((trait, index) => {
    featureIssues(trait, ["traits", index], checks, 1, self);
    const plural = (trait.choices?.length ?? 0) > 0;
    featurePicks(trait).forEach((choice, pickIndex) => {
      const pickPath: Path = plural ? ["traits", index, "choices", pickIndex] : ["traits", index, "choice"];
      if (choice.fromCatalog !== `${entry.id}-lineages` && choice.kind !== "lineage") return;
      // `character-build.ts` finds the chosen lineage by looking for a choice row whose `kind` is the
      // LITERAL string "lineage". Any other kind validates, records the pick, and silently never grants
      // the lineage's traits - precisely the class of failure this gate exists for.
      if (choice.kind !== "lineage") checks.add([...pickPath, "kind"], `A lineage pick must use the kind "lineage" (this one uses "${choice.kind}"), or the chosen lineage's traits are silently never granted.`);
      if (choice.fromCatalog !== `${entry.id}-lineages`) checks.add([...pickPath, "fromCatalog"], `A lineage pick must read from "${entry.id}-lineages" (this one reads "${choice.fromCatalog ?? "an inline list"}").`);
    });
  });
}

function backgroundIssues(entry: BackgroundReference, checks: Checks) {
  // Today this rejects loudly, but only inside `character-build.ts` - seven wizard steps in.
  if (entry.originFeatId && !checks.catalog.featRecord(entry.originFeatId)) {
    checks.add(["originFeatId"], `No feat "${entry.originFeatId}" is in the catalog. Publish the origin feat before the background that grants it.`);
  }
  entry.features.forEach((feature, index) => featureIssues(feature, ["features", index], checks, 1));
  startingEquipmentIssues(entry.startingEquipment, ["startingEquipment"], checks);
}

function featIssues(entry: FeatReference, checks: Checks) {
  featureIssues(entry.feature, ["feature"], checks, 1);
}

function monsterIssues(definition: ActorDefinition, id: string, checks: Checks) {
  if (definition.schemaId !== "vtt.actor-monster") {
    checks.add(["schemaId"], `A homebrew creature must be a "vtt.actor-monster" stat block (this one is "${definition.schemaId}").`);
  }
  // `source.externalId` IS a monster's identity: it keys the bestiary, and `actor-roster.ts` writes
  // it straight into `Actor.definitionId` without re-parsing. The store forces it on every write, so
  // a mismatch here means the body reached the database past the store.
  if (definition.source.externalId !== id) {
    checks.add(["source", "externalId"], `This creature's content id ("${definition.source.externalId ?? "missing"}") disagrees with its record id ("${id}"); its live tokens would resolve to nothing.`);
  }
  // Not cosmetic: the picker row renders "CR 0 - <size> unknown" and the creature is unfindable by
  // type search. Both fields live in the untyped extension bag, so no schema can catch this.
  //
  // Read through the BESTIARY'S OWN READER, never a private copy. This used to prefer a
  // `vtt.statblock` key that no consumer has ever read, so a creature carrying only that bag passed
  // the guard and then listed as exactly the "CR 0 - unknown" the guard exists to prevent. Sharing
  // `statblockFacts` means the guard cannot pass what the list cannot show.
  const facts = statblockFacts(definition);
  if (facts.challengeRating === null) checks.add(["extensions"], `This creature has no challenge rating, so the bestiary would list it as CR 0. Put a numeric "challengeRating" in the "${STATBLOCK_EXTENSION}" extension bag.`);
  if (facts.creatureType === null) checks.add(["extensions"], `This creature has no creature type, so the bestiary would list it as "unknown" and type search would never find it. Put a "type" in the "${STATBLOCK_EXTENSION}" extension bag.`);
}

/**
 * C9's referential half. A template's `appliesTo.baseIds` is exactly what the bind validates a
 * player's pick against, so a base the catalog cannot resolve is a pick that can never succeed -
 * the "publishes clean and is silently inert" failure this file exists to refuse by name. Checked
 * against the MERGED catalog (bundled + published homebrew), the same view the bind reads, and
 * against the same branch the bind takes: `category === "weapon"` copies weapon stats, anything
 * else copies armor stats.
 */
function equipmentIssues(item: EquipmentReference, checks: Checks) {
  damageBonusMomentIssues(item.modifiers, ["modifiers"], item.name, checks);
  const appliesTo = item.appliesTo;
  if (!appliesTo) return;
  if (item.category !== "weapon" && item.category !== "armor") {
    checks.add(["appliesTo"], `"${item.name}" has an "applies to" list but its category is "${item.category}" - a template must be a weapon or an armor, because those are the stats a bind copies.`);
    return;
  }
  if (item.category === "weapon" ? item.weapon != null : item.armor != null) {
    checks.add(["appliesTo"], `"${item.name}" has both its own ${item.category} stats and an "applies to" list. Give it one or the other: fixed stats make it one specific ${item.category}; the list makes it a template whose stats come from the player's pick.`);
  }
  const summaries = checks.catalog.equipmentSummaries();
  appliesTo.baseIds.forEach((baseId, index) => {
    const base = summaries.find((entry) => entry.id === baseId);
    if (!base) {
      checks.add(["appliesTo", "baseIds", index], `"${baseId}" is not in the equipment catalog, so "${item.name}" could never be bound to it. Name a real ${item.category} id, or publish the base first.`);
      return;
    }
    // The ETL's own ruling, held for homebrew too: a shield is never a bind target - its armor
    // block carries its +2 BONUS as acBase, so binding would set the wearer's whole AC to 2.
    if (item.category === "armor" && base.category === "shield") {
      checks.add(["appliesTo", "baseIds", index], `"${baseId}" is a shield, and a shield cannot be a template's base - its armor block carries its +2 bonus, not a body AC. Make the magic shield its own fixed item instead.`);
      return;
    }
    if (item.category === "weapon" ? !base.weapon : !base.armor) {
      checks.add(["appliesTo", "baseIds", index], `"${baseId}" has no ${item.category} stats to copy, so "${item.name}" could never be bound to it.`);
    }
  });
}

function spellListIssues(list: SpellListReference, checks: Checks) {
  const spells = checks.catalog.spellSummaries();
  // Resolve this list ALONGSIDE the published ones: `basedOn` may name a peer, and a draft has to be
  // checked in the same graph it is about to join.
  const peers = [list, ...checks.spellLists.filter((other) => other.id !== list.id)];
  const resolution = resolveSpellLists(peers, spells);
  if (resolution.cyclicListIds.includes(list.id)) {
    checks.add(["basedOn"], "This list's \"based on\" chain loops back to itself, so the whole chain is ignored. Break the loop.");
  }
  list.basedOn.forEach((base, index) => {
    if (resolution.unknownBasedOn.includes(base)) checks.add(["basedOn", index], `Nothing is on the "${base}" list, so basing this one on it adds no spells.`);
  });
  // THE check. An empty list is a hard `character.create` rejection downstream, not a soft one:
  // `resolveCatalogChoice` refuses to return an empty option set, so a caster pointed at this list
  // yields a character that cannot be created at all.
  if ((resolution.memberIds.get(list.id)?.size ?? 0) === 0) {
    checks.add(["add"], "This spell list resolves to no spells. A caster pointed at an empty list cannot be created at all - add spell ids, base it on an existing list, or tag spells with this list's id.");
  }
}

// ---------------------------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------------------------

/**
 * A caster must name a spell list that resolves to at least one spell.
 *
 * `character-build.ts` falls back to the CLASS RECORD's own id when `spellcasting.spellListId` is
 * absent, so an unset list on `hb-necromancer-a1b2c3` silently becomes
 * `hb-necromancer-a1b2c3-spells` -> zero options -> `CatalogChoiceError` -> hard build rejection.
 * The fallback is doubly wrong on a subclass, where it uses the *class's* id rather than the
 * subclass's. "Declare a list" and "the list has a spell on it" are therefore not separable checks:
 * either one alone still leaves an uncreatable caster.
 */
function spellcastingIssues(spellcasting: ContentSpellcasting | undefined, owner: Owner, path: Path, checks: Checks) {
  if (!spellcasting) return;
  const listId = spellcasting.spellListId;
  if (!listId) {
    checks.add([...path, "spellListId"], `"${owner.name}" casts spells but names no spell list, so the builder would look for a list called "${owner.id}" and find nothing. Name an existing list (for example "wizard") or publish one.`);
    return;
  }
  // `catalog.spellSummaries()` is ALREADY overlaid with this audience's published lists, so asking it
  // asks exactly what `resolveCatalogChoice("<listId>-spells")` will ask at build time.
  const members = spellListMemberIds(listId, checks.spellLists, checks.catalog.spellSummaries());
  if (members.size === 0) {
    checks.add([...path, "spellListId"], `No spells are on the "${listId}" list, so a ${owner.name} could not be created at all. Publish the spell list (and its spells) first.`);
  }
}

/** Every `fromCatalog` slug a feature - or one of its inline options - names must resolve to a NON-EMPTY
    list. EVERY pick is walked, whichever spelling holds it: a plural record's second block can name a
    broken catalog as easily as a singular's one, and the paths must name the spelling the record used
    (`choice` for the singular, `choices[i]` for the plural) or the issue points at a key the body
    does not have. */
function featureIssues(feature: FeatureRecord, path: Path, checks: Checks, grants: number, self: SelfCatalog = undefined) {
  const plural = (feature.choices?.length ?? 0) > 0;
  featurePicks(feature).forEach((pick, pickIndex) => {
    const pickPath: Path = plural ? [...path, "choices", pickIndex] : [...path, "choice"];
    choiceIssues(pick, pickPath, feature.name, checks, grants, self);
    (pick.options ?? []).forEach((option, index) => {
      const optionPlural = (option.choices?.length ?? 0) > 0;
      featurePicks(option).forEach((nested, nestedIndex) => {
        choiceIssues(nested, optionPlural ? [...pickPath, "options", index, "choices", nestedIndex] : [...pickPath, "options", index, "choice"], `${feature.name} / ${option.name}`, checks, grants, self);
      });
      riderIssues(option.modifiers, [...pickPath, "options", index, "modifiers"], `${feature.name} / ${option.name}`, checks);
    });
  });
  riderIssues(feature.modifiers, [...path, "modifiers"], feature.name, checks);
}

/**
 * A rider that PARSES but can contribute nothing. `extra-damage` carries two independent ways to say
 * how much - dice (`formula`) and the bearer's own `abilityModifier` - and both are optional, because
 * either alone is a real printed effect. Neither is not: it stores, publishes, collects at the right
 * moment, and adds zero, which is the silent-drop failure this whole area exists to end. The schema
 * cannot say it (a `.superRefine` inside a `z.discriminatedUnion` is not legal in Zod 3), so it is
 * refused HERE, at publish, which is where the codebase already puts authoring errors.
 */
/**
 * The moments the DAMAGE pass actually collects (`action-resolution.ts`'s passes list). A
 * `damage-bonus` gated on any other moment parses, publishes and lands NOWHERE - `on-attack-roll`
 * is an attack-pass moment whose collection reads `attack-bonus` only. The 2026-08-14 review
 * reproduced the silent drop; this refusal is what turns it into a named message. Scoped to
 * `damage-bonus` (born this batch, so no stored record can be demoted by the new rule);
 * `extra-damage`'s identical exposure predates C9 and is recorded in `known-bugs.md` instead.
 */
const DAMAGE_PASS_MOMENTS = new Set(["on-hit", "on-damage-roll", "on-critical-hit", "on-critical-miss"]);
const RIDER_MOMENTS = new Set([
  "on-attack-roll", "on-hit", "on-critical-hit", "on-critical-miss", "on-damage-roll", "on-saving-throw",
  "on-ability-check", "on-initiative-roll", "on-death-save", "on-taking-damage", "on-spell-cast"
]);
function damageBonusMomentIssues(modifiers: readonly FeatureModifier[] | undefined, path: Path, label: string, checks: Checks) {
  (modifiers ?? []).forEach((modifier, index) => {
    if (modifier.type !== "damage-bonus") return;
    const moment = (modifier.when ?? []).map((trigger) => trigger.type).find((type) => RIDER_MOMENTS.has(type) && !DAMAGE_PASS_MOMENTS.has(type));
    if (moment !== undefined) {
      checks.add([...path, index], `"${label}" gates a damage-bonus on "${moment}", a moment the damage roll never collects - it would publish and then add nothing, ever. Gate it on "on-hit", "on-damage-roll" or "on-critical-hit" instead (or drop the moment for an always-on bonus).`);
    }
  });
}

function riderIssues(modifiers: readonly FeatureModifier[] | undefined, path: Path, label: string, checks: Checks) {
  damageBonusMomentIssues(modifiers, path, label, checks);
  (modifiers ?? []).forEach((modifier, index) => {
    if (modifier.type !== "extra-damage") return;
    if (modifier.formula === undefined && modifier.abilityModifier === undefined) {
      checks.add([...path, index], `"${label}" has an extra-damage rider with neither a dice \`formula\` nor an \`abilityModifier\`, so it would add nothing.`);
    }
  });
}

function choiceIssues(choice: FeatureChoice | FeatureOptionChoice | undefined, path: Path, label: string, checks: Checks, grants: number, self: SelfCatalog) {
  if (!choice) return;
  let optionCount: number;
  if (self && choice.fromCatalog === self.slug) {
    // Self-referential: answered from the record under validation, which the catalog cannot see yet.
    if (self.count === 0) { checks.add([...path, "fromCatalog"], `"${label}" reads its options from "${self.slug}", but ${self.whenEmpty}`); return; }
    optionCount = self.count;
  } else if (choice.fromCatalog) {
    try {
      optionCount = resolveCatalogChoice(choice.fromCatalog, checks.catalogs).length;
    } catch (error) {
      if (!(error instanceof CatalogChoiceError)) throw error;
      // The single highest-value check in this file. At build time this is swallowed into
      // `unresolvable` on BOTH sides and the pick silently DISAPPEARS while the build succeeds -
      // right for partially-authored SRD content, exactly wrong for homebrew.
      checks.add([...path, "fromCatalog"], `"${label}" reads its options from "${choice.fromCatalog}", which resolves to nothing: ${error.message}`);
      return;
    }
  } else {
    optionCount = choice.from?.length ?? 0;
  }
  // Capacity is `choose x (times granted)` and the build-time completeness check is EXACT equality,
  // never "at most" - so a non-repeatable choice offering fewer distinct options than its capacity
  // can never be completed. `repeatable: true` (an ASI taking the same option twice) needs only one.
  const capacity = choice.choose * Math.max(1, grants);
  if (!choice.repeatable && optionCount > 0 && optionCount < capacity) {
    checks.add(path, `"${label}" asks for ${capacity} distinct pick(s) but offers only ${optionCount}; the character could never be completed.`);
  }
}

/** A starting-equipment item id that resolves to nothing grants no attack and no AC, and says nothing. */
function startingEquipmentIssues(
  options: ReadonlyArray<{ label: string; items: ReadonlyArray<{ id: string }> }>, path: Path, checks: Checks
) {
  options.forEach((option, optionIndex) => {
    option.items.forEach((item, itemIndex) => {
      if (!checks.catalog.equipmentRecord(item.id)) {
        checks.add([...path, optionIndex, "items", itemIndex, "id"], `No equipment "${item.id}" is in the catalog, so "${option.label}" would grant nothing for it.`);
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// The router seam
// ---------------------------------------------------------------------------------------------

/**
 * The `(type, body) => HomebrewValidity` closure `homebrew-http.ts` injects.
 *
 * Validation always reads the GM audience: it is a GM-only route acting on GM-only content, and a
 * class whose spell list is published-but-not-player-visible is perfectly valid.
 *
 * The catalog is resolved PER CALL rather than captured, because publishes come in runs - the class
 * published thirty seconds ago must be visible to the subclass being published now - and
 * `forAudience` is revision-gated, so this costs a map lookup once the catalog is warm.
 */
export function createHomebrewValidator(source: {
  forAudience: (audience: "gm" | "player") => ContentView;
  publishedSpellLists: () => readonly SpellListReference[];
  /** Drafts included - the gate asks about AUTHORSHIP, not publication. See `HomebrewAuthoredIndex`. */
  authoredIndex: () => HomebrewAuthoredIndex;
}) {
  return (type: HomebrewContentType, body: unknown): HomebrewValidity =>
    validateForPublish(type, body, {
      catalog: source.forAudience("gm"),
      spellLists: source.publishedSpellLists(),
      authored: source.authoredIndex()
    });
}

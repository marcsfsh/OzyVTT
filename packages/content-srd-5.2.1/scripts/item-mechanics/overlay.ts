/**
 * ============================================================================================
 * THE ITEM MECHANICS OVERLAY - hand-authored riders merged over the ETL-generated magic items
 * ============================================================================================
 *
 * `bundles/magic-items.v1.json` is GENERATED from `sources/dnd-5e-srd-markdown/magic-items.md` by
 * `../build-magic-items.ts`. That script's own header states the split this file is the other half
 * of: *"THIS ETL EMITS CONTENT, NOT MECHANICS. Every row lands with `isMagic`, `slot`, `rarity`,
 * `attunement` and prose; none lands with `modifiers`, `effects`, `actions`, `casts`, `uses` or
 * `cursed`."*
 *
 * Those riders cannot be authored where they land. A rider hand-edited into the generated bundle is
 * destroyed by the next `npm run build-magic-item-bundle`, silently and without a diff to notice.
 * So mechanics need a home the ETL READS, and this directory is it - the same answer
 * `scripts/class-mechanics/` already gives for classes: prose is generated, mechanics are authored,
 * and the ETL merges the two at build time. Nothing here is a runtime layer; each item still keeps
 * exactly ONE row in the bundle, so `loadMagicItems`, `loadEquipment`, the homebrew merge and every
 * consumer are unchanged.
 *
 * THIS OVERLAY MAY OVERWRITE FREELY, AND THAT IS THE ONE PLACE IT DIFFERS FROM THE CLASS OVERLAY.
 * `class-mechanics/overlay.ts` is additive-only and had to grow a `clears` verb, because
 * `classes.v1.json` is its ETL's INPUT as well as its output for the three `HAND_AUTHORED` classes -
 * so an unannounced overwrite there is a one-way, unreviewable edit to committed JSON. A generated
 * magic-item bundle has no such property: it is an OUTPUT ONLY, regenerable from a byte-pinned
 * vendored source with nothing hand-edited into it, and every run rebuilds each row from scratch
 * before this overlay is applied. `docs/product/plan-content-program.md` §1.5 is the ruling, and it
 * is the reason C6 emitted a separate bundle rather than appending 268 rows to the hand-authored
 * `equipment.v1.json`. **Do not copy `clears` here. There is nothing to announce.**
 *
 * ============================================================================================
 * EVERY REFUSAL BELOW EXISTS BECAUSE A LANE CAN OTHERWISE AUTHOR NOTHING AND THE BUILD STAYS
 * QUIET. That is the ONLY failure this file is defending against, stated once so the seven checks
 * below read as one idea rather than seven rules:
 * ============================================================================================
 *
 *   1. A LANE IS A LIST ENTRY, NOT AN OBJECT SPREAD, and that is a correctness requirement rather
 *      than a style. Composing four lanes with `{...a, ...b}` collapses two lanes keyed to the same
 *      item id by JS last-wins BEFORE this function ever sees them - MEASURED through the real ETL:
 *      two modules both keyed to `cloak-of-protection` produced exit 0, "rows carrying overlay
 *      mechanics: 1", and the first lane's rider nowhere in the bundle. A LIST keeps both, so the
 *      collision is visible and REFUSED, naming both lanes.
 *   2. AN ID NO ROW CARRIES is a typo'd or renamed item; the riders keyed to it land on nothing.
 *   3. AN ENTRY THAT NAMES NO RIDER - `{}`, and equally `{modifiers: []}`, `{casts: []}`,
 *      `{grants: {}}` or `{cursed: false}`. A present-but-empty list satisfies "the key is there"
 *      and authors exactly as much as a forgotten key: nothing. The class overlay already treats
 *      this as absence. A named absence is a COMMENT beside the entry, never an empty value.
 *   4. AN ENTRY OUTSIDE ITS LANE'S CATEGORIES. `plan-content-program.md` §3 justifies the
 *      category split by claiming a lane authoring outside its own category "fails the build the
 *      same way an unmatched key does"; `categories` on the lane is what gives that claim
 *      somewhere to stand.
 *   5. A SLUG POINTING AT ANOTHER BUNDLE THAT NOTHING RESOLVES. `casts[].spellId`,
 *      `grantsFeatIds[]` and the `grants.*` id lists are open slugs by schema, so `fyre-ball`
 *      parses, ships, and is silent at the table. Every one of them is cross-checked below.
 *   6. A RIDER TYPE NO CONSUMER READS YET (the admission rule, mirrored from the server).
 *   7. A MERGED ROW THE SCHEMA REFUSES - the item carrier's two refused modifier types, a curse on
 *      an item requiring no attunement, a malformed action. THE REFUSAL IS THE SCHEMA'S AND THIS
 *      FILE ONLY SURFACES IT: `ITEM_REFUSED_MODIFIER_TYPES` (`src/character-content.ts`) is
 *      enforced by `EquipmentReferenceSchema`'s `superRefine`, and a second copy here is exactly
 *      how items and feats would drift apart. The merge re-parses every row it touches so the
 *      refusal arrives WITH the item id attached, rather than out of the bundle's final
 *      `z.array(...).parse` with nothing to say which item caused it.
 *
 * ONE FILE PER LANE (`./weapons-armour.ts`, `./wands-rods.ts`, ...), composed by `./index.ts`, for
 * the reason the class overlay's header gives in its own words: *"A single object literal holding
 * twelve classes is one file that every content author has to edit ... The split is the difference
 * between four agents working and four agents merging."* Here it is four lanes over 268 items.
 */
import type { z } from "zod";
import { EquipmentReferenceSchema, type EquipmentReference } from "../../src/schemas.js";
import {
  CONDITION_IDS, CREATURE_TYPE_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS, WEAPON_PROPERTY_IDS
} from "../../src/enums.js";
import { loadClasses, loadFeats, loadLanguages, loadSkills, loadSpecies, loadSpells } from "../../src/index.js";

/**
 * Typed off the schema's INPUT rather than its output, deliberately - the same call the class
 * overlay makes. An overlay entry is authored the way a bundle row is authored, so a `.default()`ed
 * key (`whileArmored` on an `armor-class` modifier, the `riderGate` fields on every modifier) should
 * not have to be restated. `applyItemMechanics` re-parses each merged row, which is where those
 * defaults materialise and where an authoring mistake stops the build.
 */
type ItemInput = z.input<typeof EquipmentReferenceSchema>;

/**
 * The rider keys an overlay may author on one magic item - READ OFF `EquipmentReferenceSchema`
 * rather than invented, so a key this list names but the schema drops is a compile error at the
 * `Pick` below instead of an entry that authors nothing.
 *
 * The first six are `featureRiders` (`src/character-content.ts`), spread onto the item schema
 * unchanged - which is what makes *"a feat carries the same buffs and debuffs an item does"* true by
 * construction. The last three are the magic-item vocabulary's own mechanical columns.
 *
 * WHAT IS DELIBERATELY NOT HERE is everything the ETL PARSES: `id`, `name`, `source`, `category`,
 * `description`, `costGp`, `weightLb`, `weapon`, `armor`, and the four identity columns `slot`,
 * `rarity`, `isMagic` and `attunement`. Those are read out of the vendored SRD text, they are pinned
 * by `test/magic-items.test.ts`, and an overlay that could rewrite them would be authoring content
 * the source already states - a second, hand-maintained home for a parsed fact. `attunement` is the
 * one worth naming: it is printed on the item's own type line ("(Requires Attunement by a Bard)")
 * and the parse of that line is what `cursed`'s refinement is checked against, so a lane that wants
 * a curse must find an item the SRD already gates behind attunement rather than gating it here.
 */
export type ItemRiderKey =
  | "tags" | "actions" | "effects" | "uses" | "grants" | "modifiers"
  | "cursed" | "casts" | "grantsFeatIds";

/** The same nine, as a value, so the empty-rider check below iterates the list it is typed against. */
const ITEM_RIDER_KEYS: readonly ItemRiderKey[] = Object.freeze([
  "tags", "actions", "effects", "uses", "grants", "modifiers", "cursed", "casts", "grantsFeatIds"
] as const);

/** The riders ONE magic item may carry. Every key optional: an entry authors only what it names. */
export type ItemMechanics = Partial<Pick<ItemInput, ItemRiderKey>>;

/**
 * What ONE lane file contributes: riders by magic-item id, exactly as `bundles/magic-items.v1.json`
 * spells the id (`cloak-of-protection`, `wand-of-fireballs`, `weapon-1`).
 *
 * Flat rather than nested, unlike `MechanicsOverlay`'s (recordId, featureId) pair, because an item
 * id is not ambiguous the way a bare feature id is: `unarmored-defense` is a Barbarian feature AND a
 * Monk feature, but the ETL's own duplicate-id guard already proves every one of the 268 ids is
 * unique inside this bundle and collides with nothing in the other three.
 */
export type ItemMechanicsModule = Readonly<Record<string, ItemMechanics>>;

/**
 * ONE LANE, ATTRIBUTED. This is the shape `./index.ts` holds a LIST of, and the attribution is what
 * every lane-level check below stands on: without a lane name a duplicate id has nobody to blame,
 * and without `categories` §3's category rule has nothing to check an entry against.
 *
 * `categories` are `EquipmentReference.category` values as the ETL emits them. Measured over the
 * committed 268 rows: `wondrous-item 127 · weapon 33 · consumable 25 · ring 22 · wand 15 · armor 14
 * · staff 12 · shield 9 · rod 7 · ammunition 4`.
 *
 * THIS SEPARATES C7a FROM C7b FROM {C7c, C7d} AND NO FURTHER, and §3 says so itself: the category
 * comes off the printed type line and the build can check it, but the worn/carried line that splits
 * C7c from C7d is the `slot` column, *"downstream of a judgement rather than free of one"*. Both of
 * those lanes therefore declare `wondrous-item`, and what keeps them off each other's items is
 * check 1 - the duplicate-id refusal - not this field.
 */
export interface ItemMechanicsLane {
  /** The unit that owns this lane, exactly as the plan spells it: "C7a", "C7b", "C7c", "C7d". */
  readonly lane: string;
  /** The bundle categories this lane owns. An entry on a row outside them is refused. */
  readonly categories: readonly string[];
  /** This lane's riders, keyed by magic-item id. */
  readonly entries: ItemMechanicsModule;
}

// ---------------------------------------------------------------------------------------------
// THE ADMISSION RULE, MIRRORED. Check 6.
// ---------------------------------------------------------------------------------------------

/**
 * `CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts`) IS THE SOURCE OF TRUTH; this is
 * a MIRROR, and `test/item-mechanics.test.ts` fails if the two ever drift.
 *
 * The plan's admission rule is *"a lane authors a rider only when its reader ships today"*, and the
 * server already knows which readers ship: that table maps every rider type the item carrier can
 * reach to `standing` / `at-its-moment` / `unread` / `display-only`, with the consumer named in a
 * comment beside each. `"unread"` means the vocabulary and the collector carry the rider but no
 * consumer applies it YET - so a lane authoring one produces a row that parses, ships, projects and
 * changes nothing at the table. That is the exact failure this file exists to make loud, and until
 * now it was the one shape of it that was accepted silently.
 *
 * WHY A MIRROR RATHER THAN AN IMPORT: `apps/server` DEPENDS ON this package
 * (`apps/server/package.json` lists `"@vtt/content-srd-5.2.1": "*"`; this package's dependencies are
 * `@vtt/rules-5e`, `@vtt/schemas` and `zod`). Importing the server here would invert that edge and
 * make the content package unbuildable without the app that consumes it. The table is also not
 * exported from the server at all. So it is copied, with the drift test standing in for the import -
 * a mirror that cannot silently rot is worth more than a dependency cycle.
 */
export const CARRIER_RIDER_DISPOSITION_MIRROR: Readonly<Record<string, "standing" | "at-its-moment" | "unread" | "display-only">> = Object.freeze({
  "attack-bonus": "standing",
  "save-bonus": "standing",
  "spell-save-dc": "standing",
  "spell-slot": "standing",
  "resource-bonus": "standing",
  "critical-range": "standing",
  "critical-bonus-dice": "standing",
  "extra-attack": "standing",
  "roll-mode": "at-its-moment",
  "extra-damage": "at-its-moment",
  "check-bonus": "standing",
  "spell-attack-bonus": "unread",
  "damage-reduction": "at-its-moment",
  sense: "display-only"
});

/**
 * The refused half of the mirror, derived rather than restated so the two cannot disagree.
 *
 * `display-only` is NOT refused: `sense` reaches the sheet as prose the way `darkvision` does, which
 * is a real (if thin) outcome. `unread` reaches nothing at all.
 */
const UNREAD_RIDER_TYPES: ReadonlySet<string> = new Set(
  Object.entries(CARRIER_RIDER_DISPOSITION_MIRROR).filter(([, disposition]) => disposition === "unread").map(([type]) => type)
);

// ---------------------------------------------------------------------------------------------
// THE CROSS-BUNDLE VOCABULARIES. Check 5.
// ---------------------------------------------------------------------------------------------

type RefKind =
  | "spell" | "feat" | "skill" | "language" | "class" | "species"
  | "damage type" | "condition" | "school of magic" | "creature type" | "weapon property";

/** Where each kind's ids come from, loaded LAZILY so an empty overlay reads no bundle at all. */
const VOCABULARIES: Readonly<Record<RefKind, { readonly source: string; readonly ids: () => readonly string[] }>> = {
  spell: { source: "bundles/spells.v1.json", ids: () => loadSpells().map((record) => record.id) },
  feat: { source: "bundles/feats.v1.json", ids: () => loadFeats().map((record) => record.id) },
  skill: { source: "bundles/skills.v1.json", ids: () => loadSkills().map((record) => record.id) },
  language: { source: "bundles/languages.v1.json", ids: () => loadLanguages().map((record) => record.id) },
  class: { source: "bundles/classes.v1.json", ids: () => loadClasses().map((record) => record.id) },
  species: { source: "bundles/species.v1.json", ids: () => loadSpecies().map((record) => record.id) },
  "damage type": { source: "src/enums.ts DAMAGE_TYPE_IDS", ids: () => DAMAGE_TYPE_IDS },
  condition: { source: "src/enums.ts CONDITION_IDS", ids: () => CONDITION_IDS },
  "school of magic": { source: "src/enums.ts MAGIC_SCHOOL_IDS", ids: () => MAGIC_SCHOOL_IDS },
  "creature type": { source: "src/enums.ts CREATURE_TYPE_IDS", ids: () => CREATURE_TYPE_IDS },
  "weapon property": { source: "src/enums.ts WEAPON_PROPERTY_IDS", ids: () => WEAPON_PROPERTY_IDS }
};

const resolved = new Map<RefKind, ReadonlySet<string>>();
const vocabulary = (kind: RefKind): ReadonlySet<string> => {
  let ids = resolved.get(kind);
  if (!ids) { ids = new Set(VOCABULARIES[kind].ids()); resolved.set(kind, ids); }
  return ids;
};

/**
 * A KEY WHOSE VALUE IS A SLUG (or a list of them) POINTING INTO ANOTHER BUNDLE.
 *
 * Keyed by property name because the rider vocabulary names each of these exactly once - the two
 * places it does NOT (`id` and `type`, both of which mean different things in different parents)
 * are handled by `ELEMENT_REFERENCES` below instead of guessed at here.
 */
const SLUG_REFERENCES: Readonly<Record<string, RefKind>> = {
  spellId: "spell", spellIds: "spell", grantsFeatIds: "feat",
  damageType: "damage type", damageTypes: "damage type",
  damageResistances: "damage type", damageImmunities: "damage type",
  conditionId: "condition", conditionIds: "condition", conditionImmunities: "condition",
  skills: "skill", expertise: "skill", languages: "language",
  classId: "class", classIds: "class", speciesIds: "species",
  schools: "school of magic", creatureTypes: "creature type", properties: "weapon property"
};

/** A key holding OBJECTS, one of whose fields is a slug: `grants.spells[].id`, `damage[].type`. */
const ELEMENT_REFERENCES: Readonly<Record<string, Readonly<Record<string, RefKind>>>> = {
  spells: { id: "spell" },          // grants.spells[]
  conditions: { id: "condition" },  // actions[].onHit[].conditions[]
  damage: { type: "damage type" },  // actions[].damage[]
  damageByLevel: { type: "damage type" }
};

/**
 * THE SLUGS DELIBERATELY LEFT OPEN, named here rather than silently skipped, because "we did not
 * think of it" and "there is nothing to check it against" look identical in a walker's absence.
 *
 *   `tags`, `endsWithTag`, `requiresEffectTag`, `while-effect-tag.tags` - the live EFFECT tag
 *       namespace and the sheet's own grouping slugs. Runtime strings, in no bundle.
 *   `uses.pool`, `resource-bonus.poolId` - the live `actionUses` KEY. The schema says so in as many
 *       words: deliberately NOT the class table's `classResources`.
 *   `grants.tools` / `grants.armor` / `grants.weapons` - PROFICIENCY GROUPS, not record ids.
 *       Measured over the shipped bundles: `armor` is `light|medium|heavy|shields` and `weapons` is
 *       `simple|martial`, neither of which is any bundle's id column.
 *   `while-proficient-with.ids` when `kind` is weapon/armor/tool - the same groups. When `kind` is
 *       `"skill"` it IS checked, below.
 *   `sense` - there is no senses model to check against; the disposition table calls it display-only.
 *   `actions[].id`, `multiattack[].actionId`, `uses` shape - local to the item's own action list.
 *   `grants.saves` - `AbilitySchema`, already a closed zod enum; a bad value never reaches here.
 */
export const OPEN_BY_DESIGN: readonly string[] = Object.freeze([
  "tags", "endsWithTag", "requiresEffectTag", "pool", "poolId", "tools", "armor", "weapons", "sense", "saves", "actionId"
]);

/** Levenshtein, only ever run against one vocabulary to turn a refusal into a fix. */
function distance(left: string, right: string): number {
  let previous = [...Array(right.length + 1).keys()];
  for (let index = 0; index < left.length; index++) {
    const current = [index + 1];
    for (let other = 0; other < right.length; other++) {
      current.push(Math.min(previous[other] + (left[index] === right[other] ? 0 : 1), previous[other + 1] + 1, current[other] + 1));
    }
    previous = current;
  }
  return previous[right.length];
}

/** The nearest shipped id, when it is near enough to be the thing the author meant. */
function closest(slug: string, ids: ReadonlySet<string>): string | null {
  let best: string | null = null;
  let bestDistance = Math.min(4, Math.ceil(slug.length / 2));
  for (const id of ids) {
    const measured = distance(slug, id);
    if (measured < bestDistance) { best = id; bestDistance = measured; }
  }
  return best;
}

interface Reference { readonly path: string; readonly kind: RefKind; readonly slug: string }

/**
 * Walk one authored rider structure and collect every slug that points into another bundle.
 *
 * The walk is over the PARSED row's riders rather than the authored input, so it sees the same
 * materialised shape the bundle will carry - a `when: []` the author never wrote included.
 */
function collectReferences(node: unknown, path: string, into: Reference[]): void {
  if (Array.isArray(node)) {
    node.forEach((element, index) => collectReferences(element, `${path}.${index}`, into));
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;

  // `while-proficient-with` is the one trigger whose id list changes vocabulary with a sibling field.
  if (record.type === "while-proficient-with" && Array.isArray(record.ids)) {
    if (record.kind === "skill") {
      record.ids.forEach((id, index) => { if (typeof id === "string") into.push({ path: `${path}.ids.${index}`, kind: "skill", slug: id }); });
    }
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    const here = `${path}${path === "" ? "" : "."}${key}`;
    const kind = SLUG_REFERENCES[key];
    if (kind !== undefined) {
      if (typeof value === "string") into.push({ path: here, kind, slug: value });
      else if (Array.isArray(value)) value.forEach((slug, index) => { if (typeof slug === "string") into.push({ path: `${here}.${index}`, kind, slug }); });
      continue;
    }
    const fields = ELEMENT_REFERENCES[key];
    if (fields !== undefined && Array.isArray(value)) {
      value.forEach((element, index) => {
        if (element === null || typeof element !== "object") return;
        for (const [field, elementKind] of Object.entries(fields)) {
          const slug = (element as Record<string, unknown>)[field];
          if (typeof slug === "string") into.push({ path: `${here}.${index}.${field}`, kind: elementKind, slug });
        }
        collectReferences(element, `${here}.${index}`, into);
      });
      continue;
    }
    collectReferences(value, here, into);
  }
}

// ---------------------------------------------------------------------------------------------
// THE MERGE.
// ---------------------------------------------------------------------------------------------

/** Where a Zod issue landed inside the merged row, for the refusal message. "" at the root. */
const where = (path: ReadonlyArray<string | number>): string => (path.length === 0 ? "" : `${path.join(".")}: `);

/**
 * Why a present rider key authors nothing, or null when it authors something.
 *
 * `undefined` is a key the entry simply did not name and is not a refusal on its own - "the entry
 * named no rider AT ALL" is check 3's other half, below.
 */
function authorsNothing(value: unknown): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length === 0 ? "present but empty" : null;
  if (value === false) return "present but false, which is the default";
  if (value !== null && typeof value === "object") return Object.keys(value).length === 0 ? "present but empty" : null;
  return null;
}

/**
 * Merge the overlay lanes onto the generated rows and RETURN the merged rows.
 *
 * Rows no lane names are returned BY REFERENCE, untouched and unparsed, so an empty overlay is a
 * byte-for-byte no-op on the emitted bundle - which is what makes this seam provably inert until a
 * lane fills it (`test/item-mechanics.test.ts` asserts exactly that against the committed file, and
 * `build-magic-items.ts --out=` asserts it again through the real ETL). Rows a lane does name are
 * re-parsed through `EquipmentReferenceSchema`, so the merged row carries the same materialised
 * defaults the ETL's own `parse` gives every other row.
 *
 * IT TAKES A LIST, NOT A MERGED OBJECT, and that is check 1: object composition would collapse two
 * lanes keyed to the same item before this function could see either of them.
 *
 * It COLLECTS every refusal and throws once, so a lane fixes its module in one pass rather than one
 * run per mistake. It THROWS rather than returning a miss list (the class overlay's shape) because
 * the caller here is a script whose only response is to die, and because a throw is what lets the
 * test assert the message without spawning a build. Nothing is written on any path that refuses.
 */
export function applyItemMechanics(
  rows: readonly EquipmentReference[],
  lanes: readonly ItemMechanicsLane[]
): EquipmentReference[] {
  if (lanes.length === 0) return [...rows];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const merged = new Map<string, EquipmentReference>();
  const claimedBy = new Map<string, string>();
  const refused: string[] = [];
  let entryCount = 0;

  const seenLanes = new Set<string>();
  for (const lane of lanes) {
    if (seenLanes.has(lane.lane)) {
      refused.push(`lane "${lane.lane}" is listed twice in ITEM_MECHANICS_LANES; one lane is one entry in that list`);
      continue;
    }
    seenLanes.add(lane.lane);

    const entries = Object.entries(lane.entries);
    entryCount += entries.length;
    if (entries.length === 0) {
      refused.push(`lane "${lane.lane}" composes no entries at all, so listing it authors nothing; land it with the items it authors, or leave it out of ITEM_MECHANICS_LANES until it has some`);
      continue;
    }
    if (lane.categories.length === 0) {
      refused.push(`lane "${lane.lane}" declares no categories, so nothing can check that its entries are its own; declare the bundle categories it owns`);
      continue;
    }

    for (const [itemId, mechanics] of entries) {
      const at = `[${lane.lane}] ${itemId}`;

      const already = claimedBy.get(itemId);
      if (already !== undefined) {
        refused.push(`${at} - already authored by lane "${already}". Two lanes on one item silently collapse to one when composed, so the seam refuses instead; one item belongs to one lane`);
        continue;
      }
      claimedBy.set(itemId, lane.lane);

      const row = byId.get(itemId);
      if (!row) {
        refused.push(`${at} - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all`);
        continue;
      }

      if (!lane.categories.includes(row.category)) {
        refused.push(`${at} - is a "${row.category}" and lane "${lane.lane}" owns ${lane.categories.map((category) => `"${category}"`).join(", ")}. The lane split is by category (plan §3); author this item in the lane that owns it`);
        continue;
      }

      /**
       * AN UNKNOWN TOP-LEVEL KEY IS A TYPO, AND IT MUST BE LOUD — a regression fix, 2026-08-11.
       *
       * The hardening pass introduced this hole while closing six others. Below, the merged row is
       * built by PICKING the known `ITEM_RIDER_KEYS` out of the entry, so a misspelled key beside a
       * real one (`modifers` next to `modifiers`) is never handed to the schema at all and
       * `.strict()` — which caught it before the hardening — never sees it. The build then exits 0
       * having authored only the half the author spelled correctly, which is the precise failure
       * this whole overlay exists to make impossible.
       *
       * Checked here rather than by spreading the raw entry into the parse, because the pick is what
       * keeps a lane from setting a PARSED column (`slot`, `rarity`, `attunement`) it must not own.
       */
      const unknown = Object.keys(mechanics)
        .filter((key) => !(ITEM_RIDER_KEYS as readonly string[]).includes(key));
      if (unknown.length > 0) {
        refused.push(`${at} - ${unknown.map((key) => `"${key}"`).join(" and ")} ${unknown.length === 1 ? "is not a rider key" : "are not rider keys"}. A key this overlay does not know is silently dropped rather than authored, so it is refused instead. The nine are: ${ITEM_RIDER_KEYS.join(", ")}`);
        continue;
      }

      const empty = ITEM_RIDER_KEYS
        .map((key) => ({ key, reason: authorsNothing(mechanics[key]) }))
        .filter((named): named is { key: ItemRiderKey; reason: string } => named.reason !== null);
      if (empty.length > 0) {
        refused.push(`${at} - ${empty.map((named) => `"${named.key}" is ${named.reason}`).join(" and ")}, which authors nothing. Drop the key, or author the rider you meant`);
        continue;
      }

      const riders = ITEM_RIDER_KEYS.filter((key) => mechanics[key] !== undefined);
      if (riders.length === 0) {
        refused.push(`${at} - the entry names no rider; record a named absence as a comment beside it, not as an empty entry`);
        continue;
      }

      const parsed = EquipmentReferenceSchema.safeParse({ ...row, ...Object.fromEntries(riders.map((key) => [key, mechanics[key]])) });
      if (!parsed.success) {
        refused.push(`${at} - the schema refuses the merged row. ${parsed.error.issues.map((issue) => `${where(issue.path)}${issue.message}`).join(" | ")}`);
        continue;
      }

      // Only the ITEM's own `modifiers` are `FeatureModifier`s; `effects[].modifiers` are the
      // actor-side `EffectModifier` union, which the disposition table does not describe.
      const unread = parsed.data.modifiers
        .map((modifier, index) => ({ index, type: modifier.type }))
        .filter((modifier) => UNREAD_RIDER_TYPES.has(modifier.type));
      if (unread.length > 0) {
        refused.push(`${at} - ${unread.map((modifier) => `modifiers.${modifier.index} is "${modifier.type}"`).join(" and ")}, which CARRIER_RIDER_DISPOSITION (apps/server/src/character-build.ts) marks "unread": the rider reaches derivation and no consumer applies it yet, so it would change nothing at the table. Record it as a named absence in a comment, with the unit that unblocks it`);
        continue;
      }

      const references: Reference[] = [];
      collectReferences(Object.fromEntries(riders.map((key) => [key, parsed.data[key]])), "", references);
      const unresolved = references.filter((reference) => !vocabulary(reference.kind).has(reference.slug));
      if (unresolved.length > 0) {
        refused.push(`${at} - a rider pointing at an id nothing resolves parses, ships, and is silent at the table: ${unresolved.map((reference) => {
          const suggestion = closest(reference.slug, vocabulary(reference.kind));
          return `${reference.path} names "${reference.slug}", which is no ${reference.kind} this content ships (${VOCABULARIES[reference.kind].source})${suggestion ? `; did you mean "${suggestion}"?` : ""}`;
        }).join(" | ")}`);
        continue;
      }

      merged.set(itemId, parsed.data);
    }
  }

  if (refused.length > 0) {
    throw new Error(
      `item-mechanics: ${refused.length} ${refused.length === 1 ? "refusal" : "refusals"} across ${lanes.length} lane(s) and ${entryCount} entr${entryCount === 1 ? "y" : "ies"}; the bundle is NOT written.\n` +
      `${refused.map((line) => `  ${line}\n`).join("")}` +
      `Fix it in scripts/item-mechanics/ - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud.`
    );
  }

  return rows.map((row) => merged.get(row.id) ?? row);
}

/** The two key tables the walker resolves against, exported for its own coverage test. */
export const CHECKED_SLUG_KEYS = Object.freeze([...Object.keys(SLUG_REFERENCES), ...Object.keys(ELEMENT_REFERENCES)]);

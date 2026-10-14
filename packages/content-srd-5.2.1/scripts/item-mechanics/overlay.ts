/**
 * The item mechanics overlay: hand-authored riders merged over the ETL-generated magic items. The ETL
 * emits content only; riders edited into the generated bundle would be lost on the next build, so they
 * are authored here and merged at build time.
 *
 * Unlike the class overlay, this one may overwrite freely: the magic-item bundle is output only and
 * rebuilt from scratch every run, so it needs no `clears`.
 *
 * Every refusal below guards against a lane authoring nothing while the build stays quiet:
 *
 *   1. Lanes are list entries, not an object spread, so two lanes keyed to one item are both seen
 *      and refused.
 *   2. An id no row carries.
 *   3. An entry naming no rider, or only empty ones (`{modifiers: []}`, `{grants: {}}`,
 *      `{cursed: false}`). Record an absence as a comment, never as an empty entry.
 *   4. An entry outside its lane's categories, or its declared slots (`slots` separates the two
 *      lanes sharing `wondrous-item`).
 *   5. A slug pointing into another bundle that nothing resolves (`fyre-ball`).
 *   6. A rider type no consumer reads: `"unread"` in the server's disposition table, or one of the
 *      types measured inert on an item carrier.
 *   7. A merged row the schema refuses. The refusals are the schema's; the merge re-parses each
 *      touched row so the error names the item.
 */
import type { z } from "zod";
import { EquipmentReferenceSchema, type EquipmentReference } from "../../src/schemas.js";
import {
  CONDITION_IDS, CREATURE_TYPE_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS, WEAPON_PROPERTY_IDS
} from "../../src/enums.js";
import { loadClasses, loadFeats, loadLanguages, loadSkills, loadSpecies, loadSpells, loadWeapons } from "../../src/index.js";

/** Typed off the schema's input so `.default()`ed keys need not be restated; the merge re-parses each row. */
type ItemInput = z.input<typeof EquipmentReferenceSchema>;

/**
 * The rider keys an overlay may author: the six `featureRiders` plus the magic-item columns. Parsed
 * columns (`slot`, `rarity`, `attunement`, `category`, prose...) are excluded; they come from the SRD
 * text. A curse therefore needs an item the SRD already gates behind attunement.
 */
export type ItemRiderKey =
  | "tags" | "actions" | "effects" | "uses" | "grants" | "modifiers"
  | "cursed" | "casts" | "grantsFeatIds";

/** The same nine, as a value, so the empty-rider check below iterates the list it is typed against. */
const ITEM_RIDER_KEYS: readonly ItemRiderKey[] = Object.freeze([
  "tags", "actions", "effects", "uses", "grants", "modifiers", "cursed", "casts", "grantsFeatIds"
] as const);

/** The riders one magic item may carry. Every key optional: an entry authors only what it names. */
export type ItemMechanics = Partial<Pick<ItemInput, ItemRiderKey>>;

/** One lane file's riders, keyed by magic-item id as the bundle spells it. Item ids are unique, so the key is flat. */
export type ItemMechanicsModule = Readonly<Record<string, ItemMechanics>>;

/**
 * One lane, attributed, so refusals can name it. `categories` are `EquipmentReference.category`
 * values. Two lanes share `wondrous-item`, so `slots` optionally narrows a lane by the `slot` column.
 */
export interface ItemMechanicsLane {
  /** The unit that owns this lane ("C7a"...), used in refusal messages. */
  readonly lane: string;
  /** The bundle categories this lane owns. An entry on a row outside them is refused. */
  readonly categories: readonly string[];
  /**
   * The `EquipmentReference.slot` values this lane owns, checked like `categories`. Omitted = category
   * check only. Present-but-empty is refused: it would match no row.
   */
  readonly slots?: readonly string[];
  /** This lane's riders, keyed by magic-item id. */
  readonly entries: ItemMechanicsModule;
}

// ---- The admission rule (check 6) ---------------------------------------------------------------

/**
 * A mirror of `CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts`); importing it would
 * invert the dependency edge (`apps/server` depends on this package), and it is not exported.
 * `test/item-mechanics.test.ts` fails if the two drift. `"unread"` means no consumer applies the
 * rider yet.
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
  "damage-bonus": "standing",
  "check-bonus": "standing",
  "spell-attack-bonus": "unread",
  "damage-reduction": "at-its-moment",
  sense: "display-only"
});

/**
 * Derived from the mirror. `display-only` is not refused here because the set must match the server
 * table, but `sense` riders on items do reach nothing; see `MEASURED_INERT_RIDER_TYPES`.
 */
const UNREAD_RIDER_TYPES: ReadonlySet<string> = new Set(
  Object.entries(CARRIER_RIDER_DISPOSITION_MIRROR).filter(([, disposition]) => disposition === "unread").map(([type]) => type)
);

/**
 * Rider types measured inert on an item carrier, kept apart from the mirror so it stays derivable
 * from the server's table: `speed` is summed into `derivation.speed` and never read; `darkvision` and
 * `sense` have no field in `EquipmentDerivation` (the sheet's Senses line comes from the species).
 */
const MEASURED_INERT_RIDER_TYPES: ReadonlySet<string> = new Set(["speed", "darkvision", "sense"]);

// ---- Cross-bundle vocabularies (check 5) --------------------------------------------------------

type RefKind =
  | "spell" | "feat" | "skill" | "language" | "class" | "species"
  | "damage type" | "condition" | "school of magic" | "creature type" | "weapon property"
  | "weapon proficiency";

/** Where each kind's ids come from, loaded lazily so an empty overlay reads no bundle. */
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
  "weapon property": { source: "src/enums.ts WEAPON_PROPERTY_IDS", ids: () => WEAPON_PROPERTY_IDS },
  /**
   * `weaponAction` grants proficiency if `grants.weapons` names the weapon's category or its id, so
   * both are valid here, read off `bundles/weapons.v1.json`.
   */
  "weapon proficiency": {
    source: "bundles/weapons.v1.json (a weapon id, or one of its `category` groups)",
    ids: () => { const weapons = loadWeapons(); return [...weapons.map((record) => record.id), ...new Set(weapons.map((record) => record.category))]; }
  }
};

const resolved = new Map<RefKind, ReadonlySet<string>>();
const vocabulary = (kind: RefKind): ReadonlySet<string> => {
  let ids = resolved.get(kind);
  if (!ids) { ids = new Set(VOCABULARIES[kind].ids()); resolved.set(kind, ids); }
  return ids;
};

/**
 * Keys whose value is a slug (or list of them) pointing into another bundle. `id` and `type` mean
 * different things in different parents, so they are handled by `ELEMENT_REFERENCES` instead.
 */
const SLUG_REFERENCES: Readonly<Record<string, RefKind>> = {
  spellId: "spell", spellIds: "spell", grantsFeatIds: "feat",
  damageType: "damage type", damageTypes: "damage type",
  damageResistances: "damage type", damageImmunities: "damage type",
  conditionId: "condition", conditionIds: "condition", conditionImmunities: "condition",
  skills: "skill", expertise: "skill", languages: "language",
  classId: "class", classIds: "class", speciesIds: "species",
  schools: "school of magic", creatureTypes: "creature type", properties: "weapon property",
  weapons: "weapon proficiency"
};

/** A key holding objects, one of whose fields is a slug: `grants.spells[].id`, `damage[].type`. */
const ELEMENT_REFERENCES: Readonly<Record<string, Readonly<Record<string, RefKind>>>> = {
  spells: { id: "spell" },          // grants.spells[]
  conditions: { id: "condition" },  // actions[].onHit[].conditions[]
  damage: { type: "damage type" },  // actions[].damage[]
  damageByLevel: { type: "damage type" }
};

/**
 * Slugs deliberately not checked:
 *
 *   `tags`, `endsWithTag`, `requiresEffectTag`, `while-effect-tag.tags` - runtime effect tags, in no bundle.
 *   `uses.pool`, `resource-bonus.poolId` - the live `actionUses` key, not a bundle id.
 *   `grants.tools` / `grants.armor` - proficiency groups; no bundle has those ids.
 *   `while-proficient-with.ids` for weapon/armor/tool - groups (the `"skill"` kind is checked).
 *   `sense` - no senses model to check against.
 *   `actions[].id`, `multiattack[].actionId` - local to the item's own action list.
 *   `grants.saves` - already a closed zod enum.
 */
export const OPEN_BY_DESIGN: readonly string[] = Object.freeze([
  "tags", "endsWithTag", "requiresEffectTag", "pool", "poolId", "tools", "armor", "sense", "saves", "actionId"
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

/** Collect every cross-bundle slug in the parsed riders (so materialised defaults are included). */
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

// ---- The merge ----------------------------------------------------------------------------------

/** Where a Zod issue landed inside the merged row, for the refusal message. "" at the root. */
const where = (path: ReadonlyArray<string | number>): string => (path.length === 0 ? "" : `${path.join(".")}: `);

/** Why a present rider key authors nothing, or null when it authors something (or is undefined). */
function authorsNothing(value: unknown): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length === 0 ? "present but empty" : null;
  if (value === false) return "present but false, which is the default";
  if (value !== null && typeof value === "object") return Object.keys(value).length === 0 ? "present but empty" : null;
  return null;
}

/**
 * Merge the overlay lanes onto the generated rows. Rows no lane names are returned by reference,
 * unparsed, so an empty overlay is a byte-for-byte no-op; named rows are re-parsed through
 * `EquipmentReferenceSchema` so they carry the same materialised defaults as every other row.
 *
 * Collects every refusal and throws once, so a lane can fix its module in one pass.
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
    // Present-but-empty `slots` would admit no row.
    if (lane.slots !== undefined && lane.slots.length === 0) {
      refused.push(`lane "${lane.lane}" declares an empty "slots" list, which matches no row at all; name the slots it owns, or omit the field to be checked by category alone`);
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

      // A row with no `slot` fails a declared list: a missing column is not evidence the item belongs here.
      if (lane.slots !== undefined && !lane.slots.includes(row.slot ?? "")) {
        refused.push(`${at} - has slot ${row.slot === undefined ? "(none)" : `"${row.slot}"`} and lane "${lane.lane}" owns ${lane.slots.map((slot) => `"${slot}"`).join(", ")}. Two lanes share the "${row.category}" category, so the slot is what divides them (plan §3); author this item in the lane that owns it`);
        continue;
      }

      /**
       * The merged row is built by picking known rider keys (so a lane cannot set parsed columns like
       * `slot`), which means a misspelled key would never reach `.strict()`. Refuse unknown keys explicitly.
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

      // Only the item's own `modifiers` are `FeatureModifier`s; `effects[].modifiers` are a different union.
      const unread = parsed.data.modifiers
        .map((modifier, index) => ({ index, type: modifier.type }))
        .filter((modifier) => UNREAD_RIDER_TYPES.has(modifier.type));
      if (unread.length > 0) {
        refused.push(`${at} - ${unread.map((modifier) => `modifiers.${modifier.index} is "${modifier.type}"`).join(" and ")}, which CARRIER_RIDER_DISPOSITION (apps/server/src/character-build.ts) marks "unread": the rider reaches derivation and no consumer applies it yet, so it would change nothing at the table. Record it as a named absence in a comment, with the unit that unblocks it`);
        continue;
      }

      const inert = parsed.data.modifiers
        .map((modifier, index) => ({ index, type: modifier.type }))
        .filter((modifier) => MEASURED_INERT_RIDER_TYPES.has(modifier.type));
      if (inert.length > 0) {
        refused.push(`${at} - ${inert.map((modifier) => `modifiers.${modifier.index} is "${modifier.type}"`).join(" and ")}, which C7c measured (limit W2) as reaching NOTHING from an item: derivation.speed is written and never read, and EquipmentDerivation carries no darkvision or senses field at all, so the sheet's Senses line comes from the definition's species extension and never from an item. The rider would parse, ship, and change nothing at the table. Record it as a named absence in a comment, with the unit that unblocks it`);
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

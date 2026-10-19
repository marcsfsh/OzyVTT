/**
 * The item mechanics overlay: the riders in `./items.ts` merged over the ETL-generated magic items.
 * The ETL emits content only, and the bundle is output only, so riders are authored there and merged
 * at build time.
 *
 * Every refusal below guards against an entry authoring nothing while the build stays quiet:
 *
 *   1. An id no row carries.
 *   2. An entry naming no rider, or only empty ones (`{modifiers: []}`, `{grants: {}}`,
 *      `{cursed: false}`), or a key that is not a rider.
 *   3. A slug pointing into another bundle that nothing resolves (`fyre-ball`).
 *   4. A rider type no consumer reads: `"unread"` in the server's disposition table, or one of the
 *      types measured inert on an item carrier.
 *   5. A merged row the schema refuses. The refusals are the schema's; the merge re-parses each
 *      touched row so the error names the item.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { EquipmentReferenceSchema, type EquipmentReference } from "../../src/schemas.js";
import {
  CONDITION_IDS,
  CREATURE_TYPE_IDS,
  DAMAGE_TYPE_IDS,
  MAGIC_SCHOOL_IDS,
  WEAPON_PROPERTY_IDS
} from "../../src/enums.js";

/** Typed off the schema's input so `.default()`ed keys need not be restated; the merge re-parses each row. */
type ItemInput = z.input<typeof EquipmentReferenceSchema>;

/**
 * The rider keys an overlay may author: the six `featureRiders` plus the magic-item columns. Parsed
 * columns (`slot`, `rarity`, `attunement`, `category`, prose...) are excluded; they come from the SRD
 * text. A curse therefore needs an item the SRD already gates behind attunement.
 */
export type ItemRiderKey =
  | "tags"
  | "actions"
  | "effects"
  | "uses"
  | "grants"
  | "modifiers"
  | "cursed"
  | "casts"
  | "grantsFeatIds"
  | "charges"
  | "damageTypeChoice"
  | "vulnerableToOtherChoices"
  | "removesArmorDrawbacks"
  | "consumedOnUse"
  | "spellScroll"
  | "onHit"
  | "study";

/** The same seventeen, as a value, so the empty-rider check below iterates the list it is typed against. */
const ITEM_RIDER_KEYS: readonly ItemRiderKey[] = Object.freeze([
  "tags",
  "actions",
  "effects",
  "uses",
  "grants",
  "modifiers",
  "cursed",
  "casts",
  "grantsFeatIds",
  "charges",
  "damageTypeChoice",
  "vulnerableToOtherChoices",
  "removesArmorDrawbacks",
  "consumedOnUse",
  "spellScroll",
  "onHit",
  "study"
] as const);

/** The riders one magic item may carry. Every key optional: an entry authors only what it names. */
export type ItemMechanics = Partial<Pick<ItemInput, ItemRiderKey>>;

/** Riders keyed by magic-item id as the bundle spells it. */
export type ItemMechanicsModule = Readonly<Record<string, ItemMechanics>>;

// ---- The admission rule (check 4) ---------------------------------------------------------------

/**
 * A mirror of `CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts`); importing it would
 * invert the dependency edge (`apps/server` depends on this package), and it is not exported.
 * `test/item-mechanics.test.ts` fails if the two drift. `"unread"` means no consumer applies the
 * rider yet.
 */
export const CARRIER_RIDER_DISPOSITION_MIRROR: Readonly<
  Record<string, "standing" | "at-its-moment" | "unread" | "display-only">
> = Object.freeze({
  "attack-bonus": "standing",
  "save-bonus": "standing",
  "spell-save-dc": "standing",
  "spell-slot": "standing",
  "resource-bonus": "standing",
  "short-rest-regain": "standing",
  "critical-range": "standing",
  "critical-bonus-dice": "standing",
  "extra-attack": "standing",
  "armor-class": "standing",
  "attunement-slots": "standing",
  "special-speed": "standing",
  "roll-mode": "at-its-moment",
  "extra-damage": "at-its-moment",
  "damage-bonus": "standing",
  "check-bonus": "standing",
  "spell-attack-bonus": "standing",
  "damage-reduction": "at-its-moment",
  "damage-resistance": "standing",
  "damage-vulnerability": "standing",
  sense: "display-only"
});

/**
 * Derived from the mirror. `display-only` is not refused here because the set must match the server
 * table, but `sense` riders on items do reach nothing; see `MEASURED_INERT_RIDER_TYPES`.
 */
const UNREAD_RIDER_TYPES: ReadonlySet<string> = new Set(
  Object.entries(CARRIER_RIDER_DISPOSITION_MIRROR)
    .filter(([, disposition]) => disposition === "unread")
    .map(([type]) => type)
);

/**
 * Rider types measured inert on an item carrier, kept apart from the mirror so it stays derivable
 * from the server's table: `darkvision` and `sense` have no field in `EquipmentDerivation` (the
 * sheet's Senses line comes from the species).
 */
const MEASURED_INERT_RIDER_TYPES: ReadonlySet<string> = new Set(["darkvision", "sense"]);

// ---- Cross-bundle vocabularies (check 3) --------------------------------------------------------

type RefKind =
  | "spell"
  | "feat"
  | "skill"
  | "language"
  | "class"
  | "species"
  | "damage type"
  | "condition"
  | "school of magic"
  | "creature type"
  | "weapon property"
  | "weapon proficiency";

/** The committed bundles, which the cross-check reads unless the build hands it its own output directory. */
const BUNDLES = fileURLToPath(new URL("../../bundles", import.meta.url));

/** The `id` (and any other columns) of every record in one bundle of `dir`. */
const records = (dir: string, file: string): ReadonlyArray<{ readonly id: string; readonly category?: string }> =>
  JSON.parse(readFileSync(join(dir, file), "utf8")) as Array<{ id: string; category?: string }>;
const idsIn = (dir: string, file: string): readonly string[] => records(dir, file).map((record) => record.id);

/** Where each kind's ids come from, read lazily so an entry with no slug reads no bundle. */
const VOCABULARIES: Readonly<
  Record<RefKind, { readonly source: string; readonly ids: (dir: string) => readonly string[] }>
> = {
  spell: { source: "bundles/spells.v1.json", ids: (dir) => idsIn(dir, "spells.v1.json") },
  feat: { source: "bundles/feats.v1.json", ids: (dir) => idsIn(dir, "feats.v1.json") },
  skill: { source: "bundles/skills.v1.json", ids: (dir) => idsIn(dir, "skills.v1.json") },
  language: { source: "bundles/languages.v1.json", ids: (dir) => idsIn(dir, "languages.v1.json") },
  class: { source: "bundles/classes.v1.json", ids: (dir) => idsIn(dir, "classes.v1.json") },
  species: { source: "bundles/species.v1.json", ids: (dir) => idsIn(dir, "species.v1.json") },
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
    ids: (dir) => {
      const weapons = records(dir, "weapons.v1.json");
      return [...weapons.map((record) => record.id), ...new Set(weapons.map((record) => record.category ?? ""))];
    }
  }
};

/**
 * Keys whose value is a slug (or list of them) pointing into another bundle. `id` and `type` mean
 * different things in different parents, so they are handled by `ELEMENT_REFERENCES` instead.
 */
const SLUG_REFERENCES: Readonly<Record<string, RefKind>> = {
  spellId: "spell",
  spellIds: "spell",
  grantsFeatIds: "feat",
  damageType: "damage type",
  damageTypes: "damage type",
  damageResistances: "damage type",
  damageImmunities: "damage type",
  conditionId: "condition",
  conditionIds: "condition",
  conditionImmunities: "condition",
  skills: "skill",
  expertise: "skill",
  languages: "language",
  classId: "class",
  classIds: "class",
  speciesIds: "species",
  schools: "school of magic",
  creatureTypes: "creature type",
  properties: "weapon property",
  weapons: "weapon proficiency"
};

/** A key holding objects, one of whose fields is a slug: `grants.spells[].id`, `damage[].type`. */
const ELEMENT_REFERENCES: Readonly<Record<string, Readonly<Record<string, RefKind>>>> = {
  spells: { id: "spell" }, // grants.spells[]
  conditions: { id: "condition" }, // actions[].onHit[].conditions[]
  damage: { type: "damage type" }, // actions[].damage[]
  damageByLevel: { type: "damage type" }
};

/**
 * Slugs deliberately not checked:
 *
 *   `tags`, `endsWithTag`, `requiresEffectTag`, `while-effect-tag.tags` - runtime effect tags, in no bundle.
 *   `uses.pool`, `resource-bonus.poolId`: the live `actionUses` key.
 *   `grants.tools` / `grants.armor` - proficiency groups; no bundle has those ids.
 *   `while-proficient-with.ids` for weapon/armor/tool: groups (the `"skill"` kind is checked).
 *   `sense` - no senses model to check against.
 *   `actions[].id`, `multiattack[].actionId` - local to the item's own action list.
 *   `grants.saves` - already a closed zod enum.
 */
export const OPEN_BY_DESIGN: readonly string[] = Object.freeze([
  "tags",
  "endsWithTag",
  "requiresEffectTag",
  "pool",
  "poolId",
  "tools",
  "armor",
  "sense",
  "saves",
  "actionId"
]);

/** Levenshtein, only ever run against one vocabulary to turn a refusal into a fix. */
function distance(left: string, right: string): number {
  let previous = [...Array(right.length + 1).keys()];
  for (let index = 0; index < left.length; index++) {
    const current = [index + 1];
    for (let other = 0; other < right.length; other++) {
      current.push(
        Math.min(previous[other] + (left[index] === right[other] ? 0 : 1), previous[other + 1] + 1, current[other] + 1)
      );
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
    if (measured < bestDistance) {
      best = id;
      bestDistance = measured;
    }
  }
  return best;
}

interface Reference {
  readonly path: string;
  readonly kind: RefKind;
  readonly slug: string;
}

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
      record.ids.forEach((id, index) => {
        if (typeof id === "string") into.push({ path: `${path}.ids.${index}`, kind: "skill", slug: id });
      });
    }
    return;
  }

  for (const [key, value] of Object.entries(record)) {
    const here = `${path}${path === "" ? "" : "."}${key}`;
    const kind = SLUG_REFERENCES[key];
    if (kind !== undefined) {
      if (typeof value === "string") into.push({ path: here, kind, slug: value });
      else if (Array.isArray(value))
        value.forEach((slug, index) => {
          if (typeof slug === "string") into.push({ path: `${here}.${index}`, kind, slug });
        });
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
const where = (path: ReadonlyArray<PropertyKey>): string =>
  path.length === 0 ? "" : `${path.map(String).join(".")}: `;

/** Why a present rider key authors nothing, or null when it authors something (or is undefined). */
function authorsNothing(value: unknown): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.length === 0 ? "present but empty" : null;
  if (value === false) return "present but false, which is the default";
  if (value !== null && typeof value === "object") return Object.keys(value).length === 0 ? "present but empty" : null;
  return null;
}

/**
 * Merge the authored riders onto the generated rows. Rows with no entry are returned by reference,
 * unparsed, so an empty overlay is a byte-for-byte no-op; named rows are re-parsed through
 * `EquipmentReferenceSchema` so they carry the same materialised defaults as every other row.
 * Slugs are resolved against the bundles in `bundleDir`.
 *
 * Collects every refusal and throws once, so every mistake is fixed in one pass.
 */
export function applyItemMechanics(
  rows: readonly EquipmentReference[],
  mechanics: ItemMechanicsModule,
  bundleDir: string = BUNDLES
): EquipmentReference[] {
  const entries = Object.entries(mechanics);
  if (entries.length === 0) return [...rows];

  const resolved = new Map<RefKind, ReadonlySet<string>>();
  const vocabulary = (kind: RefKind): ReadonlySet<string> => {
    let ids = resolved.get(kind);
    if (!ids) {
      ids = new Set(VOCABULARIES[kind].ids(bundleDir));
      resolved.set(kind, ids);
    }
    return ids;
  };

  const byId = new Map(rows.map((row) => [row.id, row]));
  const merged = new Map<string, EquipmentReference>();
  const refused: string[] = [];

  for (const [itemId, entry] of entries) {
    const row = byId.get(itemId);
    if (!row) {
      refused.push(
        `${itemId} - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all`
      );
      continue;
    }

    /**
     * The merged row is built by picking known rider keys (so an entry cannot set parsed columns like
     * `slot`), which means a misspelled key would never reach `.strict()`. Refuse unknown keys explicitly.
     */
    const unknown = Object.keys(entry).filter((key) => !(ITEM_RIDER_KEYS as readonly string[]).includes(key));
    if (unknown.length > 0) {
      refused.push(
        `${itemId} - ${unknown.map((key) => `"${key}"`).join(" and ")} ${unknown.length === 1 ? "is not a rider key" : "are not rider keys"}. A key this overlay does not know is silently dropped rather than authored, so it is refused instead. The seventeen are: ${ITEM_RIDER_KEYS.join(", ")}`
      );
      continue;
    }

    const empty = ITEM_RIDER_KEYS.map((key) => ({ key, reason: authorsNothing(entry[key]) })).filter(
      (named): named is { key: ItemRiderKey; reason: string } => named.reason !== null
    );
    if (empty.length > 0) {
      refused.push(
        `${itemId} - ${empty.map((named) => `"${named.key}" is ${named.reason}`).join(" and ")}, which authors nothing. Drop the key, or author the rider you meant`
      );
      continue;
    }

    const riders = ITEM_RIDER_KEYS.filter((key) => entry[key] !== undefined);
    if (riders.length === 0) {
      refused.push(`${itemId} - the entry names no rider; leave a prose-only item out of the map instead`);
      continue;
    }

    const parsed = EquipmentReferenceSchema.safeParse({
      ...row,
      ...Object.fromEntries(riders.map((key) => [key, entry[key]]))
    });
    if (!parsed.success) {
      refused.push(
        `${itemId} - the schema refuses the merged row. ${parsed.error.issues.map((issue) => `${where(issue.path)}${issue.message}`).join(" | ")}`
      );
      continue;
    }

    // The item's own `modifiers`; its `effects[].modifiers` are refused per type by `EffectModifiersSchema`.
    const unread = parsed.data.modifiers
      .map((modifier, index) => ({ index, type: modifier.type }))
      .filter((modifier) => UNREAD_RIDER_TYPES.has(modifier.type));
    if (unread.length > 0) {
      refused.push(
        `${itemId} - ${unread.map((modifier) => `modifiers.${modifier.index} is "${modifier.type}"`).join(" and ")}, which CARRIER_RIDER_DISPOSITION (apps/server/src/character-build.ts) marks "unread": the rider reaches derivation and no consumer applies it yet, so it would change nothing at the table. Leave the item prose until a consumer reads it`
      );
      continue;
    }

    const inert = parsed.data.modifiers
      .map((modifier, index) => ({ index, type: modifier.type }))
      .filter((modifier) => MEASURED_INERT_RIDER_TYPES.has(modifier.type));
    if (inert.length > 0) {
      refused.push(
        `${itemId} - ${inert.map((modifier) => `modifiers.${modifier.index} is "${modifier.type}"`).join(" and ")}, which reaches NOTHING from an item: EquipmentDerivation carries no darkvision or senses field at all, so the sheet's Senses line comes from the definition's species extension and never from an item. The rider would parse, ship, and change nothing at the table. Leave the item prose until a consumer reads it`
      );
      continue;
    }

    const references: Reference[] = [];
    collectReferences(Object.fromEntries(riders.map((key) => [key, parsed.data[key]])), "", references);
    const unresolved = references.filter((reference) => !vocabulary(reference.kind).has(reference.slug));
    if (unresolved.length > 0) {
      refused.push(
        `${itemId} - a rider pointing at an id nothing resolves parses, ships, and is silent at the table: ${unresolved
          .map((reference) => {
            const suggestion = closest(reference.slug, vocabulary(reference.kind));
            return `${reference.path} names "${reference.slug}", which is no ${reference.kind} this content ships (${VOCABULARIES[reference.kind].source})${suggestion ? `; did you mean "${suggestion}"?` : ""}`;
          })
          .join(" | ")}`
      );
      continue;
    }

    merged.set(itemId, parsed.data);
  }

  if (refused.length > 0) {
    throw new Error(
      `item-mechanics: ${refused.length} ${refused.length === 1 ? "refusal" : "refusals"} across ${entries.length} entr${entries.length === 1 ? "y" : "ies"}; the bundle is NOT written.\n` +
        `${refused.map((line) => `  ${line}\n`).join("")}` +
        `Fix it in scripts/item-mechanics/items.ts - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud.`
    );
  }

  return rows.map((row) => merged.get(row.id) ?? row);
}

/** The two key tables the walker resolves against, exported for its own coverage test. */
export const CHECKED_SLUG_KEYS = Object.freeze([...Object.keys(SLUG_REFERENCES), ...Object.keys(ELEMENT_REFERENCES)]);

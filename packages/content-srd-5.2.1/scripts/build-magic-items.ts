/**
 * Magic-item ETL. Reads `sources/dnd-5e-srd-markdown/magic-items.md` (CC BY 4.0 SRD 5.2.1, pinned by
 * `test/magic-item-source.test.ts`) and emits `magic-items.v1.json`, which `loadEquipment()` folds
 * into the addable catalog.
 *
 * The parse emits content (slot, rarity, attunement, prose); mechanics come from
 * `scripts/item-mechanics/items.ts`, merged at step 7.
 *
 * Step 4 of `npm run content`: bases resolve against the weapons and armor bundles, and minted ids are
 * checked against the equipment bundle, all written by the earlier steps.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ItemSlotSchema } from "@vtt/schemas";
import {
  ArmorReferenceSchema,
  EquipmentReferenceSchema,
  WeaponReferenceSchema,
  type EquipmentReference,
  type ItemAppliesTo
} from "../src/schemas.js";
import { RARITY_IDS } from "../src/enums.js";
import { slug, withTables } from "./markdown.js";
import { ITEM_MECHANICS } from "./item-mechanics/items.js";
import { applyItemMechanics } from "./item-mechanics/overlay.js";
import { outDir, sourcePath } from "./paths.js";

const source = readFileSync(sourcePath("dnd-5e-srd-markdown", "magic-items.md"), "utf8");

const die = (message: string): never => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

// ---- 1. The section, and what counts as an item inside it ---------------------------------------

// Scoped to the A-Z section: four `####` rules subsections sit above it.
const lines = source.split("\n");
const azIndex = lines.findIndex((line) => line.startsWith("## Magic Items A"));
if (azIndex < 0) die("The `## Magic Items A-Z` heading is gone from the vendored source. The parse cannot be scoped.");

interface Entry {
  readonly name: string;
  readonly typeLine: string;
  readonly body: string;
  readonly line: number;
}

const entries: Entry[] = [];
for (let index = azIndex; index < lines.length; index++) {
  if (!lines[index].startsWith("#### ")) continue;
  let cursor = index + 1;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor++;
  const typeLine = (lines[cursor] ?? "").trim();
  const body: string[] = [];
  for (
    let scan = cursor + 1;
    scan < lines.length && !lines[scan].startsWith("#### ") && !lines[scan].startsWith("## ");
    scan++
  ) {
    body.push(lines[scan]);
  }
  entries.push({ name: lines[index].slice(5).trim(), typeLine, body: body.join("\n").trim(), line: index + 1 });
}

/**
 * Items are told apart from the two embedded creature stat blocks by the category word, not by
 * italics: every entry in the run has an italic second line.
 */
const CATEGORY_WORDS = [
  "Wondrous Item",
  "Weapon",
  "Potion",
  "Ring",
  "Armor",
  "Wand",
  "Staff",
  "Rod",
  "Scroll"
] as const;
type CategoryWord = (typeof CATEGORY_WORDS)[number];

/** The two creature stat blocks in the run. Named and counted - a silent filter hides a parse bug. */
const NOT_ITEMS = ["Giant Fly", "Avatar of Death"] as const;

const unItalic = (value: string) => value.replace(/^_/, "").replace(/_$/, "");
const categoryOf = (typeLine: string): CategoryWord | undefined =>
  CATEGORY_WORDS.find((word) => unItalic(typeLine).startsWith(word));

const items = entries.filter((entry) => categoryOf(entry.typeLine));
const skipped = entries.filter((entry) => !categoryOf(entry.typeLine));

if (entries.length !== 260)
  die(
    `Expected 260 entries under the A-Z heading, parsed ${entries.length}. The source moved; re-read the pin in test/magic-item-source.test.ts.`
  );
if (skipped.map((entry) => entry.name).join("|") !== NOT_ITEMS.join("|")) {
  die(
    `The non-item entries are meant to be exactly ${NOT_ITEMS.join(" and ")}; parsed [${skipped.map((entry) => entry.name).join(", ")}].`
  );
}
if (items.length !== 258) die(`Expected 258 items, parsed ${items.length}.`);

// ---- 2. The type line: category, qualifier, rarity, attunement ----------------------------------

interface TypeLine {
  readonly category: CategoryWord;
  /** The parenthetical right after the category word - "Shield", "Any Ammunition", "Dagger" - or null. */
  readonly qualifier: string | null;
  /** The rarity segment with the attunement clause removed: "Rare", "Rarity Varies", or a ladder. */
  readonly rarity: string;
  /** The printed clause, verbatim: "" or " by a Spellcaster". Null when the line requires none. */
  readonly attunementClause: string | null;
  readonly attunement: { readonly required: boolean; readonly restrictedTo: readonly string[] };
}

/**
 * "by a Bard, Cleric, or Druid" -> ["bard", "cleric", "druid"]. Display-only, so each audience is a
 * readable slug rather than a resolvable id ("a Creature Attuned to a Belt of Dwarvenkind" stays one).
 */
function restrictions(clause: string): readonly string[] {
  const body = clause.replace(/^\s*by\s+/i, "").trim();
  if (body === "") return [];
  return body
    .split(/,\s*(?:or\s+)?|\s+or\s+/i)
    .map((part) => slug(part.replace(/^(an?|the)\s+/i, "")))
    .filter((part) => part.length > 0);
}

function parseTypeLine(entry: Entry): TypeLine {
  const text = unItalic(entry.typeLine);
  const category = categoryOf(entry.typeLine);
  if (!category) return die(`${entry.name} (line ${entry.line}): the type line names no category word.`);
  let rest = text.slice(category.length);
  const qualifierMatch = rest.match(/^\s*\(([^)]*)\)/);
  const qualifier = qualifierMatch ? qualifierMatch[1] : null;
  if (qualifierMatch) rest = rest.slice(qualifierMatch[0].length);
  rest = rest.replace(/^\s*,\s*/, "");
  // The attunement clause always closes the line, after the rarity - including after a ladder.
  const attunementMatch = rest.match(/\(Requires Attunement([^)]*)\)\s*$/i);
  const rarity = rest.replace(/\s*\(Requires Attunement[^)]*\)\s*$/i, "").trim();
  if (rarity === "") die(`${entry.name} (line ${entry.line}): no rarity segment in "${text}".`);
  return {
    category,
    qualifier,
    rarity,
    attunementClause: attunementMatch ? attunementMatch[1] : null,
    attunement: {
      required: attunementMatch !== null,
      restrictedTo: attunementMatch ? restrictions(attunementMatch[1]) : []
    }
  };
}

/** "Very Rare" -> "very-rare"; "Rarity Varies" -> "varies". Every result must be in `RARITY_IDS`. */
function rarityId(printed: string): string {
  const normalized = printed.trim();
  if (/^rarity varies$/i.test(normalized)) return "varies";
  return slug(normalized);
}

// ---- 3. The slot rule ---------------------------------------------------------------------------

/**
 * The worn/carried rule. `slot` is a closed enum the engine switches on (AC, equip capacity,
 * attunement), so it answers "what body location does this occupy", judged by the item's noun:
 *
 *   1. The name: "<garment> of <effect>" (`Cloak of Displacement`, `Boots of Speed`).
 *   2. Otherwise, the first garment noun in a "this/these/the <garment>" construction in the prose
 *      (`Wings of Flying`: "While wearing this cloak").
 *   3. Demote a name match back to carried when the prose says it is held and never worn.
 *
 * Generic "while you wear this item" prose is not used: it is attunement boilerplate, not a location.
 *
 * `Ioun Stone` is `wondrous` (it orbits the head and does not compete with a helm), and horseshoes
 * are `wondrous` (worn by a horse, not the bearer).
 */
const WORN_BY_NOUN: ReadonlyArray<readonly [string, string]> = [
  ["neck", "amulets?|necklaces?|periapts?|medallions?|scarabs?|talismans?|brooches|brooch"],
  ["shoulders", "cloaks?|capes?|mantles?"],
  // A robe is worn under a cloak, and lenses under a helm: the SRD's one-of-each list names neither.
  ["body", "robes?"],
  ["eyes", "goggles|lenses"],
  ["head", "helms?|helmets?|hats?|circlets?|headbands?|masks?"],
  ["feet", "boots|slippers"],
  ["hands", "gloves|gauntlets"],
  ["bracers", "bracers"],
  ["belt", "belts?|girdles?"]
];

/**
 * Pass 3's test: the prose says the bearer holds it and never says they wear it. Items saying
 * neither (`Necklace of Fireballs`) keep their name-based slot.
 */
const HELD_NOT_WORN = (body: string): boolean =>
  !/\bwear(s|ing)?\b|\bworn\b/i.test(body) && /\bhold(s|ing)?\b/i.test(body);

function wondrousSlot(entry: Entry): string {
  // Pass 1: the name names the body location. `Eyes of ...` names the body part itself.
  const byName = /^eyes of\b/i.test(entry.name)
    ? "eyes"
    : WORN_BY_NOUN.find(([, nouns]) => new RegExp(`\\b(${nouns})\\b`, "i").test(entry.name))?.[0];
  if (byName) {
    // Pass 3: demote. `Hat of Many Spells` reads "While holding the hat" and is never worn; at `head` the
    // server's `SLOT_CAPACITY` would refuse it to a player wearing a helm.
    return HELD_NOT_WORN(entry.body) ? "wondrous" : byName;
  }
  // Pass 2: the prose names the garment the name left out ("While wearing this cloak, ...").
  for (const [slotId, nouns] of WORN_BY_NOUN) {
    if (new RegExp(`\\b(this|these|the)\\s+(magic\\s+)?(${nouns})\\b`, "i").test(entry.body)) return slotId;
  }
  return "wondrous";
}

/**
 * Category -> slot for the non-wondrous categories. The qualifier decides two of them:
 * `Weapon (Any Ammunition)` is ammunition and `Armor (Shield)` is a shield.
 */
function slotOf(entry: Entry, type: TypeLine): string {
  switch (type.category) {
    case "Wondrous Item":
      return wondrousSlot(entry);
    case "Weapon":
      return /^any ammunition$/i.test(type.qualifier ?? "") ? "ammunition" : "weapon";
    case "Armor":
      return /^shield$/i.test(type.qualifier ?? "") ? "shield" : "armor";
    case "Ring":
      return "ring";
    case "Wand":
    case "Staff":
    case "Rod":
      return "held";
    case "Potion":
    case "Scroll":
      return "consumable";
  }
}

/**
 * The browse facet, reusing existing categories where one fits (`consumable`, `ammunition`) and the
 * SRD's own word otherwise. `category` is an open slug.
 */
function categoryOfRow(type: TypeLine, slotId: string): string {
  if (slotId === "shield" || slotId === "ammunition") return slotId;
  switch (type.category) {
    case "Wondrous Item":
      return "wondrous-item";
    case "Weapon":
      return "weapon";
    case "Armor":
      return "armor";
    case "Ring":
      return "ring";
    case "Wand":
      return "wand";
    case "Staff":
      return "staff";
    case "Rod":
      return "rod";
    case "Potion":
    case "Scroll":
      return "consumable";
  }
}

// ---- 4. The expansion rule ----------------------------------------------------------------------

/**
 * The five "+1, +2, or +3" ladders expand to one row per tier (each tier has its own rarity and bonus).
 * The seven "Rarity Varies" tables (Armor of Resistance, Potions of Healing...) stay one row each,
 * with the table in the text. 268 = 258 - 5 + 15.
 */
const LADDER_SUFFIX = /,\s*\+1,\s*\+2,\s*or\s*\+3$/;
/** "Uncommon (+1), Rare (+2), or Very Rare (+3)" -> the three printed rungs, in tier order. */
const LADDER_RARITIES = /^(.+?)\s*\(\+1\),\s*(.+?)\s*\(\+2\),\s*or\s*(.+?)\s*\(\+3\)$/;

// ---- 5. Description -----------------------------------------------------------------------------

/**
 * Matches `InventoryItemSchema.description`, which add-from-catalog copies this string onto. Overflow
 * is cut at the last sentence boundary and marked; the bundle test names every row that is cut.
 */
const DESCRIPTION_LIMIT = 12000;
const TRUNCATION_MARK = " […]";

function renderDescription(entry: Entry, printedTypeLine: string): { text: string; truncated: boolean } {
  const prose = withTables(entry.body)
    .replace(/\*\*/g, "")
    .replace(/(?<!\w)_(?=\S)|(?<=\S)_(?!\w)/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "• ").trim())
    .filter((line) => line !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  /**
   * Lead with the printed type line: the wire summary carries no `rarity`, so this is what shows a
   * reader the rarity and attunement requirement.
   */
  const full = `${printedTypeLine}. ${prose}`.trim();
  if (full.length <= DESCRIPTION_LIMIT) return { text: full, truncated: false };
  const room = DESCRIPTION_LIMIT - TRUNCATION_MARK.length;
  const head = full.slice(0, room);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  return {
    text: `${lastStop > room / 2 ? head.slice(0, lastStop + 1) : head.trimEnd()}${TRUNCATION_MARK}`,
    truncated: true
  };
}

// ---- 5b. The eligibility column: the printed base qualifier, resolved and fail-closed -----------

/**
 * Magic weapons and armor carry no stats of their own; the type-line qualifier names the base
 * ("Weapon (Warhammer)", "Armor (Any Medium or Heavy, Except Hide Armor)"). It is resolved here
 * against `weapons.v1.json` and `armor.v1.json` into `appliesTo`, so play time never evaluates a
 * predicate, and an unresolvable qualifier fails the build by name.
 */
const BASE_WEAPONS = z
  .array(WeaponReferenceSchema)
  .parse(JSON.parse(readFileSync(join(outDir, "weapons.v1.json"), "utf8")))
  .filter((weapon) => !weapon.improvised);
const BASE_ARMOR = z.array(ArmorReferenceSchema).parse(JSON.parse(readFileSync(join(outDir, "armor.v1.json"), "utf8")));

/**
 * A magic shield is a shield: its rarity bonus (an authored `armor-class` rider) stacks on the plain
 * shield's +2, which AC derivation reads from the row's armor block. So every shield row carries the
 * base shield's block.
 */
const SHIELD_ARMOR = ((): EquipmentReference["armor"] => {
  const shield = BASE_ARMOR.find((piece) => piece.category === "shield");
  if (!shield) return die("armor.v1.json carries no shield row, so magic shields would add no base AC.");
  return {
    acBase: shield.acBase,
    addDexModifier: shield.addDexModifier,
    dexModifierCap: shield.dexModifierCap,
    stealthDisadvantage: shield.stealthDisadvantage,
    strengthRequired: shield.strengthRequired
  };
})();

/** Split "A, B, or C" / "A or B" into its printed parts, in printed order. */
const namedParts = (qualifier: string): string[] =>
  qualifier
    .split(/,\s*(?:or\s+)?|\s+or\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== "");

function namedBaseIds(
  entry: Entry,
  qualifier: string,
  byName: ReadonlyMap<string, string>,
  kind: string
): readonly string[] {
  const parts = namedParts(qualifier);
  if (parts.length === 0) return die(`${entry.name} (line ${entry.line}): empty ${kind} qualifier "${qualifier}".`);
  return parts.map((part) => {
    const id = byName.get(slug(part));
    if (!id)
      return die(
        `${entry.name} (line ${entry.line}): "${part}" in "(${qualifier})" matches no ${kind} in the ${kind} bundle - fail closed by name, never guess.`
      );
    return id;
  });
}

function weaponBaseIds(entry: Entry, qualifier: string): readonly string[] {
  if (/^any simple or martial$/i.test(qualifier)) return BASE_WEAPONS.map((weapon) => weapon.id);
  if (/^any melee weapon$/i.test(qualifier)) {
    const melee = BASE_WEAPONS.filter((weapon) => weapon.melee === true).map((weapon) => weapon.id);
    if (melee.length === 0)
      return die(
        `${entry.name} (line ${entry.line}): "(${qualifier})" resolved to zero weapons - the melee band column is missing from weapons.v1.json.`
      );
    return melee;
  }
  if (/^any\b/i.test(qualifier))
    return die(`${entry.name} (line ${entry.line}): unrecognised weapon predicate "(${qualifier})".`);
  return namedBaseIds(
    entry,
    qualifier,
    new Map(BASE_WEAPONS.map((weapon) => [slug(weapon.name), weapon.id])),
    "weapon"
  );
}

function armorBaseIds(entry: Entry, qualifier: string): readonly string[] {
  const bodyArmor = BASE_ARMOR.filter((piece) => piece.category !== "shield");
  const predicate = qualifier.match(/^any (.+?)(?:, except (.+))?$/i);
  if (predicate) {
    const categories = namedParts(predicate[1]).map((part) => part.toLowerCase());
    for (const category of categories) {
      if (!["light", "medium", "heavy"].includes(category))
        return die(
          `${entry.name} (line ${entry.line}): unrecognised armor category "${category}" in "(${qualifier})".`
        );
    }
    let ids = bodyArmor.filter((piece) => categories.includes(piece.category ?? "")).map((piece) => piece.id);
    if (predicate[2]) {
      const excluded = slug(predicate[2]);
      if (!ids.includes(excluded))
        return die(
          `${entry.name} (line ${entry.line}): "(${qualifier})" excepts "${excluded}", which the named categories do not contain.`
        );
      ids = ids.filter((id) => id !== excluded);
    }
    if (ids.length === 0)
      return die(
        `${entry.name} (line ${entry.line}): "(${qualifier})" resolved to zero armors - the category band column is missing from armor.v1.json.`
      );
    return ids;
  }
  return namedBaseIds(entry, qualifier, new Map(bodyArmor.map((piece) => [slug(piece.name), piece.id])), "armor");
}

/**
 * Rows not bound even though they name a base: the SRD prints them as more than their base (Sun
 * Blade's radiant blade, Energy Bow's force damage), and a bare-base bind would derive a wrong attack.
 * Unbound until weapon-swing overrides exist.
 */
const RESERVED_UNBINDABLE = new Set(["sun-blade", "energy-bow"]);

/**
 * Weapon and body-armor rows get the column; everything else gets null. A magic shield already
 * carries the shield's block (`SHIELD_ARMOR`), so it binds to nothing. Magic ammunition is unbound:
 * there is no ammunition model.
 */
function appliesToOf(entry: Entry, type: TypeLine, slotId: string): ItemAppliesTo | null {
  if (RESERVED_UNBINDABLE.has(slug(entry.name))) return null;
  if (type.category === "Weapon" && slotId === "weapon") {
    if (!type.qualifier)
      return die(`${entry.name} (line ${entry.line}): a weapon row whose type line names no base weapon.`);
    return { label: type.qualifier, baseIds: [...weaponBaseIds(entry, type.qualifier)] };
  }
  if (type.category === "Armor" && slotId === "armor") {
    if (!type.qualifier)
      return die(`${entry.name} (line ${entry.line}): an armor row whose type line names no base armor.`);
    return { label: type.qualifier, baseIds: [...armorBaseIds(entry, type.qualifier)] };
  }
  return null;
}

// ---- 6. Emit ------------------------------------------------------------------------------------

const rows: EquipmentReference[] = [];
const provenance: Array<{ id: string; from: string }> = [];

for (const entry of items) {
  const type = parseTypeLine(entry);
  const slotId = slotOf(entry, type);
  const category = categoryOfRow(type, slotId);
  const appliesTo = appliesToOf(entry, type, slotId);
  const printedCategory = `${type.category}${type.qualifier ? ` (${type.qualifier})` : ""}`;
  const attunementSuffix = type.attunementClause === null ? "" : ` (Requires Attunement${type.attunementClause})`;

  const ladder = LADDER_SUFFIX.test(entry.name) ? entry.name.replace(LADDER_SUFFIX, "") : null;
  const rungs = ladder ? type.rarity.match(LADDER_RARITIES) : null;
  if (ladder && !rungs)
    die(
      `${entry.name} (line ${entry.line}): a "+1, +2, or +3" name whose rarity segment is not a three-rung ladder ("${type.rarity}").`
    );

  // `Horn of Valhalla` prints a rarity ladder but is not a "+1, +2, or +3" item; its metal is a d100
  // roll, so it gets `varies`. Any other multi-rung rarity lands here too.
  const tiers = rungs
    ? [1, 2, 3].map((bonus) => ({
        name: `${ladder}, +${bonus}`,
        printedRarity: rungs[bonus].trim(),
        rarity: rarityId(rungs[bonus].trim())
      }))
    : // The printed segment stays verbatim in the description even when the slug collapses to `varies`.
      [
        {
          name: entry.name,
          printedRarity: type.rarity,
          rarity: /,| or /.test(type.rarity) ? "varies" : rarityId(type.rarity)
        }
      ];

  for (const tier of tiers) {
    const rarity = tier.rarity;
    const printedTypeLine = `${printedCategory}, ${tier.printedRarity}${attunementSuffix}`;
    const description = renderDescription(entry, printedTypeLine);
    rows.push(
      EquipmentReferenceSchema.parse({
        id: slug(tier.name),
        name: tier.name,
        category,
        slot: slotId,
        // The SRD prints value bands by rarity, never per-item prices or weights.
        costGp: null,
        weightLb: null,
        description: description.text,
        weapon: null,
        armor: slotId === "shield" ? SHIELD_ARMOR : null,
        appliesTo,
        isMagic: true,
        rarity,
        attunement: { required: type.attunement.required, restrictedTo: [...type.attunement.restrictedTo] }
      })
    );
    provenance.push({ id: slug(tier.name), from: `${entry.name} (line ${entry.line})` });
  }
}

// ---- the guards, all fail-closed --------------------------------------------------------------

if (rows.length !== 268) die(`Expected 268 rows (258 entries - 5 ladders + 15 tiers), emitted ${rows.length}.`);

const badSlots = rows.filter((row) => !ItemSlotSchema.safeParse(row.slot).success);
if (badSlots.length > 0)
  die(
    `${badSlots.length} row(s) carry a slot that is not a member of ItemSlotSchema: ${badSlots.map((row) => `${row.name} -> ${row.slot}`).join(", ")}`
  );

const badRarities = rows.filter((row) => !RARITY_IDS.includes(row.rarity ?? ""));
if (badRarities.length > 0)
  die(
    `${badRarities.length} row(s) carry a rarity outside RARITY_IDS: ${badRarities.map((row) => `${row.name} -> ${row.rarity}`).join(", ")}`
  );

// The eligibility column is total on weapons and body armor and absent everywhere else.
const missingAppliesTo = rows.filter(
  (row) => (row.category === "weapon" || row.category === "armor") && !row.appliesTo && !RESERVED_UNBINDABLE.has(row.id)
);
if (missingAppliesTo.length > 0)
  die(
    `${missingAppliesTo.length} weapon/armor row(s) carry no appliesTo: ${missingAppliesTo.map((row) => row.id).join(", ")}`
  );
const boundReserved = rows.filter((row) => RESERVED_UNBINDABLE.has(row.id) && row.appliesTo);
if (boundReserved.length > 0)
  die(
    `${boundReserved.length} reserved unbindable row(s) carry an appliesTo they must not: ${boundReserved.map((row) => row.id).join(", ")}`
  );
const strayAppliesTo = rows.filter((row) => row.category !== "weapon" && row.category !== "armor" && row.appliesTo);
if (strayAppliesTo.length > 0)
  die(
    `${strayAppliesTo.length} row(s) outside weapon/armor carry an appliesTo: ${strayAppliesTo.map((row) => row.id).join(", ")}`
  );

// Expanding `Potions of Healing` would have minted `potion-of-healing`, which `equipment.v1.json`
// already ships; this guard turns any such collision into a build failure.
const OTHER_BUNDLES = ["equipment.v1.json", "weapons.v1.json", "armor.v1.json"] as const;
const elsewhere = new Map<string, string>();
for (const file of OTHER_BUNDLES) {
  for (const record of JSON.parse(readFileSync(join(outDir, file), "utf8")) as Array<{ id: string }>) {
    elsewhere.set(record.id, file);
  }
}
const collisions = rows
  .filter((row) => elsewhere.has(row.id))
  .map(
    (row) =>
      `${row.id} (minted from ${provenance.find((entry) => entry.id === row.id)!.from}) already ships in ${elsewhere.get(row.id)}`
  );
const duplicates = rows.map((row) => row.id).filter((id, index, all) => all.indexOf(id) !== index);
if (collisions.length > 0 || duplicates.length > 0) {
  die(
    [
      collisions.length > 0
        ? `${collisions.length} minted id(s) already exist in another bundle:\n  ${collisions.join("\n  ")}`
        : "",
      duplicates.length > 0
        ? `${duplicates.length} duplicate id(s) inside this bundle: ${[...new Set(duplicates)].join(", ")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

// ---- 7. The mechanics overlay -------------------------------------------------------------------

/**
 * Merge the hand-authored riders (`scripts/item-mechanics/items.ts`) after every guard and before the
 * validate and write. The bundle is output only, so the overlay may set any rider field.
 */
const merged: EquipmentReference[] = ((): EquipmentReference[] => {
  try {
    return applyItemMechanics(rows, ITEM_MECHANICS, outDir);
  } catch (error) {
    return die(error instanceof Error ? error.message : String(error));
  }
})();

// Rows whose serialized bytes changed, keyed by id so the sort below cannot disturb it.
const before = new Map(rows.map((row) => [row.id, JSON.stringify(row)]));
const changed = merged.filter((row) => before.get(row.id) !== JSON.stringify(row)).length;

// The fold sorts by name anyway; sorting here keeps the generated diff stable between runs.
merged.sort((left, right) => left.name.localeCompare(right.name));
z.array(EquipmentReferenceSchema).parse(merged);
writeFileSync(join(outDir, "magic-items.v1.json"), `${JSON.stringify(merged, null, 1)}\n`);

const histogram = (values: readonly string[]) =>
  [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())]
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => `${key} ${count}`)
    .join(" · ");
console.log(
  `wrote ${merged.length} magic items (${items.length} entries, ${NOT_ITEMS.length} creature stat blocks skipped by name).`
);
console.log(`  slot:     ${histogram(merged.map((row) => row.slot!))}`);
console.log(`  category: ${histogram(merged.map((row) => row.category))}`);
console.log(`  rarity:   ${histogram(merged.map((row) => row.rarity!))}`);
console.log(`  attunement required: ${merged.filter((row) => row.attunement?.required).length}`);
console.log(
  `  descriptions cut at the ${DESCRIPTION_LIMIT}-char schema cap: ${merged.filter((row) => row.description!.endsWith(TRUNCATION_MARK)).length}`
);
// Counts rows whose bytes moved, so it cannot report work the merge did not do.
console.log(`  rows changed by the overlay: ${changed} (${Object.keys(ITEM_MECHANICS).length} authored entries)`);

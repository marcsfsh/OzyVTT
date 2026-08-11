/**
 * Magic-item ETL.
 *
 * Reads `sources/dnd-5e-srd-markdown/magic-items.md` (CC BY 4.0 SRD 5.2.1 transcription; provenance
 * in that directory's PROVENANCE.json, and the file itself is pinned byte-for-byte by
 * `test/magic-item-source.test.ts`) and emits `bundles/magic-items.v1.json` - 268 `EquipmentReference`
 * rows that `loadEquipment()` folds into the addable catalog as its FOURTH source.
 *
 * Run with `npm run build-magic-item-bundle -w @vtt/content-srd-5.2.1`.
 *
 * A SEPARATE BUNDLE, NOT 268 ROWS APPENDED TO `equipment.v1.json`. `equipment.v1.json` is
 * hand-authored, and appending would make one file simultaneously this ETL's input and its output -
 * which is exactly the condition that forced the class overlay to grow a `clears` verb. A generated
 * bundle is an output only, so a later mechanics overlay may overwrite it freely.
 *
 * THIS ETL EMITS CONTENT, NOT MECHANICS. Every row lands with `isMagic`, `slot`, `rarity`,
 * `attunement` and prose; none lands with `modifiers`, `effects`, `actions`, `casts`, `uses` or
 * `cursed`. Those are the four overlay lanes' work, and the reason they can do it is precisely that
 * this file's output is regenerable from the source with nothing hand-edited into it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ItemSlotSchema } from "@vtt/schemas";
import { EquipmentReferenceSchema, type EquipmentReference } from "../src/schemas.js";
import { RARITY_IDS } from "../src/enums.js";
import { slug, withTables } from "./markdown.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bundles = join(root, "bundles");
const source = readFileSync(join(root, "sources/dnd-5e-srd-markdown/magic-items.md"), "utf8");

const die = (message: string): never => { console.error(`\n${message}\n`); process.exit(1); };

// ---------------------------------------------------------------------------------------------
// 1. The section, and what counts as an item inside it
// ---------------------------------------------------------------------------------------------

/**
 * THE SCAN IS SECTION-SCOPED, AND THE FOUR HEADINGS IT SKIPS ARE THE REASON.
 *
 * The whole file carries 264 `#### ` headings; four of them sit ABOVE `## Magic Items A-Z` and are
 * rules subsections (attunement, curses, and so on), not items. A parser that scanned the file
 * instead of the section would be wrong by exactly those four and would still report a plausible
 * number. `test/magic-item-source.test.ts` pins both counts for this reason.
 */
const lines = source.split("\n");
const azIndex = lines.findIndex((line) => line.startsWith("## Magic Items A"));
if (azIndex < 0) die("The `## Magic Items A-Z` heading is gone from the vendored source. The parse cannot be scoped.");

interface Entry { readonly name: string; readonly typeLine: string; readonly body: string; readonly line: number }

const entries: Entry[] = [];
for (let index = azIndex; index < lines.length; index++) {
  if (!lines[index].startsWith("#### ")) continue;
  let cursor = index + 1;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor++;
  const typeLine = (lines[cursor] ?? "").trim();
  const body: string[] = [];
  for (let scan = cursor + 1; scan < lines.length && !lines[scan].startsWith("#### ") && !lines[scan].startsWith("## "); scan++) {
    body.push(lines[scan]);
  }
  entries.push({ name: lines[index].slice(5).trim(), typeLine, body: body.join("\n").trim(), line: index + 1 });
}

/**
 * THE DISCRIMINATOR IS THE CATEGORY WORD, NOT THE ITALICS.
 *
 * All 260 entries in the A-Z run carry an italic second line, INCLUDING the two embedded creature
 * stat blocks (`_Large Beast, Unaligned_`, `_Medium Undead, Neutral Evil_`). "Has an italic line" is
 * therefore total over the run and separates nothing. What does separate them is that 258 of 258
 * item lines open with one of these nine words.
 */
const CATEGORY_WORDS = [
  "Wondrous Item", "Weapon", "Potion", "Ring", "Armor", "Wand", "Staff", "Rod", "Scroll"
] as const;
type CategoryWord = (typeof CATEGORY_WORDS)[number];

/** The two creature stat blocks in the run. Named and counted - a silent filter hides a parse bug. */
const NOT_ITEMS = ["Giant Fly", "Avatar of Death"] as const;

const unItalic = (value: string) => value.replace(/^_/, "").replace(/_$/, "");
const categoryOf = (typeLine: string): CategoryWord | undefined =>
  CATEGORY_WORDS.find((word) => unItalic(typeLine).startsWith(word));

const items = entries.filter((entry) => categoryOf(entry.typeLine));
const skipped = entries.filter((entry) => !categoryOf(entry.typeLine));

if (entries.length !== 260) die(`Expected 260 entries under the A-Z heading, parsed ${entries.length}. The source moved; re-read the pin in test/magic-item-source.test.ts.`);
if (skipped.map((entry) => entry.name).join("|") !== NOT_ITEMS.join("|")) {
  die(`The non-item entries are meant to be exactly ${NOT_ITEMS.join(" and ")}; parsed [${skipped.map((entry) => entry.name).join(", ")}].`);
}
if (items.length !== 258) die(`Expected 258 items, parsed ${items.length}.`);

// ---------------------------------------------------------------------------------------------
// 2. The type line: category, qualifier, rarity, attunement
// ---------------------------------------------------------------------------------------------

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
 * "by a Bard, Cleric, or Druid" -> ["bard", "cleric", "druid"].
 *
 * Display-only on the sheet and never enforced (the editor's own help text says so), so the aim is
 * a readable slug per named audience rather than a resolvable id: `Belt of Dwarvenkind`'s
 * "a Creature Attuned to a Belt of Dwarvenkind" is a legitimate audience and stays one slug.
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
  // The attunement clause always closes the line, AFTER the rarity - including after a ladder.
  const attunementMatch = rest.match(/\(Requires Attunement([^)]*)\)\s*$/i);
  const rarity = rest.replace(/\s*\(Requires Attunement[^)]*\)\s*$/i, "").trim();
  if (rarity === "") die(`${entry.name} (line ${entry.line}): no rarity segment in "${text}".`);
  return {
    category, qualifier, rarity,
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

// ---------------------------------------------------------------------------------------------
// 3. The slot rule
// ---------------------------------------------------------------------------------------------

/**
 * THE WORN/CARRIED SPLIT IS A READING, AND THIS IS THE READING - written down because the number it
 * produces is an OUTPUT of the rule, not a target the rule was tuned to hit.
 *
 * `slot` is a closed enum the engine exhaustively switches on: what derives AC, what may be equipped
 * twice, what an attunement gate applies to. So the question a slot answers is "what body location
 * does this occupy", and the only trustworthy evidence for that in the SRD is the item's own NOUN.
 *
 * Two passes, in order:
 *
 *   1. THE NAME. The SRD's naming convention for worn items is "<garment> of <effect>", and the
 *      garment word IS the body location: `Cloak of Displacement`, `Boots of Speed`,
 *      `Amulet of Health`. 56 of 127 wondrous items name a garment.
 *   2. THE FIRST GARMENT NOUN IN THE PROSE, in a "this/these/the <garment>" construction. One item
 *      needs it and it is a real miss rather than a tuning knob: `Wings of Flying`'s own first
 *      sentence is "While wearing this cloak", so its body location is printed - just not in its
 *      name. 1 of the remaining 71.
 *
 * WHAT THIS RULE DELIBERATELY DOES NOT DO is scan for worn-location PROSE ("while you wear this
 * item"). That phrase is the SRD's generic attunement wording and appears on items with no body
 * location at all, while missing items whose worn-ness is only implied; over these same 127 it
 * yields 53, a third number for the same question. A phrase about wearing is not a body location.
 *
 * PRODUCED, over the 127 wondrous items: 57 worn / 70 carried -
 * neck 15 · shoulders 15 · head 12 · feet 7 · hands 6 · belt 2.
 *
 * TWO NAMED READINGS INSIDE IT, because a rule with no judgement in it would get them wrong:
 *
 *   - `Ioun Stone` is `wondrous`, not `head`. It orbits your head; it does not occupy it. The SRD
 *     lets you have THREE orbiting at once and none of them competes with a helm, so a body-location
 *     slot would be a lie to the one part of the engine that reads this column. (`ioun` is also not
 *     a member of `ItemSlotSchema`, and minting one would be a vocabulary change, not a parse.)
 *   - `Horseshoes of Speed` and `Horseshoes of a Zephyr` are `wondrous`, not `feet`. They are worn
 *     by a horse, and this column is about the bearer's body.
 */
const WORN_BY_NOUN: ReadonlyArray<readonly [string, string]> = [
  ["neck", "amulets?|necklaces?|periapts?|medallions?|scarabs?|talismans?|brooches|brooch"],
  ["shoulders", "cloaks?|capes?|mantles?|robes?"],
  ["head", "helms?|helmets?|hats?|circlets?|headbands?|masks?|goggles|lenses"],
  ["feet", "boots|slippers"],
  ["hands", "gloves|gauntlets|bracers"],
  ["belt", "belts?|girdles?"]
];

function wondrousSlot(entry: Entry): string {
  // Pass 1: the name names the body location. `Eyes of ...` is the one SRD family whose noun is the
  // body part itself rather than a garment worn on it.
  if (/^eyes of\b/i.test(entry.name)) return "head";
  for (const [slotId, nouns] of WORN_BY_NOUN) if (new RegExp(`\\b(${nouns})\\b`, "i").test(entry.name)) return slotId;
  // Pass 2: the prose names the garment the name left out ("While wearing this cloak, ...").
  for (const [slotId, nouns] of WORN_BY_NOUN) {
    if (new RegExp(`\\b(this|these|the)\\s+(magic\\s+)?(${nouns})\\b`, "i").test(entry.body)) return slotId;
  }
  return "wondrous";
}

/**
 * Category -> slot for the eight non-wondrous categories. Two of these are the cases a naive
 * category map gets wrong, and both are printed in the qualifier rather than the category word:
 * `Weapon (Any Ammunition)` is ammunition, not a weapon (2 of 33), and `Armor (Shield)` is a shield,
 * not body armor (7 of 19).
 */
function slotOf(entry: Entry, type: TypeLine): string {
  switch (type.category) {
    case "Wondrous Item": return wondrousSlot(entry);
    case "Weapon": return /^any ammunition$/i.test(type.qualifier ?? "") ? "ammunition" : "weapon";
    case "Armor": return /^shield$/i.test(type.qualifier ?? "") ? "shield" : "armor";
    case "Ring": return "ring";
    case "Wand": case "Staff": case "Rod": return "held";
    case "Potion": case "Scroll": return "consumable";
  }
}

/**
 * The browse facet, kept in the EXISTING vocabulary wherever one fits so the picker does not grow
 * two words for one thing: a magic potion files under `consumable` beside the mundane one, magic
 * ammunition under `ammunition`. Ring, wand, staff, rod and wondrous item have no existing home and
 * take the SRD's own word - `category` is an OPEN slug precisely so that costs nothing.
 */
function categoryOfRow(type: TypeLine, slotId: string): string {
  if (slotId === "shield" || slotId === "ammunition") return slotId;
  switch (type.category) {
    case "Wondrous Item": return "wondrous-item";
    case "Weapon": return "weapon";
    case "Armor": return "armor";
    case "Ring": return "ring";
    case "Wand": return "wand";
    case "Staff": return "staff";
    case "Rod": return "rod";
    case "Potion": case "Scroll": return "consumable";
  }
}

// ---------------------------------------------------------------------------------------------
// 4. The expansion rule
// ---------------------------------------------------------------------------------------------

/**
 * FIVE LADDERS EXPAND, SEVEN "RARITY VARIES" TABLES DO NOT, AND THAT IS A DECISION.
 *
 * `Ammunition, +1, +2, or +3` prints three DIFFERENT items: each tier has its own rarity and its own
 * bonus, one row cannot carry both, and "Longsword, +1" is the string a GM types into the search box.
 * So the five ladders become fifteen rows.
 *
 * `Armor of Resistance` prints ONE item whose damage type is rolled on a d10, and `Potions of
 * Healing` prints one whose potency is a four-row table. Expanding those would put ten near-identical
 * rows in a browse list read mostly on a phone, which is a worse table than one row carrying the
 * table in its text. So the seven stay as one row each at rarity `varies`.
 *
 * 268 = 258 - 5 + 15.
 */
const LADDER_SUFFIX = /,\s*\+1,\s*\+2,\s*or\s*\+3$/;
/** "Uncommon (+1), Rare (+2), or Very Rare (+3)" -> the three printed rungs, in tier order. */
const LADDER_RARITIES = /^(.+?)\s*\(\+1\),\s*(.+?)\s*\(\+2\),\s*or\s*(.+?)\s*\(\+3\)$/;

// ---------------------------------------------------------------------------------------------
// 5. Description
// ---------------------------------------------------------------------------------------------

/**
 * `EquipmentReferenceSchema.description` is `z.string().max(2000)`, and 12 of the 258 entries render
 * longer than that. The cap is not this ETL's to move: the same string is copied onto the INVENTORY
 * row by the sheet's add-from-catalog, and widening a catalog column to fit a reference-book entry
 * would push a 7,000-character paragraph onto a phone's sheet to no one's benefit.
 *
 * So the overflow is cut at the last sentence boundary that fits and marked. It is NOT silent: the
 * bundle guard asserts the exact count and the exact names of the rows that were cut, so the day a
 * thirteenth appears it is a named test failure rather than a paragraph that quietly stops.
 */
const DESCRIPTION_LIMIT = 2000;
const TRUNCATION_MARK = " […]";

function renderDescription(entry: Entry, printedTypeLine: string): { text: string; truncated: boolean } {
  const prose = withTables(entry.body)
    .replace(/\*\*/g, "")
    .replace(/(?<!\w)_(?=\S)|(?<=\S)_(?!\w)/g, "")
    .split("\n").map((line) => line.replace(/^\s*[-*]\s+/, "• ").trim()).filter((line) => line !== "")
    .join(" ")
    .replace(/\s+/g, " ").trim();
  /**
   * THE LEAD IS THE PRINTED TYPE LINE, VERBATIM - which is what puts the rarity and the attunement
   * requirement in front of a reader. Nothing on the wire carries `rarity`: `ContentEquipmentSummary`
   * has no such key and adding one would be a projection change. The description is the channel that
   * already reaches both the browse list and the sheet, and the type line is source text, so no
   * content is invented by leading with it.
   */
  const full = `${printedTypeLine}. ${prose}`.trim();
  if (full.length <= DESCRIPTION_LIMIT) return { text: full, truncated: false };
  const room = DESCRIPTION_LIMIT - TRUNCATION_MARK.length;
  const head = full.slice(0, room);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  return { text: `${(lastStop > room / 2 ? head.slice(0, lastStop + 1) : head.trimEnd())}${TRUNCATION_MARK}`, truncated: true };
}

// ---------------------------------------------------------------------------------------------
// 6. Emit
// ---------------------------------------------------------------------------------------------

const rows: EquipmentReference[] = [];
const provenance: Array<{ id: string; from: string }> = [];

for (const entry of items) {
  const type = parseTypeLine(entry);
  const slotId = slotOf(entry, type);
  const category = categoryOfRow(type, slotId);
  const printedCategory = `${type.category}${type.qualifier ? ` (${type.qualifier})` : ""}`;
  const attunementSuffix = type.attunementClause === null ? "" : ` (Requires Attunement${type.attunementClause})`;

  const ladder = LADDER_SUFFIX.test(entry.name) ? entry.name.replace(LADDER_SUFFIX, "") : null;
  const rungs = ladder ? type.rarity.match(LADDER_RARITIES) : null;
  if (ladder && !rungs) die(`${entry.name} (line ${entry.line}): a "+1, +2, or +3" name whose rarity segment is not a three-rung ladder ("${type.rarity}").`);

  /**
   * `Horn of Valhalla` prints a rarity LADDER - "Rare (Silver or Brass), Very Rare (Bronze), or
   * Legendary (Iron)" - and is NOT one of the five that expand, so it needs a rarity of its own. It
   * gets `varies`, which is the member `RARITY_IDS` carries for exactly this: the horn's metal, and
   * therefore its rarity, is a d100 roll printed in its own description, and picking any one rung
   * would assert a horn the SRD leaves to the GM's table. Any other multi-rung rarity that is not a
   * "+1, +2, or +3" ladder lands here too, by the same reasoning.
   */
  const tiers = rungs
    ? [1, 2, 3].map((bonus) => ({ name: `${ladder}, +${bonus}`, printedRarity: rungs[bonus].trim(), rarity: rarityId(rungs[bonus].trim()) }))
    // The printed segment stays VERBATIM in the description even when the slug collapses to
    // `varies` - the Horn's four metals are the useful half of what the SRD prints about it, and
    // replacing that line with the word "varies" would be rewriting source text, not parsing it.
    : [{ name: entry.name, printedRarity: type.rarity, rarity: /,| or /.test(type.rarity) ? "varies" : rarityId(type.rarity) }];

  for (const tier of tiers) {
    const rarity = tier.rarity;
    const printedTypeLine = `${printedCategory}, ${tier.printedRarity}${attunementSuffix}`;
    const description = renderDescription(entry, printedTypeLine);
    rows.push(EquipmentReferenceSchema.parse({
      id: slug(tier.name),
      name: tier.name,
      category,
      slot: slotId,
      // The SRD prints a value BAND by rarity ("Magic Item Values by Rarity"), never a per-item
      // price, and no weights at all. A number derived from a band would be invented content.
      costGp: null,
      weightLb: null,
      description: description.text,
      weapon: null,
      armor: null,
      isMagic: true,
      rarity,
      attunement: { required: type.attunement.required, restrictedTo: [...type.attunement.restrictedTo] }
    }));
    provenance.push({ id: slug(tier.name), from: `${entry.name} (line ${entry.line})` });
  }
}

// ---- the guards, all fail-closed --------------------------------------------------------------

if (rows.length !== 268) die(`Expected 268 rows (258 entries - 5 ladders + 15 tiers), emitted ${rows.length}.`);

const badSlots = rows.filter((row) => !ItemSlotSchema.safeParse(row.slot).success);
if (badSlots.length > 0) die(`${badSlots.length} row(s) carry a slot that is not a member of ItemSlotSchema: ${badSlots.map((row) => `${row.name} -> ${row.slot}`).join(", ")}`);

const badRarities = rows.filter((row) => !RARITY_IDS.includes(row.rarity ?? ""));
if (badRarities.length > 0) die(`${badRarities.length} row(s) carry a rarity outside RARITY_IDS: ${badRarities.map((row) => `${row.name} -> ${row.rarity}`).join(", ")}`);

/**
 * THE ID GUARD, and it is a precaution against the reconciliation NOT taken.
 *
 * Under the rule above the ids are clean and this fires zero times, which is the point of a guard.
 * It earns its place on the branch not taken: `Potions of Healing` EXPANDED into its four printed
 * tiers would mint `potion-of-healing`, which `equipment.v1.json` already ships and
 * `test/bundle.test.ts` already asserts by name - a collision that would have surfaced as one row
 * silently shadowing another in the folded catalog rather than as a build failure.
 */
const OTHER_BUNDLES = ["equipment.v1.json", "weapons.v1.json", "armor.v1.json"] as const;
const elsewhere = new Map<string, string>();
for (const file of OTHER_BUNDLES) {
  for (const record of JSON.parse(readFileSync(join(bundles, file), "utf8")) as Array<{ id: string }>) {
    elsewhere.set(record.id, file);
  }
}
const collisions = rows
  .filter((row) => elsewhere.has(row.id))
  .map((row) => `${row.id} (minted from ${provenance.find((entry) => entry.id === row.id)!.from}) already ships in ${elsewhere.get(row.id)}`);
const duplicates = rows.map((row) => row.id).filter((id, index, all) => all.indexOf(id) !== index);
if (collisions.length > 0 || duplicates.length > 0) {
  die([
    collisions.length > 0 ? `${collisions.length} minted id(s) already exist in another bundle:\n  ${collisions.join("\n  ")}` : "",
    duplicates.length > 0 ? `${duplicates.length} duplicate id(s) inside this bundle: ${[...new Set(duplicates)].join(", ")}` : ""
  ].filter(Boolean).join("\n"));
}

// The fold sorts by name anyway; sorting here keeps the generated diff stable between runs.
rows.sort((left, right) => left.name.localeCompare(right.name));
z.array(EquipmentReferenceSchema).parse(rows);
writeFileSync(join(bundles, "magic-items.v1.json"), `${JSON.stringify(rows, null, 1)}\n`);

const histogram = (values: readonly string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())]
  .sort((left, right) => right[1] - left[1]).map(([key, count]) => `${key} ${count}`).join(" · ");
console.log(`wrote ${rows.length} magic items (${items.length} entries, ${NOT_ITEMS.length} creature stat blocks skipped by name).`);
console.log(`  slot:     ${histogram(rows.map((row) => row.slot!))}`);
console.log(`  category: ${histogram(rows.map((row) => row.category))}`);
console.log(`  rarity:   ${histogram(rows.map((row) => row.rarity!))}`);
console.log(`  attunement required: ${rows.filter((row) => row.attunement?.required).length}`);
console.log(`  descriptions cut at the ${DESCRIPTION_LIMIT}-char schema cap: ${rows.filter((row) => row.description!.endsWith(TRUNCATION_MARK)).length}`);

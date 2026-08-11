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
 *
 * WHERE THE MECHANICS COME BACK IN is `scripts/item-mechanics/`, merged at step 7 below - the same
 * build-time seam `scripts/class-mechanics/` is for classes. It ships EMPTY, so today this script's
 * output is unchanged by it byte for byte; each lane fills one module.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { ItemSlotSchema } from "@vtt/schemas";
import { EquipmentReferenceSchema, type EquipmentReference } from "../src/schemas.js";
import { RARITY_IDS } from "../src/enums.js";
import { slug, withTables } from "./markdown.js";
import { ITEM_MECHANICS_LANES } from "./item-mechanics/index.js";
import { applyItemMechanics, type ItemMechanicsLane } from "./item-mechanics/overlay.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bundles = join(root, "bundles");
const source = readFileSync(join(root, "sources/dnd-5e-srd-markdown/magic-items.md"), "utf8");

/**
 * TWO FLAGS, AND THEY EXIST SO THE OVERLAY HOOK CAN BE TESTED AT ALL. `npm run
 * build-magic-item-bundle` passes neither and behaves exactly as it always has.
 *
 *   --out=<path>       write the bundle somewhere else than `bundles/magic-items.v1.json`.
 *   --overlay=<path>   read `ITEM_MECHANICS_LANES` from that module instead of `./item-mechanics/`.
 *
 * Without them nothing could hold this script to APPLYING the overlay. Measured before they existed:
 * replacing step 7's merge with `const merged = rows;` left the whole content suite green and
 * `npm run check` at exit 0, because all six tests called `applyItemMechanics` directly and the
 * empty overlay makes the hook unobservable by construction. `test/item-mechanics.test.ts` now
 * spawns this script with a probe overlay and a scratch `--out`, so deleting the merge turns a test
 * red instead of quietly shipping a bundle with no riders in it.
 */
const flag = (name: string): string | undefined =>
  process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const outPath = flag("out") ?? join(bundles, "magic-items.v1.json");
const overlayPath = flag("overlay");
const lanes: readonly ItemMechanicsLane[] = overlayPath
  ? ((await import(pathToFileURL(resolve(overlayPath)).href)) as { ITEM_MECHANICS_LANES: readonly ItemMechanicsLane[] }).ITEM_MECHANICS_LANES
  : ITEM_MECHANICS_LANES;

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
 * PRODUCED, over the 127 wondrous items: 56 worn / 71 carried -
 * neck 15 · shoulders 15 · head 11 · feet 7 · hands 6 · belt 2.
 * (56 name-matched, minus the 1 pass 3 demotes, plus the 1 pass 2 promotes.)
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

/**
 * Pass 3's test: the item's own prose never says the bearer WEARS it, and does say they HOLD it.
 * Deliberately requires the hold-word as well as the missing wear-word — an item that says neither
 * (`Necklace of Fireballs`, `Scarab of Protection`) has no positive evidence either way, and its
 * name is then the best evidence available, which is where pass 1 already put it.
 */
const HELD_NOT_WORN = (body: string): boolean =>
  !/\bwear(s|ing)?\b|\bworn\b/i.test(body) && /\bhold(s|ing)?\b/i.test(body);

function wondrousSlot(entry: Entry): string {
  // Pass 1: the name names the body location. `Eyes of ...` is the one SRD family whose noun is the
  // body part itself rather than a garment worn on it.
  const byName = /^eyes of\b/i.test(entry.name)
    ? "head"
    : WORN_BY_NOUN.find(([, nouns]) => new RegExp(`\\b(${nouns})\\b`, "i").test(entry.name))?.[0];
  if (byName) {
    // Pass 3: DEMOTE. A garment name is strong evidence, but it is not conclusive, and the rule was
    // one-directional until this pass — prose could promote a carried item to worn, and nothing
    // could do the reverse. `Hat of Many Spells` is the miss that produced it: BOTH its properties
    // read "While holding the hat", it is never once described as worn, and the only sentence about
    // it as an object is "This pointed hat has the following properties."
    //
    // This is not a labelling nicety. `slot` is SERVER-ENFORCED — `apps/server/src/inventory.ts`
    // rejects an equip against `SLOT_CAPACITY`, where `head` is 1 — so a `head` hat means a player
    // wearing a Helm of Telepathy is refused the hat with "Helm of Telepathy already occupies the
    // head slot - take it off first." The SRD imposes no such conflict: you hold this one.
    //
    // MEASURED over the same 127: this pass moves EXACTLY ONE item, and the bundle guard asserts
    // that by name, so a re-vendor that makes it move a second is a red test rather than a silent
    // reslotting.
    return HELD_NOT_WORN(entry.body) ? "wondrous" : byName;
  }
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
 * `EquipmentReferenceSchema.description` is `z.string().max(4000)` — RAISED from 2000 on 2026-08-11,
 * after the review pass showed the original argument for cutting was wrong.
 *
 * The claim was that the cap "is not this ETL's to move" because the same string is copied onto the
 * INVENTORY row by add-from-catalog. The copy is real (`CharacterSheet.tsx`'s `addFromCatalog`), but
 * `InventoryItemSchema.description` is `z.string().max(4000)` — DOUBLE the catalog's. The downstream
 * never constrained the catalog to 2000; the catalog was simply the tighter of the two for no reason.
 *
 * And the cut was not cheap. At 2000 it cost, among 12 rows: `Ring of Elemental Command`'s entire
 * spell-by-plane table AND its "save DC of 18" (the kept text ended "...as shown in the following
 * table. […]", a dangling promise); `Rod of Lordly Might`'s Drain Life, Paralyze and Terrify, all
 * three with DC 17; `Staff of the Magi`'s retributive strike; `Apparatus of the Crab`'s levers 6-10.
 * Those are save DCs and damage dice a C7 lane authors mechanics FROM. `withTables`' own rule below
 * says it: a description that stops "is not shorter prose, it is a feature that does not say what
 * it does."
 *
 * At 4000 only 2 of 268 are cut — Mysterious Deck (7,687) and Wand of Wonder (4,899) — and both are
 * long-tail d100 tables rather than a mechanic with a number in it.
 *
 * The overflow is still cut at the last sentence boundary that fits and marked. It is NOT silent:
 * the bundle guard asserts the exact count and the exact names of the rows cut, so a third appearing
 * is a named test failure rather than a paragraph that quietly stops.
 */
const DESCRIPTION_LIMIT = 4000;
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

// ---------------------------------------------------------------------------------------------
// 7. The mechanics overlay
// ---------------------------------------------------------------------------------------------

/**
 * THE HAND-AUTHORED HALF, merged over the parsed half - `scripts/item-mechanics/overlay.ts` holds
 * the reasoning. It runs HERE, after every guard above and before the sort, the validate and the
 * write, so an authored rider is validated by the same `z.array(...).parse` the parsed columns are
 * and an overlay key naming no row stops the build instead of writing a bundle missing a rider.
 *
 * It may overwrite freely (plan §1.5): this bundle is an OUTPUT ONLY, rebuilt from a byte-pinned
 * source every run, so it never inherits the additive-only rule the class overlay needs. With the
 * overlay empty this call returns the same rows and the file comes out byte-identical.
 */
// Caught and re-reported through `die` so an overlay mistake reads like every other guard in this
// file - one sentence naming the entry - rather than as a stack trace out of a merge helper.
const merged: EquipmentReference[] = ((): EquipmentReference[] => {
  try { return applyItemMechanics(rows, lanes); }
  catch (error) { return die(error instanceof Error ? error.message : String(error)); }
})();

/**
 * ROWS ACTUALLY CHANGED, compared by serialized bytes against the pre-overlay rows and keyed by id
 * so the sort below cannot disturb it.
 *
 * The console used to print `Object.keys(ITEM_MECHANICS).length` - the count REQUESTED, read off the
 * module, never the count of rows that moved. Measured: with the merge neutered to `const merged =
 * rows;` it still printed 1 while writing a bundle with zero riders in it, which is the one thing
 * that number exists to make impossible.
 */
const before = new Map(rows.map((row) => [row.id, JSON.stringify(row)]));
const changed = merged.filter((row) => before.get(row.id) !== JSON.stringify(row)).length;

// The fold sorts by name anyway; sorting here keeps the generated diff stable between runs.
merged.sort((left, right) => left.name.localeCompare(right.name));
z.array(EquipmentReferenceSchema).parse(merged);
writeFileSync(outPath, `${JSON.stringify(merged, null, 1)}\n`);

const histogram = (values: readonly string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())]
  .sort((left, right) => right[1] - left[1]).map(([key, count]) => `${key} ${count}`).join(" · ");
console.log(`wrote ${merged.length} magic items (${items.length} entries, ${NOT_ITEMS.length} creature stat blocks skipped by name).`);
console.log(`  slot:     ${histogram(merged.map((row) => row.slot!))}`);
console.log(`  category: ${histogram(merged.map((row) => row.category))}`);
console.log(`  rarity:   ${histogram(merged.map((row) => row.rarity!))}`);
console.log(`  attunement required: ${merged.filter((row) => row.attunement?.required).length}`);
console.log(`  descriptions cut at the ${DESCRIPTION_LIMIT}-char schema cap: ${merged.filter((row) => row.description!.endsWith(TRUNCATION_MARK)).length}`);
// Reported every run so "the lanes authored nothing" is a number on the console rather than an
// assumption - it is 0 until C7a-C7d fill `scripts/item-mechanics/`. It counts rows whose BYTES
// moved, so it cannot report work the merge did not do.
console.log(`  rows changed by the overlay: ${changed} (${lanes.length} lane(s): ${lanes.map((lane) => lane.lane).join(", ") || "none"})`);

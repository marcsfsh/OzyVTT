/**
 * Class/subclass ETL.
 *
 * Reads `sources/dnd-5e-srd-markdown/classes.md` (CC BY 4.0 SRD 5.2.1 transcription; provenance and
 * standing in that directory's PROVENANCE.json) and emits `ClassReference` / `SubclassReference`
 * records for the classes that are NOT already hand-authored.
 *
 * Why it adds rather than regenerates: Fighter, Wizard and Cleric were transcribed by hand WITH
 * typed riders - `grants`, `effects`, `uses`, nested choice options carrying their own mechanics.
 * The markdown is prose and cannot reproduce a rider, so regenerating all twelve would quietly
 * downgrade the three best records in the bundle. Those three are copied through untouched and
 * instead used as the oracle: `crossCheck` re-parses them from the source and fails the build on a
 * mechanical disagreement, which is what earns this source the right to supply the other nine.
 *
 * Run with `npm run build-class-bundle -w @vtt/content-srd-5.2.1`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { statPriorityFor } from "@vtt/rules-5e";
import {
  ClassReferenceSchema, SubclassReferenceSchema, type ClassReference, type ClassLevelRow
} from "../src/character-content.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bundles = join(root, "bundles");
const source = readFileSync(join(root, "sources/dnd-5e-srd-markdown/classes.md"), "utf8");

/** Classes already authored by hand, with riders the prose cannot express. Never regenerated. */
const HAND_AUTHORED = new Set(["fighter", "wizard", "cleric"]);

// ---------------------------------------------------------------------------------------------
// Markdown/HTML parsing helpers
// ---------------------------------------------------------------------------------------------

const strip = (value: string) =>
  value.replace(/<[^>]+>/g, " ")
    .replace(/&mdash;|&#8212;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ").trim();

const slug = (value: string) =>
  strip(value).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A dash-only table cell means "nothing at this level" in the printed tables. */
const blank = (cell: string) => {
  const v = strip(cell);
  return v === "" || v === "—" || v === "-" || v === "--";
};

const intOf = (cell: string) => {
  const m = strip(cell).match(/-?\d+/);
  return m ? Number(m[0]) : null;
};

type ClassSection = { name: string; body: string };

function sections(): ClassSection[] {
  const parts = source.split(/^## ([A-Z][A-Za-z' ]*)$/m);
  const out: ClassSection[] = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ name: parts[i].trim(), body: parts[i + 1] });
  return out;
}

/** The "Core <Class> Traits" two-column table as a label -> value map. */
function coreTraits(body: string): Record<string, string> {
  const table = body.match(/\*\*Core [^*]*Traits\*\*\s*(<table>[\s\S]*?<\/table>)/);
  if (!table) throw new Error("no core traits table");
  const out: Record<string, string> = {};
  for (const [, k, v] of table[1].matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    out[strip(k)] = strip(v);
  }
  return out;
}

/**
 * The "<Class> Features" table as column names + 20 rows of cells.
 *
 * The printed table merges the spell-slot columns under one `colspan="9"` header and puts the slot
 * LEVELS in a second header row, so the effective column list is the first row with its colspan
 * expanded and the second row's non-blank labels laid over the top.
 */
function featuresTable(body: string, className: string): { columns: string[]; rows: string[][] } {
  const table = body.match(new RegExp(`\\*\\*${className} Features\\*\\*\\s*(<table>[\\s\\S]*?</table>)`));
  if (!table) throw new Error(`no features table for ${className}`);
  const headRows = [...(table[1].match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const columns: string[] = [];
  for (const [, cell, attrs] of headRows[0]?.[1].matchAll(/<th(?:\s+colspan="(\d+)")?>([\s\S]*?)<\/th>/g) ?? []) void [cell, attrs];
  for (const match of headRows[0]?.[1].matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/g) ?? []) {
    const span = Number(match[1].match(/colspan="(\d+)"/)?.[1] ?? 1);
    for (let i = 0; i < span; i += 1) columns.push(strip(match[2]));
  }
  if (headRows[1]) {
    let index = 0;
    for (const match of headRows[1][1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)) {
      const label = strip(match[1]);
      if (label) columns[index] = label;
      index += 1;
    }
  }
  const bodyRows = [...(table[1].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const rows = bodyRows.map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]));
  return { columns, rows };
}

/**
 * The `#### Name` entries under one `### Heading`, as FeatureOptions carrying their own prose.
 *
 * Metamagic and Eldritch Invocations are printed this way, and they are real choices the wizard has
 * to render - a bare id list would record WHICH invocation was taken without being able to say what
 * it does, which is the options-as-bare-strings problem `FeatureOptionSchema` exists to fix.
 */
function optionSection(body: string, heading: string) {
  const after = body.split(new RegExp(`^### ${heading}$`, "m"))[1];
  if (!after) throw new Error(`no "${heading}" section`);
  const tail = after.split(/^### /m)[0];
  const parts = tail.split(/^#### (.+)$/m);
  const options: { id: string; name: string; description: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const name = strip(parts[i]);
    const description = parts[i + 1]
      .replace(/<table>[\s\S]*?<\/table>/g, " ")
      .split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
      .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    if (name && description) options.push({ id: slug(name), name, description: description.slice(0, 4000) });
  }
  return options;
}

/** Feature prose keyed by slug, from the `###`/`####` headings that follow the tables. */
function featureProse(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.split(/^#{3,4} (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = strip(parts[i]);
    const text = parts[i + 1]
      .split(/\n#{3,6} /)[0]
      .replace(/<table>[\s\S]*?<\/table>/g, " ")
      .split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
      .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    if (text) out.set(slug(heading), text);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-class configuration the printed text cannot supply deterministically
// ---------------------------------------------------------------------------------------------

type ResourceSpec = { id: string; name: string; dice?: boolean };
type ClassConfig = {
  /** See BLURBS. */
  blurb?: { summary: string; description: string };
  /** Table column -> how it lands in the row. Anything unlisted fails the build. */
  columns: Record<string, "features" | "cantrips" | "prepared" | "pact-slots" | "pact-level" | ResourceSpec>;
  spellcasting?: ClassReference["spellcasting"];
  subclassLevel: number;
  /** Extra `choice` riders keyed by feature slug - the picks the wizard has to render. */
  choices?: Record<string, { kind: string; choose: number; fromCatalog?: string; optionsFrom?: string }>;
};

const ALL_SKILLS = [
  "acrobatics", "animal-handling", "arcana", "athletics", "deception", "history", "insight",
  "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion",
  "religion", "sleight-of-hand", "stealth", "survival"
];

const asiChoice = { kind: "asi-or-feat", choose: 1, fromCatalog: "general-feats" };
const weaponMastery = (n: number) => ({ kind: "weapon-mastery", choose: n, fromCatalog: "weapons" });

/**
 * Short class copy, written for this product - NOT SRD text.
 *
 * The SRD does carry a flavour paragraph per class (Fighter, Wizard and Cleric have theirs), but
 * this transcription is mechanics-only and does not include them. Rather than leave nine cards
 * reading "Barbarian, one of the twelve SRD 5.2.1 classes" - which is what the first generated pass
 * shipped, and it looked exactly as unfinished as it was - or invent SRD-sounding prose and tag it
 * `source: "srd"`, these are deliberately our own words describing what the class DOES mechanically.
 * If the SRD paragraphs are ever vendored, they should replace these.
 */
const BLURBS: Record<string, { summary: string; description: string }> = {
  barbarian: {
    summary: "A primal fighter who turns rage into overwhelming physical force.",
    description: "Barbarians fight in a fury they can enter at will, shrugging off punishment that would drop anyone else. Rage powers their damage and their resilience, and the pool of rages is the resource the class is built around."
  },
  bard: {
    summary: "A performer whose magic works through music, words and sheer presence.",
    description: "Bards are full casters who support the party as much as they threaten enemies. Bardic Inspiration hands out a die that other characters spend, and expertise makes the Bard the party's most reliable skill user."
  },
  druid: {
    summary: "A full caster drawing on the natural world, able to take animal form.",
    description: "Druids cast from the nature list and can spend Wild Shape to become a beast. The class trades some direct damage for versatility, control, and the ability to change what it is on the battlefield."
  },
  monk: {
    summary: "An unarmoured martial artist spending focus on fast, precise strikes.",
    description: "Monks fight without armour, using a martial-arts die that grows with level and Focus Points that buy extra attacks and mobility. Speed and action economy are the class's real weapons."
  },
  paladin: {
    summary: "An oath-bound warrior blending heavy-armour combat with divine magic.",
    description: "Paladins are half casters who fight on the front line. Channel Divinity and spell slots spent on smites give the class burst damage on top of the durability of full plate and a shield."
  },
  ranger: {
    summary: "A half-caster tracker at home on the borders of the wild.",
    description: "Rangers combine martial skill with a small nature spell list and strong exploration tools. Expertise and a wide skill list make the class as useful between fights as in them."
  },
  rogue: {
    summary: "A precise, stealthy opportunist who strikes where it hurts most.",
    description: "Rogues deal their damage through Sneak Attack, which scales to 10d6, and gain more expertise than any other class. The class is built to pick its moment rather than trade blows."
  },
  sorcerer: {
    summary: "A caster whose magic is innate, reshaped on the fly through Metamagic.",
    description: "Sorcerers know fewer spells than a Wizard but bend the ones they have. Sorcery Points buy Metamagic - twinning, quickening, or subtly casting a spell - which is what the class spends its resources on."
  },
  warlock: {
    summary: "A caster powered by a pact, with few slots that always cast at full strength.",
    description: "Warlocks use Pact Magic: a small number of slots, all at the highest level available, refreshed on a short rest. Eldritch Invocations are the class's real customisation, reshaping what it can do at will."
  }
};

const CONFIG: Record<string, ClassConfig> = {
  barbarian: {
    subclassLevel: 3,
    columns: {
      Rages: { id: "rage", name: "Rages" },
      "Rage Damage": { id: "rage-damage", name: "Rage Damage" },
      "Weapon Mastery": { id: "weapon-mastery", name: "Weapon Mastery" }
    },
    choices: {
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "barbarian-subclass": { kind: "subclass", choose: 1, fromCatalog: "barbarian-subclasses" }
    }
  },
  bard: {
    subclassLevel: 3,
    spellcasting: { ability: "cha", prepares: "prepared", ritual: true, focus: "arcane-focus", multiclassProgression: "full", spellListId: "bard" },
    columns: {
      "Bardic Die": { id: "bardic-inspiration", name: "Bardic Die", dice: true },
      Cantrips: "cantrips",
      "Prepared Spells": "prepared"
    },
    choices: {
      expertise: { kind: "expertise", choose: 2, fromCatalog: "skills" },
      "ability-score-improvement": asiChoice,
      "bard-subclass": { kind: "subclass", choose: 1, fromCatalog: "bard-subclasses" },
      "magical-secrets": { kind: "spell", choose: 2, fromCatalog: "bard-spells" }
    }
  },
  druid: {
    subclassLevel: 3,
    spellcasting: { ability: "wis", prepares: "prepared", ritual: true, focus: "druidic-focus", multiclassProgression: "full", spellListId: "druid" },
    columns: {
      "Wild Shape": { id: "wild-shape", name: "Wild Shape" },
      Cantrips: "cantrips",
      "Prepared Spells": "prepared"
    },
    choices: {
      "ability-score-improvement": asiChoice,
      "druid-subclass": { kind: "subclass", choose: 1, fromCatalog: "druid-subclasses" }
    }
  },
  monk: {
    subclassLevel: 3,
    columns: {
      "Martial Arts": { id: "martial-arts", name: "Martial Arts", dice: true },
      "Focus Points": { id: "focus-points", name: "Focus Points" },
      "Unarmored Movement": { id: "unarmored-movement", name: "Unarmored Movement" }
    },
    choices: {
      "ability-score-improvement": asiChoice,
      "monk-subclass": { kind: "subclass", choose: 1, fromCatalog: "monk-subclasses" }
    }
  },
  paladin: {
    subclassLevel: 3,
    spellcasting: { ability: "cha", prepares: "prepared", ritual: false, focus: "holy-symbol", multiclassProgression: "half", spellListId: "paladin" },
    columns: {
      "Channel Divinity": { id: "channel-divinity", name: "Channel Divinity" },
      "Prepared Spells": "prepared"
    },
    choices: {
      "fighting-style": { kind: "fighting-style", choose: 1, fromCatalog: "fighting-style-feats" },
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "paladin-subclass": { kind: "subclass", choose: 1, fromCatalog: "paladin-subclasses" }
    }
  },
  ranger: {
    subclassLevel: 3,
    spellcasting: { ability: "wis", prepares: "prepared", ritual: true, focus: "druidic-focus", multiclassProgression: "half", spellListId: "ranger" },
    columns: {
      "Favored Enemy": { id: "favored-enemy", name: "Favored Enemy" },
      "Prepared Spells": "prepared"
    },
    choices: {
      "fighting-style": { kind: "fighting-style", choose: 1, fromCatalog: "fighting-style-feats" },
      "weapon-mastery": weaponMastery(2),
      expertise: { kind: "expertise", choose: 2, fromCatalog: "skills" },
      "ability-score-improvement": asiChoice,
      "ranger-subclass": { kind: "subclass", choose: 1, fromCatalog: "ranger-subclasses" }
    }
  },
  rogue: {
    subclassLevel: 3,
    columns: { "Sneak Attack": { id: "sneak-attack", name: "Sneak Attack", dice: true } },
    choices: {
      expertise: { kind: "expertise", choose: 2, fromCatalog: "skills" },
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "rogue-subclass": { kind: "subclass", choose: 1, fromCatalog: "rogue-subclasses" }
    }
  },
  sorcerer: {
    subclassLevel: 3,
    spellcasting: { ability: "cha", prepares: "prepared", ritual: false, focus: "arcane-focus", multiclassProgression: "full", spellListId: "sorcerer" },
    columns: {
      "Sorcery Points": { id: "sorcery-points", name: "Sorcery Points" },
      Cantrips: "cantrips",
      "Prepared Spells": "prepared"
    },
    choices: {
      metamagic: { kind: "metamagic", choose: 2, optionsFrom: "Metamagic Options" },
      "ability-score-improvement": asiChoice,
      "sorcerer-subclass": { kind: "subclass", choose: 1, fromCatalog: "sorcerer-subclasses" }
    }
  },
  warlock: {
    subclassLevel: 3,
    spellcasting: { ability: "cha", prepares: "prepared", ritual: true, focus: "arcane-focus", multiclassProgression: "pact", spellListId: "warlock" },
    columns: {
      "Eldritch Invocations": { id: "eldritch-invocations", name: "Eldritch Invocations" },
      Cantrips: "cantrips",
      "Prepared Spells": "prepared",
      "Spell Slots": "pact-slots",
      "Slot Level": "pact-level"
    },
    choices: {
      "eldritch-invocations": { kind: "eldritch-invocation", choose: 1, optionsFrom: "Eldritch Invocation Options" },
      "ability-score-improvement": asiChoice,
      "warlock-subclass": { kind: "subclass", choose: 1, fromCatalog: "warlock-subclasses" }
    }
  }
};

// ---------------------------------------------------------------------------------------------
// Trait interpretation
// ---------------------------------------------------------------------------------------------

const ABILITY: Record<string, string> = {
  Strength: "str", Dexterity: "dex", Constitution: "con",
  Intelligence: "int", Wisdom: "wis", Charisma: "cha"
};
const abilitiesIn = (text: string) =>
  [...text.matchAll(/Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma/g)].map((m) => ABILITY[m[0]]);

/** "Light, Medium, and Heavy armor and Shields" -> ids; "None" -> []. */
function armorOf(text: string): string[] {
  if (!text || /^none$/i.test(text)) return [];
  const out: string[] = [];
  if (/\blight\b/i.test(text)) out.push("light");
  if (/\bmedium\b/i.test(text)) out.push("medium");
  if (/\bheavy\b/i.test(text)) out.push("heavy");
  if (/shield/i.test(text)) out.push("shields");
  return out;
}

/**
 * Weapon training. Monk and Rogue take a QUALIFIED slice of Martial ("that have the Light
 * property"), so the id records the qualifier rather than flattening it to plain `martial` - which
 * would silently hand a Rogue a greatsword.
 */
function weaponsOf(text: string): string[] {
  const out: string[] = [];
  if (/simple/i.test(text)) out.push("simple");
  if (/martial/i.test(text)) {
    const finesse = /finesse/i.test(text);
    const light = /\blight\b/i.test(text);
    if (finesse && light) out.push("martial-finesse-or-light");
    else if (finesse) out.push("martial-finesse");
    else if (light) out.push("martial-light");
    else out.push("martial");
  }
  return out;
}

/** "Choose 2: Athletics, ... or Survival" / "Choose any 3 skills" -> a ChoiceList. */
function skillsOf(text: string): { choose: number; from: string[] } {
  const choose = Number(text.match(/Choose (?:any )?(\d+)/i)?.[1] ?? 2);
  if (/choose any/i.test(text)) return { choose, from: [...ALL_SKILLS] };
  const list = text.replace(/^Choose\s+\d+\s*:?/i, "");
  const from = list.split(/,| or /i).map((part) => slug(part)).filter((id) => ALL_SKILLS.includes(id));
  return { choose, from };
}

const ITEM_ALIASES: Record<string, string> = {
  // The class tables use the SRD's shorthand; the equipment catalog carries the specific variants.
  "holy-symbol": "holy-symbol-amulet",
  "arcane-focus-crystal": "arcane-focus-crystal",
  "arcane-focus-orb": "arcane-focus-orb",
  "druidic-focus-quarterstaff": "druidic-focus-wooden-staff",
  "druidic-focus-sprig-of-mistletoe": "druidic-focus-sprig-of-mistletoe",
  "musical-instrument": "instrument-lute",
  "musical-instrument-of-your-choice": "instrument-lute",
  arrows: "arrows-20",
  "20-arrows": "arrows-20",
  javelins: "javelin",
  daggers: "dagger",
  handaxes: "handaxe",
  "gaming-set": "gaming-set-dice",
  "book-occult-lore": "book"
};

/**
 * Entries in a starting-equipment list that are not items but POINTERS to another choice - Monk's
 * kit says "the Artisan's Tools or Musical Instrument chosen for the tool proficiency above". The
 * label still reads it out; emitting an item id would invent a specific tool the player never chose.
 */
const ITEM_POINTERS = [/chosen for the tool proficiency/i, /of your choice$/i];

type CatalogIndex = Map<string, string>;
function catalogIndex(): CatalogIndex {
  const index: CatalogIndex = new Map();
  for (const file of ["equipment.v1.json", "weapons.v1.json", "armor.v1.json"]) {
    for (const row of JSON.parse(readFileSync(join(bundles, file), "utf8")) as { id: string; name: string }[]) {
      index.set(row.id, row.name);
      index.set(slug(row.name), row.id === slug(row.name) ? row.id : row.id);
    }
  }
  return index;
}

/**
 * "Choose A or B: (A) Greataxe, 4 Handaxes, Explorer's Pack, and 15 GP; or (B) 75 GP"
 * -> two StartingEquipmentOptions with resolved catalog ids.
 */
function equipmentOf(text: string, classId: string, catalog: CatalogIndex, unresolved: string[]) {
  const options: { id: string; label: string; items: { id: string; name: string; quantity: number }[]; goldPieces: number }[] = [];
  const parts = [...text.matchAll(/\(([A-C])\)\s*([^;]+?)(?=;\s*or\s*\(|;\s*\(|$)/g)];
  for (const [, letter, chunk] of parts) {
    const label = chunk.replace(/^\s*|\s*$/g, "").replace(/\.$/, "");
    const gold = Number(label.match(/(\d+)\s*GP\s*$/i)?.[1] ?? 0);
    const items: { id: string; name: string; quantity: number }[] = [];
    const body = label.replace(/,?\s*(and\s+)?\d+\s*GP\s*$/i, "");
    for (let piece of body.split(/,\s*|\s+and\s+/)) {
      piece = piece.trim().replace(/^and\s+/i, "");
      if (!piece || /^\d+\s*GP$/i.test(piece)) continue;
      const qty = Number(piece.match(/^(\d+)\s+/)?.[1] ?? 1);
      const name = piece.replace(/^\d+\s+/, "").trim();
      const key = slug(name);
      const id = ITEM_ALIASES[key] ?? (catalog.has(key) ? (catalog.get(key) as string) : null);
      const resolved = id && catalog.has(id) ? id : (catalog.has(key) ? key : null);
      if (!resolved) {
        if (ITEM_POINTERS.some((pattern) => pattern.test(name))) continue;
        unresolved.push(`${classId}: "${name}" (${key})`);
        continue;
      }
      items.push({ id: resolved, name: catalog.get(resolved) ?? name, quantity: qty });
    }
    options.push({ id: `${classId}-${letter.toLowerCase()}`, label, items, goldPieces: gold });
  }
  return options;
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

const catalog = catalogIndex();
const unresolvedItems: string[] = [];
const parsed = new Map<string, ReturnType<typeof parseClass>>();

function parseClass(section: ClassSection) {
  const traits = coreTraits(section.body);
  const table = featuresTable(section.body, section.name);
  const prose = featureProse(section.body);
  const id = section.name.toLowerCase();
  return { id, name: section.name, body: section.body, traits, table, prose };
}

for (const section of sections()) parsed.set(section.name.toLowerCase(), parseClass(section));

/** Build the 20 level rows plus the feature ids each row grants. */
function levelTable(entry: ReturnType<typeof parseClass>, config: ClassConfig) {
  const { columns, rows } = entry.table;
  /** feature id -> the FIRST level that grants it, for FeatureRecord.level. */
  const featureIds = new Map<string, number>();
  const table: ClassLevelRow[] = rows.map((cells) => {
    const row: Record<string, unknown> = { features: [], classResources: [] };
    const slots = new Array(9).fill(0);
    let sawSlot = false;
    let pact: { level: number; slots: number } | null = null;
    columns.forEach((column, index) => {
      const cell = cells[index] ?? "";
      if (column === "Level") { row.level = intOf(cell); return; }
      if (column === "Proficiency Bonus") { row.proficiencyBonus = intOf(cell); return; }
      // Read positionally below, because every printed class table puts it at index 2.
      if (column === "Class Features") return;
      if (/^[1-9]$/.test(column)) {
        if (!blank(cell)) { slots[Number(column) - 1] = intOf(cell) ?? 0; sawSlot = true; }
        else sawSlot = sawSlot || false;
        return;
      }
      const spec = config.columns[column];
      if (spec === undefined) {
        if (column === "") return;
        throw new Error(`${entry.name}: unmapped table column "${column}" - add it to CONFIG.columns`);
      }
      if (spec === "features") return;
      if (blank(cell)) return;
      if (spec === "cantrips") { row.cantripsKnown = intOf(cell) ?? 0; return; }
      if (spec === "prepared") { row.preparedCount = intOf(cell) ?? 0; return; }
      if (spec === "pact-slots") { pact = { ...(pact ?? { level: 1, slots: 0 }), slots: intOf(cell) ?? 0 }; return; }
      if (spec === "pact-level") { pact = { ...(pact ?? { level: 1, slots: 0 }), level: intOf(cell) ?? 1 }; return; }
      const amount = spec.dice ? strip(cell).toLowerCase().replace(/^d/, "1d") : intOf(cell);
      if (amount === null || amount === "") return;
      (row.classResources as unknown[]).push({ id: spec.id, name: spec.name, amount });
    });
    // The features column is positional: always index 2 in every printed class table. A level that
    // grants nothing prints an em dash, which slugs to "" - drop those rather than emit a blank id.
    const named = strip(cells[2] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    row.features = named.map((label) => slug(label)).filter(Boolean);
    for (const id of row.features as string[]) featureIds.set(id, (featureIds.get(id) ?? row.level) as number);
    if (sawSlot && slots.some((count) => count > 0)) row.spellSlots = slots;
    if (pact) row.pactSlots = pact;
    return row as unknown as ClassLevelRow;
  });
  return { table, featureIds };
}

const built: unknown[] = [];
const builtSubclasses: unknown[] = [];
const report: string[] = [];

for (const [id, entry] of parsed) {
  if (HAND_AUTHORED.has(id)) continue;
  const config = CONFIG[id];
  if (!config) throw new Error(`no CONFIG for class "${id}"`);
  const { traits } = entry;
  const { table, featureIds } = levelTable(entry, config);

  const primary = abilitiesIn(traits["Primary Ability"] ?? "");
  const anyOf = /\bor\b/i.test(traits["Primary Ability"] ?? "");
  const skills = skillsOf(traits["Skill Proficiencies"] ?? "");
  const toolText = traits["Tool Proficiencies"] ?? traits["Tool Proficiency"] ?? "";
  const equipment = equipmentOf(traits["Starting Equipment"] ?? "", id, catalog, unresolvedItems);

  const features = [...featureIds].map(([featureId, level]) => {
    const description = entry.prose.get(featureId)
      ?? entry.prose.get(featureId.replace(new RegExp(`^${id}-`), ""))
      ?? `See the ${entry.name} class description in SRD 5.2.1.`;
    const configured = config.choices?.[featureId];
    const choice = configured?.optionsFrom
      ? (() => {
          const { optionsFrom, ...rest } = configured;
          // `from` is DERIVED from the option ids by the schema - authoring both is rejected.
          return { ...rest, options: optionSection(entry.body, optionsFrom) };
        })()
      : configured;
    return {
      id: featureId,
      name: featureId.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      level,
      description: description.slice(0, 4000),
      ...(choice ? { choice } : {})
    };
  });

  const record = {
    id,
    name: entry.name,
    source: "srd",
    summary: BLURBS[id].summary,
    description: BLURBS[id].description,
    hitDie: (traits["Hit Point Die"] ?? "").match(/[Dd](\d+)/)?.[0].toLowerCase() ?? "d8",
    // statPriority is NOT in the SRD text - it is the product's own ordering for the random
    // generator, and `@vtt/rules-5e` already owns it for all twelve classes. Reading it here keeps
    // one copy; a second hand-maintained list is exactly what the content/engine agreement test
    // exists to catch, and it caught four of them on the first run.
    statPriority: statPriorityFor(id),
    primaryAbilities: primary,
    savingThrows: abilitiesIn(traits["Saving Throw Proficiencies"] ?? ""),
    skillChoices: skills,
    armorProficiencies: armorOf(traits["Armor Training"] ?? ""),
    weaponProficiencies: weaponsOf(traits["Weapon Proficiencies"] ?? ""),
    toolProficiencies: /choose/i.test(toolText) ? [] : (toolText ? [slug(toolText)] : []),
    startingEquipment: equipment,
    multiclassPrerequisites: {
      mode: anyOf ? "any" : "all",
      minimums: primary.map((ability) => ({ ability, minimum: 13 }))
    },
    subclassLevel: config.subclassLevel,
    subclassLabel: `${entry.name} Subclass`,
    asiLevels: table.filter((row) => row.features.includes("ability-score-improvement")).map((row) => row.level),
    ...(config.spellcasting ? { spellcasting: config.spellcasting } : {}),
    levelTable: table,
    features
  };
  built.push(record);
  report.push(`${entry.name}: ${table.length} rows, ${features.length} features, ${equipment.length} equipment options`);
}

console.log(report.join("\n"));
if (unresolvedItems.length) {
  console.error(`\nUnresolved equipment ids (${unresolvedItems.length}):`);
  for (const item of unresolvedItems) console.error(`  ${item}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Subclasses
// ---------------------------------------------------------------------------------------------

/** `#### Level 7: Remarkable Athlete` -> { level, name }. */
const LEVEL_HEADING = /^Level (\d+):\s*(.+)$/;

for (const [id, entry] of parsed) {
  if (HAND_AUTHORED.has(id)) continue;
  const heading = [...entry.body.matchAll(/^### (.+ Subclass: .+)$/gm)][0];
  if (!heading) throw new Error(`${entry.name}: no subclass section`);
  const title = strip(heading[1]).split(": ")[1];
  const tail = entry.body.split(heading[0])[1].split(/^### /m)[0];
  const parts = tail.split(/^#### (.+)$/m);
  const intro = parts[0].split("\n").map((line) => line.trim()).filter(Boolean)
    .filter((line) => !line.startsWith("_")).join(" ").replace(/[*_]/g, "").trim();
  const features: unknown[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const match = strip(parts[i]).match(LEVEL_HEADING);
    if (!match) continue;
    const description = parts[i + 1]
      .replace(/<table>[\s\S]*?<\/table>/g, " ")
      .split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
      .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    if (!description) continue;
    features.push({ id: slug(match[2]), name: strip(match[2]), level: Number(match[1]), description: description.slice(0, 4000) });
  }
  builtSubclasses.push({
    id: slug(title), name: title, source: "srd", classId: id,
    subclassLevel: CONFIG[id].subclassLevel,
    summary: intro.split(". ")[0].slice(0, 200) || `${title}, the SRD 5.2.1 ${entry.name} subclass.`,
    description: intro.slice(0, 4000) || `${title}.`,
    features
  });
}

// ---------------------------------------------------------------------------------------------
// Cross-check: the hand-authored three, re-parsed from this source
// ---------------------------------------------------------------------------------------------

// Only the hand-authored records are carried over. Reading the whole file would append this run's
// output to the previous run's, so a second invocation would double the bundle - the script has to
// be idempotent because it writes over its own input.
const existingClasses = (JSON.parse(readFileSync(join(bundles, "classes.v1.json"), "utf8")) as ClassReference[])
  .filter((record) => HAND_AUTHORED.has(record.id));
const disagreements: string[] = [];
for (const record of existingClasses) {
  const entry = parsed.get(record.id);
  if (!entry) { disagreements.push(`${record.id}: not present in the source at all`); continue; }
  const traits = entry.traits;
  const die = (traits["Hit Point Die"] ?? "").match(/[Dd](\d+)/)?.[0].toLowerCase();
  if (die !== record.hitDie) disagreements.push(`${record.id}.hitDie: source ${die} vs bundle ${record.hitDie}`);
  const saves = abilitiesIn(traits["Saving Throw Proficiencies"] ?? "");
  if (saves.join() !== [...record.savingThrows].sort((a, b) => saves.indexOf(a) - saves.indexOf(b)).join()) {
    if ([...saves].sort().join() !== [...record.savingThrows].sort().join()) {
      disagreements.push(`${record.id}.savingThrows: source ${saves} vs bundle ${record.savingThrows}`);
    }
  }
  const skills = skillsOf(traits["Skill Proficiencies"] ?? "");
  if (skills.choose !== record.skillChoices.choose) disagreements.push(`${record.id}.skillChoices.choose: source ${skills.choose} vs bundle ${record.skillChoices.choose}`);
  if ([...skills.from].sort().join() !== [...record.skillChoices.from].sort().join()) {
    disagreements.push(`${record.id}.skillChoices.from: source ${skills.from} vs bundle ${record.skillChoices.from}`);
  }
  const config: ClassConfig = { subclassLevel: record.subclassLevel, columns: {} };
  for (const column of entry.table.columns) {
    if (["Level", "Proficiency Bonus", "Class Features", ""].includes(column) || /^[1-9]$/.test(column)) continue;
    config.columns[column] = column === "Cantrips" ? "cantrips" : column === "Prepared Spells" ? "prepared"
      : { id: slug(column), name: column, dice: /die$/i.test(column) };
  }
  const { table } = levelTable(entry, config);
  table.forEach((row, index) => {
    const mine = record.levelTable[index];
    if (row.proficiencyBonus !== mine.proficiencyBonus) disagreements.push(`${record.id}.L${row.level}.proficiencyBonus: source ${row.proficiencyBonus} vs bundle ${mine.proficiencyBonus}`);
    const a = JSON.stringify(row.spellSlots ?? null);
    const b = JSON.stringify(mine.spellSlots ?? null);
    if (a !== b) disagreements.push(`${record.id}.L${row.level}.spellSlots: source ${a} vs bundle ${b}`);
  });
}
if (disagreements.length) {
  console.error(`\nCROSS-CHECK: ${disagreements.length} disagreement(s) between the source and the hand-authored bundle:`);
  for (const line of disagreements) console.error(`  ${line}`);
  console.error("Resolve against the SRD text before trusting this source for new content.");
  process.exit(1);
}
console.log(`cross-check: ${existingClasses.length} hand-authored classes agree with the source.`);

// ---------------------------------------------------------------------------------------------
// Validate and write
// ---------------------------------------------------------------------------------------------

const allClasses = [...existingClasses, ...built].sort((left, right) =>
  (left as ClassReference).name.localeCompare((right as ClassReference).name));
const existingSubclasses = (JSON.parse(readFileSync(join(bundles, "subclasses.v1.json"), "utf8")) as { classId: string }[])
  .filter((record) => HAND_AUTHORED.has(record.classId));
const allSubclasses = [...existingSubclasses, ...builtSubclasses].sort((left, right) =>
  (left as { name: string }).name.localeCompare((right as { name: string }).name));

const fail = (label: string, error: z.ZodError) => {
  console.error(`\n${label} VALIDATION FAILED:`);
  for (const issue of error.issues.slice(0, 25)) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
};
const classesOut = z.array(ClassReferenceSchema).safeParse(allClasses);
if (!classesOut.success) fail("classes", classesOut.error);
const subclassesOut = z.array(SubclassReferenceSchema).safeParse(allSubclasses);
if (!subclassesOut.success) fail("subclasses", subclassesOut.error);

writeFileSync(join(bundles, "classes.v1.json"), `${JSON.stringify(allClasses, null, 1)}\n`);
writeFileSync(join(bundles, "subclasses.v1.json"), `${JSON.stringify(allSubclasses, null, 1)}\n`);
console.log(`\nwrote ${allClasses.length} classes, ${allSubclasses.length} subclasses.`);

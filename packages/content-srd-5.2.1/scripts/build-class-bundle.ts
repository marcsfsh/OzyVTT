/**
 * Class/subclass ETL. Reads `sources/dnd-5e-srd-markdown/classes.md` (CC BY 4.0 SRD 5.2.1; see that
 * directory's PROVENANCE.json) and emits `classes.v1.json` and `subclasses.v1.json`.
 *
 * Fighter, Wizard and Cleric (and their subclasses) are transcribed by hand in
 * `sources/authored/classes.json` and `subclasses.json`, so they are copied through and used as an
 * oracle: the cross-check re-parses them from the source and fails the build on a mechanical
 * disagreement. Every other class is generated. The mechanics overlay applies to both.
 *
 * Step 3 of `npm run content`: starting equipment resolves against the equipment, weapons and armor
 * bundles the earlier steps wrote.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CLASS_MECHANICS, LIVE_CLASS_RESOURCES, SUBCLASS_MECHANICS, applyMechanics } from "./class-mechanics/index.js";
import { slug, strip, withTables } from "./markdown.js";
import { join } from "node:path";
import { z } from "zod";
import { statPriorityFor } from "@vtt/rules-5e";
import {
  ClassReferenceSchema,
  SubclassReferenceSchema,
  type ClassReference,
  type ClassLevelRow,
  type SubclassReference
} from "../src/character-content.js";
import { outDir, sourcePath } from "./paths.js";

const source = readFileSync(sourcePath("dnd-5e-srd-markdown", "classes.md"), "utf8");

/** The hand-transcribed records, before the overlay merge below. */
const authoredClasses: ClassReference[] = JSON.parse(readFileSync(sourcePath("authored", "classes.json"), "utf8"));
const authoredSubclasses: SubclassReference[] = JSON.parse(
  readFileSync(sourcePath("authored", "subclasses.json"), "utf8")
);
const AUTHORED_IDS: ReadonlySet<string> = new Set(authoredClasses.map((record) => record.id));

// ---- Markdown/HTML parsing helpers (shared ones live in `./markdown.ts`) ------------------------

/** `#### Level 7: Remarkable Athlete` -> [, level, name]. Read by both the class and subclass parsers. */
const LEVEL_HEADING = /^Level (\d+):\s*(.+)$/;

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
 * The "<Class> Features" table as column names + 20 rows of cells. The spell-slot columns sit under
 * one `colspan="9"` header with slot levels in a second header row, so the second row's labels are
 * laid over the expanded first row.
 */
function featuresTable(body: string, className: string): { columns: string[]; rows: string[][] } {
  const table = body.match(new RegExp(`\\*\\*${className} Features\\*\\*\\s*(<table>[\\s\\S]*?</table>)`));
  if (!table) throw new Error(`no features table for ${className}`);
  const headRows = [...(table[1].match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const columns: string[] = [];
  for (const [, cell, attrs] of headRows[0]?.[1].matchAll(/<th(?:\s+colspan="(\d+)")?>([\s\S]*?)<\/th>/g) ?? [])
    void [cell, attrs];
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
 * The `#### Name` entries under one `### Heading`, as FeatureOptions carrying their own prose
 * (Metamagic, Eldritch Invocations).
 */
function optionSection(body: string, heading: string) {
  const after = body.split(new RegExp(`^### ${heading}$`, "m"))[1];
  if (!after) throw new Error(`no "${heading}" section`);
  const tail = after.split(/^### /m)[0];
  const parts = tail.split(/^#### (.+)$/m);
  const options: { id: string; name: string; description: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const name = strip(parts[i]);
    const description = withTables(parts[i + 1])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/[*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (name && description) options.push({ id: slug(name), name, description: description.slice(0, 4000) });
  }
  return options;
}

/**
 * Feature prose keyed by slug, from the `###`/`####` headings that follow the tables. Keyed under both
 * the raw heading slug and the `Level N: `-stripped one: `#### Level 1: Rage` slugs to
 * `level-1-rage`, but the level table names the feature `rage`.
 */
function featureProse(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.split(/^#{3,4} (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = strip(parts[i]);
    const text = withTables(parts[i + 1].split(/\n#{3,6} /)[0])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/[*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const bare = heading.match(LEVEL_HEADING)?.[2];
    // First write wins: "Level 4: Ability Score Improvement" repeats at 4, 8, 12, 16 and 19.
    for (const key of [slug(heading), ...(bare ? [slug(bare)] : [])]) {
      if (!out.has(key)) out.set(key, text);
    }
  }
  return out;
}

/**
 * Last resort: the longest heading slug that is a hyphen-boundary prefix of the feature id. One
 * heading can name a family the level table splits (Warlock's Mystic Arcanum at 11/13/15/17).
 * Matching whole segments keeps `brutal-strike` from claiming `improved-brutal-strike`.
 */
function proseByPrefix(prose: Map<string, string>, featureId: string): string | undefined {
  let best: string | undefined;
  for (const key of prose.keys()) {
    if (!featureId.startsWith(`${key}-`)) continue;
    if (best === undefined || key.length > best.length) best = key;
  }
  return best === undefined ? undefined : prose.get(best);
}

// ---- Per-class configuration the printed text cannot supply deterministically -------------------

/**
 * One printed resource column. `display` marks a column with no live `uses.pool`; it is cleared
 * automatically for columns in `LIVE_CLASS_RESOURCES`. `class-resource-pools.test.ts` checks both.
 */
type ResourceSpec = { id: string; name: string; dice?: boolean; display?: boolean };
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
  "acrobatics",
  "animal-handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight-of-hand",
  "stealth",
  "survival"
];

// "The Ability Score Improvement feat or another feat of your choice for which you qualify": every category,
// with prerequisites checked by the build. `repeatable`: an ASI may be taken at several levels, and the server
// rejects a repeated option id unless the choice allows it (a feat that is not repeatable is still refused).
const asiChoice = { kind: "asi-or-feat", choose: 1, fromCatalog: "feats", repeatable: true };
const weaponMastery = (n: number) => ({ kind: "weapon-mastery", choose: n, fromCatalog: "weapons" });

/**
 * Short class copy written for this product, not SRD text: the vendored transcription omits the
 * SRD's per-class flavour paragraphs. Replace these if those paragraphs are ever vendored.
 */
const BLURBS: Record<string, { summary: string; description: string }> = {
  barbarian: {
    summary: "A primal fighter who turns rage into overwhelming physical force.",
    description:
      "Barbarians fight in a fury they can enter at will, shrugging off punishment that would drop anyone else. Rage powers their damage and their resilience, and the pool of rages is the resource the class is built around."
  },
  bard: {
    summary: "A performer whose magic works through music, words and sheer presence.",
    description:
      "Bards are full casters who support the party as much as they threaten enemies. Bardic Inspiration hands out a die that other characters spend, and expertise makes the Bard the party's most reliable skill user."
  },
  druid: {
    summary: "A full caster drawing on the natural world, able to take animal form.",
    description:
      "Druids cast from the nature list and can spend Wild Shape to become a beast. The class trades some direct damage for versatility, control, and the ability to change what it is on the battlefield."
  },
  monk: {
    summary: "An unarmoured martial artist spending focus on fast, precise strikes.",
    description:
      "Monks fight without armour, using a martial-arts die that grows with level and Focus Points that buy extra attacks and mobility. Speed and action economy are the class's real weapons."
  },
  paladin: {
    summary: "An oath-bound warrior blending heavy-armour combat with divine magic.",
    description:
      "Paladins are half casters who fight on the front line. Channel Divinity and spell slots spent on smites give the class burst damage on top of the durability of full plate and a shield."
  },
  ranger: {
    summary: "A half-caster tracker at home on the borders of the wild.",
    description:
      "Rangers combine martial skill with a small nature spell list and strong exploration tools. Expertise and a wide skill list make the class as useful between fights as in them."
  },
  rogue: {
    summary: "A precise, stealthy opportunist who strikes where it hurts most.",
    description:
      "Rogues deal their damage through Sneak Attack, which scales to 10d6, and gain more expertise than any other class. The class is built to pick its moment rather than trade blows."
  },
  sorcerer: {
    summary: "A caster whose magic is innate, reshaped on the fly through Metamagic.",
    description:
      "Sorcerers know fewer spells than a Wizard but bend the ones they have. Sorcery Points buy Metamagic - twinning, quickening, or subtly casting a spell - which is what the class spends its resources on."
  },
  warlock: {
    summary: "A caster powered by a pact, with few slots that always cast at full strength.",
    description:
      "Warlocks use Pact Magic: a small number of slots, all at the highest level available, refreshed on a short rest. Eldritch Invocations are the class's real customisation, reshaping what it can do at will."
  }
};

const CONFIG: Record<string, ClassConfig> = {
  barbarian: {
    subclassLevel: 3,
    columns: {
      Rages: { id: "rage", name: "Rages", display: true },
      "Rage Damage": { id: "rage-damage", name: "Rage Damage", display: true },
      "Weapon Mastery": { id: "weapon-mastery", name: "Weapon Mastery", display: true }
    },
    choices: {
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "barbarian-subclass": { kind: "subclass", choose: 1, fromCatalog: "barbarian-subclasses" }
    }
  },
  bard: {
    subclassLevel: 3,
    spellcasting: {
      ability: "cha",
      prepares: "prepared",
      ritual: true,
      focus: "arcane-focus",
      multiclassProgression: "full",
      spellListId: "bard"
    },
    columns: {
      "Bardic Die": { id: "bardic-inspiration", name: "Bardic Die", dice: true, display: true },
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
    spellcasting: {
      ability: "wis",
      prepares: "prepared",
      ritual: true,
      focus: "druidic-focus",
      multiclassProgression: "full",
      spellListId: "druid"
    },
    columns: {
      "Wild Shape": { id: "wild-shape", name: "Wild Shape", display: true },
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
      "Martial Arts": { id: "martial-arts", name: "Martial Arts", dice: true, display: true },
      "Focus Points": { id: "focus-points", name: "Focus Points", display: true },
      "Unarmored Movement": { id: "unarmored-movement", name: "Unarmored Movement", display: true }
    },
    choices: {
      "ability-score-improvement": asiChoice,
      "monk-subclass": { kind: "subclass", choose: 1, fromCatalog: "monk-subclasses" }
    }
  },
  paladin: {
    subclassLevel: 3,
    spellcasting: {
      ability: "cha",
      prepares: "prepared",
      ritual: false,
      focus: "holy-symbol",
      multiclassProgression: "half",
      spellListId: "paladin"
    },
    columns: {
      "Channel Divinity": { id: "channel-divinity", name: "Channel Divinity", display: true },
      "Prepared Spells": "prepared"
    },
    choices: {
      // Paladin and Ranger `fighting-style` is authored in the overlay: it is a catalog plus one bespoke
      // inline option, which `CONFIG.choices` cannot carry.
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "paladin-subclass": { kind: "subclass", choose: 1, fromCatalog: "paladin-subclasses" }
    }
  },
  ranger: {
    subclassLevel: 3,
    spellcasting: {
      ability: "wis",
      prepares: "prepared",
      ritual: true,
      focus: "druidic-focus",
      multiclassProgression: "half",
      spellListId: "ranger"
    },
    columns: {
      "Favored Enemy": { id: "favored-enemy", name: "Favored Enemy", display: true },
      "Prepared Spells": "prepared"
    },
    choices: {
      // See the Paladin note above - Ranger's Druidic Warrior is the same shape.
      "weapon-mastery": weaponMastery(2),
      expertise: { kind: "expertise", choose: 2, fromCatalog: "skills" },
      "ability-score-improvement": asiChoice,
      "ranger-subclass": { kind: "subclass", choose: 1, fromCatalog: "ranger-subclasses" }
    }
  },
  rogue: {
    subclassLevel: 3,
    columns: { "Sneak Attack": { id: "sneak-attack", name: "Sneak Attack", dice: true, display: true } },
    choices: {
      expertise: { kind: "expertise", choose: 2, fromCatalog: "skills" },
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "rogue-subclass": { kind: "subclass", choose: 1, fromCatalog: "rogue-subclasses" }
    }
  },
  sorcerer: {
    subclassLevel: 3,
    spellcasting: {
      ability: "cha",
      prepares: "prepared",
      ritual: false,
      focus: "arcane-focus",
      multiclassProgression: "full",
      spellListId: "sorcerer"
    },
    columns: {
      "Sorcery Points": { id: "sorcery-points", name: "Sorcery Points", display: true },
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
    spellcasting: {
      ability: "cha",
      prepares: "prepared",
      ritual: true,
      focus: "arcane-focus",
      multiclassProgression: "pact",
      spellListId: "warlock"
    },
    columns: {
      "Eldritch Invocations": { id: "eldritch-invocations", name: "Eldritch Invocations", display: true },
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

// ---- Trait interpretation -----------------------------------------------------------------------

const ABILITY: Record<string, string> = {
  Strength: "str",
  Dexterity: "dex",
  Constitution: "con",
  Intelligence: "int",
  Wisdom: "wis",
  Charisma: "cha"
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
 * Weapon training. Monk and Rogue get a qualified slice of Martial ("that have the Light property"),
 * so the id keeps the qualifier rather than flattening to `martial`.
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
  const from = list
    .split(/,| or /i)
    .map((part) => slug(part))
    .filter((id) => ALL_SKILLS.includes(id));
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
 * Starting-equipment entries that point at another choice ("the Artisan's Tools ... chosen for the
 * tool proficiency above"). Kept in the label only; emitting an item id would invent a tool.
 */
const ITEM_POINTERS = [/chosen for the tool proficiency/i, /of your choice$/i];

type CatalogIndex = Map<string, string>;
function catalogIndex(): CatalogIndex {
  const index: CatalogIndex = new Map();
  for (const file of ["equipment.v1.json", "weapons.v1.json", "armor.v1.json"]) {
    for (const row of JSON.parse(readFileSync(join(outDir, file), "utf8")) as { id: string; name: string }[]) {
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
  const options: {
    id: string;
    label: string;
    items: { id: string; name: string; quantity: number }[];
    goldPieces: number;
  }[] = [];
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
      const resolved = id && catalog.has(id) ? id : catalog.has(key) ? key : null;
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

// ---- Build --------------------------------------------------------------------------------------

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
  const entryId = entry.id;
  /** feature id -> the first level that grants it, for FeatureRecord.level. */
  const featureIds = new Map<string, number>();
  const table: ClassLevelRow[] = rows.map((cells) => {
    const row: Record<string, unknown> = { features: [], classResources: [] };
    const slots = new Array(9).fill(0);
    let sawSlot = false;
    let pact: { level: number; slots: number } | null = null;
    columns.forEach((column, index) => {
      const cell = cells[index] ?? "";
      if (column === "Level") {
        row.level = intOf(cell);
        return;
      }
      if (column === "Proficiency Bonus") {
        row.proficiencyBonus = intOf(cell);
        return;
      }
      // Read positionally below, because every printed class table puts it at index 2.
      if (column === "Class Features") return;
      if (/^[1-9]$/.test(column)) {
        if (!blank(cell)) {
          slots[Number(column) - 1] = intOf(cell) ?? 0;
          sawSlot = true;
        } else sawSlot = sawSlot || false;
        return;
      }
      const spec = config.columns[column];
      if (spec === undefined) {
        if (column === "") return;
        throw new Error(`${entry.name}: unmapped table column "${column}" - add it to CONFIG.columns`);
      }
      if (spec === "features") return;
      if (blank(cell)) return;
      if (spec === "cantrips") {
        row.cantripsKnown = intOf(cell) ?? 0;
        return;
      }
      if (spec === "prepared") {
        row.preparedCount = intOf(cell) ?? 0;
        return;
      }
      if (spec === "pact-slots") {
        pact = { ...(pact ?? { level: 1, slots: 0 }), slots: intOf(cell) ?? 0 };
        return;
      }
      if (spec === "pact-level") {
        pact = { ...(pact ?? { level: 1, slots: 0 }), level: intOf(cell) ?? 1 };
        return;
      }
      const amount = spec.dice ? strip(cell).toLowerCase().replace(/^d/, "1d") : intOf(cell);
      if (amount === null || amount === "") return;
      // `display: true` is cleared for columns the overlay wires to a real pool (`LIVE_CLASS_RESOURCES`).
      const live = (LIVE_CLASS_RESOURCES[entryId] ?? []).includes(spec.id);
      (row.classResources as unknown[]).push({
        id: spec.id,
        name: spec.name,
        amount,
        ...(spec.display && !live ? { display: true } : {})
      });
    });
    // The features column is always index 2. Em-dash cells slug to "" and are dropped. "Subclass
    // feature" is dropped too: it is a reminder row with no prose, and the real feature lives on the
    // subclass record.
    const named = strip(cells[2] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    row.features = named.map((label) => slug(label)).filter((id) => id && id !== "subclass-feature");
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
/** Overlay keys that matched no generated feature - a renamed id whose riders would otherwise vanish. */
const overlayMisses: string[] = [];

for (const [id, entry] of parsed) {
  if (AUTHORED_IDS.has(id)) continue;
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
    const description =
      entry.prose.get(featureId) ??
      entry.prose.get(featureId.replace(new RegExp(`^${id}-`), "")) ??
      proseByPrefix(entry.prose, featureId) ??
      `See the ${entry.name} class description in SRD 5.2.1.`;
    const configured = config.choices?.[featureId];
    const choice = configured?.optionsFrom
      ? (() => {
          const { optionsFrom, ...rest } = configured;
          // `from` is derived from the option ids by the schema - authoring both is rejected.
          return { ...rest, options: optionSection(entry.body, optionsFrom) };
        })()
      : configured;
    return {
      id: featureId,
      name: featureId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
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
    // statPriority is not in the SRD; `@vtt/rules-5e` owns it for all twelve classes.
    statPriority: statPriorityFor(id),
    primaryAbilities: primary,
    savingThrows: abilitiesIn(traits["Saving Throw Proficiencies"] ?? ""),
    skillChoices: skills,
    armorProficiencies: armorOf(traits["Armor Training"] ?? ""),
    weaponProficiencies: weaponsOf(traits["Weapon Proficiencies"] ?? ""),
    toolProficiencies: /choose/i.test(toolText) ? [] : toolText ? [slug(toolText)] : [],
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
  // The SRD markdown carries no riders, so prose is generated and mechanics come from the overlay
  // (`class-mechanics/overlay.ts`).
  overlayMisses.push(...applyMechanics(id, features, CLASS_MECHANICS));
  // Parse the finished record so overlay authoring mistakes stop the build here.
  ClassReferenceSchema.parse(record);
  built.push(record);
  const overlaid = Object.keys(CLASS_MECHANICS[id] ?? {}).length;
  report.push(
    `${entry.name}: ${table.length} rows, ${features.length} features, ${equipment.length} equipment options${overlaid ? `, ${overlaid} with mechanics` : ""}`
  );
}

console.log(report.join("\n"));
// The overlay-miss check runs after the subclass loop so subclass keys are checked too.
if (unresolvedItems.length) {
  console.error(`\nUnresolved equipment ids (${unresolvedItems.length}):`);
  for (const item of unresolvedItems) console.error(`  ${item}`);
  process.exit(1);
}

// ---- Subclasses ---------------------------------------------------------------------------------

/**
 * Authored features with no counterpart heading in the source. Life Domain prints one spells entry
 * with a table; the hand-authored record splits it into staged grants at Cleric levels 3/5/7/9.
 * Anything else the source does not print is a real defect.
 */
const STAGED_FEATURES = new Set(["life-domain-spells-5", "life-domain-spells-7", "life-domain-spells-9"]);

type ParsedSubclass = {
  title: string;
  intro: string;
  features: { id: string; name: string; level: number; description: string }[];
};

/**
 * The one subclass printed for a class, as title + intro + level-stamped features. Shared by
 * generation and the cross-check so both see the same parse.
 */
function parseSubclass(entry: ReturnType<typeof parseClass>): ParsedSubclass {
  const heading = [...entry.body.matchAll(/^### (.+ Subclass: .+)$/gm)][0];
  if (!heading) throw new Error(`${entry.name}: no subclass section`);
  const title = strip(heading[1]).split(": ")[1];
  const tail = entry.body.split(heading[0])[1].split(/^### /m)[0];
  const parts = tail.split(/^#### (.+)$/m);
  const intro = parts[0]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("_"))
    .join(" ")
    .replace(/[*_]/g, "")
    .trim();
  const features: ParsedSubclass["features"] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const match = strip(parts[i]).match(LEVEL_HEADING);
    if (!match) continue;
    const description = withTables(parts[i + 1])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/[*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!description) continue;
    features.push({
      id: slug(match[2]),
      name: strip(match[2]),
      level: Number(match[1]),
      description: description.slice(0, 4000)
    });
  }
  return { title, intro, features };
}

for (const [id, entry] of parsed) {
  if (AUTHORED_IDS.has(id)) continue;
  const { title, intro, features } = parseSubclass(entry);
  const subclassId = slug(title);
  const record = {
    id: subclassId,
    name: title,
    source: "srd",
    classId: id,
    subclassLevel: CONFIG[id].subclassLevel,
    summary: intro.split(". ")[0].slice(0, 200) || `${title}, the SRD 5.2.1 ${entry.name} subclass.`,
    description: intro.slice(0, 4000) || `${title}.`,
    features
  };
  // The subclass half of the overlay, keyed on (subclassId, featureId).
  overlayMisses.push(...applyMechanics(subclassId, features, SUBCLASS_MECHANICS));
  // Parsed for the same reason a class is.
  SubclassReferenceSchema.parse(record);
  builtSubclasses.push(record);
  const overlaid = Object.keys(SUBCLASS_MECHANICS[subclassId] ?? {}).length;
  if (overlaid) console.log(`${title}: ${features.length} features, ${overlaid} with mechanics`);
}

// ---- The hand-authored three: overlay, then cross-check against this source ----------------------

/**
 * The overlay applies to the hand-authored records too. `applyMechanics` refuses a rider the record
 * already carries, so each rider has one home: the authored file or the class module.
 */
for (const record of authoredClasses) {
  overlayMisses.push(...applyMechanics(record.id, record.features, CLASS_MECHANICS));
  ClassReferenceSchema.parse(record);
  const overlaid = Object.keys(CLASS_MECHANICS[record.id] ?? {}).length;
  if (overlaid) console.log(`${record.name} (hand-authored): ${overlaid} feature(s) with overlay mechanics`);
}
for (const record of authoredSubclasses) {
  overlayMisses.push(...applyMechanics(record.id, record.features, SUBCLASS_MECHANICS));
  SubclassReferenceSchema.parse(record);
}
// An overlay key matching no feature fails the build, for all four merges.
if (overlayMisses.length) {
  console.error(`\nMechanics overlay keys matching no feature (${overlayMisses.length}):`);
  for (const key of overlayMisses) console.error(`  ${key}`);
  process.exit(1);
}

const disagreements: string[] = [];
for (const record of authoredClasses) {
  const entry = parsed.get(record.id);
  if (!entry) {
    disagreements.push(`${record.id}: not present in the source at all`);
    continue;
  }
  const traits = entry.traits;
  const die = (traits["Hit Point Die"] ?? "").match(/[Dd](\d+)/)?.[0].toLowerCase();
  if (die !== record.hitDie) disagreements.push(`${record.id}.hitDie: source ${die} vs authored ${record.hitDie}`);
  const saves = abilitiesIn(traits["Saving Throw Proficiencies"] ?? "");
  if (saves.join() !== [...record.savingThrows].sort((a, b) => saves.indexOf(a) - saves.indexOf(b)).join()) {
    if ([...saves].sort().join() !== [...record.savingThrows].sort().join()) {
      disagreements.push(`${record.id}.savingThrows: source ${saves} vs authored ${record.savingThrows}`);
    }
  }
  const skills = skillsOf(traits["Skill Proficiencies"] ?? "");
  if (skills.choose !== record.skillChoices.choose)
    disagreements.push(
      `${record.id}.skillChoices.choose: source ${skills.choose} vs authored ${record.skillChoices.choose}`
    );
  if ([...skills.from].sort().join() !== [...record.skillChoices.from].sort().join()) {
    disagreements.push(`${record.id}.skillChoices.from: source ${skills.from} vs authored ${record.skillChoices.from}`);
  }
  const config: ClassConfig = { subclassLevel: record.subclassLevel, columns: {} };
  for (const column of entry.table.columns) {
    if (["Level", "Proficiency Bonus", "Class Features", ""].includes(column) || /^[1-9]$/.test(column)) continue;
    config.columns[column] =
      column === "Cantrips"
        ? "cantrips"
        : column === "Prepared Spells"
          ? "prepared"
          : { id: slug(column), name: column, dice: /die$/i.test(column) };
  }
  const { table } = levelTable(entry, config);
  table.forEach((row, index) => {
    const mine = record.levelTable[index];
    if (row.proficiencyBonus !== mine.proficiencyBonus)
      disagreements.push(
        `${record.id}.L${row.level}.proficiencyBonus: source ${row.proficiencyBonus} vs authored ${mine.proficiencyBonus}`
      );
    const a = JSON.stringify(row.spellSlots ?? null);
    const b = JSON.stringify(mine.spellSlots ?? null);
    if (a !== b) disagreements.push(`${record.id}.L${row.level}.spellSlots: source ${a} vs authored ${b}`);
  });

  // Subclass features: ids and levels are compared, not prose (descriptions are reworded in places).
  const authoredSubclass = authoredSubclasses.find((sub) => sub.classId === record.id);
  if (authoredSubclass) {
    const fromSource = parseSubclass(entry);
    if (slug(fromSource.title) !== authoredSubclass.id) {
      disagreements.push(
        `${record.id}: source prints subclass "${fromSource.title}" vs authored "${authoredSubclass.name}"`
      );
    } else {
      const sourceLevels = new Map(fromSource.features.map((feature) => [feature.id, feature.level]));
      const authoredLevels = new Map(authoredSubclass.features.map((feature) => [feature.id, feature.level]));
      for (const [id, level] of sourceLevels) {
        if (!authoredLevels.has(id))
          disagreements.push(
            `${authoredSubclass.id}: source has "${id}" at level ${level}; the authored record does not have it at all`
          );
        else if (authoredLevels.get(id) !== level)
          disagreements.push(
            `${authoredSubclass.id}.${id}: source level ${level} vs authored level ${authoredLevels.get(id)}`
          );
      }
      for (const id of authoredLevels.keys()) {
        if (!sourceLevels.has(id) && !STAGED_FEATURES.has(id)) {
          disagreements.push(
            `${authoredSubclass.id}: the authored record has "${id}", which the source does not print`
          );
        }
      }
    }
  }
}
if (disagreements.length) {
  console.error(
    `\nCROSS-CHECK: ${disagreements.length} disagreement(s) between the source and the hand-authored records:`
  );
  for (const line of disagreements) console.error(`  ${line}`);
  console.error("Resolve against the SRD text before trusting this source for new content.");
  process.exit(1);
}
console.log(`cross-check: ${authoredClasses.length} hand-authored classes agree with the source.`);

// ---- Validate and write -------------------------------------------------------------------------

const allClasses = [...authoredClasses, ...built].sort((left, right) =>
  (left as ClassReference).name.localeCompare((right as ClassReference).name)
);
const allSubclasses = [...authoredSubclasses, ...builtSubclasses].sort((left, right) =>
  (left as { name: string }).name.localeCompare((right as { name: string }).name)
);

const fail = (label: string, error: z.ZodError) => {
  console.error(`\n${label} VALIDATION FAILED:`);
  for (const issue of error.issues.slice(0, 25)) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
};
const classesOut = z.array(ClassReferenceSchema).safeParse(allClasses);
if (!classesOut.success) fail("classes", classesOut.error);
const subclassesOut = z.array(SubclassReferenceSchema).safeParse(allSubclasses);
if (!subclassesOut.success) fail("subclasses", subclassesOut.error);

/**
 * Refuse to write a bundle containing the "See the ... in SRD 5.2.1." fallback: it means prose was
 * lost to a key mismatch. Give a feature real text rather than re-adding a fallback.
 */
const STUB_DESCRIPTION = /^See the .* in SRD 5\.2\.1\.$/;
const stubs = [
  ...allClasses.flatMap((record) =>
    (record as ClassReference).features
      .filter((feature) => STUB_DESCRIPTION.test(feature.description))
      .map((feature) => `${(record as ClassReference).id}.${feature.id}`)
  ),
  ...allSubclasses.flatMap((record) =>
    ((record as { id: string; features: { id: string; description: string }[] }).features ?? [])
      .filter((feature) => STUB_DESCRIPTION.test(feature.description))
      .map((feature) => `${(record as { id: string }).id}.${feature.id}`)
  )
];
if (stubs.length) {
  console.error(
    `\n${stubs.length} emitted feature description(s) are the "See the ... in SRD 5.2.1." STUB, not real prose:`
  );
  for (const line of stubs.slice(0, 40)) console.error(`  ${line}`);
  console.error(
    "A stub means featureProse could not key the heading. Fix the keying (see featureProse); do not lower this bar."
  );
  process.exit(1);
}

writeFileSync(join(outDir, "classes.v1.json"), `${JSON.stringify(allClasses, null, 1)}\n`);
writeFileSync(join(outDir, "subclasses.v1.json"), `${JSON.stringify(allSubclasses, null, 1)}\n`);
console.log(`\nwrote ${allClasses.length} classes, ${allSubclasses.length} subclasses.`);

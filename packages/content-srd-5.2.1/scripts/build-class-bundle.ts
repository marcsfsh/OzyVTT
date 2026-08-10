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
import { CLASS_MECHANICS, HAND_AUTHORED, LIVE_CLASS_RESOURCES, SUBCLASS_MECHANICS, applyMechanics } from "./class-mechanics/index.js";
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

// `HAND_AUTHORED` - the classes already authored by hand, with riders the prose cannot express, and
// never regenerated - is imported from `class-mechanics/overlay.ts` rather than declared here. It is
// a property of the OVERLAY's merge (these are the records it may only add to, and the ones a
// `clears` edits one-way), and one home is what lets a test hold the merge to the same three.

// ---------------------------------------------------------------------------------------------
// Markdown/HTML parsing helpers
// ---------------------------------------------------------------------------------------------

const strip = (value: string) =>
  value.replace(/<[^>]+>/g, " ")
    .replace(/&mdash;|&#8212;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ").trim();

/**
 * ONE HTML table, as a sentence.
 *
 * Every cell is prefixed with its own column heading, so the rendering is self-describing rather
 * than positional: a player reading "Druid Level 2: Known Forms 4, Max CR 1/4, Fly Speed No" needs
 * no column order in their head. Rows join with "; " because descriptions are collapsed to a single
 * line downstream and a table cannot be laid out there.
 *
 * A TWO-COLUMN table labels only its first cell. "Sorcerer Level 3: Alter Self, Chromatic Orb" is
 * unambiguous, and the alternative ("Sorcerer Level 3: Spells Alter Self, ...") reads like a typo -
 * every spell-by-level table in the SRD's subclasses is this shape, so it is worth the special case.
 */
function tableAsText(html: string): string {
  const cells = (row: string, tag: "th" | "td") =>
    [...row.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((cell) => strip(cell[1]));
  const head = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? "";
  const columns = cells(head, "th");
  const bodyRows = [...(html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const lines: string[] = [];
  for (const [, row] of bodyRows) {
    const values = cells(row, "td");
    if (values.length === 0) continue;
    const labelled = values.map((value, index) =>
      (columns[index] && (index === 0 || values.length > 2) ? `${columns[index]} ${value}` : value));
    lines.push(labelled.length === 1 ? labelled[0] : `${labelled[0]}: ${labelled.slice(1).join(", ")}`);
  }
  const text = lines.join("; ");
  return text === "" ? "" : `${text}.`;
}

/**
 * THE TABLES ARE CONTENT, NOT DECORATION - and dropping them truncated five features mid-sentence.
 *
 * Every parser below used to `.replace(/<table>[\s\S]*?<\/table>/g, " ")`, which is why Draconic
 * Spells, Fiend Spells, Oath of Devotion Spells and Circle of the Land Spells each ended at the word
 * "table" with the spells they promise nowhere in the record, and why Nature's Ward, Wild Shape and
 * Font of Magic lost theirs too. The table IS the promise in all seven; a description that stops
 * before it is not shorter prose, it is a feature that does not say what it does.
 */
const withTables = (value: string) => value.replace(/<table>[\s\S]*?<\/table>/g, (html) => ` ${tableAsText(html)} `);

const slug = (value: string) =>
  strip(value).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** `#### Level 7: Remarkable Athlete` -> [, level, name]. Read by BOTH the class and subclass parsers. */
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
    const description = withTables(parts[i + 1])
      .split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
      .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    if (name && description) options.push({ id: slug(name), name, description: description.slice(0, 4000) });
  }
  return options;
}

/**
 * Feature prose keyed by slug, from the `###`/`####` headings that follow the tables.
 *
 * Keyed under BOTH the raw heading slug and the `Level N:`-stripped one. The source prints
 * `#### Level 1: Rage`, which slugs to `level-1-rage`, while the level TABLE names the feature
 * `rage` - so every generated class asked for `rage`, missed, and fell through to the
 * "See the <Class> class description in SRD 5.2.1." stub. 149 of 185 class features shipped that
 * way: Monk 23/23, Barbarian 20/20, Rogue 19/19, Ranger 18/18, Paladin 18/18, Druid 14/14,
 * Warlock 13/13, Bard 13/13, Sorcerer 11/11. The prose was never missing; the key was wrong.
 * The subclass parser has always stripped the prefix first (`LEVEL_HEADING`).
 *
 * Both keys are kept rather than only the stripped one, because a heading with no `Level N:`
 * prefix must still resolve, and because a class's own prose may reference either form.
 */
function featureProse(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.split(/^#{3,4} (.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = strip(parts[i]);
    const text = withTables(parts[i + 1].split(/\n#{3,6} /)[0])
      .split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
      .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const bare = heading.match(LEVEL_HEADING)?.[2];
    // First write wins: the source prints "Level 4: Ability Score Improvement" at 4, 8, 12, 16 and
    // 19 with identical bodies, and the bare key must not end up holding the last copy's stray text.
    for (const key of [slug(heading), ...(bare ? [slug(bare)] : [])]) {
      if (!out.has(key)) out.set(key, text);
    }
  }
  return out;
}

/**
 * The last resort before the stub: the LONGEST heading slug that is a hyphen-boundary prefix of the
 * feature id.
 *
 * One printed heading can name a family the level table then splits. Warlock's table grants
 * "Mystic Arcanum (level 6 spell)" at 11 and again at 13/15/17 for levels 7/8/9 - four feature ids -
 * under the single heading `#### Level 11: Mystic Arcanum`, whose own body says so ("as shown in the
 * Warlock Features table"). Prefixing at a hyphen boundary keeps this from over-matching: nothing
 * resolves unless a whole leading segment sequence matches, so `brutal-strike` cannot claim
 * `improved-brutal-strike`.
 */
function proseByPrefix(prose: Map<string, string>, featureId: string): string | undefined {
  let best: string | undefined;
  for (const key of prose.keys()) {
    if (!featureId.startsWith(`${key}-`)) continue;
    if (best === undefined || key.length > best.length) best = key;
  }
  return best === undefined ? undefined : prose.get(best);
}

// ---------------------------------------------------------------------------------------------
// Per-class configuration the printed text cannot supply deterministically
// ---------------------------------------------------------------------------------------------

/**
 * One printed resource column. `display` marks a column that is INK ONLY - no live `uses.pool`
 * answers to its id, and none is expected to.
 *
 * Every column below carries it today, and that is a statement of fact rather than a policy: the
 * nine generated classes have no authored mechanics at all yet (Stage 4), so not one of these ids
 * is spendable. `class-resource-pools.test.ts` holds each id to "matches a pool OR says it is
 * display", so as Stage 4 wires Rage or Bardic Inspiration to a real pool, the flag comes off HERE
 * and the test starts requiring the pool it now names.
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
  "acrobatics", "animal-handling", "arcana", "athletics", "deception", "history", "insight",
  "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion",
  "religion", "sleight-of-hand", "stealth", "survival"
];

// `repeatable` matters: an ASI is granted at several levels and taking it at BOTH level 4 and
// level 8 is legal, so the same option id appears twice. The server rejects a repeated option id
// unless the choice says so (`character-build.ts:478`), and the hand-authored Fighter has always
// carried this - omitting it made every generated class uncreatable from its second ASI onward.
// Expertise and Metamagic are deliberately NOT repeatable: those pick a DIFFERENT entry each time.
const asiChoice = { kind: "asi-or-feat", choose: 1, fromCatalog: "general-feats", repeatable: true };
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
    spellcasting: { ability: "cha", prepares: "prepared", ritual: true, focus: "arcane-focus", multiclassProgression: "full", spellListId: "bard" },
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
    spellcasting: { ability: "wis", prepares: "prepared", ritual: true, focus: "druidic-focus", multiclassProgression: "full", spellListId: "druid" },
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
    spellcasting: { ability: "cha", prepares: "prepared", ritual: false, focus: "holy-symbol", multiclassProgression: "half", spellListId: "paladin" },
    columns: {
      "Channel Divinity": { id: "channel-divinity", name: "Channel Divinity", display: true },
      "Prepared Spells": "prepared"
    },
    choices: {
      // `fighting-style` is authored in the OVERLAY for Paladin and Ranger, not here: theirs is a
      // catalog PLUS one bespoke option (Blessed Warrior / Druidic Warrior) and `CONFIG.choices`
      // cannot carry inline options at all. Fighter's, which is the plain catalog, stays hand-authored.
      "weapon-mastery": weaponMastery(2),
      "ability-score-improvement": asiChoice,
      "paladin-subclass": { kind: "subclass", choose: 1, fromCatalog: "paladin-subclasses" }
    }
  },
  ranger: {
    subclassLevel: 3,
    spellcasting: { ability: "wis", prepares: "prepared", ritual: true, focus: "druidic-focus", multiclassProgression: "half", spellListId: "ranger" },
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
    spellcasting: { ability: "cha", prepares: "prepared", ritual: false, focus: "arcane-focus", multiclassProgression: "full", spellListId: "sorcerer" },
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
    spellcasting: { ability: "cha", prepares: "prepared", ritual: true, focus: "arcane-focus", multiclassProgression: "pact", spellListId: "warlock" },
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
  const entryId = entry.id;
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
      // `display: true` says "ink only", and it comes off the moment the MECHANICS OVERLAY wires the
      // column to a real pool - see `LIVE_CLASS_RESOURCES`. Deriving it here rather than editing
      // fourteen column specs keeps one statement of which columns are live.
      const live = (LIVE_CLASS_RESOURCES[entryId] ?? []).includes(spec.id);
      (row.classResources as unknown[]).push({ id: spec.id, name: spec.name, amount, ...(spec.display && !live ? { display: true } : {}) });
    });
    // The features column is positional: always index 2 in every printed class table. A level that
    // grants nothing prints an em dash, which slugs to "" - drop those rather than emit a blank id.
    //
    // "Subclass feature" is dropped too. It is the table's REMINDER that the chosen subclass grants
    // something at this level, not a class feature: the SRD prints no heading for it, so it can have
    // no prose, and the real feature lives on the subclass record. All three hand-authored classes
    // already omit it - `character-content.test.ts` pins Cleric's levels 6 and 17 as EMPTY rows - so
    // the nine generated classes carrying a prose-less `subclass-feature` trait were the outlier.
    const named = strip(cells[2] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
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
      ?? proseByPrefix(entry.prose, featureId)
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
  // THE MECHANICS OVERLAY. The SRD markdown carries no riders - there is no sentence in it that says
  // `{type: "damage-resistance", ...}` - so the prose is generated and the mechanics are authored,
  // and they meet HERE rather than by freezing the class into HAND_AUTHORED and hand-maintaining its
  // 20-odd descriptions to gain somewhere to hang three lines. See `class-mechanics/overlay.ts`.
  overlayMisses.push(...applyMechanics(id, features, CLASS_MECHANICS));
  // PARSE THE FINISHED RECORD. The overlay is hand-authored TypeScript merged into generated data,
  // so this is the one point where the two are checked together - an authoring mistake stops the
  // build here rather than surfacing as a load failure in whatever runs next.
  ClassReferenceSchema.parse(record);
  built.push(record);
  const overlaid = Object.keys(CLASS_MECHANICS[id] ?? {}).length;
  report.push(`${entry.name}: ${table.length} rows, ${features.length} features, ${equipment.length} equipment options${overlaid ? `, ${overlaid} with mechanics` : ""}`);
}

console.log(report.join("\n"));
// The overlay-miss check waits for the SUBCLASS loop below, so a subclass key that matches nothing
// fails the same way a class key does. `unresolvedItems` is class-only and can be checked now.
if (unresolvedItems.length) {
  console.error(`\nUnresolved equipment ids (${unresolvedItems.length}):`);
  for (const item of unresolvedItems) console.error(`  ${item}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Subclasses
// ---------------------------------------------------------------------------------------------

/**
 * Bundle features that deliberately have no counterpart heading in the source, and why.
 *
 * Life Domain prints ONE "Level 3: Life Domain Spells" entry whose body is a table of which spells
 * arrive at Cleric levels 3/5/7/9. The hand-authored record splits that into four staged grants so
 * each set lands at the level it is actually gained - strictly better modelling than the source's
 * single entry, so the cross-check must not treat it as drift. Anything NOT listed here that the
 * source does not print is a real defect.
 */
const STAGED_FEATURES = new Set(["life-domain-spells-5", "life-domain-spells-7", "life-domain-spells-9"]);

type ParsedSubclass = {
  title: string;
  intro: string;
  features: { id: string; name: string; level: number; description: string }[];
};

/**
 * The one subclass printed for a class, as title + intro + level-stamped features.
 *
 * Shared by generation AND by the cross-check, deliberately: if the check parsed the source through
 * a second code path it could agree with the bundle while disagreeing with what actually gets
 * written. One parse, two consumers.
 */
function parseSubclass(entry: ReturnType<typeof parseClass>): ParsedSubclass {
  const heading = [...entry.body.matchAll(/^### (.+ Subclass: .+)$/gm)][0];
  if (!heading) throw new Error(`${entry.name}: no subclass section`);
  const title = strip(heading[1]).split(": ")[1];
  const tail = entry.body.split(heading[0])[1].split(/^### /m)[0];
  const parts = tail.split(/^#### (.+)$/m);
  const intro = parts[0].split("\n").map((line) => line.trim()).filter(Boolean)
    .filter((line) => !line.startsWith("_")).join(" ").replace(/[*_]/g, "").trim();
  const features: ParsedSubclass["features"] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const match = strip(parts[i]).match(LEVEL_HEADING);
    if (!match) continue;
    const description = withTables(parts[i + 1])
      .split("\n").map((line) => line.trim()).filter(Boolean).join(" ")
      .replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
    if (!description) continue;
    features.push({ id: slug(match[2]), name: strip(match[2]), level: Number(match[1]), description: description.slice(0, 4000) });
  }
  return { title, intro, features };
}

for (const [id, entry] of parsed) {
  if (HAND_AUTHORED.has(id)) continue;
  const { title, intro, features } = parseSubclass(entry);
  const subclassId = slug(title);
  const record = {
    id: subclassId, name: title, source: "srd", classId: id,
    subclassLevel: CONFIG[id].subclassLevel,
    summary: intro.split(". ")[0].slice(0, 200) || `${title}, the SRD 5.2.1 ${entry.name} subclass.`,
    description: intro.slice(0, 4000) || `${title}.`,
    features
  };
  // THE SUBCLASS HALF OF THE OVERLAY, keyed on (subclassId, featureId) exactly as the class half is
  // keyed on (classId, featureId). It was declared and never merged, which meant nine of the twelve
  // subclasses had NO authoring surface for a rider at all - the three that did were only reachable
  // because their class is HAND_AUTHORED and the whole record is carried over verbatim.
  overlayMisses.push(...applyMechanics(subclassId, features, SUBCLASS_MECHANICS));
  // Parsed for the same reason a class is: an authoring mistake in hand-written TypeScript merged
  // into generated data stops the build here rather than surfacing as a load failure later.
  SubclassReferenceSchema.parse(record);
  builtSubclasses.push(record);
  const overlaid = Object.keys(SUBCLASS_MECHANICS[subclassId] ?? {}).length;
  if (overlaid) console.log(`${title}: ${features.length} features, ${overlaid} with mechanics`);
}


// ---------------------------------------------------------------------------------------------
// Cross-check: the hand-authored three, re-parsed from this source
// ---------------------------------------------------------------------------------------------

// Only the hand-authored records are carried over. Reading the whole file would append this run's
// output to the previous run's, so a second invocation would double the bundle - the script has to
// be idempotent because it writes over its own input.
const existingClasses = (JSON.parse(readFileSync(join(bundles, "classes.v1.json"), "utf8")) as ClassReference[])
  .filter((record) => HAND_AUTHORED.has(record.id));
// Read BEFORE the write below, and typed for the feature comparison.
const existingSubclassRecords = (JSON.parse(readFileSync(join(bundles, "subclasses.v1.json"), "utf8")) as {
  id: string; name: string; classId: string; features: { id: string; level?: number }[];
}[]).filter((record) => HAND_AUTHORED.has(record.classId));

/**
 * THE OVERLAY REACHES ALL TWELVE CLASSES, not the nine the ETL generates.
 *
 * `applyMechanics` used to run only inside the generation loop, so Cleric, Fighter and Wizard - the
 * three whose records are carried through verbatim - could not use the overlay at all. That is why
 * Thaumaturge's extra cantrip had to be hand-edited straight into `classes.v1.json`, and it is why
 * three of the four Stage-4 authoring lanes would otherwise have had to edit that same 20,000-line
 * file. The merge point differs and nothing else does:
 *
 *   - a GENERATED record is rebuilt from the markdown every run, so the overlay is the only home
 *     its riders have and it is re-applied from scratch each time;
 *   - a HAND_AUTHORED record's prose IS `classes.v1.json`, which this script reads and writes, so
 *     the overlay's contribution is written back into its own input. `applyMechanics` therefore
 *     refuses to overwrite a value already on the record: the merge only ADDS, and a rider that
 *     disagrees with the file stops the build naming both homes rather than picking a winner.
 *
 * Both records are re-parsed below, exactly as the generated ones are.
 */
for (const record of existingClasses) {
  overlayMisses.push(...applyMechanics(record.id, record.features, CLASS_MECHANICS));
  ClassReferenceSchema.parse(record);
  const overlaid = Object.keys(CLASS_MECHANICS[record.id] ?? {}).length;
  if (overlaid) console.log(`${record.name} (hand-authored): ${overlaid} feature(s) with overlay mechanics`);
}
for (const record of existingSubclassRecords) {
  overlayMisses.push(...applyMechanics(record.id, record.features, SUBCLASS_MECHANICS));
  SubclassReferenceSchema.parse(record);
}
// A rider authored against a feature id no record emits is the silent drop this whole area exists
// to end, so it fails the build rather than quietly producing a record without its mechanics. All
// four merges report here - generated class, generated subclass, hand-authored class, hand-authored
// subclass - so a key that matches nothing fails identically wherever it was authored.
if (overlayMisses.length) {
  console.error(`\nMechanics overlay keys matching no feature (${overlayMisses.length}):`);
  for (const key of overlayMisses) console.error(`  ${key}`);
  process.exit(1);
}

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

  // Subclass features: which features exist, and the level each is granted at.
  //
  // This was the gap that let a wrong Champion sit in the bundle - the check covered class-level
  // data only, so a subclass carrying 2024 feature TEXT at 2014 feature LEVELS passed cleanly. Ids
  // and levels are compared, not prose: the descriptions are legitimately reworded in places, but a
  // feature appearing at the wrong level, or not at all, is always a defect.
  const authoredSubclass = existingSubclassRecords.find((sub) => sub.classId === record.id);
  if (authoredSubclass) {
    const fromSource = parseSubclass(entry);
    if (slug(fromSource.title) !== authoredSubclass.id) {
      disagreements.push(`${record.id}: source prints subclass "${fromSource.title}" vs bundle "${authoredSubclass.name}"`);
    } else {
      const sourceLevels = new Map(fromSource.features.map((feature) => [feature.id, feature.level]));
      const bundleLevels = new Map(authoredSubclass.features.map((feature) => [feature.id, feature.level]));
      for (const [id, level] of sourceLevels) {
        if (!bundleLevels.has(id)) disagreements.push(`${authoredSubclass.id}: source has "${id}" at level ${level}; the bundle does not have it at all`);
        else if (bundleLevels.get(id) !== level) disagreements.push(`${authoredSubclass.id}.${id}: source level ${level} vs bundle level ${bundleLevels.get(id)}`);
      }
      for (const id of bundleLevels.keys()) {
        if (!sourceLevels.has(id) && !STAGED_FEATURES.has(id)) {
          disagreements.push(`${authoredSubclass.id}: bundle has "${id}", which the source does not print`);
        }
      }
    }
  }
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
const existingSubclasses = existingSubclassRecords;
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

/**
 * THE STUB CAN NEVER SHIP AGAIN.
 *
 * `featureProse`'s fallback is a pointer at a document the player does not have, and for a year it
 * was the description of 149 of 185 class features because of a single slug mismatch - a silent
 * degradation that looked like missing content and was actually a missing key. A build that emits
 * even one of these has lost prose it was holding, so it fails here rather than writing the bundle.
 * If a feature genuinely has no printed text, give it real text; do not re-add a fallback.
 */
const STUB_DESCRIPTION = /^See the .* in SRD 5\.2\.1\.$/;
const stubs = [
  ...allClasses.flatMap((record) => (record as ClassReference).features
    .filter((feature) => STUB_DESCRIPTION.test(feature.description))
    .map((feature) => `${(record as ClassReference).id}.${feature.id}`)),
  ...allSubclasses.flatMap((record) => ((record as { id: string; features: { id: string; description: string }[] }).features ?? [])
    .filter((feature) => STUB_DESCRIPTION.test(feature.description))
    .map((feature) => `${(record as { id: string }).id}.${feature.id}`))
];
if (stubs.length) {
  console.error(`\n${stubs.length} emitted feature description(s) are the "See the ... in SRD 5.2.1." STUB, not real prose:`);
  for (const line of stubs.slice(0, 40)) console.error(`  ${line}`);
  console.error("A stub means featureProse could not key the heading. Fix the keying (see featureProse); do not lower this bar.");
  process.exit(1);
}

writeFileSync(join(bundles, "classes.v1.json"), `${JSON.stringify(allClasses, null, 1)}\n`);
writeFileSync(join(bundles, "subclasses.v1.json"), `${JSON.stringify(allSubclasses, null, 1)}\n`);
console.log(`\nwrote ${allClasses.length} classes, ${allSubclasses.length} subclasses.`);

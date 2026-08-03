/**
 * Per-type blank drafts.
 *
 * **This file is the difference between a usable form and a wall.** `SpellReferenceSchema`
 * has 24 required-ish fields and no defaults, so a naive blank spell renders 24 empty
 * inputs and the GM's first job is clerical. Seeded the way a spell usually is — level 1,
 * evocation, 1 action, 60 feet, verbal + somatic, Instantaneous — the GM edits about
 * eight things and the rest are already right.
 *
 * Two hard rules, both enforced by the server's schemas:
 *
 * 1. **Omit, never `null`.** Every optional column on a class level row is `.optional()`
 *    and the row is `.strict()`, so `spellSlots: null` is a parse error while an absent
 *    key is correct. The blank drafts here only ever carry keys with real values.
 * 2. **A class's `levelTable` is exactly 20 rows and is required**, so a blank class ships
 *    with all 20 already generated rather than with an empty array the GM has to notice.
 */

import { proficiencyBonusForLevel } from "@vtt/rules-5e";
import { newId } from "../lib/ids";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

export const LEVELS: readonly number[] = Array.from({ length: 20 }, (_, index) => index + 1);

/**
 * One blank `FeatureRecord`, with the four rider arrays the schema defaults so nothing
 * downstream writes `?? []`.
 *
 * `level` is deliberately absent: WHERE a feature is granted is the caller's business,
 * and the two callers answer it differently. A class feature must arrive already on a
 * level-table row (`FeatureEditor` supplies the level), because a class's grants live in
 * `levelTable[].features[]` and nowhere else. A feat's single feature has no level at
 * all — taking the feat is the grant.
 */
export const blankFeature = (): Record<string, unknown> => ({
  id: newId(),
  name: "",
  description: "",
  tags: [],
  actions: [],
  effects: [],
  modifiers: []
});

/** One level row with only its two always-present columns. Derived columns are added by
    `LevelTableEditor`'s generator, which owns the whole "delete the cells" argument. */
export const blankLevelRow = (level: number) => ({
  level,
  proficiencyBonus: proficiencyBonusForLevel(level),
  features: [] as string[],
  classResources: [] as unknown[]
});

export const blankLevelTable = () => LEVELS.map(blankLevelRow);

/**
 * `source: "homebrew"` is on EVERY blank draft, and it is load-bearing rather than
 * decorative.
 *
 * `contentRecordBase` declares `source: ContentSourceSchema`, which **defaults to
 * `"srd"`**. A record authored from blank carried no `source` key at all, so the moment
 * it published, the merged catalog served the GM's own invention as bundled SRD — and two
 * surfaces believed it. The character builder badges provenance from exactly this field
 * (`sourceBadge`), so an invented class sat between Sorcerer and Warlock with nothing to
 * distinguish it; and the create modal's duplicate picker filtered its SRD block on
 * `source !== "homebrew"`, which was a no-op, so the same record rendered twice with a
 * React duplicate-key warning. The server already writes it on an SRD copy
 * (`homebrew-srd-copy.ts`) — this is the other half, for the records the client authors.
 *
 * `withDefaults` fills it in on open, so records made before this repair themselves.
 * Not for `monster`: an `ActorDefinition`'s `source` is a provenance OBJECT
 * (`{ name, version, externalId }`), already seeded below, and a string there is a parse
 * error rather than a discriminator.
 */
const BASE = { source: "homebrew", summary: "", description: "" };

const DEFAULTS: Readonly<Record<HomebrewType, () => Draft>> = {
  class: () => ({
    ...BASE,
    hitDie: "d8",
    primaryAbilities: [],
    savingThrows: [],
    statPriority: ["str", "dex", "con", "int", "wis", "cha"],
    skillChoices: { choose: 2, from: [] },
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    startingEquipment: [],
    subclassLevel: 3,
    // 4/8/12/16/19 is every SRD class's ASI ladder without exception, so it is the
    // default rather than a blank the GM has to look up.
    asiLevels: [4, 8, 12, 16, 19],
    features: [],
    levelTable: blankLevelTable()
  }),

  subclass: () => ({ ...BASE, classId: "", features: [] }),

  species: () => ({
    ...BASE,
    sizes: ["medium"],
    speedFeet: 30,
    creatureType: "humanoid",
    abilityBonuses: [],
    languages: [],
    traits: [],
    lineages: []
  }),

  background: () => ({ ...BASE, abilityOptions: { from: [], spreads: [] }, skillProficiencies: [], toolProficiencies: [], startingEquipment: [], features: [] }),

  /* `feature`, SINGULAR and required — a feat IS one `FeatureRecord` plus catalog
     metadata (`FeatReferenceSchema`, which is `.strict()`). Seeding the plural `features`
     here put an unrecognised key on every feat AND left the required one missing, so no
     feat could ever be published; the editor's own "What it does" section wrote to the
     same wrong key. Both now name `feature`. */
  feat: () => ({ ...BASE, category: "general", repeatable: false, feature: blankFeature() }),

  /* The eight seeded values are what make this form ~8 decisions instead of 24 fields. */
  /* The seeded values are what make this form ~8 decisions instead of 24 fields — and
     every `null` below is deliberate: `SpellReferenceSchema` uses `.nullable()`, not
     `.optional()`, so the KEY is required and the value may be null. Omitting one reads
     as "Required" on a form that visibly has nothing to fill in. */
  spell: () => ({
    source: "homebrew",
    description: "",
    level: 1,
    school: "evocation",
    castingTime: "1 action",
    reactionCondition: null,
    range: { distance: 60, unit: "feet", text: null },
    components: { verbal: true, somatic: true, material: false, materialText: null, materialConsumed: false },
    duration: "Instantaneous",
    concentration: false,
    ritual: false,
    attackRoll: false,
    damage: { roll: null, types: [] },
    save: null,
    target: { type: "creature", count: 1 },
    shape: null,
    higherLevel: null,
    classes: [],
    castingOptions: []
  }),

  "spell-list": () => ({ ...BASE, basedOn: [], add: [], remove: [] }),

  /* `EquipmentReferenceSchema` is `.strict()` and its three value fields are
     `.nullable()`, not `.optional()` — so `null`, and only these keys. The `weapon` and
     `armor` sub-objects are deliberately ABSENT: an ordinary lantern is not a weapon, and
     the schema declares both `.optional()`. What they must never be is HALF present —
     see `SUB_OBJECT_DEFAULTS` below. */
  equipment: () => ({ source: "homebrew", description: null, category: "gear", costGp: 0, weightLb: 0 }),

  /* A creature IS an `ActorDefinition`. `schemaId`, `schemaVersion` and `source` are
     forced and never shown — a homebrew stat block that is not "vtt.actor-monster" is
     rejected, and `source.externalId` is the identity the bestiary keys on. */
  monster: () => ({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Homebrew", version: "1" },
    summary: "",
    size: "medium",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 12,
    hitPoints: { maximum: 20 },
    initiativeBonus: 0,
    speedFeet: 30,
    actions: [],
    token: { disposition: "hostile", footprint: { width: 1, height: 1 } },
    extensions: { "open5e.srd-2024": { challengeRating: 1, type: "humanoid" } }
  })
};

/** The blank body for a new record of `type`, minus its name (the caller owns that). */
export function blankDraft(type: HomebrewType): Draft {
  return DEFAULTS[type]?.() ?? { ...BASE };
}

/**
 * **Sub-objects that are OPTIONAL as a whole and COMPLETE once present.**
 *
 * This is the data half of the item-publish repair (the behaviour half is `inContainer` in
 * `schema.ts`, which seeds one of these the first time any field inside it is touched, and the
 * top-up in `withDefaults` below, which repairs a record already stored half-written).
 *
 * The rule these three obey, and the one a fourth entry must obey too: **every value here is either
 * a null, a false, or the option the control is already showing.** Nothing invents a number. A
 * seeded `acBase: 13` would be a stat the GM never chose and would never notice; leaving `acBase`
 * out means the checklist says "Fill in base armour class", which is the truth. Likewise
 * `damageDice: ""` rather than a guessed die.
 *
 * `weapon.category` is the one enum here, and it gets `"simple"` because the column is a closed
 * two-value enum with no null: the select is ALREADY displaying Simple when the section is untouched,
 * so seeding it writes down what the GM is looking at rather than inventing a third answer.
 */
export const SUB_OBJECT_DEFAULTS: Readonly<Partial<Record<HomebrewType, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>> = {
  equipment: {
    // All five keys required; `rangeFeet`/`longRangeFeet` nullable. `null` ranges ARE a melee
    // weapon — every duplicated SRD melee weapon carries exactly this shape.
    weapon: { category: "simple", damageDice: "", damageType: "", rangeFeet: null, longRangeFeet: null },
    // All five required; three of them have honest empties. `acBase` and `addDexModifier` do not
    // appear: `addDexModifier` is a switch (always written) and `acBase` is the GM's to choose.
    armor: { dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null }
  },
  spell: {
    // `shape` is `.nullable()` as a whole and blank-seeded to `null`; touching Shape or Size has to
    // produce all three keys, `size`/`unit` nullable.
    shape: { type: "sphere", size: null, unit: "feet" }
  }
};

/**
 * The keys the EDITOR mints and the STORE must never see.
 *
 * `RowEditor` needs a stable key per row — keying by index is the bug that primitive exists to
 * prevent — so the rider forms mint a `rowId` when they mint a row. `FeatureModifierSchema` and
 * `RiderTriggerSchema` are `.strict()` discriminated unions, so that key is not ignored on the way
 * in: it is a hard parse failure, `Unrecognized key(s) in object: 'rowId'`, on a record whose form
 * shows nothing wrong. Every authored modifier was unpublishable, on every carrier.
 *
 * Stripped HERE, at the one boundary where a draft becomes a request body, rather than avoided by
 * keying rows on their index. `useAutosave` re-baselines from the draft it just sent (not from the
 * server's echo), so the draft keeps its ids and the dirty flag stays honest.
 */
const EDITOR_KEYS = ["rowId"];

/**
 * Deep copy minus the editor-only keys, and minus anything `undefined`. Arrays and plain objects
 * only — a draft is JSON.
 *
 * Dropping `undefined` is not tidying. `FieldDef.emptyValue: "omit"` means an emptied control
 * REMOVES its key, and `setAt` writes `undefined` to say so; a key that survives to here holding
 * `undefined` would be dropped anyway by `JSON.stringify` on its way to the store, so leaving it in
 * would make this function disagree with the body the server actually receives — and the publish
 * checklist validates what this function returns.
 */
export function forStorage(value: Draft): Draft {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
      if (EDITOR_KEYS.includes(key) || entry === undefined) continue;
      out[key] = walk(entry);
    }
    return out;
  };
  return walk(value) as Draft;
}

/**
 * Fills in the keys a draft is missing without touching anything it already has.
 *
 * Needed because a record can arrive from three places — created blank before this
 * schema existed, duplicated from an SRD record, or imported from a pack — and the
 * renderer must not have to write `?? []` at every call site. Deep-merges one level
 * into plain objects; arrays are taken wholesale (a half-authored list is the GM's,
 * not something to top up).
 */
export function withDefaults(type: HomebrewType, record: Draft): Draft {
  const base = blankDraft(type);
  const out: Record<string, unknown> = { ...base, ...record };
  for (const [key, fallback] of Object.entries(base)) {
    const current = record[key];
    const mergeable =
      fallback !== null && typeof fallback === "object" && !Array.isArray(fallback) &&
      current !== null && typeof current === "object" && !Array.isArray(current);
    if (mergeable) out[key] = { ...(fallback as object), ...(current as object) };
    if (current === undefined) out[key] = fallback;
  }
  /**
   * Repair a HALF-WRITTEN optional sub-object, and only ever a half-written one.
   *
   * A record authored before the seeding fix, or imported from a pack, can be sitting on
   * `weapon: { damageDice: "1d8" }` — which is the exact shape the store refuses. Topping it up on
   * open is what makes that record publishable again without the GM being told to type a range into
   * a mace. The guard matters as much as the repair: an ABSENT `weapon` stays absent, so opening an
   * ordinary lantern never grows it a weapon block, never marks the draft dirty, and never turns
   * "select a record" into a PATCH (`useAutosave`'s dual baseline).
   */
  for (const [key, defaults] of Object.entries(SUB_OBJECT_DEFAULTS[type] ?? {})) {
    const current = out[key];
    if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) continue;
    out[key] = { ...defaults, ...(current as Record<string, unknown>) };
  }
  return out;
}

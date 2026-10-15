/**
 * Per-type blank drafts, seeded with typical values so a new record needs a few edits rather
 * than every field filled in. Server schemas enforce two rules here: optional class level-row
 * columns are omitted, never `null` (rows are `.strict()`), and a class's `levelTable` is
 * required and exactly 20 rows, so a blank class ships with all 20.
 */

import { proficiencyBonusForLevel } from "@vtt/rules-5e";
import { newId } from "../lib/ids";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

export const LEVELS: readonly number[] = Array.from({ length: 20 }, (_, index) => index + 1);

/** One blank `FeatureRecord` with its rider arrays present. `level` is absent: a class feature's
    level comes from its level-table row, and a feat's feature has none. */
export const blankFeature = (): Record<string, unknown> => ({
  id: newId(),
  name: "",
  description: "",
  tags: [],
  actions: [],
  effects: [],
  modifiers: []
});

/** One level row with only its always-present columns; `LevelTableEditor` adds the rest. */
export const blankLevelRow = (level: number) => ({
  level,
  proficiencyBonus: proficiencyBonusForLevel(level),
  features: [] as string[],
  classResources: [] as unknown[]
});

export const blankLevelTable = () => LEVELS.map(blankLevelRow);

/** `source: "homebrew"` on every blank draft: `ContentSourceSchema` defaults to "srd", so a
    record without it is served and badged as SRD once published. `withDefaults` adds it to older
    records on open. Not for `monster`, whose `source` is a provenance object seeded below. */
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
    // Every SRD class uses this ASI ladder.
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

  background: () => ({
    ...BASE,
    // The SRD's two splits, so a new background only needs its three abilities.
    abilityOptions: {
      from: [],
      spreads: [
        [2, 1],
        [1, 1, 1]
      ]
    },
    skillProficiencies: [],
    toolProficiencies: [],
    startingEquipment: [],
    features: []
  }),

  /* `feature` (singular, required): a feat is one `FeatureRecord` plus catalog metadata, and
     `FeatReferenceSchema` is `.strict()`. */
  feat: () => ({ ...BASE, category: "general", repeatable: false, feature: blankFeature() }),

  /* `SpellReferenceSchema` fields are `.nullable()`, not `.optional()`: each key is required,
     so the nulls below must stay. */
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

  /* `EquipmentReferenceSchema` is `.strict()` with nullable value fields. `weapon` and `armor` are
     optional and absent here, but must never be half present (see `SUB_OBJECT_DEFAULTS`). */
  equipment: () => ({ source: "homebrew", description: null, category: "gear", costGp: 0, weightLb: 0 }),

  /* A creature is an `ActorDefinition`. `schemaId`, `schemaVersion` and `source` are forced and
     hidden; `source.externalId` is the identity the bestiary keys on. */
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
 * Optional sub-objects that must be complete once present. `inContainer` in `schema.ts` seeds one
 * when a field inside it is first touched, and `withDefaults` tops up a half-written stored one.
 *
 * Every value is a null, a false, or the option the control already shows; nothing invents a
 * number (an unset `acBase` makes the checklist ask for it). `weapon.category` is a closed enum
 * with no null, and its select already displays "simple".
 */
export const SUB_OBJECT_DEFAULTS: Readonly<
  Partial<Record<HomebrewType, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>
> = {
  equipment: {
    // `null` ranges mean a melee weapon, the shape every SRD melee weapon carries.
    weapon: { category: "simple", damageDice: "", damageType: "", rangeFeet: null, longRangeFeet: null },
    // `acBase` is the GM's to choose and `addDexModifier` is a switch that always writes.
    armor: { dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null }
  },
  spell: {
    // `shape` is nullable as a whole; touching Shape or Size must produce all three keys.
    shape: { type: "sphere", size: null, unit: "feet" }
  }
};

/**
 * Editor-only keys stripped before a draft becomes a request body. The rider forms mint a
 * `rowId` per row for stable `RowEditor` keys, but `ModifierSchema` and
 * `RiderTriggerSchema` are `.strict()`, so the key would fail the parse. The draft keeps its ids
 * because `useAutosave` re-baselines from the draft it sent.
 */
const EDITOR_KEYS = ["rowId"];

/** Deep copy (arrays and plain objects only) minus editor-only keys and `undefined` values.
    `emptyValue: "omit"` writes `undefined` to remove a key; dropping it here matches what
    `JSON.stringify` sends, and the publish checklist validates this function's output. */
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

/** Fills in missing keys without touching existing ones, for records created blank, duplicated
    from the SRD or imported. Deep-merges one level into plain objects; arrays are taken as-is. */
export function withDefaults(type: HomebrewType, record: Draft): Draft {
  const base = blankDraft(type);
  const out: Record<string, unknown> = { ...base, ...record };
  for (const [key, fallback] of Object.entries(base)) {
    const current = record[key];
    const mergeable =
      fallback !== null &&
      typeof fallback === "object" &&
      !Array.isArray(fallback) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current);
    if (mergeable) out[key] = { ...(fallback as object), ...(current as object) };
    if (current === undefined) out[key] = fallback;
  }
  /** Top up a half-written optional sub-object (e.g. `weapon: { damageDice: "1d8" }` from an import),
      which the store refuses. An absent sub-object stays absent, so opening a record never makes
      the draft dirty. */
  for (const [key, defaults] of Object.entries(SUB_OBJECT_DEFAULTS[type] ?? {})) {
    const current = out[key];
    if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) continue;
    out[key] = { ...defaults, ...(current as Record<string, unknown>) };
  }
  return out;
}

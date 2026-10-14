/**
 * The canonical SRD 5.2.1 enumerated vocabularies as frozen id arrays, for browser forms (the bundle
 * loaders are node-only). `test/enums.test.ts` re-derives each list from the bundles.
 *
 * Each list is the complete SRD set, but `school`, `category`, `rarity` and `creatureType` are open
 * slugs, so controls over them must also accept free text.
 */

// Declared in `@vtt/rules-5e` and re-exported; declaring it here would create a dependency cycle.
export { normalizeDamageType } from "@vtt/rules-5e";

/** The 13 SRD damage types, in bundle order. */
export const DAMAGE_TYPE_IDS: readonly string[] = Object.freeze([
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
]);

/** The 15 SRD conditions, in bundle order. Exhaustion is a condition here, levels and all. */
export const CONDITION_IDS: readonly string[] = Object.freeze([
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious"
]);

/** The 8 schools of magic. Derived from the spell bundle - `SpellReference.school` is an open string. */
export const MAGIC_SCHOOL_IDS: readonly string[] = Object.freeze([
  "abjuration",
  "conjuration",
  "divination",
  "enchantment",
  "evocation",
  "illusion",
  "necromancy",
  "transmutation"
]);

/** The 14 creature types. Derived from the monster bundle's `open5e.srd-2024` extension bag. */
export const CREATURE_TYPE_IDS: readonly string[] = Object.freeze([
  "aberration",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "elemental",
  "fey",
  "fiend",
  "giant",
  "humanoid",
  "monstrosity",
  "ooze",
  "plant",
  "undead"
]);

/**
 * Weapon properties as the bare slugs riders match on. The bundle's ids are suffixed (`finesse-wp`,
 * `cleave-mastery`) because properties and masteries share one id space there.
 */
export const WEAPON_PROPERTY_IDS: readonly string[] = Object.freeze([
  "ammunition",
  "finesse",
  "heavy",
  "light",
  "loading",
  "reach",
  "thrown",
  "two-handed",
  "versatile"
]);

/** The 8 weapon masteries, same id-space note as above. */
export const WEAPON_MASTERY_IDS: readonly string[] = Object.freeze([
  "cleave",
  "graze",
  "nick",
  "push",
  "sap",
  "slow",
  "topple",
  "vex"
]);

/** The 6 hand-authored gear categories in `equipment.v1.json`. `category` is an open slug: a
    homebrew "relic" needs no schema change, so these are suggestions and never a closed list. */
export const GEAR_CATEGORY_IDS: readonly string[] = Object.freeze([
  "adventuring-gear",
  "ammunition",
  "consumable",
  "equipment-pack",
  "focus",
  "tool"
]);

/**
 * The magic-item rarity ladder, plus `varies`. Unlike the lists above this is not a projection of a
 * bundle, so `test/enums.test.ts` checks containment rather than equality. Open slug: controls must
 * also accept free text.
 */
export const RARITY_IDS: readonly string[] = Object.freeze([
  "common",
  "uncommon",
  "rare",
  "very-rare",
  "legendary",
  "artifact",
  "varies"
]);

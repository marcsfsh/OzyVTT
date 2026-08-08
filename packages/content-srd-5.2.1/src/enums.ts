/**
 * The canonical SRD 5.2.1 enumerated vocabularies, as plain frozen id arrays.
 *
 * **Why a constant and not `loadDamageTypes()`.** The loaders `require()` a bundle off disk, which
 * makes them node-only, and the surface that needs these lists most is a BROWSER form: every
 * "damage type", "condition", "school" and "creature type" input in the homebrew editor was a bare
 * text box or a hand-typed partial suggestion array, so a GM authoring a Ring of Fire Resistance had
 * to know that the word is "fire" and not "Fire" or "flame". A slug typed one character wrong is
 * silently inert at play time, which is the single hardest homebrew failure to diagnose.
 *
 * **Why ids and not the records.** The forms need the vocabulary, not the rules text; shipping the
 * descriptions would put ~40 KB of prose into the client bundle to fill a dropdown.
 *
 * **How they are kept true.** `test/enums.test.ts` re-derives every list below from the bundles
 * themselves and fails on any difference — so this file cannot drift from the content it names, and
 * a bundle that gains a fourteenth condition fails the test rather than silently disagreeing with
 * the form. That test IS the reason these may be literals at all.
 *
 * Every list here is the COMPLETE SRD set. It is never the whole world: `school`, `category`,
 * `rarity` and `creatureType` are OPEN slugs in their schemas on purpose, so each control that
 * consumes one of these offers the full list AND accepts free text (the "complete dropdown with an
 * other option" rule). A closed control over an open slug is the inverse bug and is just as wrong.
 */

/** The 13 SRD damage types, in bundle order. */
export const DAMAGE_TYPE_IDS: readonly string[] = Object.freeze([
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
]);

/** The 15 SRD conditions, in bundle order. Exhaustion is a condition here, levels and all. */
export const CONDITION_IDS: readonly string[] = Object.freeze([
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
]);

/** The 8 schools of magic. Derived from the spell bundle - `SpellReference.school` is an open string. */
export const MAGIC_SCHOOL_IDS: readonly string[] = Object.freeze([
  "abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"
]);

/** The 14 creature types. Derived from the monster bundle's `open5e.srd-2024` extension bag. */
export const CREATURE_TYPE_IDS: readonly string[] = Object.freeze([
  "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey",
  "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"
]);

/**
 * Weapon properties and masteries as the BARE slugs riders actually match on.
 *
 * The bundle's own ids are suffixed - `finesse-wp`, `cleave-mastery` - because the two families
 * share one id space there. Every rider trigger in `@vtt/schemas` compares against the bare word
 * (`weapon-property-is: ["finesse"]`), so suggesting the bundle id would suggest a value that
 * matches nothing. The suffix is stripped HERE, once, rather than at each of the call sites.
 */
export const WEAPON_PROPERTY_IDS: readonly string[] = Object.freeze([
  "ammunition", "finesse", "heavy", "light", "loading", "reach", "thrown", "two-handed", "versatile"
]);

/** The 8 weapon masteries, same id-space note as above. */
export const WEAPON_MASTERY_IDS: readonly string[] = Object.freeze([
  "cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"
]);

/** The 6 hand-authored gear categories in `equipment.v1.json`. `category` is an open slug: a
    homebrew "relic" needs no schema change, so these are suggestions and never a closed list. */
export const GEAR_CATEGORY_IDS: readonly string[] = Object.freeze([
  "adventuring-gear", "ammunition", "consumable", "equipment-pack", "focus", "tool"
]);

/**
 * The magic-item rarity ladder, plus `varies` for the tables that print it.
 *
 * **This is the one list in this file that is NOT a projection of a bundle, and the exception is
 * written here rather than left to be discovered.** Measured at the time of writing: **0 of the 132
 * records in `equipment.v1.json` declare `rarity` at all**, and `rules.v1.json` names the words only
 * in prose. So `test/enums.test.ts` cannot assert equality against a bundle the way it does for the
 * six lists above; it asserts CONTAINMENT instead — every rarity any bundled record declares is a
 * member here — which is the strongest true statement available and becomes non-vacuous the day the
 * first magic item lands.
 *
 * It lives here anyway, and not beside the one form that reads it, for two reasons that outlive the
 * drift test:
 *
 *  - the column it fills is in THIS package (`EquipmentReferenceSchema.rarity`, an open
 *    `ContentIdSchema`), so the constant and the schema it serves are one import apart rather than
 *    one workspace apart;
 *  - it is a printed-rules vocabulary, and a client-local literal is exactly the shape that made
 *    "ten of the thirteen damage types" possible. The homebrew editor is not the only surface that
 *    will want it.
 *
 * OPEN, like `school` and `category`: a GM must still be able to write "unique" or "table-only", so
 * every control over it offers this list AND takes free text.
 */
export const RARITY_IDS: readonly string[] = Object.freeze([
  "common", "uncommon", "rare", "very-rare", "legendary", "artifact", "varies"
]);

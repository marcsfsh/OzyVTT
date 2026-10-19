/**
 * The spells that bring creatures onto the map or put one under the caster's command (SRD 5.2.1), read from their
 * text: which stat blocks, how many at each slot level, where they appear, when they act, how they are commanded and
 * how long they stay (`SummonSchema`, run by `apps/server/src/summons.ts`). `spell-effects.ts` merges each row into
 * the spell's cast model.
 */
import { SummonSchema, type Summon } from "@vtt/schemas";
import type { z } from "zod";
import type { SpellEffect } from "../src/schemas.js";

type SummonInput = z.input<typeof SummonSchema>;

/** "Bat, Cat, Frog, Hawk, Lizard, Octopus, Owl, Rat, Raven, Spider, Weasel, or another Beast that has a Challenge
 *  Rating of 0." */
const FAMILIAR_FORMS = ["bat", "cat", "frog", "hawk", "lizard", "octopus", "owl", "rat", "raven", "spider", "weasel"];

const ROWS: Readonly<Record<string, SummonInput>> = {
  // A Skeleton from bones or a Zombie from a corpse, two more for each slot level above 3, each from its own corpse.
  // Commanded with a Bonus Action within 60 feet; uncommanded, it takes the Dodge action. It obeys for 24 hours, and
  // casting it again on up to four of them (two more for each slot level above 3) renews that.
  "animate-dead": {
    creatures: [
      { monsterId: "zombie", perSlot: 2 },
      { monsterId: "skeleton", perSlot: 2 }
    ],
    rangeFeet: 10,
    fromCorpse: { creatureTypes: ["humanoid"], maxSize: "medium" },
    turn: "own",
    commandedWith: "bonus-action",
    commandFeet: 60,
    dodgesUncommanded: true,
    lasts: { type: "minutes", minutes: 1440 },
    freedAtEnd: true,
    reasserts: { count: 4, perSlot: 2 }
  },
  // Objects worth up to the caster's spellcasting modifier (a Large one counts as two, a Huge one as three), each an
  // Animated Object of its size that acts right after the caster and obeys its Bonus Action within 500 feet.
  "animate-objects": {
    creatures: [
      { monsterId: "animated-object", form: "medium", share: 1 },
      { monsterId: "animated-object", form: "large", share: 2 },
      { monsterId: "animated-object", form: "huge", share: 3 }
    ],
    upToModifier: true,
    rangeFeet: 120,
    commandedWith: "bonus-action",
    commandFeet: 500,
    dodgesUncommanded: true
  },
  // Up to three Ghouls (four at level 7, five at 8, six at 9), or from a level 8 slot two Ghasts or Wights (three at 9),
  // or from a level 9 slot two Mummies, commanded with a Bonus Action within 120 feet for 24 hours.
  "create-undead": {
    creatures: [
      { monsterId: "ghoul", count: 3, perSlot: 1 },
      { monsterId: "ghast", count: 2, perSlot: 1, minLevel: 8 },
      { monsterId: "wight", count: 2, perSlot: 1, minLevel: 8 },
      { monsterId: "mummy", count: 2, minLevel: 9 }
    ],
    rangeFeet: 10,
    fromCorpse: { creatureTypes: ["humanoid"], maxSize: "medium" },
    turn: "own",
    commandedWith: "bonus-action",
    commandFeet: 120,
    dodgesUncommanded: true,
    lasts: { type: "minutes", minutes: 1440 },
    freedAtEnd: true,
    reasserts: { count: 3, perSlot: 1 }
  },
  // A familiar in a CR 0 Beast's form, a Celestial, Fey or Fiend, within 10 feet: it rolls its own Initiative, can't
  // attack, lends its senses for a Bonus Action and is dismissed with a Magic action. One at a time.
  "find-familiar": {
    creatures: FAMILIAR_FORMS.map((monsterId) => ({ monsterId })),
    orAny: { creatureType: "beast", maxChallenge: 0 },
    creatureTypes: ["celestial", "fey", "fiend"],
    rangeFeet: 10,
    turn: "own",
    lasts: { type: "untimed" },
    noAttacks: true,
    onlyOne: true,
    sight: "bonus-action",
    dismiss: "action",
    deliversTouch: 100
  },
  // The Otherworldly Steed at the slot's level, a Celestial, Fey or Fiend, within 30 feet. It shares the caster's
  // Initiative count and disappears at 0 Hit Points or when the caster dies; a new casting replaces it.
  "find-steed": {
    creatures: [
      { monsterId: "otherworldly-steed", form: "celestial" },
      { monsterId: "otherworldly-steed", form: "fey" },
      { monsterId: "otherworldly-steed", form: "fiend" }
    ],
    rangeFeet: 30,
    lasts: { type: "untimed" },
    endsOnUserDeath: true,
    onlyOne: true
  },
  // A giant centipede, spider or wasp at the slot's level within 60 feet, acting right after the caster.
  "giant-insect": {
    creatures: [
      { monsterId: "giant-insect", form: "centipede" },
      { monsterId: "giant-insect", form: "spider" },
      { monsterId: "giant-insect", form: "wasp" }
    ],
    rangeFeet: 60,
    dodgesUncommanded: true
  },
  // A Riding Horse with a Speed of 100 feet within 30 feet for the hour; any damage ends the spell.
  "phantom-steed": {
    creatures: [{ monsterId: "riding-horse", except: { name: "Phantom Steed", speedFeet: 100 } }],
    rangeFeet: 30,
    endsOnDamage: true
  },
  // A Draconic Spirit at the slot's level within 60 feet, acting right after the caster, whose Resistance the caster
  // shares until the spell ends.
  "summon-dragon": {
    creatures: [{ monsterId: "draconic-spirit" }],
    rangeFeet: 60,
    dodgesUncommanded: true,
    sharedResistance: true
  },
  // A spectral force in a space within 60 feet: the cast's attack and each later one reach a creature within 5 feet
  // of it, and each later Bonus Action moves it up to 20 feet first.
  "spiritual-weapon": {
    creatures: [{ monsterId: "spiritual-weapon" }],
    rangeFeet: 60,
    turn: "none",
    intangible: true,
    strikesFrom: { reachFeet: 5, moveFeet: 20 }
  },
  // A spectral sword within 90 feet; each later Bonus Action moves it up to 30 feet before it strikes again.
  "arcane-sword": {
    creatures: [{ monsterId: "arcane-sword" }],
    rangeFeet: 90,
    turn: "none",
    intangible: true,
    strikesFrom: { reachFeet: 5, moveFeet: 30 }
  },
  // A Fey spirit in a space within 60 feet; each later Bonus Action teleports it up to 30 feet before it attacks.
  "conjure-fey": {
    creatures: [{ monsterId: "fey-spirit" }],
    rangeFeet: 60,
    turn: "none",
    intangible: true,
    strikesFrom: { reachFeet: 5, moveFeet: 30, teleports: true }
  },
  // An Invisible, invulnerable eye within 30 feet whose sight its caster shares, with Darkvision 30 feet; a Bonus
  // Action moves it up to 30 feet.
  "arcane-eye": {
    creatures: [{ monsterId: "arcane-eye" }],
    rangeFeet: 30,
    turn: "none",
    intangible: true,
    sight: "always",
    commandedWith: "bonus-action",
    commandMove: 30,
    noAttacks: true
  },
  // A Large hand within 120 feet, AC 20 with its caster's Hit Point maximum: each of its effects reaches a creature
  // within 5 feet of it after it moves up to 60 feet, and the spell ends if it drops to 0 Hit Points.
  "arcane-hand": {
    creatures: [{ monsterId: "arcane-hand" }],
    rangeFeet: 120,
    turn: "none",
    strikesFrom: { reachFeet: 5, moveFeet: 60 },
    endsSpell: true,
    noAttacks: true
  },
  // A spectral hand within 30 feet; a Magic action moves it up to 30 feet, and it vanishes more than 30 feet from its
  // caster or when the spell is cast again.
  "mage-hand": {
    creatures: [{ monsterId: "mage-hand" }],
    rangeFeet: 30,
    turn: "none",
    intangible: true,
    commandedWith: "action",
    commandMove: 30,
    leashFeet: 30,
    onlyOne: true,
    noAttacks: true
  },
  // An intangible, invulnerable double where its caster stands, whose eyes and ears its caster shares; a Magic action
  // moves it up to twice its caster's Speed.
  mislead: {
    creatures: [{ monsterId: "illusory-double" }],
    turn: "none",
    intangible: true,
    sight: "always",
    commandedWith: "action",
    commandMove: "twice-user-speed",
    noAttacks: true
  },
  // A copy of its caster anywhere within range its caster has seen, whose eyes and ears its caster shares; a Magic
  // action moves it up to 60 feet, and any damage ends it and the spell.
  "project-image": {
    creatures: [{ monsterId: "illusory-copy" }],
    rangeFeet: 1000,
    turn: "none",
    sight: "always",
    commandedWith: "action",
    commandMove: 60,
    endsOnDamage: true,
    endsSpell: true,
    noAttacks: true
  },
  // An Invisible force within 60 feet (AC 10, 1 Hit Point, Strength 2) that can't attack: once on each of the caster's
  // turns a Bonus Action moves it 15 feet, and the spell ends if it is more than 60 feet away.
  "unseen-servant": {
    creatures: [{ monsterId: "unseen-servant" }],
    rangeFeet: 60,
    turn: "none",
    commandedWith: "bonus-action",
    commandMove: 15,
    leashFeet: 60,
    noAttacks: true
  }
};

/** "Have the Charmed condition for the duration ... issue commands to the target": a failure puts the creature under
 *  the caster's command while its condition lasts (the `commanded` tag, read by `summons.ts`). Planar Binding's bound
 *  creature serves the caster for the duration. */
const COMMANDING_FAILURES: Readonly<Record<string, NonNullable<SpellEffect["failureEffect"]>>> = {
  "dominate-beast": { name: "Dominate Beast", tags: ["commanded"], modifiers: [] },
  "dominate-person": { name: "Dominate Person", tags: ["commanded"], modifiers: [] },
  "dominate-monster": { name: "Dominate Monster", tags: ["commanded"], modifiers: [] },
  "planar-binding": { name: "Bound by Planar Binding", tags: ["commanded"], modifiers: [] }
};

/** "A Celestial, an Elemental, a Fey, or a Fiend": Planar Binding's targets. */
const COMMANDING_TARGET_TYPES: Readonly<Record<string, readonly string[]>> = {
  "planar-binding": ["celestial", "elemental", "fey", "fiend"]
};

/** What a spell's summons and commands add to its cast model. */
export function spellSummonFieldsFor(id: string): Partial<SpellEffect> {
  const row = ROWS[id];
  const failure = COMMANDING_FAILURES[id];
  const types = COMMANDING_TARGET_TYPES[id];
  return {
    ...(row ? { summons: SummonSchema.parse(row) as Summon } : {}),
    // The corpses it raises, or the creatures whose command it renews, are its targets, so the cast checks their
    // number: the larger of the two (`summons.ts` holds the corpses to the creatures it makes).
    ...(row?.fromCorpse
      ? {
          targets: {
            count: Math.max(row.creatures[0]?.count ?? 1, row.reasserts?.count ?? 1),
            perSlot: row.reasserts?.perSlot ?? row.creatures[0]?.perSlot ?? 1
          }
        }
      : {}),
    ...(failure ? { failureEffect: structuredClone(failure) } : {}),
    ...(types ? { targetTypes: [...types] } : {})
  };
}

/** The reviewed ids, so a test can check every row still names a real spell. */
export const SPELL_SUMMON_REVIEWED_IDS: readonly string[] = [
  ...Object.keys(ROWS),
  ...Object.keys(COMMANDING_FAILURES),
  ...Object.keys(COMMANDING_TARGET_TYPES)
];

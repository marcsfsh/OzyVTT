/**
 * Reviewed corrections to the open5e spell fixtures, checked against the SRD 5.2.1 spells chapter: card text the
 * source truncated, casting times it shortened, and material components it marks consumed when they only carry a
 * price. Applied by `build-bundle.ts` over the source's fields; `build-bundle.ts` refuses a row naming no spell.
 */

type SpellFieldCorrection = Partial<{
  desc: string;
  higher_level: string;
  casting_time: string;
  material_consumed: boolean;
  material_specified: string;
}>;

/** Casting times the source gets wrong, in the SRD's words. */
const CASTING_TIMES: Readonly<Record<string, string>> = {
  clairvoyance: "10 minutes",
  contingency: "10 minutes",
  "control-weather": "10 minutes",
  fabricate: "10 minutes",
  "hallucinatory-terrain": "10 minutes",
  "heroes-feast": "10 minutes",
  "legend-lore": "10 minutes",
  "mirage-arcane": "10 minutes",
  "planar-ally": "10 minutes",
  "prayer-of-healing": "10 minutes",
  "private-sanctum": "10 minutes",
  scrying: "10 minutes",
  awaken: "8 hours",
  hallow: "24 hours",
  simulacrum: "12 hours",
  // Overgrowth takes an Action, Enrichment 8 hours.
  "plant-growth": "Action or 8 hours"
};

/** Spells whose material is only priced ("worth 50+ GP"), never consumed: the SRD says "which the spell consumes"
 *  when it is. */
const NOT_CONSUMED: readonly string[] = [
  "arcane-sword",
  "augury",
  "bless",
  "chromatic-orb",
  "circle-of-death",
  "clairvoyance",
  "contingency",
  "find-the-path",
  "forbiddance",
  "gate",
  "guards-and-wards",
  "holy-aura",
  "identify",
  "imprisonment",
  "instant-summons",
  "magic-jar",
  "magnificent-mansion",
  "plane-shift",
  "programmed-illusion",
  "project-image",
  "scrying",
  "secret-chest",
  "shapechange",
  "summon-dragon",
  "true-strike",
  "warding-bond"
];

const TEXT: Readonly<Record<string, SpellFieldCorrection>> = {
  // The source drops the last paragraph.
  "srd-2024_antimagic-field": {
    desc: "An aura of antimagic surrounds you in 10-foot Emanation. No one can cast spells, take Magic actions, or create other magical effects inside the aura, and those things can't target or otherwise affect anything inside it. Magical properties of magic items don't work inside the aura or on anything inside it.\n\nAreas of effect created by spells or other magic can't extend into the aura, and no one can teleport into or out of it or use planar travel there. Portals close temporarily while in the aura.\n\nOngoing spells, except those cast by an Artifact or a deity, are suppressed in the area. While an effect is suppressed, it doesn't function, but the time it spends suppressed counts against its duration.\n\nDispel Magic has no effect on the aura, and the auras created by different Antimagic Field spells don't nullify each other."
  },
  // The source drops the Approach option.
  "srd-2024_command": {
    desc: "You speak a one-word command to a creature you can see within range. The target must succeed on a Wisdom saving throw or follow the command on its next turn. Choose the command from these options:\n\n**Approach.** The target moves toward you by the shortest and most direct route, ending its turn if it moves within 5 feet of you.\n\n**Drop.** The target drops whatever it is holding and then ends its turn.\n\n**Flee.** The target spends its turn moving away from you by the fastest available means.\n\n**Grovel.** The target has the Prone condition and then ends its turn.\n\n**Halt.** On its turn, the target doesn't move and takes no action or Bonus Action."
  },
  // The source drops both lights.
  "srd-2024_conjure-celestial": {
    desc: "You conjure a spirit from the Upper Planes, which manifests as a pillar of light in a 10-foot-radius, 40-foot-high Cylinder centered on a point within range. For each creature you can see in the Cylinder, choose which of these lights shines on it:\n\n**Healing Light.** The target regains Hit Points equal to 4d12 plus your spellcasting ability modifier.\n\n**Searing Light.** The target makes a Dexterity saving throw, taking 6d12 Radiant damage on a failed save or half as much damage on a successful one.\n\nUntil the spell ends, Bright Light fills the Cylinder, and when you move on your turn, you can also move the Cylinder up to 30 feet.\n\nWhenever the Cylinder moves into the space of a creature you can see and whenever a creature you can see enters the Cylinder or ends its turn there, you can bathe it in one of the lights. A creature can be affected by this spell only once per turn."
  },
  // The source drops both special functions.
  "srd-2024_dispel-evil-and-good": {
    desc: "For the duration, Celestials, Elementals, Fey, Fiends, and Undead have Disadvantage on attack rolls against you. You can end the spell early by using either of the following special functions.\n\n**Break Enchantment.** As a Magic action, you touch a creature that is possessed by or has the Charmed or Frightened condition from one or more creatures of the types above. The target is no longer possessed, Charmed, or Frightened by such creatures.\n\n**Dismissal.** As a Magic action, you target one creature you can see within 5 feet of you that has one of the creature types above. The target must succeed on a Charisma saving throw or be sent back to its home plane if it isn't there already. If they aren't on their home plane, Undead are sent to the Shadowfell, and Fey are sent to the Feywild."
  },
  // The source drops part of the Hallowed Ward.
  "srd-2024_hallow": {
    desc: "You touch a point and infuse an area around it with holy or unholy power. The area can have a radius up to 60 feet, and the spell fails if the radius includes an area already under the effect of Hallow. The affected area has the following effects.\n\n**Hallowed Ward.** Choose any of these creature types: Aberration, Celestial, Elemental, Fey, Fiend, or Undead. Creatures of the chosen types can't willingly enter the area, and any creature that is possessed by or that has the Charmed or Frightened condition from such creatures isn't possessed, Charmed, or Frightened by them while in the area.\n\n**Extra Effect.** You bind an extra effect to the area from the list below:\n\n**Courage.** Creatures of any types you choose can't gain the Frightened condition while in the area.\n\n**Darkness.** Darkness fills the area. Normal light, as well as magical light created by spells of a level lower than this spell, can't illuminate the area.\n\n**Daylight.** Bright light fills the area. Magical Darkness created by spells of a level lower than this spell can't extinguish the light.\n\n**Peaceful Rest.** Dead bodies interred in the area can't be turned into Undead.\n\n**Extradimensional Interference.** Creatures of any types you choose can't enter or exit the area using teleportation or interplanar travel.\n\n**Fear.** Creatures of any types you choose have the Frightened condition while in the area.\n\n**Resistance.** Creatures of any types you choose have Resistance to one damage type of your choice while in the area.\n\n**Silence.** No sound can emanate from within the area, and no sound can reach into it.\n\n**Tongues.** Creatures of any types you choose can communicate with any other creature in the area even if they don't share a common language.\n\n**Vulnerability.** Creatures of any types you choose have Vulnerability to one damage type of your choice while in the area."
  },
  // The source drops the first paragraph.
  "srd-2024_knock": {
    desc: "Choose an object that you can see within range. The object can be a door, a box, a chest, a set of manacles, a padlock, or another object that contains a mundane or magical means that prevents access.\n\nA target that is held shut by a mundane lock or that is stuck or barred becomes unlocked, unstuck, or unbarred. If the object has multiple locks, only one of them is unlocked.\n\nIf the target is held shut by Arcane Lock, that spell is suppressed for 10 minutes, during which time the target can be opened and closed.\n\nWhen you cast the spell, a loud knock, audible up to 300 feet away, emanates from the target."
  },
  // The source drops the first paragraph, which names the Cylinder.
  "srd-2024_moonbeam": {
    desc: "A silvery beam of pale light shines down in a 5-foot-radius, 40-foot-high Cylinder centered on a point within range. Until the spell ends, Dim Light fills the Cylinder, and you can take a Magic action on later turns to move the Cylinder up to 60 feet.\n\nWhen the Cylinder appears, each creature in it makes a Constitution saving throw. On a failed save, a creature takes 2d10 Radiant damage, and if the creature is shape-shifted (as a result of the Polymorph spell, for example), it reverts to its true form and can't shape-shift until it leaves the Cylinder. On a successful save, a creature takes half as much damage only. A creature also makes this save when the spell's area moves into its space and when it enters the spell's area or ends its turn there. A creature makes this save only once per turn."
  },
  // The source drops part of the Creature option.
  "srd-2024_telekinesis": {
    desc: "You gain the ability to move or manipulate creatures or objects by thought. When you cast the spell and as a Magic action on your later turns before the spell ends, you can exert your will on one creature or object that you can see within range, causing the appropriate effect below. You can affect the same target round after round or choose a new one at any time. If you switch targets, the prior target is no longer affected by the spell.\n\n**Creature.** You can try to move a Huge or smaller creature. The target must succeed on a Strength saving throw, or you move it up to 30 feet in any direction within the spell's range. Until the end of your next turn, the creature has the Restrained condition, and if you lift it into the air, it is suspended there. It falls at the end of your next turn unless you use this option on it again and it fails the save.\n\n**Object.** You can try to move a Huge or smaller object. If the object isn't being worn or carried, you automatically move it up to 30 feet in any direction within the spell's range. If the object is worn or carried by a creature, that creature must succeed on a Strength saving throw, or you pull the object away and move it up to 30 feet in any direction within the spell's range.\n\nYou can exert fine control on objects with your telekinetic grip, such as manipulating a simple tool, opening a door or a container, stowing or retrieving an item from an open container, or pouring the contents from a vial."
  },
  // The source drops the Familiarity heading.
  "srd-2024_teleport": {
    desc: 'This spell instantly transports you and up to eight willing creatures that you can see within range, or a single object that you can see within range, to a destination you select. If you target an object, it must be Large or smaller, and it can\'t be held or carried by an unwilling creature.\n\nThe destination you choose must be known to you, and it must be on the same plane of existence as you. Your familiarity with the destination determines whether you arrive there successfully. The GM rolls 1d100 and consults the Teleportation Outcome table and the explanations after it.\n\n**Teleportation Outcome**\n\n| Familiarity | Mishap | Similar Area | Off Target | On Target |\n|---|---|---|---|---|\n| Permanent circle | \u2014 | \u2014 | \u2014 | 01\u201300 |\n| Linked object | \u2014 | \u2014 | \u2014 | 01\u201300 |\n| Very familiar | 01\u201305 | 06\u201313 | 14\u201324 | 25\u201300 |\n| Seen casually | 01\u201333 | 34\u201343 | 44\u201353 | 54\u201300 |\n| Viewed once or described | 01\u201343 | 44\u201353 | 54\u201373 | 74\u201300 |\n| False destination | 01\u201350 | 51\u201300 | \u2014 | \u2014 |\n\n**Familiarity.** Here are the meanings of the terms in the table\'s Familiarity column:\n\n- "Permanent circle" means a permanent teleportation circle whose sigil sequence you know.\n- "Linked object" means you possess an object taken from the desired destination within the last six months, such as a book from a wizard\'s library.\n- "Very familiar" is a place you have visited often, a place you have carefully studied, or a place you can see when you cast the spell.\n- "Seen casually" is a place you have seen more than once but with which you aren\'t very familiar.\n- "Viewed once or described" is a place you have seen once, possibly using magic, or a place you know through someone else\'s description, perhaps from a map.\n- "False destination" is a place that doesn\'t exist. Perhaps you tried to scry an enemy\'s sanctum but instead viewed an illusion, or you are attempting to teleport to a location that no longer exists.\n\n**Mishap.** The spell\'s unpredictable magic results in a difficult journey. Each teleporting creature (or the target object) takes 3d10 Force damage, and the GM rerolls on the table to see where you wind up (multiple mishaps can occur, dealing damage each time).\n\n**Similar Area.** You and your group (or the target object) appear in a different area that\'s visually or thematically similar to the target area. You appear in the closest similar place. If you are heading for your home laboratory, for example, you might appear in another person\'s laboratory in the same city.\n\n**Off Target.** You and your group (or the target object) appear 2d12 miles away from the destination in a random direction. Roll 1d8 for the direction: 1, east; 2, southeast; 3, south; 4, southwest; 5, west; 6, northwest; 7, north; or 8, northeast.\n\n**On Target.** You and your group (or the target object) appear where you intended.'
  },
  // The source's typo ("10 foot square") hides the area from the template reader.
  "srd-2024_grease": {
    desc: "Nonflammable grease covers the ground in a 10-foot square centered on a point within range and turns it into Difficult Terrain for the duration.\n\nWhen the grease appears, each creature standing in its area must succeed on a Dexterity saving throw or have the Prone condition. A creature that enters the area or ends its turn there must also succeed on that save or fall Prone."
  },
  // The source's typo ("40-foothigh") hides the area from the template reader.
  "srd-2024_flame-strike": {
    desc: "A vertical column of brilliant fire roars down from above. Each creature in a 10-foot-radius, 40-foot-high Cylinder centered on a point within range makes a Dexterity saving throw, taking 5d6 Fire damage and 5d6 Radiant damage on a failed save or half as much damage on a successful one."
  },
  // The source drops the higher-level line.
  "srd-2024_chain-lightning": {
    higher_level: "One additional bolt leaps from the first target to another target for each spell slot level above 6."
  },
  // The source drops the higher-level line.
  "srd-2024_dissonant-whispers": {
    higher_level: "The damage increases by 1d6 for each spell slot level above 1."
  }
};

/** Every correction by fixture key (`srd-2024_<id>`). */
export const SPELL_FIELD_CORRECTIONS: Readonly<Record<string, SpellFieldCorrection>> = (() => {
  const merged: Record<string, SpellFieldCorrection> = {
    "srd-2024_greater-invisibility": {
      // Empty upstream; the printed SRD 5.2.1 sentence.
      desc: "A creature you touch has the Invisible condition until the spell ends."
    },
    // The source leaves out the material.
    "srd-2024_jump": { material_specified: "a grasshopper's hind leg" },
    ...TEXT
  };
  const add = (id: string, row: SpellFieldCorrection) => {
    merged[`srd-2024_${id}`] = { ...merged[`srd-2024_${id}`], ...row };
  };
  for (const [id, castingTime] of Object.entries(CASTING_TIMES)) add(id, { casting_time: castingTime });
  for (const id of NOT_CONSUMED) add(id, { material_consumed: false });
  return merged;
})();

/** The source's casting-time slugs ("bonus-action", "1minute") as the SRD prints them ("Bonus Action",
 *  "1 minute"); a corrected one is already printed that way. */
export function castingTimeText(value: string): string {
  const fixed: Readonly<Record<string, string>> = {
    action: "Action",
    "bonus-action": "Bonus Action",
    reaction: "Reaction"
  };
  if (fixed[value]) return fixed[value];
  const span = /^(\d+)(minute|hour)s?$/.exec(value);
  if (!span) return value;
  return `${span[1]} ${span[2]}${span[1] === "1" ? "" : "s"}`;
}

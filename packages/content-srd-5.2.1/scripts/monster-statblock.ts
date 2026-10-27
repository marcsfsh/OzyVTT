/**
 * What SRD 5.2.1 prints in a stat block's header and Gear line that the open5e transcription drops, checked against the
 * SRD's own text: the tags after a creature type ("Huge Fiend (Demon)", "Medium or Small Humanoid (Wizard)"), a
 * swarm's size and kind of its creatures ("Medium Swarm of Tiny Beasts"), the Gear an NPC carries, and the lair's
 * numbers a legendary creature prints ("Legendary Action Uses: 3 (4 in Lair)").
 */

/** The tags SRD 5.2.1 prints after each creature's type, keyed by its slug. */
const TYPE_TAGS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  (
    [
      ["Angel", ["deva", "planetar", "solar"]],
      [
        "Chromatic",
        ["black", "blue", "green", "red", "white"].flatMap((colour) => [
          `${colour}-dragon-wyrmling`,
          `young-${colour}-dragon`,
          `adult-${colour}-dragon`,
          `ancient-${colour}-dragon`
        ])
      ],
      ["Cleric", ["mummy-lord", "priest", "priest-acolyte"]],
      ["Demon", ["balor", "dretch", "glabrezu", "hezrou", "marilith", "nalfeshnee", "quasit", "vrock"]],
      [
        "Devil",
        [
          "barbed-devil",
          "bearded-devil",
          "bone-devil",
          "chain-devil",
          "erinyes",
          "horned-devil",
          "ice-devil",
          "imp",
          "lemure",
          "pit-fiend"
        ]
      ],
      [
        "Dinosaur",
        ["allosaurus", "ankylosaurus", "archelon", "plesiosaurus", "pteranodon", "triceratops", "tyrannosaurus-rex"]
      ],
      ["Druid", ["druid"]],
      ["Genie", ["djinni", "efreeti"]],
      [
        "Goblinoid",
        [
          "bugbear-stalker",
          "bugbear-warrior",
          "goblin-boss",
          "goblin-minion",
          "goblin-warrior",
          "hobgoblin-captain",
          "hobgoblin-warrior"
        ]
      ],
      ["Lycanthrope", ["werebear", "wereboar", "wererat", "weretiger", "werewolf"]],
      [
        "Metallic",
        ["brass", "bronze", "copper", "gold", "silver"].flatMap((metal) => [
          `${metal}-dragon-wyrmling`,
          `young-${metal}-dragon`,
          `adult-${metal}-dragon`,
          `ancient-${metal}-dragon`
        ])
      ],
      ["Titan", ["kraken", "tarrasque"]],
      ["Wizard", ["archmage", "lich", "mage"]]
    ] as const
  ).flatMap(([tag, slugs]) => slugs.map((slug) => [slug, [tag]] as const))
);

/** A swarm's creatures: "Medium Swarm of Tiny Beasts". */
const SWARMS: Readonly<Record<string, Readonly<{ size: "tiny"; of: string }>>> = {
  "swarm-of-bats": { size: "tiny", of: "Beasts" },
  "swarm-of-crawling-claws": { size: "tiny", of: "Undead" },
  "swarm-of-insects": { size: "tiny", of: "Beasts" },
  "swarm-of-piranhas": { size: "tiny", of: "Beasts" },
  "swarm-of-rats": { size: "tiny", of: "Beasts" },
  "swarm-of-ravens": { size: "tiny", of: "Beasts" },
  "swarm-of-venomous-snakes": { size: "tiny", of: "Beasts" }
};

/** The Gear line each NPC prints, as printed. */
const GEAR: Readonly<Record<string, string>> = {
  archmage: "Wand",
  assassin: "Light Crossbow, Shortsword, Studded Leather Armor",
  bandit: "Leather Armor, Light Crossbow, Scimitar",
  "bandit-captain": "Pistol, Scimitar, Studded Leather Armor",
  berserker: "Greataxe, Hide Armor",
  "bugbear-stalker": "Chain Shirt, Javelins (6), Morningstar",
  "bugbear-warrior": "Hide Armor, Light Hammers (3)",
  "centaur-trooper": "Breastplate, Longbow, Pike",
  commoner: "Club",
  cultist: "Leather Armor, Sickle",
  "cultist-fanatic": "Holy Symbol, Leather Armor",
  druid: "Studded Leather Armor",
  ettin: "Battleaxe, Morningstar",
  gladiator: "Shield, Spears (3), Studded Leather Armor",
  "goblin-boss": "Chain Shirt, Scimitar, Shield, Shortbow",
  "goblin-minion": "Daggers (3)",
  "goblin-warrior": "Leather Armor, Scimitar, Shield, Shortbow",
  guard: "Chain Shirt, Shield, Spear",
  "guard-captain": "Breastplate, Javelins (6), Longsword, Shield",
  "hobgoblin-captain": "Greatsword, Half Plate Armor, Longbow",
  "hobgoblin-warrior": "Half Plate Armor, Longbow, Longsword, Shield",
  knight: "Greatsword, Heavy Crossbow, Plate Armor",
  "kobold-warrior": "Daggers (3)",
  lich: "Component Pouch",
  mage: "Wand",
  noble: "Breastplate, Rapier",
  ogre: "Greatclub, Javelins (3)",
  pirate: "Daggers (6), Leather Armor",
  "pirate-captain": "Pistol, Rapier",
  priest: "Chain Shirt, Holy Symbol, Mace",
  "priest-acolyte": "Chain Shirt, Holy Symbol, Mace",
  scout: "Leather Armor, Longbow, Shortsword",
  skeleton: "Shortbow, Shortsword",
  spy: "Hand Crossbow, Shortsword, Thieves' Tools",
  tough: "Heavy Crossbow, Leather Armor, Mace",
  "tough-boss": "Chain Mail, Heavy Crossbow, Warhammer",
  "vampire-familiar": "Daggers (10)",
  "warrior-infantry": "Chain Shirt, Spear",
  "warrior-veteran": "Greatsword, Heavy Crossbow, Splint Armor",
  werebear: "Handaxes (4)",
  wereboar: "Javelins (6)",
  wererat: "Hand Crossbow",
  weretiger: "Longbow",
  werewolf: "Longbow",
  wight: "Studded Leather Armor"
};

/** The header facts a stat block prints beyond its size and type, for the extension bag the stat block reads. */
export function statBlockHeaderOf(slug: string): Readonly<{
  typeTags?: readonly string[];
  swarm?: Readonly<{ size: "tiny"; of: string }>;
  gear?: string;
}> {
  return {
    ...(TYPE_TAGS[slug] ? { typeTags: [...TYPE_TAGS[slug]!] } : {}),
    ...(SWARMS[slug] ? { swarm: { ...SWARMS[slug]! } } : {}),
    ...(GEAR[slug] ? { gear: GEAR[slug]! } : {})
  };
}

/**
 * The lair's numbers: SRD 5.2.1 prints "Legendary Action Uses: 3 (4 in Lair)" for every legendary creature whose
 * Legendary Resistance names a lair count ("3/Day, or 4/Day in Lair"), so both read from that trait's name. Null for a
 * creature with no lair (the tarrasque's "6/Day").
 */
export function lairCountsOf(
  traitNames: readonly string[],
  actionsPerRound: number | undefined
): Readonly<{ actionsInLair?: number; resistancesInLair: number }> | null {
  const match = traitNames
    .map((name) => /^Legendary Resistance \(\d+\/Day, or (\d+)\/Day in Lair\)/.exec(name))
    .find(Boolean);
  if (!match) return null;
  return {
    ...(actionsPerRound !== undefined ? { actionsInLair: actionsPerRound + 1 } : {}),
    resistancesInLair: Number(match[1])
  };
}

/** Every slug a table names, for the build's check that each is a real creature. */
export const STATBLOCK_SLUGS: readonly string[] = [
  ...new Set([...Object.keys(TYPE_TAGS), ...Object.keys(SWARMS), ...Object.keys(GEAR)])
];

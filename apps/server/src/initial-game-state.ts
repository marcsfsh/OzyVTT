import { GameStateSchema, type GameState, type StoredDefinition } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * Three level-7 example player characters - a self-sufficient adventuring party that exercises every
 * combat system the table has (melee multiattack, ranged/AoE spells, saving throws, healing,
 * reactions, and enough hit points that a fight spans many turns). Each ships a full
 * `ActorDefinition` sheet in `state.definitions`; its live actor references it by `definitionId`, so
 * the GM (via `content:monster-sheet`) and the owning player (inline in their projection) both see the
 * complete stat block, and the save auto-roll uses the real per-ability save bonuses encoded in the
 * open5e extension. Content is SRD 5.2.1 (CC BY 4.0). Proficiency bonus at level 7 is +3.
 */

export const PLACEHOLDER_ACTOR_IDS = {
  fighter: "2b20e657-df27-4a8e-9a8d-a9c608763701",
  cleric: "d91ad7e6-d334-4596-885e-47ac9c981702",
  wizard: "b073fe5f-4394-4869-9e79-a0e3dc4e1703"
} as const;

const EXAMPLE_DEFINITION_IDS = {
  fighter: "example-borin-fighter-7",
  cleric: "example-mirena-cleric-7",
  wizard: "example-lyra-wizard-7"
} as const;

const SOURCE = { name: "Example party (SRD 5.2.1)", version: "1.0.0" } as const;
const CHARACTER = { schemaId: "vtt.actor-character", schemaVersion: 1, size: "medium", speedFeet: 30, token: { disposition: "friendly", footprint: { width: 1, height: 1 } } } as const;

/** Borin Stoneguard - Fighter (Champion) 7, dwarf. Front-line guardian: two attacks, self-heal, action surge. */
const BORIN: ActorDefinition = {
  ...CHARACTER,
  source: { ...SOURCE, externalId: "example-pc-borin" },
  name: "Borin Stoneguard",
  summary: "Level 7 dwarf Champion fighter - the party's shield wall.",
  abilityScores: { str: 18, dex: 12, con: 16, int: 10, wis: 13, cha: 8 },
  proficiencyBonus: 3,
  armorClass: 18,
  hitPoints: { maximum: 74 },
  initiativeBonus: 1,
  actions: [
    { id: "longsword", name: "Longsword", activation: "action", attack: { bonus: 7, reachFeet: 5 }, damage: [{ formula: "1d8 + 4", type: "slashing" }],
      description: "*Melee Attack Roll:* +7, reach 5 ft. *Hit:* 1d8 + 4 slashing damage (1d10 + 4 with two hands). *Extra Attack:* Borin makes **two** attacks with this action." },
    { id: "handaxe-thrown", name: "Handaxe (Thrown)", activation: "action", attack: { bonus: 7, rangeFeet: 60 }, damage: [{ formula: "1d6 + 4", type: "slashing" }],
      description: "*Ranged Attack Roll:* +7, range 20/60 ft. *Hit:* 1d6 + 4 slashing damage. *Extra Attack:* two throws." },
    { id: "second-wind", name: "Second Wind", activation: "bonus-action", damage: [],
      description: "*Bonus Action (2 per rest):* Borin regains **1d10 + 7** hit points." },
    { id: "action-surge", name: "Action Surge", activation: "other", damage: [],
      description: "*Once per rest:* on his turn, Borin takes one **additional action**." }
  ],
  character: { classes: [{ id: "fighter", name: "Fighter", subclass: { id: "champion", name: "Champion" }, level: 7 }], race: { id: "dwarf", name: "Dwarf" }, background: { id: "soldier", name: "Soldier" }, feats: [] },
  proficiencies: { saves: ["str", "con"], skills: [{ id: "athletics", proficiency: "proficient" }, { id: "perception", proficiency: "proficient" }, { id: "intimidation", proficiency: "proficient" }] },
  startingInventory: [{ id: "longsword", name: "Longsword", quantity: 1, equipped: true, attuned: false }, { id: "chain-mail", name: "Chain Mail", quantity: 1, equipped: true, attuned: false }, { id: "shield", name: "Shield", quantity: 1, equipped: true, attuned: false }, { id: "handaxe", name: "Handaxe", quantity: 2, equipped: false, attuned: false }],
  startingCurrency: { cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 },
  extensions: { "open5e.srd-2024": {
    type: "Fighter 7 (dwarf)", alignment: "Lawful Good", armorDetail: "chain mail, shield",
    senses: ["Darkvision 60 ft."], passivePerception: 11, languages: "Common, Dwarvish",
    savingThrows: { str: 7, dex: 1, con: 6, int: 0, wis: 1, cha: -1 },
    traits: [
      { name: "Extra Attack", description: "Borin attacks twice whenever he takes the Attack action." },
      { name: "Improved Critical", description: "His weapon attacks score a critical hit on a roll of 19 or 20." },
      { name: "Remarkable Athlete", description: "He adds +2 to any Strength, Dexterity, or Constitution check that doesn't already use his proficiency bonus." },
      { name: "Dwarven Resilience", description: "Advantage on saving throws against poison, and resistance to poison damage." }
    ]
  } }
};

/** Mirena Dawnbright - Cleric (Life Domain) 7, human. Healer and controller: big heals, radiant damage, save spells. */
const MIRENA: ActorDefinition = {
  ...CHARACTER,
  source: { ...SOURCE, externalId: "example-pc-mirena" },
  name: "Mirena Dawnbright",
  summary: "Level 7 human Life Domain cleric - keeps the party standing.",
  abilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 18, cha: 12 },
  proficiencyBonus: 3,
  armorClass: 18,
  hitPoints: { maximum: 52 },
  initiativeBonus: 0,
  actions: [
    { id: "mace", name: "Mace", activation: "action", attack: { bonus: 5, reachFeet: 5 }, damage: [{ formula: "1d6 + 2", type: "bludgeoning" }],
      description: "*Melee Attack Roll:* +5, reach 5 ft. *Hit:* 1d6 + 2 bludgeoning damage." },
    { id: "sacred-flame", name: "Sacred Flame (Cantrip)", activation: "action", save: { ability: "dex", dc: 15 }, damage: [{ formula: "2d8", type: "radiant" }],
      description: "*Dexterity Saving Throw:* DC 15, one creature (ignores cover). *Failure:* 2d8 radiant damage. *Success:* No damage." },
    { id: "guiding-bolt", name: "Guiding Bolt (1st)", activation: "action", attack: { bonus: 7, rangeFeet: 120 }, damage: [{ formula: "4d6", type: "radiant" }],
      description: "*Ranged Spell Attack:* +7, range 120 ft. *Hit:* 4d6 radiant damage, and the next attack against the target before your next turn has Advantage." },
    { id: "cure-wounds", name: "Cure Wounds (1st)", activation: "action", damage: [],
      description: "*Touch:* a creature regains **2d8 + 7** hit points (includes Disciple of Life)." },
    { id: "spiritual-weapon", name: "Spiritual Weapon (2nd)", activation: "bonus-action", attack: { bonus: 7, rangeFeet: 60 }, damage: [{ formula: "1d8 + 4", type: "force" }],
      description: "*Bonus Action, Ranged Spell Attack:* +7, range 60 ft. *Hit:* 1d8 + 4 force damage. Move the weapon 20 ft as part of this action." },
    { id: "hold-person", name: "Hold Person (2nd)", activation: "action", save: { ability: "wis", dc: 15 }, damage: [],
      description: "*Wisdom Saving Throw:* DC 15, one Humanoid. *Failure:* the target is **Paralyzed** for the duration (Concentration, up to 1 minute), repeating the save at the end of each of its turns." },
    { id: "spirit-guardians", name: "Spirit Guardians (3rd)", activation: "action", save: { ability: "wis", dc: 15 }, damage: [{ formula: "3d8", type: "radiant" }],
      description: "*Wisdom Saving Throw:* DC 15 for each creature that starts its turn within 15 ft. *Failure:* 3d8 radiant damage and speed halved. *Success:* Half damage. (Concentration.)" },
    { id: "mass-healing-word", name: "Mass Healing Word (3rd)", activation: "bonus-action", damage: [],
      description: "*Bonus Action:* up to six creatures you can see each regain **1d4 + 4** hit points." }
  ],
  character: { classes: [{ id: "cleric", name: "Cleric", subclass: { id: "life-domain", name: "Life Domain" }, level: 7 }], race: { id: "human", name: "Human" }, background: { id: "acolyte", name: "Acolyte" }, feats: [] },
  proficiencies: { saves: ["wis", "cha"], skills: [{ id: "medicine", proficiency: "proficient" }, { id: "insight", proficiency: "proficient" }, { id: "religion", proficiency: "proficient" }, { id: "persuasion", proficiency: "proficient" }] },
  spellcasting: { ability: "wis", saveDc: 15, attackBonus: 7, slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 3 }, { level: 4, max: 1 }], spells: [
    { id: "sacred-flame", name: "Sacred Flame", level: 0, prepared: true, alwaysPrepared: true, actionId: "sacred-flame" },
    { id: "guiding-bolt", name: "Guiding Bolt", level: 1, prepared: true, alwaysPrepared: false, actionId: "guiding-bolt" },
    { id: "cure-wounds", name: "Cure Wounds", level: 1, prepared: true, alwaysPrepared: false, actionId: "cure-wounds" },
    { id: "spiritual-weapon", name: "Spiritual Weapon", level: 2, prepared: true, alwaysPrepared: false, actionId: "spiritual-weapon" },
    { id: "hold-person", name: "Hold Person", level: 2, prepared: true, alwaysPrepared: false, actionId: "hold-person" },
    { id: "spirit-guardians", name: "Spirit Guardians", level: 3, prepared: true, alwaysPrepared: false, actionId: "spirit-guardians" },
    { id: "mass-healing-word", name: "Mass Healing Word", level: 3, prepared: true, alwaysPrepared: false, actionId: "mass-healing-word" }
  ] },
  startingInventory: [{ id: "mace", name: "Mace", quantity: 1, equipped: true, attuned: false }, { id: "chain-mail", name: "Chain Mail", quantity: 1, equipped: true, attuned: false }, { id: "shield", name: "Shield", quantity: 1, equipped: true, attuned: false }, { id: "holy-symbol", name: "Holy Symbol", quantity: 1, equipped: true, attuned: false }],
  startingCurrency: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 },
  extensions: { "open5e.srd-2024": {
    type: "Cleric 7 (human)", alignment: "Lawful Good", armorDetail: "chain mail, shield",
    passivePerception: 14, languages: "Common, Celestial",
    savingThrows: { str: 2, dex: 0, con: 2, int: 0, wis: 7, cha: 4 },
    traits: [
      { name: "Spellcasting", description: "Wisdom caster - spell save **DC 15**, spell attack **+7**. Slots: 4 x 1st, 3 x 2nd, 3 x 3rd, 1 x 4th." },
      { name: "Channel Divinity (2 per rest)", description: "Turn Undead, or **Preserve Life** - restore up to 35 hit points, divided among creatures within 30 ft (no more than half a creature's max each)." },
      { name: "Disciple of Life", description: "Whenever a spell of level 1+ restores hit points, the target regains an extra 2 + the spell's level HP." },
      { name: "Blessed Healer", description: "When one of her spells heals another creature, Mirena also regains 2 + the spell's level HP." }
    ]
  } }
};

/** Lyra Emberwise - Wizard (Evoker) 7, high elf. Artillery: Fireball, Fire Bolt, Scorching Ray, Shield reaction. */
const LYRA: ActorDefinition = {
  ...CHARACTER,
  source: { ...SOURCE, externalId: "example-pc-lyra" },
  name: "Lyra Emberwise",
  summary: "Level 7 high-elf Evoker wizard - area damage and burst.",
  abilityScores: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
  proficiencyBonus: 3,
  armorClass: 15,
  hitPoints: { maximum: 44 },
  initiativeBonus: 2,
  actions: [
    { id: "dagger", name: "Dagger", activation: "action", attack: { bonus: 5, reachFeet: 5, rangeFeet: 20 }, damage: [{ formula: "1d4 + 2", type: "piercing" }],
      description: "*Melee or Ranged Attack Roll:* +5, reach 5 ft or range 20/60 ft. *Hit:* 1d4 + 2 piercing damage." },
    { id: "fire-bolt", name: "Fire Bolt (Cantrip)", activation: "action", attack: { bonus: 7, rangeFeet: 120 }, damage: [{ formula: "2d10", type: "fire" }],
      description: "*Ranged Spell Attack:* +7, range 120 ft. *Hit:* 2d10 fire damage, and flammable objects ignite." },
    { id: "fireball", name: "Fireball (3rd)", activation: "action", save: { ability: "dex", dc: 15 }, damage: [{ formula: "8d6", type: "fire" }],
      description: "*Dexterity Saving Throw:* DC 15, each creature in a **20-foot-radius Sphere** within 150 ft. *Failure:* 8d6 fire damage. *Success:* Half damage. *Sculpt Spells:* choose up to 4 creatures to automatically succeed and take no damage." },
    { id: "scorching-ray", name: "Scorching Ray (2nd)", activation: "action", attack: { bonus: 7, rangeFeet: 120 }, damage: [{ formula: "2d6", type: "fire" }],
      description: "*Ranged Spell Attack:* +7 for **each of three rays**, range 120 ft. *Hit:* 2d6 fire damage per ray." },
    { id: "shield", name: "Shield (1st, Reaction)", activation: "reaction", damage: [],
      description: "*Reaction, when hit by an attack or targeted by Magic Missile:* +5 bonus to AC until the start of your next turn, including against the triggering attack." },
    { id: "misty-step", name: "Misty Step (2nd)", activation: "bonus-action", damage: [],
      description: "*Bonus Action:* teleport up to 30 ft to an unoccupied space you can see." }
  ],
  character: { classes: [{ id: "wizard", name: "Wizard", subclass: { id: "evocation", name: "Evocation" }, level: 7 }], race: { id: "elf", name: "High Elf" }, background: { id: "sage", name: "Sage" }, feats: [] },
  proficiencies: { saves: ["int", "wis"], skills: [{ id: "arcana", proficiency: "proficient" }, { id: "investigation", proficiency: "proficient" }, { id: "history", proficiency: "proficient" }] },
  spellcasting: { ability: "int", saveDc: 15, attackBonus: 7, slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }, { level: 3, max: 3 }, { level: 4, max: 1 }], spells: [
    { id: "fire-bolt", name: "Fire Bolt", level: 0, prepared: true, alwaysPrepared: true, actionId: "fire-bolt" },
    { id: "shield", name: "Shield", level: 1, prepared: true, alwaysPrepared: false, actionId: "shield" },
    { id: "scorching-ray", name: "Scorching Ray", level: 2, prepared: true, alwaysPrepared: false, actionId: "scorching-ray" },
    { id: "misty-step", name: "Misty Step", level: 2, prepared: true, alwaysPrepared: false, actionId: "misty-step" },
    { id: "fireball", name: "Fireball", level: 3, prepared: true, alwaysPrepared: false, actionId: "fireball" }
  ] },
  startingInventory: [{ id: "dagger", name: "Dagger", quantity: 2, equipped: true, attuned: false }, { id: "spellbook", name: "Spellbook", quantity: 1, equipped: false, attuned: false }, { id: "arcane-focus", name: "Arcane Focus", quantity: 1, equipped: true, attuned: false }],
  startingCurrency: { cp: 0, sp: 0, ep: 0, gp: 20, pp: 5 },
  extensions: { "open5e.srd-2024": {
    type: "Wizard 7 (elf)", alignment: "Neutral Good", armorDetail: "Mage Armor",
    senses: ["Darkvision 60 ft."], passivePerception: 14, languages: "Common, Elvish, Draconic",
    savingThrows: { str: -1, dex: 2, con: 2, int: 7, wis: 4, cha: 0 },
    traits: [
      { name: "Spellcasting", description: "Intelligence caster - spell save **DC 15**, spell attack **+7**. Slots: 4 x 1st, 3 x 2nd, 3 x 3rd, 1 x 4th." },
      { name: "Sculpt Spells", description: "When she casts an evocation spell that affects others she can see, she chooses 1 + the spell's level of them to automatically succeed on their saves and take no damage." },
      { name: "Potent Cantrip", description: "A creature that succeeds on a save against one of her cantrips still takes half damage (if the cantrip deals damage)." },
      { name: "Fey Ancestry", description: "Advantage on saving throws to avoid or end the Charmed condition." }
    ]
  } }
};

const PARTY: ReadonlyArray<Readonly<{ id: string; definitionId: string; definition: ActorDefinition }>> = [
  { id: PLACEHOLDER_ACTOR_IDS.fighter, definitionId: EXAMPLE_DEFINITION_IDS.fighter, definition: BORIN },
  { id: PLACEHOLDER_ACTOR_IDS.cleric, definitionId: EXAMPLE_DEFINITION_IDS.cleric, definition: MIRENA },
  { id: PLACEHOLDER_ACTOR_IDS.wizard, definitionId: EXAMPLE_DEFINITION_IDS.wizard, definition: LYRA }
];

/** Live actor derived from a definition, mirroring the server's own `instantiate` so hp/AC/init/size never drift from the sheet. */
function actorFor(member: (typeof PARTY)[number]) {
  const { id, definitionId, definition } = member;
  return {
    id,
    name: definition.name,
    kind: "player-character" as const,
    visibility: "public" as const,
    hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum, temporary: 0 },
    armorClass: definition.armorClass,
    initiative: definition.initiativeBonus,
    ownerSessionId: null,
    conditions: [],
    spellSlots: definition.spellcasting ? definition.spellcasting.slots.map((slot) => ({ level: slot.level, remaining: slot.max })) : null,
    pactSlots: definition.spellcasting?.pact ? { level: definition.spellcasting.pact.level, remaining: definition.spellcasting.pact.max } : null,
    preparedSpellIds: definition.spellcasting ? definition.spellcasting.spells.filter((spell) => spell.prepared || spell.alwaysPrepared).map((spell) => spell.id) : [],
    inventory: (definition.startingInventory ?? []).map((item) => ({ ...item })),
    currency: definition.startingCurrency ? { ...definition.startingCurrency } : { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ...(definition.summary ? { notes: definition.summary } : {}),
    definitionId,
    size: definition.size,
    sizeCells: 1
  };
}

export function createInitialGameState(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: PARTY.map(actorFor),
    definitions: PARTY.map((member): StoredDefinition => ({ id: member.definitionId, definition: member.definition }))
  });
}

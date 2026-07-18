import { GameStateSchema, type GameState, type StoredDefinition } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * Three level-7 example player characters — a self-sufficient adventuring party that exercises every
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

/** Borin Stoneguard — Fighter (Champion) 7, dwarf. Front-line guardian: two attacks, self-heal, action surge. */
const BORIN: ActorDefinition = {
  ...CHARACTER,
  source: { ...SOURCE, externalId: "example-pc-borin" },
  name: "Borin Stoneguard",
  summary: "Level 7 dwarf Champion fighter — the party's shield wall.",
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

/** Mirena Dawnbright — Cleric (Life Domain) 7, human. Healer and controller: big heals, radiant damage, save spells. */
const MIRENA: ActorDefinition = {
  ...CHARACTER,
  source: { ...SOURCE, externalId: "example-pc-mirena" },
  name: "Mirena Dawnbright",
  summary: "Level 7 human Life Domain cleric — keeps the party standing.",
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
  extensions: { "open5e.srd-2024": {
    type: "Cleric 7 (human)", alignment: "Lawful Good", armorDetail: "chain mail, shield",
    passivePerception: 14, languages: "Common, Celestial",
    savingThrows: { str: 2, dex: 0, con: 2, int: 0, wis: 7, cha: 4 },
    traits: [
      { name: "Spellcasting", description: "Wisdom caster — spell save **DC 15**, spell attack **+7**. Slots: 4 x 1st, 3 x 2nd, 3 x 3rd, 1 x 4th." },
      { name: "Channel Divinity (2 per rest)", description: "Turn Undead, or **Preserve Life** — restore up to 35 hit points, divided among creatures within 30 ft (no more than half a creature's max each)." },
      { name: "Disciple of Life", description: "Whenever a spell of level 1+ restores hit points, the target regains an extra 2 + the spell's level HP." },
      { name: "Blessed Healer", description: "When one of her spells heals another creature, Mirena also regains 2 + the spell's level HP." }
    ]
  } }
};

/** Lyra Emberwise — Wizard (Evoker) 7, high elf. Artillery: Fireball, Fire Bolt, Scorching Ray, Shield reaction. */
const LYRA: ActorDefinition = {
  ...CHARACTER,
  source: { ...SOURCE, externalId: "example-pc-lyra" },
  name: "Lyra Emberwise",
  summary: "Level 7 high-elf Evoker wizard — area damage and burst.",
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
  extensions: { "open5e.srd-2024": {
    type: "Wizard 7 (elf)", alignment: "Neutral Good", armorDetail: "Mage Armor",
    senses: ["Darkvision 60 ft."], passivePerception: 14, languages: "Common, Elvish, Draconic",
    savingThrows: { str: -1, dex: 2, con: 2, int: 7, wis: 4, cha: 0 },
    traits: [
      { name: "Spellcasting", description: "Intelligence caster — spell save **DC 15**, spell attack **+7**. Slots: 4 x 1st, 3 x 2nd, 3 x 3rd, 1 x 4th." },
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

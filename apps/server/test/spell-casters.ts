import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { spellCastMechanics } from "../src/item-actions.js";

/**
 * Built SRD casters for the spellcasting tests, in a fight with two foes: a Wizard 5 (Evoker), a Warlock 5 (Fiend),
 * a Cleric 5 (Life) and a Fighter 5. Each test gets a fresh state; dice are a queue of faces, then 3s.
 */

export const view = new ContentLibrary().forAudience("gm");
export const catalog = equipmentCatalogOf(view);
const POLICY = BuilderPolicySchema.parse({});

export const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
export const FOE = "10000000-0000-4000-8000-000000000002";
export const FOE2 = "10000000-0000-4000-8000-000000000003";
export const ALLY = "10000000-0000-4000-8000-000000000004";

const shared = [
  { level: 1, kind: "language", id: "dwarvish" },
  { level: 1, kind: "language", id: "giant" }
];

export const wizardInput = (spells: readonly string[], cantrips: readonly string[] = []) =>
  ({
    name: "Ansel",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "wizard",
    level: 5,
    subclassId: "evoker",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "int", amount: 2 },
      { ability: "wis", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      ...shared,
      { level: 1, classId: "wizard", kind: "skill", id: "arcana" },
      { level: 1, classId: "wizard", kind: "skill", id: "investigation" },
      { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-cleric" } },
      { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
      { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
      { level: 3, kind: "spell", id: "burning-hands", payload: { featureId: "evocation-savant" } },
      { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
      { level: 4, classId: "wizard", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "int", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "int", payload: { featureId: "ability-score-improvement" } },
      ...["fire-bolt", "ray-of-frost", "mage-hand", "shocking-grasp", ...cantrips]
        .slice(0, 4)
        .map((id) => ({ level: 1, classId: "wizard", kind: "cantrip", id })),
      ...spells.map((id) => ({ level: 1, classId: "wizard", kind: "spell", id })),
      { level: 1, kind: "equipment", id: "wizard-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" }
    ]
  }) as CharacterCreateRequestInput;

export const WIZARD_SPELLS = [
  "magic-missile",
  "scorching-ray",
  "shield",
  "fireball",
  "hold-person",
  "misty-step",
  "alarm",
  "sleep",
  "thunderwave"
] as const;

export const warlockInput = (spells: readonly string[]) =>
  ({
    name: "Vex",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "warlock",
    level: 5,
    subclassId: "fiend-patron",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "con", amount: 2 },
      { ability: "dex", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      ...shared,
      { level: 1, kind: "skill", id: "acrobatics", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "size", id: "small" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
      { level: 1, classId: "warlock", kind: "skill", id: "deception" },
      {
        level: 1,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "agonizing-blast",
        payload: { featureId: "eldritch-invocations" }
      },
      { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "agonizing-blast" } },
      {
        level: 2,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "devils-sight",
        payload: { featureId: "eldritch-invocations" }
      },
      {
        level: 2,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "eldritch-mind",
        payload: { featureId: "eldritch-invocations" }
      },
      {
        level: 5,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "eldritch-spear",
        payload: { featureId: "eldritch-invocations" }
      },
      { level: 5, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "eldritch-spear" } },
      {
        level: 5,
        classId: "warlock",
        kind: "eldritch-invocation",
        id: "repelling-blast",
        payload: { featureId: "eldritch-invocations" }
      },
      { level: 5, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "repelling-blast" } },
      {
        level: 3,
        classId: "warlock",
        kind: "subclass",
        id: "fiend-patron",
        payload: { featureId: "warlock-subclass" }
      },
      {
        level: 4,
        classId: "warlock",
        kind: "asi-or-feat",
        id: "ability-score-improvement",
        payload: { featureId: "ability-score-improvement" }
      },
      {
        level: 4,
        classId: "warlock",
        kind: "ability-score",
        id: "str",
        payload: { featureId: "ability-score-improvement" }
      },
      {
        level: 4,
        classId: "warlock",
        kind: "ability-score",
        id: "dex",
        payload: { featureId: "ability-score-improvement" }
      },
      { level: 1, classId: "warlock", kind: "cantrip", id: "chill-touch" },
      { level: 1, classId: "warlock", kind: "cantrip", id: "eldritch-blast" },
      { level: 1, classId: "warlock", kind: "cantrip", id: "mage-hand" },
      ...spells.map((id) => ({ level: 1, classId: "warlock", kind: "spell", id })),
      { level: 1, classId: "warlock", kind: "equipment", id: "warlock-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

export const clericInput = (spells: readonly string[]) =>
  ({
    name: "Mira",
    speciesId: "human",
    backgroundId: "sage",
    classId: "cleric",
    level: 5,
    subclassId: "life-domain",
    abilityMethod: "standard-array",
    baseScores: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      ...shared,
      { level: 1, classId: "cleric", kind: "skill", id: "medicine" },
      { level: 1, classId: "cleric", kind: "skill", id: "religion" },
      { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, classId: "cleric", kind: "divine-order", id: "protector", payload: { featureId: "divine-order" } },
      { level: 3, classId: "cleric", kind: "subclass", id: "life-domain" },
      { level: 4, classId: "cleric", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "wis", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "wis", payload: { featureId: "ability-score-improvement" } },
      ...["sacred-flame", "guidance", "thaumaturgy", "spare-the-dying"].map((id) => ({
        level: 1,
        classId: "cleric",
        kind: "cantrip",
        id
      })),
      ...spells.map((id) => ({ level: 1, classId: "cleric", kind: "spell", id })),
      { level: 1, kind: "equipment", id: "cleric-a" },
      { level: 1, kind: "equipment", id: "sage-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Fighter 5 (Extra Attack) with Fire Bolt and Magic Missile from Magic Initiate (Wizard). */
export const fighterInput = () =>
  ({
    name: "Borin",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "fighter",
    level: 5,
    subclassId: "champion",
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      ...shared,
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "magic-initiate-wizard", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "fire-bolt", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "ray-of-frost", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
      { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
      { level: 4, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A level-5 Human Sage Druid (Circle of the Land): Produce Flame and the spells given. */
export const druidInput = (spells: readonly string[]) =>
  ({
    name: "Maelin",
    speciesId: "human",
    backgroundId: "sage",
    classId: "druid",
    level: 5,
    subclassId: "circle-of-the-land",
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      ...shared,
      { level: 1, classId: "druid", kind: "skill", id: "nature" },
      { level: 1, classId: "druid", kind: "skill", id: "perception" },
      { level: 1, classId: "druid", kind: "primal-order", id: "warden", payload: { featureId: "primal-order" } },
      { level: 1, kind: "cantrip", id: "druidcraft" },
      { level: 1, kind: "cantrip", id: "produce-flame" },
      { level: 4, kind: "cantrip", id: "guidance" },
      ...spells.map((id) => ({ level: 1, kind: "spell", id })),
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-wizard" } },
      { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
      { level: 3, kind: "land", id: "polar", payload: { featureId: "circle-of-the-land-spells" } },
      { level: 4, classId: "druid", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "wis", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "wis", payload: { featureId: "ability-score-improvement" } },
      { level: 1, kind: "equipment", id: "druid-a" },
      { level: 1, kind: "equipment", id: "sage-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Bard 5 (College of Lore) with Vicious Mockery among its cantrips. */
export const bardInput = (spells: readonly string[]) =>
  ({
    name: "Ysolde",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "bard",
    level: 5,
    subclassId: "college-of-lore",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "cha", amount: 2 },
      { ability: "wis", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      ...shared,
      { level: 1, classId: "bard", kind: "skill", id: "performance" },
      { level: 1, classId: "bard", kind: "skill", id: "persuasion" },
      { level: 1, classId: "bard", kind: "skill", id: "deception" },
      { level: 1, classId: "bard", kind: "tool", id: "instrument-lute" },
      { level: 1, classId: "bard", kind: "tool", id: "instrument-flute" },
      { level: 1, classId: "bard", kind: "tool", id: "instrument-drum" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, classId: "bard", kind: "cantrip", id: "vicious-mockery" },
      { level: 1, classId: "bard", kind: "cantrip", id: "mage-hand" },
      ...spells.map((id) => ({ level: 1, classId: "bard", kind: "spell", id })),
      { level: 2, classId: "bard", kind: "expertise", id: "performance", payload: { featureId: "expertise" } },
      { level: 2, classId: "bard", kind: "expertise", id: "persuasion", payload: { featureId: "expertise" } },
      { level: 3, classId: "bard", kind: "subclass", id: "college-of-lore" },
      { level: 3, kind: "skill", id: "arcana", payload: { featureId: "bonus-proficiencies" } },
      { level: 3, kind: "skill", id: "history", payload: { featureId: "bonus-proficiencies" } },
      { level: 3, kind: "skill", id: "nature", payload: { featureId: "bonus-proficiencies" } },
      { level: 4, classId: "bard", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "cha", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "cha", payload: { featureId: "ability-score-improvement" } },
      { level: 1, kind: "equipment", id: "bard-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A spell's cast as a plain action at fixed numbers (attack +7, DC 15, modifier +3), with no spell id, so a test needs
 *  no caster of its level and no slot. */
export function castOf(spellId: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  return {
    id: `test-${spellId}`,
    name: spell.name,
    activation: "action",
    description: spell.description,
    ...spellCastMechanics(spell, { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 3 })
  } as ActorAction;
}

export const build = (input: CharacterCreateRequestInput): ActorDefinition =>
  buildCharacterDefinition(input, view, POLICY);

export type Fight = Readonly<{
  state: GameState;
  definition: ActorDefinition;
  hero: GameState["actors"][number];
  action: (id: string) => ActorAction;
  resolve: (
    actionId: string,
    input: Partial<ResolveInput>,
    faces?: number[]
  ) => ReturnType<typeof resolveDefinitionAction>;
}>;

/** The hero in a fight with two 200-HP foes (AC 12) and, optionally, an ally; `distance` is every pair's map distance. */
export function fight(
  definition: ActorDefinition,
  options: Readonly<{ distance?: number | null; combat?: boolean; ally?: boolean }> = {}
): Fight {
  const foe = (id: string, name: string, kind = "monster") => ({
    id,
    name,
    kind,
    visibility: "public",
    hp: { current: 200, maximum: 200 },
    armorClass: 12
  });
  const others = [foe(FOE, "Goblin"), foe(FOE2, "Orc"), ...(options.ally ? [foe(ALLY, "Bran", "npc")] : [])];
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: others });
  importActorDefinition(state, definition, HERO, "public", catalog);
  const hero = state.actors.find((actor) => actor.id === HERO)!;
  if (options.combat !== false)
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: HERO, score: 20 },
          ...others.map((entry, index) => ({ actorId: entry.id, score: 10 - index }))
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
  let rollId = 0;
  const action = (id: string) => {
    const found = effectiveActions(definition, hero, catalog).find((entry) => entry.id === id);
    if (!found) throw new Error(`No action ${id}`);
    return found;
  };
  const distance = options.distance ?? null;
  const resolve = (actionId: string, input: Partial<ResolveInput>, faces: number[] = []) =>
    resolveDefinitionAction(
      state,
      action(actionId),
      { actorId: HERO, targetIds: [FOE], commandId: `cmd-${(rollId += 1)}`, ...input },
      {
        random: () => faces.shift() ?? 3,
        newRollId: () => `40000000-0000-4000-8000-${String((rollId += 1)).padStart(12, "0")}`,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-16T00:00:00.000Z",
        definition,
        catalog,
        resolveDefinition: () => undefined,
        ...(distance === null ? {} : { distanceFeet: () => distance })
      }
    );
  return { state, definition, hero, action, resolve };
}

/** Advances the initiative until it is the hero's turn again (the next round). */
export function heroTurnAgain(state: GameState): void {
  for (let step = 0; step < 10; step += 1) {
    nextInitiativeTurn(state);
    if (state.combat.turnActorId === HERO) return;
  }
  throw new Error("The hero never came up again.");
}

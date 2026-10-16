import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";

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

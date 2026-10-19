import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies, type ResolveInput } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave } from "../src/saving-throws.js";

// The Cleric's Channel Divinity and Blessed Strikes against real Undead: Turn Undead's turning and what ends it, Sear
// Undead's Radiant dice, and Improved Potent Spellcasting's Temporary Hit Points. Built through the real builder.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});

const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const ZOMBIE = "10000000-0000-4000-8000-0000000000e1";
const ZOMBIE2 = "10000000-0000-4000-8000-0000000000e2";
const ALLY = "10000000-0000-4000-8000-0000000000e3";
const GM = { role: "gm" } as const;

type Row = CharacterCreateRequestInput["choices"][number];

const asi = (level: number, first: string, second: string): Row[] =>
  [
    { level, classId: "cleric", kind: "asi-or-feat", id: "ability-score-improvement" },
    { level, kind: "ability-score", id: first, payload: { featureId: "ability-score-improvement" } },
    { level, kind: "ability-score", id: second, payload: { featureId: "ability-score-improvement" } }
  ] as Row[];

/** A Human Sage Life Cleric. Wisdom 15 + 2 (Sage) + 2 (level 4) = 19, a +4 modifier; level 8 makes it 20 (+5). */
const clericInput = (level: number, blessed: "divine-strike" | "potent-spellcasting" = "potent-spellcasting") =>
  ({
    name: "Mira",
    speciesId: "human",
    backgroundId: "sage",
    classId: "cleric",
    level,
    subclassId: "life-domain",
    abilityMethod: "standard-array",
    baseScores: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
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
      ...(level >= 4 ? asi(4, "wis", "wis") : []),
      ...(level >= 7
        ? ([{ level: 7, kind: "blessed-strikes", id: blessed, payload: { featureId: "blessed-strikes" } }] as Row[])
        : []),
      ...(level >= 8 ? asi(8, "wis", "con") : []),
      ...(level >= 12 ? asi(12, "con", "str") : []),
      ...["sacred-flame", "guidance", "thaumaturgy"].map((id) => ({
        level: 1,
        classId: "cleric",
        kind: "cantrip",
        id
      })),
      { level: 1, kind: "equipment", id: "cleric-a" },
      { level: 1, kind: "equipment", id: "sage-a" }
    ]
  }) as CharacterCreateRequestInput;

type Table = Readonly<{
  state: GameState;
  definition: ActorDefinition;
  deps: (faces?: number[]) => ResolveDependencies;
}>;

/** The Cleric, two Zombies and an ally in a fight, the Cleric first. `distance` is every pair's map distance. */
function table(
  level: number,
  options: Readonly<{ distance?: number; near?: string; blessed?: "potent-spellcasting" | "divine-strike" }> = {}
): Table {
  const definition = buildCharacterDefinition(clericInput(level, options.blessed), library, policy);
  const zombie = library.monster("zombie")!;
  const undead = (id: string, name: string) => ({
    id,
    name,
    kind: "monster",
    visibility: "public",
    hp: { current: 60, maximum: 60 },
    armorClass: 8,
    definitionId: "zombie"
  });
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      undead(ZOMBIE, "Zombie"),
      undead(ZOMBIE2, "Zombie 2"),
      { id: ALLY, name: "Bran", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
    ],
    definitions: [{ id: "zombie", definition: zombie }]
  }) as GameState;
  importActorDefinition(state, definition, HERO, "public", catalog);
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: ZOMBIE, score: 10 },
        { actorId: ZOMBIE2, score: 9 },
        { actorId: ALLY, score: 8 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  let roll = 0;
  const resolveDefinition = (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;
  const deps = (faces: number[] = []): ResolveDependencies => ({
    random: () => faces.shift() ?? 4,
    newRollId: () => `40000000-0000-4000-8000-${String((roll += 1)).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-19T00:00:00.000Z",
    definition,
    catalog,
    resolveDefinition,
    ...(options.distance !== undefined
      ? {
          distanceFeet: (a: string, b: string) =>
            options.near !== undefined && (a === options.near || b === options.near) ? 20 : options.distance!
        }
      : {})
  });
  return { state, definition, deps };
}

let command = 0;
const nextCommand = () => `50000000-0000-4000-8000-${String((command += 1)).padStart(12, "0")}`;

function use(built: Table, actionId: string, input: Partial<ResolveInput>, faces: number[] = []) {
  const hero = built.state.actors.find((actor) => actor.id === HERO)!;
  const action = effectiveActions(built.definition, hero, catalog).find((entry) => entry.id === actionId);
  if (!action) throw new Error(`No action ${actionId}`);
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: HERO, targetIds: [], commandId: nextCommand(), ...input },
    built.deps(faces)
  );
}

/** Answers every save the creature owes at `total`, as the GM. */
function saveAt(built: Table, targetId: string, total: number) {
  for (const pending of built.state.combat.pendingSaves.filter((save) => save.targetActorId === targetId))
    answerSave(built.state, nextCommand(), pending.id, "manual", total, true, GM, {
      random: () => 4,
      newRollId: () => `40000000-0000-4000-8000-${String((command += 1)).padStart(12, "0")}`,
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-19T00:00:00.000Z",
      resolveDefinition: (id) => built.state.definitions.find((entry) => entry.id === id)?.definition,
      catalog
    });
}

const actorOf = (built: Table, id: string) => built.state.actors.find((actor) => actor.id === id)!;
const turned = (built: Table, id: string) =>
  actorOf(built, id).effects.some((effect) => effect.linkedConditionIds.includes("incapacitated"));

describe("Turn Undead ends with its Cleric", () => {
  it("ends the turning on every Undead when the Cleric is Incapacitated", () => {
    const built = table(5);
    use(built, "turn-undead", { targetIds: [ZOMBIE, ZOMBIE2] });
    saveAt(built, ZOMBIE, 1);
    saveAt(built, ZOMBIE2, 1);
    expect(turned(built, ZOMBIE) && turned(built, ZOMBIE2)).toBe(true);
    setCondition(built.state, HERO, "stunned", true, undefined, GM);
    expect(turned(built, ZOMBIE) || turned(built, ZOMBIE2)).toBe(false);
  });

  it("ends the turning when the Cleric drops to 0 Hit Points", () => {
    const built = table(5);
    use(built, "turn-undead", { targetIds: [ZOMBIE] });
    saveAt(built, ZOMBIE, 1);
    applyDamageDetailed(built.state, HERO, { amount: 500 }, GM);
    expect(turned(built, ZOMBIE)).toBe(false);
  });
});

describe("Improved Potent Spellcasting: Temporary Hit Points when a Cleric cantrip deals damage", () => {
  // Cleric 14, Wisdom 20 (+5): twice the modifier is 10.
  it("gives the ally picked within 60 feet 10 Temporary Hit Points once Sacred Flame's damage lands", () => {
    const built = table(14, { distance: 30 });
    use(built, "spell-sacred-flame", { targetIds: [ZOMBIE], vitalityTo: ALLY }, [4, 4, 4]);
    expect(actorOf(built, ALLY).hp.temporary).toBe(0);
    saveAt(built, ZOMBIE, 1);
    expect(actorOf(built, ALLY).hp.temporary).toBe(10);
  });

  it("gives the Cleric itself the Temporary Hit Points when no one is picked, and none on a successful save", () => {
    const built = table(14);
    use(built, "spell-sacred-flame", { targetIds: [ZOMBIE] }, [4, 4, 4]);
    saveAt(built, ZOMBIE, 1);
    expect(actorOf(built, HERO).hp.temporary).toBe(10);
    const saved = table(14);
    use(saved, "spell-sacred-flame", { targetIds: [ZOMBIE] }, [4, 4, 4]);
    saveAt(saved, ZOMBIE, 30);
    expect(actorOf(saved, HERO).hp.temporary).toBe(0);
  });

  it("refuses a creature beyond 60 feet, and gives a Divine Strike Cleric nothing", () => {
    // Every creature 70 feet from the Cleric but the Zombie, 20 feet away.
    const far = table(14, { distance: 70, near: ZOMBIE });
    expect(() => use(far, "spell-sacred-flame", { targetIds: [ZOMBIE], vitalityTo: ALLY }, [4, 4, 4])).toThrowError(
      /Bran is more than 60 feet from Mira/
    );
    const striker = table(14, { blessed: "divine-strike" });
    const flame = effectiveActions(striker.definition, actorOf(striker, HERO), catalog).find(
      (entry) => entry.id === "spell-sacred-flame"
    );
    expect(flame?.vitality).toBeUndefined();
  });
});

describe("Sear Undead: Radiant dice by the Wisdom modifier on Turn Undead's failure", () => {
  it("deals 4d8 Radiant to the Undead that fails and none to the one that succeeds, and the turning holds", () => {
    const built = table(5);
    const action = effectiveActions(built.definition, actorOf(built, HERO), catalog).find(
      (entry) => entry.id === "turn-undead"
    )!;
    expect(action.damage).toEqual([{ formula: "4d8", type: "radiant" }]);
    use(built, "turn-undead", { targetIds: [ZOMBIE, ZOMBIE2] }, [5, 5, 5, 5]);
    saveAt(built, ZOMBIE, 1);
    saveAt(built, ZOMBIE2, 30);
    expect(actorOf(built, ZOMBIE).hp.current).toBe(40);
    expect(actorOf(built, ZOMBIE2).hp.current).toBe(60);
    expect(turned(built, ZOMBIE)).toBe(true);
    expect(turned(built, ZOMBIE2)).toBe(false);
  });

  it("counts the modifier at the Cleric's own score, and a Cleric 4 deals none", () => {
    expect(
      effectiveActions(
        buildCharacterDefinition(clericInput(8), library, policy),
        actorOf(table(8), HERO),
        catalog
      ).find((entry) => entry.id === "turn-undead")!.damage
    ).toEqual([{ formula: "5d8", type: "radiant" }]);
    const fourth = table(4);
    expect(
      effectiveActions(fourth.definition, actorOf(fourth, HERO), catalog).find((entry) => entry.id === "turn-undead")!
        .damage
    ).toEqual([]);
  });
});

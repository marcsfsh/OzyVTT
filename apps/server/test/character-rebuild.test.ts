import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import {
  buildCharacterDefinition,
  hitPointRollRows,
  storedHitPointRolls,
  type CharacterCreateRequestInput
} from "../src/character-build.js";
import { importActorDefinition, rebuildActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { createScene } from "../src/scenes.js";
import { startEncounter } from "../src/encounter.js";
import { setInventoryItem } from "../src/inventory.js";
import { InventoryItemSchema } from "@vtt/schemas";

// Level up, level down and respec. A character rebuilt 5 -> 3 -> 5 must come back to the same
// maximum hit points, which works because the build records the hit-point rolls.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const MAP_ID = "20000000-0000-5000-8000-000000000001";
const SCENE_ID = "40000000-0000-4000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const fighter = (over: Partial<CharacterCreateRequestInput> = {}): CharacterCreateRequestInput => ({
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
  hp: { mode: "entries", entries: [1, 10, 4, 6] },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "survival" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
    { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
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
  ],
  ...over
});

// The client's prefill: the wizard supplies the choices for every level up to the target, and the
// hit-point dice come from the sheet's recorded rolls, the half a player cannot re-answer.
function prefillFor(
  built: { character?: { choices?: readonly { level: number; kind: string }[] } },
  level: number,
  base: CharacterCreateRequestInput
): CharacterCreateRequestInput {
  const rolls = storedHitPointRolls((built.character?.choices ?? []) as never, level);
  return {
    ...base,
    level,
    choices: base.choices.filter((row) => row.level <= level),
    hp: rolls ? { mode: "entries", entries: rolls } : { mode: "average" }
  };
}

function tableWith(level = 5) {
  const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
  const definition = buildCharacterDefinition(
    fighter({
      level,
      ...(level < 5 ? { choices: fighter().choices.filter((row) => row.level <= level) } : {}),
      hp: { mode: "entries", entries: fighter().hp.entries!.slice(0, level - 1) }
    }),
    library,
    policy
  );
  importActorDefinition(state, definition, ACTOR_ID, "public");
  return { state, definition };
}

describe("the app remembers hit-point rolls", () => {
  it("writes one ledger row per rolled level, and reads them back for a rebuild", () => {
    const { definition } = tableWith();
    const rows = (definition.character?.choices ?? []).filter((row) => row.kind === "hp-roll");
    expect(rows).toEqual([
      { level: 2, kind: "hp-roll", id: "hp", payload: { roll: 1 } },
      { level: 3, kind: "hp-roll", id: "hp", payload: { roll: 10 } },
      { level: 4, kind: "hp-roll", id: "hp", payload: { roll: 4 } },
      { level: 5, kind: "hp-roll", id: "hp", payload: { roll: 6 } }
    ]);
    expect(storedHitPointRolls(definition.character!.choices!, 5)).toEqual([1, 10, 4, 6]);
    expect(storedHitPointRolls(definition.character!.choices!, 3)).toEqual([1, 10]);
    // A sheet with no recorded rolls (a PDF import, or an older build) returns null.
    expect(storedHitPointRolls([], 3)).toBeNull();
    // Re-running a build over its own prefill must not double the rows.
    expect(hitPointRollRows({ hp: { mode: "average" }, choices: [] })).toEqual([]);
  });

  it("round-trips level 5 -> 3 -> 5 back to the exact same maximum", () => {
    const { state, definition } = tableWith();
    const startingMaximum = state.actors[0].hp.maximum;
    expect(definition.hitPoints.maximum).toBe(startingMaximum);

    const downInput = prefillFor(definition, 3, fighter());
    const down = buildCharacterDefinition(downInput, library, policy);
    rebuildActorDefinition(state, ACTOR_ID, down);
    expect(state.actors[0].hp.maximum).toBe(down.hitPoints.maximum);
    expect(state.actors[0].hp.maximum).toBeLessThan(startingMaximum);

    // The client prefills from the stored sheet, which holds the recorded rolls.
    const stored = state.definitions.find((entry) => entry.id === `import-${ACTOR_ID}`)!.definition;
    const upInput = prefillFor(stored, 5, fighter());
    // The rolls came back out of the ledger. The request the client happened to send has no say.
    expect(upInput.hp).toEqual({ mode: "entries", entries: [1, 10, 4, 6] });
    const up = buildCharacterDefinition(upInput, library, policy);
    rebuildActorDefinition(state, ACTOR_ID, up);
    expect(state.actors[0].hp.maximum).toBe(startingMaximum);
  });

  it("falls back to the average for a character whose rolls were never recorded", () => {
    const { state } = tableWith();
    // A PDF import or older sheet: no `hp-roll` rows, so the prefill has no dice to reuse.
    const noLedger = prefillFor({ character: { choices: fighter().choices } }, 4, fighter());
    expect(noLedger.hp).toEqual({ mode: "average" });
    const built = buildCharacterDefinition(noLedger, library, policy);
    rebuildActorDefinition(state, ACTOR_ID, built);
    // Known limitation: the floor is max(roll, average), so an old rolled character can come back with
    // fewer maximum hit points. No dice are invented.
    expect(state.actors[0].hp.maximum).toBe(built.hitPoints.maximum);
  });
});

describe("rebuilding a live character", () => {
  it("keeps what the campaign wrote and what has been spent, and recomputes what the level redefines", () => {
    const { state, definition } = tableWith();
    const actor = state.actors[0];
    actor.ownerSessionId = "30000000-0000-4000-8000-000000000001";
    actor.tokenAssetId = "10000000-0000-5000-8000-000000000009";
    actor.conditions = [{ id: "prone" }];
    actor.notes = "Owes the innkeeper 40gp";
    actor.currency = { cp: 0, sp: 0, ep: 0, gp: 77, pp: 0 };
    actor.actionUses = { "second-wind": 1 };
    setInventoryItem(
      state,
      ACTOR_ID,
      InventoryItemSchema.parse({ id: "trophy", name: "Owlbear Skull", quantity: 1 }),
      () => definition
    );
    const damaged = definition.hitPoints.maximum - 7;
    actor.hp = { current: damaged, maximum: definition.hitPoints.maximum, temporary: 0 };

    const built = buildCharacterDefinition(prefillFor(definition, 4, fighter()), library, policy);
    rebuildActorDefinition(state, ACTOR_ID, built);

    // Kept: claim, token, conditions, notes, currency, inventory.
    expect(actor.ownerSessionId).toBe("30000000-0000-4000-8000-000000000001");
    expect(actor.tokenAssetId).toBe("10000000-0000-5000-8000-000000000009");
    expect(actor.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(actor.notes).toBe("Owes the innkeeper 40gp");
    expect(actor.currency.gp).toBe(77);
    expect(actor.inventory.some((item) => item.id === "trophy")).toBe(true);
    // A level is not a rest: the spent Second Wind stays spent, and the new Hit Dice pool keeps none spent.
    expect(actor.actionUses).toEqual({ "second-wind": 1 });
    expect(actor.hitDice!.entries[0].remaining).toBe(actor.hitDice!.entries[0].maximum);
    // HP: the delta rides along, so a level-down clamps and a level-up arrives as usable hit points.
    expect(actor.hp.maximum).toBe(built.hitPoints.maximum);
    expect(actor.hp.current).toBe(Math.max(0, built.hitPoints.maximum - 7));
    // And the stored sheet is the new one, under the same import key.
    expect(state.definitions.find((entry) => entry.id === `import-${ACTOR_ID}`)!.definition.hitPoints.maximum).toBe(
      built.hitPoints.maximum
    );
    expect(state.definitions).toHaveLength(1);
  });

  it("refuses mid-fight, in a paused scene's fight, and while reviewing history", () => {
    const { state, definition } = tableWith();
    const built = buildCharacterDefinition(prefillFor(definition, 4, fighter()), library, policy);

    startEncounter(state, { mapAssetId: MAP_ID, entries: [{ actorId: ACTOR_ID, score: 20 }] }, () => 1, GEOMETRY);
    expect(() => rebuildActorDefinition(state, ACTOR_ID, built)).toThrow(/End the encounter/i);

    // Park that fight into a scene: it is paused and unfinished, and still owns this character's economy.
    createScene(state, { sceneId: SCENE_ID, name: "Ambush", mapAssetId: MAP_ID, combatantIds: [] }, GEOMETRY);
    state.combat = {
      ...state.combat,
      scenes: state.combat.scenes.map((scene) => ({
        ...scene,
        combat: { ...scene.combat, active: true, initiative: [{ actorId: ACTOR_ID, score: 10, tieBreaker: 0 }] }
      })),
      active: false,
      initiative: []
    };
    expect(() => rebuildActorDefinition(state, ACTOR_ID, built)).toThrow(/paused encounter/i);

    state.combat = { ...state.combat, scenes: [], historyCursor: 3 };
    expect(() => rebuildActorDefinition(state, ACTOR_ID, built)).toThrow(/reviewing the combat history/i);
  });

  it("refuses a character that was not built here", () => {
    const { state, definition } = tableWith();
    state.actors[0].definitionId = "bundled-goblin";
    const built = buildCharacterDefinition(prefillFor(definition, 4, fighter()), library, policy);
    expect(() => rebuildActorDefinition(state, ACTOR_ID, built)).toThrow(/can't be rebuilt/i);
  });
});

describe("a level is not a rest", () => {
  /** A level-2 Wizard (slots 3 at level 1) on the table, to level up to 3 (4 + 2). */
  const wizard = (level: number): CharacterCreateRequestInput => ({
    name: "Ilyana",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "wizard",
    level,
    ...(level >= 3 ? { subclassId: "evoker" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "wizard", kind: "skill", id: "arcana" },
      { level: 1, classId: "wizard", kind: "skill", id: "insight" },
      { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 2, classId: "wizard", kind: "expertise", id: "arcana", payload: { featureId: "scholar" } },
      ...(level >= 3
        ? [
            { level: 3, classId: "wizard", kind: "subclass", id: "evoker" },
            { level: 3, kind: "spell", id: "shatter", payload: { featureId: "evocation-savant" } },
            { level: 3, kind: "spell", id: "magic-missile", payload: { featureId: "evocation-savant" } },
            { level: 3, kind: "spell", id: "misty-step" }
          ]
        : []),
      { level: 1, kind: "cantrip", id: "fire-bolt" },
      { level: 1, kind: "cantrip", id: "light" },
      { level: 1, kind: "cantrip", id: "mage-hand" },
      { level: 1, kind: "spell", id: "mage-armor" },
      { level: 1, kind: "spell", id: "shield" },
      { level: 1, kind: "spell", id: "sleep" },
      { level: 1, kind: "spell", id: "detect-magic" },
      { level: 1, kind: "spell", id: "burning-hands" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "wizard-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  });

  it("keeps spent uses, Hit Dice and spell slots spent against the new maxima", () => {
    const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, buildCharacterDefinition(wizard(2), library, policy), ACTOR_ID, "public");
    const actor = state.actors[0];
    expect(actor.spellSlots).toEqual([{ level: 1, remaining: 3 }]);
    actor.spellSlots = [{ level: 1, remaining: 1 }];
    actor.hitDice = { ...actor.hitDice!, entries: actor.hitDice!.entries.map((entry) => ({ ...entry, remaining: 0 })) };
    actor.actionUses = { "arcane-recovery": 1, overchannel: 1 };

    rebuildActorDefinition(state, ACTOR_ID, buildCharacterDefinition(wizard(3), library, policy));
    // Level 3 slots are 4 + 2: the two spent level-1 slots stay spent, the new level-2 slots arrive whole.
    expect(actor.spellSlots).toEqual([
      { level: 1, remaining: 2 },
      { level: 2, remaining: 2 }
    ]);
    // Two Hit Dice were spent and a third arrives with the level.
    expect(actor.hitDice!.entries).toEqual([expect.objectContaining({ die: "d6", maximum: 3, remaining: 1 })]);
    // Arcane Recovery stays used, and a counter a rule keeps outside any pool is kept as it stands.
    expect(actor.actionUses).toEqual({ "arcane-recovery": 1, overchannel: 1 });
  });

  it("drops the spent count of a pool the new sheet no longer has", () => {
    const { state, definition } = tableWith();
    const actor = state.actors[0];
    actor.actionUses = { "second-wind": 1, "action-surge": 1 };
    const levelOne = prefillFor(definition, 1, fighter({ subclassId: undefined }));
    rebuildActorDefinition(state, ACTOR_ID, buildCharacterDefinition(levelOne, library, policy));
    expect(actor.actionUses).toEqual({ "second-wind": 1 });
  });

  it("leaves a character at 0 hit points at 0, dying or dead", () => {
    const { state, definition } = tableWith(4);
    const actor = state.actors[0];
    actor.hp = { current: 0, maximum: actor.hp.maximum, temporary: 0 };
    actor.deathSaves = { successes: 0, failures: 3, stable: false };
    actor.conditions = [{ id: "unconscious" }];

    rebuildActorDefinition(
      state,
      ACTOR_ID,
      buildCharacterDefinition(prefillFor(definition, 5, fighter()), library, policy)
    );
    expect(actor.hp.current).toBe(0);
    expect(actor.hp.maximum).toBeGreaterThan(0);
    expect(actor.deathSaves).toEqual({ successes: 0, failures: 3, stable: false });
  });
});

describe("a sheet with more classes than the build", () => {
  it("is refused rather than rebuilt without them", () => {
    const { state, definition } = tableWith(4);
    const stored = state.definitions[0].definition;
    stored.character!.classes = [
      ...stored.character!.classes,
      { id: "wizard", name: "Wizard", level: 1, hitDie: "d6" }
    ];
    const built = buildCharacterDefinition(prefillFor(definition, 5, fighter()), library, policy);
    expect(() => rebuildActorDefinition(state, ACTOR_ID, built)).toThrow(/more classes than this build carries/);
  });
});

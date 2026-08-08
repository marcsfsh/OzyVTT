import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { buildCharacterDefinition, hitPointRollRows, storedHitPointRolls, type CharacterCreateRequestInput } from "../src/character-build.js";
import { importActorDefinition, rebuildActorDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { createScene } from "../src/scenes.js";
import { startEncounter } from "../src/encounter.js";
import { setInventoryItem } from "../src/inventory.js";
import { InventoryItemSchema } from "@vtt/schemas";

/**
 * D13/D14 - LEVEL UP, LEVEL DOWN, RESPEC, and the hit-point rolls the app now remembers.
 *
 * The round trip is the point: a character rebuilt 5 -> 3 -> 5 has to come back to the SAME maximum
 * hit points it started with. That is only possible because the build records what the dice said,
 * which is the whole of D14 - before it, the rolls were consumed and forgotten and a level-down was
 * a one-way door.
 */

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
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "entries", entries: [1, 10, 4, 6] },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
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

/**
 * The client's prefill: the wizard supplies the CHOICES for every level up to the target (its own
 * answers, re-offered on the way back up), and the hit-point dice come from the sheet's MEMORY - the
 * half a player cannot re-answer, which is exactly what D14 exists to keep.
 */
function prefillFor(built: { character?: { choices?: readonly { level: number; kind: string }[] } }, level: number, base: CharacterCreateRequestInput): CharacterCreateRequestInput {
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
  const definition = buildCharacterDefinition(fighter({ level, ...(level < 5 ? { choices: fighter().choices.filter((row) => row.level <= level) } : {}), hp: { mode: "entries", entries: fighter().hp.entries!.slice(0, level - 1) } }), library, policy);
  importActorDefinition(state, definition, ACTOR_ID, "public");
  return { state, definition };
}

describe("the app remembers hit-point rolls (D14)", () => {
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
    // A sheet with no recorded rolls (a PDF import, anything built before this) answers honestly.
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

    // The client prefills from the STORED sheet, which is where the memory lives.
    const stored = state.definitions.find((entry) => entry.id === `import-${ACTOR_ID}`)!.definition;
    const upInput = prefillFor(stored, 5, fighter());
    // The rolls came back out of the ledger, not out of the request the client happened to send.
    expect(upInput.hp).toEqual({ mode: "entries", entries: [1, 10, 4, 6] });
    const up = buildCharacterDefinition(upInput, library, policy);
    rebuildActorDefinition(state, ACTOR_ID, up);
    expect(state.actors[0].hp.maximum).toBe(startingMaximum);
  });

  it("falls back to the average for a character whose rolls were never recorded", () => {
    const { state } = tableWith();
    // A PDF import or a pre-D14 sheet: no `hp-roll` rows anywhere, so the prefill has no dice to reuse.
    const noLedger = prefillFor({ character: { choices: fighter().choices } }, 4, fighter());
    expect(noLedger.hp).toEqual({ mode: "average" });
    const built = buildCharacterDefinition(noLedger, library, policy);
    rebuildActorDefinition(state, ACTOR_ID, built);
    // Stated honestly rather than papered over: the product floor is max(roll, average), so an old
    // rolled character can come back with fewer maximum hit points. No dice are invented.
    expect(state.actors[0].hp.maximum).toBe(built.hitPoints.maximum);
  });
});

describe("rebuilding a live character", () => {
  it("keeps what the campaign wrote and resets what the level redefines", () => {
    const { state, definition } = tableWith();
    const actor = state.actors[0];
    actor.ownerSessionId = "30000000-0000-4000-8000-000000000001";
    actor.tokenAssetId = "10000000-0000-5000-8000-000000000009";
    actor.conditions = [{ id: "prone" }];
    actor.notes = "Owes the innkeeper 40gp";
    actor.currency = { cp: 0, sp: 0, ep: 0, gp: 77, pp: 0 };
    actor.actionUses = { "second-wind": 1 };
    setInventoryItem(state, ACTOR_ID, InventoryItemSchema.parse({ id: "trophy", name: "Owlbear Skull", quantity: 1 }), () => definition);
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
    // Reset: the per-level resources the new sheet redefines.
    expect(actor.actionUses).toEqual({});
    expect(actor.hitDice!.entries[0].remaining).toBe(actor.hitDice!.entries[0].maximum);
    // HP: the delta rides along, so a level-down clamps and a level-up arrives as usable hit points.
    expect(actor.hp.maximum).toBe(built.hitPoints.maximum);
    expect(actor.hp.current).toBe(Math.max(0, built.hitPoints.maximum - 7));
    // And the stored sheet is the NEW one, under the same import key.
    expect(state.definitions.find((entry) => entry.id === `import-${ACTOR_ID}`)!.definition.hitPoints.maximum).toBe(built.hitPoints.maximum);
    expect(state.definitions).toHaveLength(1);
  });

  it("refuses mid-fight, in a paused scene's fight, and while reviewing history", () => {
    const { state, definition } = tableWith();
    const built = buildCharacterDefinition(prefillFor(definition, 4, fighter()), library, policy);

    startEncounter(state, { mapAssetId: MAP_ID, entries: [{ actorId: ACTOR_ID, score: 20 }] }, () => 1, GEOMETRY);
    expect(() => rebuildActorDefinition(state, ACTOR_ID, built)).toThrow(/End the encounter/i);

    // Park that fight into a scene: it is paused, not over, and still owns this character's economy.
    createScene(state, { sceneId: SCENE_ID, name: "Ambush", mapAssetId: MAP_ID, combatantIds: [] }, GEOMETRY);
    state.combat = { ...state.combat, scenes: state.combat.scenes.map((scene) => ({ ...scene, combat: { ...scene.combat, active: true, initiative: [{ actorId: ACTOR_ID, score: 10, tieBreaker: 0 }] } })), active: false, initiative: [] };
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

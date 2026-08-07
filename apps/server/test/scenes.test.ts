import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { activateScene, createScene, duplicateScene, migrateToScene, removeScene, renameScene, reorderScenes, setSceneCombatants } from "../src/scenes.js";
import { startEncounter, nextInitiativeTurn } from "../src/encounter.js";
import { moveEncounterToken, moveSceneToken } from "../src/token-placement.js";
import { removeActor } from "../src/actor-roster.js";
import { projectPlayerCombat } from "../src/projections.js";

const IDS = {
  alpha: "10000000-0000-4000-8000-000000000001",
  beta: "10000000-0000-4000-8000-000000000002",
  extra: "10000000-0000-4000-8000-000000000003",
  map1: "20000000-0000-5000-8000-000000000001",
  map2: "20000000-0000-5000-8000-000000000002",
  sceneA: "30000000-0000-4000-8000-00000000000a",
  sceneB: "30000000-0000-4000-8000-00000000000b",
  implicit: "30000000-0000-4000-8000-00000000000f"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

function state() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.alpha, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, initiative: 5 },
    { id: IDS.beta, name: "Beta", kind: "monster", visibility: "public", hp: { current: 15, maximum: 15 }, initiative: 2 },
    { id: IDS.extra, name: "Extra", kind: "monster", visibility: "gm-only", hp: { current: 8, maximum: 8 }, initiative: 0 }
  ] });
}

/**
 * The nine LIVE fields a fight is made of. Typed as exactly those keys rather than as the whole
 * `combat` block, because it is called with BOTH the table's combat and a parked scene's - and a
 * scene carries no `scenes`/`activeSceneId`/`mapAssetId`/history cursor of its own.
 */
type LiveCombat = Pick<ReturnType<typeof state>["combat"], "active" | "round" | "turnActorId" | "initiative" | "tokens" | "annotations" | "turn" | "reactionsUsed" | "pendingSaves">;
const liveOf = (combat: LiveCombat) => ({ active: combat.active, round: combat.round, turnActorId: combat.turnActorId, initiative: combat.initiative, tokens: combat.tokens, annotations: combat.annotations, turn: combat.turn, reactionsUsed: combat.reactionsUsed, pendingSaves: combat.pendingSaves });

describe("scene preparation", () => {
  it("creates a prepared (inactive) scene with score-0 initiative and unplaced tokens, and stays schema-valid", () => {
    const game = state();
    const scene = createScene(game, { sceneId: IDS.sceneA, name: "Ambush", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.beta] }, GEOMETRY);
    expect(scene).toMatchObject({ id: IDS.sceneA, name: "Ambush", mapAssetId: IDS.map1 });
    expect(scene.combat.active).toBe(false);
    expect(scene.combat.initiative).toEqual([
      { actorId: IDS.alpha, score: 0, tieBreaker: 5 },
      { actorId: IDS.beta, score: 0, tieBreaker: 2 }
    ]);
    expect(scene.combat.tokens.map((token) => token.position)).toEqual([null, null]);
    expect(() => GameStateSchema.parse(game)).not.toThrow();
  });

  it("renames a scene and rejects removing the live one", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "One", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    renameScene(game, IDS.sceneA, "Renamed");
    expect(game.combat.scenes[0].name).toBe("Renamed");
    activateScene(game, IDS.sceneA, IDS.implicit);
    expect(() => removeScene(game, IDS.sceneA)).toThrow(/another scene/i);
    expect(() => renameScene(game, "40000000-0000-4000-8000-000000000000", "X")).toThrow(/no longer exists/i);
  });

  it("rejects changing combatants of the live scene, allows it for a parked one", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "B", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    expect(() => setSceneCombatants(game, IDS.sceneA, [IDS.beta], GEOMETRY)).toThrow(/live/i);
    setSceneCombatants(game, IDS.sceneB, [IDS.alpha, IDS.beta], GEOMETRY);
    expect(game.combat.scenes.find((scene) => scene.id === IDS.sceneB)!.combat.initiative.map((entry) => entry.actorId)).toEqual([IDS.alpha, IDS.beta]);
  });

  it("keeps already-placed token positions when combatants are edited", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit); // A live, so B stays parked/editable
    createScene(game, { sceneId: IDS.sceneB, name: "B", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    moveSceneToken(game, IDS.sceneB, IDS.beta, { x: 250, y: 175 }, GEOMETRY);
    // Adding Alpha to scene B must not reset Beta's placed token.
    setSceneCombatants(game, IDS.sceneB, [IDS.beta, IDS.alpha], GEOMETRY);
    const sceneB = game.combat.scenes.find((scene) => scene.id === IDS.sceneB)!;
    expect(sceneB.combat.tokens.find((token) => token.actorId === IDS.beta)!.position).toEqual({ x: 250, y: 175 });
    expect(sceneB.combat.tokens.find((token) => token.actorId === IDS.alpha)!.position).toBeNull();
  });
});

describe("scene staging (GM-private token placement)", () => {
  it("moves a token within a prepared scene and rejects staging the live one", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "B", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit); // A is live
    // Stage the parked scene B privately - its token gets a position, and the live top-level is untouched.
    moveSceneToken(game, IDS.sceneB, IDS.beta, { x: 200, y: 150 }, GEOMETRY);
    expect(game.combat.scenes.find((scene) => scene.id === IDS.sceneB)!.combat.tokens.find((token) => token.actorId === IDS.beta)!.position).toEqual({ x: 200, y: 150 });
    expect(() => GameStateSchema.parse(game)).not.toThrow();
    // The live scene A can't be staged this way (edit it on the live map instead).
    expect(() => moveSceneToken(game, IDS.sceneA, IDS.alpha, { x: 10, y: 10 }, GEOMETRY)).toThrow(/live/i);
  });
});

describe("scene park and resume", () => {
  it("preserves a running fight when switching away and resumes it exactly on switch-back", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "Fight", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.beta] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "Next room", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);

    // Run a real fight on scene A: start, advance into round 2, place Alpha's token.
    startEncounter(game, { mapAssetId: IDS.map1, entries: [{ actorId: IDS.alpha, score: 18 }, { actorId: IDS.beta, score: 9 }] }, () => 10, GEOMETRY);
    nextInitiativeTurn(game); nextInitiativeTurn(game); // wraps to round 2
    moveEncounterToken(game, IDS.alpha, { x: 120, y: 90 }, GEOMETRY);
    expect(game.combat.round).toBe(2);
    const running = structuredClone(liveOf(game.combat));

    // Switch to scene B: A parks, B resumes (prepared/inactive on its own map).
    activateScene(game, IDS.sceneB, IDS.implicit);
    expect(game.combat.activeSceneId).toBe(IDS.sceneB);
    expect(game.combat.mapAssetId).toBe(IDS.map2);
    expect(game.combat.active).toBe(false);
    // The parked scene A holds the frozen fight; the active scene B's own slot is empty.
    expect(liveOf(game.combat.scenes.find((scene) => scene.id === IDS.sceneA)!.combat)).toEqual(running);
    expect(game.combat.scenes.find((scene) => scene.id === IDS.sceneB)!.combat.initiative).toEqual([]);

    // Switch back to A: the fight resumes byte-for-byte.
    activateScene(game, IDS.sceneA, IDS.implicit);
    expect(game.combat.activeSceneId).toBe(IDS.sceneA);
    expect(game.combat.mapAssetId).toBe(IDS.map1);
    expect(liveOf(game.combat)).toEqual(running);
    expect(() => GameStateSchema.parse(game)).not.toThrow();
  });

  it("counts staging as use, so a prep-heavy GM's Recent list stays honest", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "Ambush", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.beta] }, GEOMETRY, 1_700_000_000_000);
    // The monster the GM just staged is now recent...
    expect(game.actors.find((actor) => actor.id === IDS.beta)!.lastUsedAt).toBe(1_700_000_000_000);
    // ...and the standing party is not, so it cannot push the monsters off the list.
    expect(game.actors.find((actor) => actor.id === IDS.alpha)!.lastUsedAt).toBeUndefined();
    setSceneCombatants(game, IDS.sceneA, [IDS.extra], GEOMETRY, 1_700_000_001_000);
    expect(game.actors.find((actor) => actor.id === IDS.extra)!.lastUsedAt).toBe(1_700_000_001_000);
  });

  it("parks and resumes the per-family rule exceptions with the rest of the fight", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "Fight", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "Next room", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    startEncounter(game, { mapAssetId: IDS.map1, entries: [{ actorId: IDS.alpha, score: 18 }], ruleExceptions: { movement: "freeform" } }, () => 10, GEOMETRY);
    expect(game.combat.ruleExceptions).toEqual({ movement: "freeform" });

    // Miss this in the snapshot list and a parked scene resumes under the WRONG rules.
    activateScene(game, IDS.sceneB, IDS.implicit);
    expect(game.combat.scenes.find((scene) => scene.id === IDS.sceneA)!.combat.ruleExceptions).toEqual({ movement: "freeform" });
    activateScene(game, IDS.sceneA, IDS.implicit);
    expect(game.combat.ruleExceptions).toEqual({ movement: "freeform" });
  });

  it("gives a newly prepared scene the table's current rule exceptions, not bare defaults", () => {
    const game = state();
    game.combat = { ...game.combat, rulesMode: "assisted", ruleExceptions: { targeting: "freeform" } };
    const scene = createScene(game, { sceneId: IDS.sceneA, name: "Prepped", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    expect(scene.combat.rulesMode).toBe("assisted");
    expect(scene.combat.ruleExceptions).toEqual({ targeting: "freeform" });
  });

  it("keeps actor HP global across scene swaps (damage persists) and rejects re-activating the live scene", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "B", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    game.actors.find((actor) => actor.id === IDS.alpha)!.hp.current = 4; // wounded on scene A
    activateScene(game, IDS.sceneB, IDS.implicit);
    expect(game.actors.find((actor) => actor.id === IDS.alpha)!.hp.current).toBe(4);
    expect(() => activateScene(game, IDS.sceneB, IDS.implicit)).toThrow(/already live/i);
  });
});

describe("scene migration and projections", () => {
  it("binds a pre-scenes encounter to one implicit active scene, leaving the player projection unchanged", () => {
    const game = state();
    startEncounter(game, { mapAssetId: IDS.map1, entries: [{ actorId: IDS.alpha, score: 12 }, { actorId: IDS.beta, score: 6 }] }, () => 10, GEOMETRY);
    const before = projectPlayerCombat(game);
    migrateToScene(game, IDS.sceneA);
    expect(game.combat.scenes).toHaveLength(1);
    expect(game.combat.activeSceneId).toBe(IDS.sceneA);
    expect(game.combat.scenes[0]).toMatchObject({ id: IDS.sceneA, mapAssetId: IDS.map1 });
    // The active scene's own slot is empty; the live copy stays top-level.
    expect(game.combat.scenes[0].combat.initiative).toEqual([]);
    // Players never see scenes: the projection is byte-identical and carries no scene keys.
    const after = projectPlayerCombat(game);
    expect(after).toEqual(before);
    expect("scenes" in after).toBe(false);
    expect("activeSceneId" in after).toBe(false);
    // Migration is one-shot: nothing to do once a scene exists.
    migrateToScene(game, IDS.sceneB);
    expect(game.combat.scenes).toHaveLength(1);
  });
});

describe("scene ripples on encounter start and actor removal", () => {
  it("rejects starting on a different map than the active scene and preserves pre-placed positions", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    expect(() => startEncounter(game, { mapAssetId: IDS.map2, entries: [{ actorId: IDS.alpha }] }, () => 10, GEOMETRY)).toThrow(/different map/i);
    // Pre-place Beta's token on the live prepared scene, then start on the matching map: the position survives.
    game.combat = { ...game.combat, active: false };
    game.combat = { ...game.combat, tokens: game.combat.tokens.map((token) => token.actorId === IDS.beta ? { ...token, position: { x: 300, y: 200 } } : token) };
    startEncounter(game, { mapAssetId: IDS.map1, entries: [{ actorId: IDS.alpha, score: 5 }, { actorId: IDS.beta, score: 3 }] }, () => 10, GEOMETRY);
    expect(game.combat.tokens.find((token) => token.actorId === IDS.beta)!.position).toEqual({ x: 300, y: 200 });
  });

  it("prunes a removed actor from inactive scenes and blocks removal from a parked active fight", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.extra] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "B", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    // Extra (gm-only monster) is only in the inactive scene A → removing it prunes A cleanly.
    removeActor(game, IDS.extra);
    expect(game.combat.scenes.find((scene) => scene.id === IDS.sceneA)!.combat.initiative.map((entry) => entry.actorId)).toEqual([IDS.alpha]);
    expect(() => GameStateSchema.parse(game)).not.toThrow();

    // Now make scene B a parked, still-running fight; Beta (a monster) can't be removed while paused there.
    activateScene(game, IDS.sceneB, IDS.implicit);
    startEncounter(game, { mapAssetId: IDS.map2, entries: [{ actorId: IDS.beta, score: 5 }] }, () => 10, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    expect(() => removeActor(game, IDS.beta)).toThrow(/paused encounter/i);
  });
});

describe("scene duplication and reordering", () => {
  it("duplicates a prepared scene as a parked copy next to the original, preserving map and staged tokens", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "Ambush", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.beta] }, GEOMETRY);
    moveSceneToken(game, IDS.sceneA, IDS.alpha, { x: 120, y: 90 }, GEOMETRY);
    const copy = duplicateScene(game, IDS.sceneA, IDS.sceneB);
    expect(copy).toMatchObject({ id: IDS.sceneB, name: "Ambush (copy)", mapAssetId: IDS.map1 });
    // The copy sits immediately after its source in the list.
    expect(game.combat.scenes.map((scene) => scene.id)).toEqual([IDS.sceneA, IDS.sceneB]);
    // Staged combatants and the placed token position are copied verbatim.
    expect(copy.combat.initiative.map((entry) => entry.actorId)).toEqual([IDS.alpha, IDS.beta]);
    expect(copy.combat.tokens.find((token) => token.actorId === IDS.alpha)!.position).toEqual({ x: 120, y: 90 });
    // It's an independent copy: editing the original's combatants leaves the duplicate untouched.
    setSceneCombatants(game, IDS.sceneA, [IDS.alpha], GEOMETRY);
    expect(game.combat.scenes.find((scene) => scene.id === IDS.sceneB)!.combat.initiative.map((entry) => entry.actorId)).toEqual([IDS.alpha, IDS.beta]);
    expect(() => GameStateSchema.parse(game)).not.toThrow();
  });

  it("snapshots the live fight when duplicating the active scene, and never changes which scene is live", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "Fight", mapAssetId: IDS.map1, combatantIds: [IDS.alpha, IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    startEncounter(game, { mapAssetId: IDS.map1, entries: [{ actorId: IDS.alpha, score: 18 }, { actorId: IDS.beta, score: 9 }] }, () => 10, GEOMETRY);
    nextInitiativeTurn(game);
    const copy = duplicateScene(game, IDS.sceneA, IDS.sceneB);
    // The active scene's own slot is empty, so the copy must capture the top-level (live) combat, not a blank.
    expect(copy.combat.active).toBe(true);
    expect(copy.combat.initiative.map((entry) => entry.actorId)).toEqual(game.combat.initiative.map((entry) => entry.actorId));
    // Duplicating never changes which scene is live.
    expect(game.combat.activeSceneId).toBe(IDS.sceneA);
    expect(game.combat.active).toBe(true);
    expect(() => GameStateSchema.parse(game)).not.toThrow();
  });

  it("rejects duplicating a scene that no longer exists", () => {
    const game = state();
    expect(() => duplicateScene(game, IDS.sceneA, IDS.sceneB)).toThrow(/no longer exists/i);
  });

  it("reorders the prepared-scene list without touching the active scene, and rejects a non-permutation", () => {
    const game = state();
    createScene(game, { sceneId: IDS.sceneA, name: "A", mapAssetId: IDS.map1, combatantIds: [IDS.alpha] }, GEOMETRY);
    createScene(game, { sceneId: IDS.sceneB, name: "B", mapAssetId: IDS.map2, combatantIds: [IDS.beta] }, GEOMETRY);
    activateScene(game, IDS.sceneA, IDS.implicit);
    reorderScenes(game, [IDS.sceneB, IDS.sceneA]);
    expect(game.combat.scenes.map((scene) => scene.id)).toEqual([IDS.sceneB, IDS.sceneA]);
    expect(game.combat.activeSceneId).toBe(IDS.sceneA); // live scene is an id reference, untouched by reordering
    expect(() => reorderScenes(game, [IDS.sceneA])).toThrow(/every prepared scene exactly once/i);
    expect(() => reorderScenes(game, [IDS.sceneA, IDS.sceneA])).toThrow(/every prepared scene exactly once/i);
    expect(() => GameStateSchema.parse(game)).not.toThrow();
  });
});

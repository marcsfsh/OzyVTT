import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { addCombatant, startEncounter } from "../src/encounter.js";
import { createScene, setSceneCombatants } from "../src/scenes.js";
import { claimCharacter, forceReleaseCharacter } from "../src/character-claims.js";
import { removeActor } from "../src/actor-roster.js";
import { projectPlayerView } from "../src/projections.js";
import { CommandRejectedError } from "../src/game-store.js";

/**
 * "Archived" has to mean out-of-play on the SERVER, not just out-of-picker on the client.
 *
 * Every guard below closes a path where a caller who simply knew an actorId - a replayed request, an
 * integration credential, a stale client, a curl - could put an archived character back into play or
 * claim one, because the only thing stopping them was a projection filter or a picker's `.filter()`.
 * Projections and pickers are UX; these are the guard.
 */

const IDS = {
  retired: "10000000-0000-4000-8000-0000000000a1",
  active: "10000000-0000-4000-8000-0000000000a2",
  goblin: "10000000-0000-4000-8000-0000000000a3",
  map: "20000000-0000-5000-8000-0000000000b1",
  scene: "30000000-0000-4000-8000-0000000000c1",
  player: "40000000-0000-4000-8000-0000000000d1"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const noPresence = () => null;

function state(overrides: Partial<Record<"retiredClaimedBy", string>> = {}): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.retired, name: "Retired Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, archived: true, definitionId: `import-${IDS.retired}`, ...(overrides.retiredClaimedBy ? { ownerSessionId: overrides.retiredClaimedBy } : {}) },
      { id: IDS.active, name: "Active Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, definitionId: `import-${IDS.active}` },
      { id: IDS.goblin, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ]
  });
}

const start = (game: GameState, actorIds: readonly string[]) =>
  startEncounter(game, { mapAssetId: IDS.map, entries: actorIds.map((actorId) => ({ actorId, score: 10 })) }, () => 10, GEOMETRY);

describe("archived characters are refused by every staging door (server-side, not picker-side)", () => {
  it("refuses to stage an archived character in a new scene", () => {
    const game = state();
    expect(() => createScene(game, { sceneId: IDS.scene, name: "Ambush", mapAssetId: IDS.map, combatantIds: [IDS.active, IDS.retired] }, GEOMETRY))
      .toThrow(/Retired Hero is archived/);
    // Rejected, not silently filtered: the GM's selection must not lie back to them.
    expect(game.combat.scenes).toHaveLength(0);
  });

  it("refuses to add an archived character to an existing scene's combatant list", () => {
    const game = state();
    createScene(game, { sceneId: IDS.scene, name: "Ambush", mapAssetId: IDS.map, combatantIds: [IDS.active] }, GEOMETRY);
    expect(() => setSceneCombatants(game, IDS.scene, [IDS.active, IDS.retired], GEOMETRY)).toThrow(/Retired Hero is archived/);
    expect(game.combat.scenes[0].combat.initiative.map((entry) => entry.actorId)).toEqual([IDS.active]);
  });

  it("refuses to start an encounter that names an archived character", () => {
    const game = state();
    expect(() => start(game, [IDS.active, IDS.retired])).toThrow(/Retired Hero is archived/);
    expect(game.combat.active).toBe(false);
  });

  it("refuses to add an archived character to the running encounter", () => {
    const game = state();
    start(game, [IDS.active, IDS.goblin]);
    expect(() => addCombatant(game, IDS.retired, 12, () => 10, GEOMETRY)).toThrow(/Retired Hero is archived/);
    expect(game.combat.initiative.map((entry) => entry.actorId).includes(IDS.retired)).toBe(false);
  });

  it("still stages an archived character once it is restored", () => {
    const game = state();
    game.actors.find((actor) => actor.id === IDS.retired)!.archived = false;
    expect(() => createScene(game, { sceneId: IDS.scene, name: "Ambush", mapAssetId: IDS.map, combatantIds: [IDS.retired] }, GEOMETRY)).not.toThrow();
  });
});

describe("archived characters cannot be claimed", () => {
  it("refuses a claim on an archived character even when the caller knows its id", () => {
    const game = state();
    // The projection hides archived characters, so this is exactly the replay a stale or hostile
    // client makes: the id is known, the character is not in the player's view.
    expect(projectPlayerView(game, IDS.player, noPresence).actors.map((actor) => actor.id)).not.toContain(IDS.retired);
    expect(() => claimCharacter(game, IDS.retired, IDS.player)).toThrow(CommandRejectedError);
    expect(game.actors.find((actor) => actor.id === IDS.retired)!.ownerSessionId).toBeNull();
  });

  it("refuses with the same message a missing character gets (no existence oracle)", () => {
    const game = state();
    const missing = (() => { try { claimCharacter(game, "10000000-0000-4000-8000-0000000000ff", IDS.player); } catch (error) { return (error as Error).message; } })();
    const archived = (() => { try { claimCharacter(game, IDS.retired, IDS.player); } catch (error) { return (error as Error).message; } })();
    expect(archived).toBe(missing);
  });

  it("leaves an unarchived character claimable", () => {
    const game = state();
    expect(() => claimCharacter(game, IDS.active, IDS.player)).not.toThrow();
    expect(game.actors.find((actor) => actor.id === IDS.active)!.ownerSessionId).toBe(IDS.player);
  });

  it("keeps the one-claim rule (a second character needs the first released)", () => {
    const game = state();
    claimCharacter(game, IDS.active, IDS.player);
    game.actors.find((actor) => actor.id === IDS.retired)!.archived = false;
    expect(() => claimCharacter(game, IDS.retired, IDS.player)).toThrow(/Release your current character/);
    forceReleaseCharacter(game, IDS.active, "gm");
    expect(() => claimCharacter(game, IDS.retired, IDS.player)).not.toThrow();
  });
});

describe("an archived character is deletable even while a stale claim clings to it", () => {
  it("removes an archived, still-claimed character and releases the claim in the same mutation", () => {
    const game = state({ retiredClaimedBy: IDS.player });
    removeActor(game, IDS.retired);
    expect(game.actors.map((actor) => actor.id)).not.toContain(IDS.retired);
    // The character's own imported sheet goes with it - nothing references it any more.
    expect(game.definitions.map((entry) => entry.id)).not.toContain(`import-${IDS.retired}`);
  });

  it("still protects a claimed character that is in play", () => {
    const game = state();
    game.actors.find((actor) => actor.id === IDS.active)!.ownerSessionId = IDS.player;
    expect(() => removeActor(game, IDS.active)).toThrow(/Release that character's claim/);
    expect(game.actors.map((actor) => actor.id)).toContain(IDS.active);
  });
});

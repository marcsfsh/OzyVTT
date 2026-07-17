import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { addActorFromDefinition, removeActor } from "../src/actor-roster.js";
import { startEncounter } from "../src/encounter.js";
import { projectPlayerView } from "../src/projections.js";

const IDS = {
  pc: "10000000-0000-4000-8000-000000000001",
  added: "10000000-0000-4000-8000-000000000011",
  added2: "10000000-0000-4000-8000-000000000012",
  added3: "10000000-0000-4000-8000-000000000013",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const TOKEN_GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const goblin = loadMonsterDefinitions().find((definition) => definition.source.externalId === "goblin-warrior")!;

function state() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.pc, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 }, initiative: 2 }
  ] });
}

describe("actor roster", () => {
  it("instantiates a bundled monster with live HP, AC, initiative bonus, and provenance", () => {
    const game = state();
    addActorFromDefinition(game, goblin, IDS.added, "public");
    const actor = game.actors.find((item) => item.id === IDS.added)!;
    expect(actor).toMatchObject({
      name: "Goblin Warrior",
      kind: "monster",
      visibility: "public",
      hp: { current: goblin.hitPoints.maximum, maximum: goblin.hitPoints.maximum, temporary: 0 },
      armorClass: goblin.armorClass,
      initiative: goblin.initiativeBonus,
      ownerSessionId: null,
      definitionId: "goblin-warrior"
    });
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("dedupes names deterministically for repeat additions", () => {
    const game = state();
    addActorFromDefinition(game, goblin, IDS.added, "public");
    addActorFromDefinition(game, goblin, IDS.added2, "public");
    addActorFromDefinition(game, goblin, IDS.added3, "gm-only");
    expect(game.actors.map((actor) => actor.name)).toEqual(["Alpha", "Goblin Warrior", "Goblin Warrior 2", "Goblin Warrior 3"]);
    expect(game.actors[3].visibility).toBe("gm-only");
  });

  it("keeps gm-only additions out of the player projection", () => {
    const game = state();
    addActorFromDefinition(game, goblin, IDS.added, "gm-only");
    const view = projectPlayerView(game, undefined, () => null);
    expect(view.actors.some((actor) => actor.id === IDS.added)).toBe(false);
  });

  it("removes a monster and its stale inactive initiative/token references", () => {
    const game = state();
    addActorFromDefinition(game, goblin, IDS.added, "public");
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.pc, score: 15 }, { actorId: IDS.added, score: 10 }] }, () => 1, TOKEN_GEOMETRY);
    game.combat = { ...game.combat, active: false, turnActorId: null };
    removeActor(game, IDS.added);
    expect(game.actors.some((actor) => actor.id === IDS.added)).toBe(false);
    expect(game.combat.initiative.some((entry) => entry.actorId === IDS.added)).toBe(false);
    expect(game.combat.tokens.some((token) => token.actorId === IDS.added)).toBe(false);
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("refuses to remove a player character or an active combatant", () => {
    const game = state();
    addActorFromDefinition(game, goblin, IDS.added, "public");
    expect(() => removeActor(game, IDS.pc)).toThrow(/Player characters/);
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.pc, score: 15 }, { actorId: IDS.added, score: 10 }] }, () => 1, TOKEN_GEOMETRY);
    expect(() => removeActor(game, IDS.added)).toThrow(/End the encounter/);
  });
});

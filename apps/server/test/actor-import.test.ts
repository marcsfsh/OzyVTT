import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import character from "../../../packages/test-fixtures/actors/player-character.v1.json";
import { importActorDefinition, removeActor, storedDefinition } from "../src/actor-roster.js";
import { claimCharacter } from "../src/character-claims.js";
import { projectPlayerView } from "../src/projections.js";
import { ActorDefinitionSchema } from "@vtt/schemas";

const IDS = {
  imported: "10000000-0000-4000-8000-000000000011",
  session: "30000000-0000-4000-8000-000000000001",
  otherSession: "30000000-0000-4000-8000-000000000002"
} as const;

const DEFINITION = ActorDefinitionSchema.parse(character);

function state() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [] });
}

describe("canonical sheet import", () => {
  it("imports a character as a claimable player-character with its stat block stored", () => {
    const game = state();
    importActorDefinition(game, DEFINITION, IDS.imported, "public");
    const actor = game.actors[0];
    expect(actor).toMatchObject({
      id: IDS.imported,
      name: "Mira Thorne",
      kind: "player-character",
      hp: { current: 28, maximum: 28, temporary: 0 },
      armorClass: 16,
      initiative: 2,
      definitionId: `import-${IDS.imported}`,
      sizeCells: 1,
      ownerSessionId: null
    });
    expect(storedDefinition(game, `import-${IDS.imported}`)?.name).toBe("Mira Thorne");
    expect(GameStateSchema.safeParse(game).success).toBe(true);
    claimCharacter(game, IDS.imported, IDS.session);
    expect(game.actors[0].ownerSessionId).toBe(IDS.session);
  });

  it("sends the imported sheet only to its owning player", () => {
    const game = state();
    importActorDefinition(game, DEFINITION, IDS.imported, "public");
    claimCharacter(game, IDS.imported, IDS.session);
    const ownerView = projectPlayerView(game, IDS.session, () => null);
    const strangerView = projectPlayerView(game, IDS.otherSession, () => null);
    expect(ownerView.actors[0].definition?.name).toBe("Mira Thorne");
    expect(strangerView.actors[0].definition).toBeUndefined();
    expect(JSON.stringify(strangerView.actors[0])).not.toContain("Longsword");
  });

  it("removes an unclaimed imported character and its orphaned stat block, but never a claimed one", () => {
    const game = state();
    importActorDefinition(game, DEFINITION, IDS.imported, "public");
    claimCharacter(game, IDS.imported, IDS.session);
    expect(() => removeActor(game, IDS.imported)).toThrow(/Release/);
    game.actors[0].ownerSessionId = null;
    removeActor(game, IDS.imported);
    expect(game.actors).toHaveLength(0);
    expect(game.definitions).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import character from "../../../packages/test-fixtures/actors/player-character.v1.json";
import { importActorDefinition, removeActor, resolvePendingImport, storedDefinition, submitPendingImport } from "../src/actor-roster.js";
import { claimCharacter } from "../src/character-claims.js";
import { projectGmView, projectPlayerView } from "../src/projections.js";
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

describe("player-submitted PDF imports (GM approval queue)", () => {
  it("queues a submission without creating an actor", () => {
    const game = state();
    submitPendingImport(game, DEFINITION, "imp-1", IDS.session);
    expect(game.pendingImports).toHaveLength(1);
    expect(game.pendingImports[0]).toMatchObject({ id: "imp-1", name: "Mira Thorne", submittedBy: IDS.session });
    expect(game.actors).toHaveLength(0);
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("approving instantiates a claimable actor and clears the queue entry", () => {
    const game = state();
    submitPendingImport(game, DEFINITION, "imp-1", IDS.session);
    resolvePendingImport(game, "imp-1", true, IDS.imported);
    expect(game.pendingImports).toHaveLength(0);
    expect(game.actors[0]).toMatchObject({ id: IDS.imported, name: "Mira Thorne", kind: "player-character" });
  });

  it("rejecting drops the submission and creates nothing", () => {
    const game = state();
    submitPendingImport(game, DEFINITION, "imp-1", IDS.session);
    resolvePendingImport(game, "imp-1", false, IDS.imported);
    expect(game.pendingImports).toHaveLength(0);
    expect(game.actors).toHaveLength(0);
  });

  it("keeps the pending queue GM-only — never in the player projection", () => {
    const game = state();
    submitPendingImport(game, DEFINITION, "imp-1", IDS.session);
    const playerView = projectPlayerView(game, IDS.session, () => null);
    expect("pendingImports" in playerView).toBe(false);
    // the submitting player has no claimed actor yet, so the queued sheet must not surface anywhere
    expect(JSON.stringify(playerView)).not.toContain("Mira Thorne");
    // the GM projection (which spreads state) does carry it (the viewer projects a strict actor subset, never top-level state)
    expect(projectGmView(game, () => null).pendingImports).toHaveLength(1);
  });
});

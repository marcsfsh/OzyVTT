import { describe, expect, it } from "vitest";
import { createInitialGameState, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { removeActor } from "../src/actor-roster.js";
import { setCharacterIdentity } from "../src/character-edit.js";

// The edit/delete gates read the `import-` prefix as "this sheet belongs to one character", so the
// starter characters' sheets are keyed that way too.

describe("the example party ships as ordinary characters", () => {
  it("keys the starter sheets like any imported character on a fresh install", () => {
    const fresh = createInitialGameState();
    for (const actor of fresh.actors) expect(actor.definitionId).toBe(`import-${actor.id}`);
    expect(fresh.definitions.map((entry) => entry.id).sort()).toEqual(
      fresh.actors.map((actor) => `import-${actor.id}`).sort()
    );
    expect(JSON.stringify(fresh.definitions.map((entry) => entry.id))).not.toContain("example-");
  });

  it("lets the GM edit and delete a starter character", () => {
    const game = createInitialGameState();
    const borin = PLACEHOLDER_ACTOR_IDS.fighter;
    expect(() =>
      setCharacterIdentity(game, borin, { classes: [{ id: "fighter", name: "Fighter", level: 8 }], feats: [] })
    ).not.toThrow();
    expect(
      game.definitions.find((entry) => entry.id === `import-${borin}`)!.definition.character!.classes[0].level
    ).toBe(8);
    expect(() => removeActor(game, borin)).not.toThrow();
    expect(game.actors.map((actor) => actor.id)).not.toContain(borin);
    // The sheet goes with the character; nothing references it any more.
    expect(game.definitions.map((entry) => entry.id)).not.toContain(`import-${borin}`);
  });
});

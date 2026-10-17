import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, type GameState } from "@vtt/domain";
import { createInitialGameState, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { rebuildActorDefinition, removeActor, removeSampleCharacters, storedDefinition } from "../src/actor-roster.js";
import { builderOffers } from "../src/builder-offers.js";
import { buildCharacterDefinition, storedAbilityScores, storedHitPointRolls } from "../src/character-build.js";
import { setCharacterIdentity } from "../src/character-edit.js";
import { ContentLibrary } from "../src/content-library.js";
import { bootServer } from "./boot-server.js";

// The sample party is built by the character builder, so it levels like any character built here. The edit and
// delete gates read the `import-` prefix as "this sheet belongs to one character", so its sheets are keyed that way.

const library = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});

describe("the sample party", () => {
  it("is three level 7 characters, marked as samples, keyed like any character built here", () => {
    const fresh = createInitialGameState();
    expect(fresh.actors.map((actor) => actor.name)).toEqual([
      "Borin Stoneguard",
      "Mirena Dawnbright",
      "Lyra Emberwise"
    ]);
    for (const actor of fresh.actors) {
      expect(actor.sample).toBe(true);
      expect(actor.definitionId).toBe(`import-${actor.id}`);
      const character = storedDefinition(fresh, actor.definitionId!)!.character!;
      expect(character.classes.reduce((total, entry) => total + entry.level, 0)).toBe(7);
      // The builder's ledger: what a level-up reads back.
      expect(character.choices?.length).toBeGreaterThan(10);
    }
    expect(fresh.definitions.map((entry) => entry.id).sort()).toEqual(
      fresh.actors.map((actor) => `import-${actor.id}`).sort()
    );
  });

  it("is the same three on every fresh table", () => {
    expect(JSON.stringify(createInitialGameState().definitions)).toBe(
      JSON.stringify(createInitialGameState().definitions)
    );
  });

  it("levels down and back up like a built character, asking only the new level's choices", () => {
    const state = createInitialGameState();
    const borin = PLACEHOLDER_ACTOR_IDS.fighter;
    const sheet = storedDefinition(state, `import-${borin}`)!;
    const ledger = sheet.character!.choices!;
    const identity = {
      name: sheet.name,
      speciesId: sheet.character!.race!.id,
      backgroundId: sheet.character!.background!.id,
      classId: "fighter",
      subclassId: "champion",
      ...storedAbilityScores(ledger)!
    };
    const before = state.actors.find((actor) => actor.id === borin)!.hp.maximum;
    const rebuildAt = (level: number) => {
      const reply = builderOffers({ ...identity, level, choices: ledger }, library);
      const definition = buildCharacterDefinition(
        {
          ...identity,
          level,
          hp: { mode: "entries", entries: storedHitPointRolls(ledger, level)! },
          choices: reply.choices
        },
        library,
        policy
      );
      rebuildActorDefinition(state, borin, definition);
    };
    rebuildAt(6);
    expect(state.actors.find((actor) => actor.id === borin)!.hp.maximum).toBeLessThan(before);
    rebuildAt(7);
    expect(state.actors.find((actor) => actor.id === borin)!.hp.maximum).toBe(before);

    // Level 8 brings one new choice, an Ability Score Improvement; everything below it is read back.
    const upward = builderOffers({ ...identity, level: 8, choices: ledger }, library);
    const open = upward.offers.filter((offer) => (upward.picks[offer.key]?.length ?? 0) < offer.capacity);
    expect(open.map((offer) => offer.level)).toEqual([8]);
  });

  it("is changed through the Level flow like a built character, and the GM may delete it", () => {
    const game = createInitialGameState();
    const borin = PLACEHOLDER_ACTOR_IDS.fighter;
    expect(() =>
      setCharacterIdentity(game, borin, { classes: [{ id: "fighter", name: "Fighter", level: 8 }], feats: [] })
    ).toThrow(/Level flow/);
    expect(() => removeActor(game, borin)).not.toThrow();
    expect(game.actors.map((actor) => actor.id)).not.toContain(borin);
    // The sheet goes with the character; nothing references it any more.
    expect(game.definitions.map((entry) => entry.id)).not.toContain(`import-${borin}`);
  });
});

describe("removing the sample characters", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });
  const { fighter: borin, cleric: mirena, wizard: lyra } = PLACEHOLDER_ACTOR_IDS;
  /** A fresh table where a player holds Lyra and Borin fights, beside a character the GM made. */
  function busyTable(): GameState {
    const state = createInitialGameState();
    state.actors.find((actor) => actor.id === lyra)!.ownerSessionId = "30000000-0000-4000-8000-0000000000a1";
    const { sample: _sample, ...made } = structuredClone(state.actors[0]!);
    state.actors.push({ ...made, id: randomUUID(), name: "Tamsin" });
    state.combat = {
      ...state.combat,
      active: true,
      initiative: [{ actorId: borin, score: 12, tieBreaker: 0 } as GameState["combat"]["initiative"][number]]
    };
    return state;
  }

  it("takes every sample it may, and names each one kept with the reason", () => {
    const state = busyTable();
    expect(removeSampleCharacters(state)).toEqual({
      removed: ["Mirena Dawnbright"],
      kept: [
        { name: "Borin Stoneguard", reason: "End the encounter before removing a combatant who is in it." },
        { name: "Lyra Emberwise", reason: "Release that character's claim before removing it." }
      ]
    });
    expect(state.actors.map((actor) => actor.name)).toEqual(["Borin Stoneguard", "Lyra Emberwise", "Tamsin"]);
    expect(state.definitions.map((entry) => entry.id)).not.toContain(`import-${mirena}`);
    // A refused sample is left exactly as it was: Lyra's player still holds Lyra.
    expect(state.actors.find((actor) => actor.id === lyra)!.ownerSessionId).not.toBeNull();
  });

  it("is one GM command over the API, with the same answer", async () => {
    const booted = await bootServer(busyTable());
    cleanups.push(booted.close);
    const reply = await booted.post(GAME_PATHS.sampleCharactersRemove, booted.gmToken, { commandId: randomUUID() });
    expect(reply.status).toBe(200);
    const { data } = await reply.json();
    expect(data.removed).toEqual(["Mirena Dawnbright"]);
    expect(data.kept.map((entry: { name: string }) => entry.name)).toEqual(["Borin Stoneguard", "Lyra Emberwise"]);
    const player = booted.server.auth.issuePlayerSession();
    expect((await booted.post(GAME_PATHS.sampleCharactersRemove, player, { commandId: randomUUID() })).status).toBe(
      403
    );
  });
});

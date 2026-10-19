import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Fiendish Resilience: "Choose one damage type, other than Force, whenever you finish a Short or Long Rest.
// You have Resistance to that damage type until you choose a different one with this feature." Wizard Arcane
// Recovery: "When you finish a Short Rest, you can choose expended spell slots to recover."

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const WARLOCK = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4b";
const WIZARD = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4c";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function table(): GameState {
  const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
  const build = (classId: string, level: number, subclassId?: string) =>
    buildCharacterDefinition(
      generateCharacterRequest({ classId, level, ...(subclassId ? { subclassId } : {}) }, library, policy, () => 1)
        .request,
      library,
      policy
    );
  importActorDefinition(state, build("warlock", 11, "fiend-patron"), WARLOCK, "public", catalog);
  importActorDefinition(state, build("wizard", 4), WIZARD, "public", catalog);
  for (const actor of state.actors) actor.kind = "player-character";
  return state;
}

describe("the step a finished rest opens", () => {
  it("lets a player re-choose Fiendish Resilience and recover slots only after a rest, and keeps the pick", async () => {
    const { server, gmToken, post, close } = await bootServer(table());
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    const other = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: WARLOCK })).status).toBe(200);
    expect((await post(GAME_PATHS.claims, other, { commandId: randomUUID(), actorId: WIZARD })).status).toBe(200);
    const rechoose = () =>
      post(GAME_PATHS.actorRechoose.replace("{actorId}", WARLOCK), player, {
        commandId: randomUUID(),
        offer: "feature:fiendish-resilience",
        id: "cold"
      });
    const early = await rechoose();
    expect(early.status).toBe(409);
    expect((await early.json()).error.message).toMatch(/after finishing a Short or Long Rest/);

    // The party's Short Rest finishes, and each member's step opens.
    expect(
      (
        await post(GAME_PATHS.restParty, gmToken, {
          commandId: randomUUID(),
          kind: "short",
          actorIds: [WARLOCK, WIZARD]
        })
      ).status
    ).toBe(200);
    expect((await post(GAME_PATHS.restFinish, gmToken, { commandId: randomUUID(), apply: true })).status).toBe(200);
    expect((await rechoose()).status).toBe(200);
    const warlock = () => server.store.snapshot.actors.find((actor) => actor.id === WARLOCK)!;
    expect(warlock().choiceOverrides["feature:fiendish-resilience"]?.id).toBe("cold");

    // A player converts only on their own character.
    const wizardSlots = server.store.snapshot.actors.find((actor) => actor.id === WIZARD)!.spellSlots!;
    expect(wizardSlots.length).toBeGreaterThan(0);
    const convert = (token: string) =>
      post(GAME_PATHS.actorConvert.replace("{actorId}", WIZARD), token, {
        commandId: randomUUID(),
        conversionId: "arcane-recovery",
        levels: [1]
      });
    expect((await convert(player)).status).toBe(403);

    // Done closes the step, and the pick stands through the next rest.
    expect(
      (
        await post(GAME_PATHS.characterFinishPreparing.replace("{actorId}", WARLOCK), player, {
          commandId: randomUUID(),
          rest: true
        })
      ).status
    ).toBe(200);
    expect(warlock().restStep).toBeNull();
    expect((await rechoose()).status).toBe(409);
    expect(
      (
        await post(GAME_PATHS.actorRest.replace("{actorId}", WARLOCK), gmToken, {
          commandId: randomUUID(),
          kind: "long"
        })
      ).status
    ).toBe(200);
    expect(warlock().choiceOverrides["feature:fiendish-resilience"]?.id).toBe("cold");
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Survivor (Champion 18), Defy Death: "when you roll 18-20 on a Death Saving Throw, you gain the benefit of
// rolling a 20 on it."

const HERO = "10000000-0000-4000-8000-000000000c11";

function game(survivor: boolean): GameState {
  const torva = loadActorFixture("torva-grimtusk") as { extensions: Record<string, { traits: unknown[] }> };
  const extensions = structuredClone(torva.extensions);
  if (survivor)
    extensions["open5e.srd-2024"]!.traits.push({ name: "Survivor", description: "Defy Death and Heroic Rally." });
  const definition = ActorDefinitionSchema.parse({ ...torva, extensions });
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Torva",
        kind: "player-character",
        visibility: "public",
        hp: { current: 0, maximum: 75 },
        definitionId: "import-torva",
        deathSaves: { successes: 0, failures: 1, stable: false },
        conditions: [{ id: "unconscious" }]
      }
    ],
    definitions: [{ id: "import-torva", definition }]
  });
}

describe("Survivor: Defy Death", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const deathSave = async (survivor: boolean, naturalRoll: number) => {
    const { server, gmToken, post, close } = await bootServer(game(survivor));
    cleanups.push(close);
    const response = await post(GAME_PATHS.deathSaveRoll.replace("{actorId}", HERO), gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      naturalRoll
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { deathSave: { outcome: string } } };
    return { reply: body.data, hero: server.store.snapshot.actors[0]! };
  };

  it("counts a 19 as a 20: the Champion regains 1 Hit Point", async () => {
    const { reply, hero } = await deathSave(true, 19);
    expect(reply.deathSave.outcome).toBe("critical-success");
    expect(hero.hp.current).toBe(1);
    expect(hero.deathSaves).toBeNull();
  });

  it("counts an 18 as a 20 too, and leaves a 17 a plain success", async () => {
    expect((await deathSave(true, 18)).reply.deathSave.outcome).toBe("critical-success");
    expect((await deathSave(true, 17)).reply.deathSave.outcome).toBe("success");
  });

  it("gives a creature without the feature a plain success on a 19", async () => {
    const { reply, hero } = await deathSave(false, 19);
    expect(reply.deathSave.outcome).toBe("success");
    expect(hero.hp.current).toBe(0);
  });
});

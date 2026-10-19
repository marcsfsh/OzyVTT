import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, InventoryItemSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { spendHitDice } from "../src/rests.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Periapt of Wound Closure: "Life Preservation. Whenever you make a Death Saving Throw, you can change a roll
// of 9 or lower to a 10, turning a failed save into a successful one. Natural Healing Boost. Whenever you roll a Hit
// Point Die to regain Hit Points, double the number of Hit Points it restores."

const torva = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
const HERO = "10000000-0000-4000-8000-000000000c01";
const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const periapt = (attuned: boolean) =>
  InventoryItemSchema.parse({
    id: "periapt",
    name: "Periapt of Wound Closure",
    recordId: "periapt-of-wound-closure",
    quantity: 1,
    equipped: true,
    attuned
  });

function game(attuned: boolean, hero: Record<string, unknown> = {}): GameState {
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
        deathSaves: { successes: 0, failures: 0, stable: false },
        conditions: [{ id: "unconscious" }],
        hitDice: { die: "d12", maximum: 7, remaining: 7 },
        inventory: [periapt(attuned)],
        ...hero
      }
    ],
    definitions: [{ id: "import-torva", definition: torva }]
  });
}

describe("Periapt of Wound Closure", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  const deathSave = async (attuned: boolean, naturalRoll: number) => {
    const { server, gmToken, post, close } = await bootServer(game(attuned));
    cleanups.push(close);
    const response = await post(GAME_PATHS.deathSaveRoll.replace("{actorId}", HERO), gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      naturalRoll
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { deathSave: { outcome: string } } };
    return { reply: body.data, server };
  };

  it("counts an attuned wearer's death save of 9 or lower as a 10", async () => {
    const { reply, server } = await deathSave(true, 4);
    expect(reply.deathSave.outcome).toBe("success");
    expect(server.store.snapshot.actors[0]!.deathSaves).toMatchObject({ successes: 1, failures: 0 });
  });

  it("does nothing for a wearer not attuned to it", async () => {
    const { reply } = await deathSave(false, 4);
    expect(reply.deathSave.outcome).toBe("failure");
  });

  it("doubles what each Hit Point Die restores", () => {
    const con = Math.floor((torva.abilityScores.con - 10) / 2);
    const worn = game(true, { hp: { current: 10, maximum: 75 }, deathSaves: null, conditions: [] });
    const resolve = (id: string) => worn.definitions.find((entry) => entry.id === id)?.definition;
    expect(spendHitDice(worn, HERO, [5], { role: "gm" }, resolve, 1, catalog).healed).toBe(2 * (5 + con));
    const bare = game(false, { hp: { current: 10, maximum: 75 }, deathSaves: null, conditions: [] });
    expect(spendHitDice(bare, HERO, [5], { role: "gm" }, resolve, 1, catalog).healed).toBe(5 + con);
  });
});

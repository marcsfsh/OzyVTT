import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { addActorFromDefinition } from "../src/actor-roster.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Monsters: Legendary Resistance is "x/Day", and a Per Day use needs a Long Rest to come back. The GM
// rests a monster from its sheet like anyone else.

const ABOLETH = "20000000-0000-4000-8000-000000000001";

function lair(spent: Record<string, number>, hp?: number): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  const aboleth = loadMonsterDefinitions().find((monster) => monster.source.externalId === "aboleth")!;
  addActorFromDefinition(state, aboleth, ABOLETH, "public");
  const actor = state.actors[0];
  actor.actionUses = spent;
  if (hp !== undefined) actor.hp.current = hp;
  return state;
}

describe("the GM rests a monster", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("re-arms Legendary Resistance and per-day uses on a Long Rest, and not on a Short one", async () => {
    const { server, gmToken, post, close } = await bootServer(
      lair({ "legendary-resistance": 2, "dominate-mind": 2 }, 40)
    );
    cleanups.push(close);
    expect(server.store.snapshot.actors[0].legendary?.resistancesPerDay).toBeGreaterThan(0);
    const rest = (kind: "short" | "long", token = gmToken) =>
      post(GAME_PATHS.actorRest.replace("{actorId}", ABOLETH), token, { commandId: randomUUID(), kind });
    expect((await rest("short")).status).toBe(200);
    expect(server.store.snapshot.actors[0].actionUses).toEqual({ "legendary-resistance": 2, "dominate-mind": 2 });
    expect((await rest("short", server.auth.issuePlayerSession())).status).toBe(403);
    expect((await rest("long")).status).toBe(200);
    expect(server.store.snapshot.actors[0]).toMatchObject({ actionUses: {}, lastLongRestAt: 0 });
    expect(server.store.snapshot.actors[0].hp.current).toBe(server.store.snapshot.actors[0].hp.maximum);
  });

  it("refuses a dead one: a monster at 0 hit points has died", async () => {
    const { gmToken, post, close } = await bootServer(lair({ "legendary-resistance": 3 }, 0));
    cleanups.push(close);
    const response = await post(GAME_PATHS.actorRest.replace("{actorId}", ABOLETH), gmToken, {
      commandId: randomUUID(),
      kind: "long"
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe("Aboleth is dead, and a rest can't bring Aboleth back.");
  });
});

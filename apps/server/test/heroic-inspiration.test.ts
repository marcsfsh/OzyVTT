import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import type { ActorDefinition } from "@vtt/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { projectPlayerView } from "../src/projections.js";
import { applyRest } from "../src/rests.js";
import { createServer } from "../src/server.js";
import { startOfTurn } from "../src/turn-boundaries.js";
import type { EffectNarration } from "../src/effects.js";
import { catalog, fighterInput, IDS, tableOf, wizardInput } from "./equipment-table.js";

// SRD Heroic Inspiration: one at most, spent to reroll a die. The GM gives it; a Human gains it on finishing a Long
// Rest (Resourceful); a Champion gives it to itself at the start of its turn in a fight (Heroic Warrior).

describe("Heroic Inspiration is tracked on the character", () => {
  it("comes to a Human on a Long Rest, never twice, and not to an Elf", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() }, false);
    applyRest(table.state, IDS.fighter, "short", table.resolve, catalog);
    expect(table.actor(IDS.fighter).heroicInspiration).toBe(false);
    applyRest(table.state, IDS.fighter, "long", table.resolve, catalog);
    applyRest(table.state, IDS.wizard, "long", table.resolve, catalog);
    expect(table.actor(IDS.fighter).heroicInspiration).toBe(true);
    expect(table.actor(IDS.wizard).heroicInspiration).toBe(false);
    // A day later (a Long Rest waits 16 hours after the last), another rest still leaves only the one.
    table.state.rest = { ...table.state.rest, clockHours: table.state.rest.clockHours + 24 };
    applyRest(table.state, IDS.fighter, "long", table.resolve, catalog);
    expect(table.actor(IDS.fighter).heroicInspiration).toBe(true);
  });

  it("comes to a Champion at the start of its turn when it has none", () => {
    const champion = {
      ...(loadActorFixture("player-character") as ActorDefinition),
      character: {
        classes: [{ id: "fighter", name: "Fighter", level: 10, subclass: { id: "champion", name: "Champion" } }],
        feats: [],
        features: [{ id: "heroic-warrior", kind: "subclass" as const, sourceId: "champion" }]
      }
    } as ActorDefinition;
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.fighter,
          name: "Borin",
          kind: "player-character",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          definitionId: "champion-def"
        }
      ]
    });
    const events: EffectNarration[] = [];
    const deps = {
      rollDie: () => 1,
      resolveDefinition: (id: string) => (id === "champion-def" ? champion : undefined)
    };
    startOfTurn(state, IDS.fighter, events, deps);
    expect(state.actors[0].heroicInspiration).toBe(true);
    expect(events.map((event) => event.text)).toEqual(["Borin gains Heroic Inspiration (Heroic Warrior)."]);
    startOfTurn(state, IDS.fighter, events, deps);
    expect(events).toHaveLength(1);
  });

  it("reaches only its owner's projection", () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.fighter,
          name: "Borin",
          kind: "player-character",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          ownerSessionId: "30000000-0000-4000-8000-000000000001",
          heroicInspiration: true
        }
      ]
    });
    const mine = projectPlayerView(state, "30000000-0000-4000-8000-000000000001", () => "online");
    const theirs = projectPlayerView(state, "30000000-0000-4000-8000-000000000002", () => "online");
    expect(mine.actors[0].heroicInspiration).toBe(true);
    expect(theirs.actors[0].heroicInspiration).toBeUndefined();
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("the GM gives Heroic Inspiration", () => {
  it("sets it from a GM session and refuses a player's", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-inspiration-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: GameStateSchema.parse({
        schemaVersion: 1,
        actors: [
          {
            id: IDS.fighter,
            name: "Borin",
            kind: "player-character",
            visibility: "public",
            hp: { current: 30, maximum: 30 }
          }
        ]
      })
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const path = `http://127.0.0.1:${address.port}${GAME_PATHS.actorHeroicInspiration.replace("{actorId}", IDS.fighter)}`;
    const give = (token: string, has: boolean) =>
      fetch(path, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ commandId: randomUUID(), actorId: IDS.fighter, has })
      });
    const player = server.auth.issuePlayerSession();
    expect((await give(player, true)).status).toBe(403);
    expect((await give(gmToken, true)).status).toBe(200);
    expect(server.store.snapshot.actors[0].heroicInspiration).toBe(true);
    expect((await give(gmToken, false)).status).toBe(200);
    expect(server.store.snapshot.actors[0].heroicInspiration).toBe(false);
  });
});

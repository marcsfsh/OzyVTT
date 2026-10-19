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
// Rest (Resourceful); a Champion gives it to itself at the start of its turn in a fight (Heroic Warrior). "If something
// gives you Heroic Inspiration while you already have it, the excess is lost unless you give it to a player character
// who lacks it."

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
    // The one gained over the one held is a gift to make.
    expect(table.actor(IDS.fighter).heroicInspirationToGive).toBe(true);
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

describe("a second Heroic Inspiration", () => {
  const OWNER = "30000000-0000-4000-8000-000000000001";
  const ALLY = "10000000-0000-4000-8000-00000000a11e";
  const SECOND = "10000000-0000-4000-8000-00000000a11f";
  async function table() {
    const directory = await mkdtemp(join(tmpdir(), "vtt-inspiration-"));
    const pc = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
      id,
      name,
      kind: "player-character",
      visibility: "public",
      hp: { current: 30, maximum: 30 },
      ...extra
    });
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
          pc(IDS.fighter, "Borin", { heroicInspiration: true }),
          pc(ALLY, "Lyra"),
          pc(SECOND, "Mirena", { heroicInspiration: true })
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
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, token: string, body: Record<string, unknown>) =>
      fetch(base + path.replace("{actorId}", IDS.fighter), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ commandId: randomUUID(), actorId: IDS.fighter, ...body })
      });
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, {})).status).toBe(200);
    const actor = (id: string) => server.store.snapshot.actors.find((entry) => entry.id === id)!;
    const give = (token: string, recipientId: string | null) =>
      post(GAME_PATHS.actorGiveHeroicInspiration, token, { recipientId });
    return { server, gmToken, player, post, give, actor };
  }

  it("is held as a gift its player gives to a character who has none", async () => {
    const { gmToken, player, post, give, actor } = await table();
    expect((await give(player, ALLY)).status).toBe(409);
    expect((await post(GAME_PATHS.actorHeroicInspiration, gmToken, { has: true })).status).toBe(200);
    expect(actor(IDS.fighter)).toMatchObject({ heroicInspiration: true, heroicInspirationToGive: true });
    const refused = await give(player, SECOND);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toMatch(/Mirena already has Heroic Inspiration/);
    expect((await give(player, ALLY)).status).toBe(200);
    expect(actor(ALLY).heroicInspiration).toBe(true);
    expect(actor(IDS.fighter)).toMatchObject({ heroicInspiration: true, heroicInspirationToGive: false });
  });

  it("is lost when its player lets it go", async () => {
    const { gmToken, player, post, give, actor } = await table();
    await post(GAME_PATHS.actorHeroicInspiration, gmToken, { has: true });
    expect((await give(player, null)).status).toBe(200);
    expect(actor(IDS.fighter).heroicInspirationToGive).toBe(false);
    expect(actor(ALLY).heroicInspiration).toBe(false);
  });

  it("reaches its owner alone", () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      partyVisibility: "sheet-and-resources",
      actors: [
        {
          id: IDS.fighter,
          name: "Borin",
          kind: "player-character",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          ownerSessionId: OWNER,
          heroicInspiration: true,
          heroicInspirationToGive: true
        }
      ]
    });
    expect(projectPlayerView(state, OWNER, () => "online").actors[0].heroicInspirationToGive).toBe(true);
    expect(
      projectPlayerView(state, "30000000-0000-4000-8000-000000000002", () => "online").actors[0].heroicInspirationToGive
    ).toBeUndefined();
  });
});

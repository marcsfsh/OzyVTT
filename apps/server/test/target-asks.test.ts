import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import type { ActorDefinition } from "@vtt/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { startEncounter } from "../src/encounter.js";
import { createServer } from "../src/server.js";

// Who picks a player's targets (ADR-0044): at a table where the GM does, the player's tap asks and the GM aims and
// resolves it; the server refuses the player's own aim, and the ask goes when the GM answers or the turn ends.

const HERO = "10000000-0000-4000-8000-0000000000f1";
const FOE = "10000000-0000-4000-8000-0000000000f2";
const MAP = "20000000-0000-5000-8000-000000000001";

const SWING = {
  id: "swing",
  name: "Longsword",
  activation: "action" as const,
  description: "Melee Attack Roll: +5.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d8 + 3", type: "slashing" }]
};

/** Hero against a Foe (AC 12), Hero's turn, with no map behind it. */
function fight(): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [
      {
        id: "hero-def",
        definition: {
          ...(loadActorFixture("player-character") as Record<string, unknown>),
          id: "hero-def",
          name: "Hero",
          actions: [SWING]
        } as unknown as ActorDefinition
      }
    ],
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "hero-def"
      },
      { id: FOE, name: "Foe", kind: "monster", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12 }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: MAP,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { ...state, combat: { ...state.combat, mapAssetId: null, tokens: [] } };
}

const GM_PASSWORD = "a sufficiently long GM password";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

async function boot(state: GameState) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-target-asks-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: state
  });
  await server.initialize();
  await server.auth.bootstrap(GM_PASSWORD);
  const gmToken = (await server.auth.login(GM_PASSWORD))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, token: string, body: Record<string, unknown> = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ commandId: randomUUID(), ...body })
    });
  const player = server.auth.issuePlayerSession();
  expect((await post(GAME_PATHS.claims, player, { actorId: HERO })).status).toBe(200);
  const view = async (token: string) =>
    (await (await fetch(base + "/api/v1/game", { headers: bearer(token) })).json()).data.game;
  const message = async (response: Response) => (await response.json()).error.message as string;
  return { server, gmToken, player, post, view, message };
}

const swingAt = (targets: Record<string, unknown>) => ({ actorId: HERO, actionId: "swing", ...targets });

describe("the GM picks players' targets (ADR-0044)", () => {
  it("starts with players picking, and refuses an ask there", async () => {
    const { gmToken, player, post, view, message } = await boot(fight());
    expect((await view(player)).targeting).toBe("player");
    const ask = await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "swing" });
    expect(ask.status).toBe(409);
    expect(await message(ask)).toBe("At this table you pick your own targets.");
    expect((await post(GAME_PATHS.targeting, player, { targeting: "gm" })).status).toBe(403);
    expect((await post(GAME_PATHS.targeting, gmToken, { targeting: "gm" })).status).toBe(200);
    expect((await view(player)).targeting).toBe("gm");
  });

  it("refuses the player's own aim, holds the ask for the GM, and the GM's resolve answers it", async () => {
    const { server, gmToken, player, post, view, message } = await boot(fight());
    await post(GAME_PATHS.targeting, gmToken, { targeting: "gm" });
    const aimed = await post(GAME_PATHS.actionResolve, player, swingAt({ targetIds: [FOE], commit: false }));
    expect(aimed.status).toBe(409);
    expect(await message(aimed)).toBe("The GM picks targets at this table. Choose the action and the GM aims it.");

    expect((await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "swing" })).status).toBe(200);
    const [ask] = server.store.snapshot.combat.targetAsks;
    expect(ask).toMatchObject({ actorId: HERO, actorName: "Hero", actionId: "swing", actionName: "Longsword" });
    // The player reads their own ask, and nothing more of it.
    expect((await view(player)).combat.targetAsks).toEqual([
      { id: ask!.id, actorId: HERO, actionId: "swing", actionName: "Longsword" }
    ]);
    const again = await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "swing" });
    expect(await message(again)).toBe(
      "Hero's Longsword is still waiting for the GM. Take it back to choose another action."
    );

    // The GM's look at the attack leaves the ask; the confirm answers it.
    expect(
      (await post(GAME_PATHS.actionResolve, gmToken, swingAt({ targetIds: [FOE], commit: false, attackTotal: 18 })))
        .status
    ).toBe(200);
    expect(server.store.snapshot.combat.targetAsks).toHaveLength(1);
    expect(
      (await post(GAME_PATHS.actionResolve, gmToken, swingAt({ targetIds: [FOE], commit: true, attackTotal: 18 })))
        .status
    ).toBe(200);
    expect(server.store.snapshot.combat.targetAsks).toEqual([]);
  });

  it("lets the player take an ask back, and drops one left when the turn ends", async () => {
    const { server, gmToken, player, post } = await boot(fight());
    await post(GAME_PATHS.targeting, gmToken, { targeting: "gm" });
    await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "swing" });
    const askId = server.store.snapshot.combat.targetAsks[0]!.id;
    expect((await post(GAME_PATHS.targetAskWithdraw, player, { askId })).status).toBe(200);
    expect(server.store.snapshot.combat.targetAsks).toEqual([]);

    await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "swing" });
    expect((await post(GAME_PATHS.turnEnd, gmToken)).status).toBeLessThan(300);
    expect(server.store.snapshot.combat.targetAsks).toEqual([]);
    // Off the character's turn there is nothing to ask for.
    const offTurn = await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "swing" });
    expect(offTurn.status).toBe(409);
  });

  it("refuses an action the character doesn't have", async () => {
    const { gmToken, player, post, message } = await boot(fight());
    await post(GAME_PATHS.targeting, gmToken, { targeting: "gm" });
    const unknown = await post(GAME_PATHS.targetAsk, player, { actorId: HERO, actionId: "fireball" });
    expect(await message(unknown)).toBe("That action is not on the stat block.");
  });
});

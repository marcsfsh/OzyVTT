import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { ENCOUNTER_ARCHIVE_PATHS, GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * QA — ADVERSARIAL ROLE-BOUNDARY ATTACK (director's own pass, 2026-08-04).
 *
 * Every probe plays a hostile PLAYER session against the commands this engagement added or loosened,
 * and asserts the server refuses. These are the moves a player who read the API docs would try. Each
 * asserts the CORRECT behaviour; a failure is a live privilege hole. Permanent armour.
 */

const MINE = "10000000-0000-4000-8000-0000000000c1";
const YOURS = "10000000-0000-4000-8000-0000000000c2";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function initialState() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: MINE, name: "Mine", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 } },
    { id: YOURS, name: "Yours", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 } }
  ] });
}

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-qa-auth-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: initialState()
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const get = (base: string, path: string, token: string) => fetch(base + path, { headers: bearer(token) });

/** Two player sessions; each claims their own character. */
async function twoPlayers() {
  const running = await boot();
  const me = running.server.auth.issuePlayerSession();
  const you = running.server.auth.issuePlayerSession();
  expect((await post(running.base, GAME_PATHS.claims, me, { actorId: MINE })).status).toBe(200);
  expect((await post(running.base, GAME_PATHS.claims, you, { actorId: YOURS })).status).toBe(200);
  return { ...running, me, you };
}

describe("QA attack — token image (D18/R1)", () => {
  it("lets me clear MY claimed character's token but refuses YOURS", async () => {
    const { base, me } = await twoPlayers();
    // Clearing (tokenAssetId: null) exercises the exact `canInitiateForActor(edit)` gate without an asset.
    const mine = await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", MINE), me, { commandId: randomUUID(), actorId: MINE, tokenAssetId: null });
    expect(mine.status).toBe(200);
    const yours = await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", YOURS), me, { commandId: randomUUID(), actorId: YOURS, tokenAssetId: null });
    expect(yours.status).toBe(403);
  });

  it("refuses an unclaimed character even for a player with no claim of their own", async () => {
    const { base, server } = await boot();
    const drifter = server.auth.issuePlayerSession();
    const response = await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", MINE), drifter, { commandId: randomUUID(), actorId: MINE, tokenAssetId: null });
    expect(response.status).toBe(403);
  });
});

describe("QA attack — rules ask/answer (D8/D9)", () => {
  it("refuses a player answering ANY ask — even their own, even a fabricated id", async () => {
    const { base, me } = await twoPlayers();
    const response = await post(base, GAME_PATHS.rulesAnswer, me, { commandId: randomUUID(), askId: randomUUID(), allow: true });
    expect(response.status).toBe(403);
  });

  it("refuses an ask about someone else's character", async () => {
    const { base, me, server } = await twoPlayers();
    const body = { commandId: randomUUID(), actorId: YOURS, conditionId: "prone", active: false, expectedRevision: server.store.snapshot.revision };
    const response = await post(base, GAME_PATHS.rulesAsk, me, { commandId: randomUUID(), type: "actor.set-condition", payload: body });
    expect([400, 403, 409]).toContain(response.status);
    // Whatever the refusal shape, no ask may appear in state.
    expect(server.store.snapshot.combat.pendingRuleAsks ?? []).toHaveLength(0);
  });
});

describe("QA attack — replays (D26)", () => {
  it("answers a player 404 (never 403) for an archive read, so existence is never confirmed", async () => {
    // The existence-oracle rule: a player must not be able to tell an unshared archive from a missing
    // one. Both are 404. (The existing-but-unshared projection path is covered by the archive suite;
    // here the point is that a player read never returns 403 — that alone would confirm existence.)
    const { base, me } = await twoPlayers();
    const response = await get(base, ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", "999999"), me);
    expect(response.status).toBe(404);
  });

  it("refuses a player toggling visibility or launching — the GM-grade gate fires before any lookup", async () => {
    const { base, me } = await twoPlayers();
    expect((await post(base, ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", "1"), me, { playerVisible: true })).status).toBe(403);
    expect((await post(base, ENCOUNTER_ARCHIVE_PATHS.launch.replace("{id}", "1"), me, { commandId: randomUUID(), turnIndex: 0 })).status).toBe(403);
  });
});

describe("QA attack — player create/rebuild boundaries (D13)", () => {
  it("refuses character.create from a player once the GM closes the builder to players", async () => {
    const { base, server, gmToken } = await boot();
    const player = server.auth.issuePlayerSession();
    // Default is open (D13's chosen direction). The security property is that gm-only actually shuts it.
    expect((await post(base, GAME_PATHS.builderPolicy, gmToken, { commandId: randomUUID(), allowedAbilityMethods: ["standard-array", "point-buy", "roll", "custom"], playerBuilder: "gm-only" })).status).toBe(200);
    const response = await post(base, GAME_PATHS.characters, player, { commandId: randomUUID(), request: { name: "Sneak" } });
    expect([400, 403]).toContain(response.status);
    expect(server.store.snapshot.actors.map((actor) => actor.name)).not.toContain("Sneak");
  });

  it("refuses rebuild aimed at someone else's character even with a valid-looking body", async () => {
    const { base, me } = await twoPlayers();
    const response = await post(base, GAME_PATHS.characterRebuild.replace("{actorId}", YOURS), me, { commandId: randomUUID(), actorId: YOURS, request: {} });
    expect([400, 403]).toContain(response.status);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * D14 - THE BUILDER'S DICE ARE THE SERVER'S DICE.
 *
 * The wizard used to roll ability scores with `Math.random` in the browser: the oldest server-authority
 * hole in the ledger, and one nobody at the table could see happen. The command below rolls through
 * the same authority every other die goes through and records ONE public roll in the table feed, so
 * character creation is a table event like any other.
 *
 * `character.create` deliberately keeps its bound check rather than binding scores to this roll:
 * physical dice at the table remain a supported path (the build validates that every submitted score
 * is producible by the table's formula). What is closed is client-generated randomness.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-builder-rolls-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1 })
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, playerToken: server.auth.issuePlayerSession() };
}

const ALL_METHODS = ["standard-array", "point-buy", "roll", "custom"];

describe("builder.roll-abilities", () => {
  it("rolls six scores server-side, in range, and records one public roll in the feed", async () => {
    const { base, server, gmToken } = await boot();
    const response = await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "roll" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.scores).toHaveLength(6);
    // 4d6kh3: never below 3, never above 18, and the kept dice ride along for the wizard to show.
    for (const score of body.data.scores) { expect(score).toBeGreaterThanOrEqual(3); expect(score).toBeLessThanOrEqual(18); }
    expect(body.data.dice).toHaveLength(6);
    expect(body.data.dice[0]).toHaveLength(4);

    const roll = server.store.snapshot.rolls.find((entry) => entry.id === body.data.rollId)!;
    expect(roll).toMatchObject({ label: "Ability scores", purpose: "manual", visibility: "public", actorId: null });
    expect(roll.dice).toHaveLength(24);
  });

  it("honours the table's allowed methods and the GM's custom formula", async () => {
    const { base, gmToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["standard-array"] });
    expect((await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "roll" })).status).toBe(409);

    // "custom" without a formula is refused rather than silently falling back to the SRD dice.
    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["custom"] });
    expect((await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "custom" })).status).toBe(409);

    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["custom"], customFormula: "3d6" });
    const custom = await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "custom" });
    expect(custom.status).toBe(200);
    for (const score of (await custom.json()).data.scores) { expect(score).toBeGreaterThanOrEqual(3); expect(score).toBeLessThanOrEqual(18); }
  });

  it("follows the same player-builder gate the wizard itself does", async () => {
    const { base, gmToken, playerToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ALL_METHODS, playerBuilder: "gm-only" });
    expect((await post(base, GAME_PATHS.builderRollAbilities, playerToken, { method: "roll" })).status).toBe(403);

    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ALL_METHODS, playerBuilder: "open" });
    expect((await post(base, GAME_PATHS.builderRollAbilities, playerToken, { method: "roll" })).status).toBe(200);
  });
});

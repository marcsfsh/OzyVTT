import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ENCOUNTER_ARCHIVE_PATHS, GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/**
 * End-to-end evidence for the additive table-policy surface, over the same HTTP adapter an
 * integration uses - so every claim here is proven against real authorization, real persistence and
 * the real projection, not against a hand-built state object.
 *
 * What is under test: the standing rules policy each fight inherits (D7), per-family exceptions (D6),
 * staging defaults and the one-command mid-fight add (D2), prepare-and-go plus staged-list derivation
 * (D1/D3), the archived-sheet keepsake toggle (D26), and archiving releasing a claim (D16).
 */

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** A real, schema-valid character sheet so the sheet-editing door under test has something to edit. */
const HERO_DEFINITION = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));

function initialState() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: HERO_ID, name: "Public Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, definitionId: `import-${HERO_ID}` },
    { id: SECOND_ID, name: "Second Hero", kind: "player-character", visibility: "public", hp: { current: 18, maximum: 18 }, definitionId: `import-${SECOND_ID}` }
  ], definitions: [{ id: `import-${HERO_ID}`, definition: HERO_DEFINITION }] });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-table-policy-"));
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
  const base = `http://127.0.0.1:${address.port}`;
  const imported = await server.mapAssets.import(png(900, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const snapshot = async (base: string, token: string, view?: "player") =>
  (await (await fetch(base + GAME_PATHS.snapshot + (view ? "?view=player" : ""), { headers: bearer(token) })).json()).data.game;

describe("standing rules policy (D6/D7)", () => {
  it("is GM-only, stores per-family exceptions, and does NOT retune the fight in progress", async () => {
    const { base, gmToken, server, mapAssetId } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    expect((await post(base, GAME_PATHS.rulesPolicy, playerToken, { dial: "freeform" })).status).toBe(403);

    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const accepted = await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "assisted", exceptions: { movement: "freeform" } });
    expect(accepted.status).toBe(200);

    const game = await snapshot(base, gmToken);
    expect(game.rulesPolicy).toEqual({ dial: "assisted", exceptions: { movement: "freeform" } });
    // The live fight keeps the settings it started with: policy is what the NEXT fight inherits.
    expect(game.combat.rulesMode).toBe("strict");
  });

  it("rejects a misspelled family instead of silently ignoring it", async () => {
    const { base, gmToken } = await boot();
    const response = await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "strict", exceptions: { movememt: "freeform" } });
    expect(response.status).toBe(400);
  });

  it("keeps stored exceptions when a request omits them", async () => {
    const { base, gmToken } = await boot();
    await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "strict", exceptions: { targeting: "assisted" } });
    await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "freeform" });
    expect((await snapshot(base, gmToken)).rulesPolicy).toEqual({ dial: "freeform", exceptions: { targeting: "assisted" } });
  });

  it("seeds each new fight from the policy, and lets the start command override it per fight", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "assisted", exceptions: { movement: "freeform" } });

    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const seeded = await snapshot(base, gmToken);
    expect(seeded.combat.rulesMode).toBe("assisted");
    expect(seeded.combat.ruleExceptions).toEqual({ movement: "freeform" });

    await post(base, GAME_PATHS.encounterEnd, gmToken, {});
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }], rulesMode: "strict", ruleExceptions: { slots: "strict" } });
    const overridden = await snapshot(base, gmToken);
    expect(overridden.combat.rulesMode).toBe("strict");
    expect(overridden.combat.ruleExceptions).toEqual({ slots: "strict" });
  });

  it("changes the live fight through the rules-mode command, leaving exceptions alone when omitted", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    await post(base, GAME_PATHS.rulesMode, gmToken, { mode: "assisted", exceptions: { economy: "freeform" } });
    expect((await snapshot(base, gmToken)).combat.ruleExceptions).toEqual({ economy: "freeform" });
    // An old mode-only payload still means exactly what it always meant.
    await post(base, GAME_PATHS.rulesMode, gmToken, { mode: "strict" });
    const after = await snapshot(base, gmToken);
    expect(after.combat.rulesMode).toBe("strict");
    expect(after.combat.ruleExceptions).toEqual({ economy: "freeform" });
  });

  it("shows players the table's rules configuration (it holds no secrets, exactly like rulesMode)", async () => {
    const { base, gmToken, server, mapAssetId } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }], ruleExceptions: { movement: "freeform" } });
    expect((await snapshot(base, playerToken, "player")).combat.ruleExceptions).toEqual({ movement: "freeform" });
  });
});

describe("staging defaults and the one-command mid-fight add (D2)", () => {
  it("stores the table's staging default and refuses a player", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(base, GAME_PATHS.stagingDefaults, playerToken, { visibility: "gm-only" })).status).toBe(403);
    expect((await post(base, GAME_PATHS.stagingDefaults, gmToken, { visibility: "gm-only" })).status).toBe(200);
    expect((await snapshot(base, gmToken)).stagingDefaults).toEqual({ visibility: "gm-only" });
    // GM management data: it never reaches the player projection.
    expect((await snapshot(base, gmToken, undefined)).stagingDefaults).toBeDefined();
    expect((await snapshot(base, server.auth.issuePlayerSession(), "player")).stagingDefaults).toBeUndefined();
  });

  it("lands a mid-fight add on the roster AND in the fight in one command and one revision", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const before = (await snapshot(base, gmToken)).revision;

    const commandId = randomUUID();
    expect((await post(base, GAME_PATHS.actors, gmToken, { commandId, definitionId: "giant-crocodile", joinEncounter: true })).status).toBe(200);

    const game = await snapshot(base, gmToken);
    expect(game.revision).toBe(before + 1);
    expect(game.actors.map((actor: { id: string }) => actor.id)).toContain(commandId);
    expect(game.combat.initiative.map((entry: { actorId: string }) => entry.actorId)).toContain(commandId);
    // The tray token comes with it - the whole point is that no second trip is needed.
    expect(game.combat.tokens.map((token: { actorId: string }) => token.actorId)).toContain(commandId);
  });

  it("ignores joinEncounter when no fight is running (the roster add is the whole intent)", async () => {
    const { base, gmToken } = await boot();
    const commandId = randomUUID();
    expect((await post(base, GAME_PATHS.actors, gmToken, { commandId, definitionId: "giant-crocodile", joinEncounter: true })).status).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.actors.map((actor: { id: string }) => actor.id)).toContain(commandId);
    expect(game.combat.initiative).toEqual([]);
  });
});

describe("the two doors into a fight (D1/D3)", () => {
  it("prepares and goes live in one command", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const sceneId = randomUUID();
    expect((await post(base, GAME_PATHS.scenes, gmToken, { commandId: sceneId, name: "Ambush", mapAssetId, combatantIds: [HERO_ID], activate: true })).status).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.combat.activeSceneId).toBe(sceneId);
    expect(game.combat.initiative.map((entry: { actorId: string }) => entry.actorId)).toEqual([HERO_ID]);
    // The active scene's own slot stays empty - its live copy IS the top-level combat.
    expect(game.combat.scenes.find((scene: { id: string }) => scene.id === sceneId).combat.initiative).toEqual([]);
  });

  it("still only prepares when activate is absent", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const sceneId = randomUUID();
    await post(base, GAME_PATHS.scenes, gmToken, { commandId: sceneId, name: "Later", mapAssetId, combatantIds: [HERO_ID] });
    const game = await snapshot(base, gmToken);
    expect(game.combat.activeSceneId).toBeNull();
    expect(game.combat.initiative).toEqual([]);
  });

  it("starts on the live scene's staged list when the request omits the combatants", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const sceneId = randomUUID();
    await post(base, GAME_PATHS.scenes, gmToken, { commandId: sceneId, name: "Ambush", mapAssetId, combatantIds: [HERO_ID, SECOND_ID], activate: true });
    expect((await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId })).status).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.combat.active).toBe(true);
    expect(game.combat.initiative.map((entry: { actorId: string }) => entry.actorId).sort()).toEqual([HERO_ID, SECOND_ID].sort());
  });

  it("refuses to start with no combatants at all rather than inventing a roster", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const response = await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/Choose 1 to 200 combatants/);
  });

  it("keeps the right refusal when a fight is already running (derivation must not mask it)", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const response = await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/End the active encounter/);
  });
});

describe("archived characters: sharing and claims (D16/D26)", () => {
  it("archiving a claimed character releases the claim, so its player is not locked out invisibly", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(base, GAME_PATHS.claims, playerToken, { actorId: HERO_ID })).status).toBe(200);

    expect((await post(base, GAME_PATHS.actorArchived.replace("{actorId}", HERO_ID), gmToken, { archived: true })).status).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.actors.find((actor: { id: string }) => actor.id === HERO_ID).ownerSessionId).toBeNull();

    // ...and the player can claim someone else, which the stale claim used to prevent.
    expect((await post(base, GAME_PATHS.claims, playerToken, { actorId: SECOND_ID })).status).toBe(200);
  });

  it("refuses a claim on an archived character over the wire", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.actorArchived.replace("{actorId}", HERO_ID), gmToken, { archived: true });
    const refused = await post(base, GAME_PATHS.claims, playerToken, { actorId: HERO_ID });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toBe("Character is unavailable.");
  });

  it("shares an archived sheet only when the GM says so, and only ever its name", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.actorArchived.replace("{actorId}", HERO_ID), gmToken, { archived: true });
    expect((await snapshot(base, playerToken, "player")).archivedCharacters).toEqual([]);

    expect((await post(base, GAME_PATHS.actorSheetPreview.replace("{actorId}", HERO_ID), gmToken, { enabled: true })).status).toBe(200);
    const shared = await snapshot(base, playerToken, "player");
    expect(shared.archivedCharacters).toEqual([{ id: HERO_ID, name: "Public Hero" }]);
    // Still absent from the roster itself - archived means out of play, shared or not.
    expect(shared.actors.map((actor: { id: string }) => actor.id)).not.toContain(HERO_ID);

    await post(base, GAME_PATHS.actorSheetPreview.replace("{actorId}", HERO_ID), gmToken, { enabled: false });
    expect((await snapshot(base, playerToken, "player")).archivedCharacters).toEqual([]);
  });

  it("keeps the sheet-preview toggle GM-only", async () => {
    const { base, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(base, GAME_PATHS.actorSheetPreview.replace("{actorId}", HERO_ID), playerToken, { enabled: true })).status).toBe(403);
  });
});

describe("per-replay sharing (D26)", () => {
  it("stores an archive's visibility, defaults to hidden, and 404s an unknown archive", async () => {
    const { base, gmToken, server, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    await post(base, GAME_PATHS.encounterEnd, gmToken, {});

    const listed = (await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(gmToken) })).json()).data.encounters;
    expect(listed).toHaveLength(1);
    // Hidden until shared: an ended fight is the GM's record until the GM says otherwise.
    expect(listed[0].playerVisible).toBe(false);

    const path = ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(listed[0].id));
    expect((await post(base, path, gmToken, { playerVisible: true })).status).toBe(200);
    expect((await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(gmToken) })).json()).data.encounters[0].playerVisible).toBe(true);

    expect((await post(base, ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", "9999"), gmToken, { playerVisible: true })).status).toBe(404);
    expect((await post(base, path, gmToken, { playerVisible: "yes" })).status).toBe(400);
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(base, path, playerToken, { playerVisible: true })).status).toBe(403);
  });
});

describe("the table's level cap (A6)", () => {
  it("is stored on the builder policy, projected to players, and refuses a sheet edit above it", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["standard-array"], maxLevel: 5 });
    expect((await snapshot(base, playerToken, "player")).builderPolicy.maxLevel).toBe(5);

    // The sheet's free-text identity editor is the OTHER door into a character's level; it must not
    // be able to walk past the cap the guided builder enforces.
    const identityPath = GAME_PATHS.characterSetIdentity.replace("{actorId}", HERO_ID);
    const refused = await post(base, identityPath, gmToken, { character: { classes: [{ id: "fighter", name: "Fighter", level: 9 }], feats: [] } });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toMatch(/up to level 5/);
  });
});

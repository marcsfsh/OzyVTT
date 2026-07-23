import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { CONTENT_PATHS, ENCOUNTER_ARCHIVE_PATHS, GAME_PATHS, GameCommandCatalogResponseSchema, GameLogResponseSchema, GameMutationAcceptedResponseSchema, GameSnapshotResponseSchema, EncounterArchiveListResponseSchema, openApiDocument, PlayerSessionIssuedResponseSchema, SESSION_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_COMMAND_SCOPES } from "../src/game-commands.js";
import { createServer } from "../src/server.js";

/**
 * ADR-0016 validation evidence, end to end over plain fetch: an external process creates a scoped
 * credential, discovers capabilities, reads a safe snapshot, submits and safely retries idempotent
 * commands, hits stale-revision and confirmation conflicts, and loses access on revocation - while
 * the hidden combatant never leaks through any player-safe response.
 */

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const SECRET_ID = "10000000-0000-4000-8000-000000000002";

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

function initialState() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: HERO_ID, name: "Public Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, notes: "Player-safe actor" },
    { id: SECRET_ID, name: "Unrevealed Tyrant", kind: "monster", visibility: "gm-only", hp: { current: 99, maximum: 99 }, notes: "Secret lair and tactics" }
  ] });
}

type Running = { base: string; server: ReturnType<typeof createServer>; directory: string; gmToken: string };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function boot(): Promise<Running> {
  const directory = await mkdtemp(join(tmpdir(), "vtt-game-http-"));
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
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base, server, directory, gmToken };
}

async function bootWithBattlemap() {
  const running = await boot();
  const imported = await running.server.mapAssets.import(png(900, 600), "arena.png");
  running.server.mapCatalog.register(imported.metadata.id, "API Arena", "battlemap");
  return { ...running, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
/** Issue an integration credential over the documented GM endpoint - the same door an external tool uses. */
async function issueCredential(base: string, gmToken: string, name: string, scopes: readonly string[]) {
  const response = await post(base, "/api/v1/gm/integration-credentials", gmToken, { name, scopes });
  expect(response.status).toBe(201);
  const body = await response.json();
  return { token: body.data.token as string, id: body.data.credential.id as string };
}

describe("public game API over /api/v1", () => {
  it("serves GM-full and player-safe snapshots by principal, with ETag polling and no hidden-actor leaks", async () => {
    const { base, server, gmToken } = await boot();
    const integration = await issueCredential(base, gmToken, "reader", ["game:read"]);
    const playerToken = server.auth.issuePlayerSession();

    const unauthenticated = await fetch(base + GAME_PATHS.snapshot);
    expect(unauthenticated.status).toBe(401);

    // Integration with game:read gets the FULL GM projection by default...
    const gmGrade = await fetch(base + GAME_PATHS.snapshot, { headers: bearer(integration.token) });
    expect(gmGrade.status).toBe(200);
    const gmBody = GameSnapshotResponseSchema.parse(await gmGrade.json());
    expect(gmBody.data.view).toBe("gm");
    expect(JSON.stringify(gmBody.data.game)).toContain(SECRET_ID);

    // ...and can explicitly ask for the player-safe projection for overlay use.
    const overlay = await fetch(base + GAME_PATHS.snapshot + "?view=player", { headers: bearer(integration.token) });
    const overlayBody = GameSnapshotResponseSchema.parse(await overlay.json());
    expect(overlayBody.data.view).toBe("player");
    const overlaySerialized = JSON.stringify(overlayBody.data.game);
    expect(overlaySerialized).not.toContain(SECRET_ID);
    expect(overlaySerialized).not.toContain("Unrevealed Tyrant");
    expect(overlaySerialized).not.toContain("Secret lair");

    // A player session ALWAYS gets the player view, even asking for gm.
    const player = await fetch(base + GAME_PATHS.snapshot + "?view=gm", { headers: bearer(playerToken) });
    const playerBody = GameSnapshotResponseSchema.parse(await player.json());
    expect(playerBody.data.view).toBe("player");
    expect(JSON.stringify(playerBody.data.game)).not.toContain(SECRET_ID);

    // Revision-derived weak ETag: matching If-None-Match polls for free.
    const etag = gmGrade.headers.get("etag");
    expect(etag).toMatch(/^W\/"game-r\d+-gm"$/);
    const unchanged = await fetch(base + GAME_PATHS.snapshot, { headers: { ...bearer(integration.token), "if-none-match": etag! } });
    expect(unchanged.status).toBe(304);

    // The player view's ETag differs (same revision, different projection).
    expect(player.headers.get("etag")).toMatch(/^W\/"game-r\d+-player"$/);
  });

  it("runs the whole combat loop over typed REST routes with idempotent retries and revision conflicts", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const writer = await issueCredential(base, gmToken, "combat bot", ["game:read", "combat:write", "actor:write", "roll:create"]);

    // Start the encounter (integration credential, GM authority).
    const startId = randomUUID();
    const started = await post(base, GAME_PATHS.encounterStart, writer.token, { commandId: startId, mapAssetId, entries: [{ actorId: HERO_ID, score: 12 }], expectedRevision: 0 });
    expect(started.status).toBe(200);
    const startedBody = GameMutationAcceptedResponseSchema.parse(await started.json());
    expect(startedBody.data).toMatchObject({ commandId: startId, revision: 1, duplicate: false });

    // Retrying the same commandId is an idempotent duplicate, not a re-execution.
    const retried = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.encounterStart, writer.token, { commandId: startId, mapAssetId, entries: [{ actorId: HERO_ID, score: 12 }], expectedRevision: 0 })).json());
    expect(retried.data).toMatchObject({ commandId: startId, duplicate: true });

    // A stale expectedRevision is refused with the live revision attached.
    const stale = await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), writer.token, { amount: 5, expectedRevision: 0 });
    expect(stale.status).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.error.code).toBe("conflict");
    expect(staleBody.error.currentRevision).toBe(1);

    // Damage, heal, temp HP, set HP, condition - the actor routes.
    const damaged = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), writer.token, { amount: 7 })).json());
    expect(damaged.data.duplicate).toBe(false);
    await post(base, GAME_PATHS.actorHeal.replace("{actorId}", HERO_ID), writer.token, { amount: 2 });
    await post(base, GAME_PATHS.actorTempHp.replace("{actorId}", HERO_ID), writer.token, { amount: 4 });
    const condition = await post(base, GAME_PATHS.actorConditions.replace("{actorId}", HERO_ID), writer.token, { conditionId: "prone", active: true });
    expect(condition.status).toBe(200);

    // Dice roll returns the recorded rollId; retry returns the SAME roll.
    const rollId = randomUUID();
    const rolled = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.rolls, writer.token, { commandId: rollId, formula: "2d6+3", purpose: "check", visibility: "public" })).json());
    expect(typeof rolled.data.rollId).toBe("string");
    const rolledAgain = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.rolls, writer.token, { commandId: rollId, formula: "2d6+3", purpose: "check", visibility: "public" })).json());
    expect(rolledAgain.data).toMatchObject({ duplicate: true, rollId: rolled.data.rollId });

    // Turn economy + token to tray + end turn.
    await post(base, GAME_PATHS.turnUse, writer.token, { slot: "action", used: true });
    const moved = await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), writer.token, { position: null });
    expect(moved.status).toBe(200);
    const endedTurn = await post(base, GAME_PATHS.turnEnd, writer.token, {});
    expect(endedTurn.status).toBe(200);

    // The state reflects all of it through the same projection the table sees.
    const snapshot = GameSnapshotResponseSchema.parse(await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(writer.token) })).json());
    const hero = (snapshot.data.game as { actors: Array<{ id: string; hp: { current: number; temporary: number }; conditions?: unknown[] }> }).actors.find((actor) => actor.id === HERO_ID)!;
    expect(hero.hp.current).toBe(15); // 20 - 7 + 2
    expect(hero.hp.temporary).toBe(4);
    expect(server.store.snapshot.combat.round).toBeGreaterThanOrEqual(1);
  });

  it("enforces scopes, roles, and revocation exactly like the table does", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const readOnly = await issueCredential(base, gmToken, "read only", ["game:read", "combat:read"]);
    const playerToken = server.auth.issuePlayerSession();

    // Scope enforcement: a read-only credential cannot write.
    const denied = await post(base, GAME_PATHS.encounterStart, readOnly.token, { mapAssetId, entries: [{ actorId: HERO_ID }] });
    expect(denied.status).toBe(403);

    // Role enforcement: a player session hits the exact same denial the socket gives.
    const playerDenied = await post(base, GAME_PATHS.encounterStart, playerToken, { mapAssetId, entries: [{ actorId: HERO_ID }] });
    expect(playerDenied.status).toBe(403);
    expect((await playerDenied.json()).error.message).toBe("Only the GM can start an encounter.");

    // Player sessions may use player-permitted commands... but only within their own authority.
    const start = await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    expect(start.status).toBe(200);
    const foreignDamage = await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), playerToken, { amount: 3 });
    expect(foreignDamage.status).toBe(409); // unclaimed character → same reducer rejection as the table
    const move = await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), playerToken, { position: null });
    expect(move.status).toBe(409);
    expect((await move.json()).error.message).toBe("You may only move your claimed character token.");

    // Malformed input → validation envelope with issues.
    const malformed = await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), gmToken, { amount: -2 });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("validation_failed");

    // Revocation cuts access immediately.
    const revoked = await post(base, `/api/v1/gm/integration-credentials/${readOnly.id}/revoke`, gmToken);
    expect(revoked.status).toBe(200);
    const afterRevoke = await fetch(base + GAME_PATHS.snapshot, { headers: bearer(readOnly.token) });
    expect(afterRevoke.status).toBe(403);
  });

  it("exposes the generic command tunnel with a discoverable catalog and per-command scopes", async () => {
    const { base, gmToken, mapAssetId } = await bootWithBattlemap();
    const bot = await issueCredential(base, gmToken, "tunnel bot", ["system:read", "combat:write", "actor:write"]);

    // Catalog lists every command with its scope.
    const catalog = GameCommandCatalogResponseSchema.parse(await (await fetch(base + GAME_PATHS.commands, { headers: bearer(bot.token) })).json());
    const types = catalog.data.commands.map((command) => command.type);
    expect(types).toContain("encounter.start");
    expect(types).toContain("actor.apply-damage");
    expect(types).toContain("dice.roll");
    expect(catalog.data.commands.find((command) => command.type === "dice.roll")?.scope).toBe("roll:create");

    // Unknown type → 404 with the available list.
    const unknown = await post(base, GAME_PATHS.commands, bot.token, { type: "not.a-command" });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.details.availableTypes).toContain("encounter.start");

    // The tunnel dispatches through the same operations as the typed routes.
    const viaTunnel = await post(base, GAME_PATHS.commands, bot.token, { type: "encounter.start", payload: { mapAssetId, entries: [{ actorId: HERO_ID, score: 15 }] } });
    expect(viaTunnel.status).toBe(200);
    const tunnelBody = GameMutationAcceptedResponseSchema.parse(await viaTunnel.json());
    expect(tunnelBody.data.type).toBe("encounter.start");
    expect(tunnelBody.data.revision).toBe(1);

    // Scope is looked up per command type: this credential lacks roll:create.
    const noScope = await post(base, GAME_PATHS.commands, bot.token, { type: "dice.roll", payload: { formula: "1d20", purpose: "check", visibility: "public" } });
    expect(noScope.status).toBe(403);

    const damage = await post(base, GAME_PATHS.commands, bot.token, { type: "actor.apply-damage", payload: { actorId: HERO_ID, amount: 4 } });
    expect(GameMutationAcceptedResponseSchema.parse(await damage.json()).data.duplicate).toBe(false);
  });

  it("returns needsConfirm conflicts for timeline rewrites, mirroring the table's confirmation flow", async () => {
    const { base, gmToken, mapAssetId } = await bootWithBattlemap();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }, { actorId: SECRET_ID, score: 5 }] });
    await post(base, GAME_PATHS.initiativeNext, gmToken, {}); // capture + advance
    await post(base, GAME_PATHS.initiativePrevious, gmToken, {}); // rewind
    await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), gmToken, { amount: 3 }); // dirty the reviewed turn

    const blocked = await post(base, GAME_PATHS.initiativeNext, gmToken, {});
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json();
    expect(blockedBody.error.details.needsConfirm).toBe("rewrite-history");

    const confirmed = await post(base, GAME_PATHS.initiativeNext, gmToken, { confirmRewrite: true });
    expect(confirmed.status).toBe(200);
  });

  it("serves content reads and the combat log with the same audience rules as the table", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const reader = await issueCredential(base, gmToken, "content reader", ["game:read", "combat:read"]);
    const playerToken = server.auth.issuePlayerSession();

    const monsters = await fetch(base + CONTENT_PATHS.monsters, { headers: bearer(reader.token) });
    expect(monsters.status).toBe(200);
    const monstersBody = await monsters.json();
    expect(monstersBody.data.monsters.length).toBeGreaterThan(100);
    expect(typeof monstersBody.data.attribution).toBe("string");
    const firstId = monstersBody.data.monsters[0].id as string;

    const sheet = await fetch(base + CONTENT_PATHS.monsterById.replace("{definitionId}", firstId), { headers: bearer(reader.token) });
    expect(sheet.status).toBe(200);
    expect((await sheet.json()).data.definition.name).toBeDefined();
    const actions = await fetch(base + CONTENT_PATHS.monsterActions.replace("{definitionId}", firstId), { headers: bearer(reader.token) });
    expect(actions.status).toBe(200);
    const missing = await fetch(base + CONTENT_PATHS.monsterById.replace("{definitionId}", "no-such-monster"), { headers: bearer(reader.token) });
    expect(missing.status).toBe(404);

    // Players may read conditions (public reference) but not the bestiary.
    expect((await fetch(base + CONTENT_PATHS.conditions, { headers: bearer(playerToken) })).status).toBe(200);
    expect((await fetch(base + CONTENT_PATHS.monsters, { headers: bearer(playerToken) })).status).toBe(403);

    // Combat log: GM-only lines reach GM-grade principals, never player sessions.
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }, { actorId: SECRET_ID, score: 20 }] });
    const gmLog = GameLogResponseSchema.parse(await (await fetch(base + GAME_PATHS.log, { headers: bearer(reader.token) })).json());
    expect(gmLog.data.entries.some((entry) => entry.gmOnly)).toBe(true); // hidden Tyrant's turn line is GM-only
    const playerLog = GameLogResponseSchema.parse(await (await fetch(base + GAME_PATHS.log, { headers: bearer(playerToken) })).json());
    expect(playerLog.data.entries.every((entry) => !entry.gmOnly)).toBe(true);
    expect(JSON.stringify(playerLog.data.entries)).not.toContain("Unrevealed Tyrant");

    const badLimit = await fetch(base + GAME_PATHS.log + "?limit=0", { headers: bearer(reader.token) });
    expect(badLimit.status).toBe(400);
  });

  it("serves the enriched Time Machine archives under /api/v1 with scope + GM-grade gating", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const reader = await issueCredential(base, gmToken, "archivist", ["combat:read"]);
    const admin = await issueCredential(base, gmToken, "janitor", ["admin"]);
    const playerToken = server.auth.issuePlayerSession();

    // Run a short fight over the API: start → roll → damage → next → end.
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }, { actorId: SECRET_ID, score: 20 }] });
    await post(base, GAME_PATHS.rolls, gmToken, { formula: "1d20+5", purpose: "attack", visibility: "public" });
    await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), gmToken, { amount: 6 });
    await post(base, GAME_PATHS.initiativeNext, gmToken, {});
    await post(base, GAME_PATHS.encounterEnd, gmToken, {});

    const list = EncounterArchiveListResponseSchema.parse(await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(reader.token) })).json());
    expect(list.data.encounters).toHaveLength(1);
    const id = list.data.encounters[0].id;

    // Player sessions are shut out entirely (the document holds hidden-combatant state).
    expect((await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(playerToken) })).status).toBe(403);
    expect((await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { headers: bearer(playerToken) })).status).toBe(403);

    const documentResponse = await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { headers: bearer(reader.token) });
    expect(documentResponse.status).toBe(200);
    const envelope = await documentResponse.json();
    expect(envelope.ok).toBe(true);
    const document = envelope.data.document;
    // The v3 document: turns, log, complete journal (start..end), final + post-encounter states, dice, and the fight's stat blocks.
    expect(document.archiveSchemaVersion).toBe(3);
    expect(document.postEncounterState.combat.active).toBe(false);
    expect(document.turns.length).toBeGreaterThan(0);
    expect(document.journal.map((entry: { type: string }) => entry.type)).toEqual(["encounter.start", "dice.roll", "actor.apply-damage", "initiative.next", "encounter.end"]);
    expect(document.journal.every((entry: { principal: string }) => entry.principal.startsWith("gm:"))).toBe(true);
    expect(document.finalState.combat.active).toBe(true);
    expect(document.rolls.length).toBe(1);
    expect(document.rolls[0].formula).toBe("1d20+5");

    // Deletion needs the admin scope (or a GM session) - combat:read cannot destroy the record.
    expect((await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { method: "DELETE", headers: bearer(reader.token) })).status).toBe(403);
    const deleted = await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { method: "DELETE", headers: bearer(admin.token) });
    expect(deleted.status).toBe(200);
    expect((await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { method: "DELETE", headers: bearer(admin.token) })).status).toBe(404);

    // The legacy GM-session endpoints keep working unchanged.
    expect(await (await fetch(`${base}/api/gm/encounters`, { headers: { authorization: `Bearer ${gmToken}` } })).json()).toEqual({ encounters: [] });
  });

  it("issues player sessions over HTTP and runs the claim lifecycle end to end", async () => {
    const { base, gmToken } = await boot();
    const integration = await issueCredential(base, gmToken, "seat manager", ["game:read", "actor:write"]);

    // Two players join over pure HTTP - the socketless mirror of the open LAN join.
    const seatA = PlayerSessionIssuedResponseSchema.parse(await (await fetch(base + SESSION_PATHS.player, { method: "POST" })).json());
    const seatB = PlayerSessionIssuedResponseSchema.parse(await (await fetch(base + SESSION_PATHS.player, { method: "POST" })).json());
    expect(seatA.data.sessionId).not.toBe(seatB.data.sessionId);

    // A claims the hero; B is refused; A shows up as owner in the GM view.
    const claimed = await post(base, GAME_PATHS.claims, seatA.data.token, { actorId: HERO_ID });
    expect(claimed.status).toBe(200);
    const contested = await post(base, GAME_PATHS.claims, seatB.data.token, { actorId: HERO_ID });
    expect(contested.status).toBe(409);
    expect((await contested.json()).error.message).toBe("That character is already claimed.");
    const view = GameSnapshotResponseSchema.parse(await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(integration.token) })).json());
    expect((view.data.game as { actors: Array<{ id: string; ownerSessionId: string | null }> }).actors.find((actor) => actor.id === HERO_ID)?.ownerSessionId).toBe(seatA.data.sessionId);

    // Claimed player can act on their character over HTTP; GM-grade principals cannot claim.
    expect((await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), seatA.data.token, { amount: 2 })).status).toBe(200);
    const gmClaim = await post(base, GAME_PATHS.claims, gmToken, { actorId: HERO_ID });
    expect(gmClaim.status).toBe(403);
    expect((await gmClaim.json()).error.message).toBe("GM sessions do not claim player characters.");

    // Force-release via an actor:write integration, then A releases nothing further; B claims freely.
    expect((await post(base, GAME_PATHS.claimForceRelease.replace("{actorId}", HERO_ID), integration.token, {})).status).toBe(200);
    expect((await post(base, GAME_PATHS.claimsRelease, seatA.data.token, {})).status).toBe(200);
    expect((await post(base, GAME_PATHS.claims, seatB.data.token, { actorId: HERO_ID })).status).toBe(200);
  });

  it("stages, edits, activates, and removes scenes over HTTP with the scene:write scope", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const stager = await issueCredential(base, gmToken, "scene stager", ["game:read", "scene:write"]);
    const noScope = await issueCredential(base, gmToken, "combat only", ["combat:write"]);

    // Wrong scope → 403; wrong map kind → 409 with the table's message.
    expect((await post(base, GAME_PATHS.scenes, noScope.token, { name: "Nope", mapAssetId, combatantIds: [] })).status).toBe(403);
    const otherMap = await server.mapAssets.import(png(600, 400), "world.png");
    server.mapCatalog.register(otherMap.metadata.id, "World", "world");
    const wrongKind = await post(base, GAME_PATHS.scenes, stager.token, { name: "Nope", mapAssetId: otherMap.metadata.id, combatantIds: [] });
    expect(wrongKind.status).toBe(409);
    expect((await wrongKind.json()).error.message).toBe("Prepare scenes on an uploaded battlemap.");

    // Create → rename → set combatants → activate → the live table now runs this scene's map.
    const created = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.scenes, stager.token, { name: "Ambush", mapAssetId, combatantIds: [HERO_ID] })).json());
    const sceneId = created.data.sceneId as string;
    expect((await post(base, GAME_PATHS.sceneRename.replace("{sceneId}", sceneId), stager.token, { name: "Bridge Ambush" })).status).toBe(200);
    expect((await post(base, GAME_PATHS.sceneCombatants.replace("{sceneId}", sceneId), stager.token, { combatantIds: [HERO_ID, SECRET_ID] })).status).toBe(200);
    expect((await post(base, GAME_PATHS.sceneActivate.replace("{sceneId}", sceneId), stager.token, {})).status).toBe(200);
    expect(server.store.snapshot.combat.activeSceneId).toBe(sceneId);
    expect(server.store.snapshot.combat.mapAssetId).toBe(mapAssetId);
    // Bridge: going live also presents the scene's map on the shared screen (enabled), in one action.
    expect(server.viewerPresentation.snapshot).toMatchObject({ enabled: true, activeMap: { assetId: mapAssetId } });

    // The active scene refuses removal; a second prepared scene deletes fine.
    const removeActive = await fetch(base + GAME_PATHS.sceneById.replace("{sceneId}", sceneId), { method: "DELETE", headers: bearer(stager.token) });
    expect(removeActive.status).toBe(409);
    const spare = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.scenes, stager.token, { name: "Spare", mapAssetId, combatantIds: [] })).json());
    expect((await fetch(base + GAME_PATHS.sceneById.replace("{sceneId}", spare.data.sceneId as string), { method: "DELETE", headers: bearer(stager.token) })).status).toBe(200);

    // Cosmetics: size + clearing a token image, via the same actor routes namespace.
    const cosmetics = await issueCredential(base, gmToken, "cosmetics", ["actor:write"]);
    expect((await post(base, GAME_PATHS.actorSize.replace("{actorId}", HERO_ID), cosmetics.token, { size: "large" })).status).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO_ID)?.sizeCells).toBe(2);
    expect((await post(base, GAME_PATHS.actorVisibility.replace("{actorId}", HERO_ID), cosmetics.token, { visibility: "gm-only" })).status).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO_ID)?.visibility).toBe("gm-only");
    expect((await post(base, GAME_PATHS.actorVisibility.replace("{actorId}", HERO_ID), cosmetics.token, { visibility: "public" })).status).toBe(200);
    expect((await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", HERO_ID), cosmetics.token, { tokenAssetId: null })).status).toBe(200);
    // Table roll preference is a combat:write command.
    const combatPref = await issueCredential(base, gmToken, "roll pref", ["combat:write"]);
    expect((await post(base, GAME_PATHS.rollMode, combatPref.token, { mode: "manual" })).status).toBe(200);
    expect(server.store.snapshot.combat.rollMode).toBe("manual");
  });

  it("narrates token movement into the combat log with distances, keeping hidden ranges GM-only", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    // 50px cells at 5 ft each: cell (c,r) center = (25 + 50c, 25 + 50r).
    server.mapCatalog.saveCalibration(mapAssetId, { calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }, verifiedAt: null, verificationPoint: null, verificationErrorPx: null });
    const reader = await issueCredential(base, gmToken, "log reader", ["combat:read"]);
    const playerToken = server.auth.issuePlayerSession();

    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }, { actorId: SECRET_ID, score: 5 }] });
    // Tokens auto-place on encounter start; pin both to known cells, then make the studied move.
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), gmToken, { position: { x: 25, y: 25 } });
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", SECRET_ID), gmToken, { position: { x: 25, y: 125 } });
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), gmToken, { position: { x: 225, y: 25 } });

    const gmLog = GameLogResponseSchema.parse(await (await fetch(base + GAME_PATHS.log, { headers: bearer(reader.token) })).json());
    const movement = gmLog.data.entries.filter((entry) => entry.kind === "movement");
    // The studied move: 4 cells = 20 ft, with the hidden Tyrant's ranges split into a GM-only line.
    expect(movement.map((entry) => entry.text)).toContain("Public Hero moved 20 ft.");
    expect(movement.map((entry) => entry.text)).toContain("Hidden ranges for Public Hero - Unrevealed Tyrant 10 ft → 20 ft.");
    expect(movement.find((entry) => entry.text.startsWith("Hidden ranges"))?.gmOnly).toBe(true);

    // Players get the public movement lines but never the hidden ranges.
    const playerLog = GameLogResponseSchema.parse(await (await fetch(base + GAME_PATHS.log, { headers: bearer(playerToken) })).json());
    const playerMovement = playerLog.data.entries.filter((entry) => entry.kind === "movement");
    expect(playerMovement.some((entry) => entry.text === "Public Hero moved 20 ft.")).toBe(true);
    expect(JSON.stringify(playerLog.data.entries)).not.toContain("Unrevealed Tyrant");

    // The narration rides the fight into its Time Machine archive.
    await post(base, GAME_PATHS.encounterEnd, gmToken, {});
    const archives = EncounterArchiveListResponseSchema.parse(await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(gmToken) })).json());
    const archived = await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(archives.data.encounters[0].id)), { headers: bearer(gmToken) })).json();
    expect(JSON.stringify(archived.data.document.log)).toContain("Public Hero moved 20 ft.");
  });

  it("answers CORS preflights for /api/v1 only - never for the legacy session/login endpoints", async () => {
    const { base } = await boot();
    const preflight = await fetch(base + GAME_PATHS.snapshot, { method: "OPTIONS", headers: { origin: "https://overlay.example", "access-control-request-method": "GET", "access-control-request-headers": "authorization" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const health = await fetch(`${base}/api/v1/system/health`, { headers: { origin: "https://overlay.example" } });
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
    expect(health.headers.get("access-control-expose-headers")).toContain("etag");

    // The password endpoint must stay same-origin: wildcard CORS there would let any web page
    // relay password guesses through a browser on the LAN and read the outcome.
    const loginPreflight = await fetch(`${base}/api/gm/login`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(loginPreflight.headers.get("access-control-allow-origin")).toBeNull();
    const loginPost = await fetch(`${base}/api/gm/login`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
    expect(loginPost.headers.get("access-control-allow-origin")).toBeNull();
    const legacyState = await fetch(`${base}/api/state`, { headers: { origin: "https://evil.example" } });
    expect(legacyState.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves server-computed action availability with role gating", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    // Roster a bundled crocodile; the response's actorId equals the commandId.
    const commandId = randomUUID();
    const added = GameMutationAcceptedResponseSchema.parse(await (await post(base, GAME_PATHS.actors, gmToken, { commandId, definitionId: "giant-crocodile" })).json());
    const crocId = added.data.actorId as string;

    const path = GAME_PATHS.actorAvailableActions.replace("{actorId}", crocId);
    expect((await fetch(base + path)).status).toBe(401);
    // A player who hasn't claimed this actor is refused - availability names stat-block internals.
    expect((await fetch(base + path, { headers: bearer(playerToken) })).status).toBe(403);
    expect((await fetch(base + GAME_PATHS.actorAvailableActions.replace("{actorId}", randomUUID()), { headers: bearer(gmToken) })).status).toBe(404);

    const body = await (await fetch(base + path, { headers: bearer(gmToken) })).json();
    expect(body.ok).toBe(true);
    expect(body.data.rulesMode).toBe("strict");
    const rows = body.data.actions as ReadonlyArray<{ id: string; available: boolean; violations: readonly unknown[]; builtin?: boolean }>;
    // Stat-block rows first, then the SRD builtin generic actions flagged builtin: true.
    expect(rows.filter((row) => !row.builtin).map((row) => row.id).sort()).toEqual(["bite", "multiattack", "tail"]);
    for (const id of ["dodge", "dash", "disengage", "help", "hide", "ready", "unarmed-grapple", "escape-grapple"]) {
      expect(rows.find((row) => row.id === id)?.builtin).toBe(true);
    }
    // No encounter running: nothing is spent, so everything reports available with no violations.
    expect(rows.every((row) => row.available && row.violations.length === 0)).toBe(true);
  });

  it("keeps the OpenAPI-documented scopes identical to the runtime command scopes (no drift between doc, tunnel, and typed routes)", () => {
    const TYPED_ROUTES: ReadonlyArray<[string, "post" | "delete", keyof typeof GAME_COMMAND_SCOPES]> = [
      [GAME_PATHS.encounterStart, "post", "encounter.start"],
      [GAME_PATHS.encounterEnd, "post", "encounter.end"],
      [GAME_PATHS.encounterCombatants, "post", "encounter.add-combatant"],
      [GAME_PATHS.initiativeSet, "post", "initiative.set"],
      [GAME_PATHS.initiativeNext, "post", "initiative.next"],
      [GAME_PATHS.initiativePrevious, "post", "initiative.previous"],
      [GAME_PATHS.turnEnd, "post", "turn.end"],
      [GAME_PATHS.turnUse, "post", "turn.use"],
      [GAME_PATHS.turnReaction, "post", "turn.use-reaction"],
      [GAME_PATHS.turnLegendary, "post", "turn.use-legendary"],
      [GAME_PATHS.tokenMove, "post", "token.move"],
      [GAME_PATHS.actors, "post", "actor.add-from-definition"],
      [GAME_PATHS.actorById, "delete", "actor.remove"],
      [GAME_PATHS.actorDamage, "post", "actor.apply-damage"],
      [GAME_PATHS.actorHeal, "post", "actor.heal"],
      [GAME_PATHS.actorTempHp, "post", "actor.set-temp-hp"],
      [GAME_PATHS.actorHp, "post", "actor.set-hp"],
      [GAME_PATHS.actorConditions, "post", "actor.set-condition"],
      [GAME_PATHS.definitionsImport, "post", "actor.import-definition"],
      [GAME_PATHS.rolls, "post", "dice.roll"],
      [GAME_PATHS.actionResolve, "post", "action.resolve"],
      [GAME_PATHS.saveAnswer, "post", "save.answer"],
      [GAME_PATHS.saveDismiss, "post", "save.dismiss"],
      [GAME_PATHS.reactionAnswer, "post", "reaction.answer"],
      [GAME_PATHS.reactionDismiss, "post", "reaction.dismiss"],
      [GAME_PATHS.effects, "post", "effect.add"],
      [GAME_PATHS.effectEnd, "post", "effect.end"],
      [GAME_PATHS.deathSaveRoll, "post", "death-save.roll"],
      [GAME_PATHS.rulesMode, "post", "encounter.set-rules-mode"],
      [GAME_PATHS.rollMode, "post", "encounter.set-roll-mode"],
      [GAME_PATHS.healthDisplay, "post", "encounter.set-health-display"],
      [GAME_PATHS.environment, "post", "encounter.set-environment"],
      [GAME_PATHS.actorRest, "post", "actor.rest"],
      [GAME_PATHS.actorSpendHitDice, "post", "actor.spend-hit-dice"],
      [GAME_PATHS.characterSetSlot, "post", "character.set-slot"],
      [GAME_PATHS.characterSetPrepared, "post", "character.set-prepared"],
      [GAME_PATHS.characterSetInventory, "post", "character.set-inventory"],
      [GAME_PATHS.characterSetCurrency, "post", "character.set-currency"],
      [GAME_PATHS.characterSetIdentity, "post", "character.set-identity"],
      [GAME_PATHS.characterSetProficiencies, "post", "character.set-proficiencies"],
      [GAME_PATHS.annotations, "post", "annotation.add"],
      [GAME_PATHS.annotationsPing, "post", "annotation.ping"],
      [GAME_PATHS.annotationsClear, "post", "annotation.clear"],
      [GAME_PATHS.annotationById, "delete", "annotation.remove"],
      [GAME_PATHS.annotationMove, "post", "annotation.move"],
      [GAME_PATHS.annotationColor, "post", "annotation.set-color"],
      [GAME_PATHS.annotationVisibility, "post", "annotation.set-visibility"],
      [GAME_PATHS.annotationMovable, "post", "annotation.set-movable"],
      [GAME_PATHS.claims, "post", "character.claim"],
      [GAME_PATHS.claimsRelease, "post", "character.release"],
      [GAME_PATHS.claimForceRelease, "post", "character.force-release"],
      [GAME_PATHS.actorTokenImage, "post", "actor.set-token-image"],
      [GAME_PATHS.actorSize, "post", "actor.set-size"],
      [GAME_PATHS.actorVisibility, "post", "actor.set-visibility"],
      [GAME_PATHS.actorHealthDisplay, "post", "actor.set-health-display"],
      [GAME_PATHS.actorSpeed, "post", "actor.set-speed"],
      [GAME_PATHS.scenes, "post", "scene.create"],
      [GAME_PATHS.sceneById, "delete", "scene.remove"],
      [GAME_PATHS.sceneRename, "post", "scene.rename"],
      [GAME_PATHS.sceneActivate, "post", "scene.activate"],
      [GAME_PATHS.sceneCombatants, "post", "scene.set-combatants"],
      [GAME_PATHS.sceneDuplicate, "post", "scene.duplicate"],
      [GAME_PATHS.sceneReorder, "post", "scene.reorder"],
      [GAME_PATHS.fogEnabled, "post", "fog.set-enabled"],
      [GAME_PATHS.fogPaint, "post", "fog.paint"],
      [GAME_PATHS.fogReset, "post", "fog.reset"]
    ];
    // Every cataloged command has exactly one typed route in this table...
    expect(TYPED_ROUTES.map(([, , type]) => type).sort()).toEqual(Object.keys(GAME_COMMAND_SCOPES).sort());
    // ...and the documented bearer scope for that route equals the runtime scope the tunnel + typed route enforce.
    const paths = openApiDocument.paths as unknown as Record<string, Record<string, { security?: ReadonlyArray<Record<string, readonly string[]>> }>>;
    for (const [path, method, type] of TYPED_ROUTES) {
      const documented = paths[path][method].security?.find((entry) => "bearerAuth" in entry)?.bearerAuth;
      expect(documented, `${method.toUpperCase()} ${path} (${type})`).toEqual([GAME_COMMAND_SCOPES[type]]);
    }
  });
});

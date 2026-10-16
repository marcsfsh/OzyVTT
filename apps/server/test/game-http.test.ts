import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import {
  CONTENT_PATHS,
  ENCOUNTER_ARCHIVE_PATHS,
  GAME_COMMANDS,
  GAME_PATHS,
  GameCommandCatalogResponseSchema,
  GameLogResponseSchema,
  GameMutationAcceptedResponseSchema,
  GameSnapshotResponseSchema,
  EncounterArchiveListResponseSchema,
  PlayerSessionIssuedResponseSchema,
  SESSION_PATHS
} from "@vtt/api-contract";
import { openApiDocument } from "../src/openapi/document.js";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { gameCommands, gameReads, socketEventOf } from "../src/commands/index.js";
import { createServer } from "../src/server.js";
import { png } from "./image-fixtures.js";

// ADR-0016 validation evidence, end to end over plain fetch: an external process creates a scoped
// credential, discovers capabilities, reads a safe snapshot, submits and safely retries idempotent
// commands, hits stale-revision and confirmation conflicts, and loses access on revocation - while
// the hidden combatant never leaks through any player-safe response.

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const SECRET_ID = "10000000-0000-4000-8000-000000000002";

function initialState() {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO_ID,
        name: "Public Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        notes: "Player-safe actor"
      },
      {
        id: SECRET_ID,
        name: "Unrevealed Tyrant",
        kind: "monster",
        visibility: "gm-only",
        hp: { current: 99, maximum: 99 },
        notes: "Secret lair and tactics"
      }
    ]
  });
}

type Running = { base: string; server: ReturnType<typeof createServer>; directory: string; gmToken: string };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

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
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
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
/** Issue an integration credential over the documented GM endpoint, as an external tool does. */
async function issueCredential(base: string, gmToken: string, name: string, scopes: readonly string[]) {
  const response = await post(base, "/api/v1/gm/integration-credentials", gmToken, { name, scopes });
  expect(response.status).toBe(201);
  const body = await response.json();
  return { token: body.data.token as string, id: body.data.credential.id as string };
}

describe("death saves over the API", () => {
  it("lets a player make one death save, on their dying character's own turn", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const playerToken = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, playerToken, { commandId: randomUUID(), actorId: HERO_ID });
    await post(base, GAME_PATHS.encounterStart, gmToken, {
      commandId: randomUUID(),
      mapAssetId,
      entries: [
        { actorId: SECRET_ID, score: 20 },
        { actorId: HERO_ID, score: 10 }
      ]
    });
    await post(base, GAME_PATHS.actorHp.replace("{actorId}", HERO_ID), gmToken, {
      commandId: randomUUID(),
      actorId: HERO_ID,
      current: 0
    });
    const roll = (token: string) =>
      post(base, GAME_PATHS.deathSaveRoll.replace("{actorId}", HERO_ID), token, {
        commandId: randomUUID(),
        actorId: HERO_ID
      });
    // The Tyrant's turn: not yet.
    expect((await roll(playerToken)).status).toBe(409);
    await post(base, GAME_PATHS.initiativeNext, gmToken, { commandId: randomUUID() });
    expect((await roll(playerToken)).status).toBe(200);
    // One per turn.
    expect((await roll(playerToken)).status).toBe(409);
    // The GM can still roll one as a correction.
    expect((await roll(gmToken)).status).toBe(200);
  });
});

describe("public game API over /api/v1", () => {
  it("serves GM-full and player-safe snapshots by principal, with ETag polling and no hidden-actor leaks", async () => {
    const { base, server, gmToken } = await boot();
    const integration = await issueCredential(base, gmToken, "reader", ["game:read"]);
    const playerToken = server.auth.issuePlayerSession();

    const unauthenticated = await fetch(base + GAME_PATHS.snapshot);
    expect(unauthenticated.status).toBe(401);

    // Integration with game:read gets the full GM projection by default...
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

    // A player session always gets the player view, even asking for gm.
    const player = await fetch(base + GAME_PATHS.snapshot + "?view=gm", { headers: bearer(playerToken) });
    const playerBody = GameSnapshotResponseSchema.parse(await player.json());
    expect(playerBody.data.view).toBe("player");
    expect(JSON.stringify(playerBody.data.game)).not.toContain(SECRET_ID);

    // Revision-derived weak ETag: matching If-None-Match polls for free.
    const etag = gmGrade.headers.get("etag");
    expect(etag).toMatch(/^W\/"game-r\d+-gm"$/);
    const unchanged = await fetch(base + GAME_PATHS.snapshot, {
      headers: { ...bearer(integration.token), "if-none-match": etag! }
    });
    expect(unchanged.status).toBe(304);

    // The player view's ETag differs (same revision, different projection).
    expect(player.headers.get("etag")).toMatch(/^W\/"game-r\d+-player"$/);
  });

  it("runs the whole combat loop over typed REST routes with idempotent retries and revision conflicts", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const writer = await issueCredential(base, gmToken, "combat bot", [
      "game:read",
      "combat:write",
      "actor:write",
      "roll:create"
    ]);

    // Start the encounter (integration credential, GM authority).
    const startId = randomUUID();
    const started = await post(base, GAME_PATHS.encounterStart, writer.token, {
      commandId: startId,
      mapAssetId,
      entries: [{ actorId: HERO_ID, score: 12 }],
      expectedRevision: 0
    });
    expect(started.status).toBe(200);
    const startedBody = GameMutationAcceptedResponseSchema.parse(await started.json());
    expect(startedBody.data).toMatchObject({ commandId: startId, revision: 1, duplicate: false });

    // Retrying the same commandId is an idempotent duplicate, not a re-execution.
    const retried = GameMutationAcceptedResponseSchema.parse(
      await (
        await post(base, GAME_PATHS.encounterStart, writer.token, {
          commandId: startId,
          mapAssetId,
          entries: [{ actorId: HERO_ID, score: 12 }],
          expectedRevision: 0
        })
      ).json()
    );
    expect(retried.data).toMatchObject({ commandId: startId, duplicate: true });

    // A stale expectedRevision is refused with the live revision attached.
    const stale = await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), writer.token, {
      amount: 5,
      expectedRevision: 0
    });
    expect(stale.status).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.error.code).toBe("conflict");
    expect(staleBody.error.currentRevision).toBe(1);

    // Damage, heal, temp HP, set HP, condition - the actor routes.
    const damaged = GameMutationAcceptedResponseSchema.parse(
      await (await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), writer.token, { amount: 7 })).json()
    );
    expect(damaged.data.duplicate).toBe(false);
    await post(base, GAME_PATHS.actorHeal.replace("{actorId}", HERO_ID), writer.token, { amount: 2 });
    await post(base, GAME_PATHS.actorTempHp.replace("{actorId}", HERO_ID), writer.token, { amount: 4 });
    const condition = await post(base, GAME_PATHS.actorConditions.replace("{actorId}", HERO_ID), writer.token, {
      conditionId: "prone",
      active: true
    });
    expect(condition.status).toBe(200);

    // Dice roll returns the recorded rollId; retry returns the same roll.
    const rollId = randomUUID();
    const rolled = GameMutationAcceptedResponseSchema.parse(
      await (
        await post(base, GAME_PATHS.rolls, writer.token, {
          commandId: rollId,
          formula: "2d6+3",
          purpose: "check",
          visibility: "public"
        })
      ).json()
    );
    expect(typeof rolled.data.rollId).toBe("string");
    const rolledAgain = GameMutationAcceptedResponseSchema.parse(
      await (
        await post(base, GAME_PATHS.rolls, writer.token, {
          commandId: rollId,
          formula: "2d6+3",
          purpose: "check",
          visibility: "public"
        })
      ).json()
    );
    expect(rolledAgain.data).toMatchObject({ duplicate: true, rollId: rolled.data.rollId });

    // Turn economy + token to tray + end turn.
    await post(base, GAME_PATHS.turnUse, writer.token, { slot: "action", used: true });
    const moved = await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), writer.token, {
      position: null
    });
    expect(moved.status).toBe(200);
    const endedTurn = await post(base, GAME_PATHS.turnEnd, writer.token, {});
    expect(endedTurn.status).toBe(200);

    // The state reflects all of it through the same projection the table sees.
    const snapshot = GameSnapshotResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(writer.token) })).json()
    );
    const hero = (
      snapshot.data.game as {
        actors: Array<{ id: string; hp: { current: number; temporary: number }; conditions?: unknown[] }>;
      }
    ).actors.find((actor) => actor.id === HERO_ID)!;
    expect(hero.hp.current).toBe(15); // 20 - 7 + 2
    expect(hero.hp.temporary).toBe(4);
    expect(server.store.snapshot.combat.round).toBeGreaterThanOrEqual(1);
  });

  it("enforces scopes, roles, and revocation exactly like the table does", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const readOnly = await issueCredential(base, gmToken, "read only", ["game:read", "combat:read"]);
    const playerToken = server.auth.issuePlayerSession();

    // Scope enforcement: a read-only credential cannot write.
    const denied = await post(base, GAME_PATHS.encounterStart, readOnly.token, {
      mapAssetId,
      entries: [{ actorId: HERO_ID }]
    });
    expect(denied.status).toBe(403);

    // Role enforcement: a player session hits the exact same denial the socket gives.
    const playerDenied = await post(base, GAME_PATHS.encounterStart, playerToken, {
      mapAssetId,
      entries: [{ actorId: HERO_ID }]
    });
    expect(playerDenied.status).toBe(403);
    expect((await playerDenied.json()).error.message).toBe("Only the GM can start an encounter.");

    // Player sessions may use player-permitted commands... but only within their own authority.
    const start = await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [{ actorId: HERO_ID, score: 10 }]
    });
    expect(start.status).toBe(200);
    const foreignDamage = await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), playerToken, {
      amount: 3
    });
    expect(foreignDamage.status).toBe(403); // unclaimed character → the same denial the table gets
    const move = await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), playerToken, { position: null });
    expect(move.status).toBe(403);
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

  it("lets a player resolve their own claimed character's action but refuses a hidden target or GM-only inputs", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const playerToken = server.auth.issuePlayerSession();
    // The player claims the public hero; the GM runs an encounter with the hero and the hidden tyrant.
    expect((await post(base, GAME_PATHS.claims, playerToken, { actorId: HERO_ID })).status).toBe(200);
    expect(
      (
        await post(base, GAME_PATHS.encounterStart, gmToken, {
          mapAssetId,
          entries: [
            { actorId: HERO_ID, score: 12 },
            { actorId: SECRET_ID, score: 6 }
          ]
        })
      ).status
    ).toBe(200);

    // Supplying the hidden combatant's id as a target is refused (the server must not trust client input),
    // and the rejection must not echo the hidden actor's name.
    const hiddenTarget = await post(base, GAME_PATHS.actionResolve, playerToken, {
      actorId: HERO_ID,
      actionId: "unarmed-strike",
      targetIds: [SECRET_ID]
    });
    expect(hiddenTarget.status).toBe(409);
    const hiddenBody = JSON.stringify(await hiddenTarget.json());
    expect(hiddenBody).toContain("target combatants you can see");
    expect(hiddenBody).not.toContain("Unrevealed Tyrant");

    // GM-only resolve inputs are refused for a player: an area template and a strict-mode override.
    expect(
      (
        await post(base, GAME_PATHS.actionResolve, playerToken, {
          actorId: HERO_ID,
          actionId: "unarmed-strike",
          template: { shape: "circle", origin: { x: 10, y: 10 }, target: { x: 40, y: 40 } }
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post(base, GAME_PATHS.actionResolve, playerToken, {
          actorId: HERO_ID,
          actionId: "unarmed-strike",
          targetIds: [HERO_ID],
          override: { reason: "nope" }
        })
      ).status
    ).toBe(403);

    // And a player cannot resolve for a character they do not own (the GM's hidden monster).
    expect(
      (
        await post(base, GAME_PATHS.actionResolve, playerToken, {
          actorId: SECRET_ID,
          actionId: "unarmed-strike",
          targetIds: [HERO_ID]
        })
      ).status
    ).toBe(403);
  });

  it("exposes the generic command tunnel with a discoverable catalog and per-command scopes", async () => {
    const { base, gmToken, mapAssetId } = await bootWithBattlemap();
    const bot = await issueCredential(base, gmToken, "tunnel bot", ["system:read", "combat:write", "actor:write"]);

    // Catalog lists every command with its scope.
    const catalog = GameCommandCatalogResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.commands, { headers: bearer(bot.token) })).json()
    );
    const types = catalog.data.commands.map((command) => command.type);
    expect(types).toContain("encounter.start");
    expect(types).toContain("actor.apply-damage");
    expect(types).toContain("dice.roll");
    expect(catalog.data.commands.find((command) => command.type === "dice.roll")?.scope).toBe("roll:create");

    // Unknown type → 404 with the available list.
    const unknown = await post(base, GAME_PATHS.commands, bot.token, { type: "not.a-command" });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.details.availableTypes).toContain("encounter.start");

    // The tunnel dispatches through the same command table as the typed routes.
    const viaTunnel = await post(base, GAME_PATHS.commands, bot.token, {
      type: "encounter.start",
      payload: { mapAssetId, entries: [{ actorId: HERO_ID, score: 15 }] }
    });
    expect(viaTunnel.status).toBe(200);
    const tunnelBody = GameMutationAcceptedResponseSchema.parse(await viaTunnel.json());
    expect(tunnelBody.data.type).toBe("encounter.start");
    expect(tunnelBody.data.revision).toBe(1);

    // Scope is looked up per command type: this credential lacks roll:create.
    const noScope = await post(base, GAME_PATHS.commands, bot.token, {
      type: "dice.roll",
      payload: { formula: "1d20", purpose: "check", visibility: "public" }
    });
    expect(noScope.status).toBe(403);

    const damage = await post(base, GAME_PATHS.commands, bot.token, {
      type: "actor.apply-damage",
      payload: { actorId: HERO_ID, amount: 4 }
    });
    expect(GameMutationAcceptedResponseSchema.parse(await damage.json()).data.duplicate).toBe(false);
  });

  it("returns needsConfirm conflicts for timeline rewrites, mirroring the table's confirmation flow", async () => {
    const { base, gmToken, mapAssetId } = await bootWithBattlemap();
    await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [
        { actorId: HERO_ID, score: 10 },
        { actorId: SECRET_ID, score: 5 }
      ]
    });
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

    const sheet = await fetch(base + CONTENT_PATHS.monsterById.replace("{definitionId}", firstId), {
      headers: bearer(reader.token)
    });
    expect(sheet.status).toBe(200);
    expect((await sheet.json()).data.definition.name).toBeDefined();
    const actions = await fetch(base + CONTENT_PATHS.monsterActions.replace("{definitionId}", firstId), {
      headers: bearer(reader.token)
    });
    expect(actions.status).toBe(200);
    const missing = await fetch(base + CONTENT_PATHS.monsterById.replace("{definitionId}", "no-such-monster"), {
      headers: bearer(reader.token)
    });
    expect(missing.status).toBe(404);

    // Players may read conditions (public reference) but not the bestiary.
    expect((await fetch(base + CONTENT_PATHS.conditions, { headers: bearer(playerToken) })).status).toBe(200);
    expect((await fetch(base + CONTENT_PATHS.monsters, { headers: bearer(playerToken) })).status).toBe(403);

    // Combat log: GM-only lines reach GM-grade principals, never player sessions.
    await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [
        { actorId: HERO_ID, score: 10 },
        { actorId: SECRET_ID, score: 20 }
      ]
    });
    const gmLog = GameLogResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.log, { headers: bearer(reader.token) })).json()
    );
    expect(gmLog.data.entries.some((entry) => entry.gmOnly)).toBe(true); // hidden Tyrant's turn line is GM-only
    const playerLog = GameLogResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.log, { headers: bearer(playerToken) })).json()
    );
    expect(playerLog.data.entries.every((entry) => !entry.gmOnly)).toBe(true);
    expect(JSON.stringify(playerLog.data.entries)).not.toContain("Unrevealed Tyrant");

    const badLimit = await fetch(base + GAME_PATHS.log + "?limit=0", { headers: bearer(reader.token) });
    expect(badLimit.status).toBe(400);
  });

  it("serves every public rules catalog to a player session over HTTP, with the CC BY attribution the builder must display", async () => {
    const { base, server, gmToken } = await boot();
    const reader = await issueCredential(base, gmToken, "builder client", ["game:read"]);
    const playerToken = server.auth.issuePlayerSession();

    // Spells and equipment are public reference like conditions, so a player session reads them over HTTP
    // too (the character wizard runs from a player seat).
    const spells = await fetch(base + CONTENT_PATHS.spells, { headers: bearer(playerToken) });
    expect(spells.status).toBe(200);
    const spellsBody = await spells.json();
    expect(spellsBody.data.spells.length).toBeGreaterThan(100);
    expect(spellsBody.data.spells[0]).toHaveProperty("castingOptions");
    // ADR-0015: every displaying surface shows the bundle's canonical statement (author, source URL and
    // license URI), so no client hand-writes a paraphrase.
    expect(spellsBody.data.attribution).toContain("System Reference Document 5.2.1");
    expect(spellsBody.data.attribution).toContain("Wizards of the Coast");
    expect(spellsBody.data.attribution).toContain("creativecommons.org/licenses/by/4.0");

    const conditions = await fetch(base + CONTENT_PATHS.conditions, { headers: bearer(playerToken) });
    expect(conditions.status).toBe(200);
    const conditionsBody = await conditions.json();
    expect(conditionsBody.data.conditions.length).toBeGreaterThan(5);
    expect(conditionsBody.data.attribution).toContain("System Reference Document 5.2.1");

    // The Rules Glossary is reference text any joined player may read.
    const glossary = await fetch(base + CONTENT_PATHS.glossary, { headers: bearer(playerToken) });
    expect(glossary.status).toBe(200);
    const glossaryBody = await glossary.json();
    expect(glossaryBody.data.glossary.find((entry: { id: string }) => entry.id === "prone")?.tag).toBe("Condition");
    expect(glossaryBody.data.attribution).toContain("System Reference Document 5.2.1");

    const equipment = await fetch(base + CONTENT_PATHS.equipment, { headers: bearer(playerToken) });
    expect(equipment.status).toBe(200);
    const equipmentBody = await equipment.json();
    expect(equipmentBody.data.equipment.length).toBeGreaterThan(50);
    expect(typeof equipmentBody.data.attribution).toBe("string");

    // The six character-builder catalogs, on the same audience terms. Bundles grow over time, so these
    // assert "at least one real row" rather than counts.
    const catalogs = [
      [CONTENT_PATHS.classes, "classes"],
      [CONTENT_PATHS.subclasses, "subclasses"],
      [CONTENT_PATHS.species, "species"],
      [CONTENT_PATHS.backgrounds, "backgrounds"],
      [CONTENT_PATHS.feats, "feats"],
      [CONTENT_PATHS.names, "names"]
    ] as const;
    const catalogRows: Record<string, ReadonlyArray<Record<string, unknown>>> = {};
    for (const [path, key] of catalogs) {
      const asPlayer = await fetch(base + path, { headers: bearer(playerToken) });
      expect(asPlayer.status, `player GET ${path}`).toBe(200);
      const body = await asPlayer.json();
      expect(Array.isArray(body.data[key]), `${path} returns ${key}[]`).toBe(true);
      expect(body.data[key].length, `${path} has rows`).toBeGreaterThan(0);
      expect(typeof body.data.attribution, `${path} carries attribution`).toBe("string");
      catalogRows[key] = body.data[key];
      // Same read through a scoped integration credential and a GM session.
      expect((await fetch(base + path, { headers: bearer(reader.token) })).status).toBe(200);
      expect((await fetch(base + path, { headers: bearer(gmToken) })).status).toBe(200);
      expect((await fetch(base + path)).status, `anonymous GET ${path}`).toBe(401);
    }

    // Spot-check that the wire projection carries what the wizard picks on: source discriminator, the
    // multiclass hit die, the generator's stat priority, and features-as-data with their choices.
    const fighter = catalogRows.classes.find((entry) => entry.id === "fighter") as Record<string, unknown>;
    expect(fighter.source).toBe("srd");
    expect(fighter.hitDie).toBe("d10");
    expect(fighter.statPriority).toHaveLength(6);
    expect(fighter.savingThrows).toEqual(["str", "con"]);
    const features = fighter.features as ReadonlyArray<Record<string, unknown>>;
    expect(features.length).toBeGreaterThan(0);
    const picks = features.flatMap((feature) => feature.choices as ReadonlyArray<Record<string, unknown>>);
    expect(picks[0]).toMatchObject({ kind: expect.any(String), choose: expect.any(Number) });
    // Only the full list is served; a single `choice` field once hid a feature's second pick.
    expect(features.every((feature) => !("choice" in feature))).toBe(true);
    // Subclasses key to their parent class, and name pools to their species - both open slugs.
    expect(catalogRows.subclasses.every((entry) => typeof entry.classId === "string")).toBe(true);
    expect(
      catalogRows.names.every((entry) => typeof entry.speciesId === "string" && (entry.pools as unknown[]).length > 0)
    ).toBe(true);
  });

  it("serves the skills catalog and the restored wizard wire fields (proficiencies, multiclass rules, spell-list link)", async () => {
    const { base, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    // content:skills is player-readable reference with the ability column, so clients need no hardcoded
    // skill-to-ability table.
    const skills = await fetch(base + CONTENT_PATHS.skills, { headers: bearer(playerToken) });
    expect(skills.status).toBe(200);
    const skillsBody = await skills.json();
    expect(skillsBody.data.skills).toHaveLength(18);
    expect(skillsBody.data.skills.find((skill: { id: string }) => skill.id === "athletics")).toMatchObject({
      ability: "str"
    });
    expect(skillsBody.data.attribution).toContain("System Reference Document 5.2.1");

    // The class/species/background/spell fields the wizard renders from must cross the wire.
    const classes = await (await fetch(base + CONTENT_PATHS.classes, { headers: bearer(playerToken) })).json();
    const fighter = classes.data.classes.find((entry: { id: string }) => entry.id === "fighter");
    expect(fighter.armorProficiencies).toEqual(["light", "medium", "heavy", "shields"]);
    expect(fighter.weaponProficiencies).toEqual(["simple", "martial"]);
    expect(fighter.multiclassPrerequisites).toEqual({
      mode: "any",
      minimums: [
        { ability: "str", minimum: 13 },
        { ability: "dex", minimum: 13 }
      ]
    });
    expect(fighter.multiclassProficiencies).toMatchObject({ armor: ["light", "medium", "shields"] });
    const wizard = classes.data.classes.find((entry: { id: string }) => entry.id === "wizard");
    expect(wizard.spellcasting).toMatchObject({
      ability: "int",
      prepares: "prepared",
      ritual: true,
      progression: "full",
      spellListId: "wizard"
    });
    const spells = await (await fetch(base + CONTENT_PATHS.spells, { headers: bearer(playerToken) })).json();
    const fireball = spells.data.spells.find((spell: { id: string }) => spell.id === "fireball");
    expect(fireball.classes).toContain("wizard"); // the spell-list link, wire side
    const species = await (await fetch(base + CONTENT_PATHS.species, { headers: bearer(playerToken) })).json();
    const elf = species.data.species.find((entry: { id: string }) => entry.id === "elf");
    expect(Array.isArray(elf.abilityBonuses)).toBe(true);
    expect(elf).toHaveProperty("abilityBonusChoice");
    const backgrounds = await (await fetch(base + CONTENT_PATHS.backgrounds, { headers: bearer(playerToken) })).json();
    const soldier = backgrounds.data.backgrounds.find((entry: { id: string }) => entry.id === "soldier");
    expect(soldier.toolChoices).toEqual({
      choose: 1,
      from: ["gaming-set-dice", "gaming-set-playing-cards"],
      fromCatalog: null
    });
    expect(soldier).toHaveProperty("skillChoices");
    expect(soldier).toHaveProperty("languageChoices");
  });

  it("lets only the GM write the builder policy, validates the formula, and projects the policy to players", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    // Players see the default policy (all four methods) before the GM touches anything.
    const before = await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(playerToken) })).json();
    // `playerRandom` defaults closed, unlike `playerBuilder`: a generator can be used to fill the roster.
    expect(before.data.game.builderPolicy).toEqual({
      allowedAbilityMethods: ["standard-array", "point-buy", "roll", "custom"],
      customFormula: null,
      maxLevel: 20,
      playerBuilder: "open",
      playerRandom: "gm-only"
    });

    // Player write refused; the policy is the GM's.
    const denied = await post(base, GAME_PATHS.builderPolicy, playerToken, {
      allowedAbilityMethods: ["standard-array"]
    });
    expect(denied.status).toBe(403);

    // A formula outside the 1-30 ability bounds is rejected by the shared validator, not stored.
    const badFormula = await post(base, GAME_PATHS.builderPolicy, gmToken, {
      allowedAbilityMethods: ["standard-array", "custom"],
      customFormula: "50d20"
    });
    expect(badFormula.status).toBe(400);
    const duplicated = await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["roll", "roll"] });
    expect(duplicated.status).toBe(400);

    const accepted = await post(base, GAME_PATHS.builderPolicy, gmToken, {
      allowedAbilityMethods: ["standard-array", "custom"],
      customFormula: "3d6"
    });
    expect(accepted.status).toBe(200);

    // Player-readable: the stored policy reaches the player projection verbatim.
    const after = await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(playerToken) })).json();
    // The two additive fields are omitted by this request, so they must survive it untouched.
    expect(after.data.game.builderPolicy).toEqual({
      allowedAbilityMethods: ["standard-array", "custom"],
      customFormula: "3d6",
      maxLevel: 20,
      playerBuilder: "open",
      playerRandom: "gm-only"
    });
  });

  it("creates a character from choices over HTTP (GM only); the actor id equals the commandId and the sheet is import-keyed", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    const commandId = randomUUID();
    const create = {
      commandId,
      name: "Robin of the Road",
      speciesId: "human",
      backgroundId: "soldier",
      classId: "fighter",
      level: 1,
      abilityMethod: "standard-array",
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      backgroundBonusAllocation: [
        { ability: "str", amount: 2 },
        { ability: "con", amount: 1 }
      ],
      hp: { mode: "average" },
      choices: [
        { level: 1, kind: "language", id: "dwarvish" },
        { level: 1, kind: "language", id: "giant" },
        { level: 1, classId: "fighter", kind: "skill", id: "survival" },
        { level: 1, classId: "fighter", kind: "skill", id: "perception" },
        { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
        { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
        {
          level: 1,
          classId: "fighter",
          kind: "fighting-style",
          id: "defense",
          payload: { featureId: "fighting-style" }
        },
        { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
        { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
        { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
        { level: 1, kind: "tool", id: "gaming-set-dice" },
        { level: 1, kind: "equipment", id: "fighter-a" },
        { level: 1, kind: "equipment", id: "soldier-a" }
      ]
    };

    // The table's policy decides whether a player may build. Closed, the player seat is refused.
    const methods = ["standard-array", "point-buy", "roll", "custom"];
    expect(
      (
        await post(base, GAME_PATHS.builderPolicy, gmToken, {
          allowedAbilityMethods: methods,
          playerBuilder: "gm-only"
        })
      ).status
    ).toBe(200);
    expect((await post(base, GAME_PATHS.characters, playerToken, create)).status).toBe(403);

    // Open, the same player builds their own character, and it is auto-claimed by them so no one else can
    // take it in between.
    expect(
      (await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: methods, playerBuilder: "open" }))
        .status
    ).toBe(200);
    const playerCommandId = randomUUID();
    const playerCreated = await post(base, GAME_PATHS.characters, playerToken, {
      ...create,
      commandId: playerCommandId,
      name: "Player Built"
    });
    expect(playerCreated.status).toBe(200);
    const afterPlayerCreate = await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(gmToken) })).json();
    const playerActor = afterPlayerCreate.data.game.actors.find(
      (entry: { id: string }) => entry.id === playerCommandId
    );
    expect(playerActor.ownerSessionId).not.toBeNull();
    // One character each: the claim rule the roster already enforces also bounds the builder.
    expect(
      (await post(base, GAME_PATHS.characters, playerToken, { ...create, commandId: randomUUID(), name: "Second Try" }))
        .status
    ).toBe(409);

    const created = await post(base, GAME_PATHS.characters, gmToken, create);
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.data.actorId).toBe(commandId);
    // Idempotent retry: same commandId, no second actor.
    const retried = await post(base, GAME_PATHS.characters, gmToken, create);
    expect((await retried.json()).data.duplicate).toBe(true);

    const snapshot = await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(gmToken) })).json();
    const actor = snapshot.data.game.actors.find((entry: { id: string }) => entry.id === commandId);
    expect(actor).toMatchObject({
      name: "Robin of the Road",
      kind: "player-character",
      definitionId: `import-${commandId}`
    });
    expect(actor.hp).toEqual({ current: 12, maximum: 12, temporary: 0 }); // d10 max + Con 15 (+2)
    expect(snapshot.data.game.definitions.some((entry: { id: string }) => entry.id === `import-${commandId}`)).toBe(
      true
    );
    // A rejected build surfaces as a 409 domain rejection, never a half-created actor.
    const bad = await post(base, GAME_PATHS.characters, gmToken, {
      ...create,
      commandId: randomUUID(),
      speciesId: "gnoll"
    });
    expect(bad.status).toBe(409);
  });

  it("runs the player-submitted character import through the HTTP twin: player submits, only the GM resolves", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    const definition = loadActorFixture("player-character") as Record<string, unknown>;

    // A player session may submit - this is the player path the wizard rides on.
    const importId = randomUUID();
    const submitted = await post(base, GAME_PATHS.characterImports, playerToken, { commandId: importId, definition });
    expect(submitted.status).toBe(200);
    const submitBody = GameMutationAcceptedResponseSchema.parse(await submitted.json());
    expect(submitBody.data.commandId).toBe(importId);
    expect(submitBody.data.duplicate).toBe(false);

    // commandId idempotency survives the second transport: the same id replays instead of re-queueing.
    const replay = GameMutationAcceptedResponseSchema.parse(
      await (await post(base, GAME_PATHS.characterImports, playerToken, { commandId: importId, definition })).json()
    );
    expect(replay.data.duplicate).toBe(true);
    // expectedRevision optimistic concurrency is preserved too.
    const stale = await post(base, GAME_PATHS.characterImports, playerToken, {
      commandId: randomUUID(),
      definition,
      expectedRevision: 0
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.currentRevision).toBe(submitBody.data.revision);

    // Resolving is GM-only - the operation's own role check, not the route's, refuses the player.
    const resolvePath = GAME_PATHS.characterImportResolve.replace("{importId}", importId);
    const refused = await post(base, resolvePath, playerToken, { approve: true });
    expect(refused.status).toBe(403);

    const approved = await post(base, resolvePath, gmToken, { approve: true });
    expect(approved.status).toBe(200);
    const approvedBody = GameMutationAcceptedResponseSchema.parse(await approved.json());
    const actorId = approvedBody.data.actorId as string;
    // The approved character must be keyed `import-<actorId>` or it is permanently un-editable and un-removable.
    const snapshot = GameSnapshotResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(gmToken) })).json()
    );
    const actors = (snapshot.data.game as { actors: ReadonlyArray<{ id: string; definitionId?: string | null }> })
      .actors;
    expect(actors.find((actor) => actor.id === actorId)?.definitionId).toBe(`import-${actorId}`);
    expect((snapshot.data.game as { pendingImports: readonly unknown[] }).pendingImports).toHaveLength(0);

    // A second decision on the same submission is refused - it already left the queue.
    expect((await post(base, resolvePath, gmToken, { approve: false })).status).toBe(409);
  });

  it("serves the enriched Time Machine archives under /api/v1 with scope + GM-grade gating", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const reader = await issueCredential(base, gmToken, "archivist", ["combat:read"]);
    const admin = await issueCredential(base, gmToken, "janitor", ["admin"]);
    const playerToken = server.auth.issuePlayerSession();

    // Run a short fight over the API: start → roll → damage → next → end.
    await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [
        { actorId: HERO_ID, score: 10 },
        { actorId: SECRET_ID, score: 20 }
      ]
    });
    await post(base, GAME_PATHS.rolls, gmToken, { formula: "1d20+5", purpose: "attack", visibility: "public" });
    await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), gmToken, { amount: 6 });
    await post(base, GAME_PATHS.initiativeNext, gmToken, {});
    await post(base, GAME_PATHS.encounterEnd, gmToken, {});

    const list = EncounterArchiveListResponseSchema.parse(
      await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(reader.token) })).json()
    );
    expect(list.data.encounters).toHaveLength(1);
    const id = list.data.encounters[0].id;

    // Hidden until shared. A player's list is empty and the record itself is 404, never 403, which would
    // confirm an unshared recording exists.
    const hiddenList = EncounterArchiveListResponseSchema.parse(
      await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(playerToken) })).json()
    );
    expect(hiddenList.data.encounters).toEqual([]);
    expect(
      (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { headers: bearer(playerToken) }))
        .status
    ).toBe(404);

    // Shared: the same URL now answers with the computed player replay, never the stored document.
    await post(base, ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(id)), gmToken, { playerVisible: true });
    const sharedList = EncounterArchiveListResponseSchema.parse(
      await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(playerToken) })).json()
    );
    expect(sharedList.data.encounters.map((entry) => entry.id)).toEqual([id]);
    const playerDocument = await (
      await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { headers: bearer(playerToken) })
    ).json();
    expect(playerDocument.ok).toBe(true);
    expect(playerDocument.data.document.turns.length).toBeGreaterThan(0);
    const playerJson = JSON.stringify(playerDocument);
    for (const forbidden of [
      "journal",
      "finalState",
      "postEncounterState",
      "initiatorSessionId",
      "ownerSessionId",
      "Unrevealed Tyrant",
      "Secret lair"
    ]) {
      expect(playerJson).not.toContain(forbidden);
    }
    await post(base, ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(id)), gmToken, { playerVisible: false });
    expect(
      (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), { headers: bearer(playerToken) }))
        .status
    ).toBe(404);

    const documentResponse = await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), {
      headers: bearer(reader.token)
    });
    expect(documentResponse.status).toBe(200);
    const envelope = await documentResponse.json();
    expect(envelope.ok).toBe(true);
    const document = envelope.data.document;
    // The archive document: turns, log, complete journal (start..end), final + post-encounter states, dice, and the fight's stat blocks.
    expect(document.archiveSchemaVersion).toBe(3);
    expect(document.postEncounterState.combat.active).toBe(false);
    expect(document.turns.length).toBeGreaterThan(0);
    expect(document.journal.map((entry: { type: string }) => entry.type)).toEqual([
      "encounter.start",
      "dice.roll",
      "actor.apply-damage",
      "initiative.next",
      "encounter.end"
    ]);
    expect(document.journal.every((entry: { principal: string }) => entry.principal.startsWith("gm:"))).toBe(true);
    expect(document.finalState.combat.active).toBe(true);
    expect(document.rolls.length).toBe(1);
    expect(document.rolls[0].formula).toBe("1d20+5");

    // Deletion needs the admin scope (or a GM session) - combat:read cannot destroy the record.
    expect(
      (
        await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), {
          method: "DELETE",
          headers: bearer(reader.token)
        })
      ).status
    ).toBe(403);
    const deleted = await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), {
      method: "DELETE",
      headers: bearer(admin.token)
    });
    expect(deleted.status).toBe(200);
    expect(
      (
        await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(id)), {
          method: "DELETE",
          headers: bearer(admin.token)
        })
      ).status
    ).toBe(404);
  });

  it("issues player sessions over HTTP and runs the claim lifecycle end to end", async () => {
    const { base, gmToken } = await boot();
    const integration = await issueCredential(base, gmToken, "seat manager", ["game:read", "actor:write"]);

    // Two players join over pure HTTP - the socketless mirror of the open LAN join.
    const seatA = PlayerSessionIssuedResponseSchema.parse(
      await (await fetch(base + SESSION_PATHS.player, { method: "POST" })).json()
    );
    const seatB = PlayerSessionIssuedResponseSchema.parse(
      await (await fetch(base + SESSION_PATHS.player, { method: "POST" })).json()
    );
    expect(seatA.data.sessionId).not.toBe(seatB.data.sessionId);

    // A claims the hero; B is refused; A shows up as owner in the GM view.
    const claimed = await post(base, GAME_PATHS.claims, seatA.data.token, { actorId: HERO_ID });
    expect(claimed.status).toBe(200);
    const contested = await post(base, GAME_PATHS.claims, seatB.data.token, { actorId: HERO_ID });
    expect(contested.status).toBe(409);
    expect((await contested.json()).error.message).toBe("That character is already claimed.");
    const view = GameSnapshotResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(integration.token) })).json()
    );
    expect(
      (view.data.game as { actors: Array<{ id: string; ownerSessionId: string | null }> }).actors.find(
        (actor) => actor.id === HERO_ID
      )?.ownerSessionId
    ).toBe(seatA.data.sessionId);

    // Claimed player can act on their character over HTTP; GM-grade principals cannot claim.
    expect(
      (await post(base, GAME_PATHS.actorDamage.replace("{actorId}", HERO_ID), seatA.data.token, { amount: 2 })).status
    ).toBe(200);
    const gmClaim = await post(base, GAME_PATHS.claims, gmToken, { actorId: HERO_ID });
    expect(gmClaim.status).toBe(403);
    expect((await gmClaim.json()).error.message).toBe("GM sessions do not claim player characters.");

    // Force-release via an actor:write integration, then A releases nothing further; B claims freely.
    expect(
      (await post(base, GAME_PATHS.claimForceRelease.replace("{actorId}", HERO_ID), integration.token, {})).status
    ).toBe(200);
    expect((await post(base, GAME_PATHS.claimsRelease, seatA.data.token, {})).status).toBe(200);
    expect((await post(base, GAME_PATHS.claims, seatB.data.token, { actorId: HERO_ID })).status).toBe(200);
  });

  it("stages, edits, activates, and removes scenes over HTTP with the scene:write scope", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    const stager = await issueCredential(base, gmToken, "scene stager", ["game:read", "scene:write"]);
    const noScope = await issueCredential(base, gmToken, "combat only", ["combat:write"]);

    // Wrong scope → 403; wrong map kind → 409 with the table's message.
    expect(
      (await post(base, GAME_PATHS.scenes, noScope.token, { name: "Nope", mapAssetId, combatantIds: [] })).status
    ).toBe(403);
    const otherMap = await server.mapAssets.import(png(600, 400), "world.png");
    server.mapCatalog.register(otherMap.metadata.id, "World", "world");
    const wrongKind = await post(base, GAME_PATHS.scenes, stager.token, {
      name: "Nope",
      mapAssetId: otherMap.metadata.id,
      combatantIds: []
    });
    expect(wrongKind.status).toBe(409);
    expect((await wrongKind.json()).error.message).toBe("Prepare scenes on an uploaded battlemap.");

    // Create → rename → set combatants → activate → the live table now runs this scene's map.
    const created = GameMutationAcceptedResponseSchema.parse(
      await (
        await post(base, GAME_PATHS.scenes, stager.token, { name: "Ambush", mapAssetId, combatantIds: [HERO_ID] })
      ).json()
    );
    const sceneId = created.data.sceneId as string;
    expect(
      (await post(base, GAME_PATHS.sceneRename.replace("{sceneId}", sceneId), stager.token, { name: "Bridge Ambush" }))
        .status
    ).toBe(200);
    expect(
      (
        await post(base, GAME_PATHS.sceneCombatants.replace("{sceneId}", sceneId), stager.token, {
          combatantIds: [HERO_ID, SECRET_ID]
        })
      ).status
    ).toBe(200);
    expect((await post(base, GAME_PATHS.sceneActivate.replace("{sceneId}", sceneId), stager.token, {})).status).toBe(
      200
    );
    expect(server.store.snapshot.combat.activeSceneId).toBe(sceneId);
    expect(server.store.snapshot.combat.mapAssetId).toBe(mapAssetId);
    // Bridge: going live also presents the scene's map on the shared screen (enabled), in one action.
    expect(server.viewerPresentation.snapshot).toMatchObject({ enabled: true, activeMap: { assetId: mapAssetId } });

    // The active scene refuses removal; a second prepared scene deletes fine.
    const removeActive = await fetch(base + GAME_PATHS.sceneById.replace("{sceneId}", sceneId), {
      method: "DELETE",
      headers: bearer(stager.token)
    });
    expect(removeActive.status).toBe(409);
    const spare = GameMutationAcceptedResponseSchema.parse(
      await (await post(base, GAME_PATHS.scenes, stager.token, { name: "Spare", mapAssetId, combatantIds: [] })).json()
    );
    expect(
      (
        await fetch(base + GAME_PATHS.sceneById.replace("{sceneId}", spare.data.sceneId as string), {
          method: "DELETE",
          headers: bearer(stager.token)
        })
      ).status
    ).toBe(200);

    // Cosmetics: size + clearing a token image, via the same actor routes namespace.
    const cosmetics = await issueCredential(base, gmToken, "cosmetics", ["actor:write"]);
    expect(
      (await post(base, GAME_PATHS.actorSize.replace("{actorId}", HERO_ID), cosmetics.token, { size: "large" })).status
    ).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO_ID)?.sizeCells).toBe(2);
    expect(
      (
        await post(base, GAME_PATHS.actorVisibility.replace("{actorId}", HERO_ID), cosmetics.token, {
          visibility: "gm-only"
        })
      ).status
    ).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO_ID)?.visibility).toBe("gm-only");
    expect(
      (
        await post(base, GAME_PATHS.actorVisibility.replace("{actorId}", HERO_ID), cosmetics.token, {
          visibility: "public"
        })
      ).status
    ).toBe(200);
    expect(
      (
        await post(base, GAME_PATHS.actorTokenImage.replace("{actorId}", HERO_ID), cosmetics.token, {
          tokenAssetId: null
        })
      ).status
    ).toBe(200);
    // Table rules-enforcement preference is a combat:write command.
    const combatPref = await issueCredential(base, gmToken, "rules pref", ["combat:write"]);
    expect((await post(base, GAME_PATHS.rulesMode, combatPref.token, { mode: "assisted" })).status).toBe(200);
    expect(server.store.snapshot.combat.rulesMode).toBe("assisted");
  });

  it("narrates token movement into the combat log with distances, keeping hidden ranges GM-only", async () => {
    const { base, server, gmToken, mapAssetId } = await bootWithBattlemap();
    // 50px cells at 5 ft each: cell (c,r) center = (25 + 50c, 25 + 50r).
    server.mapCatalog.saveCalibration(mapAssetId, {
      calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
      verifiedAt: null,
      verificationPoint: null,
      verificationErrorPx: null
    });
    const reader = await issueCredential(base, gmToken, "log reader", ["combat:read"]);
    const playerToken = server.auth.issuePlayerSession();

    await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [
        { actorId: HERO_ID, score: 10 },
        { actorId: SECRET_ID, score: 5 }
      ]
    });
    // Tokens auto-place on encounter start; pin both to known cells, then make the studied move.
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), gmToken, { position: { x: 25, y: 25 } });
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", SECRET_ID), gmToken, { position: { x: 25, y: 125 } });
    await post(base, GAME_PATHS.tokenMove.replace("{actorId}", HERO_ID), gmToken, { position: { x: 225, y: 25 } });

    const gmLog = GameLogResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.log, { headers: bearer(reader.token) })).json()
    );
    const movement = gmLog.data.entries.filter((entry) => entry.kind === "movement");
    // The studied move: 4 cells = 20 ft, with the hidden Tyrant's ranges split into a GM-only line.
    expect(movement.map((entry) => entry.text)).toContain("Public Hero moved 20 ft.");
    expect(movement.map((entry) => entry.text)).toContain(
      "Hidden ranges for Public Hero - Unrevealed Tyrant 10 ft → 20 ft."
    );
    expect(movement.find((entry) => entry.text.startsWith("Hidden ranges"))?.gmOnly).toBe(true);

    // Players get the public movement lines but never the hidden ranges.
    const playerLog = GameLogResponseSchema.parse(
      await (await fetch(base + GAME_PATHS.log, { headers: bearer(playerToken) })).json()
    );
    const playerMovement = playerLog.data.entries.filter((entry) => entry.kind === "movement");
    expect(playerMovement.some((entry) => entry.text === "Public Hero moved 20 ft.")).toBe(true);
    expect(JSON.stringify(playerLog.data.entries)).not.toContain("Unrevealed Tyrant");

    // The narration rides the fight into its Time Machine archive.
    await post(base, GAME_PATHS.encounterEnd, gmToken, {});
    const archives = EncounterArchiveListResponseSchema.parse(
      await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(gmToken) })).json()
    );
    const archived = await (
      await fetch(base + ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", String(archives.data.encounters[0].id)), {
        headers: bearer(gmToken)
      })
    ).json();
    expect(JSON.stringify(archived.data.document.log)).toContain("Public Hero moved 20 ft.");
  });

  it("answers CORS preflights for /api/v1 only - never for the legacy session/login endpoints", async () => {
    const { base } = await boot();
    const preflight = await fetch(base + GAME_PATHS.snapshot, {
      method: "OPTIONS",
      headers: {
        origin: "https://overlay.example",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const health = await fetch(`${base}/api/v1/system/health`, { headers: { origin: "https://overlay.example" } });
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
    expect(health.headers.get("access-control-expose-headers")).toContain("etag");

    // The password endpoint must stay same-origin: wildcard CORS there would let any web page
    // relay password guesses through a browser on the LAN and read the outcome.
    const loginPreflight = await fetch(`${base}/api/v1/host/gm/sign-in`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" }
    });
    expect(loginPreflight.headers.get("access-control-allow-origin")).toBeNull();
    const loginPost = await fetch(`${base}/api/v1/host/gm/sign-in`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" })
    });
    expect(loginPost.headers.get("access-control-allow-origin")).toBeNull();
    const bootstrapStatus = await fetch(`${base}/api/v1/host/setup`, {
      headers: { origin: "https://evil.example" }
    });
    expect(bootstrapStatus.headers.get("access-control-allow-origin")).toBeNull();
  });

  // server.ts stamps the request id once for every /api/v1 router, so this is checked at the full server.
  it("echoes one request id on every /api/v1 surface, a body-parser refusal included", async () => {
    const { base, gmToken } = await boot();
    const requestId = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
    const headers = { ...bearer(gmToken), "x-request-id": requestId };
    for (const path of [
      "/api/v1/system/health",
      GAME_PATHS.snapshot,
      "/api/v1/codex/pages",
      "/api/v1/homebrew/content",
      "/api/v1/map-assets",
      "/api/v1/token-assets",
      "/api/v1/viewer/access"
    ]) {
      const response = await fetch(base + path, { headers });
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-request-id"), path).toBe(requestId);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
    }

    const unparsable = await fetch(`${base}/api/v1/game/commands`, { method: "POST", headers, body: "{" });
    expect(unparsable.status).toBe(400);
    expect(unparsable.headers.get("x-request-id")).toBe(requestId);
    expect((await unparsable.json()).error).toEqual({
      code: "validation_failed",
      message: "The request body is not valid JSON.",
      requestId
    });

    // A bare token is not a bearer token, on the GM session routes too.
    expect((await fetch(`${base}/api/v1/host/gm/viewer-urls`, { headers: { authorization: gmToken } })).status).toBe(
      401
    );
    expect((await fetch(`${base}/api/v1/host/gm/viewer-urls`, { headers: bearer(gmToken) })).status).toBe(200);
  });

  it("serves server-computed action availability with role gating", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    // Roster a bundled crocodile; the response's actorId equals the commandId.
    const commandId = randomUUID();
    const added = GameMutationAcceptedResponseSchema.parse(
      await (await post(base, GAME_PATHS.actors, gmToken, { commandId, definitionId: "giant-crocodile" })).json()
    );
    const crocId = added.data.actorId as string;
    // Average hit points by default; rolled on request, from the stat block's Hit Dice.
    expect(server.store.snapshot.actors.find((actor) => actor.id === crocId)?.hp.maximum).toBe(85);
    const rolledId = randomUUID();
    await post(base, GAME_PATHS.actors, gmToken, {
      commandId: rolledId,
      definitionId: "giant-crocodile",
      hitPoints: "roll"
    });
    const rolled = server.store.snapshot.actors.find((actor) => actor.id === rolledId)!.hp;
    expect(rolled.current).toBe(rolled.maximum);
    expect(rolled.maximum).toBeGreaterThanOrEqual(9 + 27); // 9d12 + 27
    expect(rolled.maximum).toBeLessThanOrEqual(108 + 27);

    const path = GAME_PATHS.actorAvailableActions.replace("{actorId}", crocId);
    expect((await fetch(base + path)).status).toBe(401);
    // A player who hasn't claimed this actor is refused - availability names stat-block internals.
    expect((await fetch(base + path, { headers: bearer(playerToken) })).status).toBe(403);
    expect(
      (
        await fetch(base + GAME_PATHS.actorAvailableActions.replace("{actorId}", randomUUID()), {
          headers: bearer(gmToken)
        })
      ).status
    ).toBe(404);

    const body = await (await fetch(base + path, { headers: bearer(gmToken) })).json();
    expect(body.ok).toBe(true);
    expect(body.data.rulesMode).toBe("strict");
    const rows = body.data.actions as ReadonlyArray<{
      id: string;
      available: boolean;
      violations: readonly unknown[];
      builtin?: boolean;
    }>;
    // Stat-block rows first, then the SRD builtin generic actions flagged builtin: true.
    expect(
      rows
        .filter((row) => !row.builtin)
        .map((row) => row.id)
        .sort()
    ).toEqual(["bite", "multiattack", "tail"]);
    for (const id of ["dodge", "dash", "disengage", "help", "hide", "ready", "unarmed-grapple", "escape-grapple"]) {
      expect(rows.find((row) => row.id === id)?.builtin).toBe(true);
    }
    // No encounter running: nothing is spent, so everything reports available with no violations.
    expect(rows.every((row) => row.available && row.violations.length === 0)).toBe(true);
  });
});

// `POST /codex/import` has a 64 MB body limit (a backup bundle carries every page revision). Its parser
// is app-level and must run before the global 512 KB one, which puts it ahead of every router, so it
// must itself check authorization first. Otherwise any LAN client, or a hostile page via `/api/v1`'s
// wildcard CORS, could make the process block on a huge `JSON.parse` on the event loop that owns
// GameState.
// Tested at the full server because the risk is middleware order. The oversized bodies are also refused
// by the 512 KB fallback, so a 401/403 proves no parser ran at all.
describe("the codex import's 64 MB parser runs after authorization, not before it", () => {
  const oversized = () => JSON.stringify({ codex: { pages: [] }, filler: "x".repeat(2 * 1024 * 1024) });

  it("refuses an unauthorized oversized import without parsing it, and still restores an authorized one", async () => {
    const { base, gmToken } = await boot();

    // No credential at all: 401 from the codex surface's own envelope, not a 413 from a parser.
    const anonymous = await fetch(`${base}/api/v1/codex/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized()
    });
    expect(anonymous.status).toBe(401);
    const refusal = await anonymous.json();
    expect(refusal.error.code).toBe("unauthenticated");
    expect(refusal.error.requestId, "the refusal still speaks the surface's conventions").toEqual(expect.any(String));
    expect(
      anonymous.headers.get("access-control-allow-origin"),
      "...including CORS, so a browser integration can read it"
    ).toBe("*");

    // A body oversized for the 512 KB fallback and not valid JSON: if the parser runs first it reports the
    // parse failure (400), and if authorization runs first it reports the missing credential (401).
    const garbage = await fetch(`${base}/api/v1/codex/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"codex": ${"x".repeat(2 * 1024 * 1024)}`
    });
    expect(garbage.status, "an unauthorized caller must be refused BEFORE their body is parsed").toBe(401);
    expect((await garbage.json()).error.code).toBe("unauthenticated");

    // A presented-but-wrong credential is 403, and equally unparsed.
    const readOnly = await issueCredential(base, gmToken, "reader", ["codex:read"]);
    const underscoped = await fetch(`${base}/api/v1/codex/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${readOnly.token}`, "content-type": "application/json" },
      body: `{"codex": ${"x".repeat(2 * 1024 * 1024)}`
    });
    expect(underscoped.status, "...and so must a presented-but-underscoped one").toBe(403);

    // A GM's real restore still goes through the large parser, at a size the 512 KB fallback would refuse,
    // so the guard did not demote every import to the small limit.
    const folders = Array.from(
      { length: 7000 },
      (_, index) => `${"Folder".padEnd(39, "x")}/${String(index).padStart(39, "0")}`
    );
    const big = JSON.stringify({ codex: { pages: [], folders }, bundleVersion: 1 });
    expect(Buffer.byteLength(big), "the fixture has to be over the 512 KB fallback to mean anything").toBeGreaterThan(
      512 * 1024
    );
    const authorized = await fetch(`${base}/api/v1/codex/import`, {
      method: "POST",
      headers: bearer(gmToken),
      body: big
    });
    expect(authorized.status).toBe(200);
    // >= rather than ==: a nested path registers its parent too, so 7000 leaves under one shared parent
    // land as 7001 rows. The claim here is "the whole body arrived", not an exact folder count.
    expect((await authorized.json()).data.counts.folders).toBeGreaterThanOrEqual(7000);
  });
});

// The command and read tables are the one place a capability is defined: both transports register from
// them, so these check each entry against the wire contract and against the running server.
describe("the command and read tables", () => {
  type Operation = { security?: ReadonlyArray<Record<string, readonly string[]>> };
  const documented = openApiDocument.paths as unknown as Record<string, Record<string, Operation>>;
  const bearerScope = (operation: Operation | undefined) =>
    operation?.security?.find((entry) => "bearerAuth" in entry)?.bearerAuth;
  const offeredToPlayers = (operation: Operation | undefined) =>
    operation?.security?.some((entry) => "playerAuth" in entry) === true;
  /** A route with each `{param}` filled, so it can be called. */
  const concrete = (path: string) => path.replace(/\{[a-zA-Z]+\}/g, (match) => (match === "{id}" ? "1" : HERO_ID));

  it("defines every command in GAME_COMMANDS exactly once", () => {
    const types = gameCommands.map((command) => command.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual(Object.keys(GAME_COMMANDS).sort());
  });

  it("gives every command a socket event, a typed route and an OpenAPI operation that agree on scope and audience", () => {
    for (const command of gameCommands) {
      const route = GAME_COMMANDS[command.type];
      expect(socketEventOf(command.type), command.type).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
      const operation = documented[route.path]?.[route.method];
      expect(operation, `${route.method.toUpperCase()} ${route.path} (${command.type}) is undocumented`).toBeDefined();
      expect(bearerScope(operation), command.type).toEqual([route.scope]);
      // A GM-only command must not be documented as open to player sessions.
      if (command.gmOnly !== undefined) expect(offeredToPlayers(operation), command.type).toBe(false);
    }
  });

  it("gives every read a documented GET with its scope, open to players exactly when the read is", () => {
    for (const read of gameReads) {
      const operation = documented[read.path]?.get;
      expect(operation, `GET ${read.path} (${read.event}) is undocumented`).toBeDefined();
      expect(bearerScope(operation), read.event).toEqual([read.scope]);
      expect(offeredToPlayers(operation), read.event).toBe(!("gmOnly" in read));
    }
  });

  it("serves every command and read over HTTP and the socket, behind authentication", async () => {
    const { base } = await boot();
    for (const command of gameCommands) {
      const route = GAME_COMMANDS[command.type];
      const response = await fetch(base + concrete(route.path), { method: route.method.toUpperCase() });
      expect(response.status, `${route.method.toUpperCase()} ${route.path}`).toBe(401);
    }
    for (const read of gameReads)
      expect((await fetch(base + concrete(read.path))).status, `GET ${read.path}`).toBe(401);

    // A socket that never joined reaches every handler and is turned away by the same gate.
    const socket = connect(base, { transports: ["websocket"], reconnection: false, forceNew: true });
    cleanups.push(async () => {
      socket.disconnect();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    const events = [
      ...gameCommands.map((command) => socketEventOf(command.type)),
      ...gameReads.map((read) => read.event)
    ];
    for (const event of events) {
      const ack = await new Promise<{ ok: boolean; message?: string }>((resolve) =>
        (socket.emit as (...args: unknown[]) => void)(event, {}, resolve)
      );
      expect(ack, event).toEqual({ ok: false, code: "not_joined", message: "Join a session first." });
    }
  });

  it("refuses a player every GM-only command and read with its own refusal, before reading the payload", async () => {
    const { base, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    for (const command of gameCommands.filter((candidate) => candidate.gmOnly !== undefined)) {
      const route = GAME_COMMANDS[command.type];
      const response = await fetch(base + concrete(route.path), {
        method: route.method.toUpperCase(),
        headers: bearer(playerToken),
        body: JSON.stringify({ unexpected: true })
      });
      expect(response.status, command.type).toBe(403);
      expect((await response.json()).error.message, command.type).toBe(command.gmOnly);
    }
    for (const read of gameReads.filter((candidate) => "gmOnly" in candidate)) {
      const response = await fetch(base + concrete(read.path), { headers: bearer(playerToken) });
      expect(response.status, read.event).toBe(403);
    }
  });
});

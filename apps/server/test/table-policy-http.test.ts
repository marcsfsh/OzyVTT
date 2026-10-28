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
import { png } from "./image-fixtures.js";

// The table-policy surface over the integration HTTP adapter, with real authorization, persistence
// and projection: standing rules policy, per-family exceptions, staging defaults, mid-fight add,
// prepare-and-go, the archived-sheet keepsake toggle, and archiving releasing a claim.

const HERO_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";

/** A real, schema-valid character sheet so the sheet-editing door under test has something to edit. */
const HERO_DEFINITION = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));

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
        definitionId: `import-${HERO_ID}`
      },
      {
        id: SECOND_ID,
        name: "Second Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 18, maximum: 18 },
        definitionId: `import-${SECOND_ID}`
      }
    ],
    definitions: [{ id: `import-${HERO_ID}`, definition: HERO_DEFINITION }]
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

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
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const snapshot = async (base: string, token: string, view?: "player") =>
  (await (await fetch(base + GAME_PATHS.snapshot + (view ? "?view=player" : ""), { headers: bearer(token) })).json())
    .data.game;

describe("standing rules policy", () => {
  it("is GM-only, stores per-family exceptions, and does NOT retune the encounter in progress", async () => {
    const { base, gmToken, server, mapAssetId } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    expect((await post(base, GAME_PATHS.rulesPolicy, playerToken, { dial: "freeform" })).status).toBe(403);

    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const accepted = await post(base, GAME_PATHS.rulesPolicy, gmToken, {
      dial: "assisted",
      exceptions: { movement: "freeform" }
    });
    expect(accepted.status).toBe(200);

    const game = await snapshot(base, gmToken);
    expect(game.rulesPolicy).toEqual({ dial: "assisted", exceptions: { movement: "freeform" } });
    // The live fight keeps the settings it started with; policy is what the next fight inherits.
    expect(game.combat.rulesMode).toBe("strict");
  });

  it("rejects a misspelled family instead of silently ignoring it", async () => {
    const { base, gmToken } = await boot();
    const response = await post(base, GAME_PATHS.rulesPolicy, gmToken, {
      dial: "strict",
      exceptions: { movememt: "freeform" }
    });
    expect(response.status).toBe(400);
  });

  it("keeps stored exceptions when a request omits them", async () => {
    const { base, gmToken } = await boot();
    await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "strict", exceptions: { targeting: "assisted" } });
    await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "freeform" });
    expect((await snapshot(base, gmToken)).rulesPolicy).toEqual({
      dial: "freeform",
      exceptions: { targeting: "assisted" }
    });
  });

  it("seeds each new encounter from the policy, and lets the start command override it per encounter", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.rulesPolicy, gmToken, { dial: "assisted", exceptions: { movement: "freeform" } });

    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const seeded = await snapshot(base, gmToken);
    expect(seeded.combat.rulesMode).toBe("assisted");
    expect(seeded.combat.ruleExceptions).toEqual({ movement: "freeform" });

    await post(base, GAME_PATHS.encounterEnd, gmToken, {});
    await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [{ actorId: HERO_ID, score: 10 }],
      rulesMode: "strict",
      ruleExceptions: { slots: "strict" }
    });
    const overridden = await snapshot(base, gmToken);
    expect(overridden.combat.rulesMode).toBe("strict");
    expect(overridden.combat.ruleExceptions).toEqual({ slots: "strict" });
  });

  it("changes the live encounter through the rules-mode command, leaving exceptions alone when omitted", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    await post(base, GAME_PATHS.rulesMode, gmToken, { mode: "assisted", exceptions: { economy: "freeform" } });
    expect((await snapshot(base, gmToken)).combat.ruleExceptions).toEqual({ economy: "freeform" });
    // A mode-only payload keeps its original meaning.
    await post(base, GAME_PATHS.rulesMode, gmToken, { mode: "strict" });
    const after = await snapshot(base, gmToken);
    expect(after.combat.rulesMode).toBe("strict");
    expect(after.combat.ruleExceptions).toEqual({ economy: "freeform" });
  });

  it("shows players the table's rules configuration (it holds no secrets, exactly like rulesMode)", async () => {
    const { base, gmToken, server, mapAssetId } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.encounterStart, gmToken, {
      mapAssetId,
      entries: [{ actorId: HERO_ID, score: 10 }],
      ruleExceptions: { movement: "freeform" }
    });
    expect((await snapshot(base, playerToken, "player")).combat.ruleExceptions).toEqual({ movement: "freeform" });
  });
});

describe("staging defaults and the one-command mid-encounter add", () => {
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

  it("lands a mid-encounter add on the roster AND in the encounter in one command and one revision", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const before = (await snapshot(base, gmToken)).revision;

    const commandId = randomUUID();
    expect(
      (
        await post(base, GAME_PATHS.actors, gmToken, {
          commandId,
          definitionId: "giant-crocodile",
          joinEncounter: true
        })
      ).status
    ).toBe(200);

    const game = await snapshot(base, gmToken);
    expect(game.revision).toBe(before + 1);
    expect(game.actors.map((actor: { id: string }) => actor.id)).toContain(commandId);
    expect(game.combat.initiative.map((entry: { actorId: string }) => entry.actorId)).toContain(commandId);
    // The tray token comes with it, so no second trip is needed.
    expect(game.combat.tokens.map((token: { actorId: string }) => token.actorId)).toContain(commandId);
  });

  it("ignores joinEncounter when no encounter is running (the roster add is the whole intent)", async () => {
    const { base, gmToken } = await boot();
    const commandId = randomUUID();
    expect(
      (
        await post(base, GAME_PATHS.actors, gmToken, {
          commandId,
          definitionId: "giant-crocodile",
          joinEncounter: true
        })
      ).status
    ).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.actors.map((actor: { id: string }) => actor.id)).toContain(commandId);
    expect(game.combat.initiative).toEqual([]);
  });
});

describe("the two doors into an encounter", () => {
  it("prepares and goes live in one command", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const encounterId = randomUUID();
    expect(
      (
        await post(base, GAME_PATHS.scenes, gmToken, {
          commandId: encounterId,
          name: "Ambush",
          mapAssetId,
          combatantIds: [HERO_ID],
          activate: true
        })
      ).status
    ).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.combat.activeEncounterId).toBe(encounterId);
    expect(game.combat.initiative.map((entry: { actorId: string }) => entry.actorId)).toEqual([HERO_ID]);
    // The active scene's own slot stays empty; its live copy is the top-level combat.
    expect(game.combat.encounters.find((scene: { id: string }) => scene.id === encounterId).combat.initiative).toEqual(
      []
    );
  });

  it("still only prepares when activate is absent", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const encounterId = randomUUID();
    await post(base, GAME_PATHS.scenes, gmToken, {
      commandId: encounterId,
      name: "Later",
      mapAssetId,
      combatantIds: [HERO_ID]
    });
    const game = await snapshot(base, gmToken);
    expect(game.combat.activeEncounterId).toBeNull();
    expect(game.combat.initiative).toEqual([]);
  });

  it("starts on the live encounter's staged list when the request omits the combatants", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const encounterId = randomUUID();
    await post(base, GAME_PATHS.scenes, gmToken, {
      commandId: encounterId,
      name: "Ambush",
      mapAssetId,
      combatantIds: [HERO_ID, SECOND_ID],
      activate: true
    });
    expect((await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId })).status).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.combat.active).toBe(true);
    expect(game.combat.initiative.map((entry: { actorId: string }) => entry.actorId).sort()).toEqual(
      [HERO_ID, SECOND_ID].sort()
    );
  });

  it("refuses to start with no combatants at all rather than inventing a roster", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    const response = await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/Choose 1 to 200 combatants/);
  });

  it("keeps the right refusal when an encounter is already running (derivation must not mask it)", async () => {
    const { base, gmToken, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    const response = await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toMatch(/End the active encounter/);
  });
});

describe("archived characters: sharing and claims", () => {
  it("archiving a claimed character releases the claim, so its player is not locked out invisibly", async () => {
    const { base, gmToken, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(base, GAME_PATHS.claims, playerToken, { actorId: HERO_ID })).status).toBe(200);

    expect(
      (await post(base, GAME_PATHS.actorArchived.replace("{actorId}", HERO_ID), gmToken, { archived: true })).status
    ).toBe(200);
    const game = await snapshot(base, gmToken);
    expect(game.actors.find((actor: { id: string }) => actor.id === HERO_ID).ownerSessionId).toBeNull();

    // ...and the player can now claim someone else.
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

    expect(
      (await post(base, GAME_PATHS.actorSheetPreview.replace("{actorId}", HERO_ID), gmToken, { enabled: true })).status
    ).toBe(200);
    const shared = await snapshot(base, playerToken, "player");
    expect(shared.archivedCharacters).toEqual([{ id: HERO_ID, name: "Public Hero" }]);
    // Still absent from the roster itself: archived means out of play, shared or not.
    expect(shared.actors.map((actor: { id: string }) => actor.id)).not.toContain(HERO_ID);

    await post(base, GAME_PATHS.actorSheetPreview.replace("{actorId}", HERO_ID), gmToken, { enabled: false });
    expect((await snapshot(base, playerToken, "player")).archivedCharacters).toEqual([]);
  });

  it("keeps the sheet-preview toggle GM-only", async () => {
    const { base, server } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect(
      (await post(base, GAME_PATHS.actorSheetPreview.replace("{actorId}", HERO_ID), playerToken, { enabled: true }))
        .status
    ).toBe(403);
  });
});

describe("per-replay sharing", () => {
  it("stores an archive's visibility, defaults to hidden, and 404s an unknown archive", async () => {
    const { base, gmToken, server, mapAssetId } = await boot();
    await post(base, GAME_PATHS.encounterStart, gmToken, { mapAssetId, entries: [{ actorId: HERO_ID, score: 10 }] });
    await post(base, GAME_PATHS.encounterEnd, gmToken, {});

    const listed = (await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(gmToken) })).json())
      .data.replays;
    expect(listed).toHaveLength(1);
    // Hidden until shared: an ended fight is the GM's record until the GM says otherwise.
    expect(listed[0].playerVisible).toBe(false);

    const path = ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", String(listed[0].id));
    expect((await post(base, path, gmToken, { playerVisible: true })).status).toBe(200);
    expect(
      (await (await fetch(base + ENCOUNTER_ARCHIVE_PATHS.collection, { headers: bearer(gmToken) })).json()).data
        .replays[0].playerVisible
    ).toBe(true);

    expect(
      (await post(base, ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", "9999"), gmToken, { playerVisible: true }))
        .status
    ).toBe(404);
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

    // The sheet's free-text identity editor is the other way to set a character's level; it must not
    // bypass the cap the guided builder enforces.
    const identityPath = GAME_PATHS.characterSetIdentity.replace("{actorId}", HERO_ID);
    const refused = await post(base, identityPath, gmToken, {
      character: { classes: [{ id: "fighter", name: "Fighter", level: 9 }], feats: [] }
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toMatch(/up to level 5/);
  });
});

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type CombatLogEntry, type RollRecord } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { CombatLogStore, projectFeedRow } from "../src/combat-log.js";
import { describeRoll, recordRoll, rollFeedIsGmOnly, rollsForCommand } from "../src/roll-history.js";
import { createServer } from "../src/server.js";

/**
 * THE TABLE FEED (D11 / WI2). Two logs became one: `GameState.rolls` is the live 200-roll hot window,
 * and the combat-log store is the durable feed every roll now reaches. These tests pin the three things
 * that made "my roll vanished" unanswerable before - a roll that never reached the log, a roll attributed
 * to nobody, and initiative that left no dice behind - plus the viewer-safety boundary the merge created:
 * one store now holds private rolls, so the read path must never hand a player somebody else's die.
 */

const HERO = "10000000-0000-4000-8000-000000000001";
const SECRET = "10000000-0000-4000-8000-000000000002";
const OTHER = "10000000-0000-4000-8000-000000000003";
const MAP = "20000000-0000-5000-8000-000000000001";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function roll(overrides: Partial<RollRecord> = {}): RollRecord {
  return {
    id: randomUUID(), commandId: randomUUID(), initiatorSessionId: randomUUID(), initiatorRole: "player",
    initiatorLabel: "Public Hero", label: "Athletics check", actorId: HERO, purpose: "check", visibility: "public",
    formula: "1d20+3", normalizedFormula: "1d20+3",
    dice: [{ group: 0, sides: 20, face: 14, kept: true, sign: 1 }], modifiers: [{ value: 3, sign: 1 }],
    total: 17, createdAt: new Date().toISOString(), ...overrides
  };
}

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-feed-"));
  const path = join(directory, "vtt.sqlite");
  const log = new CombatLogStore(path);
  await log.initialize();
  cleanups.push(async () => { log.close(); await rm(directory, { recursive: true, force: true }); });
  return { log, path, directory };
}

describe("feed store: migration and per-reader reads", () => {
  it("adds the feed columns to a database created before they existed, and reads legacy rows as plain narration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-feed-legacy-"));
    const path = join(directory, "vtt.sqlite");
    // Exactly the pre-feed schema, with a row already in it.
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE combat_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, gm_only INTEGER NOT NULL, revision INTEGER NOT NULL) STRICT;");
    legacy.prepare("INSERT INTO combat_log (at, kind, text, gm_only, revision) VALUES (?, ?, ?, ?, ?)").run(new Date().toISOString(), "turn", "Round 1 - Alpha's turn.", 0, 1);
    legacy.close();

    const log = new CombatLogStore(path);
    await log.initialize();
    cleanups.push(async () => { log.close(); await rm(directory, { recursive: true, force: true }); });

    const columns = new Set((new DatabaseSync(path).prepare("PRAGMA table_info(combat_log)").all() as unknown as ReadonlyArray<{ name: string }>).map((column) => column.name));
    expect(columns).toContain("actor_id");
    expect(columns).toContain("visibility");
    expect(columns).toContain("initiator_session_id");
    expect(columns).toContain("payload_json");

    const [legacyRow] = log.list(false);
    expect(legacyRow.text).toBe("Round 1 - Alpha's turn.");
    expect(legacyRow.roll).toBeUndefined();
    expect(legacyRow.private).toBeUndefined();

    // Initializing a second time must not double-add the columns (ALTER TABLE would throw).
    const again = new CombatLogStore(path);
    await expect(again.initialize()).resolves.toBeUndefined();
    again.close();
  });

  it("gives each reader exactly their own slice of the public/self-only/blind/gm-only matrix", async () => {
    const { log } = await store();
    const mine = randomUUID();
    const yours = randomUUID();
    log.append({ kind: "roll", text: "public", gmOnly: false, revision: 1, roll: roll({ visibility: "public" }) });
    log.append({ kind: "roll", text: "mine", gmOnly: false, revision: 1, roll: roll({ visibility: "self-only", initiatorSessionId: mine }) });
    log.append({ kind: "roll", text: "yours", gmOnly: false, revision: 1, roll: roll({ visibility: "self-only", initiatorSessionId: yours }) });
    log.append({ kind: "roll", text: "blind", gmOnly: rollFeedIsGmOnly(roll({ visibility: "blind" })), revision: 1, roll: roll({ visibility: "blind", initiatorSessionId: mine }) });
    log.append({ kind: "roll", text: "gm", gmOnly: true, revision: 1, roll: roll({ visibility: "gm-only" }) });
    log.append({ kind: "turn", text: "narration", gmOnly: false, revision: 1 });

    expect(log.list(true).map((entry) => entry.text)).toEqual(["public", "mine", "yours", "blind", "gm", "narration"]);
    // A player sees public lines plus their OWN private roll - never another player's, never a GM line,
    // and never the blind roll they themselves made (the `hiddenFromRoller` contract).
    expect(log.list(false, 250, mine).map((entry) => entry.text)).toEqual(["public", "mine", "narration"]);
    expect(log.list(false, 250, yours).map((entry) => entry.text)).toEqual(["public", "yours", "narration"]);
    expect(log.list(false).map((entry) => entry.text)).toEqual(["public", "narration"]);
  });

  it("marks a player's own private roll and never serializes the roller's session id", async () => {
    const { log } = await store();
    const mine = randomUUID();
    log.append({ kind: "roll", text: "mine", gmOnly: false, revision: 1, roll: roll({ visibility: "self-only", initiatorSessionId: mine }) });
    log.append({ kind: "roll", text: "open", gmOnly: false, revision: 1, roll: roll({ visibility: "public", initiatorSessionId: mine }) });

    const [privateRow, publicRow] = log.list(false, 250, mine);
    expect(privateRow.private).toBe(true);
    expect(publicRow.private).toBeUndefined();
    // Viewer safety: the session id is the one field on a RollRecord that identifies a person. It must
    // not reach ANY recipient through the feed - the GM's own view included.
    for (const view of [JSON.stringify(log.list(true)), JSON.stringify(log.list(false, 250, mine)), JSON.stringify(log.exportSince(0))]) {
      expect(view).not.toContain(mine);
      expect(view).not.toContain("initiatorSessionId");
    }
  });

  it("attributes a roll row to its character and carries the whole roll", async () => {
    const { log } = await store();
    const record = roll({ label: "Longsword" });
    const stored = log.append({ kind: "roll", text: describeRoll(record), gmOnly: false, revision: 3, roll: record });
    const [entry] = log.list(true);
    expect(entry.actorId).toBe(HERO);
    expect(entry.kind).toBe("roll");
    expect(entry.roll?.id).toBe(record.id);
    expect(entry.roll?.total).toBe(17);
    expect(entry.text).toContain("Public Hero rolled 17 on Longsword");
    // The pre-projection row keeps what projection strips.
    expect(stored.initiatorSessionId).toBe(record.initiatorSessionId);
    expect(projectFeedRow(stored, { gm: false })).not.toBeNull();
  });
});

describe("one feed line per moment", () => {
  it("never writes the same line twice: no appendLog immediately followed by an identical broadcast", () => {
    // `broadcastTableEvent` has ALWAYS written its own durable line, so ten handlers that called
    // `appendLog` and then broadcast the identical entry printed every damage, reaction, effect and
    // death save TWICE in the log a player reads. A feed that repeats itself is not one feed (D11).
    const source = readFileSync(fileURLToPath(new URL("../src/game-operations.ts", import.meta.url)), "utf8").split("\n");
    const duplicates: string[] = [];
    for (let index = 0; index < source.length - 1; index += 1) {
      const current = source[index].trim();
      const next = source[index + 1].trim();
      if (!current.startsWith("context.appendLog(") || !next.startsWith("context.broadcastTableEvent(")) continue;
      if (current.slice("context.appendLog(".length) === next.slice("context.broadcastTableEvent(".length)) duplicates.push(`game-operations.ts:${index + 1}`);
    }
    expect(duplicates, "Broadcasting IS the write. Drop the appendLog call, or pass `logged: false` on the broadcast when the durable record is a richer row you write yourself.").toEqual([]);
  });
});

describe("recordRoll: the one writer", () => {
  it("trims the live window at 200 and reports every roll a command produced", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1, actors: [] });
    const commandId = randomUUID();
    for (let index = 0; index < 205; index += 1) recordRoll(state, roll({ commandId: index < 3 ? commandId : randomUUID() }));
    expect(state.rolls.length).toBe(200);
    // The three tagged rolls aged out of the window with the rest - `rollsForCommand` reads the window,
    // so the feed row is written from the SAME committed state the command produced, right after it.
    const fresh = GameStateSchema.parse({ schemaVersion: 1, actors: [] });
    recordRoll(fresh, roll({ commandId }));
    recordRoll(fresh, roll({ commandId }));
    recordRoll(fresh, roll({ commandId: randomUUID() }));
    expect(rollsForCommand(fresh, commandId).length).toBe(2);
  });

  it("keeps blind and gm-only rolls out of the player half of the feed, but not self-only", () => {
    expect(rollFeedIsGmOnly(roll({ visibility: "gm-only" }))).toBe(true);
    expect(rollFeedIsGmOnly(roll({ visibility: "blind" }))).toBe(true);
    expect(rollFeedIsGmOnly(roll({ visibility: "self-only" }))).toBe(false);
    expect(rollFeedIsGmOnly(roll({ visibility: "public" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// End to end over the public HTTP surface: the same doors a client uses.
// ---------------------------------------------------------------------------------------------

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

function initialState() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: HERO, name: "Public Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, initiative: 2 },
    { id: SECRET, name: "Unrevealed Tyrant", kind: "monster", visibility: "gm-only", hp: { current: 99, maximum: 99 } },
    { id: OTHER, name: "Second Hero", kind: "player-character", visibility: "public", hp: { current: 18, maximum: 18 } }
  ] });
}

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-feed-http-"));
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
  const imported = await server.mapAssets.import(png(900, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Feed Arena", "battlemap");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
async function feed(base: string, token: string): Promise<readonly CombatLogEntry[]> {
  const response = await fetch(base + GAME_PATHS.log, { headers: bearer(token) });
  expect(response.status).toBe(200);
  return (await response.json()).data.entries as readonly CombatLogEntry[];
}

describe("the feed over the API", () => {
  it("puts a loose dice.roll in the feed, attributed to the roller's claimed character", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    // The player claims Public Hero; the tray roll below names no actor at all - the SERVER attributes it.
    expect((await post(base, GAME_PATHS.claims, playerToken, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);

    const rolled = await post(base, GAME_PATHS.rolls, playerToken, { commandId: randomUUID(), formula: "1d20+3", purpose: "check", visibility: "public", label: "Athletics check" });
    expect(rolled.status).toBe(200);

    const rows = (await feed(base, playerToken)).filter((entry) => entry.kind === "roll");
    expect(rows.length).toBe(1);
    expect(rows[0].actorId).toBe(HERO);
    expect(rows[0].roll?.actorId).toBe(HERO);
    expect(rows[0].text).toContain("rolled");
    // Same roll, same id, in the hot window - so a client reading both dedupes instead of double-rendering.
    expect(server.store.snapshot.rolls.some((record) => record.id === rows[0].roll?.id)).toBe(true);
    expect(gmToken).toBeTruthy();
  });

  it("keeps one player's self-only roll out of another player's feed, and the GM's out of both", async () => {
    const { base, server, gmToken } = await boot();
    const mine = server.auth.issuePlayerSession();
    const yours = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, mine, { commandId: randomUUID(), actorId: HERO });
    await post(base, GAME_PATHS.claims, yours, { commandId: randomUUID(), actorId: OTHER });

    await post(base, GAME_PATHS.rolls, mine, { commandId: randomUUID(), formula: "1d20", purpose: "check", visibility: "self-only", label: "Secret plan" });
    await post(base, GAME_PATHS.rolls, gmToken, { commandId: randomUUID(), formula: "1d20", purpose: "check", visibility: "gm-only", label: "GM deliberation" });

    const mineRows = await feed(base, mine);
    const yoursRows = await feed(base, yours);
    const gmRows = await feed(base, gmToken);

    expect(mineRows.some((entry) => entry.text.includes("Secret plan"))).toBe(true);
    expect(mineRows.find((entry) => entry.text.includes("Secret plan"))?.private).toBe(true);
    expect(JSON.stringify(yoursRows)).not.toContain("Secret plan");
    expect(JSON.stringify(yoursRows)).not.toContain("GM deliberation");
    expect(JSON.stringify(mineRows)).not.toContain("GM deliberation");
    expect(gmRows.some((entry) => entry.text.includes("GM deliberation"))).toBe(true);
    // Neither player's feed may carry a session id.
    for (const view of [JSON.stringify(mineRows), JSON.stringify(yoursRows)]) {
      expect(view).not.toContain(mine);
      expect(view).not.toContain(yours);
    }
  });

  it("records initiative as real rolls, and a hidden combatant's initiative stays GM-only", async () => {
    const { base, server, gmToken, mapAssetId } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    const started = await post(base, GAME_PATHS.encounterStart, gmToken, { commandId: randomUUID(), mapAssetId, entries: [{ actorId: HERO }, { actorId: SECRET }] });
    expect(started.status).toBe(200);

    const initiativeRolls = server.store.snapshot.rolls.filter((record) => record.label === "Initiative");
    expect(initiativeRolls.length).toBe(2);
    expect(initiativeRolls.map((record) => record.actorId).sort()).toEqual([HERO, SECRET].sort());
    expect(initiativeRolls.find((record) => record.actorId === SECRET)?.visibility).toBe("gm-only");
    expect(initiativeRolls.find((record) => record.actorId === HERO)?.purpose).toBe("check");

    const gmRows = (await feed(base, gmToken)).filter((entry) => entry.kind === "roll");
    const playerRows = (await feed(base, playerToken)).filter((entry) => entry.kind === "roll");
    expect(gmRows.length).toBe(2);
    expect(playerRows.length).toBe(1);
    expect(playerRows[0].actorId).toBe(HERO);
    expect(JSON.stringify(playerRows)).not.toContain("Unrevealed Tyrant");
  });

  it("does not write a second feed row when a command is safely retried", async () => {
    const { base, server, gmToken } = await boot();
    const commandId = randomUUID();
    const body = { commandId, formula: "1d20", purpose: "check", visibility: "public", label: "Perception check" };
    expect((await post(base, GAME_PATHS.rolls, gmToken, body)).status).toBe(200);
    expect((await post(base, GAME_PATHS.rolls, gmToken, body)).status).toBe(200);
    const rows = (await feed(base, gmToken)).filter((entry) => entry.text.includes("Perception check"));
    expect(rows.length).toBe(1);
    expect(server.store.snapshot.rolls.filter((record) => record.commandId === commandId).length).toBe(1);
  });
});

/**
 * THE INPUT NONE OF THE THREE GATES CAN SEE: a row naming a combatant the roster no longer holds.
 *
 * The feed's live re-derivation (`appendLog`, `server.ts`) used to ask `visibility === "gm-only"`,
 * and `undefined === "gm-only"` is false - so a missing combatant read as "not hidden" and its row
 * went to every player. Its two siblings answer the same input the other way: `broadcastTableEvent`
 * requires every named combatant to BE public, and the resolver's `namesAHiddenCombatant`
 * (`action-resolution.ts`) reads `?.visibility !== "public"`. One question, three reads, and the one
 * that writes the durable row was the one that failed OPEN.
 *
 * The state is written straight into the store because no COMMAND produces it - `removeActor`
 * refuses to drop a combatant who is in an active encounter, which is exactly why the hole survived:
 * it is unreachable until the day something makes it reachable, and by then the gate is either right
 * or it is a leak. The same technique the mastery suite uses to commit a scene switch mid-resolve.
 */
describe("a feed row naming a combatant the roster no longer holds", () => {
  it("stays in the GM's feed alone, the way a hidden combatant's row does", async () => {
    const { base, server, gmToken, mapAssetId } = await boot();
    const playerToken = server.auth.issuePlayerSession();
    expect((await post(base, GAME_PATHS.encounterStart, gmToken, { commandId: randomUUID(), mapAssetId, entries: [{ actorId: HERO, score: 20 }, { actorId: OTHER, score: 10 }] })).status).toBe(200);

    // THE CONTROL, taken BEFORE anything vanishes: the turn line for a public combatant does reach
    // this player, so "absent" below is a decision and not an empty feed.
    expect((await feed(base, playerToken)).map((entry) => entry.text)).toContain("Round 1 - Public Hero's turn.");

    await server.store.execute({ id: randomUUID(), type: "test.roster-drop" }, (state) => {
      state.actors = state.actors.filter((actor) => actor.id !== OTHER);
    });
    expect((await post(base, GAME_PATHS.turnEnd, gmToken, { commandId: randomUUID() })).status).toBe(200);
    expect(server.store.snapshot.combat.turnActorId).toBe(OTHER);

    // THE FAR END: the row exists, the GM reads it, and the player's own feed does not carry it.
    const gmRows = (await feed(base, gmToken)).map((entry) => entry.text);
    const playerRows = (await feed(base, playerToken)).map((entry) => entry.text);
    expect(gmRows).toContain("Round 1 - A combatant's turn.");
    expect(playerRows).not.toContain("Round 1 - A combatant's turn.");
    // ...and the row the player DID get is still there, so nothing swept the feed clean.
    expect(playerRows).toContain("Round 1 - Public Hero's turn.");
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState, type PlayerView } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// The GM calls for a roll: a check or a save from one or several characters, with a DC, answered on the players'
// devices and collected for the GM. A save call reuses pending saves; a blind call keeps its DC and results with the GM.

const HERO = "10000000-0000-4000-8000-0000000000d1";
const OTHER = "10000000-0000-4000-8000-0000000000d2";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Two characters on the fixture's sheet: Str 16, Dex 14, Con 14, PB 2. */
function party(): GameState {
  const sheet = (id: string, name: string) => ({
    id,
    definition: { ...(loadActorFixture("player-character") as Record<string, unknown>), id, name }
  });
  return GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [sheet("hero-def", "Hero"), sheet("other-def", "Other")],
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "hero-def"
      },
      {
        id: OTHER,
        name: "Other",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "other-def"
      }
    ]
  });
}

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-calls-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: party()
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
  const hero = server.auth.issuePlayerSession();
  const other = server.auth.issuePlayerSession();
  expect((await post(base, GAME_PATHS.claims, hero, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);
  expect((await post(base, GAME_PATHS.claims, other, { commandId: randomUUID(), actorId: OTHER })).status).toBe(200);
  return { base, server, gmToken, hero, other };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const viewOf = async (base: string, token: string): Promise<PlayerView> =>
  (await (await fetch(base + GAME_PATHS.snapshot, { headers: bearer(token) })).json()).data.game;
const answerPath = (callId: string) => GAME_PATHS.rollCallAnswer.replace("{callId}", callId);
const closePath = (callId: string) => GAME_PATHS.rollCallClose.replace("{callId}", callId);

describe("the GM's call for a check", () => {
  it("asks each named character once, shows each player only their own part, and collects the results", async () => {
    const { base, server, gmToken, hero, other } = await boot();
    expect(
      (
        await post(base, GAME_PATHS.rollCalls, hero, {
          commandId: randomUUID(),
          kind: "check",
          ability: "dex",
          actorIds: [HERO]
        })
      ).status
    ).toBe(403);

    const callId = randomUUID();
    const started = await post(base, GAME_PATHS.rollCalls, gmToken, {
      commandId: callId,
      kind: "check",
      ability: "dex",
      skill: "stealth",
      dc: 12,
      actorIds: [HERO, OTHER]
    });
    expect(started.status).toBe(200);
    expect((await started.json()).data.callId).toBe(callId);

    const heroView = await viewOf(base, hero);
    expect(heroView.rollCalls).toEqual([
      expect.objectContaining({
        id: callId,
        kind: "check",
        subject: { ability: "dex", skill: "stealth" },
        dc: 12,
        entries: [{ actorId: HERO, answered: false }]
      })
    ]);

    // Fixture Dex 14 (+2), no Stealth proficiency.
    const answered = await post(base, answerPath(callId), hero, { commandId: randomUUID(), callId, actorId: HERO });
    expect(answered.status).toBe(200);
    const outcome = (await answered.json()).data.check;
    expect(outcome).toMatchObject({ label: "Dexterity (Stealth)", dc: 12 });
    expect(outcome.total).toBe(outcome.natural + 2);
    expect(outcome.success).toBe(outcome.total >= 12);
    expect(
      (await post(base, answerPath(callId), hero, { commandId: randomUUID(), callId, actorId: HERO })).status
    ).toBe(409);
    expect(
      (await post(base, answerPath(callId), hero, { commandId: randomUUID(), callId, actorId: OTHER })).status
    ).toBe(403);

    // Answered, the call is done for that player: it leaves their view, and the GM keeps the result.
    expect((await viewOf(base, hero)).rollCalls).toEqual([]);
    const call = server.store.snapshot.rollCalls.find((entry) => entry.id === callId)!;
    expect(call.entries.find((entry) => entry.actorId === HERO)!.result).toMatchObject({ total: outcome.total });
    expect(call.entries.find((entry) => entry.actorId === OTHER)!.result).toBeUndefined();

    // The GM may roll for anyone the call names; then closes it.
    expect(
      (await post(base, answerPath(callId), gmToken, { commandId: randomUUID(), callId, actorId: OTHER })).status
    ).toBe(200);
    expect((await post(base, closePath(callId), hero, { commandId: randomUUID(), callId })).status).toBe(403);
    expect((await post(base, closePath(callId), gmToken, { commandId: randomUUID(), callId })).status).toBe(200);
    expect(server.store.snapshot.rollCalls).toEqual([]);
    expect((await viewOf(base, other)).rollCalls).toEqual([]);
  });

  it("keeps a blind call's DC and results with the GM", async () => {
    const { base, server, gmToken, hero } = await boot();
    const callId = randomUUID();
    await post(base, GAME_PATHS.rollCalls, gmToken, {
      commandId: callId,
      kind: "check",
      ability: "wis",
      skill: "insight",
      dc: 15,
      actorIds: [HERO],
      blind: true
    });
    expect((await viewOf(base, hero)).rollCalls[0]).toMatchObject({ blind: true, dc: null });
    const answered = await post(base, answerPath(callId), hero, { commandId: randomUUID(), callId, actorId: HERO });
    const reply = (await answered.json()).data;
    expect(reply.hiddenFromRoller).toBe(true);
    expect(reply.check).toBeUndefined();
    expect((await viewOf(base, hero)).rollCalls).toEqual([]);
    expect(server.store.snapshot.rolls.at(-1)).toMatchObject({ actorId: HERO, visibility: "blind" });
    expect(server.store.snapshot.rollCalls[0].entries[0].result).toMatchObject({ success: expect.any(Boolean) });
  });

  it("refuses a save with no DC, and a blind save", async () => {
    const { base, gmToken } = await boot();
    const save = { kind: "save", ability: "con", actorIds: [HERO] };
    expect((await post(base, GAME_PATHS.rollCalls, gmToken, { commandId: randomUUID(), ...save })).status).toBe(400);
    expect(
      (await post(base, GAME_PATHS.rollCalls, gmToken, { commandId: randomUUID(), ...save, dc: 12, blind: true }))
        .status
    ).toBe(400);
  });
});

describe("the GM's call for a save", () => {
  it("opens a pending save for each character, reports the answer back, and closing dismisses the rest", async () => {
    const { base, server, gmToken, hero } = await boot();
    const callId = randomUUID();
    await post(base, GAME_PATHS.rollCalls, gmToken, {
      commandId: callId,
      kind: "save",
      ability: "con",
      dc: 13,
      actorIds: [HERO, OTHER]
    });
    const saves = server.store.snapshot.combat.pendingSaves;
    expect(saves.map((save) => save.targetActorId)).toEqual([HERO, OTHER]);
    expect(saves.every((save) => save.callId === callId && save.dc === 13 && save.ability === "con")).toBe(true);
    const call = server.store.snapshot.rollCalls[0];
    expect(call.entries.map((entry) => entry.saveId)).toEqual(saves.map((save) => save.id));

    // The player's copy of the save carries no call id; the call names their entry's save.
    const heroView = await viewOf(base, hero);
    const heroSave = heroView.combat.pendingSaves.find((save) => save.targetActorId === HERO)!;
    expect("callId" in heroSave).toBe(false);
    expect(heroView.rollCalls[0].entries).toEqual([{ actorId: HERO, saveId: heroSave.id, answered: false }]);
    expect(
      (await post(base, answerPath(callId), hero, { commandId: randomUUID(), callId, actorId: HERO })).status
    ).toBe(409);

    const answered = await post(base, GAME_PATHS.saveAnswer.replace("{saveId}", heroSave.id), hero, {
      commandId: randomUUID(),
      saveId: heroSave.id,
      method: "roll",
      commit: true
    });
    expect(answered.status).toBe(200);
    const outcome = (await answered.json()).data.outcome;
    // Con 14 (+2), no save proficiency.
    expect(outcome.total).toBe(outcome.natural + 2);
    expect(server.store.snapshot.rollCalls[0].entries[0].result).toMatchObject({
      total: outcome.total,
      success: outcome.success
    });

    await post(base, closePath(callId), gmToken, { commandId: randomUUID(), callId });
    expect(server.store.snapshot.combat.pendingSaves).toEqual([]);
  });
});

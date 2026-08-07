import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type PlayerView } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { activateScene } from "../src/scenes.js";

/**
 * ASK THE GM (D8/D9). A blocked player used to hit a silent dead end - the server refused, the runner
 * showed nothing, and the only recourse was to say something out loud. These tests pin the whole loop:
 * the block becomes a question, the question belongs to exactly one player, and the GM's one tap
 * re-runs the parked command instead of asking them to reconstruct it.
 *
 * The Allow path carries the trap that makes or breaks the feature: the parked payload's
 * `expectedRevision` is the revision at ask time, so replaying it verbatim would 409 on every single
 * Allow. `rerunPayload` strips it - and the last test here is the one that would catch its return.
 */

const HERO = "10000000-0000-4000-8000-0000000000a1";
const OTHER = "10000000-0000-4000-8000-0000000000a2";
const GOBLIN = "10000000-0000-4000-8000-0000000000a3";
const MAP = "20000000-0000-5000-8000-0000000000a1";
const CORRIDOR = "40000000-0000-4000-8000-0000000000a1";
const IMPLICIT = "40000000-0000-4000-8000-0000000000a2";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

/**
 * A live fight, mid-turn: Hero is up, is PRONE, has a 30 ft Speed and has already spent all of it.
 * Standing up costs half their Speed and they have none left, so `actor.set-condition` blocks with
 * `movement.stand-up-cost` - the exact block the intake flagged as having wire support and no way for
 * a player to reach it (intake 02 Table 4).
 */
function initialState() {
  return GameStateSchema.parse({ schemaVersion: 1,
    actors: [
      { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, speedFeet: 30, conditions: [{ id: "prone" }] },
      { id: OTHER, name: "Second Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, speedFeet: 30, conditions: [{ id: "prone" }] },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ],
    combat: {
      active: true, round: 1, turnActorId: HERO, rulesMode: "strict",
      initiative: [{ actorId: HERO, score: 20 }, { actorId: OTHER, score: 10 }, { actorId: GOBLIN, score: 1 }],
      turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 30 }
    }
  });
}

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-rules-ask-"));
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
  server.mapCatalog.register(imported.metadata.id, "Ask Arena", "battlemap");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
async function playerView(base: string, token: string): Promise<PlayerView> {
  const response = await fetch(base + GAME_PATHS.snapshot, { headers: bearer(token) });
  return (await response.json()).data.game as PlayerView;
}

/** Both PCs claimed, the fight already running (see `initialState`). */
async function fightWithExhaustedMovement() {
  const running = await boot();
  const heroSession = running.server.auth.issuePlayerSession();
  const otherSession = running.server.auth.issuePlayerSession();
  expect((await post(running.base, GAME_PATHS.claims, heroSession, { actorId: HERO })).status).toBe(200);
  expect((await post(running.base, GAME_PATHS.claims, otherSession, { actorId: OTHER })).status).toBe(200);
  return { ...running, heroSession, otherSession };
}

const STAND_UP = GAME_PATHS.actorConditions.replace("{actorId}", HERO);
/** Hero tries to stand up with no movement left - the blocked command, carrying the revision it was sent at. */
const standUpBody = (revision: number) => ({ commandId: randomUUID(), actorId: HERO, conditionId: "prone", active: false, expectedRevision: revision });

describe("ask the GM", () => {
  it("turns a blocked player move into a parked question instead of a silent dead end", async () => {
    const { base, server, heroSession } = await fightWithExhaustedMovement();
    const body = standUpBody(server.store.snapshot.revision);

    // The block itself: machine-readable, so the client can offer one button rather than parse prose.
    const blocked = await post(base, STAND_UP, heroSession, body);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.details.blocked.rule).toBe("movement.stand-up-cost");

    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: body });
    expect(asked.status).toBe(200);
    const askBody = await asked.json();
    expect(askBody.data.ran).toBe(false);
    expect(askBody.data.askId).toBeTruthy();

    const asks = server.store.snapshot.combat.pendingRuleAsks;
    expect(asks.length).toBe(1);
    expect(asks[0].actorId).toBe(HERO);
    expect(asks[0].rule).toBe("movement.stand-up-cost");
    expect(asks[0].family).toBe("movement");
    // The parked command is the whole original request - the GM never reconstructs it by hand.
    expect(asks[0].command.type).toBe("actor.set-condition");
    expect((asks[0].command.payload as { conditionId: string }).conditionId).toBe("prone");
  });

  it("shows a player only their OWN ask, and never the parked payload", async () => {
    const { base, server, heroSession, otherSession, gmToken } = await fightWithExhaustedMovement();
    await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: standUpBody(server.store.snapshot.revision) });

    const mine = await playerView(base, heroSession);
    const theirs = await playerView(base, otherSession);
    expect(mine.combat.pendingRuleAsks.length).toBe(1);
    expect(mine.combat.pendingRuleAsks[0].actorId).toBe(HERO);
    expect(mine.combat.pendingRuleAsks[0].rule).toBe("movement.stand-up-cost");
    // Viewer safety: the parked payload can name target ids a player is not allowed to know.
    expect("command" in mine.combat.pendingRuleAsks[0]).toBe(false);
    expect(JSON.stringify(mine.combat.pendingRuleAsks)).not.toContain("conditionId");
    // Another player's table shows nothing at all - not the question, not that one was asked.
    expect(theirs.combat.pendingRuleAsks).toEqual([]);
    // The GM's own view carries the whole thing, payload included - that is what Allow replays.
    const gmView = await fetch(base + GAME_PATHS.snapshot, { headers: bearer(gmToken) });
    expect(JSON.stringify((await gmView.json()).data.game)).toContain("pendingRuleAsks");
  });

  it("re-runs the parked command on Allow - with the stale expectedRevision stripped, or every Allow would 409", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    // Ask at revision N...
    const staleRevision = server.store.snapshot.revision;
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: standUpBody(staleRevision) });
    const askId = (await asked.json()).data.askId as string;

    // ...and let the table move on, so the parked expectedRevision is definitively stale. Replaying it
    // verbatim is the bug this strip exists to prevent.
    await post(base, GAME_PATHS.rolls, gmToken, { commandId: randomUUID(), formula: "1d20", purpose: "manual", visibility: "public" });
    expect(server.store.snapshot.revision).toBeGreaterThan(staleRevision);

    const allowed = await post(base, GAME_PATHS.rulesAnswer, gmToken, { commandId: randomUUID(), askId, allow: true, reason: "You were running downhill." });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.allowed).toBe(true);

    // Hero actually stood up, the question is gone, and the family is remembered for this turn - so
    // D9 holds: the same KIND of block stops re-prompting until the turn ends.
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions).toEqual([]);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
    expect(server.store.snapshot.combat.turn.rulesOverriddenFamilies).toContain("movement");
  });

  it("declines without running anything, and tells the player", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    const before = server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions.length;
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: standUpBody(server.store.snapshot.revision) });
    const askId = (await asked.json()).data.askId as string;

    const denied = await post(base, GAME_PATHS.rulesAnswer, gmToken, { commandId: randomUUID(), askId, allow: false });
    expect(denied.status).toBe(200);
    expect((await denied.json()).data.allowed).toBe(false);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions.length).toBe(before);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);

    const feed = await fetch(base + GAME_PATHS.log, { headers: bearer(heroSession) });
    const entries = (await feed.json()).data.entries as ReadonlyArray<{ text: string }>;
    expect(entries.some((entry) => entry.text.includes("The GM declined Hero's blocked action."))).toBe(true);
  });

  it("just runs the command when the block has already cleared - no question is parked", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    const body = standUpBody(server.store.snapshot.revision);
    // The GM relaxes movement policing before the player taps Ask.
    expect((await post(base, GAME_PATHS.rulesMode, gmToken, { commandId: randomUUID(), mode: "strict", exceptions: { movement: "freeform" } })).status).toBe(200);

    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: body });
    expect(asked.status).toBe(200);
    expect((await asked.json()).data.ran).toBe(true);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions).toEqual([]);
  });

  it("refuses an ask about someone else's character, and a tampered payload", async () => {
    const { base, server, heroSession, otherSession } = await fightWithExhaustedMovement();
    const body = standUpBody(server.store.snapshot.revision);

    // Second Hero's player wrapping Hero's blocked move in an ask gets the SAME refusal the raw
    // command gives them - the ask is not a back door around role boundaries.
    const impostor = await post(base, GAME_PATHS.rulesAsk, otherSession, { commandId: randomUUID(), type: "actor.set-condition", payload: body });
    expect(impostor.status).toBe(409);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);

    // A payload that is not a valid token.move at all is that command's own validation failure.
    const tampered = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: { commandId: randomUUID(), actorId: HERO, conditionId: 42, active: false } });
    expect(tampered.status).toBe(400);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
  });

  it("keeps one question per character and clears the queue when the fight ends", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: standUpBody(server.store.snapshot.revision) });
    await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: { ...standUpBody(server.store.snapshot.revision), conditionId: "prone" } });
    // A player tapping twice asked ONE question; two rows would make the GM answer it twice.
    expect(server.store.snapshot.combat.pendingRuleAsks.length).toBe(1);
    expect((server.store.snapshot.combat.pendingRuleAsks[0].command.payload as { conditionId: string }).conditionId).toBe("prone");

    expect((await post(base, GAME_PATHS.encounterEnd, gmToken, { commandId: randomUUID() })).status).toBe(200);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
  });

  it("tells the answering GM plainly when the question has expired", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: standUpBody(server.store.snapshot.revision) });
    const askId = (await asked.json()).data.askId as string;
    await post(base, GAME_PATHS.encounterEnd, gmToken, { commandId: randomUUID() });

    const answered = await post(base, GAME_PATHS.rulesAnswer, gmToken, { commandId: randomUUID(), askId, allow: true });
    expect(answered.status).toBe(409);
    expect((await answered.json()).error.message).toContain("no longer waiting");
  });

  it("refuses a player answering their own question", async () => {
    const { base, server, heroSession } = await fightWithExhaustedMovement();
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, { commandId: randomUUID(), type: "actor.set-condition", payload: standUpBody(server.store.snapshot.revision) });
    const askId = (await asked.json()).data.askId as string;
    const answered = await post(base, GAME_PATHS.rulesAnswer, heroSession, { commandId: randomUUID(), askId, allow: true });
    expect(answered.status).toBe(403);
    expect(server.store.snapshot.combat.pendingRuleAsks.length).toBe(1);
  });

  it("parks and resumes an unanswered question with its scene", () => {
    // At the seam, not over HTTP: the invariant is that `pendingRuleAsks` is in BOTH the snapshot list
    // and the empty-scene literal. Miss either and a parked scene resumes with a question that was
    // answered in another fight - or loses one the GM never saw.
    const ask = {
      id: "90000000-0000-4000-8000-000000000001", actorId: HERO, rule: "movement.stand-up-cost", family: "movement" as const,
      message: "Standing up costs 15 ft of movement - Hero has 0 ft left.",
      command: { type: "actor.set-condition" as const, payload: { actorId: HERO, conditionId: "prone", active: false } },
      createdAt: new Date().toISOString()
    };
    const game = GameStateSchema.parse({ schemaVersion: 1,
      actors: [{ id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }],
      combat: {
        active: true, round: 1, turnActorId: HERO, mapAssetId: MAP,
        initiative: [{ actorId: HERO, score: 20 }],
        pendingRuleAsks: [ask],
        scenes: [{ id: CORRIDOR, name: "The corridor", mapAssetId: MAP, combat: {} }],
        activeSceneId: null
      }
    });

    // Switching away parks the live fight (question included) as an implicit scene...
    activateScene(game, CORRIDOR, IMPLICIT);
    expect(game.combat.pendingRuleAsks).toEqual([]);
    expect(game.combat.scenes.find((scene) => scene.id === IMPLICIT)?.combat.pendingRuleAsks.length).toBe(1);

    // ...and switching back resumes it exactly as the GM left it.
    activateScene(game, IMPLICIT, "90000000-0000-4000-8000-00000000000f");
    expect(game.combat.pendingRuleAsks.length).toBe(1);
    expect(game.combat.pendingRuleAsks[0].id).toBe(ask.id);
    // The scene the fight came FROM is emptied, which the active-scene invariant requires.
    expect(game.combat.scenes.find((scene) => scene.id === CORRIDOR)?.combat.pendingRuleAsks).toEqual([]);
  });
});

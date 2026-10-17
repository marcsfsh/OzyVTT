import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type PlayerView } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { activateScene } from "../src/scenes.js";
import { png } from "./image-fixtures.js";

// A blocked player can turn the block into a question to the GM; the question belongs to one player,
// and Allow re-runs the parked command. The parked payload's `expectedRevision` is from ask time, so
// `rerunPayload` must strip it or every Allow would 409.

const HERO = "10000000-0000-4000-8000-0000000000a1";
const OTHER = "10000000-0000-4000-8000-0000000000a2";
const GOBLIN = "10000000-0000-4000-8000-0000000000a3";
const MAP = "20000000-0000-5000-8000-0000000000a1";
const CORRIDOR = "40000000-0000-4000-8000-0000000000a1";
const IMPLICIT = "40000000-0000-4000-8000-0000000000a2";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

// A live fight mid-turn: Hero is up, prone, with a 30 ft Speed already spent. Standing costs half
// Speed, so `actor.set-condition` blocks with `movement.stand-up-cost`.
function initialState() {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        speedFeet: 30,
        conditions: [{ id: "prone" }]
      },
      {
        id: OTHER,
        name: "Second Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        speedFeet: 30,
        conditions: [{ id: "prone" }]
      },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ],
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      rulesMode: "strict",
      initiative: [
        { actorId: HERO, score: 20 },
        { actorId: OTHER, score: 10 },
        { actorId: GOBLIN, score: 1 }
      ],
      turn: {
        actionUsed: false,
        bonusActionUsed: false,
        actionInstance: null,
        bonusActionInstance: null,
        turnUses: {},
        movementUsedFeet: 30
      }
    }
  });
}

async function boot(state = initialState()) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-rules-ask-"));
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
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  const imported = await server.mapAssets.import(png(900, 600), "arena.png");
  server.mapCatalog.register(imported.metadata.id, "Ask Arena", "battlemap");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
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
const standUpBody = (revision: number) => ({
  commandId: randomUUID(),
  actorId: HERO,
  conditionId: "prone",
  active: false,
  expectedRevision: revision
});

describe("ask the GM", () => {
  it("turns a blocked player move into a parked question instead of a silent dead end", async () => {
    const { base, server, heroSession } = await fightWithExhaustedMovement();
    const body = standUpBody(server.store.snapshot.revision);

    // The block itself: machine-readable, so the client can offer one button rather than parse prose.
    const blocked = await post(base, STAND_UP, heroSession, body);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.details.blocked.rule).toBe("movement.stand-up-cost");

    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: body
    });
    expect(asked.status).toBe(200);
    const askBody = await asked.json();
    expect(askBody.data.ran).toBe(false);
    expect(askBody.data.askId).toBeTruthy();

    const asks = server.store.snapshot.combat.pendingRuleAsks;
    expect(asks.length).toBe(1);
    expect(asks[0].actorId).toBe(HERO);
    expect(asks[0].rule).toBe("movement.stand-up-cost");
    expect(asks[0].family).toBe("movement");
    // The parked command is the whole original request.
    expect(asks[0].command.type).toBe("actor.set-condition");
    expect((asks[0].command.payload as { conditionId: string }).conditionId).toBe("prone");
  });

  it("shows a player only their OWN ask, and never the parked payload", async () => {
    const { base, server, heroSession, otherSession, gmToken } = await fightWithExhaustedMovement();
    await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: standUpBody(server.store.snapshot.revision)
    });

    const mine = await playerView(base, heroSession);
    const theirs = await playerView(base, otherSession);
    expect(mine.combat.pendingRuleAsks.length).toBe(1);
    expect(mine.combat.pendingRuleAsks[0].actorId).toBe(HERO);
    expect(mine.combat.pendingRuleAsks[0].rule).toBe("movement.stand-up-cost");
    // Viewer safety: the parked payload can name target ids a player is not allowed to know.
    expect("command" in mine.combat.pendingRuleAsks[0]).toBe(false);
    expect(JSON.stringify(mine.combat.pendingRuleAsks)).not.toContain("conditionId");
    // Another player's table shows nothing: not the question, not that one was asked.
    expect(theirs.combat.pendingRuleAsks).toEqual([]);
    // The GM's view carries the whole thing, payload included; that is what Allow replays.
    const gmView = await fetch(base + GAME_PATHS.snapshot, { headers: bearer(gmToken) });
    expect(JSON.stringify((await gmView.json()).data.game)).toContain("pendingRuleAsks");
  });

  it("re-runs the parked command on Allow - with the stale expectedRevision stripped, or every Allow would 409", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    // Ask at revision N...
    const staleRevision = server.store.snapshot.revision;
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: standUpBody(staleRevision)
    });
    const askId = (await asked.json()).data.askId as string;

    // ...and let the table move on, so the parked expectedRevision is stale.
    await post(base, GAME_PATHS.rolls, gmToken, {
      commandId: randomUUID(),
      formula: "1d20",
      purpose: "manual",
      visibility: "public"
    });
    expect(server.store.snapshot.revision).toBeGreaterThan(staleRevision);

    const allowed = await post(base, GAME_PATHS.rulesAnswer, gmToken, {
      commandId: randomUUID(),
      askId,
      allow: true,
      reason: "You were running downhill."
    });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.allowed).toBe(true);

    // Hero stood up, the question is gone, and the family is remembered for the turn, so the same kind
    // of block stops re-prompting until the turn ends.
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions).toEqual([]);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
    expect(server.store.snapshot.combat.turn.rulesOverriddenFamilies).toContain("movement");
  });

  it("declines without running anything, and tells the player", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    const before = server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions.length;
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: standUpBody(server.store.snapshot.revision)
    });
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
    expect(
      (
        await post(base, GAME_PATHS.rulesMode, gmToken, {
          commandId: randomUUID(),
          mode: "strict",
          exceptions: { movement: "freeform" }
        })
      ).status
    ).toBe(200);

    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: body
    });
    expect(asked.status).toBe(200);
    expect((await asked.json()).data.ran).toBe(true);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)?.conditions).toEqual([]);
  });

  it("refuses an ask about someone else's character, and a tampered payload", async () => {
    const { base, server, heroSession, otherSession } = await fightWithExhaustedMovement();
    const body = standUpBody(server.store.snapshot.revision);

    // Another player wrapping Hero's blocked move in an ask gets the same refusal the raw command gives:
    // the ask is not a way around role boundaries.
    const impostor = await post(base, GAME_PATHS.rulesAsk, otherSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: body
    });
    expect(impostor.status).toBe(403);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);

    // A payload that is not a valid token.move at all is that command's own validation failure.
    const tampered = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: { commandId: randomUUID(), actorId: HERO, conditionId: 42, active: false }
    });
    expect(tampered.status).toBe(400);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
  });

  it("keeps one question per character and clears the queue when the fight ends", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: standUpBody(server.store.snapshot.revision)
    });
    await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: { ...standUpBody(server.store.snapshot.revision), conditionId: "prone" }
    });
    // A double tap is one question; two rows would make the GM answer it twice.
    expect(server.store.snapshot.combat.pendingRuleAsks.length).toBe(1);
    expect(
      (server.store.snapshot.combat.pendingRuleAsks[0].command.payload as { conditionId: string }).conditionId
    ).toBe("prone");

    expect((await post(base, GAME_PATHS.encounterEnd, gmToken, { commandId: randomUUID() })).status).toBe(200);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
  });

  it("tells the answering GM plainly when the question has expired", async () => {
    const { base, server, heroSession, gmToken } = await fightWithExhaustedMovement();
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: standUpBody(server.store.snapshot.revision)
    });
    const askId = (await asked.json()).data.askId as string;
    await post(base, GAME_PATHS.encounterEnd, gmToken, { commandId: randomUUID() });

    const answered = await post(base, GAME_PATHS.rulesAnswer, gmToken, { commandId: randomUUID(), askId, allow: true });
    expect(answered.status).toBe(409);
    expect((await answered.json()).error.message).toContain("no longer waiting");
  });

  it("refuses a player answering their own question", async () => {
    const { base, server, heroSession } = await fightWithExhaustedMovement();
    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "actor.set-condition",
      payload: standUpBody(server.store.snapshot.revision)
    });
    const askId = (await asked.json()).data.askId as string;
    const answered = await post(base, GAME_PATHS.rulesAnswer, heroSession, {
      commandId: randomUUID(),
      askId,
      allow: true
    });
    expect(answered.status).toBe(403);
    expect(server.store.snapshot.combat.pendingRuleAsks.length).toBe(1);
  });

  it("parks and resumes an unanswered question with its scene", () => {
    // `pendingRuleAsks` must be in both the snapshot list and the empty-scene literal, or a parked scene
    // resumes with an answered question or loses an unanswered one.
    const ask = {
      id: "90000000-0000-4000-8000-000000000001",
      actorId: HERO,
      rule: "movement.stand-up-cost",
      family: "movement" as const,
      message: "Standing up costs 15 ft of movement - Hero has 0 ft left.",
      command: {
        type: "actor.set-condition" as const,
        payload: { actorId: HERO, conditionId: "prone", active: false }
      },
      createdAt: new Date().toISOString()
    };
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
      ],
      combat: {
        active: true,
        round: 1,
        turnActorId: HERO,
        mapAssetId: MAP,
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
    // The scene the fight came from is emptied, as the active-scene invariant requires.
    expect(game.combat.scenes.find((scene) => scene.id === CORRIDOR)?.combat.pendingRuleAsks).toEqual([]);
  });
});

describe("an Allow covers the family it was asked about, and no other", () => {
  // Hero has spent this turn's action and the War Cry's one use: an economy block and a resources block.
  function spentWarCry() {
    const state = initialState();
    const warCry = {
      id: "war-cry",
      name: "War Cry",
      activation: "action",
      description: "A shout that rallies allies.",
      damage: [],
      uses: { limit: 1, per: "long-rest" }
    };
    return GameStateSchema.parse({
      ...state,
      definitions: [
        {
          id: "hero-sheet",
          definition: {
            ...(loadActorFixture("player-character") as Record<string, unknown>),
            actions: [warCry]
          }
        }
      ],
      actors: state.actors.map((actor) =>
        actor.id === HERO ? { ...actor, definitionId: "hero-sheet", actionUses: { "war-cry": 1 } } : actor
      ),
      combat: { ...state.combat, turn: { ...state.combat.turn, actionUsed: true } }
    });
  }

  it("re-asks about a second family's block rather than waving it through on the first Allow", async () => {
    const running = await boot(spentWarCry());
    const { base, server, gmToken } = running;
    const heroSession = server.auth.issuePlayerSession();
    expect((await post(base, GAME_PATHS.claims, heroSession, { actorId: HERO })).status).toBe(200);

    const asked = await post(base, GAME_PATHS.rulesAsk, heroSession, {
      commandId: randomUUID(),
      type: "action.resolve",
      payload: { commandId: randomUUID(), actorId: HERO, actionId: "war-cry" }
    });
    const firstAsk = server.store.snapshot.combat.pendingRuleAsks[0];
    expect((await asked.json()).data.askId).toBe(firstAsk.id);

    // The GM allows the family they were shown. The action is still blocked by the other one, so it does not
    // run: the ask comes back, now about that block, under a fresh id.
    const allowedOnce = await post(base, GAME_PATHS.rulesAnswer, gmToken, {
      commandId: randomUUID(),
      askId: firstAsk.id,
      allow: true
    });
    expect(allowedOnce.status).toBe(200);
    expect((await allowedOnce.json()).data.blocked).toBeTruthy();
    const secondAsk = server.store.snapshot.combat.pendingRuleAsks[0];
    expect(secondAsk.id).not.toBe(firstAsk.id);
    expect(secondAsk.family).not.toBe(firstAsk.family);
    expect([firstAsk.family, secondAsk.family].sort()).toEqual(["economy", "resources"]);
    expect(server.store.snapshot.actors.find((actor) => actor.id === HERO)?.actionUses["war-cry"]).toBe(1);

    // Answering the old question again finds nothing; the second Allow runs the action.
    const stale = await post(base, GAME_PATHS.rulesAnswer, gmToken, {
      commandId: randomUUID(),
      askId: firstAsk.id,
      allow: true
    });
    expect(stale.status).toBe(409);
    const allowedTwice = await post(base, GAME_PATHS.rulesAnswer, gmToken, {
      commandId: randomUUID(),
      askId: secondAsk.id,
      allow: true
    });
    expect(allowedTwice.status).toBe(200);
    expect((await allowedTwice.json()).data.outcome).toBeTruthy();
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
    expect([...(server.store.snapshot.combat.turn.rulesOverriddenFamilies ?? [])].sort()).toEqual([
      "economy",
      "resources"
    ]);
  });
});

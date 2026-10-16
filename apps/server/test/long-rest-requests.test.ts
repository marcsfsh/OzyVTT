import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { gameClockLabel, GameStateSchema, longRestWait, type GameState, type PlayerView } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GameAccessDeniedError } from "../src/authorization.js";
import { startEncounter } from "../src/encounter.js";
import {
  answerLongRest,
  applyRest,
  askForLongRest,
  finishPartyShortRest,
  markShortRestDone,
  passTime,
  startPartyRest
} from "../src/rests.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Resting: a Short Rest is 1 hour, a Long Rest at least 8, "after you finish a Long Rest, you must wait at
// least 16 hours before starting another one", and either needs at least 1 Hit Point.

const fixture = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
// A Short Rest pool to watch come back.
const torva = ActorDefinitionSchema.parse({
  ...fixture,
  actions: [
    ...fixture.actions,
    {
      id: "action-surge",
      name: "Action Surge",
      activation: "other",
      description: "Take one additional action.",
      damage: [],
      uses: { limit: 1, per: "short-rest" }
    }
  ]
});
const TORVA = "10000000-0000-4000-8000-000000000001";
const BRYN = "10000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-00000000000b";
const OTHER = "30000000-0000-4000-8000-00000000000c";
const GM = { role: "gm" } as const;
const PLAYER = { role: "player", sessionId: OWNER } as const;

function game(torvaFields: Record<string, unknown> = {}, brynFields: Record<string, unknown> = {}): GameState {
  const hero = (id: string, name: string, owner: string | null, fields: Record<string, unknown>) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 75 },
    definitionId: "import-torva",
    ownerSessionId: owner,
    hitDice: { die: "d12", maximum: 7, remaining: 3 },
    actionUses: { rage: 2, "action-surge": 1 },
    ...fields
  });
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [hero(TORVA, "Torva", OWNER, torvaFields), hero(BRYN, "Bryn", OTHER, brynFields)],
    definitions: [{ id: "import-torva", definition: torva }]
  });
}
const resolve = (state: GameState) => (definitionId: string) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition;
const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;

describe("the 16-hour rule between Long Rests", () => {
  it("records the hour a Long Rest ends and refuses another until 16 hours have passed, saying how long", () => {
    const state = game();
    passTime(state, 30);
    applyRest(state, TORVA, "long", resolve(state));
    expect(actor(state, TORVA).lastLongRestAt).toBe(30);
    expect(() => applyRest(state, TORVA, "long", resolve(state))).toThrow(
      "Torva just finished a Long Rest - another can start in 16 hours."
    );
    passTime(state, 10);
    expect(() => applyRest(state, TORVA, "long", resolve(state))).toThrow(
      "Torva finished a Long Rest 10 hours ago - another can start in 6 hours."
    );
    passTime(state, 6);
    applyRest(state, TORVA, "long", resolve(state));
    expect(actor(state, TORVA).lastLongRestAt).toBe(46);
  });

  it("leaves Short Rests alone, and a creature that never rested may start at once", () => {
    const state = game();
    applyRest(state, TORVA, "long", resolve(state));
    applyRest(state, TORVA, "short", resolve(state));
    expect(longRestWait(null, 0)).toBe(0);
    expect(longRestWait(10, 20)).toBe(6);
    expect(gameClockLabel(0)).toBe("Day 1, 00:00");
    expect(gameClockLabel(38)).toBe("Day 2, 14:00");
  });
});

describe("a player asks for a Long Rest and the GM answers", () => {
  it("queues the ask once, explains a refusal at once, and lets the player take it back", () => {
    const state = game();
    askForLongRest(state, TORVA, false, PLAYER);
    askForLongRest(state, TORVA, false, PLAYER);
    expect(state.rest.requests).toEqual([TORVA]);
    askForLongRest(state, TORVA, true, PLAYER);
    expect(state.rest.requests).toEqual([]);
    expect(() => askForLongRest(state, BRYN, false, PLAYER)).toThrow(GameAccessDeniedError);
    const down = game({ hp: { current: 0, maximum: 75 } });
    expect(() => askForLongRest(down, TORVA, false, PLAYER)).toThrow(/0 Hit Points - a Long Rest needs at least 1/);
    const rested = game({ lastLongRestAt: 0 });
    passTime(rested, 4);
    expect(() => askForLongRest(rested, TORVA, false, PLAYER)).toThrow(
      "Torva finished a Long Rest 4 hours ago - another can start in 12 hours."
    );
  });

  it("approving gives the Long Rest now; turning it down gives nothing", () => {
    const state = game();
    askForLongRest(state, TORVA, false, PLAYER);
    askForLongRest(state, BRYN, false, { role: "player", sessionId: OTHER });
    answerLongRest(state, TORVA, true, GM, resolve(state));
    expect(actor(state, TORVA)).toMatchObject({ hp: { current: 75 }, actionUses: {}, lastLongRestAt: 0 });
    answerLongRest(state, BRYN, false, GM, resolve(state));
    expect(actor(state, BRYN).hp.current).toBe(30);
    expect(state.rest.requests).toEqual([]);
    expect(() => answerLongRest(state, BRYN, true, GM, resolve(state))).toThrow("Bryn isn't waiting for a Long Rest.");
    expect(() => answerLongRest(state, TORVA, true, PLAYER, resolve(state))).toThrow(GameAccessDeniedError);
  });
});

describe("the GM rests the party", () => {
  it("a Long Rest rests everyone now and moves the clock 8 hours", () => {
    const state = game();
    passTime(state, 20);
    startPartyRest(state, [TORVA, BRYN], "long", resolve(state));
    expect(state.rest.clockHours).toBe(28);
    for (const id of [TORVA, BRYN]) expect(actor(state, id)).toMatchObject({ hp: { current: 75 }, lastLongRestAt: 28 });
  });

  it("rests nobody when someone can't, and says who and why", () => {
    const state = game({}, { hp: { current: 0, maximum: 75 } });
    expect(() => startPartyRest(state, [TORVA, BRYN], "long", resolve(state))).toThrow(
      "Bryn has 0 Hit Points - a Long Rest needs at least 1. Heal them first."
    );
    expect(actor(state, TORVA).hp.current).toBe(30);
    expect(state.rest.clockHours).toBe(0);
    const early = game({ lastLongRestAt: 0 });
    passTime(early, 9);
    expect(() => startPartyRest(early, [TORVA, BRYN], "long", resolve(early))).toThrow(
      "Torva finished a Long Rest 9 hours ago - another can start in 7 hours."
    );
  });

  it("a Short Rest stays open while players spend Hit Dice, then gives its benefits and an hour", () => {
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "short", resolve(state));
    expect(state.rest.shortRest).toEqual({ actorIds: [TORVA, BRYN], done: [] });
    expect(actor(state, TORVA).actionUses).toEqual({ rage: 2, "action-surge": 1 });
    expect(() => startPartyRest(state, [TORVA], "short", resolve(state))).toThrow(/already under way/);
    markShortRestDone(state, TORVA, true, PLAYER);
    expect(() => markShortRestDone(state, BRYN, true, PLAYER)).toThrow(GameAccessDeniedError);
    expect(state.rest.shortRest?.done).toEqual([TORVA]);
    // Bryn drops before the hour is up.
    actor(state, BRYN).hp.current = 0;
    const { events, rested } = finishPartyShortRest(state, true, resolve(state));
    expect(rested).toEqual(["Torva"]);
    expect(events.map((event) => event.text)).toEqual(["Bryn has 0 Hit Points, so the Short Rest gives them nothing."]);
    expect(actor(state, TORVA).actionUses).toEqual({ rage: 2 });
    expect(actor(state, BRYN).actionUses).toEqual({ rage: 2, "action-surge": 1 });
    expect(state.rest).toMatchObject({ clockHours: 1, shortRest: null });
  });

  it("rolling Initiative takes a combatant out of the Short Rest, and closes it when nobody is left", () => {
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "short", resolve(state));
    markShortRestDone(state, BRYN, true, GM);
    const geometry = { width: 900, height: 600, calibration: null } as const;
    startEncounter(state, { mapAssetId: randomUUID(), entries: [{ actorId: BRYN, score: 12 }] }, () => 10, geometry);
    expect(state.rest.shortRest).toEqual({ actorIds: [TORVA], done: [] });
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    startEncounter(state, { mapAssetId: randomUUID(), entries: [{ actorId: TORVA, score: 12 }] }, () => 10, geometry);
    expect(state.rest.shortRest).toBeNull();
  });

  it("calling the Short Rest off gives nothing and passes no time", () => {
    const state = game();
    startPartyRest(state, [TORVA], "short", resolve(state));
    finishPartyShortRest(state, false, resolve(state));
    expect(actor(state, TORVA).actionUses).toEqual({ rage: 2, "action-surge": 1 });
    expect(state.rest).toMatchObject({ clockHours: 0, shortRest: null });
    expect(() => finishPartyShortRest(state, true, resolve(state))).toThrow("No Short Rest is under way.");
  });
});

describe("over the API", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("a player asks instead of resting, sees only their own share, and the GM approves", async () => {
    const { base, server, gmToken, post, close } = await bootServer(
      game({ ownerSessionId: null }, { ownerSessionId: null })
    );
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    const other = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: TORVA })).status).toBe(200);
    expect((await post(GAME_PATHS.claims, other, { commandId: randomUUID(), actorId: BRYN })).status).toBe(200);
    const rest = GAME_PATHS.actorRest.replace("{actorId}", TORVA);
    const long = await post(rest, player, { commandId: randomUUID(), kind: "long" });
    expect(long.status).toBe(403);
    expect((await long.json()).error.message).toBe("Ask the GM for a Long Rest - they approve it.");
    expect((await post(rest, player, { commandId: randomUUID(), kind: "short" })).status).toBe(200);

    const ask = (token: string, actorId: string) =>
      post(GAME_PATHS.restAsk.replace("{actorId}", actorId), token, { commandId: randomUUID() });
    expect((await ask(player, TORVA)).status).toBe(200);
    expect((await ask(other, BRYN)).status).toBe(200);
    expect((await ask(player, BRYN)).status).toBe(403);
    expect(server.store.snapshot.rest.requests).toEqual([TORVA, BRYN]);
    const shortRest = await post(GAME_PATHS.restParty, gmToken, {
      commandId: randomUUID(),
      kind: "short",
      actorIds: [TORVA, BRYN]
    });
    expect(shortRest.status).toBe(200);

    const snapshot = await fetch(base + GAME_PATHS.snapshot, { headers: { authorization: `Bearer ${player}` } });
    const view = (await snapshot.json()).data.game as PlayerView;
    expect(view.rest).toEqual({ requests: [TORVA], shortRest: { actorIds: [TORVA], done: [] } });
    expect(JSON.stringify(view)).not.toContain("clockHours");
    expect(view.actors.every((entry) => !("lastLongRestAt" in entry))).toBe(true);

    for (const [path, body] of [
      [GAME_PATHS.restAnswer.replace("{actorId}", TORVA), { approve: true }],
      [GAME_PATHS.restParty, { kind: "long", actorIds: [TORVA] }],
      [GAME_PATHS.restFinish, { apply: true }],
      [GAME_PATHS.timePass, { hours: 8 }]
    ] as const)
      expect((await post(path, player, { commandId: randomUUID(), ...body })).status, path).toBe(403);
    expect((await post(GAME_PATHS.restFinish, gmToken, { commandId: randomUUID(), apply: false })).status).toBe(200);

    const approve = await post(GAME_PATHS.restAnswer.replace("{actorId}", TORVA), gmToken, {
      commandId: randomUUID(),
      approve: true
    });
    expect(approve.status).toBe(200);
    expect(server.store.snapshot.actors[0]).toMatchObject({ hp: { current: 75 }, lastLongRestAt: 0 });
    const again = await ask(player, TORVA);
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toBe("Torva just finished a Long Rest - another can start in 16 hours.");
    expect((await post(GAME_PATHS.timePass, gmToken, { commandId: randomUUID(), hours: 16 })).status).toBe(200);
    expect((await ask(player, TORVA)).status).toBe(200);
  });
});

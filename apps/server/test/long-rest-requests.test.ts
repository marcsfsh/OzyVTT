import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { gameClockLabel, GameStateSchema, longRestWait, type GameState, type PlayerView } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GameAccessDeniedError } from "../src/authorization.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { interruptByGm, resumeLongRest } from "../src/long-rest.js";
import { restApplier } from "../src/rest-interruptions.js";
import {
  answerLongRest,
  applyRest,
  askForLongRest,
  finishPartyLongRest,
  finishPartyShortRest,
  markShortRestDone,
  passTime,
  spendHitDice,
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
      "Torva finished a Long Rest moments ago. Another can start in 16 hours."
    );
    passTime(state, 10);
    expect(() => applyRest(state, TORVA, "long", resolve(state))).toThrow(
      "Torva finished a Long Rest 10 hours ago. Another can start in 6 hours."
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
    expect(() => askForLongRest(down, TORVA, false, PLAYER)).toThrow(/0 Hit Points. A Long Rest needs at least 1/);
    const rested = game({ lastLongRestAt: 0 });
    passTime(rested, 4);
    expect(() => askForLongRest(rested, TORVA, false, PLAYER)).toThrow(
      "Torva finished a Long Rest 4 hours ago. Another can start in 12 hours."
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
  it("a Long Rest stays under way until the GM finishes it, which rests everyone and moves the clock 8 hours", () => {
    const state = game();
    passTime(state, 20);
    startPartyRest(state, [TORVA, BRYN], "long");
    expect(state.rest).toMatchObject({ clockHours: 20, longRest: { startedAt: 1200 } });
    expect(actor(state, TORVA).hp.current).toBe(30);
    expect(() => startPartyRest(state, [TORVA], "long")).toThrow("A Long Rest is already under way. Finish it first.");
    const { rested, hours } = finishPartyLongRest(state, true, resolve(state));
    expect({ rested, hours }).toEqual({ rested: ["Torva", "Bryn"], hours: 8 });
    expect(state.rest).toMatchObject({ clockHours: 28, longRest: null });
    for (const id of [TORVA, BRYN]) expect(actor(state, id)).toMatchObject({ hp: { current: 75 }, lastLongRestAt: 28 });
  });

  it("rests nobody when someone can't, and says who and why", () => {
    const state = game({}, { hp: { current: 0, maximum: 75 } });
    expect(() => startPartyRest(state, [TORVA, BRYN], "long")).toThrow(
      "Bryn has 0 Hit Points. A Long Rest needs at least 1. Heal Bryn first."
    );
    expect(actor(state, TORVA).hp.current).toBe(30);
    expect(state.rest.clockHours).toBe(0);
    const early = game({ lastLongRestAt: 0 });
    passTime(early, 9);
    expect(() => startPartyRest(early, [TORVA, BRYN], "long")).toThrow(
      "Torva finished a Long Rest 9 hours ago. Another can start in 7 hours."
    );
  });

  it("a Short Rest stays open while players spend Hit Dice, then gives its benefits and an hour", () => {
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "short");
    expect(state.rest.shortRest).toEqual({ actorIds: [TORVA, BRYN], done: [] });
    expect(actor(state, TORVA).actionUses).toEqual({ rage: 2, "action-surge": 1 });
    expect(() => startPartyRest(state, [TORVA], "short")).toThrow(/already under way/);
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
    startPartyRest(state, [TORVA, BRYN], "short");
    markShortRestDone(state, BRYN, true, GM);
    const geometry = { width: 900, height: 600, calibration: null } as const;
    startEncounter(state, { mapAssetId: randomUUID(), entries: [{ actorId: BRYN, score: 12 }] }, () => 10, geometry);
    expect(state.rest.shortRest).toEqual({ actorIds: [TORVA], done: [] });
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    startEncounter(state, { mapAssetId: randomUUID(), entries: [{ actorId: TORVA, score: 12 }] }, () => 10, geometry);
    expect(state.rest.shortRest).toBeNull();
  });

  it("taking damage ends a member's Short Rest, which then gives them nothing", () => {
    // SRD Short Rest: "A Short Rest is stopped by ... Taking any damage. An interrupted Short Rest confers no benefits."
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "short");
    const shrugged = applyDamageDetailed(state, BRYN, { amount: 0 }, GM);
    expect(shrugged.events).toEqual([]);
    const { events } = applyDamageDetailed(state, BRYN, { amount: 4 }, GM);
    expect(events.map((event) => event.text)).toContain(
      "Bryn took damage, which ends their Short Rest without its benefits."
    );
    expect(state.rest.shortRest).toEqual({ actorIds: [TORVA], done: [] });
    const { rested } = finishPartyShortRest(state, true, resolve(state));
    expect(rested).toEqual(["Torva"]);
    expect(actor(state, BRYN).actionUses).toEqual({ rage: 2, "action-surge": 1 });
  });

  it("gives a member who takes damage two hours in a Short Rest's benefits only, and the rest of the party finishes", () => {
    // SRD Long Rest: "A Long Rest is stopped by ... Taking any damage ... If you rested at least 1 hour before the
    // interruption, you gain the benefits of a Short Rest."
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "long");
    passTime(state, 2);
    const { events } = applyDamageDetailed(state, BRYN, { amount: 4 }, GM);
    expect(events.map((event) => event.text)).toContain(
      "Bryn took damage, which interrupts Bryn's Long Rest. After an hour of rest, Bryn gets a Short Rest's benefits."
    );
    expect(actor(state, BRYN).actionUses).toEqual({ rage: 2 });
    expect(state.rest.longRest?.members[1]).toMatchObject({ interrupted: true, shortRestEarned: true });
    const { rested } = finishPartyLongRest(state, true, resolve(state));
    expect(rested).toEqual(["Torva"]);
    expect(state.rest.clockHours).toBe(8);
    expect(actor(state, TORVA)).toMatchObject({ hp: { current: 75 }, actionUses: {}, lastLongRestAt: 8 });
    expect(actor(state, BRYN)).toMatchObject({ hp: { current: 26 }, actionUses: { rage: 2 }, lastLongRestAt: null });
  });

  it("gives a member interrupted within the first hour nothing", () => {
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "long");
    passTime(state, 0, 30);
    const { events } = applyDamageDetailed(state, BRYN, { amount: 4 }, GM);
    expect(events.map((event) => event.text)).toContain("Bryn took damage, which interrupts Bryn's Long Rest.");
    expect(actor(state, BRYN).actionUses).toEqual({ rage: 2, "action-surge": 1 });
    expect(state.rest.longRest?.members[1]).toMatchObject({ interrupted: true, shortRestEarned: false });
  });

  it("is interrupted by rolling Initiative, and resumed takes an hour more", () => {
    // "You can resume a Long Rest immediately after an interruption. If you do so, the rest requires 1 additional hour
    // per interruption to finish."
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "long");
    passTime(state, 3);
    const geometry = { width: 900, height: 600, calibration: null } as const;
    const started = startEncounter(
      state,
      { mapAssetId: randomUUID(), entries: [{ actorId: BRYN, score: 12 }] },
      () => 10,
      geometry,
      resolve(state)
    );
    expect(started.map((event) => event.text)).toContain(
      "Bryn rolled Initiative, which interrupts Bryn's Long Rest. After an hour of rest, Bryn gets a Short Rest's benefits."
    );
    expect(actor(state, BRYN).actionUses).toEqual({ rage: 2 });
    expect(() => resumeLongRest(state, BRYN, GM)).toThrow("End the encounter before Bryn rests again.");
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    expect(() => resumeLongRest(state, BRYN, PLAYER)).toThrow(GameAccessDeniedError);
    expect(resumeLongRest(state, BRYN, { role: "player", sessionId: OTHER })).toBe(
      "Bryn goes back to resting. The Long Rest now takes 9 hours."
    );
    const { rested } = finishPartyLongRest(state, true, resolve(state));
    expect(rested).toEqual(["Torva", "Bryn"]);
    expect(state.rest.clockHours).toBe(9);
    expect(actor(state, BRYN)).toMatchObject({ hp: { current: 75 }, actionUses: {}, lastLongRestAt: 9 });
  });

  it("lets a member with a Short Rest's benefits spend Hit Point Dice until it resumes", () => {
    const state = game();
    startPartyRest(state, [TORVA, BRYN], "long");
    passTime(state, 2);
    interruptByGm(state, BRYN, GM, restApplier({ resolveDefinition: resolve(state) }));
    const other = { role: "player", sessionId: OTHER } as const;
    spendHitDice(state, BRYN, [6], other, resolve(state));
    expect(actor(state, BRYN).hitDice?.remaining).toBe(2);
    resumeLongRest(state, BRYN, other);
    expect(() => spendHitDice(state, BRYN, [6], other, resolve(state))).toThrow(/spent during a Short Rest/);
    expect(() => interruptByGm(state, BRYN, PLAYER, restApplier())).toThrow(GameAccessDeniedError);
  });

  it("calling the Long Rest off passes no time and gives a Short Rest's benefits after an hour", () => {
    const state = game();
    startPartyRest(state, [TORVA], "long");
    passTime(state, 1);
    const { rested } = finishPartyLongRest(state, false, resolve(state));
    expect(rested).toEqual([]);
    expect(state.rest).toMatchObject({ clockHours: 1, longRest: null });
    expect(actor(state, TORVA)).toMatchObject({ hp: { current: 30 }, actionUses: { rage: 2 } });
    expect(() => finishPartyLongRest(state, true, resolve(state))).toThrow("No Long Rest is under way.");
  });

  it("calling the Short Rest off gives nothing and passes no time", () => {
    const state = game();
    startPartyRest(state, [TORVA], "short");
    finishPartyShortRest(state, false, resolve(state));
    expect(actor(state, TORVA).actionUses).toEqual({ rage: 2, "action-surge": 1 });
    expect(state.rest).toMatchObject({ clockHours: 0, shortRest: null });
    expect(() => finishPartyShortRest(state, true, resolve(state))).toThrow("No Short Rest is under way.");
  });
});

/** Torva with a prepared Cure Wounds and a level 1 slot, the cast that interrupts a rest. */
function castingGame(): GameState {
  const caster = {
    spellSlots: [{ level: 1, remaining: 2 }],
    preparedSpellIds: ["cure-wounds"]
  };
  const state = game(caster);
  state.definitions = [
    {
      id: "import-torva",
      definition: ActorDefinitionSchema.parse({
        ...torva,
        actions: [
          ...torva.actions,
          {
            id: "spell-cure-wounds",
            name: "Cure Wounds",
            activation: "action",
            description: "A creature you touch regains Hit Points.",
            damage: [],
            healing: { formula: "2d8 + 3" },
            spellId: "cure-wounds",
            spellSlot: { level: 1 }
          }
        ],
        spellcasting: {
          ability: "wis",
          slots: [{ level: 1, max: 2 }],
          spells: [
            {
              id: "cure-wounds",
              name: "Cure Wounds",
              level: 1,
              prepared: true,
              alwaysPrepared: false,
              actionId: "spell-cure-wounds"
            }
          ]
        }
      })
    }
  ];
  return state;
}

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
    expect((await long.json()).error.message).toBe("Ask the GM for a Long Rest. The GM approves it.");
    // A player's Short Rest is under way until the GM ends it.
    expect((await post(rest, player, { commandId: randomUUID(), kind: "short" })).status).toBe(200);
    expect(server.store.snapshot.rest.shortRest).toEqual({ actorIds: [TORVA], done: [] });
    expect((await post(GAME_PATHS.restFinish, gmToken, { commandId: randomUUID(), apply: false })).status).toBe(200);

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
    expect(view.rest).toEqual({ requests: [TORVA], shortRest: { actorIds: [TORVA], done: [] }, longRest: null });
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
    expect((await again.json()).error.message).toBe(
      "Torva finished a Long Rest moments ago. Another can start in 16 hours."
    );
    expect((await post(GAME_PATHS.timePass, gmToken, { commandId: randomUUID(), hours: 16 })).status).toBe(200);
    expect((await ask(player, TORVA)).status).toBe(200);
  });

  it("casting a spell other than a cantrip ends the caster's Short Rest", async () => {
    // SRD Short Rest: "A Short Rest is stopped by ... Casting a spell other than a cantrip".
    const state = castingGame();
    const { base, gmToken, post, server, close } = await bootServer(state);
    cleanups.push(close);
    const party = await post(GAME_PATHS.restParty, gmToken, {
      commandId: randomUUID(),
      kind: "short",
      actorIds: [TORVA, BRYN]
    });
    expect(party.status).toBe(200);
    const cast = await post(GAME_PATHS.actionUse, gmToken, {
      commandId: randomUUID(),
      actorId: TORVA,
      actionId: "spell-cure-wounds"
    });
    expect(cast.status).toBe(200);
    expect(server.store.snapshot.rest.shortRest).toEqual({ actorIds: [BRYN], done: [] });
    const log = await (await fetch(base + GAME_PATHS.log, { headers: { authorization: `Bearer ${gmToken}` } })).json();
    expect((log.data.entries as ReadonlyArray<{ text: string }>).map((entry) => entry.text)).toContain(
      "Torva cast Cure Wounds, which ends their Short Rest without its benefits."
    );
  });

  it("casting a spell other than a cantrip interrupts the caster's Long Rest", async () => {
    // SRD Long Rest: "A Long Rest is stopped by ... Casting a spell other than a cantrip".
    const { base, gmToken, post, server, close } = await bootServer(castingGame());
    cleanups.push(close);
    const party = await post(GAME_PATHS.restParty, gmToken, {
      commandId: randomUUID(),
      kind: "long",
      actorIds: [TORVA, BRYN]
    });
    expect(party.status).toBe(200);
    const cast = await post(GAME_PATHS.actionUse, gmToken, {
      commandId: randomUUID(),
      actorId: TORVA,
      actionId: "spell-cure-wounds"
    });
    expect(cast.status).toBe(200);
    expect(server.store.snapshot.rest.longRest?.members).toEqual([
      { actorId: TORVA, interruptions: 0, interrupted: true, shortRestEarned: false },
      { actorId: BRYN, interruptions: 0, interrupted: false, shortRestEarned: false }
    ]);
    const log = await (await fetch(base + GAME_PATHS.log, { headers: { authorization: `Bearer ${gmToken}` } })).json();
    expect((log.data.entries as ReadonlyArray<{ text: string }>).map((entry) => entry.text)).toContain(
      "Torva cast Cure Wounds, which interrupts Torva's Long Rest."
    );
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { addEffect, makeEffect } from "../src/effects.js";
import { removeCombatant } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { createServer } from "../src/server.js";

// SRD 5.2.1: the GM takes a combatant out of a running fight, and what it held lets go: a grapple ends, and a dead
// swallower's prey "is no longer Restrained by it and can escape from the corpse by using 20 feet of movement,
// exiting Prone".

const HERO = "10000000-0000-4000-8000-000000000001";
const WORM = "10000000-0000-4000-8000-000000000002";
const ALLY = "10000000-0000-4000-8000-000000000003";
const worm = loadMonsterDefinitions().find((monster) => monster.source.externalId === "purple-worm")!;
const definitions: Record<string, ActorDefinition> = { "purple-worm": worm };
const resolveDefinition = (definitionId: string) => definitions[definitionId];

function fight(turn: string = WORM): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Borin",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        speedFeet: 30
      },
      {
        id: WORM,
        name: "Purple Worm",
        kind: "monster",
        visibility: "public",
        hp: { current: 247, maximum: 247 },
        definitionId: "purple-worm",
        speedFeet: 50
      },
      {
        id: ALLY,
        name: "Mirena",
        kind: "player-character",
        visibility: "public",
        hp: { current: 25, maximum: 25 },
        speedFeet: 30
      }
    ],
    combat: {
      active: true,
      round: 2,
      turnActorId: turn,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: [
        { actorId: WORM, score: 20 },
        { actorId: HERO, score: 15 },
        { actorId: ALLY, score: 10 }
      ],
      tokens: [WORM, HERO, ALLY].map((actorId, index) => ({
        actorId,
        position: { x: 25 + 50 * index, y: 25 },
        sizePx: 40,
        sizeCells: 1
      }))
    }
  });
}

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const conditions = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);

/** The worm's swallow on Borin, as its failed Strength save leaves it. */
function swallow(state: GameState) {
  addEffect(
    state,
    HERO,
    makeEffect({
      id: "swallowed",
      name: "Blinded by Purple Worm (Swallow)",
      sourceActorId: WORM,
      sourceName: "Purple Worm",
      sourceActionId: "swallow",
      duration: { type: "manual" },
      linkedConditionIds: ["blinded", "restrained"]
    })
  );
}

describe("a swallower that dies lets its prey out", () => {
  it("frees the prey from the corpse with the stat block's 20 feet of movement, landing Prone", () => {
    const state = fight(HERO);
    swallow(state);
    expect(conditions(state, HERO)).toEqual(["blinded", "restrained"]);
    const { events } = applyDamageDetailed(state, WORM, { amount: 300 }, { role: "gm" }, { resolveDefinition });
    expect(conditions(state, HERO)).toEqual(["prone"]);
    // On Borin's own turn the climb comes out of this turn's movement.
    expect(state.combat.turn.movementUsedFeet).toBe(20);
    expect(events.map((event) => event.text)).toContain(
      "Borin climbs out of Purple Worm, using 20 feet of movement, and lands Prone."
    );
  });
});

describe("taking a combatant out of the fight", () => {
  it("drops its turn and token, ends what lasts until its next turn, and lets out what it swallowed", () => {
    const state = fight(ALLY);
    swallow(state);
    addEffect(
      state,
      ALLY,
      makeEffect({
        id: "distracted",
        name: "Distracted by Purple Worm",
        tags: ["distracted"],
        sourceActorId: WORM,
        duration: { type: "until-source-next-turn" }
      })
    );
    state.combat = { ...state.combat, reactionsUsed: [WORM], legendaryUsed: { [WORM]: 1 } };
    removeCombatant(state, WORM, resolveDefinition);
    expect(state.combat.initiative.map((entry) => entry.actorId)).toEqual([HERO, ALLY]);
    expect(state.combat.tokens.map((token) => token.actorId)).toEqual([HERO, ALLY]);
    expect(state.combat.reactionsUsed).toEqual([]);
    expect(state.combat.legendaryUsed).toEqual({});
    expect(actor(state, ALLY).effects).toEqual([]);
    // Off Borin's turn: his next turn carries the climb, as Speed lost until it ends.
    expect(conditions(state, HERO)).toEqual(["prone"]);
    expect(actor(state, HERO).effects).toMatchObject([
      { name: "Climbing out of Purple Worm", modifiers: [{ type: "speed", amount: -20 }] }
    ]);
  });

  it("ends a grapple it held, and refuses the last combatant or one whose turn it is", () => {
    const state = fight(HERO);
    addEffect(
      state,
      ALLY,
      makeEffect({
        id: "grappled",
        name: "Grappled by Purple Worm (Bite)",
        tags: ["grapple"],
        sourceActorId: WORM,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        linkedConditionIds: ["grappled"]
      })
    );
    removeCombatant(state, WORM, resolveDefinition);
    expect(conditions(state, ALLY)).toEqual([]);
    expect(() => removeCombatant(state, HERO, resolveDefinition)).toThrowError(
      "Advance past its turn before taking it out of the fight."
    );
    removeCombatant(state, ALLY, resolveDefinition);
    expect(() => removeCombatant(fightOf(state), HERO, resolveDefinition)).toThrowError(
      "It is the last one in the fight. End the fight to take it out."
    );
  });
});

/** The same fight with its turn handed past Borin, for the last-combatant refusal. */
const fightOf = (state: GameState): GameState => ({ ...state, combat: { ...state.combat, turnActorId: null } });

describe("over HTTP", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("lets the GM take the current combatant out, moving the turn on first, and nobody else", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-remove-combatant-"));
    const initial = fight(WORM);
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: { ...initial, definitions: [{ id: "purple-worm", definition: worm }] }
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
    const path = GAME_PATHS.encounterCombatantRemove.replace("{actorId}", WORM);
    const post = (token: string) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID() })
      });
    expect((await post(server.auth.issuePlayerSession())).status).toBe(403);
    expect((await post(gmToken)).status).toBe(200);
    const combat = server.store.snapshot.combat;
    expect(combat.turnActorId).toBe(HERO);
    expect(combat.initiative.map((entry) => entry.actorId)).toEqual([HERO, ALLY]);
    expect(combat.tokens.some((token) => token.actorId === WORM)).toBe(false);
  });
});

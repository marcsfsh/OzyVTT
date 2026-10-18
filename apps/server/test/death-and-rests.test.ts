import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { setCondition } from "../src/actor-conditions.js";
import { healActor, reviveActor, setCurrentHp } from "../src/hit-points.js";
import { applyRest, spendHitDice } from "../src/rests.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 "Dead": "A dead creature has no Hit Points and can't regain them unless it is first revived by magic".
// Short and Long Rest: "To start a [Short/Long] Rest, you must have at least 1 Hit Point."

const torva = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
const HERO = "10000000-0000-4000-8000-000000000001";
const GOBLIN = "10000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-00000000000b";

function game(hero: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Torva",
        kind: "player-character",
        visibility: "public",
        hp: { current: 0, maximum: 75 },
        definitionId: "import-torva",
        ownerSessionId: OWNER,
        hitDice: { die: "d12", maximum: 7, remaining: 7 },
        ...hero
      },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 0, maximum: 7 } }
    ],
    definitions: [{ id: "import-torva", definition: torva }]
  });
}
const resolve = (state: GameState) => (definitionId: string) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition;
const dead = { deathSaves: { successes: 0, failures: 3, stable: false }, conditions: [{ id: "unconscious" }] };
const dying = { deathSaves: { successes: 1, failures: 1, stable: false }, conditions: [{ id: "unconscious" }] };

describe("the dead regain no hit points", () => {
  it("healing a character with three failed death saves does nothing and says why", () => {
    const state = game(dead);
    const events = healActor(state, HERO, 10, { role: "gm" });
    expect(state.actors[0].hp.current).toBe(0);
    expect(state.actors[0].deathSaves).toEqual({ successes: 0, failures: 3, stable: false });
    expect(events.map((event) => event.text)).toEqual(["Torva is dead and can't regain hit points until revived."]);
  });

  it("Exhaustion 6 kills, and healing does not bring the character back", () => {
    const state = game({ hp: { current: 20, maximum: 75 } });
    setCondition(state, HERO, "exhaustion", true, 6, { role: "gm" });
    expect(state.actors[0].hp.current).toBe(0);
    healActor(state, HERO, 30, { role: "gm" });
    expect(state.actors[0].hp.current).toBe(0);
  });

  it("a monster at 0 hit points is dead, and a GM edit can't raise it: only a revival can", () => {
    const state = game();
    healActor(state, GOBLIN, 5, { role: "gm" });
    expect(state.actors[1].hp.current).toBe(0);
    expect(() => setCurrentHp(state, GOBLIN, 7, { role: "gm" })).toThrow(/dead\. Revive /);
    // A dying character is not dead: healing still wakes them.
    const dyingState = game(dying);
    healActor(dyingState, HERO, 3, { role: "gm" });
    expect(dyingState.actors[0]).toMatchObject({ hp: { current: 3 }, deathSaves: null });
  });
});

describe("rests need at least 1 Hit Point", () => {
  it("a dead character gets no Long Rest", () => {
    const state = game(dead);
    expect(() => applyRest(state, HERO, "long", resolve(state))).toThrow(
      /Torva is dead, and a rest can't bring Torva back/
    );
    expect(state.actors[0].hp.current).toBe(0);
  });

  it("a dying or stable character at 0 gets neither rest", () => {
    const state = game(dying);
    expect(() => applyRest(state, HERO, "long", resolve(state))).toThrow(/0 Hit Points. A Long Rest needs at least 1/);
    expect(() => applyRest(state, HERO, "short", resolve(state))).toThrow(/A Short Rest needs at least 1/);
    const stable = game({
      deathSaves: { successes: 0, failures: 0, stable: true },
      conditions: [{ id: "unconscious" }]
    });
    expect(() => applyRest(stable, HERO, "long", resolve(stable))).toThrow(/at least 1/);
  });

  it("Hit Dice can't be spent at 0 hit points, so a dying character can't heal themself awake", () => {
    const state = game(dying);
    expect(() => spendHitDice(state, HERO, [8], { role: "gm" }, resolve(state))).toThrow(
      /Hit Dice are spent on a Short Rest, which needs at least 1/
    );
    expect(state.actors[0]).toMatchObject({ hp: { current: 0 }, hitDice: { remaining: 7 } });
  });

  it("at 1 hit point both rests work as before", () => {
    const state = game({ hp: { current: 1, maximum: 75 } });
    applyRest(state, HERO, "long", resolve(state));
    expect(state.actors[0].hp.current).toBe(75);
  });
});

describe("only a revival brings the dead back", () => {
  it("revives with the hit points given, one fewer Exhaustion level, Prone kept and attunement gone", () => {
    const state = game({
      ...dead,
      conditions: [{ id: "unconscious" }, { id: "prone" }, { id: "exhaustion", level: 6 }],
      inventory: [{ id: "ring-of-protection", name: "Ring of Protection", quantity: 1, equipped: true, attuned: true }]
    });
    const events = reviveActor(state, HERO, 1, { role: "gm" }, { resolveDefinition: resolve(state) });
    const hero = state.actors[0];
    expect(hero.hp.current).toBe(1);
    expect(hero.deathSaves).toBeNull();
    expect([...hero.conditions].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "exhaustion", level: 5 },
      { id: "prone" }
    ]);
    expect(hero.inventory[0].attuned).toBe(false);
    expect(events[0].text).toBe("Torva returns to life with 1 hit point.");
  });

  it("refuses a creature that isn't dead, and a player", () => {
    const state = game(dying);
    expect(() => reviveActor(state, HERO, 5, { role: "gm" }, { resolveDefinition: resolve(state) })).toThrow(
      /isn't dead/
    );
    const corpse = game(dead);
    expect(() =>
      reviveActor(corpse, HERO, 5, { role: "player", sessionId: OWNER }, { resolveDefinition: resolve(corpse) })
    ).toThrow(/Only the GM/);
  });
});

describe("over the API", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("a player can't ask for a Long Rest or heal their dead character back, and the GM revives them", async () => {
    const { server, gmToken, post, close } = await bootServer(game({ ...dead, ownerSessionId: null }));
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);
    const ask = await post(GAME_PATHS.restAsk.replace("{actorId}", HERO), player, { commandId: randomUUID() });
    expect(ask.status).toBe(409);
    expect((await ask.json()).error.message).toBe("Torva is dead, and a rest can't bring Torva back.");
    const heal = await post(GAME_PATHS.actorHeal.replace("{actorId}", HERO), gmToken, {
      commandId: randomUUID(),
      amount: 10
    });
    expect(heal.status).toBe(409);
    expect((await heal.json()).error.message).toMatch(/dead and can't regain hit points/);
    const playerRevive = await post(GAME_PATHS.actorRevive.replace("{actorId}", HERO), player, {
      commandId: randomUUID(),
      hitPoints: 1
    });
    expect(playerRevive.status).toBe(403);
    const revive = await post(GAME_PATHS.actorRevive.replace("{actorId}", HERO), gmToken, {
      commandId: randomUUID(),
      hitPoints: 1
    });
    expect(revive.status).toBe(200);
    expect(server.store.snapshot.actors[0]).toMatchObject({ hp: { current: 1 }, deathSaves: null });
  });
});

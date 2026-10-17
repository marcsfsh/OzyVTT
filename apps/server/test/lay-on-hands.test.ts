import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";

// SRD 5.2.1 Paladin, Lay on Hands: "a pool of healing power that replenishes when you finish a Long Rest ... a total
// number of Hit Points equal to five times your Paladin level. As a Bonus Action, you can touch a creature ... and draw
// power from the pool of healing to restore a number of Hit Points to that creature, up to the maximum amount
// remaining in the pool. You can also expend 5 Hit Points from the pool of healing power to remove the Poisoned
// condition from the creature; those points don't also restore Hit Points to the creature."

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const PALADIN = "60000000-0000-4000-8000-000000000001";
const ALLY = "60000000-0000-4000-8000-000000000002";
const OWNER_TOKEN_CLAIM = { commandId: randomUUID(), actorId: PALADIN };

/** A seeded stand-in for the dice (mulberry32), so the generated Paladin is the same every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

const paladin = buildCharacterDefinition(
  generateCharacterRequest({ classId: "paladin", level: 5 }, library, policy, seeded(5)).request,
  library,
  policy
);

function table(ally: Record<string, unknown> = {}): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: ALLY,
        name: "Bryn",
        kind: "player-character",
        visibility: "public",
        hp: { current: 10, maximum: 40 },
        conditions: [{ id: "poisoned" }],
        ...ally
      }
    ]
  });
  importActorDefinition(state, paladin, PALADIN, "public", catalog);
  return state;
}

describe("Lay on Hands", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("is a pool of five points per Paladin level", () => {
    const state = table();
    const hero = state.actors.find((actor) => actor.id === PALADIN)!;
    const pools = actionPools(effectiveActions(paladin, hero, catalog));
    expect(pools.find((entry) => entry.id === "lay-on-hands")).toMatchObject({
      name: "Lay on Hands",
      limit: 25,
      per: "long-rest"
    });
    // A pool one action spends goes by that action's name, not its key.
    expect(pools.find((entry) => entry.id === "paladins-smite")?.name).toBe("Divine Smite (no slot)");
  });

  /** The Paladin and Bryn in a fight, the Paladin's turn first. */
  async function inAFight(state: GameState) {
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const { server, gmToken, post } = booted;
    const arena = await server.mapAssets.import(png(900, 600), "arena.png");
    server.mapCatalog.register(arena.metadata.id, "Arena", "battlemap");
    const start = await post(GAME_PATHS.encounterStart, gmToken, {
      commandId: randomUUID(),
      mapAssetId: arena.metadata.id,
      entries: [
        { actorId: PALADIN, score: 20 },
        { actorId: ALLY, score: 10 }
      ]
    });
    expect(start.status).toBe(200);
    const resolve = (body: Record<string, unknown>) =>
      post(GAME_PATHS.actionResolve, gmToken, { commandId: randomUUID(), actorId: PALADIN, ...body });
    return { ...booted, resolve };
  }

  it("heals the points its user spends, cures a poison for 5, and refuses what the pool can't pay", async () => {
    const { server, gmToken, post, resolve } = await inAFight(table());
    const actors = () => server.store.snapshot.actors;
    const ally = () => actors().find((actor) => actor.id === ALLY)!;
    const spent = () => actors().find((actor) => actor.id === PALADIN)!.actionUses["lay-on-hands"] ?? 0;

    const unpicked = await resolve({ actionId: "lay-on-hands", targetIds: [ALLY] });
    expect(unpicked.status).toBe(409);
    expect((await unpicked.json()).error.message).toBe("Choose how much of Lay on Hands to spend.");

    expect((await resolve({ actionId: "lay-on-hands", targetIds: [ALLY], spend: 7 })).status).toBe(200);
    expect(ally().hp.current).toBe(17);
    expect(spent()).toBe(7);

    const tooMuch = await resolve({ actionId: "lay-on-hands", targetIds: [ALLY], spend: 30 });
    expect(tooMuch.status).toBe(409);
    expect(JSON.stringify(await tooMuch.json())).toContain("Lay on Hands has 18 left - this spends 30.");

    // The Paladin's next turn brings a new Bonus Action for the cure.
    for (let turn = 0; turn < 2; turn += 1)
      expect((await post(GAME_PATHS.initiativeNext, gmToken, { commandId: randomUUID() })).status).toBe(200);
    expect((await resolve({ actionId: "lay-on-hands-cure-poison", targetIds: [ALLY] })).status).toBe(200);
    expect(ally()).toMatchObject({ hp: { current: 17 }, conditions: [] });
    expect(spent()).toBe(12);
    for (let turn = 0; turn < 2; turn += 1)
      expect((await post(GAME_PATHS.initiativeNext, gmToken, { commandId: randomUUID() })).status).toBe(200);
    const nothingToCure = await resolve({ actionId: "lay-on-hands-cure-poison", targetIds: [ALLY] });
    expect((await nothingToCure.json()).error.message).toBe(
      "Bryn isn't Poisoned - Lay on Hands: Cure Poison would do nothing."
    );
    expect(spent()).toBe(12);
  });

  it("refuses to heal the dead, spending nothing", async () => {
    // SRD "Dead": "A dead creature has no Hit Points and can't regain them unless it is first revived".
    const dead = table({
      hp: { current: 0, maximum: 40 },
      deathSaves: { successes: 0, failures: 3, stable: false },
      conditions: [{ id: "unconscious" }]
    });
    const { server, resolve } = await inAFight(dead);
    const refused = await resolve({ actionId: "lay-on-hands", targetIds: [ALLY], spend: 5 });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toBe("Bryn is dead and can't regain hit points until revived.");
    const paladin = server.store.snapshot.actors.find((actor) => actor.id === PALADIN)!;
    expect(paladin.actionUses["lay-on-hands"]).toBeUndefined();
    expect(server.store.snapshot.combat.turn.bonusActionUsed).toBe(false);
  });

  it("is spent on the loose route outside a fight, and by several uses from the sheet", async () => {
    const { server, gmToken, post, close } = await bootServer(table());
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, OWNER_TOKEN_CLAIM)).status).toBe(200);
    const spent = () => server.store.snapshot.actors.find((actor) => actor.id === PALADIN)!.actionUses["lay-on-hands"];

    const loose = await post(GAME_PATHS.actionUse, player, {
      commandId: randomUUID(),
      actorId: PALADIN,
      actionId: "lay-on-hands",
      spend: 4
    });
    expect(loose.status).toBe(200);
    expect(spent()).toBe(4);

    const uses = (path: string, token: string, amount: number, poolId = "lay-on-hands") =>
      post(path.replace("{actorId}", PALADIN), token, { commandId: randomUUID(), poolId, amount });
    expect((await uses(GAME_PATHS.actorSpendUses, player, 6)).status).toBe(200);
    expect(spent()).toBe(10);
    const over = await uses(GAME_PATHS.actorSpendUses, player, 16);
    expect(over.status).toBe(409);
    expect((await over.json()).error.message).toBe("Lay on Hands has 15 left.");
    expect((await uses(GAME_PATHS.actorRestoreUses, player, 5)).status).toBe(403);
    expect((await uses(GAME_PATHS.actorRestoreUses, gmToken, 4)).status).toBe(200);
    expect(spent()).toBe(6);
    expect((await uses(GAME_PATHS.actorRestoreUses, gmToken, 50)).status).toBe(200);
    expect(spent()).toBeUndefined();
    const full = await uses(GAME_PATHS.actorRestoreUses, gmToken, 1);
    expect(full.status).toBe(409);
    expect((await full.json()).error.message).toMatch(/Lay on Hands is already full/);
    const unknown = await uses(GAME_PATHS.actorSpendUses, gmToken, 1, "ki");
    expect((await unknown.json()).error.message).toMatch(/has no limited-use pool called "ki"/);
  });
});

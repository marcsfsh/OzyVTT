import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Healing outside a fight lands on the creature it is given to, through the same hit point rules a fight uses: a
// player heals their own character or another member of the party, the GM anyone, and the dead stay dead.

const HERO = "10000000-0000-4000-8000-0000000000c1";
const FRIEND = "10000000-0000-4000-8000-0000000000c2";
const GOBLIN = "10000000-0000-4000-8000-0000000000c3";
const SPY = "10000000-0000-4000-8000-0000000000c4";

const POTION = {
  id: "potion",
  name: "Potion of Healing",
  activation: "bonus-action" as const,
  description: "You regain 2d4 + 2 Hit Points.",
  damage: [],
  healing: { formula: "2d4 + 2" }
};
const SECOND_WIND = {
  id: "second-wind",
  name: "Second Wind",
  activation: "bonus-action" as const,
  description: "Regain 1d10 + your Fighter level.",
  damage: [],
  healing: { formula: "1d10 + 5", self: true as const },
  uses: { limit: 2, per: "long-rest" as const }
};
const LAY_ON_HANDS = {
  id: "lay-on-hands",
  name: "Lay on Hands",
  activation: "bonus-action" as const,
  description: "Restore Hit Points from the pool.",
  damage: [],
  healing: { formula: "1", perUse: true as const },
  uses: { limit: 25, per: "long-rest" as const, pool: "lay-on-hands" },
  useCost: "chosen" as const
};

const PRAYER = {
  id: "spell-prayer-of-healing",
  name: "Prayer of Healing",
  activation: "other" as const,
  description: "Up to five creatures regain 2d8 Hit Points.",
  damage: [],
  healing: { formula: "2d8" },
  spellId: "prayer-of-healing"
};

const actor = (id: string, name: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  kind,
  visibility: "public",
  hp: { current: 5, maximum: 40 },
  ...extra
});

const idle = (): GameState =>
  GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      actor(HERO, "Hero", "player-character", { definitionId: "hero-def" }),
      actor(FRIEND, "Friend", "player-character"),
      actor(GOBLIN, "Goblin", "monster"),
      actor(SPY, "Spy", "npc", { visibility: "gm-only" })
    ],
    definitions: [
      {
        id: "hero-def",
        definition: {
          ...(loadActorFixture("player-character") as Record<string, unknown>),
          id: "hero-def",
          name: "Hero",
          actions: [POTION, SECOND_WIND, LAY_ON_HANDS, PRAYER]
        }
      }
    ]
  });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot(state: GameState) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-heal-"));
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
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const heroSession = server.auth.issuePlayerSession();
  await post(base, GAME_PATHS.claims, heroSession, { actorId: HERO });
  return { base, server, gmToken, heroSession };
}

const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
const use = (base: string, token: string, actionId: string, extra: Record<string, unknown> = {}) =>
  post(base, GAME_PATHS.actionUse, token, { commandId: randomUUID(), actorId: HERO, actionId, ...extra });
const hpOf = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!.hp.current;

describe("healing outside a fight", () => {
  it("lands a potion on the party member it is given to, rolled once", async () => {
    const { base, server, heroSession } = await boot(idle());
    const drunk = await use(base, heroSession, "potion", { targetIds: [FRIEND] });
    expect(drunk.status).toBe(200);
    const healing = server.store.snapshot.rolls.find((roll) => roll.purpose === "healing")!;
    expect(hpOf(server.store.snapshot, FRIEND)).toBe(5 + healing.total);
    expect(hpOf(server.store.snapshot, HERO)).toBe(5);
    const feed = await fetch(base + GAME_PATHS.log, { headers: { authorization: `Bearer ${heroSession}` } });
    const texts = ((await feed.json()).data.entries as ReadonlyArray<{ text: string }>).map((entry) => entry.text);
    expect(texts).toContain(`Friend regains ${healing.total} hit points (Potion of Healing).`);
  });

  it("heals its user when no one else is named, and a self heal always", async () => {
    const { base, server, heroSession } = await boot(idle());
    expect((await use(base, heroSession, "potion")).status).toBe(200);
    expect(hpOf(server.store.snapshot, HERO)).toBeGreaterThan(5);
    const before = hpOf(server.store.snapshot, HERO);
    expect((await use(base, heroSession, "second-wind", { targetIds: [FRIEND] })).status).toBe(200);
    expect(hpOf(server.store.snapshot, HERO)).toBeGreaterThan(before);
    expect(hpOf(server.store.snapshot, FRIEND)).toBe(5);
  });

  it("regains Lay on Hands' points one for each point spent", async () => {
    const { base, server, heroSession } = await boot(idle());
    expect((await use(base, heroSession, "lay-on-hands", { targetIds: [FRIEND], spend: 7 })).status).toBe(200);
    expect(hpOf(server.store.snapshot, FRIEND)).toBe(12);
    expect(server.store.snapshot.actors.find((candidate) => candidate.id === HERO)!.actionUses).toMatchObject({
      "lay-on-hands": 7
    });
  });

  it("lets a player heal only the party, without naming a creature they can't see", async () => {
    const { base, server, heroSession } = await boot(idle());
    const monster = await use(base, heroSession, "potion", { targetIds: [GOBLIN] });
    expect(monster.status).toBe(403);
    const hidden = await use(base, heroSession, "potion", { targetIds: [SPY] });
    expect(hidden.status).toBe(403);
    expect((await hidden.json()).error.message).toBe("You can heal your own character or another member of the party.");
    expect(hpOf(server.store.snapshot, GOBLIN)).toBe(5);
    expect(server.store.snapshot.rolls).toEqual([]);
  });

  it("lets the GM heal anyone", async () => {
    const { base, server, gmToken } = await boot(idle());
    expect((await use(base, gmToken, "potion", { targetIds: [GOBLIN] })).status).toBe(200);
    expect(hpOf(server.store.snapshot, GOBLIN)).toBeGreaterThan(5);
  });

  it("refuses a heal on the dead before anything is spent", async () => {
    const state = idle();
    const friend = state.actors.find((candidate) => candidate.id === FRIEND)!;
    friend.hp.current = 0;
    friend.deathSaves = { successes: 0, failures: 3, stable: false };
    const { base, server, heroSession } = await boot(state);
    const refused = await use(base, heroSession, "lay-on-hands", { targetIds: [FRIEND], spend: 5 });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toBe("Friend is dead and can't regain hit points until revived.");
    expect(server.store.snapshot.actors.find((candidate) => candidate.id === HERO)!.actionUses).toEqual({});
  });

  it("heals no more creatures than one use reaches", async () => {
    const { base, heroSession } = await boot(idle());
    const two = await use(base, heroSession, "potion", { targetIds: [HERO, FRIEND] });
    expect(two.status).toBe(409);
    expect((await two.json()).error.message).toBe("Potion of Healing heals one creature; 2 were picked.");
  });

  it("closes a wound that a spell's healing ends", async () => {
    const state = idle();
    state.actors.find((candidate) => candidate.id === FRIEND)!.effects = [
      {
        id: "wound",
        name: "Infernal Wound",
        tags: [],
        sourceActorId: null,
        sourceName: null,
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "manual" },
        endsWhenSourceDefeated: false,
        voidWhileIncapacitated: false,
        concentration: false,
        endsWithTag: null,
        modifiers: [],
        linkedConditionIds: [],
        escapeDc: null,
        onEnd: [],
        endsOnSpellHealing: true
      }
    ];
    const { base, server, heroSession } = await boot(state);
    expect((await use(base, heroSession, "spell-prayer-of-healing", { targetIds: [FRIEND] })).status).toBe(200);
    expect(server.store.snapshot.actors.find((candidate) => candidate.id === FRIEND)!.effects).toEqual([]);
  });

  it("heals each creature a healing spell reaches, and tells the sheet how many that is", async () => {
    const { base, server, heroSession } = await boot(idle());
    const read = await fetch(base + GAME_PATHS.actorAvailableActions.replace("{actorId}", HERO), {
      headers: { authorization: `Bearer ${heroSession}` }
    });
    const rows = (await read.json()).data.actions as ReadonlyArray<{ id: string; healTargets?: number | null }>;
    expect(rows.find((row) => row.id === "spell-prayer-of-healing")?.healTargets).toBe(5);
    expect(rows.find((row) => row.id === "potion")?.healTargets).toBeNull();
    expect((await use(base, heroSession, "spell-prayer-of-healing", { targetIds: [HERO, FRIEND] })).status).toBe(200);
    expect(hpOf(server.store.snapshot, HERO)).toBeGreaterThan(5);
    expect(hpOf(server.store.snapshot, FRIEND)).toBe(hpOf(server.store.snapshot, HERO));
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { RulesBlockedError } from "../src/game-store.js";
import { looseRollPlan, offTurnVerdict, routeForTap, NOT_YOUR_TURN } from "../src/tap-routing.js";
import { familyOf } from "../src/rules-families.js";
import { createServer } from "../src/server.js";

/**
 * THE TAP IS THE ATTACK (D10 / WI3). The routing that used to be one client-side boolean is now a
 * server decision with three named outcomes, and these tests pin all three - plus the two things the
 * old gate got silently wrong: a monster sheet routed loose for the GM mid-fight, and an off-turn tap
 * produced a die and no explanation.
 */

const HERO = "10000000-0000-4000-8000-0000000000b1";
const OTHER = "10000000-0000-4000-8000-0000000000b2";
const GOBLIN = "10000000-0000-4000-8000-0000000000b3";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const SWING = { id: "swing", name: "Longsword", activation: "action" as const, description: "Melee Attack Roll: +5.", attack: { bonus: 5, reachFeet: 5 }, damage: [{ formula: "1d8 + 3", type: "slashing" }] };
const PARRY = { id: "parry", name: "Parry", activation: "reaction" as const, description: "Adds 2 AC.", damage: [] };

/** A real fixture sheet with the two test actions grafted on, so the definition stays schema-valid. */
function heroDefinition(id: string, name: string) {
  return { ...(loadActorFixture("player-character") as Record<string, unknown>), id, name, actions: [SWING, PARRY] };
}

/** A live fight: Hero is up, Second Hero and the Goblin are waiting. */
function fightState(): GameState {
  return GameStateSchema.parse({ schemaVersion: 1,
    actors: [
      { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
      { id: OTHER, name: "Second Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ],
    combat: { active: true, round: 1, turnActorId: HERO, initiative: [{ actorId: HERO, score: 20 }, { actorId: OTHER, score: 10 }, { actorId: GOBLIN, score: 1 }] }
  });
}

describe("tap routing (the seam)", () => {
  it("routes on turn, off turn, and outside a fight", () => {
    const fight = fightState();
    expect(routeForTap(fight.combat, HERO)).toBe("resolved");
    expect(routeForTap(fight.combat, OTHER)).toBe("blocked");

    // No fight at all - and, just as importantly, a creature that is not IN the fight. Telling a GM
    // rolling a wandering monster's attack to "wait their turn" would be nonsense, so it is loose.
    const idle = GameStateSchema.parse({ schemaVersion: 1, actors: [{ id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }] });
    expect(routeForTap(idle.combat, HERO)).toBe("loose");
    expect(routeForTap(fight.combat, "10000000-0000-4000-8000-0000000000bf")).toBe("loose");
  });

  it("refuses an off-turn action under a strict economy, warns under advise, and stays silent under off", () => {
    const strict = fightState();
    expect(() => offTurnVerdict(strict, SWING, "Hero")).toThrow(RulesBlockedError);
    try { offTurnVerdict(strict, SWING, "Hero"); } catch (error) {
      const blocked = error as RulesBlockedError;
      expect(blocked.rule).toBe(NOT_YOUR_TURN);
      expect(blocked.message).toBe("Not your turn yet - Hero is up.");
      // Overridable and askable, which is the whole point of making it a rules block rather than silence.
      expect(blocked.overridable).toBe(true);
      expect(familyOf(blocked.rule)).toBe("economy");
    }

    const advise = fightState();
    advise.combat = { ...advise.combat, ruleExceptions: { economy: "assisted" } };
    expect(offTurnVerdict(advise, SWING, "Hero").warning).toBe("Not your turn yet - Hero is up.");

    const off = fightState();
    off.combat = { ...off.combat, ruleExceptions: { economy: "freeform" } };
    expect(offTurnVerdict(off, SWING, "Hero").warning).toBeNull();
  });

  it("exempts reactions and legendary actions - taking those off turn is the point", () => {
    const fight = fightState();
    expect(offTurnVerdict(fight, PARRY, "Hero").warning).toBeNull();
    expect(offTurnVerdict(fight, { activation: "other", legendary: { cost: 1 } }, "Hero").warning).toBeNull();
  });

  it("stops re-prompting once the GM has waved the economy through this turn (D9)", () => {
    const fight = fightState();
    fight.combat = { ...fight.combat, turn: { ...fight.combat.turn, rulesOverridden: true, rulesOverriddenFamilies: ["economy"] } };
    expect(offTurnVerdict(fight, SWING, "Hero").warning).toBeNull();
  });

  it("plans the loose route's dice, with damage strictly opt-in", () => {
    expect(looseRollPlan(SWING, { includeDamage: false })).toEqual([{ formula: "1d20 + 5", purpose: "attack", label: "Longsword" }]);
    expect(looseRollPlan(SWING, { includeDamage: true, rollMode: "advantage" })).toEqual([
      { formula: "2d20kh1 + 5", purpose: "attack", label: "Longsword" },
      { formula: "1d8 + 3", purpose: "damage", label: "Longsword (slashing)" }
    ]);
    // Opt-in matters: a sheet that renders its own damage chip must not make one tap roll damage twice.
    expect(looseRollPlan(SWING, { includeDamage: false }).some((entry) => entry.purpose === "damage")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function boot(state: GameState) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-tap-"));
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
  server.mapCatalog.register(imported.metadata.id, "Tap Arena", "battlemap");
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, mapAssetId: imported.metadata.id };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });

/** Hero and Second Hero carry the same definition, so both have the Longsword action. */
function withDefinitions(state: GameState): GameState {
  return GameStateSchema.parse({
    ...state,
    definitions: [{ id: "hero-def", definition: heroDefinition("hero-def", "Hero") }, { id: "other-def", definition: heroDefinition("other-def", "Second Hero") }],
    actors: state.actors.map((actor) => actor.id === HERO ? { ...actor, definitionId: "hero-def" } : actor.id === OTHER ? { ...actor, definitionId: "other-def" } : actor)
  });
}

describe("action.use over the API", () => {
  it("resolves on turn and refuses off turn with an overridable, askable block", async () => {
    const { base, server } = await boot(withDefinitions(fightState()));
    const heroSession = server.auth.issuePlayerSession();
    const otherSession = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, heroSession, { actorId: HERO });
    await post(base, GAME_PATHS.claims, otherSession, { actorId: OTHER });

    const onTurn = await post(base, GAME_PATHS.actionUse, heroSession, { commandId: randomUUID(), actorId: HERO, actionId: "swing", targetIds: [GOBLIN] });
    expect(onTurn.status).toBe(200);
    expect((await onTurn.json()).data.route).toBe("resolved");
    expect(server.store.snapshot.combat.turn.actionUsed).toBe(true);

    // Second Hero's turn has not come around: a real block, not a silent loose die.
    const offTurn = await post(base, GAME_PATHS.actionUse, otherSession, { commandId: randomUUID(), actorId: OTHER, actionId: "swing", targetIds: [GOBLIN] });
    expect(offTurn.status).toBe(409);
    const error = (await offTurn.json()).error;
    expect(error.details.blocked.rule).toBe(NOT_YOUR_TURN);
    expect(error.details.blocked.overridable).toBe(true);
  });

  it("lets the blocked off-turn player ask the GM, and the GM's Allow runs the action", async () => {
    const { base, server, gmToken } = await boot(withDefinitions(fightState()));
    const otherSession = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, otherSession, { actorId: OTHER });
    const payload = { commandId: randomUUID(), actorId: OTHER, actionId: "swing", targetIds: [GOBLIN] };

    const asked = await post(base, GAME_PATHS.rulesAsk, otherSession, { commandId: randomUUID(), type: "action.use", payload });
    expect(asked.status).toBe(200);
    const askId = (await asked.json()).data.askId as string;
    expect(server.store.snapshot.combat.pendingRuleAsks[0].rule).toBe(NOT_YOUR_TURN);

    const allowed = await post(base, GAME_PATHS.rulesAnswer, gmToken, { commandId: randomUUID(), askId, allow: true });
    expect(allowed.status).toBe(200);
    expect(server.store.snapshot.combat.pendingRuleAsks).toEqual([]);
    // The off-turn swing actually happened: its attack roll is in the feed's hot window.
    expect(server.store.snapshot.rolls.some((roll) => roll.actorId === OTHER && roll.purpose === "attack")).toBe(true);
  });

  it("rolls loose, attributed dice outside a fight - and moves no hit points", async () => {
    const idle = GameStateSchema.parse({ schemaVersion: 1, actors: [
      { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, definitionId: "hero-def" },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ], definitions: [{ id: "hero-def", definition: heroDefinition("hero-def", "Hero") }] });
    const { base, server } = await boot(idle);
    const heroSession = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, heroSession, { actorId: HERO });

    const loose = await post(base, GAME_PATHS.actionUse, heroSession, { commandId: randomUUID(), actorId: HERO, actionId: "swing", includeDamage: true });
    expect(loose.status).toBe(200);
    const body = (await loose.json()).data;
    expect(body.route).toBe("loose");
    expect(body.rollIds.length).toBe(2);
    const rolls = server.store.snapshot.rolls;
    expect(rolls.map((roll) => roll.purpose)).toEqual(["attack", "damage"]);
    expect(rolls.every((roll) => roll.actorId === HERO)).toBe(true);
    expect(rolls.every((roll) => roll.initiatorLabel === "Hero")).toBe(true);
    // No fight was started and nothing took damage: a loose damage roll is a number, not an application.
    expect(server.store.snapshot.combat.active).toBe(false);
    expect(server.store.snapshot.actors.find((actor) => actor.id === GOBLIN)?.hp.current).toBe(7);
    // And the rolls reached the one feed, attributed.
    const feed = await fetch(base + GAME_PATHS.log, { headers: bearer(heroSession) });
    const entries = (await feed.json()).data.entries as ReadonlyArray<{ kind: string; actorId?: string }>;
    expect(entries.filter((entry) => entry.kind === "roll").every((entry) => entry.actorId === HERO)).toBe(true);
  });

  it("routes a GM's tap on a MONSTER sheet structurally - the old client gate sent it loose", async () => {
    const monsterFight = GameStateSchema.parse({ schemaVersion: 1,
      actors: [
        { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 }, definitionId: "goblin-def" },
        { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
      ],
      definitions: [{ id: "goblin-def", definition: heroDefinition("goblin-def", "Goblin") }],
      combat: { active: true, round: 1, turnActorId: GOBLIN, initiative: [{ actorId: GOBLIN, score: 20 }, { actorId: HERO, score: 5 }] }
    });
    const { base, server, gmToken } = await boot(monsterFight);
    const used = await post(base, GAME_PATHS.actionUse, gmToken, { commandId: randomUUID(), actorId: GOBLIN, actionId: "swing", targetIds: [HERO] });
    expect(used.status).toBe(200);
    expect((await used.json()).data.route).toBe("resolved");
    expect(server.store.snapshot.combat.turn.actionUsed).toBe(true);
  });

  it("refuses a player using another character's action", async () => {
    const { base, server } = await boot(withDefinitions(fightState()));
    const otherSession = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, otherSession, { actorId: OTHER });
    const stolen = await post(base, GAME_PATHS.actionUse, otherSession, { commandId: randomUUID(), actorId: HERO, actionId: "swing", targetIds: [GOBLIN] });
    expect(stolen.status).toBe(409);
  });
});

describe("save.roll over the API", () => {
  it("answers a matching pending save instead of rolling a loose die past it", async () => {
    const pendingId = randomUUID();
    const state = GameStateSchema.parse({ schemaVersion: 1,
      actors: [
        { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } },
        { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
      ],
      combat: {
        active: true, round: 1, turnActorId: GOBLIN,
        initiative: [{ actorId: GOBLIN, score: 20 }, { actorId: HERO, score: 5 }],
        pendingSaves: [{ id: pendingId, targetActorId: HERO, sourceActorId: GOBLIN, sourceName: "Goblin", actionName: "Firebomb", ability: "dex", dc: 5, proposedDamage: 7, proposedDamageParts: [{ amount: 7, type: "fire" }], halfOnSuccess: true, createdAt: 0 }]
      }
    });
    const { base, server } = await boot(state);
    const heroSession = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, heroSession, { actorId: HERO });

    const answered = await post(base, GAME_PATHS.saveRoll, heroSession, { commandId: randomUUID(), actorId: HERO, ability: "dex", total: 20 });
    expect(answered.status).toBe(200);
    const body = (await answered.json()).data;
    expect(body.route).toBe("answered");
    expect(body.saveId).toBe(pendingId);
    // The prompt actually closed - the tracker is no longer waiting for a save the table already made.
    expect(server.store.snapshot.combat.pendingSaves).toEqual([]);
  });

  it("rolls a loose, attributed save when nothing is pending", async () => {
    const { base, server } = await boot(withDefinitions(fightState()));
    const heroSession = server.auth.issuePlayerSession();
    await post(base, GAME_PATHS.claims, heroSession, { actorId: HERO });

    const loose = await post(base, GAME_PATHS.saveRoll, heroSession, { commandId: randomUUID(), actorId: HERO, ability: "con" });
    expect(loose.status).toBe(200);
    expect((await loose.json()).data.route).toBe("loose");
    const record = server.store.snapshot.rolls.at(-1)!;
    expect(record.purpose).toBe("save");
    expect(record.actorId).toBe(HERO);
    expect(record.label).toBe("CON save");
  });
});

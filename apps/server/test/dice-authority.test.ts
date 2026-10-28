import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import {
  DamageRollSchema,
  GameStateSchema,
  PendingSaveSchema,
  SceneSchema,
  effectivePlayerDice,
  type GameState
} from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import type { ActorDefinition } from "@vtt/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { answerSave, createPendingSaves, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { createServer } from "../src/server.js";

// Who rolls the dice (ADR-0012): players supply die faces, never totals or modes; a die shown before it counts is
// held on the server, so looking again shows the same die; Heroic Inspiration is a player's only reroll, the GM's is
// free; one table setting decides whether players may type their dice.

const HERO = "10000000-0000-4000-8000-0000000000e1";
const FOE = "10000000-0000-4000-8000-0000000000e2";
const SESSION = "30000000-0000-4000-8000-0000000000e1";
const MAP = "20000000-0000-5000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const SWING = {
  id: "swing",
  name: "Longsword",
  activation: "action" as const,
  description: "Melee Attack Roll: +5.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d8 + 3", type: "slashing" }]
};

/** The fixture's sheet (Str 16, Dex 14, PB 2) with a longsword. */
const heroSheet = (): ActorDefinition =>
  ({
    ...(loadActorFixture("player-character") as Record<string, unknown>),
    name: "Hero",
    actions: [SWING]
  }) as ActorDefinition;

/** Hero against a Foe (AC 12), Hero's turn. */
function fight(hero: Record<string, unknown> = {}): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "hero-def", definition: { ...heroSheet(), id: "hero-def" } }],
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "hero-def",
        ownerSessionId: SESSION,
        ...hero
      },
      { id: FOE, name: "Foe", kind: "monster", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12 }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: MAP,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );
  return state;
}

const queue = (faces: number[]) => () => {
  const face = faces.shift();
  if (face === undefined) throw new Error("a die was thrown");
  return face;
};
const OWNER = { role: "player", sessionId: SESSION } as const;
const GM = { role: "gm" } as const;

function saveDeps(faces: number[], role: "gm" | "player" = "player"): SaveAnswerDependencies {
  let id = 0;
  return {
    random: queue(faces),
    newRollId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    sessionId: role === "gm" ? "30000000-0000-4000-8000-00000000000a" : SESSION,
    role,
    now: () => "2026-10-16T00:00:00.000Z",
    resolveDefinition: () => heroSheet()
  };
}

/** A DC 15 Dexterity save the Foe's Firebomb asks of Hero. */
function owedSave(state: GameState): string {
  createPendingSaves(state, {
    sourceActorId: FOE,
    sourceName: "Foe",
    actionName: "Firebomb",
    ability: "dex",
    dc: 15,
    targetIds: [HERO],
    proposedDamage: 10,
    halfOnSuccess: true,
    conditionIds: [],
    newSaveId: () => "60000000-0000-4000-8000-0000000000e1",
    createdAt: 0
  });
  return "60000000-0000-4000-8000-0000000000e1";
}

const answer = (
  state: GameState,
  saveId: string,
  scope: typeof OWNER | typeof GM,
  faces: number[],
  options: Readonly<{
    commit?: boolean;
    method?: "roll" | "manual";
    total?: number;
    mode?: "advantage" | "disadvantage" | "normal";
    face?: number;
    reroll?: boolean;
    damage?: number;
  }> = {}
) =>
  answerSave(
    state,
    randomUUID(),
    saveId,
    options.method ?? "roll",
    options.total,
    options.commit ?? false,
    scope,
    saveDeps(faces, scope.role),
    false,
    options.mode,
    options.damage,
    { ...(options.face !== undefined ? { face: options.face } : {}), ...(options.reroll ? { reroll: true } : {}) }
  ).outcome;

describe("a saving throw shown before it counts", () => {
  it("holds its die: a second look and the confirm use it, even after the turn moves on", () => {
    const state = fight();
    const saveId = owedSave(state);
    expect(answer(state, saveId, OWNER, [7])).toMatchObject({ natural: 7, total: 9, committed: false });
    const recorded = state.rolls.length;
    // No die is left to throw: a second look reads the held one and records nothing.
    expect(answer(state, saveId, OWNER, [])).toMatchObject({ natural: 7, total: 9 });
    expect(state.rolls).toHaveLength(recorded);
    state.combat = { ...state.combat, turnActorId: FOE, round: 2 };
    expect(answer(state, saveId, OWNER, [], { commit: true })).toMatchObject({
      natural: 7,
      success: false,
      committed: true
    });
    expect(state.heldRolls).toEqual([]);
  });

  it("rerolls one die for a player's Heroic Inspiration, and freely for the GM", () => {
    const state = fight();
    const saveId = owedSave(state);
    answer(state, saveId, OWNER, [5]);
    expect(() => answer(state, saveId, OWNER, [18], { reroll: true })).toThrow(/no Heroic Inspiration/);
    state.actors[0].heroicInspiration = true;
    expect(answer(state, saveId, OWNER, [18], { reroll: true })).toMatchObject({ natural: 18, success: true });
    expect(state.actors[0].heroicInspiration).toBe(false);
    expect(answer(state, saveId, GM, [2], { reroll: true })).toMatchObject({ natural: 2 });
    expect(answer(state, saveId, OWNER, [])).toMatchObject({ natural: 2 });
  });

  it("ignores a player's Advantage, and names a mode the GM forces as the GM's", () => {
    const state = fight();
    const saveId = owedSave(state);
    const player = answer(state, saveId, OWNER, [4], { mode: "advantage" });
    expect(player.natural).toBe(4);
    expect(player.rollMode).toBeUndefined();
    const gm = answer(state, saveId, GM, [3, 15], { mode: "advantage", reroll: true });
    expect(gm).toMatchObject({ natural: 15, rollMode: { mode: "advantage", advantage: ["GM's choice"] } });
  });

  it("takes a player's typed face, never a total, and fails a Paralyzed creature's Dexterity save whatever it shows", () => {
    const state = fight();
    const saveId = owedSave(state);
    expect(() => answer(state, saveId, OWNER, [], { method: "manual", total: 25, commit: true })).toThrow(
      /d20 your die shows/
    );
    state.actors[0].conditions = [{ id: "paralyzed" }];
    expect(answer(state, saveId, OWNER, [], { face: 20, commit: true })).toMatchObject({
      success: false,
      autoFailed: "paralyzed",
      appliedDamage: 10
    });
    // The GM's typed total is a ruling, and stands.
    const second = owedSave(state);
    expect(answer(state, second, GM, [], { method: "manual", total: 25, commit: true }).success).toBe(true);
  });

  it("takes a typed face only while the table lets players type, and never over a die the server threw", () => {
    const state = fight();
    const saveId = owedSave(state);
    answer(state, saveId, OWNER, [3]);
    expect(() => answer(state, saveId, OWNER, [], { face: 18 })).toThrow(/already thrown/);
    state.actors[0].heroicInspiration = true;
    expect(() => answer(state, saveId, OWNER, [], { face: 18, reroll: true })).toThrow(/server threw this die/);
    expect(state.actors[0].heroicInspiration).toBe(true);

    const typed = fight({ heroicInspiration: true });
    const typedSave = owedSave(typed);
    expect(answer(typed, typedSave, OWNER, [], { face: 4 })).toMatchObject({ natural: 4, total: 6 });
    // A typed die is confirmed by typing it again, or rerolled by typing the reroll.
    expect(answer(typed, typedSave, OWNER, [], { face: 16, reroll: true })).toMatchObject({ natural: 16 });
    expect(typed.actors[0].heroicInspiration).toBe(false);

    const closed = fight();
    closed.playerDice = { d20: "app", damage: "app" };
    const closedSave = owedSave(closed);
    expect(() => answer(closed, closedSave, OWNER, [], { face: 18 })).toThrow(/server rolls players' dice/);
    expect(() => answer(closed, closedSave, OWNER, [9], { damage: 4 })).toThrow(/server rolls the damage/);
    expect(answer(closed, closedSave, GM, [], { face: 18 }).natural).toBe(18);
  });
});

function resolveDeps(faces: number[], role: "gm" | "player"): ResolveDependencies {
  let id = 0;
  return {
    random: queue(faces),
    newRollId: () => `40000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    initiatorRole: role,
    ...(role === "player" ? { initiatorSessionId: SESSION } : {}),
    now: () => "2026-10-16T00:00:00.000Z",
    definition: heroSheet()
  };
}

const swing = (
  state: GameState,
  faces: number[],
  input: Readonly<{ commit?: boolean; reroll?: boolean; attackNatural?: number; role?: "gm" | "player" }> = {}
) =>
  resolveDefinitionAction(
    state,
    SWING,
    {
      actorId: HERO,
      targetIds: [FOE],
      commandId: randomUUID(),
      commit: input.commit ?? false,
      holdKey: `attack:${HERO}`,
      ...(input.reroll ? { reroll: true } : {}),
      ...(input.attackNatural !== undefined ? { attackNatural: input.attackNatural, typedFace: true } : {})
    },
    resolveDeps(faces, input.role ?? "player")
  );

describe("an attack shown before it counts", () => {
  it("holds its d20 for the turn: looking again or at another target shows the same die, the confirm uses it", () => {
    const state = fight();
    expect(swing(state, [6]).attack).toMatchObject({ naturalRoll: 6, total: 11, outcome: "miss" });
    const recorded = state.rolls.length;
    expect(swing(state, []).attack).toMatchObject({ naturalRoll: 6 });
    expect(state.rolls).toHaveLength(recorded);
    // The confirm rolls only the damage it now owes: none on a miss.
    expect(swing(state, [], { commit: true }).attack).toMatchObject({ naturalRoll: 6, outcome: "miss" });
    expect(state.heldRolls).toEqual([]);
  });

  it("drops an attack's held die once the turn has passed", () => {
    const state = fight();
    swing(state, [6]);
    state.combat = { ...state.combat, round: 2 };
    expect(swing(state, [14]).attack).toMatchObject({ naturalRoll: 14 });
  });

  it("rerolls with a player's Heroic Inspiration and freely for the GM; a typed reroll needs a typed die", () => {
    const state = fight();
    swing(state, [2]);
    expect(() => swing(state, [17], { reroll: true })).toThrow(/no Heroic Inspiration/);
    state.actors[0].heroicInspiration = true;
    expect(() => swing(state, [], { reroll: true, attackNatural: 20 })).toThrow(/server threw this die/);
    expect(swing(state, [17], { reroll: true }).attack).toMatchObject({ naturalRoll: 17, outcome: "hit" });
    expect(state.actors[0].heroicInspiration).toBe(false);
    expect(swing(state, [9], { reroll: true, role: "gm" }).attack).toMatchObject({ naturalRoll: 9 });
  });
});

const GM_PASSWORD = "a sufficiently long GM password";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot(state: GameState) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-dice-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    // No battlemap behind the HTTP fight: the resolver measures nothing, as at a table without a map.
    initialGameState: {
      ...state,
      combat: { ...state.combat, mapAssetId: null, tokens: [] },
      actors: state.actors.map((actor) => ({ ...actor, ownerSessionId: null }))
    }
  });
  await server.initialize();
  await server.auth.bootstrap(GM_PASSWORD);
  const gmToken = (await server.auth.login(GM_PASSWORD))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${address.port}`;
  const player = server.auth.issuePlayerSession();
  expect((await post(base, GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);
  return { base, server, gmToken, player };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const closeTypedDice = (base: string, gmToken: string) =>
  post(base, GAME_PATHS.playerDice, gmToken, { commandId: randomUUID(), d20: "app", damage: "app" });

/** Hero at 0 HP and dying, outside a fight, blessed (a d4 on every saving throw). */
function dying(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "hero-def", definition: { ...heroSheet(), id: "hero-def" } }],
    actors: [
      {
        id: HERO,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 0, maximum: 20 },
        definitionId: "hero-def",
        deathSaves: { successes: 0, failures: 0, stable: false },
        conditions: [{ id: "unconscious" }, { id: "prone" }],
        effects: [
          makeEffect({
            id: "bless",
            name: "Bless",
            duration: { type: "manual" },
            modifiers: [{ type: "save-bonus", amount: 0, dice: "1d4", when: [{ type: "on-saving-throw" }] }]
          })
        ]
      }
    ]
  });
}

describe("a death save over the API", () => {
  it("holds a previewed die, adds Bless's d4, ignores a player's mode, and rerolls only with Heroic Inspiration", async () => {
    const { base, server, gmToken, player } = await boot(dying());
    const path = GAME_PATHS.deathSaveRoll.replace("{actorId}", HERO);
    const preview = async (extra: Record<string, unknown> = {}) =>
      post(base, path, player, { commandId: randomUUID(), actorId: HERO, commit: false, ...extra });
    const first = (await (await preview({ rollMode: "advantage" })).json()).data.deathSave;
    expect(first.rollMode).toBeUndefined();
    const record = server.store.snapshot.rolls.at(-1)!;
    expect(record.normalizedFormula).toMatch(/1d4/);
    expect(record.dice.filter((die) => die.sides === 20)).toHaveLength(1);
    // The total the prompt shows carries Bless's d4 on top of the die.
    expect(first.total).toBe(record.total);
    expect(first.total - first.naturalRoll).toBeGreaterThanOrEqual(1);
    expect(first.total - first.naturalRoll).toBeLessThanOrEqual(4);
    const recorded = server.store.snapshot.rolls.length;
    expect((await (await preview()).json()).data.deathSave.naturalRoll).toBe(first.naturalRoll);
    expect(server.store.snapshot.rolls).toHaveLength(recorded);

    const refused = await preview({ reroll: true });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toMatch(/no Heroic Inspiration/);
    await post(base, GAME_PATHS.actorHeroicInspiration.replace("{actorId}", HERO), gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      has: true
    });
    const rerolled = (await (await preview({ reroll: true })).json()).data.deathSave;
    expect(server.store.snapshot.actors[0].heroicInspiration).toBe(false);
    expect(server.store.snapshot.rolls).toHaveLength(recorded + 1);
    const confirmed = await post(base, path, player, { commandId: randomUUID(), actorId: HERO, commit: true });
    expect((await confirmed.json()).data.deathSave).toMatchObject({
      naturalRoll: rerolled.naturalRoll,
      committed: true
    });
  });

  it("takes a player's typed death save by default, and refuses it once the table rolls players' dice", async () => {
    const { base, gmToken, player } = await boot(dying());
    const path = GAME_PATHS.deathSaveRoll.replace("{actorId}", HERO);
    const typed = { actorId: HERO, commit: false, naturalRoll: 20 };
    expect((await post(base, path, player, { commandId: randomUUID(), ...typed })).status).toBe(200);
    // A fresh preview, so the refusal is the table's setting and not the die already held.
    const closed = await boot(dying());
    await closeTypedDice(closed.base, closed.gmToken);
    expect((await post(closed.base, path, closed.player, { commandId: randomUUID(), ...typed })).status).toBe(409);
    expect((await post(closed.base, path, closed.gmToken, { commandId: randomUUID(), ...typed })).status).toBe(200);
    // The GM may type over a held die.
    expect((await post(base, path, gmToken, { commandId: randomUUID(), ...typed, naturalRoll: 3 })).status).toBe(200);
  });
});

describe("players type faces, never totals or modes", () => {
  it("refuses a player's typed attack total or declared crit or natural 1, and ignores their Advantage", async () => {
    const { base, player } = await boot(fight({ conditions: [{ id: "poisoned" }] }));
    const resolve = (extra: Record<string, unknown>) =>
      post(base, GAME_PATHS.actionResolve, player, {
        commandId: randomUUID(),
        actorId: HERO,
        actionId: "swing",
        targetIds: [FOE],
        commit: false,
        ...extra
      });
    expect((await resolve({ attackTotal: 30 })).status).toBe(403);
    expect((await resolve({ attackNatural: 14, critical: true })).status).toBe(403);
    expect((await resolve({ attackNatural: 14, fumble: true })).status).toBe(403);
    const preview = (await (await resolve({ rollMode: "advantage" })).json()).data.resolution;
    expect(preview.rollMode).toMatchObject({
      mode: "disadvantage",
      advantage: [],
      disadvantage: ["Attacker is Poisoned"]
    });
  });

  it("lets the GM declare a natural 1 with a typed total, which misses whatever the total", async () => {
    const { base, gmToken } = await boot(fight());
    const resolved = await post(base, GAME_PATHS.actionResolve, gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "swing",
      targetIds: [FOE],
      attackTotal: 30,
      fumble: true
    });
    expect((await resolved.json()).data.resolution.attack).toMatchObject({ naturalRoll: 1, outcome: "fumble" });
  });

  it("puts every typed die a player sends behind the table's one setting", async () => {
    const { base, gmToken, player } = await boot(fight());
    await closeTypedDice(base, gmToken);
    const typedAttack = await post(base, GAME_PATHS.actionResolve, player, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "swing",
      targetIds: [FOE],
      commit: false,
      attackNatural: 20
    });
    expect(typedAttack.status).toBe(409);
    const typedRoll = await post(base, GAME_PATHS.rolls, player, {
      commandId: randomUUID(),
      formula: "17 + 4",
      purpose: "check",
      visibility: "public",
      actorId: HERO
    });
    expect(typedRoll.status).toBe(409);
    const thrown = await post(base, GAME_PATHS.rolls, player, {
      commandId: randomUUID(),
      formula: "1d20 + 4",
      purpose: "check",
      visibility: "public",
      actorId: HERO
    });
    expect(thrown.status).toBe(200);
  });

  it("puts a player's typed initiative die behind the same setting", async () => {
    const state = fight();
    state.combat = { ...state.combat, pendingInitiative: [HERO] };
    const { base, gmToken, player } = await boot(state);
    await closeTypedDice(base, gmToken);
    const typed = await post(base, GAME_PATHS.initiativeRollSelf, player, {
      commandId: randomUUID(),
      actorId: HERO,
      natural: 20
    });
    expect(typed.status).toBe(409);
    expect(
      (await post(base, GAME_PATHS.initiativeRollSelf, player, { commandId: randomUUID(), actorId: HERO })).status
    ).toBe(200);
  });
});

describe("totals, when the table asks for them (ADR-0043)", () => {
  const askForTotals = (base: string, gmToken: string) =>
    post(base, GAME_PATHS.playerDice, gmToken, { commandId: randomUUID(), d20: "total" });

  it("turns a player's attack total back into the face, and refuses one the bonus can't reach or a bare face", async () => {
    const { base, gmToken, player } = await boot(fight());
    expect((await askForTotals(base, gmToken)).status).toBe(200);
    const resolve = (extra: Record<string, unknown>) =>
      post(base, GAME_PATHS.actionResolve, player, {
        commandId: randomUUID(),
        actorId: HERO,
        actionId: "swing",
        targetIds: [FOE],
        commit: false,
        ...extra
      });
    const faced = await resolve({ attackNatural: 14 });
    expect(faced.status).toBe(409);
    expect((await faced.json()).error.message).toBe("At this table you type the total, with the bonus included.");
    const unreachable = await resolve({ attackRolledTotal: 26 });
    expect(unreachable.status).toBe(409);
    expect((await unreachable.json()).error.message).toBe("A d20 + 5 total is 6 to 25. Check the total you typed.");
    const typed = await resolve({ attackRolledTotal: 19 });
    expect((await typed.json()).data.resolution.attack).toMatchObject({ naturalRoll: 14, total: 19 });
  });

  it("takes a death save's total and still throws Bless's d4 on top", async () => {
    const { base, server, gmToken, player } = await boot(dying());
    await askForTotals(base, gmToken);
    const path = GAME_PATHS.deathSaveRoll.replace("{actorId}", HERO);
    const answer = await post(base, path, player, {
      commandId: randomUUID(),
      actorId: HERO,
      commit: false,
      rolledTotal: 12
    });
    const deathSave = (await answer.json()).data.deathSave;
    expect(deathSave.naturalRoll).toBe(12);
    expect(deathSave.total - 12).toBeGreaterThanOrEqual(1);
    expect(deathSave.total - 12).toBeLessThanOrEqual(4);
    expect(server.store.snapshot.rolls.at(-1)?.typed).toBe(true);
  });

  it("scores a typed initiative total as typed, and lets an encounter ask for faces instead", async () => {
    const state = fight();
    const crypt = SceneSchema.parse({ id: randomUUID(), name: "Crypt", mapAssetId: randomUUID() });
    state.combat = { ...state.combat, pendingInitiative: [HERO], encounters: [crypt] };
    const { base, server, gmToken, player } = await boot(state);
    await askForTotals(base, gmToken);
    const bonus = server.store.snapshot.actors.find((actor) => actor.id === HERO)?.initiative ?? 0;
    expect(
      (
        await post(base, GAME_PATHS.initiativeRollSelf, player, {
          commandId: randomUUID(),
          actorId: HERO,
          rolledTotal: 9 + bonus
        })
      ).status
    ).toBe(200);
    expect(server.store.snapshot.combat.initiative.find((entry) => entry.actorId === HERO)?.score).toBe(9 + bonus);

    // An encounter's own mode wins over the table's, and players read the one that applies.
    const view = async () => (await (await fetch(base + "/api/v1/game", { headers: bearer(player) })).json()).data.game;
    expect((await view()).playerDice).toEqual({ d20: "total", damage: "app" });
    const encounterId = server.store.snapshot.combat.encounters[0]!.id;
    expect(
      (
        await post(base, GAME_PATHS.scenePlayerDice.replace("{encounterId}", encounterId), player, {
          commandId: randomUUID(),
          playerDice: { d20: "die" }
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post(base, GAME_PATHS.scenePlayerDice.replace("{encounterId}", encounterId), gmToken, {
          commandId: randomUUID(),
          playerDice: { d20: "die" }
        })
      ).status
    ).toBe(200);
    // Parked, it changes nothing; live, it applies.
    expect((await view()).playerDice).toEqual({ d20: "total", damage: "app" });
    const live = {
      ...server.store.snapshot,
      combat: { ...server.store.snapshot.combat, activeEncounterId: encounterId }
    };
    expect(effectivePlayerDice(live)).toEqual({ d20: "die", damage: "app" });
    expect(JSON.stringify(await view())).not.toContain('"encounters"');
  });
});

describe("the free dice roller", () => {
  it("marks a player's roll for their character as a free roll, on the record and in the feed", async () => {
    const { base, server, gmToken, player } = await boot(fight());
    const roll = (token: string, label: string) =>
      post(base, GAME_PATHS.rolls, token, {
        commandId: randomUUID(),
        formula: "1d20 + 30",
        purpose: "check",
        visibility: "public",
        label,
        actorId: HERO
      });
    expect((await roll(player, "Stealth")).status).toBe(200);
    expect((await roll(gmToken, "Stealth for Hero")).status).toBe(200);
    const [mine, gms] = server.store.snapshot.rolls.slice(-2);
    expect(mine).toMatchObject({ actorId: HERO, purpose: "check", label: "Stealth", free: true });
    expect(gms?.free).toBeUndefined();
    const feed = (
      (await (await fetch(base + GAME_PATHS.log, { headers: bearer(gmToken) })).json()).data.entries as ReadonlyArray<{
        text: string;
      }>
    ).map((entry) => entry.text);
    expect(feed).toContainEqual(
      expect.stringMatching(/^Hero rolled \d+ on Stealth \(1d20\+30\) with the free dice roller\.$/)
    );
  });
});

describe("a player's damage, when the table has players type it (ADR-0043)", () => {
  const swingAndConfirm = async (base: string, player: string) => {
    const resolve = (commit: boolean) =>
      post(base, GAME_PATHS.actionResolve, player, {
        commandId: randomUUID(),
        actorId: HERO,
        actionId: "swing",
        targetIds: [FOE],
        commit,
        ...(commit ? {} : { attackNatural: 15 })
      });
    expect((await resolve(false)).status).toBe(200);
    expect((await resolve(true)).status).toBe(200);
  };

  it("waits for the player's total, checks it against the dice, and leaves the hit for the GM", async () => {
    const { base, server, gmToken, player } = await boot(fight());
    await post(base, GAME_PATHS.playerDice, gmToken, { commandId: randomUUID(), damage: "total" });
    await swingAndConfirm(base, player);
    const [roll] = server.store.snapshot.combat.damageRolls;
    expect(roll).toMatchObject({ formula: "1d8 + 3", dice: [{ count: 1, sides: 8 }], fixed: 3, mode: "total" });
    const [proposal] = server.store.snapshot.combat.pendingDamage;
    expect(proposal?.awaitingRoll).toBe(roll!.id);

    // The player reads what to roll, and nothing of the proposal waiting on it.
    const view = (await (await fetch(base + "/api/v1/game", { headers: bearer(player) })).json()).data.game;
    expect(view.combat.damageRolls).toEqual([
      {
        id: roll!.id,
        sourceActorId: HERO,
        actionName: "Longsword",
        formula: "1d8 + 3",
        dice: [{ count: 1, sides: 8 }],
        fixed: 3,
        mode: "total"
      }
    ]);
    expect(JSON.stringify(view)).not.toContain("awaitingRoll");

    const report = (body: Record<string, unknown>) =>
      post(base, GAME_PATHS.damageReport, player, { commandId: randomUUID(), rollId: roll!.id, ...body });
    const unreachable = await report({ total: 20 });
    expect(unreachable.status).toBe(409);
    expect((await unreachable.json()).error.message).toBe("1d8 + 3 comes to 4 to 11. Check the total you typed.");
    expect((await report({ faces: [5] })).status).toBe(409);
    expect((await report({ total: 9 })).status).toBe(200);
    expect(server.store.snapshot.combat.damageRolls).toEqual([]);
    expect(server.store.snapshot.combat.pendingDamage[0]).toMatchObject({ proposedTotal: 9 });
    expect(server.store.snapshot.combat.pendingDamage[0]?.awaitingRoll).toBeUndefined();
    expect(server.store.snapshot.actors.find((actor) => actor.id === FOE)?.hp.current).toBe(30);
  });

  it("applies a direct table's hit once each die is in", async () => {
    const { base, server, gmToken, player } = await boot(fight());
    await post(base, GAME_PATHS.playerDice, gmToken, { commandId: randomUUID(), damage: "die" });
    await post(base, GAME_PATHS.playerDamageMode, gmToken, { commandId: randomUUID(), mode: "direct" });
    await swingAndConfirm(base, player);
    expect(server.store.snapshot.actors.find((actor) => actor.id === FOE)?.hp.current).toBe(30);
    const [roll] = server.store.snapshot.combat.damageRolls;
    const wrongDie = await post(base, GAME_PATHS.damageReport, player, {
      commandId: randomUUID(),
      rollId: roll!.id,
      faces: [9]
    });
    expect((await wrongDie.json()).error.message).toBe("A d8 shows 1 to 8. Check die 1.");
    expect(
      (await post(base, GAME_PATHS.damageReport, player, { commandId: randomUUID(), rollId: roll!.id, faces: [5] }))
        .status
    ).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === FOE)?.hp.current).toBe(22);
    expect(server.store.snapshot.combat.pendingDamage).toEqual([]);
  });
});

describe("a save whose damage waits for the caster's roll", () => {
  it("takes no confirm until the caster's player reports, then deals the reported damage", async () => {
    const rollId = randomUUID();
    const saveId = randomUUID();
    const state = fight();
    state.combat = {
      ...state.combat,
      pendingSaves: [
        PendingSaveSchema.parse({
          id: saveId,
          targetActorId: FOE,
          ability: "dex",
          dc: 13,
          sourceActorId: HERO,
          sourceName: "Hero",
          actionName: "Burning Hands",
          proposedDamage: 10,
          proposedDamageParts: [{ amount: 10, type: "fire" }],
          damageRollId: rollId,
          createdAt: 1
        })
      ],
      damageRolls: [
        DamageRollSchema.parse({
          id: rollId,
          sourceActorId: HERO,
          sourceName: "Hero",
          actionName: "Burning Hands",
          formula: "3d6",
          dice: [{ count: 3, sides: 6 }],
          fixed: 0,
          mode: "total",
          saveIds: [saveId],
          createdAt: 1
        })
      ]
    };
    const { base, server, gmToken, player } = await boot(state);
    const confirm = () =>
      post(base, GAME_PATHS.saveAnswer.replace("{saveId}", saveId), gmToken, {
        commandId: randomUUID(),
        saveId,
        method: "roll",
        face: 2,
        commit: true
      });
    const waiting = await confirm();
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).error.message).toBe("Hero's damage roll isn't in yet.");
    expect(
      (await post(base, GAME_PATHS.damageReport, player, { commandId: randomUUID(), rollId, total: 16 })).status
    ).toBe(200);
    expect(server.store.snapshot.combat.pendingSaves[0]).toMatchObject({ proposedDamage: 16 });
    expect((await confirm()).status).toBe(200);
    expect(server.store.snapshot.actors.find((actor) => actor.id === FOE)?.hp.current).toBe(14);
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { needsSettling, settleFalls, startFall, staysAloft, type FallDeps } from "../src/falling.js";
import { answerReaction } from "../src/reactions.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";

// SRD 5.2.1 Falling, Flying and Hover: a fall deals 1d6 Bludgeoning for every 10 feet to 20d6 and leaves the creature
// Prone unless it took no damage; water can halve it; a flier that is Prone, Incapacitated or at a Fly Speed of 0
// falls unless it hovers; Feather Fall and Slow Fall answer a fall with a Reaction.

const HERO = "10000000-0000-4000-8000-0000000000b1";
const MAGE = "10000000-0000-4000-8000-0000000000b2";
const HARPY = "10000000-0000-4000-8000-0000000000b3";
const MONK = "10000000-0000-4000-8000-0000000000b4";

const statBlock = (speeds: Record<string, unknown>, actions: unknown[] = []) =>
  ({
    actions,
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    token: { disposition: "friendly" },
    extensions: { "open5e.srd-2024": { speeds } }
  }) as unknown as ActorDefinition;
const FEATHER_FALL = {
  id: "feather-fall",
  name: "Feather Fall",
  activation: "reaction",
  description: "When you or a creature you can see within 60 feet of you falls, you slow the fall.",
  damage: [],
  reaction: { trigger: "falls", response: "cast-on-faller", rangeFeet: 60 },
  grants: {
    name: "Feather Fall",
    tags: ["feather-fall"],
    target: "targets",
    duration: { type: "rounds", rounds: 10 },
    modifiers: [],
    onEnd: [],
    voidWhileIncapacitated: false,
    concentration: false
  }
};
const SLOW_FALL = {
  id: "slow-fall",
  name: "Slow Fall",
  activation: "reaction",
  description: "When you fall, reduce the damage by five times your Monk level.",
  damage: [],
  reaction: { trigger: "falls", response: "reduce-fall-damage", perLevel: 5, classId: "monk" }
};
const DEFINITIONS: Record<string, ActorDefinition> = {
  walker: statBlock({ walk: 30 }),
  mage: statBlock({ walk: 30 }, [FEATHER_FALL]),
  harpy: statBlock({ walk: 20, fly: 40 }),
  hoverer: statBlock({ walk: 20, fly: 40, hover: true }),
  monk: {
    ...statBlock({ walk: 40 }, [SLOW_FALL]),
    character: { classes: [{ id: "monk", name: "Monk", level: 5 }], features: [] }
  } as unknown as ActorDefinition
};
const resolveDefinition = (id: string) => DEFINITIONS[id];

function game(heights: Readonly<Record<string, { altitudeFeet?: number; airborne?: "fly" | "levitate" }>> = {}) {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character", definitionId: "walker", at: cell(0, 0) },
    { id: MAGE, name: "Mirena", kind: "player-character", definitionId: "mage", at: cell(2, 0) },
    { id: HARPY, name: "Harpy", kind: "monster", definitionId: "harpy", at: cell(4, 0) },
    { id: MONK, name: "Kesh", kind: "player-character", definitionId: "monk", at: cell(6, 0) }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map(({ at: _at, ...actor }) => ({
      ...actor,
      visibility: "public",
      speedFeet: 30,
      hp: { current: 100, maximum: 100 }
    })),
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors.map((actor) => ({
        actorId: actor.id,
        position: actor.at,
        sizePx: 40,
        sizeCells: 1,
        ...(heights[actor.id] ?? {})
      }))
    }
  });
}

let ids = 0;
const deps = (state: GameState, faces: number[] = [4]): FallDeps => {
  let next = 0;
  return {
    resolveDefinition,
    random: () => faces[next++ % faces.length]!,
    newId: () => `90000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    now: () => new Date(0).toISOString(),
    distanceFeet: (a, b) => {
      const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position!;
      return (Math.abs(at(a).x - at(b).x) / 50) * 5;
    }
  };
};
const hp = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!.hp.current;
const prone = (state: GameState, id: string) =>
  state.actors.find((actor) => actor.id === id)!.conditions.some((condition) => condition.id === "prone");
const height = (state: GameState, id: string) =>
  state.combat.tokens.find((token) => token.actorId === id)!.altitudeFeet ?? 0;

describe("a fall", () => {
  it("deals 1d6 Bludgeoning for every 10 feet and leaves the creature Prone on the ground", () => {
    const state = game({ [HERO]: { altitudeFeet: 45 } });
    state.combat.active = false;
    const events = startFall(state, { actorId: HERO, feet: 45 }, deps(state));
    expect(hp(state, HERO)).toBe(100 - 16);
    expect(prone(state, HERO)).toBe(true);
    expect(height(state, HERO)).toBe(0);
    expect(events[0]?.text).toBe("Borin falls 45 ft and takes 16 Bludgeoning damage (4d6: 16) and lands Prone.");
  });

  it("rolls no more than 20d6, and nothing for a drop under 10 feet", () => {
    const state = game();
    state.combat.active = false;
    startFall(state, { actorId: HERO, feet: 400 }, deps(state, [1]));
    expect(hp(state, HERO)).toBe(80);
    const short = game();
    short.combat.active = false;
    startFall(short, { actorId: HERO, feet: 5 }, deps(short));
    expect(hp(short, HERO)).toBe(100);
    expect(prone(short, HERO)).toBe(false);
  });

  it("halves the damage when a check made with the Reaction hits the water well", () => {
    const state = game();
    state.actors.find((actor) => actor.id === MAGE)!.definitionId = "walker";
    // The check's d20 rolls 20; the four fall dice roll 6.
    startFall(state, { actorId: HERO, feet: 40, intoWater: true }, deps(state, [6, 6, 6, 6, 20]));
    expect(hp(state, HERO)).toBe(100 - 12);
    expect(state.combat.reactionsUsed).toContain(HERO);
  });

  it("lands a creature with a Ring of Feather Falling unharmed", () => {
    const library = new ContentLibrary().forAudience("gm");
    const state = game();
    state.combat.active = false;
    state.actors.find((actor) => actor.id === HERO)!.inventory = [
      InventoryItemSchema.parse({
        id: "ring-of-feather-falling",
        name: "Ring of Feather Falling",
        quantity: 1,
        equipped: true,
        attuned: true,
        category: library.equipmentRecord("ring-of-feather-falling")!.category
      })
    ];
    startFall(state, { actorId: HERO, feet: 60 }, { ...deps(state), catalog: equipmentCatalogOf(library) });
    expect(hp(state, HERO)).toBe(100);
    expect(prone(state, HERO)).toBe(false);
  });
});

describe("staying in the air", () => {
  it("drops a Prone flier that can't hover, and keeps one that can", () => {
    const state = game({ [HARPY]: { altitudeFeet: 30, airborne: "fly" } });
    const harpy = state.actors.find((actor) => actor.id === HARPY)!;
    expect(staysAloft(harpy, { resolveDefinition })).toBe(true);
    harpy.conditions = [{ id: "prone" }];
    expect(needsSettling(state, { resolveDefinition })).toBe(true);
    harpy.definitionId = "hoverer";
    expect(needsSettling(state, { resolveDefinition })).toBe(false);
  });

  it("drops a creature left in the air with nothing to fly with, and lowers a levitation that ended", () => {
    const state = game({
      [HERO]: { altitudeFeet: 20, airborne: "fly" },
      [MONK]: { altitudeFeet: 15, airborne: "levitate" }
    });
    state.combat.active = false;
    const events = settleFalls(state, deps(state, [3]));
    expect(hp(state, HERO)).toBe(94);
    expect(height(state, HERO)).toBe(0);
    expect(height(state, MONK)).toBe(0);
    expect(hp(state, MONK)).toBe(100);
    expect(events.map((event) => event.text)).toContain("Kesh floats gently to the ground.");
  });
});

describe("reactions to a fall", () => {
  const answer = (state: GameState, reactionId: string, use: boolean) =>
    answerReaction(
      state,
      randomUUID(),
      reactionId,
      use,
      undefined,
      { role: "gm" },
      {
        resolveDefinition,
        random: () => 4,
        newRollId: () => randomUUID(),
        gmSessionId: "00000000-0000-4000-8000-000000000000",
        now: () => new Date(0).toISOString()
      }
    );

  it("offers Feather Fall to a caster that sees the faller, and its cast lands the faller unharmed", () => {
    const state = game({ [HERO]: { altitudeFeet: 50 } });
    startFall(state, { actorId: HERO, feet: 50 }, deps(state));
    expect(state.combat.pendingReactions).toMatchObject([
      { kind: "falls", actorId: MAGE, actionId: "feather-fall", targetActorId: HERO, fallFeet: 50 }
    ]);
    expect(hp(state, HERO)).toBe(100);
    const outcome = answer(state, state.combat.pendingReactions[0]!.id, true);
    expect(outcome.used).toBe(true);
    expect(hp(state, HERO)).toBe(100);
    expect(prone(state, HERO)).toBe(false);
    expect(height(state, HERO)).toBe(0);
    expect(state.combat.reactionsUsed).toContain(MAGE);
    expect(state.combat.pendingFalls).toEqual([]);
  });

  it("rolls the fall once the caster declines", () => {
    const state = game({ [HERO]: { altitudeFeet: 30 } });
    startFall(state, { actorId: HERO, feet: 30 }, deps(state));
    answer(state, state.combat.pendingReactions[0]!.id, false);
    expect(hp(state, HERO)).toBe(88);
    expect(prone(state, HERO)).toBe(true);
  });

  it("takes five times the Monk's level off with Slow Fall", () => {
    const state = game({ [MONK]: { altitudeFeet: 60 } });
    state.actors.find((actor) => actor.id === MAGE)!.definitionId = "walker";
    startFall(state, { actorId: MONK, feet: 60 }, deps(state, [5]));
    expect(state.combat.pendingReactions).toMatchObject([{ kind: "falls", actorId: MONK, actionId: "slow-fall" }]);
    answer(state, state.combat.pendingReactions[0]!.id, true);
    // 6d6 at 4 each is 24, less 25: no damage, so no Prone either.
    expect(hp(state, MONK)).toBe(100);
    expect(prone(state, MONK)).toBe(false);
  });

  it("lets Feather Fall end on the creature that landed", () => {
    const state = game({ [HERO]: { altitudeFeet: 20 } });
    state.combat.active = false;
    addEffect(
      state,
      HERO,
      makeEffect({
        id: "ff",
        name: "Feather Fall",
        tags: ["feather-fall"],
        duration: { type: "rounds", remaining: 10 }
      })
    );
    startFall(state, { actorId: HERO, feet: 20 }, deps(state));
    expect(hp(state, HERO)).toBe(100);
    expect(state.actors.find((actor) => actor.id === HERO)!.effects).toEqual([]);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("falls on the live table", () => {
  it("rolls a GM's fall, refuses a player's, and drops a walker the GM put in the air", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30 },
        { id: HARPY, name: "Harpy", kind: "monster", speedFeet: 20 }
      ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 100, maximum: 100 } }))
    });
    const { server, gmToken, startFight, post } = await bootMovementServer(state, cleanups);
    await startFight([HERO, HARPY], { [HERO]: cell(1, 1), [HARPY]: cell(5, 5) });
    const refused = await post(GAME_PATHS.actorFall.replace("{actorId}", HERO), server.auth.issuePlayerSession(), {
      actorId: HERO,
      feet: 30
    });
    expect(refused.status).toBe(403);
    const fell = await post(GAME_PATHS.actorFall.replace("{actorId}", HERO), gmToken, { actorId: HERO, feet: 30 });
    expect(fell.status, await fell.clone().text()).toBe(200);
    const after = server.store.snapshot.actors.find((actor) => actor.id === HERO)!;
    expect(after.hp.current).toBeLessThan(100);
    expect(after.conditions.map((condition) => condition.id)).toContain("prone");
    // A walker put in the air falls as the command commits.
    const lifted = await post(GAME_PATHS.tokenAltitude.replace("{actorId}", HARPY), gmToken, {
      actorId: HARPY,
      altitudeFeet: 40,
      airborne: "fly"
    });
    expect(lifted.status).toBe(200);
    const harpyToken = server.store.snapshot.combat.tokens.find((token) => token.actorId === HARPY)!;
    expect(harpyToken.altitudeFeet).toBeUndefined();
    expect(server.store.snapshot.actors.find((actor) => actor.id === HARPY)!.hp.current).toBeLessThan(100);
  });
});

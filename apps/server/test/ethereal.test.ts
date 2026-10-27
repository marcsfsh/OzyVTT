import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { RulesBlockedError } from "../src/game-store.js";
import { activeTeleportGrant } from "../src/granted-moves.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { withMonsterSpells } from "../src/monster-spells.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { mapDistance } from "../src/movement-narration.js";
import { blinkAway, settlePlanes } from "../src/off-plane.js";
import { movementCost } from "../src/terrain.js";
import { hiddenFrom, playerSight } from "../src/vision/audience.js";
import { catalog } from "./spell-casters.js";
import { cell, DIVIDER, FRIEND, GEOMETRY, GOBLIN, HERO, ORC, SESSION_A, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 the Border Ethereal (Etherealness, Blink, a ghost's Etherealness, a phase spider's Ethereal Jaunt): the
// creature keeps its token on the map, unseen from the Material Plane but by a sense that sees into the Ethereal Plane,
// out of reach of the creatures there, moving through walls and creatures, and back where its token stands, shunted
// with Force damage from a filled space.

const spells = loadSpells();
const monsters = loadMonsterDefinitions();
const spell = (id: string) => spells.find((entry) => entry.id === id)!;
const resolveDefinition = (id: string) => monsters.find((monster) => monster.source.externalId === id);
let ids = 0;
const newId = () => `60000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";
const deps = {
  random: () => 10,
  newRollId: newId,
  gmSessionId: "30000000-0000-4000-8000-00000000000a",
  now: NOW,
  resolveDefinition,
  catalog
};
const fallDeps = { resolveDefinition, random: () => 1, newId, now: NOW };

const ethereal = (state: GameState, actorId: string, tags: readonly string[] = ["ethereal"]) =>
  addEffect(
    state,
    actorId,
    makeEffect({ id: `ethereal-${actorId}`, name: "Etherealness", tags: [...tags], duration: { type: "manual" } })
  );
const token = (state: GameState, actorId: string) => state.combat.tokens.find((entry) => entry.actorId === actorId)!;
const place = (state: GameState, actorId: string, at: { x: number; y: number }) => {
  state.combat.tokens = state.combat.tokens.map((entry) =>
    entry.actorId === actorId ? { ...entry, position: at } : entry
  );
};
const actor = (state: GameState, actorId: string) => state.actors.find((entry) => entry.id === actorId)!;
const sees = (feet: number, sense: "truesight" | "see-invisibility") =>
  makeEffect({
    id: `sense-${sense}`,
    name: sense,
    tags: [],
    duration: { type: "manual" },
    modifiers: [{ type: "sense", sense, feet }]
  });

function move(state: GameState, actorId: string, to: { x: number; y: number }, extra: object = {}) {
  return applyMovementRules(state, {
    actorId,
    from: token(state, actorId).position,
    to,
    distance: (a, b) => mapDistance(GEOMETRY, a, b)?.value ?? null,
    cost: (a, b, options) => movementCost(state, GEOMETRY, actorId, a, b, options),
    calibration: GEOMETRY.calibration,
    override: null,
    resolveDefinition,
    newPromptId: newId,
    now: () => 0,
    commandId: newId(),
    ...extra
  });
}

describe("a creature on the Border Ethereal", () => {
  it("keeps its token where it stands, hidden from a player who can't see into the Ethereal Plane", () => {
    const state = visionGame({ enabled: false });
    ethereal(state, GOBLIN);
    expect(settlePlanes(state, GEOMETRY).map((event) => event.text)).toEqual([
      "Skulking Goblin fades into the Border Ethereal."
    ]);
    expect(token(state, GOBLIN).position).toEqual(cell(8, 5));
    expect(hiddenFrom(state, {}, SESSION_A)(GOBLIN)).toBe(true);
    addEffect(state, HERO, sees(0, "see-invisibility"));
    expect(hiddenFrom(state, {}, SESSION_A)(GOBLIN)).toBe(false);
  });

  it("is seen by Truesight within its range on a scene with dynamic vision", () => {
    const state = visionGame();
    ethereal(state, GOBLIN);
    settlePlanes(state, GEOMETRY);
    expect(playerSight(state, SESSION_A, {}).hidden.has(GOBLIN)).toBe(true);
    addEffect(state, HERO, sees(30, "truesight"));
    expect(playerSight(state, SESSION_A, {}).hidden.has(GOBLIN)).toBe(true);
    endEffect(state, HERO, "sense-truesight");
    addEffect(state, HERO, sees(60, "truesight"));
    expect(playerSight(state, SESSION_A, {}).hidden.has(GOBLIN)).toBe(false);
  });

  it("stays seen from the Material Plane when it is a ghost's", () => {
    const state = visionGame({ enabled: false });
    ethereal(state, GOBLIN, ["ethereal", "seen-across-planes"]);
    settlePlanes(state, GEOMETRY);
    expect(hiddenFrom(state, {}, SESSION_A)(GOBLIN)).toBe(false);
  });

  it("gives the ghost's cast of Etherealness the tag that shows it across the planes", () => {
    const ghost = withMonsterSpells(resolveDefinition("ghost")!, (id) => spell(id));
    const cast = ghost.actions.find((action) => action.id === "etherealness")!;
    expect(cast.grants?.tags).toEqual(expect.arrayContaining(["ethereal", "seen-across-planes"]));
  });

  it("can't be struck by a sword from the Material Plane", () => {
    const state = visionGame({ enabled: false });
    place(state, GOBLIN, cell(2, 5));
    ethereal(state, GOBLIN);
    const sword: ActorAction = {
      id: "longsword",
      name: "Longsword",
      activation: "action",
      description: "",
      attack: { bonus: 5, reachFeet: 5 },
      damage: [{ formula: "1d8", type: "slashing" }]
    };
    expect(() =>
      resolveDefinitionAction(state, sword, { actorId: HERO, targetIds: [GOBLIN], commandId: newId() }, deps)
    ).toThrow("That creature is gone from this plane for now and can't be targeted.");
  });

  it("moves 30 feet through a wall and through another creature's space", () => {
    const state = visionGame({ walls: [DIVIDER()], positions: { [GOBLIN]: cell(4, 5), [ORC]: cell(5, 5) } });
    state.combat.turnActorId = GOBLIN;
    ethereal(state, GOBLIN);
    move(state, GOBLIN, cell(10, 5));
    expect(state.combat.turn.movementUsedFeet).toBe(30);
    const solid = visionGame({ walls: [DIVIDER()], positions: { [GOBLIN]: cell(4, 5) } });
    solid.combat.turnActorId = GOBLIN;
    expect(() => move(solid, GOBLIN, cell(6, 5))).toThrowError(RulesBlockedError);
  });

  it("may rise as it moves, each foot up costing an extra foot", () => {
    const state = visionGame({ positions: { [GOBLIN]: cell(4, 5) } });
    state.combat.turnActorId = GOBLIN;
    ethereal(state, GOBLIN);
    move(state, GOBLIN, cell(5, 5), { fromAltitudeFeet: 0, toAltitudeFeet: 10 });
    expect(state.combat.turn.movementUsedFeet).toBe(20);
  });

  it("provokes no Opportunity Attack from the creatures it leaves on the Material Plane", () => {
    const state = visionGame({ enabled: false, positions: { [GOBLIN]: cell(2, 5) } });
    state.combat.turnActorId = GOBLIN;
    ethereal(state, GOBLIN);
    expect(move(state, GOBLIN, cell(6, 5)).prompts).toEqual([]);
  });

  it("returns where its token stands, and is shunted from a filled space with 2 Force damage a foot", () => {
    const state = visionGame({ enabled: false, actors: { [GOBLIN]: { hp: { current: 30, maximum: 30 } } } });
    ethereal(state, GOBLIN, ["ethereal", "ethereal-shunt"]);
    settlePlanes(state, GEOMETRY, fallDeps);
    place(state, GOBLIN, cell(3, 5));
    place(state, ORC, cell(3, 5));
    endEffect(state, GOBLIN, `ethereal-${GOBLIN}`);
    expect(settlePlanes(state, GEOMETRY, fallDeps).map((event) => event.text)).toEqual([
      "Skulking Goblin returns from the Border Ethereal into a filled space and is shunted 5 ft to the nearest unoccupied one.",
      "Skulking Goblin takes 10 Force damage from the shunt."
    ]);
    const back = token(state, GOBLIN).position!;
    expect(Math.max(Math.abs(back.x - cell(3, 5).x), Math.abs(back.y - cell(3, 5).y))).toBe(50);
    expect(actor(state, GOBLIN).hp.current).toBe(20);
    expect(state.combat.offPlane).toEqual([]);
  });
});

describe("Blink", () => {
  it("leaves the caster's token on the map and lets it teleport to a seen space within 10 feet as it returns", () => {
    const state = visionGame({ enabled: false });
    addEffect(
      state,
      HERO,
      makeEffect({ id: "blink", name: "Blink", tags: ["blink"], duration: { type: "rounds", remaining: 10 } })
    );
    blinkAway(state, HERO, () => 5, newId, []);
    settlePlanes(state, GEOMETRY, fallDeps);
    expect(token(state, HERO).position).toEqual(cell(1, 5));
    const away = actor(state, HERO).effects.find((effect) => effect.name === "Ethereal (Blink)")!;
    endEffect(state, HERO, away.id);
    settlePlanes(state, GEOMETRY, fallDeps);
    expect(activeTeleportGrant(state, actor(state, HERO))).toMatchObject({ name: "Blink", feet: 10 });
    expect(() => move(state, HERO, cell(4, 5), { mode: "teleport", byPlayer: true })).toThrowError(
      "Borin can teleport up to 10 ft, and that space is 15 ft away."
    );
    move(state, HERO, cell(3, 5), { mode: "teleport", byPlayer: true });
    expect(activeTeleportGrant(state, actor(state, HERO))).toBeNull();
  });
});

describe("Etherealness from a higher slot", () => {
  const cast = (): ActorAction => ({
    id: "spell-etherealness",
    name: "Etherealness",
    activation: "action",
    description: "",
    spellId: "etherealness",
    spellSlot: { level: 7 },
    ...spellCastMechanics(spell("etherealness"), { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 4 })
  });
  const caster = (state: GameState) => {
    actor(state, HERO).spellSlots = [{ level: 8, remaining: 1 }];
  };
  const distanceFeet = (a: string, b: string) => {
    const state = current!;
    const at = (id: string) => token(state, id).position!;
    return (mapDistance(GEOMETRY, at(a), at(b))?.value ?? 0) as number;
  };
  let current: GameState | null = null;

  it("takes the caster and two willing creatures within 10 feet with a level 8 slot", () => {
    const state = visionGame({ enabled: false, positions: { [FRIEND]: cell(2, 5), [ORC]: cell(1, 6) } });
    current = state;
    caster(state);
    actor(state, ORC).kind = "player-character";
    resolveDefinitionAction(
      state,
      cast(),
      { actorId: HERO, targetIds: [FRIEND, ORC], commandId: newId(), slotLevel: 8 },
      { ...deps, distanceFeet }
    );
    for (const id of [HERO, FRIEND, ORC])
      expect(actor(state, id).effects.find((effect) => effect.name === "Etherealness")?.tags).toEqual([
        "ethereal",
        "ethereal-shunt"
      ]);
  });

  it("refuses a creature 15 feet away, and a third companion", () => {
    const far = visionGame({ enabled: false, positions: { [FRIEND]: cell(4, 5) } });
    current = far;
    caster(far);
    expect(() =>
      resolveDefinitionAction(
        far,
        cast(),
        { actorId: HERO, targetIds: [FRIEND], commandId: newId(), slotLevel: 8 },
        { ...deps, distanceFeet }
      )
    ).toThrow("Mirena is 15 ft away, and Etherealness's other creatures must be within 10 ft of Borin.");
    const crowd = visionGame({
      enabled: false,
      positions: { [FRIEND]: cell(2, 5), [ORC]: cell(1, 6), [GOBLIN]: cell(0, 5) }
    });
    current = crowd;
    caster(crowd);
    for (const id of [ORC, GOBLIN]) actor(crowd, id).kind = "player-character";
    expect(() =>
      resolveDefinitionAction(
        crowd,
        cast(),
        { actorId: HERO, targetIds: [FRIEND, ORC, GOBLIN], commandId: newId(), slotLevel: 8 },
        { ...deps, distanceFeet }
      )
    ).toThrow("Etherealness targets up to 3 creatures with a level 8 slot; 4 were chosen.");
  });
});

describe("a nightmare's Ethereal Stride", () => {
  const stride = () => resolveDefinition("nightmare")!.actions.find((action) => action.id === "ethereal-stride")!;
  const steed = () => {
    const state = visionGame({ enabled: false, positions: { [GOBLIN]: cell(2, 5), [ORC]: cell(3, 5) } });
    actor(state, GOBLIN).definitionId = "nightmare";
    state.combat.turnActorId = GOBLIN;
    return state;
  };

  it("takes the nightmare and a willing creature within 5 feet, and the next stride brings the nightmare back", () => {
    const state = steed();
    resolveDefinitionAction(state, stride(), { actorId: GOBLIN, targetIds: [ORC], commandId: newId() }, deps);
    expect(actor(state, GOBLIN).effects.some((effect) => effect.tags.includes("ethereal"))).toBe(true);
    expect(actor(state, ORC).effects.some((effect) => effect.tags.includes("ethereal"))).toBe(true);
    state.combat.turn = { ...state.combat.turn, actionUsed: false };
    resolveDefinitionAction(state, stride(), { actorId: GOBLIN, targetIds: [], commandId: newId() }, deps);
    expect(actor(state, GOBLIN).effects.some((effect) => effect.tags.includes("ethereal"))).toBe(false);
  });

  it("refuses to take an unwilling creature along", () => {
    const state = steed();
    place(state, HERO, cell(1, 5));
    expect(() =>
      resolveDefinitionAction(state, stride(), { actorId: GOBLIN, targetIds: [HERO], commandId: newId() }, deps)
    ).toThrowError(RulesBlockedError);
  });
});

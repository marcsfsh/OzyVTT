import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState, VisionWall } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { RulesBlockedError } from "../src/game-store.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { mapDistance } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import { burrowsThroughWalls, fireFormBurns, openingPassage, stopsOnlyInEnemySpace } from "../src/wall-passage.js";
import { catalog, fight, FOE, HERO as HERO_CASTER } from "./spell-casters.js";
import { cell, GEOMETRY, GOBLIN, HERO, ORC, visionGame, wall } from "./vision-fixtures.js";
import { clericAt } from "./zone-fixtures.js";

// SRD 5.2.1 traits that let a creature past walls and into other creatures' spaces: Amorphous and Compression ("as
// narrow as 1 inch"), a swarm's Tiny openings, Earth Glide and Tunneler burrowing through walls, Air Form and Water
// Form stopping only in an enemy's space, and Fire Form burning the creatures whose spaces it enters.

const monsters = loadMonsterDefinitions();
const statBlock = (id: string) => monsters.find((monster) => monster.source.externalId === id)!;
const resolveDefinition = (id: string) => monsters.find((monster) => monster.source.externalId === id);

let prompts = 0;

/** A wall across the map at x = 250 with a gap of `gapPx` pixels centred on y = 275 (row 5's middle). */
function gapped(gapPx: number): VisionWall[] {
  return [
    wall({ x: 250, y: 0 }, { x: 250, y: 275 - gapPx / 2 }),
    wall({ x: 250, y: 275 + gapPx / 2 }, { x: 250, y: 600 })
  ];
}

/** The goblin's token wears this stat block, on its turn at `at`; with `large`, a 2x2 token. */
function mover(state: GameState, id: string, at = cell(4, 5), large = false) {
  const goblin = state.actors.find((actor) => actor.id === GOBLIN)!;
  goblin.definitionId = id;
  goblin.size = statBlock(id).size as typeof goblin.size;
  goblin.speedFeet = 40;
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === GOBLIN ? { ...token, position: at, ...(large ? { sizeCells: 2 } : {}) } : token
  );
  state.combat.turnActorId = GOBLIN;
}

/** A Large token's place: its centre on the grid corner between columns c-1 and c, rows 5 and 6. */
const corner = (column: number) => ({ x: 50 * column, y: 300 });

function move(state: GameState, to: { x: number; y: number }, mode: "walk" | "burrow" = "walk") {
  const from = state.combat.tokens.find((token) => token.actorId === GOBLIN)!.position!;
  return applyMovementRules(state, {
    actorId: GOBLIN,
    from,
    to,
    mode,
    distance: (a, b) => mapDistance(GEOMETRY, a, b)?.value ?? null,
    cost: (a, b, options) => movementCost(state, GEOMETRY, GOBLIN, a, b, options),
    calibration: GEOMETRY.calibration,
    override: null,
    resolveDefinition,
    newPromptId: () => `70000000-0000-4000-8000-${String(++prompts).padStart(12, "0")}`,
    now: () => 0,
    commandId: `71000000-0000-4000-8000-${String(prompts).padStart(12, "0")}`
  });
}

describe("slipping through a narrow gap", () => {
  it("reads the traits from the stat blocks", () => {
    expect(openingPassage(statBlock("black-pudding"))).toBe("point");
    expect(openingPassage(statBlock("octopus"))).toBe("point");
    expect(openingPassage(statBlock("air-elemental"))).toBe("point");
    expect(openingPassage(statBlock("swarm-of-rats"))).toBe("tiny");
    expect(openingPassage(statBlock("ogre"))).toBeNull();
  });

  it("lets a Large black pudding pass walls 2 feet apart with no extra movement, where an ogre squeezes", () => {
    // Three squares east, across the gap.
    const pudding = visionGame({ walls: gapped(20) });
    mover(pudding, "black-pudding", corner(4), true);
    move(pudding, corner(7));
    expect(pudding.combat.turn.movementUsedFeet).toBe(15);

    const ogre = visionGame({ walls: gapped(20) });
    mover(ogre, "ogre", corner(4), true);
    move(ogre, corner(7));
    expect(ogre.combat.turn.movementUsedFeet).toBe(25);
  });

  it("stops a Large black pudding at a wall with no gap", () => {
    const state = visionGame({ walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 })] });
    mover(state, "black-pudding", corner(4), true);
    expect(() => move(state, corner(7))).toThrowError(RulesBlockedError);
  });

  it("stops the octopus at a closed door", () => {
    const shut = visionGame({ walls: [...gapped(50), wall({ x: 250, y: 250 }, { x: 250, y: 300 }, "door", false)] });
    mover(shut, "octopus");
    expect(() => move(shut, cell(6, 5))).toThrowError(RulesBlockedError);
  });

  it("lets a Large swarm through a gap a Tiny creature fits with no extra movement, and squeeze where it doesn't", () => {
    const wide = visionGame({ walls: gapped(30) });
    mover(wide, "swarm-of-rats", corner(4), true);
    move(wide, corner(7));
    expect(wide.combat.turn.movementUsedFeet).toBe(15);
    const narrow = visionGame({ walls: gapped(10) });
    mover(narrow, "swarm-of-rats", corner(4), true);
    move(narrow, corner(7));
    expect(narrow.combat.turn.movementUsedFeet).toBe(25);
  });
});

describe("burrowing through walls", () => {
  const solid = () => [wall({ x: 250, y: 0 }, { x: 250, y: 600 })];

  it("Earth Glide: a xorn burrows through a wall at its normal cost and can't walk through it", () => {
    expect(burrowsThroughWalls(statBlock("xorn"))).toBe("free");
    const burrow = visionGame({ walls: solid() });
    mover(burrow, "xorn");
    move(burrow, cell(6, 5), "burrow");
    expect(burrow.combat.turn.movementUsedFeet).toBe(10);
    const walk = visionGame({ walls: solid() });
    mover(walk, "xorn");
    expect(() => move(walk, cell(6, 5))).toThrowError(RulesBlockedError);
  });

  it("Tunneler: a purple worm pays double for the step through solid rock", () => {
    expect(burrowsThroughWalls(statBlock("purple-worm"))).toBe("half");
    const state = visionGame({ walls: solid() });
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === GOBLIN ? { ...token, sizeCells: 1 } : token
    );
    mover(state, "purple-worm");
    move(state, cell(6, 5), "burrow");
    expect(state.combat.turn.movementUsedFeet).toBe(15);
  });

  it("can't burrow through a wall a spell raised", () => {
    const spellWall = {
      ...wall({ x: 250, y: 0 }, { x: 250, y: 600 }, "window"),
      source: { casterId: HERO, spellId: "wall-of-force" }
    };
    const state = visionGame({ walls: [spellWall] });
    mover(state, "xorn");
    expect(() => move(state, cell(6, 5), "burrow")).toThrowError(RulesBlockedError);
  });
});

describe("ending a move in another creature's space", () => {
  it("lets the invisible stalker stop only in an enemy's space, and the air elemental in any creature's", () => {
    expect(stopsOnlyInEnemySpace(statBlock("invisible-stalker"))).toBe(true);
    expect(stopsOnlyInEnemySpace(statBlock("water-elemental"))).toBe(true);
    expect(stopsOnlyInEnemySpace(statBlock("air-elemental"))).toBe(false);
    // Borin is the stalker's enemy; the orc is another monster on its side.
    const onEnemy = visionGame({ positions: { [HERO]: cell(6, 5), [ORC]: cell(6, 7) } });
    mover(onEnemy, "invisible-stalker");
    move(onEnemy, cell(6, 5));
    const onAlly = visionGame({ positions: { [HERO]: cell(6, 5), [ORC]: cell(6, 7) } });
    mover(onAlly, "invisible-stalker");
    expect(() => move(onAlly, cell(6, 7))).toThrowError(RulesBlockedError);
    const elemental = visionGame({ positions: { [HERO]: cell(6, 5), [ORC]: cell(6, 7) } });
    mover(elemental, "air-elemental");
    move(elemental, cell(6, 7));
  });
});

describe("Swarm", () => {
  it("regains no hit points from Cure Wounds", () => {
    // SRD Swarm: "The swarm can't regain Hit Points or gain Temporary Hit Points."
    const definition = clericAt(5, ["cure-wounds"]);
    const caster = fight(definition);
    const swarm = caster.state.actors.find((actor) => actor.id === FOE)!;
    swarm.definitionId = "swarm-of-rats";
    swarm.hp = { current: 5, maximum: 24, temporary: 0 };
    const resolution = resolveDefinitionAction(
      caster.state,
      caster.action("spell-cure-wounds"),
      { actorId: HERO_CASTER, targetIds: [FOE], commandId: "cmd-swarm-heal" },
      {
        random: () => 6,
        newRollId: () => "40000000-0000-4000-8000-000000000099",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-19T00:00:00.000Z",
        definition,
        catalog,
        resolveDefinition
      }
    );
    expect(swarm.hp.current).toBe(5);
    expect(resolution.tableNarration?.map((line) => line.text)).toContain(
      "Goblin is a swarm and can't regain hit points or gain Temporary Hit Points."
    );
  });
});

describe("Fire Form", () => {
  it("burns each creature whose space it enters once a turn", () => {
    const state = visionGame({ positions: { [HERO]: cell(5, 5), [ORC]: cell(6, 5) } });
    mover(state, "fire-elemental");
    const elemental = state.actors.find((actor) => actor.id === GOBLIN)!;
    const deps = { resolveDefinition, rollDie: () => 7, squarePx: 50 };
    const path = [cell(4, 5), cell(5, 5), cell(6, 5), cell(7, 5)];
    const events = fireFormBurns(state, elemental, path, deps);
    expect(events.filter((event) => event.kind === "damage").map((event) => event.text)).toEqual([
      "Borin takes 7 Fire damage from Skulking Goblin's Fire Form.",
      "Orc takes 7 Fire damage from Skulking Goblin's Fire Form."
    ]);
    expect(state.actors.find((actor) => actor.id === HERO)!.hp.current).toBe(3);
    // Back through Borin on the same turn: nothing more.
    expect(fireFormBurns(state, elemental, [cell(7, 5), cell(5, 5)], deps)).toEqual([]);
  });
});

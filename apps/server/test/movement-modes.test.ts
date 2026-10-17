import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { MoveMode } from "@vtt/domain/commands";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { RulesBlockedError } from "../src/game-store.js";
import { addEffect, makeEffect, releaseGrapplesOutOfRange } from "../src/effects.js";
import { applyMovementRules, dragAlong, dragCostsExtra, grappledBy, movementStatus } from "../src/movement-rules.js";
import { creatureDistance, mapDistance, tokenCreatureDistance } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";

// SRD 5.2.1 Movement on the map: special speeds and switching between them, crawling, climbing and swimming without
// the speed, teleportation and forced movement, moving through and stopping in other creatures' spaces, Opportunity
// Attacks along the way, and dragging a grappled creature.

const HERO = "10000000-0000-4000-8000-000000000001";
const DRAGON = "10000000-0000-4000-8000-000000000002";
const ORC = "10000000-0000-4000-8000-000000000003";
const GUARD = "10000000-0000-4000-8000-000000000004";
const RANGER = "10000000-0000-4000-8000-000000000005";
const RAT = "10000000-0000-4000-8000-000000000006";

/** 50px cells, 5 ft each: cell (c,r) centre = (25 + 50c, 25 + 50r). */
const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

const statBlock = (speeds: Record<string, unknown>, disposition: "hostile" | "friendly" | "neutral" = "hostile") =>
  ({
    actions: [],
    token: { disposition },
    extensions: { "open5e.srd-2024": { speeds } }
  }) as unknown as ActorDefinition;
const DEFINITIONS: Record<string, ActorDefinition> = {
  dragon: statBlock({ walk: 40, fly: 80 }),
  orc: statBlock({ walk: 30 }),
  "hostile-guard": statBlock({ walk: 30 }, "hostile"),
  "friendly-guard": statBlock({ walk: 30 }, "friendly"),
  ranger: {
    actions: [],
    token: { disposition: "friendly" },
    extensions: {},
    character: { features: [{ id: "roving", kind: "class", sourceId: "ranger" }] }
  } as unknown as ActorDefinition,
  ...Object.fromEntries(
    ["Flyby", "Agile", "Abduct", "Swarm", "Air Form"].map((trait) => [
      trait,
      {
        actions: [],
        token: { disposition: "hostile" },
        extensions: {
          "open5e.srd-2024": { speeds: { walk: 30, fly: 60 }, traits: [{ name: trait, description: "." }] }
        }
      } as unknown as ActorDefinition
    ])
  )
};

function game(
  positions: Readonly<Record<string, { x: number; y: number }>>,
  options: { turn?: string; guard?: "hostile-guard" | "friendly-guard" } = {}
): GameState {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30 },
    { id: DRAGON, name: "Red Dragon", kind: "monster", speedFeet: 40, definitionId: "dragon" },
    { id: ORC, name: "Orc", kind: "monster", speedFeet: 30, definitionId: "orc" },
    { id: GUARD, name: "Guard", kind: "npc", speedFeet: 30, definitionId: options.guard ?? "hostile-guard" },
    { id: RANGER, name: "Kesh", kind: "player-character", speedFeet: 30, definitionId: "ranger" },
    { id: RAT, name: "Rat", kind: "monster", size: "tiny", speedFeet: 20, definitionId: "orc" }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 10, maximum: 10 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: options.turn ?? HERO,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors
        .filter((actor) => positions[actor.id] !== undefined)
        .map((actor) => ({ actorId: actor.id, position: positions[actor.id], sizePx: 40, sizeCells: 1 }))
    }
  });
}

const resolveDefinition = (definitionId: string) => DEFINITIONS[definitionId];
let prompts = 0;

function move(
  state: GameState,
  actorId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: Readonly<{
    mode?: MoveMode;
    byPlayer?: boolean;
    override?: { reason?: string; families?: ["movement"] };
    dragging?: { actorIds: readonly string[]; costsExtra: boolean };
  }> = {}
) {
  return applyMovementRules(state, {
    actorId,
    from,
    to,
    ...(options.mode ? { mode: options.mode } : {}),
    byPlayer: options.byPlayer ?? false,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    cost: (a, b, costOptions) => movementCost(state, GRID, actorId, a, b, costOptions),
    creatureDistance: (enemy, point) =>
      creatureDistance(
        GRID,
        { position: enemy.position, sizeCells: 1, sizePx: 40 },
        { position: point, sizeCells: 1, sizePx: 40 }
      )?.value ?? null,
    calibration: GRID.calibration,
    ...(options.dragging ? { dragging: options.dragging } : {}),
    override: options.override ?? null,
    resolveDefinition,
    newPromptId: () => `70000000-0000-4000-8000-${String(++prompts).padStart(12, "0")}`,
    now: () => 0,
    commandId: "50000000-0000-4000-8000-000000000001"
  });
}

const used = (state: GameState) => state.combat.turn.movementUsedFeet;
const blockedBy = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    if (error instanceof RulesBlockedError) return error.rule;
    throw error;
  }
  return "nothing";
};

describe("special speeds", () => {
  it("flies on a Fly Speed, and a switch takes off what was already moved", () => {
    const state = game({ [DRAGON]: cell(0, 0) }, { turn: DRAGON });
    // Walking is held to its Speed of 40...
    expect(blockedBy(() => move(state, DRAGON, cell(0, 0), cell(10, 0)))).toBe("movement.exceeds-speed");
    // ...but having walked 20 it can fly 60 more of its 80 (SRD: "subtract the distance already moved").
    move(state, DRAGON, cell(0, 0), cell(4, 0));
    move(state, DRAGON, cell(4, 0), cell(16, 0), { mode: "fly" });
    expect(used(state)).toBe(80);
    expect(blockedBy(() => move(state, DRAGON, cell(16, 0), cell(17, 0), { mode: "fly" }))).toBe(
      "movement.exceeds-speed"
    );
  });

  it("has no Fly Speed to fly with, and says so", () => {
    const state = game({ [HERO]: cell(0, 0) });
    expect(() => move(state, HERO, cell(0, 0), cell(2, 0), { mode: "fly" })).toThrowError("Borin has no Fly Speed.");
  });

  it("climbs and swims at an extra foot per foot without the speed, and not with Roving's", () => {
    const state = game({ [HERO]: cell(0, 0) });
    move(state, HERO, cell(0, 0), cell(2, 0), { mode: "climb" });
    expect(used(state)).toBe(20);
    expect(() => move(state, HERO, cell(2, 0), cell(4, 0), { mode: "swim" })).toThrowError(
      "Borin has 10 ft of movement left (this move needs 20 ft, swimming without the speed)."
    );
    const ranger = game({ [RANGER]: cell(0, 0) }, { turn: RANGER });
    move(ranger, RANGER, cell(0, 0), cell(2, 0), { mode: "climb" });
    move(ranger, RANGER, cell(2, 0), cell(4, 0), { mode: "swim" });
    expect(used(ranger)).toBe(20);
  });

  it("reports each way it can move, with its budget", () => {
    const state = game({ [DRAGON]: cell(0, 0) }, { turn: DRAGON });
    expect(movementStatus(state, DRAGON, { resolveDefinition }).modes).toEqual([
      { mode: "walk", budgetFeet: 40, extraCost: false },
      { mode: "fly", budgetFeet: 80, extraCost: false },
      { mode: "swim", budgetFeet: 40, extraCost: true },
      { mode: "climb", budgetFeet: 40, extraCost: true }
    ]);
  });
});

describe("speeds a spell or an item grants", () => {
  const library = new ContentLibrary().forAudience("gm");
  const catalog = equipmentCatalogOf(library);
  /** The effect a cast leaves (its modifiers as the bundle authors them), on Borin. */
  const cast = (state: GameState, spellId: string) => {
    const grant = library.spellRecord(spellId)!.effect!.grant!;
    addEffect(
      state,
      HERO,
      makeEffect({
        id: `cast-${spellId}`,
        name: grant.name!,
        tags: grant.tags,
        duration: { type: "manual" },
        modifiers: grant.modifiers
      })
    );
  };

  it("flies 60 feet under Fly, and hovers", () => {
    const state = game({ [HERO]: cell(0, 0) });
    cast(state, "fly");
    expect(movementStatus(state, HERO, { resolveDefinition }).modes).toContainEqual({
      mode: "fly",
      budgetFeet: 60,
      extraCost: false
    });
    move(state, HERO, cell(0, 0), cell(12, 0), { mode: "fly" });
    expect(used(state)).toBe(60);
  });

  it("climbs at its Speed under Spider Climb, Longstrider's 10 feet included", () => {
    const state = game({ [HERO]: cell(0, 0) });
    cast(state, "spider-climb");
    cast(state, "longstrider");
    expect(movementStatus(state, HERO, { resolveDefinition }).modes).toContainEqual({
      mode: "climb",
      budgetFeet: 40,
      extraCost: false
    });
    move(state, HERO, cell(0, 0), cell(8, 0), { mode: "climb" });
    expect(used(state)).toBe(40);
  });

  it("swims 40 feet with a Ring of Swimming on, and not once it comes off", () => {
    const state = game({ [HERO]: cell(0, 0) });
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    const ring = InventoryItemSchema.parse({
      id: "ring-of-swimming",
      name: "Ring of Swimming",
      quantity: 1,
      equipped: true,
      attuned: false,
      category: library.equipmentRecord("ring-of-swimming")!.category
    });
    hero.inventory = [ring];
    expect(movementStatus(state, HERO, { resolveDefinition, catalog }).modes).toContainEqual({
      mode: "swim",
      budgetFeet: 40,
      extraCost: false
    });
    hero.inventory = [{ ...ring, equipped: false }];
    expect(movementStatus(state, HERO, { resolveDefinition, catalog }).modes).toContainEqual({
      mode: "swim",
      budgetFeet: 30,
      extraCost: true
    });
  });
});

describe("crawling", () => {
  it("costs an extra foot per foot while Prone", () => {
    const state = game({ [HERO]: cell(0, 0) });
    state.actors.find((actor) => actor.id === HERO)!.conditions = [{ id: "prone" }];
    expect(movementStatus(state, HERO, { resolveDefinition }).crawling).toBe(true);
    const outcome = move(state, HERO, cell(0, 0), cell(2, 0));
    expect(outcome.crawled).toBe(true);
    expect(used(state)).toBe(20);
    expect(() => move(state, HERO, cell(2, 0), cell(4, 0))).toThrowError(
      "Borin has 10 ft of movement left (this move needs 20 ft, crawling)."
    );
  });
});

describe("teleportation and forced movement", () => {
  it("teleports without spending movement or provoking, and a player's teleport needs the GM's go-ahead", () => {
    const state = game({ [HERO]: cell(1, 0), [ORC]: cell(0, 0) });
    const gm = move(state, HERO, cell(1, 0), cell(10, 0), { mode: "teleport" });
    expect(gm.prompts).toEqual([]);
    expect(used(state)).toBe(0);
    expect(blockedBy(() => move(state, HERO, cell(1, 0), cell(10, 0), { mode: "teleport", byPlayer: true }))).toBe(
      "movement.teleport"
    );
    const allowed = move(state, HERO, cell(1, 0), cell(10, 0), {
      mode: "teleport",
      byPlayer: true,
      override: { families: ["movement"] }
    });
    expect(allowed.overridden).toBe("GM override");
    expect(used(state)).toBe(0);
  });

  it("moves a creature by force with no cost and no Opportunity Attack", () => {
    const state = game({ [HERO]: cell(1, 0), [ORC]: cell(0, 0) });
    expect(move(state, HERO, cell(1, 0), cell(12, 0), { mode: "forced" }).prompts).toEqual([]);
    expect(used(state)).toBe(0);
  });
});

describe("when and where a creature may move", () => {
  it("asks the GM for a player's move off their turn, and leaves the GM's free", () => {
    const state = game({ [HERO]: cell(0, 0), [RANGER]: cell(5, 5) });
    expect(blockedBy(() => move(state, RANGER, cell(5, 5), cell(6, 5), { byPlayer: true }))).toBe("movement.off-turn");
    move(state, RANGER, cell(5, 5), cell(6, 5));
    expect(used(state)).toBe(0);
  });

  it("won't end a move in another creature's space, an ally's included", () => {
    const state = game({ [HERO]: cell(0, 0), [RANGER]: cell(2, 0) });
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(2, 0)))).toBe("movement.occupied");
    move(state, HERO, cell(0, 0), cell(3, 0));
    expect(used(state)).toBe(15);
  });

  it("can't get past an enemy holding a corridor, and is told so", () => {
    const state = game({ [HERO]: cell(0, 0), [ORC]: cell(2, 0) });
    const corridor: TokenMapGeometry = { ...GRID, height: 50 };
    expect(() =>
      applyMovementRules(state, {
        actorId: HERO,
        from: cell(0, 0),
        to: cell(4, 0),
        distance: (a, b) => mapDistance(corridor, a, b)?.value ?? null,
        cost: (a, b, costOptions) => movementCost(state, corridor, HERO, a, b, costOptions),
        calibration: corridor.calibration,
        override: null,
        resolveDefinition,
        newPromptId: () => "70000000-0000-4000-8000-000000000001",
        now: () => 0,
        commandId: "50000000-0000-4000-8000-000000000001"
      })
    ).toThrowError("Borin can't get there - other creatures bar the way.");
  });
});

describe("opportunity attacks along the way", () => {
  it("provokes when the path leaves an enemy's reach, though the move starts and ends out of it", () => {
    // The orc stands one cell below the line Borin runs along: within 5 feet only as he passes it.
    const state = game({ [HERO]: cell(0, 0), [ORC]: cell(3, 1) });
    const outcome = move(state, HERO, cell(0, 0), cell(6, 0));
    expect(outcome.prompts).toEqual([{ actorId: ORC, name: "Orc" }]);
  });

  it("takes sides as attacks do: a hostile guard strikes, a friendly one lets the hero go", () => {
    const hostile = game({ [HERO]: cell(0, 0), [GUARD]: cell(1, 0) }, { guard: "hostile-guard" });
    expect(move(hostile, HERO, cell(0, 0), cell(0, 4)).prompts).toEqual([{ actorId: GUARD, name: "Guard" }]);
    const friendly = game({ [HERO]: cell(0, 0), [GUARD]: cell(1, 0) }, { guard: "friendly-guard" });
    expect(move(friendly, HERO, cell(0, 0), cell(0, 4)).prompts).toEqual([]);
  });
});

describe("dragging a grappled creature", () => {
  const grapple = (state: GameState, grapplerId: string, heldId: string) =>
    addEffect(
      state,
      heldId,
      makeEffect({
        id: `grapple-${heldId}`,
        name: "Grappled",
        tags: ["grapple"],
        sourceActorId: grapplerId,
        duration: { type: "manual" },
        linkedConditionIds: ["grappled"]
      })
    );

  it("brings it along at an extra foot per foot, and the grapple holds", () => {
    const state = game({ [HERO]: cell(1, 1), [ORC]: cell(2, 1) });
    grapple(state, HERO, ORC);
    const held = grappledBy(state, HERO);
    expect(held).toEqual([ORC]);
    expect(movementStatus(state, HERO, { resolveDefinition }).dragging).toBe(true);
    move(state, HERO, cell(1, 1), cell(1, 4), {
      dragging: { actorIds: held, costsExtra: dragCostsExtra(state, HERO, held) }
    });
    expect(used(state)).toBe(30);
    state.combat = {
      ...state.combat,
      tokens: state.combat.tokens.map((token) => (token.actorId === HERO ? { ...token, position: cell(1, 4) } : token))
    };
    expect(dragAlong(state, held, cell(1, 1), cell(1, 4), GRID)).toEqual([ORC]);
    expect(state.combat.tokens.find((token) => token.actorId === ORC)?.position).toEqual(cell(2, 4));
    expect(
      releaseGrapplesOutOfRange(state, HERO, (a, b) => tokenCreatureDistance(state, GRID, a, b)?.value ?? null)
    ).toEqual([]);
    expect(state.actors.find((actor) => actor.id === ORC)!.conditions.map((condition) => condition.id)).toEqual([
      "grappled"
    ]);
  });

  it("costs nothing extra to drag a Tiny creature", () => {
    const state = game({ [HERO]: cell(1, 1), [RAT]: cell(2, 1) });
    grapple(state, HERO, RAT);
    expect(dragCostsExtra(state, HERO, [RAT])).toBe(false);
    expect(dragCostsExtra(state, HERO, [ORC])).toBe(true);
  });
});

describe("stat-block traits that change how a creature moves", () => {
  /** The orc, given a stat block with one trait, moves on its own turn. */
  const withTrait = (trait: string, positions: Readonly<Record<string, { x: number; y: number }>>) => {
    const state = game(positions, { turn: ORC });
    state.actors.find((actor) => actor.id === ORC)!.definitionId = trait;
    return state;
  };

  it("lets a Flyby creature fly out of an enemy's reach without provoking, but not walk out", () => {
    const flying = withTrait("Flyby", { [HERO]: cell(0, 0), [ORC]: cell(1, 0) });
    expect(move(flying, ORC, cell(1, 0), cell(4, 0), { mode: "fly" }).prompts).toEqual([]);
    const walking = withTrait("Flyby", { [HERO]: cell(0, 0), [ORC]: cell(1, 0) });
    expect(move(walking, ORC, cell(1, 0), cell(4, 0)).prompts.map((prompt) => prompt.actorId)).toEqual([HERO]);
  });

  it("lets an Agile creature move out of reach without provoking at all", () => {
    const state = withTrait("Agile", { [HERO]: cell(0, 0), [ORC]: cell(1, 0) });
    expect(move(state, ORC, cell(1, 0), cell(4, 0)).prompts).toEqual([]);
  });

  it("lets a bugbear move what it grapples at no extra cost (Abduct)", () => {
    const state = withTrait("Abduct", { [HERO]: cell(0, 0), [ORC]: cell(1, 0) });
    expect(dragCostsExtra(state, ORC, [HERO], resolveDefinition)).toBe(false);
    expect(dragCostsExtra(state, ORC, [HERO])).toBe(true);
  });

  it("lets an air elemental stop in a creature's space, and anyone stop in a swarm's", () => {
    const air = withTrait("Air Form", { [HERO]: cell(3, 0), [ORC]: cell(1, 0) });
    expect(() => move(air, ORC, cell(1, 0), cell(3, 0))).not.toThrow();
    const plain = game({ [HERO]: cell(3, 0), [ORC]: cell(1, 0) }, { turn: ORC });
    expect(blockedBy(() => move(plain, ORC, cell(1, 0), cell(3, 0)))).toBe("movement.occupied");
    const swarm = game({ [HERO]: cell(0, 0), [ORC]: cell(3, 0) });
    swarm.actors.find((actor) => actor.id === ORC)!.definitionId = "Swarm";
    expect(() => move(swarm, HERO, cell(0, 0), cell(3, 0))).not.toThrow();
  });
});

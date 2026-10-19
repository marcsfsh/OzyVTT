import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave } from "../src/saving-throws.js";
import { endOfTurn } from "../src/turn-boundaries.js";
import { RulesBlockedError } from "../src/game-store.js";
import { pushTokenAway } from "../src/forced-movement.js";
import { dragCostsExtra } from "../src/movement-rules.js";
import { moveEncounterToken, type TokenMapGeometry } from "../src/token-placement.js";

// SRD 5.2.1 swallows: a behir's, a kraken's and a tarrasque's on a failed save, a giant toad's and a giant frog's with
// none. The swallowed creature leaves the grapple, has Total Cover from outside, takes the acid, and comes out when the
// swallower dies, fails to hold on after damage from inside, or (a frog) disgorges it.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000801",
  hero: "10000000-0000-4000-8000-000000000802",
  ally: "10000000-0000-4000-8000-000000000803",
  map: "20000000-0000-5000-8000-000000000801",
  gm: "30000000-0000-4000-8000-00000000080a"
};
const GM = { role: "gm" } as const;

const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 120 },
  actions: [
    {
      id: "dagger",
      name: "Dagger",
      activation: "action",
      description: "A stab.",
      attack: { bonus: 6, reachFeet: 5 },
      damage: [{ formula: "1d4", type: "piercing" }]
    }
  ],
  extensions: {}
} as unknown as ActorDefinition;

/** The swallower `slug` on its turn, the hero (grappled by it) and an ally. */
function table(slug: string, heroSize = "medium") {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        hp: { current: 300, maximum: 300 },
        armorClass: 15,
        speedFeet: 30,
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 120, maximum: 120 },
        armorClass: 12,
        speedFeet: 30,
        size: heroSize,
        definitionId: "hero-def"
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "player-character",
        hp: { current: 50, maximum: 50 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero-def"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  grapple(state, IDS.hero);
  return { state, definition };
}
type Table = ReturnType<typeof table>;

/** The swallower holds `targetId` in a grapple, as its Bite or Tentacle leaves it. */
function grapple(state: GameState, targetId: string) {
  addEffect(
    state,
    targetId,
    makeEffect({
      id: `grapple-${targetId}`,
      name: "Grappled",
      tags: ["grapple"],
      sourceActorId: IDS.monster,
      sourceName: "Swallower",
      duration: { type: "manual" },
      linkedConditionIds: ["grappled"],
      escapeDc: 15
    })
  );
}

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";
const resolveDefinition = (built: Table) => (id: string) =>
  id === "hero-def" ? heroDefinition : built.state.definitions.find((entry) => entry.id === id)?.definition;
const actor = (built: Table, id: string) => built.state.actors.find((candidate) => candidate.id === id)!;
const conditions = (built: Table, id: string) =>
  actor(built, id)
    .conditions.map((condition) => condition.id)
    .sort();

function resolve(
  built: Table,
  actorId: string,
  action: ActorAction,
  targetIds: string[],
  extra: Readonly<{ faces?: number[]; areaPlaced?: boolean; onTheGrid?: boolean }> = {}
) {
  const faces = [...(extra.faces ?? [])];
  const grid = extra.onTheGrid ? { pushToken: pushTokenOn(built.state) } : {};
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId, targetIds, commandId: nextId(), ...(extra.areaPlaced ? { areaPlaced: true } : {}) },
    {
      random: () => faces.shift() ?? 3,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition: actorId === IDS.monster ? built.definition : heroDefinition,
      resolveDefinition: resolveDefinition(built),
      ...grid
    }
  );
}

const GRID = {
  width: 900,
  height: 600,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
} as const satisfies TokenMapGeometry;
const cell = (column: number, row: number) => ({ x: (column + 0.5) * 50, y: (row + 0.5) * 50 });
const pushTokenOn = (state: GameState) => (input: Parameters<typeof pushTokenAway>[1]) =>
  pushTokenAway(state, input, GRID);
const columnOf = (built: Table, actorId: string) =>
  Math.floor(built.state.combat.tokens.find((token) => token.actorId === actorId)!.position!.x / 50);
const monsterAction = (built: Table, actionId: string) =>
  built.definition.actions.find((entry) => entry.id === actionId)!;
const use = (built: Table, actionId: string, targetId = IDS.hero, faces: number[] = []) =>
  resolve(built, IDS.monster, monsterAction(built, actionId), [targetId], { faces });
/** `targetId`'s open save, answered with a typed total. */
function answer(built: Table, total: number, targetId = IDS.hero) {
  const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === targetId);
  if (!pending) throw new Error("No save is owed.");
  return answerSave(built.state, nextId(), pending.id, "manual", total, true, GM, {
    random: () => 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition: resolveDefinition(built)
  });
}
/** A new turn for `actorId`, its action and Bonus Action back. */
const turnOf = (built: Table, actorId: string) => {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: actorId,
    turn: {
      actionUsed: false,
      bonusActionUsed: false,
      actionInstance: null,
      bonusActionInstance: null,
      turnUses: {},
      movementUsedFeet: 0
    }
  };
};
const endTurn = (built: Table, actorId: string) =>
  endOfTurn(built.state, actorId, [], {
    newId: nextId,
    now: NOW,
    rollDie: () => 3,
    resolveDefinition: resolveDefinition(built)
  });
const hurt = (built: Table, targetId: string, amount: number, sourceActorId: string) =>
  applyDamageDetailed(built.state, targetId, { amount, parts: [{ amount, type: "piercing" }], sourceActorId }, GM, {
    resolveDefinition: resolveDefinition(built),
    newId: nextId,
    now: NOW,
    rollDie: () => 3
  });

describe("a swallow on a failed save", () => {
  it("swallows only a creature the behir grapples, and the grapple gives way to Blinded and Restrained", () => {
    const built = table("behir");
    expect(() => use(built, "swallow", IDS.ally)).toThrow(RulesBlockedError);
    use(built, "swallow");
    answer(built, 5);
    expect(conditions(built, IDS.hero)).toEqual(["blinded", "restrained"]);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      { name: "Swallowed", tags: ["swallowed"], sourceActorId: IDS.monster }
    ]);
  });

  it("holds as many as the stat block says, one for a behir", () => {
    const built = table("behir");
    grapple(built.state, IDS.ally);
    use(built, "swallow");
    answer(built, 5);
    turnOf(built, IDS.monster);
    expect(() => use(built, "swallow", IDS.ally)).toThrow(/can have only one creature swallowed at a time/);
  });

  it("gives the swallowed creature Total Cover from outside, while the behir still reaches it", () => {
    const built = table("behir");
    use(built, "swallow");
    answer(built, 5);
    turnOf(built, IDS.ally);
    expect(() => resolve(built, IDS.ally, heroDefinition.actions[0]!, [IDS.hero])).toThrow(/Total Cover/);
    // An area outside the behir leaves it out.
    const blast = {
      id: "blast",
      name: "Blast",
      activation: "action",
      description: "A blast.",
      save: { ability: "dex", dc: 12, successDamage: "half", failureConditions: [] },
      damage: [{ formula: "2d6", type: "fire" }],
      area: { shape: "sphere", sizeFeet: 20, widthFeet: null }
    } as unknown as ActorAction;
    const blasted = resolve(built, IDS.ally, blast, [IDS.monster, IDS.hero], { areaPlaced: true });
    expect(blasted.warnings?.join(" ")).toMatch(/Hero is swallowed and has Total Cover from Blast, so it is left out/);
    expect(built.state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([IDS.monster]);
  });

  it("makes the behir save after 30 damage from inside in a turn, and a failure lets the creature out Prone", () => {
    const built = table("behir");
    use(built, "swallow");
    answer(built, 5);
    turnOf(built, IDS.hero);
    hurt(built, IDS.monster, 30, IDS.hero);
    endTurn(built, IDS.hero);
    expect(built.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.monster, ability: "con", dc: 14, regurgitates: { withinFeet: 10 } }
    ]);
    answer(built, 5, IDS.monster);
    expect(conditions(built, IDS.hero)).toEqual(["prone"]);
    expect(actor(built, IDS.hero).effects).toEqual([]);
  });

  it("asks no save for damage from outside", () => {
    const built = table("behir");
    use(built, "swallow");
    answer(built, 5);
    turnOf(built, IDS.ally);
    hurt(built, IDS.monster, 40, IDS.ally);
    endTurn(built, IDS.ally);
    expect(built.state.combat.pendingSaves).toEqual([]);
  });

  it("swallows a kraken's target only when it is Large or smaller", () => {
    const built = table("kraken", "huge");
    use(built, "swallow", IDS.hero, [3, 3, 3]);
    answer(built, 5);
    expect(actor(built, IDS.hero).hp.current).toBe(120 - 19);
    expect(actor(built, IDS.hero).effects.map((effect) => effect.tags)).toEqual([["grapple"]]);
  });

  it("keeps a creature the tarrasque swallowed from teleporting", () => {
    const built = table("tarrasque");
    use(built, "swallow");
    answer(built, 5);
    expect(actor(built, IDS.hero).effects[0]?.tags).toEqual(["swallowed", "no-teleport"]);
  });
});

describe("a swallow with no save", () => {
  it("swallows the giant toad's grappled target at once, keeps it from biting, and burns it as its turns end", () => {
    const built = table("giant-toad");
    use(built, "swallow");
    expect(conditions(built, IDS.hero)).toEqual(["blinded", "restrained"]);
    turnOf(built, IDS.monster);
    expect(() => use(built, "bite", IDS.ally)).toThrow(/can't use Bite while it has a creature swallowed/);
    endTurn(built, IDS.monster);
    // 3d6 at three a die.
    expect(actor(built, IDS.hero).hp.current).toBe(111);
    // Its death lets the creature climb out.
    hurt(built, IDS.monster, 300, IDS.ally);
    expect(conditions(built, IDS.hero)).toEqual(["prone"]);
  });

  it("disgorges a giant frog's meal Prone after its acid at the end of the frog's next turn", () => {
    const built = table("giant-frog", "small");
    use(built, "swallow");
    expect(conditions(built, IDS.hero)).toEqual(["blinded", "restrained"]);
    endTurn(built, IDS.monster);
    expect(actor(built, IDS.hero).hp.current).toBe(120);
    built.state.combat = { ...built.state.combat, round: built.state.combat.round + 1 };
    endTurn(built, IDS.monster);
    expect(actor(built, IDS.hero).hp.current).toBe(114);
    expect(conditions(built, IDS.hero)).toEqual(["prone"]);
    expect(actor(built, IDS.hero).effects).toEqual([]);
  });

  it("refuses a target too large for the frog", () => {
    const built = table("giant-frog");
    expect(() => use(built, "swallow")).toThrow(RulesBlockedError);
  });
});

describe("reeling in and holding on", () => {
  it("pulls each creature a roper grapples up to 30 feet toward it", () => {
    const built = table("roper");
    moveEncounterToken(built.state, IDS.monster, cell(1, 2), GRID);
    moveEncounterToken(built.state, IDS.hero, cell(10, 2), GRID);
    moveEncounterToken(built.state, IDS.ally, cell(10, 5), GRID);
    expect(() => resolve(built, IDS.monster, monsterAction(built, "reel"), [IDS.ally], { onTheGrid: true })).toThrow(
      RulesBlockedError
    );
    const reeled = resolve(built, IDS.monster, monsterAction(built, "reel"), [IDS.hero], { onTheGrid: true });
    expect(columnOf(built, IDS.hero)).toBe(4);
    expect(reeled.tableNarration?.map((line) => line.text)).toContain("Reel pulls Hero 30 ft toward Roper.");
  });

  it("pulls only a creature restrained by the ettercap's own Web Strand", () => {
    const built = table("ettercap");
    moveEncounterToken(built.state, IDS.monster, cell(1, 2), GRID);
    moveEncounterToken(built.state, IDS.hero, cell(6, 2), GRID);
    expect(() => resolve(built, IDS.monster, monsterAction(built, "reel"), [IDS.hero], { onTheGrid: true })).toThrow(
      /holds with Web Strand/
    );
    use(built, "web-strand");
    answer(built, 5);
    turnOf(built, IDS.monster);
    resolve(built, IDS.monster, monsterAction(built, "reel"), [IDS.hero], { onTheGrid: true });
    expect(columnOf(built, IDS.hero)).toBe(2);
  });

  it("lets a shambling mound engulf one creature at a time, carried at no extra cost", () => {
    const built = table("shambling-mound");
    use(built, "engulf");
    answer(built, 5);
    expect(conditions(built, IDS.hero)).toEqual(["blinded", "grappled", "restrained"]);
    expect(dragCostsExtra(built.state, IDS.monster, [IDS.hero])).toBe(false);
    turnOf(built, IDS.monster);
    expect(() => use(built, "engulf", IDS.ally)).toThrow(/can hold only one creature with Engulf at a time/);
  });
});

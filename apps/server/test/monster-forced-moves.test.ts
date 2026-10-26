import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { openSpaceBeside, pullIntoSpace, pushTokenAway } from "../src/forced-movement.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { moveEncounterToken, type TokenMapGeometry } from "../src/token-placement.js";
import { actor, conditionsOf, GM, IDS, nextId, NOW, table, use, type Table } from "./monster-table.js";

// SRD 5.2.1 stat-block saves that move their creature: a chain devil's Conjure Infernal Chain pulls a Large or smaller
// creature up to 30 feet toward the devil, a shambling mound's Engulf pulls its target into the mound's space, a
// gelatinous cube's Engulf sets a creature that succeeds outside the cube (or fails it when there is no room), and a
// bulette's Deadly Leap pushes a creature that succeeds 5 feet away.

const GRID = {
  width: 1000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
} as const satisfies TokenMapGeometry;
const cell = (column: number, row: number) => ({ x: (column + 0.5) * 50, y: (row + 0.5) * 50 });

function placed(slug: string, at: Record<string, { x: number; y: number }>): Table {
  const built = table(slug);
  for (const [actorId, point] of Object.entries(at)) moveEncounterToken(built.state, actorId, point, GRID);
  return built;
}
const positionOf = (state: GameState, actorId: string) =>
  state.combat.tokens.find((token) => token.actorId === actorId)!.position;

const deps = (built: Table): SaveAnswerDependencies => ({
  random: () => 3,
  newRollId: nextId,
  sessionId: IDS.gm,
  role: "gm",
  now: NOW,
  resolveDefinition: built.resolveDefinition,
  pushToken: (input) => pushTokenAway(built.state, input, GRID),
  pullInto: (actorId, intoId) => pullIntoSpace(built.state, actorId, intoId, GRID),
  openSpaceBeside: (actorId, besideId, withinFeet) => openSpaceBeside(built.state, actorId, besideId, withinFeet, GRID),
  placeToken: (actorId, point) => moveEncounterToken(built.state, actorId, point, GRID)
});
function answer(built: Table, targetId: string, total: number) {
  const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === targetId)!;
  return answerSave(built.state, nextId(), pending.id, "manual", total, true, GM, deps(built));
}
const texts = (events: ReadonlyArray<{ text: string }>) => events.map((event) => event.text);

describe("Conjure Infernal Chain", () => {
  it("pulls a creature that fails up to 30 feet straight toward the devil", () => {
    const built = placed("chain-devil", { [IDS.monster]: cell(0, 0), [IDS.hero]: cell(10, 0), [IDS.ally]: cell(0, 8) });
    use(built, "conjure-infernal-chain", [IDS.hero]);
    const { events } = answer(built, IDS.hero, 1);
    expect(positionOf(built.state, IDS.hero)).toEqual(cell(4, 0));
    expect(texts(events)).toContain("Hero is pulled 30 ft straight toward Chain Devil.");
    expect(conditionsOf(built, IDS.hero)).toContain("restrained");
  });

  it("stops the pull beside the devil and leaves a creature that succeeds where it is", () => {
    const near = placed("chain-devil", { [IDS.monster]: cell(0, 0), [IDS.hero]: cell(3, 0), [IDS.ally]: cell(0, 8) });
    use(near, "conjure-infernal-chain", [IDS.hero]);
    answer(near, IDS.hero, 1);
    expect(positionOf(near.state, IDS.hero)).toEqual(cell(1, 0));
    const saved = placed("chain-devil", { [IDS.monster]: cell(0, 0), [IDS.hero]: cell(10, 0), [IDS.ally]: cell(0, 8) });
    use(saved, "conjure-infernal-chain", [IDS.hero]);
    answer(saved, IDS.hero, 30);
    expect(positionOf(saved.state, IDS.hero)).toEqual(cell(10, 0));
  });

  it("leaves a creature larger than Large where it is", () => {
    const built = placed("chain-devil", { [IDS.monster]: cell(0, 0), [IDS.hero]: cell(10, 0), [IDS.ally]: cell(0, 8) });
    actor(built, IDS.hero).size = "huge";
    use(built, "conjure-infernal-chain", [IDS.hero]);
    answer(built, IDS.hero, 1);
    expect(positionOf(built.state, IDS.hero)).toEqual(cell(10, 0));
  });
});

describe("a shambling mound's Engulf", () => {
  it("pulls a creature that fails into the mound's space", () => {
    const built = placed("shambling-mound", {
      [IDS.monster]: cell(2, 2),
      [IDS.hero]: cell(3, 2),
      [IDS.ally]: cell(8, 8)
    });
    use(built, "engulf", [IDS.hero]);
    const { events } = answer(built, IDS.hero, 1);
    expect(positionOf(built.state, IDS.hero)).toEqual(positionOf(built.state, IDS.monster));
    expect(texts(events)).toContain("Hero is pulled into Shambling Mound's space.");
    expect(conditionsOf(built, IDS.hero)).toEqual(expect.arrayContaining(["grappled", "blinded", "restrained"]));
  });

  it("leaves a creature that succeeds where it stands", () => {
    const built = placed("shambling-mound", {
      [IDS.monster]: cell(2, 2),
      [IDS.hero]: cell(3, 2),
      [IDS.ally]: cell(8, 8)
    });
    use(built, "engulf", [IDS.hero]);
    answer(built, IDS.hero, 30);
    expect(positionOf(built.state, IDS.hero)).toEqual(cell(3, 2));
  });
});

describe("a gelatinous cube's Engulf", () => {
  /** The cube has moved into the hero's space; the hero now saves. */
  function engulfing(around: Record<string, { x: number; y: number }> = {}) {
    const built = placed("gelatinous-cube", {
      [IDS.monster]: cell(5, 5),
      [IDS.hero]: cell(5, 5),
      [IDS.ally]: cell(12, 12),
      ...around
    });
    built.state.combat = {
      ...built.state.combat,
      pendingSaves: []
    };
    use(built, "engulf", [IDS.hero]);
    return built;
  }

  it("moves a creature that succeeds to an unoccupied space within 5 feet of the cube", () => {
    const built = engulfing();
    const { events } = answer(built, IDS.hero, 30);
    const at = positionOf(built.state, IDS.hero)!;
    expect(at).not.toEqual(cell(5, 5));
    expect(Math.max(Math.abs(at.x - cell(5, 5).x), Math.abs(at.y - cell(5, 5).y))).toBeLessThanOrEqual(50);
    expect(texts(events)).toContain("Hero moves to an unoccupied space within 5 feet of Gelatinous Cube.");
    expect(conditionsOf(built, IDS.hero)).not.toContain("restrained");
  });

  it("fails a creature that succeeds when no unoccupied space is within 5 feet of the cube", () => {
    const built = engulfing();
    // Fill every space round the cube with creatures standing there.
    let filler = 0;
    for (let column = 4; column <= 6; column++)
      for (let row = 4; row <= 6; row++) {
        if (column === 5 && row === 5) continue;
        const id = `10000000-0000-4000-8000-0000000009${String(++filler).padStart(2, "0")}`;
        built.state.actors.push({ ...structuredClone(actor(built, IDS.ally)), id, name: `Filler ${filler}` });
        built.state.combat = {
          ...built.state.combat,
          tokens: [
            ...built.state.combat.tokens,
            { ...structuredClone(built.state.combat.tokens.find((token) => token.actorId === IDS.ally)!), actorId: id }
          ]
        };
        moveEncounterToken(built.state, id, cell(column, row), GRID);
      }
    const { outcome, events } = answer(built, IDS.hero, 30);
    expect(outcome.success).toBe(false);
    expect(positionOf(built.state, IDS.hero)).toEqual(cell(5, 5));
    expect(conditionsOf(built, IDS.hero)).toContain("restrained");
    expect(texts(events)).toContain(
      "Hero has no unoccupied space within 5 feet of Gelatinous Cube and fails the save instead."
    );
  });
});

describe("a bulette's Deadly Leap", () => {
  it("pushes a creature that succeeds 5 feet straight away from the bulette", () => {
    const built = placed("bulette", { [IDS.monster]: cell(2, 2), [IDS.hero]: cell(3, 2), [IDS.ally]: cell(9, 9) });
    use(built, "deadly-leap", [IDS.hero]);
    const { events } = answer(built, IDS.hero, 30);
    expect(positionOf(built.state, IDS.hero)).toEqual(cell(4, 2));
    expect(texts(events)).toContain("Hero is pushed 5 ft straight away from Bulette.");
    expect(conditionsOf(built, IDS.hero)).not.toContain("prone");
  });
});

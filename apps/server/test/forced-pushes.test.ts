import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { pushTokenAway } from "../src/forced-movement.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { moveEncounterToken, type TokenMapGeometry } from "../src/token-placement.js";
import {
  build,
  catalog,
  fight,
  FOE,
  HERO,
  warlockInput,
  wizardInput,
  WIZARD_SPELLS,
  type Fight
} from "./spell-casters.js";

// SRD 5.2.1 forced movement besides the Push mastery: Thunderwave's failed save pushes a creature 10 feet away from the
// caster, and Repelling Blast's hit pushes a Large or smaller creature up to 10 feet straight away.

const GRID = {
  width: 900,
  height: 600,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
} as const satisfies TokenMapGeometry;
const cell = (column: number, row: number) => ({ x: (column + 0.5) * 50, y: (row + 0.5) * 50 });

const wizard = build(wizardInput([...WIZARD_SPELLS]));
const warlock = build(warlockInput([]));

/** The fight with the hero at (2,2) and the goblin beside it at (3,2). */
function onTheGrid(definition: Parameters<typeof fight>[0]): Fight {
  const placed = fight(definition);
  moveEncounterToken(placed.state, HERO, cell(2, 2), GRID);
  moveEncounterToken(placed.state, FOE, cell(3, 2), GRID);
  return placed;
}
const positionOf = (state: GameState, actorId: string) =>
  state.combat.tokens.find((token) => token.actorId === actorId)!.position;

let ids = 0;
const nextId = () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
const saveDeps = (state: GameState, wired = true): SaveAnswerDependencies => ({
  random: () => 10,
  newRollId: nextId,
  sessionId: "30000000-0000-4000-8000-00000000000a",
  role: "gm",
  now: () => "2026-10-17T00:00:00.000Z",
  resolveDefinition: () => undefined,
  catalog,
  ...(wired ? { pushToken: (input) => pushTokenAway(state, input, GRID) } : {})
});
const answer = (state: GameState, total: number, wired = true) =>
  answerSave(
    state,
    nextId(),
    state.combat.pendingSaves.find((save) => save.targetActorId === FOE)!.id,
    "manual",
    total,
    true,
    { role: "gm" },
    saveDeps(state, wired)
  );

describe("Thunderwave", () => {
  it("pushes a creature that fails the save 10 feet straight away from the caster", () => {
    const { state, resolve } = onTheGrid(wizard);
    resolve("spell-thunderwave", {});
    const { events } = answer(state, 1);
    expect(positionOf(state, FOE)).toEqual(cell(5, 2));
    expect(events.map((event) => event.text)).toContain("Goblin is pushed 10 ft straight away from Ansel.");
  });

  it("leaves a creature that succeeds where it stands", () => {
    const { state, resolve } = onTheGrid(wizard);
    resolve("spell-thunderwave", {});
    answer(state, 30);
    expect(positionOf(state, FOE)).toEqual(cell(3, 2));
  });

  it("asks the GM to move the token when the map can't", () => {
    const { state, resolve } = onTheGrid(wizard);
    resolve("spell-thunderwave", {});
    const { events } = answer(state, 1, false);
    expect(positionOf(state, FOE)).toEqual(cell(3, 2));
    expect(events).toContainEqual(
      expect.objectContaining({
        text: "Goblin is pushed 10 feet straight away from Ansel. Move the token.",
        gmOnly: true
      })
    );
  });
});

describe("Repelling Blast", () => {
  const blast = (placed: Fight, faces: number[]) =>
    resolveDefinitionAction(
      placed.state,
      placed.action("spell-eldritch-blast"),
      { actorId: HERO, targetIds: [FOE], commandId: nextId(), pushFeet: 10 },
      {
        random: () => faces.shift() ?? 3,
        newRollId: nextId,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-17T00:00:00.000Z",
        definition: warlock,
        catalog,
        resolveDefinition: () => undefined,
        pushToken: (input) => pushTokenAway(placed.state, input, GRID)
      }
    );

  it("pushes a creature its picked cantrip hits up to 10 feet straight away", () => {
    const placed = onTheGrid(warlock);
    expect(blast(placed, [15, 4]).attack?.outcome).toBe("hit");
    expect(positionOf(placed.state, FOE)).toEqual(cell(5, 2));
  });

  it("pushes nothing on a miss, nor a creature larger than Large", () => {
    const missed = onTheGrid(warlock);
    blast(missed, [2, 4]);
    expect(positionOf(missed.state, FOE)).toEqual(cell(3, 2));
    const huge = onTheGrid(warlock);
    huge.state.actors.find((actor) => actor.id === FOE)!.size = "huge";
    blast(huge, [15, 4]);
    expect(positionOf(huge.state, FOE)).toEqual(cell(3, 2));
  });
});

import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { heldShutAgainst, knockOn } from "../src/doors.js";
import { damageObject, findObject } from "../src/objects.js";
import { fight, FOE, HERO } from "./spell-casters.js";
import { carry, cell, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 Instant Fortress: "cause it to grow rapidly into a square adamantine tower", "Each creature in the area
// where the tower appears is pushed to an unoccupied space outside but next to the tower", "a single door at ground
// level on the side facing you. The door opens only at your command ... It is immune to the Knock spell", "The roof,
// the door, and the walls each have AC 20; HP 100; Immunity to Bludgeoning, Piercing, and Slashing damage", and
// "Repeating the command word causes the tower to revert to statuette form, which works only if the tower is empty."

const GROW = "67000000-0000-4000-8000-0000000000d1";
/** The tower's square, from the corner at cell (10, 10) to the one past cell (13, 13). */
const SQUARE = { shape: "square" as const, origin: { x: 500, y: 500 }, target: { x: 700, y: 700 } };

function fortress() {
  const table = fight(wizardAt(9, []));
  place(table.state, { [HERO]: cell(7, 11), [FOE]: cell(11, 11) });
  table.state.combat.vision = {
    ...table.state.combat.vision,
    enabled: true,
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
  carry(table.state, HERO, "Instant Fortress");
  table.hero.inventory = table.hero.inventory.map((row) =>
    row.name === "Instant Fortress" ? { ...row, equipped: true, attuned: true } : row
  );
  table.resolve("item-instant-fortress-grow", { targetIds: [], commandId: GROW, placedArea: SQUARE });
  return table;
}

const towerOf = (state: GameState) => state.combat.vision.walls.filter((wall) => wall.raisedBy !== undefined);
const doorOf = (state: GameState) => towerOf(state).find((wall) => wall.kind === "door")!;
const fresh = (state: GameState) => {
  state.combat.turn = { ...state.combat.turn, actionUsed: false, actionInstance: null };
};

describe("Instant Fortress", () => {
  it("raises four walls 20 feet on a side, its one door on the side facing its user", () => {
    const { state } = fortress();
    const tower = towerOf(state);
    expect(tower.filter((wall) => wall.kind === "door")).toHaveLength(1);
    // The west side, facing the hero: wall, door, wall.
    expect(doorOf(state).a.x).toBe(500);
    expect(doorOf(state).b.x).toBe(500);
    const xs = tower.flatMap((wall) => [wall.a.x, wall.b.x]);
    const ys = tower.flatMap((wall) => [wall.a.y, wall.b.y]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([500, 700, 500, 700]);
  });

  it("pushes a creature in its square out to a space next to it", () => {
    const { state } = fortress();
    const at = state.combat.tokens.find((token) => token.actorId === FOE)!.position!;
    const inside = at.x > 500 && at.x < 700 && at.y > 500 && at.y < 700;
    expect(inside).toBe(false);
  });

  it("opens its door only for its user, and Knock leaves it shut", () => {
    const { state } = fortress();
    expect(heldShutAgainst(state, doorOf(state), FOE)).toBe("The door opens only at its owner's command.");
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBeNull();
    knockOn(state, doorOf(state).id);
    expect(heldShutAgainst(state, doorOf(state), FOE)).toBe("The door opens only at its owner's command.");
  });

  it("has walls of AC 20 and 100 Hit Points that shrug off Bludgeoning and resist Fire", () => {
    const { state } = fortress();
    const wall = towerOf(state).find((candidate) => candidate.kind === "wall")!;
    expect(findObject(state, { wallId: wall.id })?.stats).toMatchObject({
      armorClass: 20,
      hitPoints: { current: 100, maximum: 100 }
    });
    damageObject(state, { wallId: wall.id }, [{ amount: 40, type: "bludgeoning" }]);
    damageObject(state, { wallId: wall.id }, [{ amount: 40, type: "fire" }]);
    expect(findObject(state, { wallId: wall.id })?.stats.hitPoints.current).toBe(80);
  });

  it("shrinks back only while no creature stands inside", () => {
    const table = fortress();
    place(table.state, { [FOE]: cell(12, 12) });
    fresh(table.state);
    expect(() => table.resolve("item-instant-fortress-shrink", { targetIds: [] })).toThrowError(
      "The tower shrinks only when it is empty."
    );
    place(table.state, { [FOE]: cell(20, 20) });
    table.resolve("item-instant-fortress-shrink", { targetIds: [] });
    expect(towerOf(table.state)).toEqual([]);
  });
});

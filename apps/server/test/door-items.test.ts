import { describe, expect, it } from "vitest";
import type { GameState, VisionWall } from "@vtt/domain";
import { heldShutAgainst, knockOn, useDoor, type DoorUseDeps } from "../src/doors.js";
import { fight, FOE, HERO } from "./spell-casters.js";
import { carry, cell, nextId, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 magic items that work on doors: an Immovable Rod fixed against one (DC 30 to move it), Sovereign Glue and
// Universal Solvent, a Ring of the Ram's Strength check to break one open, and a Wand of Secrets pointing at a secret
// door.

const DOOR = "52000000-0000-4000-8000-0000000000e1";
const GM = { role: "gm" } as const;

/** A door across x = 500 at row 5, in walls above and below; the hero stands west of it, the goblin east. */
function doorway(door: Partial<VisionWall> = {}) {
  const caster = fight(wizardAt(9, []));
  place(caster.state, { [HERO]: cell(9, 5), [FOE]: cell(10, 5) });
  caster.state.combat.vision = {
    ...caster.state.combat.vision,
    enabled: true,
    walls: [
      { id: "52000000-0000-4000-8000-0000000000e2", kind: "wall", a: { x: 500, y: 0 }, b: { x: 500, y: 250 } },
      { id: DOOR, kind: "door", a: { x: 500, y: 250 }, b: { x: 500, y: 300 }, open: false, ...door },
      { id: "52000000-0000-4000-8000-0000000000e3", kind: "wall", a: { x: 500, y: 300 }, b: { x: 500, y: 3000 } }
    ],
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
  const doorOf = () => caster.state.combat.vision.walls.find((wall) => wall.id === DOOR)!;
  return { ...caster, doorOf };
}

const deps = (faces: number[]): DoorUseDeps => ({
  random: (sides) => Math.min(sides, faces.shift() ?? 1),
  newId: nextId,
  commandId: nextId(),
  sessionId: "30000000-0000-4000-8000-00000000000a",
  now: () => "2026-10-19T00:00:00.000Z",
  resolveDefinition: () => undefined
});
const force = (state: GameState, faces: number[]) =>
  useDoor(state, { wallId: DOOR, actorId: FOE, how: "force", visibility: "public" }, GM, deps(faces));
/** Puts an item in the hero's hands. */
const hold = (state: GameState, name: string) => {
  carry(state, HERO, name);
  const hero = state.actors.find((actor) => actor.id === HERO)!;
  hero.inventory = hero.inventory.map((row) => (row.name === name ? { ...row, equipped: true } : row));
};
const fresh = (state: GameState) => {
  state.combat.turn = { ...state.combat.turn, actionUsed: false, bonusActionUsed: false };
};

describe("Immovable Rod", () => {
  it("fixed against a door holds it shut until a DC 30 Strength (Athletics) check or its button", () => {
    const table = doorway();
    hold(table.state, "Immovable Rod");
    table.resolve("item-immovable-rod-fix", { targetIds: [], wallId: DOOR });
    expect(table.hero.inventory.some((row) => row.name === "Immovable Rod")).toBe(false);
    expect(heldShutAgainst(table.state, table.doorOf(), FOE)).toBe("An Immovable Rod holds the door shut.");
    // A 20 on the die falls short of 30.
    expect(force(table.state, [20])).toMatchObject({ opened: false });
    // The hero pushes the button and has the rod back.
    fresh(table.state);
    useDoor(table.state, { wallId: DOOR, actorId: HERO, how: "release", visibility: "public" }, GM, deps([]));
    expect(heldShutAgainst(table.state, table.doorOf(), FOE)).toBeNull();
    expect(table.hero.inventory.some((row) => row.name === "Immovable Rod")).toBe(true);
  });
});

describe("Sovereign Glue and Universal Solvent", () => {
  it("glue sets in a minute, then no check or Knock opens the door; solvent dissolves it", () => {
    const table = doorway();
    hold(table.state, "Sovereign Glue");
    hold(table.state, "Universal Solvent");
    table.resolve("item-sovereign-glue-glue", { targetIds: [], wallId: DOOR });
    // Still wet.
    expect(heldShutAgainst(table.state, table.doorOf(), FOE)).toBeNull();
    // Ten rounds on, a minute has passed.
    table.state.combat.round += 10;
    expect(heldShutAgainst(table.state, table.doorOf(), FOE)).toBe("The door is glued shut.");
    expect(() => force(table.state, [20])).toThrowError(/glued shut/);
    knockOn(table.state, DOOR);
    expect(heldShutAgainst(table.state, table.doorOf(), FOE)).toBe("The door is glued shut.");
    fresh(table.state);
    table.resolve("item-universal-solvent-dissolve", { targetIds: [], wallId: DOOR });
    expect(heldShutAgainst(table.state, table.doorOf(), FOE)).toBeNull();
  });
});

describe("Ring of the Ram", () => {
  function ringed(door: Partial<VisionWall>) {
    const table = doorway(door);
    carry(table.state, HERO, "Ring of the Ram");
    table.hero.inventory = table.hero.inventory.map((row) => ({ ...row, equipped: true, attuned: true }));
    return table;
  }

  it("breaks a stuck door open with a Strength check of d20 plus 5 for each charge", () => {
    const table = ringed({ door: { fastenings: [{ kind: "stuck", dc: 18 }] } });
    table.resolve("item-ring-of-the-ram-break-2", { targetIds: [], wallId: DOOR }, [9]);
    expect(table.doorOf()).toMatchObject({ open: true, door: { fastenings: [] } });

    const weak = ringed({ door: { fastenings: [{ kind: "stuck", dc: 18 }] } });
    weak.resolve("item-ring-of-the-ram-break-1", { targetIds: [], wallId: DOOR }, [9]);
    expect(weak.doorOf().open).toBe(false);
  });

  it("can't break the bond of Sovereign Glue", () => {
    const table = ringed({ door: { fastenings: [{ kind: "glued" }] } });
    expect(() => table.resolve("item-ring-of-the-ram-break-3", { targetIds: [], wallId: DOOR }, [20])).toThrowError(
      /glued shut/
    );
  });
});

describe("Wand of Secrets", () => {
  it("points at a secret door within 60 feet, and at nothing beyond", () => {
    const near = doorway({ door: { fastenings: [], hidden: true } });
    hold(near.state, "Wand of Secrets");
    // 40 feet west of the door.
    near.state.combat.tokens = near.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(1, 5) } : token
    );
    const found = near.resolve("item-wand-of-secrets-find-secrets", { targetIds: [] });
    expect(found.tableNarration?.map((line) => line.text)).toContain("Find Secrets: the wand pulses and points east.");

    const far = doorway({ door: { fastenings: [], hidden: true } });
    hold(far.state, "Wand of Secrets");
    far.state.combat.tokens = far.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(1, 40) } : token
    );
    const none = far.resolve("item-wand-of-secrets-find-secrets", { targetIds: [] });
    expect(none.tableNarration?.map((line) => line.text)).toContain("Find Secrets: the wand stays still.");
  });
});

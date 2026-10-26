import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorAction } from "@vtt/schemas";
import { setInventoryItem } from "../src/inventory.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { altitudeOf } from "../src/altitude.js";
import { heldAloft } from "../src/falling.js";
import { answerSave } from "../src/saving-throws.js";
import { ALLY, catalog, FOE, FOE2, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, cast, caster, laterAction, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Telekinesis: "When you cast the spell and as a Magic action on your later turns before the spell ends, you can
// exert your will on one creature or object that you can see within range ... Creature. You can try to move a Huge or
// smaller creature. The target must succeed on a Strength saving throw, or you move it up to 30 feet in any direction
// within the spell's range. Until the end of your next turn, the creature has the Restrained condition, and if you lift
// it into the air, it is suspended there. It falls at the end of your next turn unless you use this option on it again
// and it fails the save ... If you switch targets, the prior target is no longer affected by the spell ... Object ... If
// the object is worn or carried by a creature, that creature must succeed on a Strength saving throw, or you pull the
// object away".

/** Ten pixels to the foot, a creature standing on its point. */
const FEET = 10;
const tokenAt = (state: GameState, id: string) => state.combat.tokens.find((token) => token.actorId === id)!;
const feetBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) / FEET;

/** The wizard at (0, 0), the goblin 30 feet east, the orc 40 feet east, Bran 20 feet south. */
function telekinetic() {
  const table = caster();
  const at: Readonly<Record<string, { x: number; y: number }>> = {
    [HERO]: { x: 0, y: 0 },
    [FOE]: { x: 300, y: 0 },
    [FOE2]: { x: 400, y: 0 },
    [ALLY]: { x: 0, y: 200 }
  };
  for (const token of table.state.combat.tokens) token.position = at[token.actorId] ?? null;
  cast(table, "telekinesis", { targetIds: [] });
  return table;
}

const mapDeps = (state: GameState) => ({
  destinationAt: (_actorId: string, point: { x: number; y: number }, fromActorId: string) => ({
    at: point,
    feet: feetBetween(tokenAt(state, fromActorId).position!, point),
    sharers: []
  }),
  placeToken: (actorId: string, point: { x: number; y: number }) => {
    tokenAt(state, actorId).position = { ...point };
  }
});

let commands = 0;
function exert(table: ReturnType<typeof caster>, action: ActorAction, input: Record<string, unknown>) {
  return resolveDefinitionAction(
    table.state,
    action,
    {
      actorId: HERO,
      targetIds: [FOE],
      commandId: `70000000-0000-4000-8000-${String(++commands).padStart(12, "0")}`,
      ...input
    },
    {
      random: () => 10,
      newRollId: () => crypto.randomUUID(),
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-26T00:00:00.000Z",
      definition: wizard,
      catalog,
      resolveDefinition: () => undefined,
      ...mapDeps(table.state)
    }
  );
}

function fail(table: ReturnType<typeof caster>, targetId: string) {
  const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === targetId)!;
  return answerSave(
    table.state,
    crypto.randomUUID(),
    pending.id,
    "manual",
    2,
    true,
    { role: "gm" },
    {
      random: () => 10,
      newRollId: () => crypto.randomUUID(),
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-26T00:00:00.000Z",
      resolveDefinition: () => undefined,
      catalog,
      ...mapDeps(table.state)
    }
  );
}

const moveCreature = () => laterAction("telekinesis", "move a creature");

describe("Telekinesis", () => {
  it("moves a creature that fails its Strength save to the space picked, lifts it, and holds it Restrained there", () => {
    const table = telekinetic();
    exert(table, moveCreature(), { destination: { x: 300, y: 200 }, destinationAltitudeFeet: 20 });
    expect(table.state.combat.pendingSaves).toMatchObject([
      { targetActorId: FOE, ability: "str", failureMovesTo: { x: 300, y: 200, altitudeFeet: 20 } }
    ]);
    fail(table, FOE);
    expect(tokenAt(table.state, FOE).position).toEqual({ x: 300, y: 200 });
    expect(altitudeOf(tokenAt(table.state, FOE))).toBe(20);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toEqual(["restrained"]);
    expect(heldAloft(table.state, FOE)).toBe(true);
    // At the end of the wizard's next turn it is let go, to fall.
    heroTurnAgain(table.state);
    heroTurnAgain(table.state);
    expect(actorOf(table.state, FOE).conditions).toEqual([]);
    expect(heldAloft(table.state, FOE)).toBe(false);
  });

  it("refuses a space beyond the 30 feet it moves a creature", () => {
    const table = telekinetic();
    expect(() => exert(table, moveCreature(), { destination: { x: 300, y: 350 } })).toThrow(
      "That space is 35 ft from Goblin, beyond the 30 ft Telekinesis: move a creature moves it."
    );
  });

  it("lets the prior target go when it is exerted on a new one", () => {
    const table = telekinetic();
    exert(table, moveCreature(), { destination: { x: 300, y: 100 } });
    fail(table, FOE);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toEqual(["restrained"]);
    heroTurnAgain(table.state);
    exert(table, moveCreature(), { targetIds: [FOE2], destination: { x: 400, y: 100 } });
    expect(actorOf(table.state, FOE).conditions).toEqual([]);
  });

  it("pulls the weapon a creature holds from its hands on a failed save", () => {
    const table = telekinetic();
    setInventoryItem(
      table.state,
      FOE,
      InventoryItemSchema.parse({ id: "scimitar", name: "Scimitar", quantity: 1, equipped: true }),
      () => undefined,
      { catalog, role: "gm" }
    );
    exert(table, laterAction("telekinesis", "pull an object"), { objectItemId: "scimitar" });
    fail(table, FOE);
    expect(actorOf(table.state, FOE).inventory[0]).toMatchObject({ id: "scimitar", equipped: false });
  });
});

import { describe, expect, it } from "vitest";
import { builtinActionFor } from "../src/builtin-actions.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { currentSpeedFeet } from "../src/speed.js";
import { ALLY, catalog, FOE, heroTurnAgain } from "./spell-casters.js";
import { actorOf, answer, cast, caster, resolveAs } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Freedom of Movement: "spells and other magical effects can neither reduce the target's Speed nor cause the
// target to have the Paralyzed or Restrained conditions ... In addition, the target can spend 5 feet of movement to
// automatically escape from nonmagical restraints, such as manacles or a creature imposing the Grappled condition on
// it."

const conditionsOf = (table: ReturnType<typeof caster>, id: string) =>
  actorOf(table.state, id).conditions.map((condition) => condition.id);

/** Bran under Freedom of Movement, with a 30-foot Speed. */
function free() {
  const table = caster();
  actorOf(table.state, ALLY).speedFeet = 30;
  cast(table, "freedom-of-movement", { targetIds: [ALLY] });
  heroTurnAgain(table.state);
  return table;
}

/** A hold that isn't magic: a Net's Restrained, or a grapple. */
const holdOn = (table: ReturnType<typeof caster>, condition: "restrained" | "grappled") =>
  addEffect(
    table.state,
    ALLY,
    makeEffect({
      id: `net-${condition}`,
      name: condition === "restrained" ? "Net" : "Grappled by Goblin",
      sourceActorId: FOE,
      sourceName: "Goblin",
      duration: { type: "manual" },
      linkedConditionIds: [condition],
      escapeDc: 10
    })
  );

const speedOf = (table: ReturnType<typeof caster>) => {
  const ally = actorOf(table.state, ALLY);
  return currentSpeedFeet(ally, deriveEquipment(ally, undefined, catalog));
};

describe("Freedom of Movement", () => {
  it("keeps a spell from Paralyzing its target", () => {
    const table = free();
    cast(table, "hold-person", { targetIds: [ALLY] });
    answer(table.state, ALLY, 2);
    expect(conditionsOf(table, ALLY)).toEqual([]);
  });

  it("lets a nonmagical restraint hold it", () => {
    const table = free();
    holdOn(table, "restrained");
    expect(conditionsOf(table, ALLY)).toEqual(["restrained"]);
  });

  it("keeps a spell from reducing its Speed", () => {
    const table = free();
    cast(table, "ray-of-frost", { targetIds: [ALLY] }, [19, 4]);
    expect(actorOf(table.state, ALLY).effects.some((effect) => effect.name === "Ray of Frost")).toBe(true);
    expect(speedOf(table)).toBe(30);
    // Without the spell, the ray takes 10 feet off.
    const plain = caster();
    actorOf(plain.state, ALLY).speedFeet = 30;
    cast(plain, "ray-of-frost", { targetIds: [ALLY] }, [19, 4]);
    expect(speedOf(plain)).toBe(20);
  });

  it("slips a nonmagical grapple for 5 feet of movement, with no action and no roll", () => {
    const table = free();
    holdOn(table, "grappled");
    while (table.state.combat.turnActorId !== ALLY) nextInitiativeTurn(table.state);
    const rolls = table.state.rolls.length;
    const slip = builtinActionFor(undefined, "slip-free", actorOf(table.state, ALLY))!;
    resolveAs(table, slip, { targetIds: [], builtin: true }, [], ALLY);
    expect(conditionsOf(table, ALLY)).toEqual([]);
    expect(table.state.combat.turn).toMatchObject({ movementUsedFeet: 5, actionUsed: false });
    expect(table.state.rolls.length).toBe(rolls);
  });

  it("offers no slip free without Freedom of Movement", () => {
    const table = caster();
    holdOn(table, "grappled");
    expect(builtinActionFor(undefined, "slip-free", actorOf(table.state, ALLY))).toBeUndefined();
  });
});

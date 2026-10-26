import { describe, expect, it } from "vitest";
import { nextInitiativeTurn } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { settleBonds } from "../src/warding-bond.js";
import { ALLY, FOE, FOE2, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, cast, castAction, caster, effectNames, resolveAs } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Warding Bond: "Until the spell ends, the target has a +1 bonus to AC and saving throws, and it has Resistance
// to all damage. Also, each time it takes damage, you take the same amount of damage. The spell ends if you drop to 0
// Hit Points or if you and the target become separated by more than 60 feet. It also ends if the spell is cast again on
// either of the connected creatures."

const resolveDefinition = () => undefined;
const fire = (amount: number) => ({ amount, parts: [{ amount, type: "fire" as const }] });

function bonded() {
  const table = caster();
  actorOf(table.state, HERO).inventory.push({
    id: "platinum-rings",
    name: "Platinum ring (50 GP)",
    quantity: 4,
    equipped: false,
    attuned: false
  });
  cast(table, "warding-bond", { targetIds: [ALLY] });
  expect(effectNames(table.state, ALLY)).toContain("Warding Bond");
  return table;
}

describe("Warding Bond", () => {
  it("passes the damage the ward takes, after its Resistance, to the caster", () => {
    const table = bonded();
    const casterBefore = actorOf(table.state, HERO).hp.current;
    const { application, events } = applyDamageDetailed(
      table.state,
      ALLY,
      fire(10),
      { role: "gm" },
      { resolveDefinition }
    );
    expect(application.totalApplied).toBe(5);
    expect(actorOf(table.state, HERO).hp.current).toBe(casterBefore - 5);
    expect(events.some((event) => event.text.includes("takes 5 damage through Warding Bond"))).toBe(true);
  });

  it("ends when the two are more than 60 feet apart, and not at 60", () => {
    const table = bonded();
    expect(settleBonds(table.state, () => 60)).toEqual([]);
    expect(effectNames(table.state, ALLY)).toContain("Warding Bond");
    settleBonds(table.state, () => 65);
    expect(effectNames(table.state, ALLY)).not.toContain("Warding Bond");
  });

  it("ends when the caster drops to 0 Hit Points, its last share included", () => {
    const table = bonded();
    actorOf(table.state, HERO).hp.current = 3;
    applyDamageDetailed(table.state, ALLY, fire(10), { role: "gm" }, { resolveDefinition });
    expect(actorOf(table.state, HERO).hp.current).toBe(0);
    settleBonds(table.state, () => 5);
    expect(effectNames(table.state, ALLY)).not.toContain("Warding Bond");
    // With no bond left, the ward's damage stays its own.
    applyDamageDetailed(table.state, ALLY, fire(4), { role: "gm" }, { resolveDefinition });
    expect(actorOf(table.state, HERO).hp.current).toBe(0);
  });

  it("ends when the spell is cast again on either connected creature", () => {
    const table = bonded();
    heroTurnAgain(table.state);
    // The caster bonds a second creature: the first bond holds.
    cast(table, "warding-bond", { targetIds: [FOE] });
    expect(effectNames(table.state, ALLY)).toContain("Warding Bond");
    expect(effectNames(table.state, FOE)).toContain("Warding Bond");
    // Another caster's bond on the first ward ends the bond tying it to the Wizard.
    while (table.state.combat.turnActorId !== FOE2) nextInitiativeTurn(table.state);
    const orc = actorOf(table.state, FOE2);
    orc.spellSlots = [{ level: 2, remaining: 1 }];
    orc.inventory.push({
      id: "platinum-rings",
      name: "Platinum ring (50 GP)",
      quantity: 2,
      equipped: false,
      attuned: false
    });
    resolveAs(table, castAction("warding-bond"), { targetIds: [ALLY] }, [], FOE2);
    const bonds = actorOf(table.state, ALLY).effects.filter((effect) => effect.name === "Warding Bond");
    expect(bonds.map((effect) => effect.sourceActorId)).toEqual([FOE2]);
    expect(effectNames(table.state, FOE)).toContain("Warding Bond");
  });
});

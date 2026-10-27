import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { makeEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { openEndingSave } from "../src/save-stages.js";
import { ALLY, FOE, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, answer, cast, caster, effectNames, laterAction, resolveAs } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Possession: "Possession can be prevented by the Protection from Evil and Good spell and ended by the Dispel
// Evil and Good spell." Protection from Evil and Good: "The target also can't be possessed by or gain the Charmed or
// Frightened conditions from them." Dispel Evil and Good, Break Enchantment: "The target is no longer possessed,
// Charmed, or Frightened by such creatures." Dismissal: "The target must succeed on a Charisma saving throw or be sent
// back to its home plane". Either special function ends the spell.

const ghost = loadMonsterDefinitions().find((monster) => monster.source.externalId === "ghost")!;

/** The wizard's fight with the goblin made a ghost. */
function haunted() {
  const table = caster();
  table.state.definitions.push({ id: "ghost-def", definition: ghost });
  actorOf(table.state, FOE).definitionId = "ghost-def";
  return table;
}

/** The ghost tries to possess Bran, who fails the save. */
function possess(table: ReturnType<typeof haunted>) {
  while (table.state.combat.turnActorId !== FOE) nextInitiativeTurn(table.state);
  const result = resolveAs(
    table,
    ghost.actions.find((action) => action.id === "possession")!,
    { targetIds: [ALLY] },
    [],
    FOE
  );
  if (table.state.combat.pendingSaves.length > 0) answer(table.state, ALLY, 2);
  heroTurnAgain(table.state);
  return result;
}

const conditionsOf = (table: ReturnType<typeof haunted>, id: string) =>
  actorOf(table.state, id).conditions.map((condition) => condition.id);

describe("possession", () => {
  it("marks a ghost's Possession as one, with the body Incapacitated", () => {
    const table = haunted();
    possess(table);
    expect(actorOf(table.state, ALLY).effects.find((effect) => effect.tags.includes("possessed"))?.name).toBe(
      "Possessed"
    );
    expect(conditionsOf(table, ALLY)).toEqual(["incapacitated"]);
  });

  it("can't take a creature under Protection from Evil and Good", () => {
    const table = haunted();
    actorOf(table.state, HERO).inventory.push({
      id: "holy-water",
      name: "Holy Water (25 GP)",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    cast(table, "protection-from-evil-and-good", { targetIds: [ALLY] });
    possess(table);
    expect(effectNames(table.state, ALLY)).toEqual(["Protection from Evil and Good"]);
    expect(conditionsOf(table, ALLY)).toEqual([]);
  });

  it("ends by Dispel Evil and Good's Break Enchantment, which ends the spell", () => {
    const table = haunted();
    possess(table);
    cast(table, "dispel-evil-and-good", { targetIds: [] });
    expect(effectNames(table.state, HERO)).toContain("Dispel Evil and Good");
    heroTurnAgain(table.state);
    const broken = resolveAs(table, laterAction("dispel-evil-and-good", "Break Enchantment"), { targetIds: [ALLY] });
    expect(conditionsOf(table, ALLY)).toEqual([]);
    expect(actorOf(table.state, ALLY).effects.some((effect) => effect.tags.includes("possessed"))).toBe(false);
    expect(broken.tableNarration?.map((line) => line.text)).toContain(
      "Bran is free of Possessed (Dispel Evil and Good: Break Enchantment)."
    );
    expect(effectNames(table.state, HERO)).toEqual([]);
  });
});

describe("Protection from Evil and Good on a creature already held", () => {
  it("gives Advantage on a new save against what such a creature charmed it with", () => {
    const table = haunted();
    const ally = actorOf(table.state, ALLY);
    ally.effects.push(
      makeEffect({
        id: "ghostly-charm",
        name: "Charmed by Goblin",
        sourceActorId: FOE,
        sourceName: "Goblin",
        duration: { type: "manual" },
        linkedConditionIds: ["charmed"],
        repeatSave: { ability: "wis", dc: 13 }
      })
    );
    actorOf(table.state, HERO).inventory.push({
      id: "holy-water",
      name: "Holy Water (25 GP)",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    cast(table, "protection-from-evil-and-good", { targetIds: [ALLY] });
    openEndingSave(table.state, actorOf(table.state, ALLY), ally.effects[0]!, { ability: "wis", dc: 13 }, "repeats", {
      newId: () => crypto.randomUUID(),
      now: () => "2026-10-26T00:00:00.000Z",
      resolveDefinition: (id) => table.state.definitions.find((entry) => entry.id === id)?.definition
    });
    expect(table.state.combat.pendingSaves).toMatchObject([
      { targetActorId: ALLY, advantageFrom: "Protection from Evil and Good" }
    ]);
  });
});

describe("Dispel Evil and Good's Dismissal", () => {
  it("sends an Undead that fails its Charisma save home for good, and ends the spell", () => {
    const table = haunted();
    cast(table, "dispel-evil-and-good", { targetIds: [] });
    heroTurnAgain(table.state);
    resolveAs(table, laterAction("dispel-evil-and-good", "Dismissal"), { targetIds: [FOE] });
    expect(effectNames(table.state, HERO)).toEqual([]);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: FOE, ability: "cha", dc: 15 }]);
    answer(table.state, FOE, 2);
    expect(actorOf(table.state, FOE).effects).toMatchObject([
      { name: "Sent home (Dispel Evil and Good: Dismissal)", tags: ["off-plane"], duration: { type: "manual" } }
    ]);
  });

  it("does nothing to a creature that isn't of the warded types, though the action and the spell are spent", () => {
    const table = caster();
    cast(table, "dispel-evil-and-good", { targetIds: [] });
    heroTurnAgain(table.state);
    table.state.definitions.push({
      id: "bandit-def",
      definition: loadMonsterDefinitions().find((monster) => monster.source.externalId === "bandit")!
    });
    actorOf(table.state, FOE).definitionId = "bandit-def";
    resolveAs(table, laterAction("dispel-evil-and-good", "Dismissal"), { targetIds: [FOE] });
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(effectNames(table.state, HERO)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { catalog, FOE, HERO } from "./spell-casters.js";
import { actorOf, cast, caster, nextCommand, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Conjure Minor Elementals: "Any attack you make deals an extra 2d8 damage when you hit a creature within 15
// feet of yourself. This damage is Acid, Cold, Fire, or Lightning (your choice when you make the attack)." "The damage
// increases by 1d8 for each spell slot level above 4."

describe("Conjure Minor Elementals' extra damage", () => {
  const swing = (
    table: ReturnType<typeof caster>,
    hitOptions: readonly { id: string; damageType?: string }[] = [],
    commit = true
  ) => {
    const weapon = effectiveActions(wizard, actorOf(table.state, HERO), catalog).find(
      (action) => action.attack !== undefined && action.attack.reachFeet !== undefined && !action.spellId
    )!;
    table.state.combat = {
      ...table.state.combat,
      turn: { ...table.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    return resolveDefinitionAction(
      table.state,
      weapon,
      { actorId: HERO, targetIds: [FOE], commandId: nextCommand(), attackNatural: 19, hitOptions, commit },
      {
        random: () => 2,
        newRollId: () => crypto.randomUUID(),
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-18T00:00:00.000Z",
        definition: wizard,
        catalog,
        resolveDefinition: () => undefined,
        distanceFeet: () => 5
      }
    );
  };

  it("adds 1d8 a slot level above 4, of the type picked at the cast unless the attack picks another", () => {
    const table = caster();
    cast(table, "conjure-minor-elementals", { optionId: "acid", slotLevel: 6, targetIds: [] });
    const effect = actorOf(table.state, HERO).effects.find((entry) => entry.name.startsWith("Conjure Minor"))!;
    const plain = swing(table);
    expect(plain.damage).toContainEqual(expect.objectContaining({ formula: "4d8", type: "acid", total: 8 }));
    const offer = swing(table, [], false).hitOffers?.find((entry) => entry.id === `rider-type:${effect.id}`);
    expect(offer?.damageTypes).toEqual(["acid", "cold", "fire", "lightning"]);
    const fire = swing(table, [{ id: `rider-type:${effect.id}`, damageType: "fire" }]);
    expect(fire.damage).toContainEqual(expect.objectContaining({ formula: "4d8", type: "fire" }));
  });
});

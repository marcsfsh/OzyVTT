import { describe, expect, it } from "vitest";
import { actionChoicesOf } from "@vtt/domain";
import { startHoldingBreath } from "../src/breath.js";
import { pushTokenAway } from "../src/forced-movement.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { FOE, HERO } from "./spell-casters.js";
import { actorOf, answer, cast, castAction, caster, effectNames } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Imprisonment: "On a successful save, the target is unaffected, and it is immune to this spell for the next
// 24 hours. On a failed save, the target is imprisoned. While imprisoned, the target doesn't need to breathe, eat, or
// drink ... Divination spells can't locate or perceive the imprisoned target, and the target can't teleport", in the
// form its caster picks (Burial, Chaining, Hedged Prison, Minimus Containment, Slumber); "A Dispel Magic spell can end
// the spell only if it is cast with a level 9 spell slot". Scrying: "The target makes a Wisdom saving throw, which is
// modified ... by how well you know the target and the sort of physical connection you have to it ... On a successful
// save, the target isn't affected, and you can't use this spell on it again for 24 hours."

/** The costly statuette and focus are the components rules' business, waived here. */
const waived = { override: { families: ["components" as const], reason: "In the pack." } };

/** The wizard imprisons the goblin outside a fight, the cast taking its full minute, in the form picked. */
function imprison(form: string, face = 2) {
  const table = caster({ combat: false });
  cast(table, "imprisonment", { targetIds: [FOE], optionId: form, ...waived });
  answer(table.state, FOE, face);
  return table;
}

const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};

describe("Imprisonment", () => {
  it("asks for its form as it is cast", () => {
    expect(actionChoicesOf(castAction("imprisonment"))?.options?.map((option) => option.id)).toEqual([
      "burial",
      "chaining",
      "hedged-prison",
      "minimus-containment",
      "slumber"
    ]);
  });

  it("chains its target Restrained in place, where no push moves it, warded from Divination and teleports", () => {
    const table = imprison("chaining");
    const goblin = actorOf(table.state, FOE);
    expect(goblin.conditions.map((condition) => condition.id)).toEqual(["restrained"]);
    expect(goblin.effects[0]).toMatchObject({
      tags: expect.arrayContaining(["imprisoned", "no-teleport", "sustained", "unmovable"]),
      modifiers: [{ type: "spell-ward", schools: ["divination"] }]
    });
    table.state.combat.tokens = [
      { actorId: HERO, position: { x: 25, y: 25 }, sizePx: 40, sizeCells: 1 },
      { actorId: FOE, position: { x: 75, y: 25 }, sizePx: 40, sizeCells: 1 }
    ] as typeof table.state.combat.tokens;
    expect(pushTokenAway(table.state, { actorId: FOE, awayFromActorId: HERO, distanceFeet: 10 }, GRID)).toEqual({
      value: 0,
      unit: "ft"
    });
    expect(table.state.combat.tokens.find((token) => token.actorId === FOE)?.position).toEqual({ x: 75, y: 25 });
    expect(startHoldingBreath(table.state, goblin, undefined)).toEqual([]);
  });

  it("leaves a slumbering target Unconscious, and buries another off the map", () => {
    const sleeping = imprison("slumber");
    expect(actorOf(sleeping.state, FOE).conditions.map((condition) => condition.id)).toEqual(["prone", "unconscious"]);
    expect(actorOf(sleeping.state, FOE).effects[0]?.endsOnDamage).toBeUndefined();
    const buried = imprison("burial");
    expect(actorOf(buried.state, FOE).effects[0]?.tags).toContain("off-plane");
  });

  it("holds against Dispel Magic from a level 8 slot, and ends from a level 9 one", () => {
    const table = imprison("chaining");
    cast(table, "dispel-magic", { targetIds: [FOE], slotLevel: 8 });
    expect(effectNames(table.state, FOE)).toEqual(["Imprisoned (Chaining)"]);
    cast(table, "dispel-magic", { targetIds: [FOE], slotLevel: 9 });
    expect(effectNames(table.state, FOE)).toEqual([]);
  });

  it("leaves a target that saves immune to it for 24 hours", () => {
    const table = imprison("chaining", 20);
    expect(actorOf(table.state, FOE).effects).toMatchObject([{ duration: { type: "minutes", remaining: 1440 } }]);
    const again = cast(table, "imprisonment", { targetIds: [FOE], optionId: "chaining", ...waived });
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(again.warnings).toContain("Goblin is immune to Ansel's Imprisonment, so it makes no save.");
  });
});

describe("Scrying", () => {
  it("adds the knowledge and connection its caster picks to the target's save", () => {
    const table = caster({ combat: false });
    cast(table, "scrying", { targetIds: [FOE], optionId: "firsthand-body-part", ...waived });
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: FOE, ability: "wis", saveBonus: -10 }]);
  });

  it("can't be used on a target that saved again for 24 hours", () => {
    const table = caster({ combat: false });
    cast(table, "scrying", { targetIds: [FOE], optionId: "secondhand", ...waived });
    expect(table.state.combat.pendingSaves[0]?.saveBonus).toBe(5);
    answer(table.state, FOE, 20);
    const again = cast(table, "scrying", { targetIds: [FOE], optionId: "extensive", ...waived });
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(again.warnings).toContain("Goblin is immune to Ansel's Scrying, so it makes no save.");
  });
});

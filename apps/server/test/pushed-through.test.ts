import { describe, expect, it } from "vitest";
import type { EffectNarration } from "../src/effects.js";
import { pushThroughZones } from "../src/pushed-through.js";
import { build, druidInput, fight, FOE, HERO } from "./spell-casters.js";
import { cell, drawArea, GRID, place, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Spike Growth: "When a creature moves into or within the area, it takes 2d4 Piercing damage for every 5 feet
// it travels." A creature moved by force meets the spell areas on its way as any mover does.

const CAST = "60000000-0000-4000-8000-0000000000e5";

describe("a creature moved by force through a spell's area", () => {
  it("takes Spike Growth's damage for the feet it is pushed through the Sphere", () => {
    const caster = fight(build(druidInput(["spike-growth"])));
    place(caster.state, { [HERO]: cell(0, 10), [FOE]: cell(6, 10) });
    caster.resolve("spell-spike-growth", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [14, 10], 4);
    const events: EffectNarration[] = [];
    const moved = pushThroughZones(
      caster.state,
      { actorId: FOE, awayFromActorId: HERO, distanceFeet: 30 },
      GRID,
      zoneDeps([1, 1, 1, 1, 1, 1, 1, 1]),
      events
    );
    expect(moved?.value).toBe(30);
    expect(events.map((event) => event.text).join(" ")).toMatch(/Goblin moves through Spike Growth and takes \d+/);
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.hp.current).toBeLessThan(200);
  });
});

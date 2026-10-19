import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { activeTeleportGrant, spendTeleportGrant } from "../src/granted-moves.js";
import { build, fight, fighterInput } from "./spell-casters.js";

// SRD 5.2.1 Boon of Dimensional Travel, Blink Steps: "Immediately after you take the Attack action or the Magic action,
// you can teleport up to 30 feet to an unoccupied space you can see."

const base = build(fighterInput());
const withBoon: ActorDefinition = {
  ...base,
  character: {
    ...base.character!,
    features: [
      ...(base.character?.features ?? []),
      { id: "boon-of-dimensional-travel", kind: "feat", sourceId: "feat" }
    ]
  }
};

describe("Blink Steps", () => {
  it("comes once the Attack action is taken, after its last attack", () => {
    const { state, resolve, hero } = fight(withBoon);
    resolve("item-greatsword", {}, [15, 4, 4]);
    expect(activeTeleportGrant(state, hero)).toBeNull();
    resolve("item-greatsword", {}, [15, 4, 4]);
    expect(activeTeleportGrant(state, hero)).toMatchObject({ feet: 30, name: "Blink Steps" });
  });

  it("comes again after the Attack action that Action Surge gives", () => {
    const { state, resolve, hero } = fight(withBoon);
    resolve("item-greatsword", {}, [15, 4, 4]);
    resolve("item-greatsword", {}, [15, 4, 4]);
    spendTeleportGrant(hero, activeTeleportGrant(state, hero)!.effectId);
    resolve("action-surge", { targetIds: [] });
    resolve("item-greatsword", {}, [15, 4, 4]);
    expect(activeTeleportGrant(state, hero)).toBeNull();
    resolve("item-greatsword", {}, [15, 4, 4]);
    expect(activeTeleportGrant(state, hero)).toMatchObject({ feet: 30 });
  });

  it("comes after the Magic action of a spell", () => {
    const { state, resolve, hero } = fight(withBoon);
    resolve("spell-magic-missile-free", {});
    expect(activeTeleportGrant(state, hero)).toMatchObject({ feet: 30 });
  });

  it("is not given without the boon", () => {
    const { state, resolve, hero } = fight(base);
    resolve("item-greatsword", {}, [15, 4, 4]);
    resolve("item-greatsword", {}, [15, 4, 4]);
    expect(activeTeleportGrant(state, hero)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { healActor } from "../src/hit-points.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { currentSpeedFeet } from "../src/speed.js";
import {
  build,
  catalog,
  druidInput,
  fight,
  FOE,
  HERO,
  heroTurnAgain,
  warlockInput,
  wizardInput
} from "./spell-casters.js";

// What a spell's hit leaves on its target besides its damage (SRD 5.2.1 text), applied by the server.

const wizard = build(wizardInput(["ray-of-sickness", "acid-arrow"]));
const warlock = build(warlockInput(["hex"]));
// The druid's Druidcraft swapped for Starry Wisp.
const druidWithWisp = druidInput([]);
const druid = build({
  ...druidWithWisp,
  choices: (druidWithWisp.choices ?? []).map((choice) =>
    choice.id === "druidcraft" ? { ...choice, id: "starry-wisp" } : choice
  )
} as typeof druidWithWisp);

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const effectNames = (state: GameState, id: string) => actor(state, id).effects.map((effect) => effect.name);

describe("Ray of Frost", () => {
  it("takes 10 feet off the target's Speed until the start of the caster's next turn", () => {
    const { resolve, state } = fight(wizard);
    actor(state, FOE).speedFeet = 30;
    expect(resolve("spell-ray-of-frost", {}, [15, 4]).attack?.outcome).toBe("hit");
    const goblin = actor(state, FOE);
    expect(currentSpeedFeet(goblin, deriveEquipment(goblin, undefined, catalog))).toBe(20);
    heroTurnAgain(state);
    expect(currentSpeedFeet(goblin, deriveEquipment(goblin, undefined, catalog))).toBe(30);
  });

  it("does nothing to Speed on a miss", () => {
    const { resolve, state } = fight(wizard);
    actor(state, FOE).speedFeet = 30;
    expect(resolve("spell-ray-of-frost", {}, [2, 4]).attack?.outcome).toBe("miss");
    expect(actor(state, FOE).effects).toEqual([]);
  });
});

describe("Shocking Grasp", () => {
  it("keeps the target from making an Opportunity Attack until the start of its next turn", () => {
    const { resolve, state } = fight(wizard);
    expect(resolve("spell-shocking-grasp", {}, [15, 4]).attack?.outcome).toBe("hit");
    expect(actor(state, FOE).effects[0]).toMatchObject({
      name: "Shocking Grasp",
      tags: ["no-opportunity-attacks"],
      duration: { type: "until-bearer-next-turn" }
    });
    // The wizard steps away from the goblin, which would otherwise get its Opportunity Attack.
    state.combat.tokens = [
      {
        actorId: HERO,
        position: { x: 100, y: 100 },
        sizePx: 50,
        gridSizePx: null,
        gridRotationRadians: null,
        sizeCells: 1
      },
      {
        actorId: FOE,
        position: { x: 150, y: 100 },
        sizePx: 50,
        gridSizePx: null,
        gridRotationRadians: null,
        sizeCells: 1
      }
    ];
    const away = () =>
      applyMovementRules(state, {
        actorId: HERO,
        from: { x: 100, y: 100 },
        to: { x: 30, y: 100 },
        distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / 10,
        override: { reason: "test" },
        resolveDefinition: () => undefined,
        newPromptId: () => "70000000-0000-4000-8000-000000000001",
        now: () => 0,
        commandId: "80000000-0000-4000-8000-000000000001"
      });
    expect(away().prompts).toEqual([]);
    actor(state, FOE).effects = [];
    expect(away().prompts).toEqual([{ actorId: FOE, name: "Goblin" }]);
  });
});

describe("Ray of Sickness", () => {
  it("Poisons the target it hits until the end of the caster's next turn", () => {
    const { resolve, state } = fight(wizard);
    resolve("spell-ray-of-sickness", {}, [15, 4, 4]);
    expect(actor(state, FOE).conditions.map((condition) => condition.id)).toEqual(["poisoned"]);
    expect(actor(state, FOE).effects[0]?.duration).toMatchObject({ type: "until-source-turn-end" });
  });
});

describe("Chill Touch", () => {
  it("keeps the target from regaining Hit Points until the end of the caster's next turn", () => {
    const { resolve, state } = fight(warlock);
    expect(resolve("spell-chill-touch", {}, [15, 4]).attack?.outcome).toBe("hit");
    const before = actor(state, FOE).hp.current;
    const events = healActor(state, FOE, 10, { role: "gm" });
    expect(actor(state, FOE).hp.current).toBe(before);
    expect(events[0]?.text).toBe("Goblin can't regain hit points while Chill Touch lasts.");
  });
});

describe("Starry Wisp", () => {
  it("leaves the target unable to benefit from the Invisible condition until the end of the caster's next turn", () => {
    const { resolve, state } = fight(druid);
    expect(resolve("spell-starry-wisp", {}, [15, 4]).attack?.outcome).toBe("hit");
    expect(actor(state, FOE).effects[0]).toMatchObject({ tags: ["outlined"] });
  });
});

describe("Acid Arrow", () => {
  it("deals 2d4 Acid more at the end of the target's next turn, and half the hit's damage on a miss", () => {
    const { resolve, state } = fight(wizard);
    resolve("spell-acid-arrow", {}, [15, 1, 1, 1, 1]);
    expect(effectNames(state, FOE)).toEqual(["Acid Arrow by Ansel (Acid Arrow)"]);
    const missed = fight(wizard);
    const miss = missed.resolve("spell-acid-arrow", {}, [2, 4, 4, 4, 3]);
    expect(miss.attack?.outcome).toBe("miss");
    // 15 rolled, 7 owed.
    expect(miss.bonusDamage).toEqual([{ amount: 7, type: "acid", source: "Acid Arrow (miss)" }]);
    expect(miss.damageTotal).toBe(7);
    expect(missed.state.actors.find((entry) => entry.id === FOE)!.effects).toEqual([]);
  });

  it("adds a die to the later damage for each slot level above 2, as it does to the hit", () => {
    const { resolve, state } = fight(wizard);
    resolve("spell-acid-arrow", { slotLevel: 3 }, [15, 1, 1, 1, 1, 1]);
    expect(actor(state, FOE).effects[0]?.ongoingDamage?.damage).toEqual([{ formula: "3d4", type: "acid" }]);
  });
});

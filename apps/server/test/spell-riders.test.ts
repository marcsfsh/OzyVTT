import { describe, expect, it } from "vitest";
import { armorClassInPlay, type GameState } from "@vtt/domain";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { healActor } from "../src/hit-points.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { answerSave, saveRollSources } from "../src/saving-throws.js";
import { currentSpeedFeet } from "../src/speed.js";
import {
  ALLY,
  bardInput,
  build,
  catalog,
  druidInput,
  fight,
  fighterInput,
  FOE,
  FOE2,
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

const bard = build(bardInput(["slow", "charm-person"]));
const fighter = build(fighterInput());

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const effectNames = (state: GameState, id: string) => actor(state, id).effects.map((effect) => effect.name);
let saveIds = 0;
/** The target answers the save it owes with this total. */
const answer = (state: GameState, targetId: string, total: number) =>
  answerSave(
    state,
    `90000000-0000-4000-8000-${String((saveIds += 1)).padStart(12, "0")}`,
    state.combat.pendingSaves.find((save) => save.targetActorId === targetId)!.id,
    "manual",
    total,
    true,
    { role: "gm" },
    {
      random: () => 10,
      newRollId: () => `91000000-0000-4000-8000-${String((saveIds += 1)).padStart(12, "0")}`,
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-17T00:00:00.000Z",
      resolveDefinition: () => undefined,
      catalog
    }
  );

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

describe("Vicious Mockery", () => {
  it("gives a target that fails Disadvantage on its next attack roll before the end of its next turn", () => {
    const { resolve, state } = fight(bard);
    resolve("spell-vicious-mockery", {}, [4]);
    answer(state, FOE, 1);
    const mocked = actor(state, FOE).effects[0]!;
    expect(mocked).toMatchObject({
      name: "Vicious Mockery",
      tags: ["until-own-attack"],
      duration: { type: "until-bearer-turn-end" }
    });
    // The same mockery on a wizard: its Fire Bolt keeps the lower d20, and that roll spends it.
    const mockedWizard = fight(wizard);
    actor(mockedWizard.state, HERO).effects = [{ ...mocked, id: "mocked" }];
    expect(mockedWizard.resolve("spell-fire-bolt", {}, [18, 5, 4]).attack?.naturalRoll).toBe(5);
    expect(actor(mockedWizard.state, HERO).effects).toEqual([]);
  });

  it("leaves a target that succeeds alone", () => {
    const { resolve, state } = fight(bard);
    resolve("spell-vicious-mockery", {}, [4]);
    answer(state, FOE, 25);
    expect(actor(state, FOE).effects).toEqual([]);
  });
});

describe("Slow", () => {
  /** The bard's Slow, failed by the goblin. */
  function slowed() {
    const caster = fight(bard, { ally: true });
    actor(caster.state, FOE).speedFeet = 30;
    caster.resolve("spell-slow", { targetIds: [FOE] });
    answer(caster.state, FOE, 1);
    return { ...caster, slow: actor(caster.state, FOE).effects[0]! };
  }

  it("halves the target's Speed, takes 2 off its AC and Dexterity saves, and bars its Reactions", () => {
    const { state, slow } = slowed();
    const goblin = actor(state, FOE);
    expect(currentSpeedFeet(goblin, deriveEquipment(goblin, undefined, catalog))).toBe(15);
    expect(armorClassInPlay(goblin)).toBe(10);
    expect(slow).toMatchObject({
      name: "Slow",
      tags: ["speed-halved", "no-reactions", "slowed"],
      armorClassBonus: -2,
      concentration: true,
      repeatSave: { ability: "wis", dc: 15 },
      modifiers: [{ type: "save-bonus", amount: -2 }]
    });
  });

  it("allows an action or a Bonus Action on the bearer's turn, not both", () => {
    const { slow } = slowed();
    const slowedBard = fight(bard, { ally: true });
    actor(slowedBard.state, HERO).effects = [{ ...slow, id: "slow", sourceActorId: FOE }];
    slowedBard.resolve("spell-sacred-flame", {}, [20]);
    expect(() => slowedBard.resolve("bardic-inspiration", { targetIds: [ALLY] })).toThrowError(
      /Ysolde took an action this turn, and Slow leaves no Bonus Action as well/
    );
  });

  it("lets the Attack action make one attack only, Extra Attack or not", () => {
    const { slow } = slowed();
    const free = fight(fighter);
    free.resolve("item-greatsword", {}, [15, 3, 3]);
    expect(free.resolve("item-greatsword", {}, [15, 3, 3]).attack?.outcome).toBe("hit");
    const slowedFighter = fight(fighter);
    actor(slowedFighter.state, HERO).effects = [{ ...slow, id: "slow", sourceActorId: FOE }];
    slowedFighter.resolve("item-greatsword", {}, [15, 3, 3]);
    expect(() => slowedFighter.resolve("item-greatsword", {}, [15, 3, 3])).toThrowError(
      /Borin has no attacks remaining in this action/
    );
  });

  it("fails a spell with a Somatic component on a d4's 1, with its slot spent", () => {
    const { slow } = slowed();
    const slowedBard = fight(bard);
    actor(slowedBard.state, HERO).effects = [{ ...slow, id: "slow", sourceActorId: FOE }];
    const slotsBefore = actor(slowedBard.state, HERO).spellSlots?.find((slot) => slot.level === 1)?.remaining ?? 0;
    const failed = slowedBard.resolve("spell-charm-person", { targetIds: [FOE] }, [1]);
    expect(failed.tableNarration?.map((line) => line.text)).toContain(
      "Ysolde's Charm Person fails, its gestures made too slowly under Slow."
    );
    expect(slowedBard.state.combat.pendingSaves).toEqual([]);
    expect(actor(slowedBard.state, HERO).spellSlots?.find((slot) => slot.level === 1)?.remaining).toBe(slotsBefore - 1);
  });
});

describe("Warlock invocations", () => {
  const blaster = build(warlockInput([]));

  it("Eldritch Spear adds 30 feet a Warlock level to the picked cantrip's range", () => {
    const { action } = fight(blaster);
    // Eldritch Blast's 120 feet, and 150 more at Warlock 5.
    expect(action("spell-eldritch-blast").attack?.rangeFeet).toBe(270);
  });

  it("Eldritch Mind gives Advantage on the Constitution save that keeps Concentration, and on no other", () => {
    const { hero } = fight(blaster);
    const derivation = deriveEquipment(hero, blaster, catalog);
    expect(saveRollSources(hero, "con", derivation, true).advantage).toEqual([
      expect.objectContaining({ label: expect.stringContaining("Eldritch Mind") })
    ]);
    expect(saveRollSources(hero, "con", derivation).advantage).toEqual([]);
  });
});

describe("Ice Knife", () => {
  const knifer = build(wizardInput(["ice-knife"]));
  const saves = (state: GameState) =>
    state.combat.pendingSaves.map((save) => ({
      target: save.targetActorId,
      ability: save.ability,
      damage: save.proposedDamage,
      name: save.actionName
    }));

  it("bursts hit or miss: the target and each creature within 5 feet of it make a Dexterity save against 2d6 Cold", () => {
    const { state, resolve } = fight(knifer, { distance: 5 });
    // The d20 misses; the 2d6 roll 3 and 4.
    expect(resolve("spell-ice-knife", {}, [2, 3, 4]).attack?.outcome).toBe("miss");
    expect(saves(state)).toEqual([
      { target: FOE, ability: "dex", damage: 7, name: "Ice Knife: burst" },
      { target: HERO, ability: "dex", damage: 7, name: "Ice Knife: burst" },
      { target: FOE2, ability: "dex", damage: 7, name: "Ice Knife: burst" }
    ]);
    expect(state.combat.pendingSaves[0]).toMatchObject({ dc: 15, halfOnSuccess: false });
  });

  it("asks the GM to add the creatures near the target when the map can't measure", () => {
    const { state, resolve } = fight(knifer);
    const result = resolve("spell-ice-knife", {}, [15, 5, 3, 4]);
    expect(saves(state).map((save) => save.target)).toEqual([FOE]);
    expect(result.warnings).toContain(
      "Ice Knife: each creature within 5 feet of Goblin also makes the save - add them by hand."
    );
  });

  it("adds 1d6 Cold for each slot level above 1", () => {
    const { state, resolve } = fight(knifer);
    resolve("spell-ice-knife", { slotLevel: 2 }, [15, 5, 1, 1, 1]);
    expect(state.combat.pendingSaves[0]?.proposedDamage).toBe(3);
  });
});

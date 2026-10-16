import { describe, expect, it } from "vitest";
import { upcastAction } from "../src/item-actions.js";
import { settlePlayerDarts } from "../src/player-damage.js";
import {
  build,
  fighterInput,
  fight,
  FOE,
  FOE2,
  HERO,
  heroTurnAgain,
  view,
  wizardInput,
  WIZARD_SPELLS
} from "./spell-casters.js";

// SRD 5.2.1 Spells: one spell slot per turn; a spell's rays are its own attacks, cast with one slot; a higher slot adds
// rays and darts; Magic Missile's darts strike one creature or several.

const wizard = build(wizardInput(WIZARD_SPELLS));
const strictSlots = (state: ReturnType<typeof fight>["state"]) => {
  state.combat = { ...state.combat, ruleExceptions: { slots: "strict" } };
};

describe("one spell slot per turn", () => {
  it("refuses a second slot spell on the same turn, and allows one again next turn", () => {
    const { state, resolve, hero } = fight(wizard);
    strictSlots(state);
    resolve("spell-misty-step", { targetIds: [] });
    expect(() => resolve("spell-magic-missile", {})).toThrowError(/only one per turn/);
    // A cantrip costs no slot.
    resolve("spell-fire-bolt", {}, [15, 5]);
    heroTurnAgain(state);
    resolve("spell-magic-missile", {});
    expect(hero.spellSlots!.find((slot) => slot.level === 1)!.remaining).toBe(3);
  });

  it("only warns while the table leaves spell slots on Advise", () => {
    const { resolve } = fight(wizard);
    resolve("spell-magic-missile", {});
    expect(resolve("spell-misty-step", { targetIds: [] }).warnings?.join(" ")).toMatch(/only one per turn/);
  });

  it("is waved through when the GM stops policing spell slots", () => {
    const { state, resolve, hero } = fight(wizard);
    state.combat = { ...state.combat, ruleExceptions: { slots: "freeform" } };
    hero.spellSlots = hero.spellSlots!.map((slot) => ({ ...slot, remaining: 0 }));
    expect(resolve("spell-magic-missile", {}).warnings ?? []).toEqual([]);
    expect(() => resolve("spell-misty-step", { targetIds: [] })).not.toThrow();
  });
});

describe("a spell's rays", () => {
  it("spend one slot for the whole cast, and are that spell's alone", () => {
    const { state, resolve, hero } = fight(wizard);
    const before = hero.spellSlots!.find((slot) => slot.level === 2)!.remaining;
    resolve("spell-scorching-ray", {}, [15, 3, 3]);
    expect(state.combat.turn.actionInstance?.components).toEqual({ "spell-scorching-ray": 2 });
    // Neither a cantrip nor a swing comes out of the rays.
    expect(() => resolve("spell-fire-bolt", {}, [15, 5])).toThrowError(/no Fire Bolt left in this action/);
    resolve("spell-scorching-ray", {}, [15, 3, 3]);
    resolve("spell-scorching-ray", { targetIds: [FOE2] }, [15, 3, 3]);
    expect(hero.spellSlots!.find((slot) => slot.level === 2)!.remaining).toBe(before - 1);
  });

  it("gain a ray for each slot level above 2, every ray rolling at that slot", () => {
    const { state, resolve, hero } = fight(wizard);
    resolve("spell-scorching-ray", { slotLevel: 3 }, [15, 3, 3]);
    expect(state.combat.turn.actionInstance).toMatchObject({ components: { "spell-scorching-ray": 3 }, slotLevel: 3 });
    resolve("spell-scorching-ray", {}, [15, 3, 3]);
    expect(hero.spellSlots!.find((slot) => slot.level === 3)!.remaining).toBe(1);
    expect(hero.spellSlots!.find((slot) => slot.level === 2)!.remaining).toBe(3);
  });

  it("never come out of the Attack action's leftover attacks", () => {
    const fighter = build(fighterInput());
    const { resolve, state } = fight(fighter, { distance: 5 });
    resolve("item-greatsword", {}, [15, 3, 3]);
    expect(state.combat.turn.actionInstance?.components).toEqual({ attack: 1 });
    expect(() => resolve("spell-fire-bolt", {}, [15, 5])).toThrowError(/no Fire Bolt left in this action/);
  });
});

describe("Magic Missile's darts", () => {
  it("are rolled one by one and assigned in order, a target named twice taking two", () => {
    const { resolve } = fight(wizard);
    const resolution = resolve("spell-magic-missile", { targetIds: [FOE, FOE, FOE2] }, [1, 2, 3]);
    expect(resolution.damage.map((part) => part.total)).toEqual([2, 3, 4]);
    expect(resolution.damageTotal).toBe(9);
    expect(resolution.damageByTarget).toEqual([
      expect.objectContaining({ targetId: FOE, targetName: "Goblin", total: 5 }),
      expect.objectContaining({ targetId: FOE2, targetName: "Orc", total: 4 })
    ]);
  });

  it("all strike one creature when only one is named", () => {
    const { resolve } = fight(wizard);
    const resolution = resolve("spell-magic-missile", { targetIds: [FOE] }, [1, 1, 1]);
    expect(resolution.damageByTarget).toEqual([expect.objectContaining({ targetId: FOE, total: 6 })]);
  });

  it("gain a dart for each slot level above 1, and can't be over-assigned", () => {
    const { resolve } = fight(wizard);
    expect(resolve("spell-magic-missile", { slotLevel: 3, targetIds: [FOE] }).damage).toHaveLength(5);
    const second = fight(wizard);
    expect(() => second.resolve("spell-magic-missile", { targetIds: [FOE, FOE, FOE, FOE2] })).toThrowError(
      /makes 3 darts; 4 were assigned/
    );
  });

  it("reach each target as its own damage when a player casts them", () => {
    const deps = { resolveDefinition: () => undefined, newId: () => crypto.randomUUID(), now: () => 0 };
    const proposed = fight(wizard);
    const resolution = proposed.resolve("spell-magic-missile", { targetIds: [FOE, FOE2] }, [1, 1, 1]);
    settlePlayerDarts(proposed.state, resolution, "Ansel", HERO, "proposal", deps);
    expect(proposed.state.combat.pendingDamage.map((entry) => [entry.targetActorId, entry.proposedTotal])).toEqual([
      [FOE, 4],
      [FOE2, 2]
    ]);
    const direct = fight(wizard);
    const applied = direct.resolve("spell-magic-missile", { targetIds: [FOE, FOE2] }, [1, 1, 1]);
    settlePlayerDarts(direct.state, applied, "Ansel", HERO, "direct", deps);
    expect(direct.state.actors.find((actor) => actor.id === FOE)!.hp.current).toBe(196);
    expect(direct.state.actors.find((actor) => actor.id === FOE2)!.hp.current).toBe(198);
  });
});

describe("higher-slot rows the source got wrong", () => {
  const spell = (id: string) => view.spellRecord(id)!;

  it("keeps Disintegrate's +40, scales Dissonant Whispers, and heals 10 more per level with Heal", () => {
    expect(spell("disintegrate").castingOptions.find((row) => row.type === "slot_level_7")?.damageRoll).toBe(
      "13d6 + 40"
    );
    expect(spell("dissonant-whispers").castingOptions.find((row) => row.type === "slot_level_3")?.damageRoll).toBe(
      "5d6"
    );
    expect(spell("heal").castingOptions.find((row) => row.type === "slot_level_9")?.damageRoll).toBe("100");
  });

  it("rolls them when cast with that slot", () => {
    const action = (formula: string, healing?: string) => ({
      id: "spell-x",
      name: "X",
      activation: "action" as const,
      description: "X",
      damage: healing ? [] : [{ formula, type: "force" }],
      ...(healing ? { healing: { formula: healing } } : {}),
      spellSlot: { level: 6 }
    });
    expect(upcastAction(action("10d6 + 40"), spell("disintegrate"), 8).damage[0]!.formula).toBe("16d6 + 40");
    expect(upcastAction(action("", "70"), spell("heal"), 7).healing!.formula).toBe("80");
  });

  it("leaves Ice Knife's 1d10 hit alone: the Cold burst is what scales", () => {
    expect(spell("ice-knife").castingOptions.every((row) => row.damageRoll === null)).toBe(true);
  });
});

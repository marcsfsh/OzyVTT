import { describe, expect, it } from "vitest";
import { RulesBlockedError } from "../src/game-store.js";
import { applyRest } from "../src/rests.js";
import { catalog, FOE, fight, HERO, heroTurnAgain } from "./spell-casters.js";
import { druid } from "./shape-shifters.js";

// SRD 5.2.1 Circle of the Land, Natural Recovery: "You can cast one of the level 1+ spells that you have prepared from
// your Circle Spells feature without expending a spell slot, and you must finish a Long Rest before you do so again."

const slotsOf = (hero: ReturnType<typeof fight>["hero"]) => JSON.stringify(hero.spellSlots);

describe("Natural Recovery's free Circle Spell", () => {
  it("casts a land spell of level 1+ with no slot once, and its other land spells share the one use", () => {
    const sheet = druid(6);
    const { state, resolve, hero, action } = fight(sheet);
    // The Polar land's level 1+ spells each have a free casting on one counter; its cantrip has none.
    for (const id of ["fog-cloud", "hold-person", "sleet-storm"])
      expect(action(`spell-${id}-free`).uses).toMatchObject({
        limit: 1,
        per: "long-rest",
        pool: "natural-recovery-cast"
      });
    expect(sheet.actions.some((entry) => entry.id === "spell-ray-of-frost-free")).toBe(false);

    const slots = slotsOf(hero);
    resolve("spell-hold-person-free", { targetIds: [FOE] });
    expect(slotsOf(hero)).toBe(slots);
    expect(hero.actionUses["natural-recovery-cast"]).toBe(1);

    heroTurnAgain(state);
    expect(() => resolve("spell-hold-person-free", { targetIds: [FOE] })).toThrow(RulesBlockedError);
    expect(() => resolve("spell-sleet-storm-free", { targetIds: [] })).toThrow(RulesBlockedError);

    // A Long Rest gives it back.
    state.combat = { ...state.combat, active: false };
    applyRest(state, HERO, "long", () => sheet, catalog);
    expect(hero.actionUses["natural-recovery-cast"]).toBeUndefined();
  });

  it("isn't there before Druid level 6", () => {
    expect(druid(5).actions.some((entry) => entry.id === "spell-hold-person-free")).toBe(false);
  });
});

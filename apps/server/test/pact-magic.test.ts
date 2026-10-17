import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { endEncounter } from "../src/encounter.js";
import { castSlot } from "../src/resolution/economy.js";
import { applyRest } from "../src/rests.js";
import { setSpellSlotRemaining } from "../src/spellcasting.js";
import { spendLooseUses } from "../src/tap-routing.js";
import { build, catalog, fight, HERO, heroTurnAgain, warlockInput } from "./spell-casters.js";

// SRD 5.2.1 Pact Magic: a Warlock's slots are all one level, cast any of its spells at that level, and come back on
// a Short or Long Rest. Multiclassed, pact slots and spell slots each cast either class's spells.

const warlock = build(warlockInput(["hex", "hellish-rebuke", "hold-person", "misty-step"]));

describe("a built Warlock's Pact Magic", () => {
  it("is one pool of pact slots, with no spell slots beside it", () => {
    const { hero } = fight(warlock);
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 2 });
    expect(hero.spellSlots).toEqual([]);
  });

  it("is what a cast spends, at the pact level, until it runs out", () => {
    const { hero, resolve, state } = fight(warlock);
    resolve("spell-hold-person", {});
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 1 });
    heroTurnAgain(state);
    resolve("spell-misty-step", { targetIds: [] });
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 0 });
    heroTurnAgain(state);
    state.combat = { ...state.combat, ruleExceptions: { slots: "strict" } };
    expect(() => resolve("spell-hold-person", {})).toThrowError(/level 3 Pact Magic slot, and Vex has none left/);
  });

  it("comes back on a Short Rest", () => {
    const { hero, resolve, state } = fight(warlock);
    resolve("spell-hold-person", {});
    endEncounter(state);
    applyRest(state, HERO, "short", () => warlock, catalog);
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 2 });
  });

  it("is spent outside a fight too", () => {
    const { hero } = fight(warlock, { combat: false });
    const actions = effectiveActions(warlock, hero, catalog);
    spendLooseUses(
      hero,
      actions.find((action) => action.id === "spell-hex")!,
      actions
    );
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 1 });
  });
});

describe("a Warlock built before Pact Magic was its own pool", () => {
  const { pact: _pact, ...casting } = warlock.spellcasting!;
  const legacy = { ...warlock, spellcasting: { ...casting, slots: [{ level: 3, max: 2 }] } };

  it("reads its pact row as pact slots, not spell slots as well", () => {
    const { hero } = fight(legacy);
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 2 });
    expect(hero.spellSlots).toEqual([]);
  });

  it("loses the twin spell slots it was seeded with on its next Long Rest", () => {
    const { hero, state } = fight(legacy, { combat: false });
    hero.spellSlots = [{ level: 3, remaining: 0 }];
    applyRest(state, HERO, "long", () => legacy, catalog);
    expect(hero.spellSlots).toEqual([]);
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 2 });
  });
});

describe("an imported Warlock's Pact Magic", () => {
  /** What the PDF reader writes: a pact pool, no spell slots, spells with no actions. */
  const imported = ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "test", version: "1" },
    name: "Imported Warlock",
    size: "medium",
    armorClass: 13,
    hitPoints: { maximum: 30 },
    speedFeet: 30,
    proficiencyBonus: 3,
    abilityScores: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    actions: [],
    token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
    extensions: {},
    spellcasting: {
      ability: "cha",
      saveDc: 14,
      attackBonus: 6,
      slots: [],
      pact: { level: 3, max: 2 },
      spells: [{ id: "hold-person", name: "Hold Person", level: 2, prepared: true }]
    }
  });

  it("seeds the pact pool, and the sheet's spend and restore reach it", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, imported, HERO, "public", catalog);
    const hero = state.actors[0];
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 2 });
    setSpellSlotRemaining(state, HERO, 3, 1, () => imported, catalog, true);
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 1 });
    // Clamped to the pool's size, and refused at a level the pool doesn't have.
    setSpellSlotRemaining(state, HERO, 3, 4, () => imported, catalog, true);
    expect(hero.pactSlots).toEqual({ level: 3, remaining: 2 });
    expect(() => setSpellSlotRemaining(state, HERO, 2, 1, () => imported, catalog, true)).toThrowError(
      /no level 2 Pact Magic slots/
    );
  });
});

describe("a multiclass caster's two pools", () => {
  const pools = (spell: number, pact: number) => ({
    spellSlots: [
      { level: 1, remaining: spell },
      { level: 2, remaining: spell }
    ],
    pactSlots: { level: 2, remaining: pact }
  });

  it("casts with the lowest slot left at or above the spell, a pact slot first at its level", () => {
    expect(castSlot(pools(1, 1), 1, undefined)).toEqual({ level: 1, pact: false });
    expect(castSlot(pools(1, 1), 2, undefined)).toEqual({ level: 2, pact: true });
    expect(castSlot(pools(1, 0), 2, undefined)).toEqual({ level: 2, pact: false });
    expect(castSlot(pools(0, 1), 1, undefined)).toEqual({ level: 2, pact: true });
  });

  it("spends a spell slot at the pact level once the pact slots are gone", () => {
    expect(castSlot(pools(1, 1), 1, 2)).toEqual({ level: 2, pact: true });
    expect(castSlot(pools(1, 0), 1, 2)).toEqual({ level: 2, pact: false });
  });
});

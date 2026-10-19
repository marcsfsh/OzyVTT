import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest, type GenerateCharacterInput } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { conversionOffers, convertResource, type ConversionRequest } from "../src/conversions.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyRest } from "../src/rests.js";

// SRD 5.2.1 classes.md: Font of Magic, Font of Inspiration, Wild Resurgence, Archdruid's Nature Magician, Arcane
// Recovery, Natural Recovery, Magical Cunning and Eldritch Master, Sorcerous Restoration, Sorcery Incarnate, and the
// uses Intimidating Presence, Holy Nimbus, Dragon Wings and Hurl Through Hell restore. magic-items.md: Pearl of Power.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const ACTOR_ID = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4b";
const OTHER_ID = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4c";

function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

const generated = (input: GenerateCharacterInput): ActorDefinition =>
  buildCharacterDefinition(generateCharacterRequest(input, library, policy, seeded(1)).request, library, policy);

/** A character on a table, with helpers to spend, convert and rest. */
function table(input: GenerateCharacterInput) {
  const state: GameState = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, generated(input), ACTOR_ID, "public", catalog);
  const actor = () => state.actors.find((entry) => entry.id === ACTOR_ID)!;
  const resolve = (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;
  const deps = { resolveDefinition: resolve, catalog };
  const pool = (id: string) =>
    actionPools(effectiveActions(resolve(actor().definitionId!), actor(), catalog)).find((entry) => entry.id === id)!;
  return {
    state,
    actor,
    spend: (poolId: string, amount: number) => {
      actor().actionUses = { ...actor().actionUses, [poolId]: (actor().actionUses[poolId] ?? 0) + amount };
    },
    left: (poolId: string) => pool(poolId).limit - (actor().actionUses[poolId] ?? 0),
    slot: (level: number) => actor().spellSlots?.find((entry) => entry.level === level)?.remaining ?? 0,
    setSlot: (level: number, remaining: number) => {
      actor().spellSlots = actor().spellSlots!.map((entry) =>
        entry.level === level ? { ...entry, remaining } : entry
      );
    },
    convert: (request: ConversionRequest) => convertResource(state, ACTOR_ID, request, deps),
    offer: (id: string) => conversionOffers(state, actor(), deps).find((entry) => entry.id === id),
    rest: (kind: "short" | "long") => applyRest(state, ACTOR_ID, kind, resolve, catalog)
  };
}

describe("Font of Magic", () => {
  it("turns a spell slot into Sorcery Points equal to its level, never above the maximum", () => {
    const sorcerer = table({ classId: "sorcerer", level: 5 });
    sorcerer.spend("sorcery-points", 3);
    const before = sorcerer.slot(2);
    expect(sorcerer.convert({ conversionId: "font-of-magic-points", level: 2 })).toMatch(/2 Sorcery Points/);
    expect(sorcerer.slot(2)).toBe(before - 1);
    expect(sorcerer.actor().actionUses["sorcery-points"]).toBe(1);
    // A level 3 slot would give 3, and only 1 is spent.
    sorcerer.convert({ conversionId: "font-of-magic-points", level: 3 });
    expect(sorcerer.actor().actionUses["sorcery-points"]).toBeUndefined();
    expect(() => sorcerer.convert({ conversionId: "font-of-magic-points", level: 1 })).toThrow(/full/);
  });

  it("buys a slot at the printed cost, above the table's maximum, and the slot vanishes on a Long Rest", () => {
    const sorcerer = table({ classId: "sorcerer", level: 5 });
    const max = sorcerer.slot(3);
    sorcerer.convert({ conversionId: "font-of-magic-slot", level: 3 });
    expect(sorcerer.slot(3)).toBe(max + 1);
    expect(sorcerer.actor().actionUses["sorcery-points"]).toBe(5);
    sorcerer.rest("long");
    expect(sorcerer.slot(3)).toBe(max);
  });

  it("refuses a slot the Sorcerer's level can't make, or one the points don't cover", () => {
    const sorcerer = table({ classId: "sorcerer", level: 4 });
    expect(() => sorcerer.convert({ conversionId: "font-of-magic-slot", level: 3 })).toThrow(/levels? 1, 2/);
    sorcerer.spend("sorcery-points", 2);
    expect(() => sorcerer.convert({ conversionId: "font-of-magic-slot", level: 2 })).toThrow(/costs 3/);
  });

  it("takes a Bonus Action on the Sorcerer's own turn in a fight", () => {
    const sorcerer = table({ classId: "sorcerer", level: 5 });
    const { state } = sorcerer;
    state.combat = {
      ...state.combat,
      active: true,
      turnActorId: OTHER_ID,
      initiative: [
        { actorId: OTHER_ID, score: 20, tieBreaker: 0 },
        { actorId: ACTOR_ID, score: 10, tieBreaker: 0 }
      ] as GameState["combat"]["initiative"]
    };
    expect(sorcerer.offer("font-of-magic-slot")?.reason).toMatch(/Bonus Action, on/);
    state.combat = { ...state.combat, turnActorId: ACTOR_ID };
    sorcerer.convert({ conversionId: "font-of-magic-slot", level: 1 });
    expect(state.combat.turn.bonusActionUsed).toBe(true);
    expect(() => sorcerer.convert({ conversionId: "font-of-magic-slot", level: 1 })).toThrow(/Bonus Action this turn/);
  });
});

describe("Font of Inspiration", () => {
  it("gives a Bard 5 a Bardic Inspiration for a slot, and is refused while it is full", () => {
    const bard = table({ classId: "bard", level: 5 });
    expect(() => bard.convert({ conversionId: "font-of-inspiration", level: 1 })).toThrow(/full/);
    bard.spend("bardic-inspiration", 2);
    bard.convert({ conversionId: "font-of-inspiration", level: 1 });
    expect(bard.actor().actionUses["bardic-inspiration"]).toBe(1);
  });

  it("is not offered to a Bard 4", () => {
    expect(table({ classId: "bard", level: 4 }).offer("font-of-inspiration")).toBeUndefined();
  });
});

describe("slot recovery when a Short Rest finishes", () => {
  it("recovers a Wizard 4's slots adding up to 2 levels, once per Long Rest", () => {
    const wizard = table({ classId: "wizard", level: 4 });
    wizard.setSlot(1, 0);
    wizard.setSlot(2, 0);
    expect(wizard.offer("arcane-recovery")?.reason).toMatch(/when a Short Rest finishes/);
    wizard.rest("short");
    expect(() => wizard.convert({ conversionId: "arcane-recovery", levels: [2, 1] })).toThrow(/up to 2 levels/);
    wizard.convert({ conversionId: "arcane-recovery", levels: [1, 1] });
    expect(wizard.slot(1)).toBe(2);
    expect(wizard.offer("arcane-recovery")?.reason).toMatch(/comes back on a Long Rest/);
    wizard.rest("short");
    expect(() => wizard.convert({ conversionId: "arcane-recovery", levels: [2] })).toThrow(/comes back on a Long Rest/);
  });

  it("refuses a level 6 slot and a slot that isn't spent", () => {
    const wizard = table({ classId: "wizard", level: 13 });
    wizard.setSlot(6, 0);
    wizard.setSlot(1, 3);
    wizard.rest("short");
    expect(() => wizard.convert({ conversionId: "arcane-recovery", levels: [6] })).toThrow(/level 6 or higher/);
    expect(() => wizard.convert({ conversionId: "arcane-recovery", levels: [1, 1] })).toThrow(/hasn't spent/);
  });

  it("gives a Sorcerer 5 back up to 2 Sorcery Points with Sorcerous Restoration", () => {
    const sorcerer = table({ classId: "sorcerer", level: 5 });
    sorcerer.spend("sorcery-points", 4);
    sorcerer.rest("short");
    expect(() => sorcerer.convert({ conversionId: "sorcerous-restoration", count: 3 })).toThrow(/1 to 2/);
    sorcerer.convert({ conversionId: "sorcerous-restoration", count: 2 });
    expect(sorcerer.actor().actionUses["sorcery-points"]).toBe(2);
    expect(sorcerer.offer("sorcerous-restoration")?.reason).toMatch(/Long Rest/);
  });
});

describe("Magical Cunning", () => {
  it("regains half a Warlock's Pact Magic slots, rounded up, outside a fight, once per Long Rest", () => {
    const warlock = table({ classId: "warlock", level: 5 });
    const pact = warlock.actor().pactSlots!;
    warlock.actor().pactSlots = { ...pact, remaining: 0 };
    warlock.convert({ conversionId: "magical-cunning" });
    expect(warlock.actor().pactSlots!.remaining).toBe(Math.ceil(pact.remaining / 2));
    expect(warlock.offer("magical-cunning")?.reason).toMatch(/comes back on a Long Rest/);
  });
});

describe("Wild Resurgence", () => {
  it("gives a Wild Shape for a slot only when none is left, and a level 1 slot for a Wild Shape once per Long Rest", () => {
    const druid = table({ classId: "druid", level: 5 });
    expect(druid.offer("wild-resurgence-shape")?.reason).toMatch(/still has uses/);
    const slot1 = druid.slot(1);
    druid.convert({ conversionId: "wild-resurgence-slot" });
    expect(druid.slot(1)).toBe(slot1 + 1);
    expect(() => druid.convert({ conversionId: "wild-resurgence-slot" })).toThrow(/after a Long Rest/);
    druid.spend("wild-shape", druid.left("wild-shape"));
    druid.convert({ conversionId: "wild-resurgence-shape", level: 2 });
    expect(druid.left("wild-shape")).toBe(1);
  });
});

describe("restoring a spent use with another resource", () => {
  it("restores a Berserker's Intimidating Presence with a use of Rage", () => {
    const barbarian = table({ classId: "barbarian", level: 14, subclassId: "path-of-the-berserker" });
    expect(barbarian.offer("intimidating-presence-restore")?.reason).toMatch(/isn't spent/);
    barbarian.spend("intimidating-presence", 1);
    const rage = barbarian.left("rage");
    barbarian.convert({ conversionId: "intimidating-presence-restore" });
    expect(barbarian.left("rage")).toBe(rage - 1);
    expect(barbarian.left("intimidating-presence")).toBe(1);
  });
});

describe("a player gets back only what a feature gives", () => {
  it("refuses a conversion the character's features don't give", () => {
    const fighter = table({ classId: "fighter", level: 5 });
    expect(() => fighter.convert({ conversionId: "font-of-magic-points", level: 1 })).toThrow(/no feature/);
  });
});

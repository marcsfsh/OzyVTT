import { describe, expect, it } from "vitest";
import { addActorFromDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { releaseGlyphSpells } from "../src/stored-cast-release.js";
import { catalog, FOE, HERO, view } from "./spell-casters.js";
import { actorOf, answer, cast, caster, nextCommand, resolveAs, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 spells cast now and held for later at their caster's numbers: Contingency's contingent spell, Glyph of
// Warding's spell glyph, a Ring of Spell Storing's spells and a shield guardian's Spell Storing.

const GUARDIAN = "10000000-0000-4000-8000-000000000077";

const slotsLeft = (table: ReturnType<typeof caster>, level: number) =>
  actorOf(table.state, HERO).spellSlots!.find((slot) => slot.level === level)!.remaining;
const heroAction = (table: ReturnType<typeof caster>, test: (id: string) => boolean) =>
  effectiveActions(wizard, actorOf(table.state, HERO), catalog).find((action) => test(action.id));
const carry = (table: ReturnType<typeof caster>, id: string, name: string, attuned = false) =>
  actorOf(table.state, HERO).inventory.push({ id, name, quantity: 1, equipped: true, attuned });

describe("Contingency", () => {
  it("holds the next fitting spell its caster casts, both slots spent, and releases it on the caster alone", () => {
    const table = caster({ combat: false });
    carry(table, "statuette-of-yourself", "Statuette of yourself");
    cast(table, "contingency", { targetIds: [] });
    expect(slotsLeft(table, 6)).toBe(2);
    cast(table, "fly", { targetIds: [HERO] });
    expect(slotsLeft(table, 3)).toBe(2);
    const held = actorOf(table.state, HERO).effects.find((effect) => effect.name === "Contingency (Fly)")!;
    expect(held.storedCast).toMatchObject({ spellId: "fly", level: 3, saveDc: 15, via: "contingency" });
    expect(held.duration).toEqual({ type: "minutes", remaining: 14_400 });
    expect(actorOf(table.state, HERO).effects.some((effect) => effect.name === "Fly")).toBe(false);
    const release = heroAction(table, (id) => id === `stored-cast-${held.id}`)!;
    expect(release.activation).toBe("other");
    expect(() => resolveAs(table, release, { targetIds: [FOE] })).toThrow(/alone/);
    resolveAs(table, release, { targetIds: [HERO] });
    expect(actorOf(table.state, HERO).effects.some((effect) => effect.name.startsWith("Fly"))).toBe(true);
    expect(actorOf(table.state, HERO).effects.some((effect) => effect.name.startsWith("Contingency"))).toBe(false);
    expect(slotsLeft(table, 3)).toBe(2);
  });

  it("ends without its statuette", () => {
    const table = caster({ combat: false });
    carry(table, "statuette-of-yourself", "Statuette of yourself");
    cast(table, "contingency", { targetIds: [] });
    cast(table, "fly", { targetIds: [HERO] });
    actorOf(table.state, HERO).inventory = actorOf(table.state, HERO).inventory.filter(
      (row) => row.id !== "statuette-of-yourself"
    );
    const release = heroAction(table, (id) => id.startsWith("stored-cast-"))!;
    expect(() => resolveAs(table, release, { targetIds: [HERO] })).toThrow(/statuette/);
  });
});

describe("Ring of Spell Storing", () => {
  it("stores a spell cast into it, up to 5 levels, and its attuned wearer casts it at the caster's numbers", () => {
    const table = caster({ combat: false });
    carry(table, "ring-of-spell-storing", "Ring of Spell Storing", true);
    const holdOut = () =>
      resolveAs(
        table,
        heroAction(table, (id) => id.includes("hold-out"))!,
        { targetIds: [] }
      );
    holdOut();
    cast(table, "hold-person", { targetIds: [FOE] });
    expect(table.state.combat.pendingSaves).toEqual([]);
    const ring = () => actorOf(table.state, HERO).inventory.find((row) => row.id === "ring-of-spell-storing")!;
    expect(ring().storedCasts).toEqual([expect.objectContaining({ spellId: "hold-person", level: 2, saveDc: 15 })]);
    // Four levels more do not fit beside the two held: the spell is lost.
    holdOut();
    cast(table, "fly", { targetIds: [HERO], slotLevel: 4 });
    expect(ring().storedCasts).toHaveLength(1);
    expect(actorOf(table.state, HERO).effects.some((effect) => effect.name.startsWith("Fly"))).toBe(false);
    const before = slotsLeft(table, 2);
    const fromRing = heroAction(table, (id) => id === "stored-cast-ring-of-spell-storing-0")!;
    resolveAs(table, fromRing, { targetIds: [FOE] });
    expect(table.state.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: FOE, ability: "wis", dc: 15 })
    ]);
    expect(slotsLeft(table, 2)).toBe(before);
    expect(ring().storedCasts).toEqual([]);
  });
});

describe("a shield guardian's Spell Storing", () => {
  it("stores a spell its commander casts on it, and casts it at the commander's numbers", () => {
    const table = caster({ combat: false });
    const statBlock = view.monster("shield-guardian")!;
    addActorFromDefinition(table.state, statBlock, GUARDIAN, "public", catalog);
    table.state.definitions.push({ id: "shield-guardian", definition: statBlock } as never);
    actorOf(table.state, GUARDIAN).control = { by: HERO, side: "party" } as never;
    cast(table, "blindnessdeafness", { targetIds: [GUARDIAN] });
    expect(table.state.combat.pendingSaves).toEqual([]);
    const stored = actorOf(table.state, GUARDIAN).effects.find((effect) => effect.storedCast)!;
    expect(stored.storedCast).toMatchObject({ spellId: "blindnessdeafness", saveDc: 15, via: "guardian" });
    const guardianDefinition = table.state.definitions.find(
      (entry) => entry.id === actorOf(table.state, GUARDIAN).definitionId
    )?.definition;
    const release = effectiveActions(guardianDefinition, actorOf(table.state, GUARDIAN), catalog).find((action) =>
      action.id.startsWith("stored-cast-")
    )!;
    resolveAs(table, release, { targetIds: [FOE] }, [], GUARDIAN);
    expect(table.state.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: FOE, ability: "con", dc: 15 })
    ]);
    expect(actorOf(table.state, GUARDIAN).effects.some((effect) => effect.storedCast)).toBe(false);
  });
});

describe("Glyph of Warding's spell glyph", () => {
  it("holds the next spell of the glyph's level or lower, and releases it on the creature that sets it off", () => {
    const table = caster({ combat: false });
    carry(table, "powdered-diamond", "Powdered diamond (200 GP)");
    cast(table, "glyph-of-warding", { targetIds: [], areaPlaced: true, areaOrigin: { x: 100, y: 100 } });
    cast(table, "hold-person", { targetIds: [FOE] });
    expect(table.state.combat.pendingSaves).toEqual([]);
    const glyph = table.state.combat.spellZones.find((zone) => zone.spellId === "glyph-of-warding")!;
    expect(glyph.storedCast).toMatchObject({ spellId: "hold-person", level: 2 });
    table.state.combat = {
      ...table.state.combat,
      spellZones: table.state.combat.spellZones.map((zone) =>
        zone.id === glyph.id ? { ...zone, bursting: true, setOffBy: FOE } : zone
      )
    };
    releaseGlyphSpells(table.state, {
      geometry: null,
      resolveDefinition: (id) => table.state.definitions.find((entry) => entry.id === id)?.definition,
      catalog,
      rollDie: () => 3,
      newId: nextCommand,
      now: () => "2026-10-18T00:00:00.000Z",
      distanceFeet: () => 5
    });
    expect(table.state.combat.spellZones).toEqual([]);
    expect(table.state.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: FOE, ability: "wis", dc: 15 })
    ]);
    answer(table.state, FOE, 1);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toContain("paralyzed");
  });
});

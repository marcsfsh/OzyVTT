import { describe, expect, it } from "vitest";
import { armorClassInPlay, type GameState } from "@vtt/domain";
import { addEffect, makeEffect } from "../src/effects.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { OFF_PLANE_TAG } from "../src/off-plane.js";
import { spellWardOf } from "../src/resolution/spell-wards.js";
import { settleZoneAuras } from "../src/zone-auras.js";
import { teleportBarredFor } from "../src/zone-barriers.js";
import { ALLY, catalog, fight, FOE, HERO } from "./spell-casters.js";
import { carry, cell, place, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Antimagic Field: no spells or Magic actions inside, nothing magical reaching in, magic items' properties
// off, ongoing spells suppressed with their summons winking out, and no teleporting in or out.

const CAST = "63000000-0000-4000-8000-0000000000c1";
const deps = () => zoneDeps();
const actorOf = (state: GameState, actorId: string) => state.actors.find((actor) => actor.id === actorId)!;
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};

function field() {
  const caster = fight(wizardAt(15, ["antimagic-field", "magic-missile"]), { combat: false, ally: true });
  place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(11, 10), [FOE]: cell(20, 10) });
  carry(caster.state, HERO, "Iron filings");
  caster.resolve("spell-antimagic-field", { targetIds: [], commandId: CAST });
  settleZoneAuras(caster.state, deps());
  return caster;
}

describe("Antimagic Field", () => {
  it("wraps its caster and the creatures within 10 feet, and no one else", () => {
    const { state } = field();
    const inField = (actorId: string) =>
      actorOf(state, actorId).effects.some((effect) => effect.tags.includes("antimagic"));
    expect(inField(HERO)).toBe(true);
    expect(inField(ALLY)).toBe(true);
    expect(inField(FOE)).toBe(false);
  });

  it("refuses a spell cast inside it", () => {
    const { resolve } = field();
    expect(() => resolve("spell-magic-missile", { targetIds: [FOE] })).toThrowError(/can't cast spells/);
  });

  it("keeps a spell cast from outside off the creatures inside, its area and its target alike", () => {
    const { state } = field();
    const spell = { id: "fire-bolt", school: "evocation" };
    expect(spellWardOf(state, actorOf(state, ALLY), spell, FOE, { catalog })).toBe("Antimagic Field");
    expect(spellWardOf(state, actorOf(state, FOE), spell, HERO, { catalog })).toBeNull();
  });

  it("leaves a magic item inside without its properties, and gives them back outside", () => {
    const { state } = field();
    const ally = actorOf(state, ALLY);
    ally.inventory = [
      ...ally.inventory,
      { id: "ring-of-protection", name: "Ring of Protection", quantity: 1, equipped: true, attuned: true }
    ];
    expect(deriveEquipment(ally, undefined, catalog).sources.map((source) => source.itemName)).not.toContain(
      "Ring of Protection"
    );
    moveTo(state, ALLY, [30, 30]);
    settleZoneAuras(state, deps());
    expect(
      deriveEquipment(actorOf(state, ALLY), undefined, catalog).sources.map((source) => source.itemName)
    ).toContain("Ring of Protection");
  });

  it("suppresses an ongoing spell's modifiers and conditions on a creature inside while its time runs", () => {
    const caster = fight(wizardAt(15, ["antimagic-field"]), { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(30, 10), [FOE]: cell(20, 10) });
    carry(caster.state, HERO, "Iron filings");
    addEffect(
      caster.state,
      ALLY,
      makeEffect({
        id: "bless",
        name: "Bless",
        sourceActorId: FOE,
        sourceName: "Goblin",
        startedRound: 1,
        duration: { type: "minutes", remaining: 1 },
        spell: { id: "bless", level: 1 },
        modifiers: [{ type: "save-bonus", amount: 2 }]
      })
    );
    addEffect(
      caster.state,
      ALLY,
      makeEffect({
        id: "hold",
        name: "Hold Person",
        sourceActorId: FOE,
        sourceName: "Goblin",
        startedRound: 1,
        duration: { type: "minutes", remaining: 1 },
        spell: { id: "hold-person", level: 2 },
        linkedConditionIds: ["paralyzed"]
      })
    );
    caster.resolve("spell-antimagic-field", { targetIds: [], commandId: CAST });
    moveTo(caster.state, ALLY, [11, 10]);
    settleZoneAuras(caster.state, deps());
    const ally = actorOf(caster.state, ALLY);
    expect(deriveEquipment(ally, undefined, catalog).carriers.some((carrier) => carrier.label === "Bless")).toBe(false);
    expect(ally.conditions.map((condition) => condition.id)).not.toContain("paralyzed");
    expect(ally.effects.some((effect) => effect.id === "hold")).toBe(true);
    moveTo(caster.state, ALLY, [30, 10]);
    settleZoneAuras(caster.state, deps());
    expect(actorOf(caster.state, ALLY).conditions.map((condition) => condition.id)).toContain("paralyzed");
  });

  it("suppresses an ongoing spell's bonus to Armor Class inside it", () => {
    const { state } = field();
    addEffect(
      state,
      ALLY,
      makeEffect({
        id: "faith",
        name: "Shield of Faith",
        sourceActorId: FOE,
        sourceName: "Goblin",
        startedRound: 1,
        duration: { type: "minutes", remaining: 10 },
        spell: { id: "shield-of-faith", level: 1 },
        armorClassBonus: 2
      })
    );
    expect(armorClassInPlay(actorOf(state, ALLY))).toBe(actorOf(state, ALLY).armorClass);
    moveTo(state, ALLY, [30, 30]);
    settleZoneAuras(state, deps());
    expect(armorClassInPlay(actorOf(state, ALLY))).toBe(actorOf(state, ALLY).armorClass! + 2);
  });

  it("winks out a creature a spell summoned while it is inside", () => {
    const { state } = field();
    actorOf(state, ALLY).summon = {
      by: FOE,
      actionId: "spell-find-familiar",
      name: "Find Familiar",
      spell: { id: "find-familiar", level: 1 }
    };
    settleZoneAuras(state, deps());
    expect(actorOf(state, ALLY).effects.some((effect) => effect.tags.includes(OFF_PLANE_TAG))).toBe(true);
  });

  it("bars teleporting out of it and into it", () => {
    const { state } = field();
    expect(teleportBarredFor(state, ALLY, cell(11, 10), cell(30, 30), 1, deps())).toBe("out of Antimagic Field");
    expect(teleportBarredFor(state, FOE, cell(20, 10), cell(10, 11), 1, deps())).toBe("into Antimagic Field");
  });
});

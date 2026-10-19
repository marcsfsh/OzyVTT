import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { endEffect, type EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { settleZoneAuras } from "../src/zone-auras.js";
import { ALLY, build, clericInput, druidInput, fight, FOE, FOE2, HERO } from "./spell-casters.js";
import { carry, cell, clericAt, drawArea, place, turnDeps, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 spells whose areas give the creatures in them something while they stand there: Holy Aura's Advantage on
// saving throws and the Disadvantage on attack rolls against them, Aura of Life's Resistance to Necrotic damage and its
// 1 Hit Point, Pass without Trace's +10 to Stealth checks, and Silence's Deafened.

const CAST = "64000000-0000-4000-8000-000000000001";
const auraOf = (state: GameState, actorId: string) =>
  state.actors.find((actor) => actor.id === actorId)!.effects.find((effect) => effect.tags.includes("zone-aura"));
/** The ally joins the party, so the caster's aura counts it among its allies. */
const befriend = (state: GameState) => {
  state.actors.find((actor) => actor.id === ALLY)!.kind = "player-character";
};
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};

describe("Holy Aura", () => {
  const cleric = clericAt(15, ["holy-aura"]);

  function aura() {
    const caster = fight(cleric, { ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(14, 10), [FOE]: cell(10, 14), [FOE2]: cell(40, 40) });
    befriend(caster.state);
    carry(caster.state, HERO, "Reliquary");
    caster.resolve("spell-holy-aura", { targetIds: [], commandId: CAST });
    settleZoneAuras(caster.state, zoneDeps());
    return caster;
  }

  it("gives the caster and its allies in the Emanation Advantage on saves and Disadvantage to attackers", () => {
    const { state } = aura();
    for (const actorId of [HERO, ALLY])
      expect(auraOf(state, actorId)).toMatchObject({
        name: "Holy Aura",
        sourceActorId: HERO,
        modifiers: [
          { type: "roll-mode", roll: "save", mode: "advantage" },
          { type: "roll-mode", roll: "incoming-attack", mode: "disadvantage" }
        ]
      });
    // An enemy in the aura isn't one of the creatures chosen.
    expect(auraOf(state, FOE)).toBeUndefined();
  });

  it("blinds a Fiend or an Undead that hits an affected creature in melee, on a failed save at the spell's DC", () => {
    const { state } = aura();
    expect(auraOf(state, ALLY)?.struck).toEqual({
      creatureTypes: ["fiend", "undead"],
      save: { ability: "con", conditions: ["blinded"], dc: state.combat.spellZones[0]!.dc }
    });
    expect(state.combat.spellZones[0]!.dc).toBe(cleric.spellcasting?.saveDc);
  });

  it("goes with a creature that leaves it, and comes back as it returns", () => {
    const { state } = aura();
    moveTo(state, ALLY, [30, 10]);
    expect(settleZoneAuras(state, zoneDeps())).toBe(true);
    expect(auraOf(state, ALLY)).toBeUndefined();
    moveTo(state, ALLY, [12, 10]);
    settleZoneAuras(state, zoneDeps());
    expect(auraOf(state, ALLY)).toBeDefined();
    // Nothing moved, so nothing changes.
    expect(settleZoneAuras(state, zoneDeps())).toBe(false);
  });

  it("ends on everyone as the caster's Concentration ends", () => {
    const { state, hero } = aura();
    endEffect(state, HERO, hero.effects.find((effect) => effect.concentration)!.id);
    expect(auraOf(state, ALLY)).toBeUndefined();
    expect(auraOf(state, HERO)).toBeUndefined();
  });
});

describe("Aura of Life", () => {
  const cleric = clericAt(7, ["aura-of-life"]);

  it("gives Resistance to Necrotic damage, and 1 Hit Point to an ally at 0 that starts its turn there", () => {
    const caster = fight(cleric, { ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(14, 10), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    befriend(caster.state);
    caster.resolve("spell-aura-of-life", { targetIds: [], commandId: CAST });
    settleZoneAuras(caster.state, zoneDeps());
    expect(auraOf(caster.state, ALLY)?.modifiers).toEqual([{ type: "damage-resistance", damageTypes: ["necrotic"] }]);
    const ally = caster.state.actors.find((actor) => actor.id === ALLY)!;
    ally.hp = { ...ally.hp, current: 0 };
    ally.deathSaves = { successes: 0, failures: 0, stable: false };
    // Round the order to the ally's turn: the hero's, the foes', then the ally's.
    const events: EffectNarration[] = [];
    for (let step = 0; step < 4 && caster.state.combat.turnActorId !== ALLY; step++)
      nextInitiativeTurn(caster.state, events, turnDeps());
    expect(caster.state.combat.turnActorId).toBe(ALLY);
    expect(events.map((event) => event.text)).toContain("Bran regains 1 Hit Point in Aura of Life.");
    expect(ally.hp.current).toBe(1);
  });
});

describe("Pass without Trace and Silence", () => {
  it("Pass without Trace: +10 to Stealth checks for the caster and its allies in the aura", () => {
    const caster = fight(build(druidInput(["pass-without-trace"])), { ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(15, 10), [FOE]: cell(12, 10), [FOE2]: cell(40, 40) });
    befriend(caster.state);
    caster.resolve("spell-pass-without-trace", { targetIds: [], commandId: CAST });
    settleZoneAuras(caster.state, zoneDeps());
    expect(auraOf(caster.state, HERO)?.modifiers).toEqual([
      expect.objectContaining({ type: "check-bonus", amount: 10 })
    ]);
    expect(auraOf(caster.state, ALLY)).toBeDefined();
    expect(auraOf(caster.state, FOE)).toBeUndefined();
  });

  it("Silence: every creature inside the Sphere is Deafened, and hears again outside it", () => {
    const caster = fight(build(clericInput(["silence"])));
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-silence", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 4);
    settleZoneAuras(caster.state, zoneDeps());
    const goblin = caster.state.actors.find((actor) => actor.id === FOE)!;
    expect(goblin.conditions.map((condition) => condition.id)).toContain("deafened");
    moveTo(caster.state, FOE, [30, 10]);
    settleZoneAuras(caster.state, zoneDeps());
    expect(goblin.conditions.map((condition) => condition.id)).not.toContain("deafened");
  });
});

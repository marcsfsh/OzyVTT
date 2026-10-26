import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { setCondition } from "../src/actor-conditions.js";
import { standingCover } from "../src/cover.js";
import { settleZoneAuras } from "../src/zone-auras.js";
import { ALLY, fight, FOE, HERO } from "./spell-casters.js";
import { cell, drawArea, druidAt, place, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Nature's Sanctuary (Circle of the Land 14): "As a Magic action, you can expend a use of your Wild Shape and
// cause spectral trees and vines to appear in a 15-foot Cube on the ground within 120 feet of yourself. They last there
// for 1 minute or until you have the Incapacitated condition or die. You and your allies have Half Cover while in that
// area, and your allies gain the current Resistance of your Nature's Ward while there."

const USE = "65000000-0000-4000-8000-0000000000b1";
const GM = { role: "gm" } as const;
const deps = () => zoneDeps();
const actorOf = (state: GameState, actorId: string) => state.actors.find((actor) => actor.id === actorId)!;
const resists = (state: GameState, actorId: string) =>
  actorOf(state, actorId).effects.flatMap((effect) =>
    effect.modifiers.flatMap((modifier) => (modifier.type === "damage-resistance" ? modifier.damageTypes : []))
  );

/** A Polar Druid 14's sanctuary drawn over (10, 10) to (12, 12), its ally and a goblin inside. */
function sanctuary() {
  const druid = fight(druidAt(14, []), { ally: true });
  // Bran fights for the party.
  actorOf(druid.state, ALLY).kind = "player-character";
  place(druid.state, { [HERO]: cell(11, 11), [ALLY]: cell(10, 10), [FOE]: cell(12, 12) });
  const before = actorOf(druid.state, HERO).actionUses["wild-shape"] ?? 0;
  druid.resolve("natures-sanctuary", { targetIds: [], commandId: USE, areaPlaced: true });
  drawArea(druid.state, USE, [10, 10], 3, "square");
  settleZoneAuras(druid.state, deps());
  return { ...druid, before };
}

describe("Nature's Sanctuary", () => {
  it("spends a use of Wild Shape and leaves the Cube for a minute", () => {
    const { state, before } = sanctuary();
    expect(actorOf(state, HERO).actionUses["wild-shape"]).toBe(before + 1);
    expect(state.combat.spellZones).toEqual([expect.objectContaining({ name: "Nature's Sanctuary", rounds: 10 })]);
  });

  it("gives the Druid and its allies inside Half Cover and the Polar ward's Cold Resistance, and no enemy", () => {
    const { state } = sanctuary();
    expect(standingCover(actorOf(state, HERO))).toBe("half");
    expect(standingCover(actorOf(state, ALLY))).toBe("half");
    expect(resists(state, ALLY)).toContain("cold");
    expect(standingCover(actorOf(state, FOE))).toBeNull();
    expect(resists(state, FOE)).not.toContain("cold");
    // Out of the Cube, the ally goes without.
    place(state, { [ALLY]: cell(20, 20) });
    settleZoneAuras(state, deps());
    expect(standingCover(actorOf(state, ALLY))).toBeNull();
  });

  it("ends when the Druid has the Incapacitated condition", () => {
    const { state } = sanctuary();
    setCondition(state, HERO, "incapacitated", true, undefined, GM);
    settleZoneAuras(state, deps());
    expect(state.combat.spellZones).toEqual([]);
    expect(standingCover(actorOf(state, ALLY))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { settleZoneAuras } from "../src/zone-auras.js";
import { ALLY, build, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import { cell, place, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Rod of Alertness, Protective Aura: "plant the haft end of the rod in the ground, whereupon the rod's head
// sheds Bright Light in a 60-foot radius ... While in that Bright Light, you and any creature that is friendly to you
// gain a +1 bonus to Armor Class and saving throws and can sense the location of any Invisible hostile creature that is
// also in the Bright Light. The rod's head stops glowing and the effect ends after 10 minutes".

const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;

/** The wizard holds an attuned rod of alertness and fights beside its ally Bran. */
function holder() {
  const caster = fight(build(wizardInput(["magic-missile"])), { ally: true });
  const hero = actorOf(caster.state, HERO);
  hero.inventory = [
    ...hero.inventory,
    { id: "rod-of-alertness", name: "Rod of Alertness", quantity: 1, equipped: true, attuned: true }
  ];
  actorOf(caster.state, ALLY).kind = "player-character";
  return caster;
}

describe("a planted Rod of Alertness", () => {
  it("gives its user and an ally in its light +1 to AC and saves and See Invisibility, and no one 70 feet off", () => {
    const caster = holder();
    const { state } = caster;
    place(state, { [HERO]: cell(10, 10), [ALLY]: cell(18, 10), [FOE]: cell(12, 10), [FOE2]: cell(40, 40) });
    caster.resolve("item-rod-of-alertness-protective-aura", { targetIds: [] });
    settleZoneAuras(state, zoneDeps());
    const aura = (id: string) => actorOf(state, id).effects.find((effect) => effect.name === "Rod of Alertness");
    for (const id of [HERO, ALLY])
      expect(aura(id)).toMatchObject({
        armorClassBonus: 1,
        modifiers: [
          { type: "save-bonus", amount: 1 },
          { type: "sense", sense: "see-invisibility", feet: 60 }
        ]
      });
    // The goblin beside it is no friend of the wizard's.
    expect(aura(FOE)).toBeUndefined();
    // The ally walks 70 feet from where the rod stands, and the rod stays put.
    place(state, { [ALLY]: cell(24, 10), [HERO]: cell(30, 30) });
    settleZoneAuras(state, zoneDeps());
    expect(aura(ALLY)).toBeUndefined();
    expect(aura(HERO)).toBeUndefined();
  });

  it("stops glowing after its 10 minutes", () => {
    const caster = holder();
    const { state } = caster;
    place(state, { [HERO]: cell(10, 10), [ALLY]: cell(18, 10), [FOE]: cell(40, 40), [FOE2]: cell(41, 41) });
    caster.resolve("item-rod-of-alertness-protective-aura", { targetIds: [] });
    expect(state.combat.spellZones[0]).toMatchObject({ rounds: 100, anchor: cell(10, 10) });
  });
});

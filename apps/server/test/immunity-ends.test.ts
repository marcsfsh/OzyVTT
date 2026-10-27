import { describe, expect, it } from "vitest";
import { InventoryItemSchema } from "@vtt/schemas";
import { applyCondition } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { setInventoryItem } from "../src/inventory.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { ALLY, catalog, FOE, FOE2, HERO } from "./spell-casters.js";
import { actorOf, answer, cast, caster, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Rules Glossary, Immunity: "If you have Immunity to a damage type or a condition, it doesn't affect you in
// any way", so a condition a creature already has ends when it gains the Immunity. And the effects that end on damage
// from one side: Charm Person's Charmed lasts "until the spell ends or until you or your allies damage it".

const conditionsOf = (state: Parameters<typeof actorOf>[0], id: string) =>
  actorOf(state, id).conditions.map((condition) => condition.id);

describe("Immunity ends what the creature already has", () => {
  it("ends a Frightened creature's Frightened when Heroism lands, and refuses a new one", () => {
    const table = caster();
    const ally = actorOf(table.state, ALLY);
    applyCondition(ally, "frightened");
    const heroism = cast(table, "heroism", { targetIds: [ALLY] });
    expect(conditionsOf(table.state, ALLY)).toEqual([]);
    expect(heroism.tableNarration?.map((line) => line.text)).toContain("Bran is no longer Frightened (Heroism).");
    expect(applyCondition(ally, "frightened")).toBe("immune");
  });

  it("ends Poisoned when a Periapt of Proof against Poison is attuned", () => {
    const table = caster();
    applyCondition(actorOf(table.state, HERO), "poisoned");
    const told = setInventoryItem(
      table.state,
      HERO,
      InventoryItemSchema.parse({
        id: "periapt-of-proof-against-poison",
        name: "Periapt of Proof against Poison",
        quantity: 1,
        equipped: true,
        attuned: true
      }),
      () => wizard,
      { catalog, role: "gm" }
    );
    expect(conditionsOf(table.state, HERO)).toEqual([]);
    expect(told.map((event) => event.text)).toContain("Ansel is no longer Poisoned (Periapt of Proof against Poison).");
  });
});

describe("Charmed until the caster's side does it harm", () => {
  it("ends Charm Person when the caster's ally damages the creature, and not when its own ally does", () => {
    const table = caster();
    cast(table, "charm-person", { targetIds: [FOE] });
    answer(table.state, FOE, 2);
    expect(conditionsOf(table.state, FOE)).toEqual(["charmed"]);
    // The orc is the goblin's ally: its blow leaves the charm.
    applyDamageDetailed(table.state, FOE, { amount: 3, sourceActorId: FOE2 }, { role: "gm" });
    expect(conditionsOf(table.state, FOE)).toEqual(["charmed"]);
    applyDamageDetailed(
      table.state,
      FOE,
      { amount: 3, sourceActorId: HERO },
      { role: "gm" },
      { resolveDefinition: () => undefined }
    );
    expect(conditionsOf(table.state, FOE)).toEqual([]);
  });
});

describe("Guiding Bolt's light", () => {
  it("lasts until the end of the caster's next turn", () => {
    const table = caster();
    cast(table, "guiding-bolt", {}, [15, 3, 3, 3, 3]);
    expect(actorOf(table.state, FOE).effects[0]).toMatchObject({
      name: "Guiding Bolt's light",
      duration: { type: "until-source-turn-end", skipsCurrentTurn: true }
    });
    // The Wizard's turn ends, then the others', and its next turn ends the light.
    for (let step = 0; step < 4; step += 1) nextInitiativeTurn(table.state);
    expect(table.state.combat.turnActorId).toBe(HERO);
    expect(actorOf(table.state, FOE).effects).toHaveLength(1);
    nextInitiativeTurn(table.state);
    expect(actorOf(table.state, FOE).effects).toEqual([]);
  });
});

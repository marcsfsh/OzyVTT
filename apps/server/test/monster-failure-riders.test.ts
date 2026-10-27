import { describe, expect, it } from "vitest";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { activeMoveGrant } from "../src/granted-moves.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { RulesBlockedError } from "../src/game-store.js";
import { areaLeavesOut } from "../src/resolution/action-targets.js";
import { actor, answer, conditionsOf, GM, IDS, legendaryWindow, nextId, NOW, table, use } from "./monster-table.js";

// What a stat-block save's failure leaves besides its damage, and whom the action reaches, as SRD 5.2.1 prints them: a
// size that falls Prone, a creature type or species spared, a Speed cut, Disadvantage, no Reactions, a margin of
// failure, "each enemy", "isn't an Undead", "Charmed or Grappled by", "that can see", and "while underwater".

describe("a failure's size gate", () => {
  it("knocks a Large creature Prone with a giant ape's Boulder Toss, and a Huge one takes the damage alone", () => {
    const built = table("giant-ape");
    actor(built, IDS.hero).size = "large";
    actor(built, IDS.ally).size = "huge";
    use(built, "boulder-toss", [IDS.hero, IDS.ally]);
    answer(built, IDS.hero, 5);
    answer(built, IDS.ally, 5);
    expect(conditionsOf(built, IDS.hero)).toEqual(["prone"]);
    expect(conditionsOf(built, IDS.ally)).toEqual([]);
    expect(actor(built, IDS.ally).hp.current).toBeLessThan(50);
  });

  it("knocks a Medium creature Prone with a gladiator's Shield Bash, and a Large one stays up", () => {
    const medium = table("gladiator");
    use(medium, "shield-bash", [IDS.hero]);
    answer(medium, IDS.hero, 5);
    expect(conditionsOf(medium, IDS.hero)).toEqual(["prone"]);
    const large = table("gladiator");
    actor(large, IDS.hero).size = "large";
    use(large, "shield-bash", [IDS.hero]);
    answer(large, IDS.hero, 5);
    expect(conditionsOf(large, IDS.hero)).toEqual([]);
    expect(actor(large, IDS.hero).hp.current).toBeLessThan(100);
  });
});

describe("a ghoul's Claw", () => {
  it("opens the Paralyzed save on a human it hits", () => {
    const built = table("ghoul");
    use(built, "claw", [IDS.hero], [15, 2]);
    expect(built.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.hero, ability: "con", dc: 10 }]);
  });

  it("spares an elf and an Undead, which make no save", () => {
    const elf = table("ghoul", { species: "elf" });
    const hit = use(elf, "claw", [IDS.hero], [15, 2]);
    expect(elf.state.combat.pendingSaves).toEqual([]);
    expect(hit.warnings).toContain("Hero is an elf, so Claw spares it.");
    const undead = table("ghoul", { allySlug: "zombie" });
    use(undead, "claw", [IDS.ally], [15, 2]);
    expect(undead.state.combat.pendingSaves).toEqual([]);
  });
});

describe("what a failure leaves besides conditions", () => {
  it("takes 10 feet off the Speed with a steam mephit's Steam Breath until the end of the mephit's next turn", () => {
    const built = table("steam-mephit");
    use(built, "steam-breath", [IDS.hero]);
    answer(built, IDS.hero, 3);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      {
        name: "Steam Breath",
        sourceActorId: IDS.monster,
        duration: { type: "until-source-turn-end" },
        modifiers: [{ type: "speed", amount: -10 }]
      }
    ]);
  });

  it("halves the Speed with a brass dragon's Scorching Sands until the end of the target's next turn", () => {
    const built = table("adult-brass-dragon");
    legendaryWindow(built);
    use(built, "scorching-sands", [IDS.hero]);
    answer(built, IDS.hero, 3);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      { name: "Scorching Sands", tags: ["speed-halved"], duration: { type: "until-bearer-turn-end" } }
    ]);
  });

  it("gives Disadvantage on Concentration saves with a black dragon's Cloud of Insects", () => {
    const built = table("adult-black-dragon");
    legendaryWindow(built);
    use(built, "cloud-of-insects", [IDS.hero]);
    answer(built, IDS.hero, 3);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      {
        name: "Cloud of Insects",
        modifiers: [{ type: "roll-mode", roll: "concentration", mode: "disadvantage" }]
      }
    ]);
  });

  it("holds a white dragon's Freezing Burst target in place until the end of its next turn", () => {
    const built = table("adult-white-dragon");
    legendaryWindow(built);
    use(built, "freezing-burst", [IDS.hero]);
    answer(built, IDS.hero, 3);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      { name: "Freezing Burst", speedZero: true, duration: { type: "until-bearer-turn-end" } }
    ]);
  });

  it("leaves a dretch's Fetid Cloud target Poisoned with one of an action or a Bonus Action and no Reactions", () => {
    const built = table("dretch");
    use(built, "fetid-cloud-1-day", [IDS.hero]);
    answer(built, IDS.hero, 3);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      { linkedConditionIds: ["poisoned"], tags: expect.arrayContaining(["no-reactions", "action-or-bonus"]) }
    ]);
  });

  it("gives a swarm of ravens' Deafened target Disadvantage on ability checks and attack rolls", () => {
    const built = table("swarm-of-ravens");
    use(built, "cacophony", [IDS.hero]);
    answer(built, IDS.hero, 3);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      {
        linkedConditionIds: ["deafened"],
        modifiers: [
          { type: "roll-mode", roll: "check", mode: "disadvantage" },
          { type: "roll-mode", roll: "attack", mode: "disadvantage" }
        ]
      }
    ]);
  });
});

describe("a failure by 5 or more", () => {
  it("knocks a homunculus's Bite target out for a minute, waking on damage, and a narrower failure only poisons", () => {
    const deep = table("homunculus");
    use(deep, "bite", [IDS.hero], [15]);
    answer(deep, IDS.hero, 6);
    expect(conditionsOf(deep, IDS.hero).sort()).toEqual(["poisoned", "prone", "unconscious"]);
    expect(actor(deep, IDS.hero).effects).toMatchObject([
      { linkedConditionIds: ["poisoned"], duration: { type: "rounds", remaining: 10 } },
      { linkedConditionIds: ["unconscious"], endsOnDamage: true }
    ]);
    applyDamageDetailed(deep.state, IDS.hero, { amount: 1, parts: [{ amount: 1, type: "fire" }] }, GM, {
      resolveDefinition: deep.resolveDefinition,
      newId: nextId,
      now: NOW
    });
    expect(conditionsOf(deep, IDS.hero)).toContain("poisoned");
    expect(conditionsOf(deep, IDS.hero)).not.toContain("unconscious");

    const narrow = table("homunculus");
    use(narrow, "bite", [IDS.hero], [15]);
    answer(narrow, IDS.hero, 9);
    expect(conditionsOf(narrow, IDS.hero)).toEqual(["poisoned"]);
    expect(actor(narrow, IDS.hero).effects).toMatchObject([{ duration: { type: "until-source-turn-end" } }]);
  });

  it("keeps a pseudodragon's Sting target Unconscious while Poisoned, and a creature beside it can wake it", () => {
    const built = table("pseudodragon");
    use(built, "sting", [IDS.hero]);
    answer(built, IDS.hero, 7);
    const effects = actor(built, IDS.hero).effects;
    expect(effects).toMatchObject([
      { linkedConditionIds: ["poisoned"], duration: { type: "minutes", remaining: 60 } },
      { linkedConditionIds: ["unconscious"], endsOnDamage: true, endedBy: { name: "Wake", by: "others" } }
    ]);
    // The poison ending ends the sleep with it.
    endEffect(built.state, IDS.hero, effects[0]!.id);
    expect(actor(built, IDS.hero).effects).toEqual([]);
    expect(conditionsOf(built, IDS.hero)).not.toContain("unconscious");
  });
});

describe("whom an action reaches", () => {
  it("leaves an Undead under a lich's Disrupt Life out of its save", () => {
    const built = table("lich", { allySlug: "zombie" });
    legendaryWindow(built);
    use(built, "disrupt-life", [IDS.hero, IDS.ally]);
    expect(built.state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([IDS.hero]);
  });

  it("leaves a planetar's own side out of its Holy Burst", () => {
    const built = table("planetar");
    const burst = built.definition.actions.find((entry) => entry.id === "holy-burst")!;
    expect([
      ...areaLeavesOut({
        state: built.state,
        attacker: actor(built, IDS.monster),
        action: burst,
        targetIds: [IDS.hero, IDS.ally],
        resolveDefinition: built.resolveDefinition
      })
    ]).toEqual([IDS.ally]);
  });

  it("aims an aboleth's Consume Memories only at a creature it charms or grapples", () => {
    const built = table("aboleth");
    expect(() => use(built, "consume-memories", [IDS.hero])).toThrow(/Charmed or Grappled by Aboleth/);
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({
        id: "grab",
        name: "Grappled",
        sourceActorId: IDS.monster,
        duration: { type: "manual" },
        linkedConditionIds: ["grappled"]
      })
    );
    use(built, "consume-memories", [IDS.hero]);
    expect(built.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.hero, ability: "int", dc: 16 }]);
  });

  it("asks a doppelganger's Unsettling Visage only of a creature that can see it", () => {
    const built = table("doppelganger");
    actor(built, IDS.ally).conditions = [{ id: "blinded" }];
    use(built, "unsettling-visage", [IDS.hero, IDS.ally]);
    expect(built.state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([IDS.hero]);
  });
});

describe("what works only underwater", () => {
  it("refuses a seahorse's Bubble Dash in a dry encounter and grants the swim underwater", () => {
    const built = table("seahorse");
    expect(() => use(built, "bubble-dash", [])).toThrow(RulesBlockedError);
    built.state.combat = { ...built.state.combat, underwater: true };
    use(built, "bubble-dash", []);
    expect(activeMoveGrant(built.state, actor(built, IDS.monster))).toMatchObject({ mode: "swim", provokes: false });
  });

  it("refuses a kraken's Toxic Ink out of the water", () => {
    const built = table("kraken");
    legendaryWindow(built);
    expect(() => use(built, "toxic-ink", [IDS.hero])).toThrow(/only underwater/);
  });
});

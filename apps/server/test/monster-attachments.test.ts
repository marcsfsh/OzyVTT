import { describe, expect, it } from "vitest";
import { applyDamageDetailed } from "../src/hit-points.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { carriedSourcesOf } from "../src/attachments.js";
import { RulesBlockedError } from "../src/game-store.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { actor, conditionsOf, GM, IDS, NOW, nextId, table, use, type Table } from "./monster-table.js";

// SRD 5.2.1 creatures that hold on to another: a cloaker attached and an animated rug smothering halve the damage they
// take and pass the same amount to the creature they hold, a shield guardian takes half its amulet's wearer's damage,
// a darkmantle covers a creature it hit with Advantage and rides it, and a stirge, a cloaker or a darkmantle lets go by
// spending 5 feet of its own movement.

const hurt = (built: Table, targetId: string, amount: number, distanceFeet?: () => number | null) =>
  applyDamageDetailed(built.state, targetId, { amount, parts: [{ amount, type: "slashing" }] }, GM, {
    resolveDefinition: built.resolveDefinition,
    newId: nextId,
    now: NOW,
    rollDie: () => 2,
    ...(distanceFeet ? { distanceFeet } : {})
  });
const hp = (built: Table, id: string) => actor(built, id).hp.current;

describe("a cloaker attached", () => {
  it("halves the damage it takes, rounded down, and its target takes the same amount", () => {
    const built = table("cloaker");
    use(built, "attach", [IDS.hero], [19]);
    expect(conditionsOf(built, IDS.hero)).toContain("blinded");
    const cloaker = hp(built, IDS.monster);
    const hero = hp(built, IDS.hero);
    const { events } = hurt(built, IDS.monster, 11);
    expect(hp(built, IDS.monster)).toBe(cloaker - 5);
    expect(hp(built, IDS.hero)).toBe(hero - 5);
    expect(events.map((event) => event.text)).toContain(
      "Hero takes 5 of Cloaker's damage (Attached by Cloaker (Attach))."
    );
  });

  it("takes all of its damage once it has let go", () => {
    const built = table("cloaker");
    use(built, "attach", [IDS.hero], [19]);
    const detach = builtinActionFor(built.definition, "detach-self", actor(built, IDS.monster))!;
    resolveDefinitionAction(
      built.state,
      detach,
      { actorId: IDS.monster, targetIds: [], commandId: nextId(), builtin: true },
      {
        random: () => 3,
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        definition: built.definition,
        resolveDefinition: built.resolveDefinition
      }
    );
    expect(conditionsOf(built, IDS.hero)).not.toContain("blinded");
    expect(built.state.combat.turn.movementUsedFeet).toBe(5);
    const cloaker = hp(built, IDS.monster);
    hurt(built, IDS.monster, 10);
    expect(hp(built, IDS.monster)).toBe(cloaker - 10);
  });
});

describe("an animated rug's Smother", () => {
  it("holds the target suffocating, smothers one at a time, and shares the damage it takes", () => {
    const built = table("animated-rug-of-smothering");
    use(built, "smother", [IDS.hero], [19]);
    expect(conditionsOf(built, IDS.hero)).toEqual(expect.arrayContaining(["grappled", "blinded", "restrained"]));
    expect(actor(built, IDS.hero).effects.some((effect) => effect.tags.includes("holding-breath"))).toBe(true);
    built.state.combat = { ...built.state.combat, turn: { ...built.state.combat.turn, actionUsed: false } };
    expect(() => use(built, "smother", [IDS.ally], [19])).toThrow(RulesBlockedError);
    const hero = hp(built, IDS.hero);
    hurt(built, IDS.monster, 7);
    expect(hp(built, IDS.hero)).toBe(hero - 3);
  });
});

describe("a shield guardian's Bound", () => {
  it("takes half of the damage its amulet's wearer takes, rounded up, within 60 feet", () => {
    const built = table("shield-guardian");
    actor(built, IDS.monster).control = { by: IDS.hero, side: "party" };
    const guardian = hp(built, IDS.monster);
    const hero = hp(built, IDS.hero);
    hurt(built, IDS.hero, 9, () => 30);
    expect(hp(built, IDS.monster)).toBe(guardian - 5);
    expect(hp(built, IDS.hero)).toBe(hero - 4);
  });

  it("takes none of it beyond 60 feet, or from a creature that doesn't wear its amulet", () => {
    const far = table("shield-guardian");
    actor(far, IDS.monster).control = { by: IDS.hero, side: "party" };
    hurt(far, IDS.hero, 9, () => 90);
    expect(hp(far, IDS.monster)).toBe(60);
    const loose = table("shield-guardian");
    hurt(loose, IDS.hero, 9, () => 5);
    expect(hp(loose, IDS.monster)).toBe(60);
  });
});

describe("a darkmantle's Crush", () => {
  it("covers a Medium target it hit with Advantage, Blinded and suffocating, and rides it", () => {
    const built = table("darkmantle");
    use(built, "crush", [IDS.hero], [19, 19], { rollMode: "advantage" });
    expect(conditionsOf(built, IDS.hero)).toContain("blinded");
    expect(actor(built, IDS.hero).effects.some((effect) => effect.tags.includes("holding-breath"))).toBe(true);
    expect(carriedSourcesOf(built.state, IDS.hero)).toEqual([IDS.monster]);
  });

  it("only attaches without Advantage, and moves only with its target", () => {
    const built = table("darkmantle");
    use(built, "crush", [IDS.hero], [19]);
    expect(conditionsOf(built, IDS.hero)).not.toContain("blinded");
    expect(() =>
      applyMovementRules(built.state, {
        actorId: IDS.monster,
        from: { x: 0, y: 0 },
        to: { x: 50, y: 0 },
        byPlayer: false,
        distance: () => 5,
        calibration: null,
        override: null,
        resolveDefinition: built.resolveDefinition,
        newPromptId: nextId,
        now: () => 0,
        commandId: nextId()
      })
    ).toThrow(RulesBlockedError);
  });
});

import { describe, expect, it } from "vitest";
import { build, fight, fighterInput, FOE, HERO, wizardInput, WIZARD_SPELLS } from "./spell-casters.js";

// SRD 5.2.1 Heroic Inspiration: "If you have Heroic Inspiration, you can expend it to reroll any die immediately after
// rolling it, and you must use the new roll." A damage roll is looked at before it counts: the server holds its dice,
// an answer rerolls the ones it picks, and the confirm deals the dice as they were looked at.

const HOLD = `attack:${HERO}`;

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};

const facesOf = (look: { heldDamage?: { dice: ReadonlyArray<{ face: number }> } }) =>
  (look.heldDamage?.dice ?? []).map((die) => die.face);

describe("a look at a hit's damage", () => {
  it("is offered on a previewed hit while the attacker holds Heroic Inspiration", () => {
    const table = fight(build(fighterInput()));
    expect(table.resolve("item-greatsword", { commit: false, holdKey: HOLD }, [15]).damageLook).toBeUndefined();
    table.hero.heroicInspiration = true;
    const preview = table.resolve("item-greatsword", { commit: false, holdKey: HOLD }, []);
    expect(preview.attack?.outcome).toBe("hit");
    expect(preview.damageLook).toBe("offered");
  });

  it("holds the dice, so a second look shows the same ones, and records no roll", () => {
    const table = fight(build(fighterInput()));
    table.hero.heroicInspiration = true;
    table.resolve("item-greatsword", { commit: false, holdKey: HOLD }, [15]);
    const recorded = table.state.rolls.length;
    const look = table.resolve("item-greatsword", { commit: false, damageLook: true, holdKey: HOLD }, [1, 2]);
    expect(look.preview).toBe(true);
    expect(look.heldDamage?.dice).toEqual([
      { sides: 6, face: 1, own: true },
      { sides: 6, face: 2, own: true }
    ]);
    expect(look.damageTotal).toBe(1 + 2 + 4);
    expect(look.heldDamage?.answers).toEqual([
      { id: "heroic-inspiration", name: "Heroic Inspiration", dice: 1, ownOnly: false, cost: "Heroic Inspiration" }
    ]);
    const again = table.resolve("item-greatsword", { commit: false, damageLook: true, holdKey: HOLD }, [6, 6]);
    expect(facesOf(again)).toEqual([1, 2]);
    expect(table.state.rolls.length).toBe(recorded);
  });

  it("rerolls the one die Heroic Inspiration picks and spends it, and the confirm deals the new roll", () => {
    const table = fight(build(fighterInput()));
    table.hero.heroicInspiration = true;
    table.resolve("item-greatsword", { commit: false, holdKey: HOLD }, [15]);
    table.resolve("item-greatsword", { commit: false, damageLook: true, holdKey: HOLD }, [1, 2]);
    expect(
      refusal(() =>
        table.resolve("item-greatsword", {
          commit: false,
          damageLook: true,
          holdKey: HOLD,
          damageAnswer: { id: "heroic-inspiration", dice: [0, 1] }
        })
      )
    ).toMatch(/Heroic Inspiration rerolls one die/);
    const answered = table.resolve(
      "item-greatsword",
      { commit: false, damageLook: true, holdKey: HOLD, damageAnswer: { id: "heroic-inspiration", dice: [0] } },
      [6]
    );
    expect(facesOf(answered)).toEqual([6, 2]);
    expect(answered.heldDamage?.answered).toEqual([{ name: "Heroic Inspiration", change: "rerolled 1 die" }]);
    expect(table.hero.heroicInspiration).toBe(false);
    expect(table.state.rolls.at(-1)?.label).toBe("Greatsword: Heroic Inspiration");
    expect(
      refusal(() =>
        table.resolve("item-greatsword", {
          commit: false,
          damageLook: true,
          holdKey: HOLD,
          damageAnswer: { id: "heroic-inspiration", dice: [1] }
        })
      )
    ).toMatch(/Borin has no Heroic Inspiration to reroll a die with/);
    expect(
      refusal(() =>
        table.resolve("item-greatsword", {
          commit: false,
          damageLook: true,
          holdKey: HOLD,
          damageAnswer: { id: "empowered-spell", dice: [1] }
        })
      )
    ).toMatch(/Empowered Spell rerolls the damage dice of a spell/);
    const dealt = table.resolve("item-greatsword", { holdKey: HOLD }, [1, 1]);
    expect(dealt.attack?.outcome).toBe("hit");
    expect(dealt.damageTotal).toBe(6 + 2 + 4);
    expect(table.state.heldDamage).toEqual([]);
  });

  it("refuses an answer with no look, and a look at an action that rolls no damage dice", () => {
    const table = fight(build(fighterInput()));
    table.hero.heroicInspiration = true;
    expect(
      refusal(() =>
        table.resolve("item-greatsword", { holdKey: HOLD, damageAnswer: { id: "heroic-inspiration", dice: [0] } })
      )
    ).toMatch(/Answer the damage on a look at it/);
    expect(
      refusal(() =>
        table.resolve(
          "item-greatsword",
          { commit: false, damageLook: true, holdKey: HOLD, damageAnswer: { id: "heroic-inspiration", dice: [0] } },
          [15]
        )
      )
    ).toMatch(/Roll the damage first/);
  });
});

describe("a look at a spell's damage with no attack roll", () => {
  it("holds Fireball's dice for the caster, and the saves the confirm opens carry them", () => {
    const table = fight(build(wizardInput([...WIZARD_SPELLS])));
    table.hero.heroicInspiration = true;
    const look = table.resolve(
      "spell-fireball",
      { targetIds: [FOE], commit: false, damageLook: true },
      [1, 1, 1, 1, 1, 1, 1, 1]
    );
    expect(look.heldDamage?.dice).toHaveLength(8);
    // The look spends nothing and opens no save.
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(table.state.combat.turn.actionUsed).toBe(false);
    table.resolve(
      "spell-fireball",
      { targetIds: [FOE], commit: false, damageLook: true, damageAnswer: { id: "heroic-inspiration", dice: [3] } },
      [6]
    );
    table.resolve("spell-fireball", { targetIds: [FOE] }, [2, 2, 2, 2, 2, 2, 2, 2]);
    expect(table.state.combat.pendingSaves[0]?.proposedDamage).toBe(7 + 6);
  });
});

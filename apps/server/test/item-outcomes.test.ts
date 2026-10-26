import { describe, expect, it } from "vitest";
import { effectiveActions } from "../src/effective-actions.js";
import { catalog, catalogRow, fight, IDS, resolveAt, tableOf, wizardInput, write } from "./equipment-table.js";

// SRD 5.2.1 Wand of Wonder: "you can take a Magic action to expend 1 charge while choosing a point within 120 feet of
// yourself. That location becomes the point of origin of a spell or other magical effect determined by rolling on the
// Wand of Wonder Effects table. Spells cast from the wand have a save DC of 15."

function wielder() {
  const table = tableOf({ [IDS.wizard]: wizardInput() });
  write(table, IDS.wizard, catalogRow("wand-of-wonder", { attuned: true }), "gm");
  fight(table, IDS.wizard);
  return table;
}

const offered = (table: ReturnType<typeof wielder>) =>
  effectiveActions(table.definition(IDS.wizard), table.actor(IDS.wizard), catalog).map((action) => action.id);

describe("a Wand of Wonder", () => {
  it("rolls the d100 for each charge: on 23 its user is Stunned until the start of its next turn", () => {
    const table = wielder();
    const surge = resolveAt(table, IDS.wizard, "item-wand-of-wonder-wild-surge", [23], { targetIds: [] });
    expect(surge.tableNarration?.some((line) => /rolls 23 on the d100/.test(line.text))).toBe(true);
    expect(table.actor(IDS.wizard).conditions.map((condition) => condition.id)).toContain("stunned");
    expect(table.actor(IDS.wizard).actionUses["wand-of-wonder-charges"]).toBe(1);
  });

  it("on 31 deals its user 1d6 Psychic", () => {
    const table = wielder();
    const surge = resolveAt(table, IDS.wizard, "item-wand-of-wonder-wild-surge", [31, 4], { targetIds: [] });
    expect(surge.damage).toEqual([expect.objectContaining({ type: "psychic", total: 4 })]);
  });

  it("on 48 hands its user Lightning Bolt at DC 15 to aim this turn, spent when cast", () => {
    const table = wielder();
    expect(offered(table)).not.toContain("item-wand-of-wonder-cast-lightning-bolt");
    resolveAt(table, IDS.wizard, "item-wand-of-wonder-wild-surge", [48], { targetIds: [] });
    const bolt = effectiveActions(table.definition(IDS.wizard), table.actor(IDS.wizard), catalog).find(
      (action) => action.id === "item-wand-of-wonder-cast-lightning-bolt"
    )!;
    expect(bolt).toMatchObject({ activation: "other", save: { dc: 15 } });
    resolveAt(table, IDS.wizard, "item-wand-of-wonder-cast-lightning-bolt", [1, 1, 1, 1, 1, 1, 1, 1], {
      targetIds: [IDS.foe]
    });
    expect(offered(table)).not.toContain("item-wand-of-wonder-cast-lightning-bolt");
  });

  it("on 1-20 rolls a d10 for the spell: a 5 hands its user Fireball", () => {
    const table = wielder();
    const surge = resolveAt(table, IDS.wizard, "item-wand-of-wonder-wild-surge", [12, 5], { targetIds: [] });
    expect(surge.tableNarration?.some((line) => /rolls 5 on the d10/.test(line.text))).toBe(true);
    expect(offered(table)).toContain("item-wand-of-wonder-cast-fireball");
  });

  it("tells the table what the GM settles, and hands nothing", () => {
    const table = wielder();
    const before = offered(table).length;
    const surge = resolveAt(table, IDS.wizard, "item-wand-of-wonder-wild-surge", [62], { targetIds: [] });
    expect(surge.tableNarration?.some((line) => /grass covers/.test(line.text))).toBe(true);
    expect(offered(table)).toHaveLength(before);
  });
});

describe("a Hat of Many Spells' failed Unknown Spell", () => {
  function wearer() {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("hat-of-many-spells", { attuned: true }), "gm");
    fight(table, IDS.wizard);
    return table;
  }

  it("rolls the hat's d100: on 68 its user is Poisoned for an hour, on 72 Petrified to the end of its next turn", () => {
    const sick = wearer();
    resolveAt(sick, IDS.wizard, "item-hat-of-many-spells-miscast", [68], { targetIds: [] });
    expect(sick.actor(IDS.wizard).conditions.map((condition) => condition.id)).toContain("poisoned");
    const stone = wearer();
    resolveAt(stone, IDS.wizard, "item-hat-of-many-spells-miscast", [72], { targetIds: [] });
    expect(stone.actor(IDS.wizard).conditions.map((condition) => condition.id)).toContain("petrified");
  });

  it("on 1-50 rolls a d10 for the spell its user casts at its own numbers: a 4 hands it Fireball", () => {
    const table = wearer();
    resolveAt(table, IDS.wizard, "item-hat-of-many-spells-miscast", [30, 4], { targetIds: [] });
    const fireball = effectiveActions(table.definition(IDS.wizard), table.actor(IDS.wizard), catalog).find(
      (action) => action.id === "item-hat-of-many-spells-cast-fireball"
    );
    expect(fireball).toMatchObject({ activation: "other", save: { ability: "dex" } });
  });
});

describe("a Mysterious Deck", () => {
  function drawer(variantId: "thirteen" | "twenty-two") {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("mysterious-deck", { variantId }), "gm");
    fight(table, IDS.wizard);
    return table;
  }

  it("draws on its deck's column: a 13-card deck's 5 is Euryale, a curse of -2 to its drawer's saves", () => {
    const table = drawer("thirteen");
    resolveAt(table, IDS.wizard, "item-mysterious-deck-draw", [5], { targetIds: [] });
    const curse = table.actor(IDS.wizard).effects.find((effect) => effect.name === "Euryale's Curse");
    expect(curse).toMatchObject({ duration: { type: "manual" }, modifiers: [{ type: "save-bonus", amount: -2 }] });
  });

  it("tells the table a card the GM settles: a 22-card deck's 5 is Balance", () => {
    const table = drawer("twenty-two");
    const drawn = resolveAt(table, IDS.wizard, "item-mysterious-deck-draw", [5], { targetIds: [] });
    expect(drawn.tableNarration?.some((line) => /Balance/.test(line.text))).toBe(true);
    expect(table.actor(IDS.wizard).effects.some((effect) => effect.name === "Euryale's Curse")).toBe(false);
  });
});

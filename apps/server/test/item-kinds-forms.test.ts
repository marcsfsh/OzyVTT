import { describe, expect, it } from "vitest";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { setItemForm } from "../src/inventory.js";
import { projectPlayerView } from "../src/projections.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  tableOf,
  write,
  type Table
} from "./equipment-table.js";

// One record covers several kinds of an item (an Ioun Stone's stones, a Belt of Giant Strength's giants), and some
// items take forms their holder picks (a Rod of Lordly Might's buttons). A carried copy is one kind or form.

const PLAYER_SESSION = "30000000-0000-4000-8000-0000000000c1";
const PLAYER = { role: "player", sessionId: PLAYER_SESSION } as const;
const row = (table: Table, id: string) => table.actor(IDS.fighter).inventory.find((entry) => entry.id === id)!;
const ids = (table: Table) => deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog);
/** The fighter's table, its player's to act on. */
const owned = (foe = true) => {
  const table = tableOf({ [IDS.fighter]: fighterInput() }, foe);
  table.actor(IDS.fighter).ownerSessionId = PLAYER_SESSION;
  return table;
};

describe("a found item's kind, which the GM says", () => {
  it("lets only the GM say what an Ioun Stone is, and keeps it through a player's write", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("ioun-stone", { variantId: "protection" }));
    expect(row(table, "ioun-stone").variantId).toBeUndefined();
    write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone", { variantId: "protection" }), "gm");
    const { variantId: _kind, ...sent } = row(table, "ioun-stone");
    write(table, IDS.fighter, { ...sent, quantity: 1 });
    expect(row(table, "ioun-stone").variantId).toBe("protection");
    expect(() =>
      write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone", { variantId: "luck" }), "gm")
    ).toThrow('Ioun Stone has no kind "luck".');
  });

  it("gives the Protection stone's +1 AC once attuned, and takes another kind as a second item", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    const before = table.actor(IDS.fighter).armorClass!;
    write(table, IDS.fighter, catalogRow("ioun-stone", { variantId: "protection" }), "gm");
    expect(table.actor(IDS.fighter).armorClass).toBe(before);
    write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone", { attuned: true }));
    expect(table.actor(IDS.fighter).armorClass).toBe(before + 1);
    // An Ioun Stone of Awareness is another item: both orbit, both attuned.
    write(
      table,
      IDS.fighter,
      catalogRow("ioun-stone", { id: "ioun-stone-2", recordId: "ioun-stone", variantId: "awareness" }),
      "gm"
    );
    write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone-2", { attuned: true }));
    expect(row(table, "ioun-stone-2").attuned).toBe(true);
    expect(ids(table).carriers.some((carrier) => carrier.sourceItemId === "ioun-stone-2")).toBe(true);
    // A second stone of Protection is a second copy of one item.
    write(
      table,
      IDS.fighter,
      catalogRow("ioun-stone", { id: "ioun-stone-3", recordId: "ioun-stone", variantId: "protection" }),
      "gm"
    );
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone-3", { attuned: true }))).toThrow(
      /can't attune to more than one copy/
    );
  });

  it("shows the bearer which stone it is only once they attune", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    table.actor(IDS.fighter).ownerSessionId = PLAYER_SESSION;
    write(table, IDS.fighter, catalogRow("ioun-stone", { variantId: "insight" }), "gm");
    const seen = () =>
      projectPlayerView(table.state, PLAYER_SESSION, () => "online")
        .actors.find((actor) => actor.id === IDS.fighter)!
        .inventory!.find((entry) => entry.id === "ioun-stone")!;
    expect(seen().variantId).toBeUndefined();
    write(table, IDS.fighter, edit(table, IDS.fighter, "ioun-stone", { attuned: true }));
    expect(seen().variantId).toBe("insight");
    // A kind of an item that needs no attunement is plain to see (a Bag of Tricks' colour).
    write(table, IDS.fighter, catalogRow("bag-of-tricks", { variantId: "rust" }), "gm");
    expect(
      projectPlayerView(table.state, PLAYER_SESSION, () => "online")
        .actors.find((actor) => actor.id === IDS.fighter)!
        .inventory!.find((entry) => entry.id === "bag-of-tricks")!.variantId
    ).toBe("rust");
  });

  it("offers a Bag of Tricks' pull only for the bag it is", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("bag-of-tricks"), "gm");
    expect(ids(table).actions.filter((action) => action.id.startsWith("item-bag-of-tricks"))).toEqual([]);
    write(table, IDS.fighter, edit(table, IDS.fighter, "bag-of-tricks", { variantId: "tan" }), "gm");
    expect(
      ids(table)
        .actions.filter((action) => action.id.startsWith("item-bag-of-tricks"))
        .map((action) => action.id)
    ).toEqual(["item-bag-of-tricks-pull-tan"]);
  });
});

describe("a form its holder picks", () => {
  // Each table here belongs to the fighter's player, who changes the form.
  it("turns a Rod of Lordly Might into a +3 Battleaxe, and a flaming Longsword with 2d6 Fire and no +3", () => {
    const table = owned();
    write(table, IDS.fighter, catalogRow("rod-of-lordly-might", { attuned: true }));
    const mace = actionOf(table, IDS.fighter, "item-rod-of-lordly-might");
    expect(mace.damage[0]!.type).toBe("bludgeoning");
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "rod-of-lordly-might", variantId: "battleaxe" },
      PLAYER,
      catalog,
      table.resolve
    );
    const axe = actionOf(table, IDS.fighter, "item-rod-of-lordly-might");
    expect([axe.damage[0]!.formula, axe.damage[0]!.type, axe.attack?.bonus]).toEqual([
      "1d8 + 7",
      "slashing",
      mace.attack!.bonus
    ]);
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "rod-of-lordly-might", variantId: "flame-longsword" },
      PLAYER,
      catalog,
      table.resolve
    );
    const blade = actionOf(table, IDS.fighter, "item-rod-of-lordly-might");
    // Str 19 (+4), PB 3, and no +3 in the blade form.
    expect([blade.damage[0]!.formula, blade.attack?.bonus]).toEqual(["1d8 + 4", 7]);
    expect(
      ids(table).carriers.find((carrier) => carrier.sourceItemId === "rod-of-lordly-might")?.modifiers
    ).toContainEqual({
      type: "extra-damage",
      formula: "2d6",
      damageType: "fire",
      doubleOnCritical: true,
      when: [{ type: "on-hit" }]
    });
    // Back to its own form: the Mace again.
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "rod-of-lordly-might", variantId: null },
      PLAYER,
      catalog,
      table.resolve
    );
    expect(actionOf(table, IDS.fighter, "item-rod-of-lordly-might").damage[0]!.type).toBe("bludgeoning");
  });

  it("spends the Bonus Action a button takes on its holder's turn, and refuses a second", () => {
    const table = owned();
    write(table, IDS.fighter, catalogRow("rod-of-lordly-might", { attuned: true }));
    fight(table, IDS.fighter);
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "rod-of-lordly-might", variantId: "spear" },
      PLAYER,
      catalog,
      table.resolve
    );
    expect(table.state.combat.turn.bonusActionUsed).toBe(true);
    expect(() =>
      setItemForm(
        table.state,
        { actorId: IDS.fighter, itemId: "rod-of-lordly-might", variantId: "battleaxe" },
        PLAYER,
        catalog,
        table.resolve
      )
    ).toThrow("Borin has already used a Bonus Action this turn.");
  });

  it("folds a Quarterstaff of the Acrobat into a rod that neither swings nor deflects, and throws the staff 30/120", () => {
    const table = owned(false);
    write(table, IDS.fighter, catalogRow("quarterstaff-of-the-acrobat", { attuned: true }));
    const staff = actionOf(table, IDS.fighter, "item-quarterstaff-of-the-acrobat");
    expect(staff.attack).toMatchObject({ reachFeet: 5, rangeFeet: 120, rangeNormalFeet: 30 });
    expect(ids(table).actions.map((action) => action.id)).toContain(
      "item-quarterstaff-of-the-acrobat-attack-deflection"
    );
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "quarterstaff-of-the-acrobat", variantId: "rod" },
      PLAYER,
      catalog,
      table.resolve
    );
    const actions = ids(table).actions.map((action) => action.id);
    expect(actions.filter((id) => id.startsWith("item-quarterstaff-of-the-acrobat"))).toEqual([]);
  });

  it("moves a Defender's bonus to AC as its wielder picks", () => {
    const table = owned(false);
    write(table, IDS.fighter, catalogRow("defender", { baseId: "longsword", attuned: true }));
    const before = table.actor(IDS.fighter).armorClass!;
    const plain = actionOf(table, IDS.fighter, "item-defender").attack!.bonus;
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "defender", variantId: "ac-2" },
      PLAYER,
      catalog,
      table.resolve
    );
    expect(table.actor(IDS.fighter).armorClass).toBe(before + 2);
    expect(actionOf(table, IDS.fighter, "item-defender").attack!.bonus).toBe(plain - 2);
  });

  it("puts the Sun Blade's blade away, with its light and its bonus", () => {
    const table = owned(false);
    write(table, IDS.fighter, catalogRow("sun-blade", { attuned: true }));
    expect(actionOf(table, IDS.fighter, "item-sun-blade").damage[0]!.type).toBe("radiant");
    setItemForm(
      table.state,
      { actorId: IDS.fighter, itemId: "sun-blade", variantId: "hilt" },
      PLAYER,
      catalog,
      table.resolve
    );
    expect(ids(table).actions.some((action) => action.id === "item-sun-blade")).toBe(false);
    expect(row(table, "sun-blade").weapon).toBeUndefined();
  });

  it("refuses a form to an item held by no one, and a form the item has none of", () => {
    const table = owned(false);
    write(table, IDS.fighter, catalogRow("rod-of-lordly-might", { attuned: true, equipped: false }));
    expect(() =>
      setItemForm(
        table.state,
        { actorId: IDS.fighter, itemId: "rod-of-lordly-might", variantId: "spear" },
        PLAYER,
        catalog,
        table.resolve
      )
    ).toThrow("Borin must hold Rod of Lordly Might to change its form.");
    write(table, IDS.fighter, catalogRow("ioun-stone"), "gm");
    expect(() =>
      setItemForm(
        table.state,
        { actorId: IDS.fighter, itemId: "ioun-stone", variantId: "agility" },
        PLAYER,
        catalog,
        table.resolve
      )
    ).toThrow("Ioun Stone has no forms its holder can change.");
  });
});

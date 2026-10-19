import { describe, expect, it } from "vitest";
import { currentSpeedFeet } from "../src/speed.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { liveDefinitionIn } from "../src/live-abilities.js";
import { magicSaveAuraClaims, saveRollSources } from "../src/saving-throws.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// The rider vocabulary magic items needed: live ability scores, saves against magic and spells, one kind of weapon,
// cover set aside, no critical hits, a Speed floor, a base AC without armor, a Bonus Action attack, a damage type the
// wielder picks, and an aura of Advantage on saves.

const derived = (table: Table, actorId: string) =>
  deriveEquipment(table.actor(actorId), table.definition(actorId), catalog);
const live = (table: Table, actorId: string) =>
  liveDefinitionIn(table.state, table.actor(actorId).definitionId!, table.definition(actorId), catalog);

describe("ability scores an item sets or raises", () => {
  it("makes a wizard's Strength 19 in Gauntlets of Ogre Power, and gives it back when they come off", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    expect(live(table, IDS.wizard).abilityScores.str).toBe(10);
    write(table, IDS.wizard, catalogRow("gauntlets-of-ogre-power", { attuned: true }));
    expect(live(table, IDS.wizard).abilityScores.str).toBe(19);
    write(table, IDS.wizard, edit(table, IDS.wizard, "gauntlets-of-ogre-power", { equipped: false }));
    expect(live(table, IDS.wizard).abilityScores.str).toBe(10);
  });

  it("leaves a higher score as it is: a fighter's Strength 19 under a hill giant's belt is 21, under the gauntlets 19", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("gauntlets-of-ogre-power", { attuned: true }));
    expect(live(table, IDS.fighter).abilityScores.str).toBe(19);
    write(table, IDS.fighter, catalogRow("belt-of-giant-strength", { attuned: true, variantId: "hill" }), "gm");
    expect(live(table, IDS.fighter).abilityScores.str).toBe(21);
  });

  it("raises Constitution with an Amulet of Health, and the Hit Point maximum with it", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    // Con 14 (+2) at level 3; 19 (+4) adds 2 a level.
    const before = table.actor(IDS.wizard).hp.maximum;
    write(table, IDS.wizard, catalogRow("amulet-of-health", { attuned: true }));
    expect(live(table, IDS.wizard).abilityScores.con).toBe(19);
    expect(table.actor(IDS.wizard).hp.maximum).toBe(before + 6);
    write(table, IDS.wizard, edit(table, IDS.wizard, "amulet-of-health", { quantity: 0 }));
    expect(table.actor(IDS.wizard).hp.maximum).toBe(before);
  });

  it("raises Dexterity by 2 to at most 20 with an Ioun Stone of Agility, and moves the attack it rolls", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("ioun-stone", { attuned: true, variantId: "agility" }), "gm");
    expect(live(table, IDS.wizard).abilityScores.dex).toBe(16);
  });

  it("sets Strength for an hour from a Potion of Giant Strength", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("potion-of-giant-strength", { variantId: "fire", equipped: false }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-potion-of-giant-strength-drink", [], { targetIds: [] });
    expect(
      table.actor(IDS.wizard).effects.find((effect) => effect.name === "Potion of Giant Strength")?.duration
    ).toEqual({ type: "minutes", remaining: 60 });
    expect(live(table, IDS.wizard).abilityScores.str).toBe(25);
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "potion-of-giant-strength")).toBe(false);
  });
});

describe("saves against magic and spells", () => {
  it("gives a Mantle of Spell Resistance Advantage on a save against a spell, and none against a dragon's breath", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("mantle-of-spell-resistance", { attuned: true }));
    const wizard = table.actor(IDS.wizard);
    const derivation = derived(table, IDS.wizard);
    const spell = { magical: true, spell: { id: "fireball", school: "evocation", level: 3 } };
    expect(
      saveRollSources(wizard, "dex", derivation, false, [], null, spell).advantage.map((claim) => claim.label)
    ).toEqual(["Mantle of Spell Resistance"]);
    expect(saveRollSources(wizard, "dex", derivation, false, [], null, {}).advantage).toEqual([]);
    // A wand's save is magic but no spell: the mantle says nothing of it.
    expect(saveRollSources(wizard, "dex", derivation, false, [], null, { magical: true }).advantage).toEqual([]);
  });

  it("gives a Spellguard Shield Advantage against every magical effect, a spell's included", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("spellguard-shield", { attuned: true }));
    const fighter = table.actor(IDS.fighter);
    const derivation = derived(table, IDS.fighter);
    expect(saveRollSources(fighter, "con", derivation, false, [], null, { magical: true }).advantage).toHaveLength(1);
    expect(saveRollSources(fighter, "con", derivation, false, [], null, {}).advantage).toHaveLength(0);
  });

  it("spreads a Holy Avenger's Advantage to an ally within 10 feet, and no farther", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.fighter, catalogRow("holy-avenger", { baseId: "longsword", attuned: true }), "gm");
    const wizard = table.actor(IDS.wizard);
    const at = (feet: number) =>
      magicSaveAuraClaims(
        table.state,
        wizard,
        { magical: true },
        {
          resolveDefinition: table.resolve,
          catalog,
          distanceFeet: () => feet
        }
      );
    expect(at(10).map((claim) => claim.label)).toEqual(["Borin's Holy Avenger"]);
    expect(at(15)).toEqual([]);
    expect(
      magicSaveAuraClaims(table.state, wizard, {}, { resolveDefinition: table.resolve, catalog, distanceFeet: () => 5 })
    ).toEqual([]);
  });
});

describe("attack riders", () => {
  it("adds the Bracers of Archery's +2 to a Longbow's damage, and nothing to a Greatsword's", () => {
    const shoot = (bracers: boolean) => {
      const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
      if (bracers) write(table, IDS.fighter, catalogRow("bracers-of-archery", { attuned: true }));
      fight(table, IDS.fighter);
      return resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30).damageTotal;
    };
    expect(shoot(true)).toBe(shoot(false) + 2);
    const swing = (bracers: boolean) => {
      const table = tableOf({ [IDS.fighter]: fighterInput() });
      if (bracers) write(table, IDS.fighter, catalogRow("bracers-of-archery", { attuned: true }));
      fight(table, IDS.fighter);
      return resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3], {}, 5).damageTotal;
    };
    expect(swing(true)).toBe(swing(false));
  });

  it("sets Half Cover aside for a Wand of the War Mage's spell attack", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    fight(table, IDS.wizard);
    expect(resolveAt(table, IDS.wizard, "spell-fire-bolt", [8, 4], { cover: "half" }).attack).toMatchObject({
      targetAc: 12,
      coverBonus: 2
    });
    write(table, IDS.wizard, catalogRow("wand-of-the-war-mage-1", { attuned: true }));
    const table2 = tableOf({ [IDS.wizard]: wizardInput() });
    write(table2, IDS.wizard, catalogRow("wand-of-the-war-mage-1", { attuned: true }));
    fight(table2, IDS.wizard);
    const shot = resolveAt(table2, IDS.wizard, "spell-fire-bolt", [8, 4], { cover: "half" });
    expect(shot.attack?.targetAc).toBe(10);
    expect(shot.warnings?.join(" ")).toMatch(/ignores Foe's cover/);
  });

  it("turns a Critical Hit on Adamantine Armor's wearer into a hit", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("adamantine-armor", { baseId: "chain-mail" }), "gm");
    fight(table, IDS.fighter);
    table.state.combat.initiative.push({ ...table.state.combat.initiative[1]!, actorId: IDS.wizard, score: 5 });
    const swing = resolveAt(table, IDS.fighter, "item-greatsword", [20, 3, 3, 3, 3], { targetIds: [IDS.wizard] }, 5);
    expect([swing.attack?.outcome, swing.crit]).toEqual(["hit", false]);
    expect(swing.warnings?.join(" ")).toMatch(/Adamantine Armor: the Critical Hit against Ilyana is a normal hit\./);
  });

  it("offers a Scimitar of Speed's attack as a Bonus Action while attuned", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("scimitar-of-speed"));
    expect(derived(table, IDS.fighter).actions.some((action) => action.id.endsWith("bonus-attack"))).toBe(false);
    write(table, IDS.fighter, edit(table, IDS.fighter, "scimitar-of-speed", { attuned: true }));
    const bonus = actionOf(table, IDS.fighter, "item-scimitar-of-speed-bonus-attack");
    expect(bonus.activation).toBe("bonus-action");
    expect(bonus.attack?.bonus).toBe(actionOf(table, IDS.fighter, "item-scimitar-of-speed").attack?.bonus);
  });

  it("lets a Javelin of Lightning deal Lightning in place of Piercing, and throws its Line once a day", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("javelin-of-lightning"));
    expect(actionOf(table, IDS.fighter, "item-javelin-of-lightning").damageTypes).toEqual(["piercing", "lightning"]);
    expect(actionOf(table, IDS.fighter, "item-javelin-of-lightning-lightning-bolt")).toMatchObject({
      area: { shape: "line", sizeFeet: 120, widthFeet: 5 },
      save: { ability: "dex", dc: 13, successDamage: "half" },
      uses: { limit: 1, per: "long-rest" }
    });
  });

  it("throws a Dwarven Thrower 20/60, and binds an Energy Bow that shoots Force with no arrows", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    write(table, IDS.fighter, catalogRow("dwarven-thrower", { attuned: true }), "gm");
    expect(actionOf(table, IDS.fighter, "item-dwarven-thrower").attack).toMatchObject({
      rangeNormalFeet: 20,
      rangeFeet: 60
    });
    write(table, IDS.fighter, catalogRow("energy-bow", { baseId: "shortbow", attuned: true }), "gm");
    const bow = actionOf(table, IDS.fighter, "item-energy-bow");
    expect(bow.damage[0]!.type).toBe("force");
    write(table, IDS.fighter, edit(table, IDS.fighter, "arrows-20", { quantity: 0 }));
    fight(table, IDS.fighter);
    expect(resolveAt(table, IDS.fighter, "item-energy-bow", [15, 4], {}, 30).attack?.outcome).toBe("hit");
  });
});

describe("movement and Armor Class", () => {
  it("raises a Speed under 30 to 30 with Boots of Striding and Springing, and keeps it in Plate", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    table.actor(IDS.wizard).speedFeet = 25;
    write(table, IDS.wizard, catalogRow("boots-of-striding-and-springing", { attuned: true }));
    expect(currentSpeedFeet(table.actor(IDS.wizard), derived(table, IDS.wizard))).toBe(30);
    // Plate's Strength 15 would cost a Str 10 wearer 10 feet; the boots keep it.
    write(table, IDS.wizard, catalogRow("plate-armor"), "gm");
    expect(currentSpeedFeet(table.actor(IDS.wizard), derived(table, IDS.wizard))).toBe(30);
  });

  it("doubles its wearer's Speed when Boots of Speed click", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("boots-of-speed", { attuned: true }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-boots-of-speed-click-heels", [], { targetIds: [] });
    expect(currentSpeedFeet(table.actor(IDS.fighter), derived(table, IDS.fighter))).toBe(60);
  });

  it("works out a Robe of the Archmagi's wearer's AC as 15 plus Dexterity, unarmored", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    // Dex 14 (+2): 12 bare, 17 in the robe.
    expect(table.actor(IDS.wizard).armorClass).toBe(12);
    write(table, IDS.wizard, catalogRow("robe-of-the-archmagi", { attuned: true }));
    expect(table.actor(IDS.wizard).armorClass).toBe(17);
  });
});

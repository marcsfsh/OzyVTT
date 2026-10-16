import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { recoverAmmunition } from "../src/ammunition.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { RulesBlockedError } from "../src/game-store.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  serve,
  tableOf,
  wizardInput,
  write
} from "./equipment-table.js";

// Weapon properties the engine enforces when a character attacks (SRD 5.2.1 Weapons): Loading, Ammunition,
// Heavy, Two-Handed, Versatile and the melee/ranged band.

const blockedRule = (attempt: () => unknown): string | null => {
  try {
    attempt();
    return null;
  } catch (error) {
    return error instanceof RulesBlockedError ? error.rule : String(error);
  }
};

describe("Loading", () => {
  it("fires once per action whatever Extra Attack allows, and leaves the other attack to another weapon", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("heavy-crossbow"));
    write(table, IDS.fighter, catalogRow("crossbow-bolts-20", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-heavy-crossbow", [15, 4]);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-heavy-crossbow", [15, 4]))).toBe("attack.loading");
    // Extra Attack's second attack is still there for the greatsword.
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]))).toBeNull();
  });

  it("can follow another weapon's attack in the same action", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("heavy-crossbow"));
    write(table, IDS.fighter, catalogRow("crossbow-bolts-20", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-heavy-crossbow", [15, 4]))).toBeNull();
  });
});

describe("the melee and ranged bands", () => {
  it("throws a Dart as a ranged weapon even at an adjacent creature: no melee reach, close-combat Disadvantage", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dart", { quantity: 5 }));
    write(table, IDS.fighter, catalogRow("dagger"));
    expect(actionOf(table, IDS.fighter, "item-dart").attack?.reachFeet).toBeUndefined();
    // A Dagger is a melee weapon that can be thrown, so it keeps its reach.
    expect(actionOf(table, IDS.fighter, "item-dagger").attack?.reachFeet).toBe(5);
    fight(table, IDS.fighter);
    const resolution = resolveAt(table, IDS.fighter, "item-dart", [15, 3, 4], {}, 5);
    expect(resolution.rollMode?.disadvantage).toContain("Enemy within 5 feet (Foe)");
  });

  it("reads the band off the catalog for a row stored before the row carried it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dart"));
    const actor = table.actor(IDS.fighter);
    actor.inventory = actor.inventory.map((item) => {
      if (item.id !== "dart" || !item.weapon) return item;
      const { melee: _melee, ...legacy } = item.weapon;
      return { ...item, weapon: legacy };
    });
    expect(actionOf(table, IDS.fighter, "item-dart").attack?.reachFeet).toBeUndefined();
  });
});

describe("Versatile and Two-Handed", () => {
  it("offers a Versatile weapon's two-handed attack with the bigger die while no shield is worn", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("longsword"));
    expect(actionOf(table, IDS.fighter, "item-longsword").damage[0].formula).toBe("1d8 + 4");
    const twoHanded = actionOf(table, IDS.fighter, "item-longsword-two-handed");
    expect(twoHanded.damage[0].formula).toBe("1d10 + 4");
    // Extra Attack reaches the two-handed grip like any weapon attack.
    expect(twoHanded.attack?.count).toBe(2);
    write(table, IDS.fighter, catalogRow("shield"));
    expect(() => actionOf(table, IDS.fighter, "item-longsword-two-handed")).toThrow(/no item-longsword-two-handed/);
  });

  it("refuses a Two-Handed weapon's attack while a shield is on the arm", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("shield"));
    fight(table, IDS.fighter);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]))).toBe("attack.two-handed");
    // A one-handed weapon is fine.
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-flail", [15, 4]))).toBeNull();
  });
});

describe("Heavy", () => {
  it("gives Disadvantage with a Heavy melee weapon below Strength 13, and not to a strong wielder", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("greatsword"));
    write(table, IDS.wizard, catalogRow("longbow"));
    write(table, IDS.wizard, catalogRow("arrows-20", { equipped: false }));
    fight(table, IDS.wizard);
    const swing = resolveAt(table, IDS.wizard, "item-greatsword", [15, 3, 4, 4]);
    expect(swing.rollMode?.disadvantage).toEqual(["Greatsword is Heavy (Strength under 13)"]);
    // Dex 14 is enough for the Heavy longbow.
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false, actionInstance: null };
    expect(resolveAt(table, IDS.wizard, "item-longbow", [15, 4]).rollMode).toBeUndefined();
  });

  it("leaves a Strength 19 fighter's greatsword alone", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    expect(resolveAt(table, IDS.fighter, "item-greatsword", [15, 4, 4]).rollMode).toBeUndefined();
  });
});

describe("Slow, Vex and Sap", () => {
  /** Gives the foe a stat block: immune to `immune`, with one claw attack. */
  function foeWithStatBlock(table: ReturnType<typeof tableOf>, immune: string[]) {
    const definitionId = `import-${IDS.foe}`;
    table.state.definitions = [
      ...table.state.definitions,
      {
        id: definitionId,
        definition: ActorDefinitionSchema.parse({
          schemaId: "vtt.actor-monster",
          schemaVersion: 1,
          source: { name: "Test", version: "1" },
          name: "Foe",
          size: "medium",
          abilityScores: { str: 14, dex: 12, con: 12, int: 6, wis: 10, cha: 6 },
          proficiencyBonus: 2,
          armorClass: 10,
          hitPoints: { maximum: 60 },
          initiativeBonus: 1,
          speedFeet: 30,
          damageImmunities: immune,
          actions: [
            {
              id: "claw",
              name: "Claw",
              activation: "action",
              description: "Melee attack.",
              attack: { bonus: 4, reachFeet: 5 },
              damage: [{ formula: "1d6 + 2", type: "slashing" }]
            }
          ],
          token: { disposition: "hostile", footprint: { width: 1, height: 1 } }
        })
      }
    ];
    table.actor(IDS.foe).definitionId = definitionId;
  }
  const tags = (table: ReturnType<typeof tableOf>) => table.actor(IDS.foe).effects.flatMap((effect) => effect.tags);

  it("lays Slow only on a hit that deals damage", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("longbow"));
    foeWithStatBlock(table, ["piercing"]);
    fight(table, IDS.fighter);
    expect(resolveAt(table, IDS.fighter, "item-longbow", [18, 5]).attack?.outcome).toBe("hit");
    expect(tags(table)).not.toContain("slow");

    const harmed = tableOf({ [IDS.fighter]: fighterInput() });
    write(harmed, IDS.fighter, catalogRow("longbow"));
    foeWithStatBlock(harmed, []);
    fight(harmed, IDS.fighter);
    resolveAt(harmed, IDS.fighter, "item-longbow", [18, 5]);
    expect(tags(harmed)).toContain("slow");
  });

  it("lets Sap give Disadvantage to the sapped creature's next attack roll only", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    foeWithStatBlock(table, []);
    fight(table, IDS.fighter);
    expect(resolveAt(table, IDS.fighter, "item-flail", [18, 5]).attack?.outcome).toBe("hit");
    expect(tags(table)).toContain("sap");
    const claw = (faces: number[]) =>
      resolveDefinitionAction(
        table.state,
        table.resolve(`import-${IDS.foe}`)!.actions[0],
        { actorId: IDS.foe, targetIds: [IDS.fighter], commandId: `50000000-0000-4000-8000-0000000009${faces[0]}0` },
        {
          random: () => faces.shift()!,
          newRollId: (() => {
            let n = 0;
            return () => `40000000-0000-4000-8000-0000000009${String(n++).padStart(2, "0")}`;
          })(),
          gmSessionId: IDS.gmSession,
          now: () => "2026-10-16T00:00:00.000Z",
          definition: table.resolve(`import-${IDS.foe}`),
          catalog,
          resolveDefinition: table.resolve
        }
      );
    // On the foe's own turn, the action economy off so its one Claw can be made twice in a row.
    table.state.combat = { ...table.state.combat, turnActorId: IDS.foe, ruleExceptions: { economy: "freeform" } };
    expect(claw([15, 3, 4]).rollMode?.disadvantage).toEqual(["Sapped by Borin"]);
    expect(tags(table)).not.toContain("sap");
    expect(claw([16, 4]).rollMode).toBeUndefined();
  });
});

describe("two copies of one magic item", () => {
  it("holds a +1 longsword and a +1 dagger as two rows of the same record", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("weapon-1", { baseId: "longsword" }));
    write(table, IDS.fighter, catalogRow("weapon-1", { id: "weapon-1-2", recordId: "weapon-1", baseId: "dagger" }));
    const fighter = table.actor(IDS.fighter);
    expect(fighter.inventory.filter((item) => item.name === "Weapon, +1").map((item) => item.baseId)).toEqual([
      "longsword",
      "dagger"
    ]);
    // Str 19 (+4), PB 3 and the +1 on each; each its own base's die.
    const longsword = actionOf(table, IDS.fighter, "item-weapon-1");
    const dagger = actionOf(table, IDS.fighter, "item-weapon-1-2");
    expect([longsword.attack?.bonus, longsword.damage[0].formula]).toEqual([8, "1d8 + 5"]);
    expect([dagger.attack?.bonus, dagger.damage[0].formula]).toEqual([8, "1d4 + 5"]);
    // The copy is still that record: unbinding it to another base is a GM call, as for the first.
    expect(() => write(table, IDS.fighter, edit(table, IDS.fighter, "weapon-1-2", { baseId: "shortsword" }))).toThrow(
      /already bound/
    );
  });
});

describe("Ammunition", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });
  const row = (table: ReturnType<typeof tableOf>, id: string) =>
    table.actor(IDS.fighter).inventory.find((entry) => entry.id === id);

  it("spends one arrow a shot, hit or miss, from the bundles the fighter carries", () => {
    // Fighter B and the Soldier kit: a Longbow and two Arrows (20).
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30);
    expect(row(table, "arrows-20")).toMatchObject({ quantity: 2, ammunitionLeft: 39, ammunitionFired: 1 });
    // Extra Attack's second shot misses (3 + 4 against AC 10), and still spends an arrow.
    resolveAt(table, IDS.fighter, "item-longbow", [3], {}, 30);
    expect(row(table, "arrows-20")).toMatchObject({ quantity: 2, ammunitionLeft: 38, ammunitionFired: 2 });
  });

  it("refuses a bow with nothing to fire, and a crossbow with only arrows", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    write(table, IDS.fighter, edit(table, IDS.fighter, "arrows-20", { quantity: 0 }));
    write(table, IDS.fighter, catalogRow("light-crossbow"));
    fight(table, IDS.fighter);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30))).toBe(
      "attack.no-ammunition"
    );
    write(table, IDS.fighter, catalogRow("arrows-20", { equipped: false }));
    expect(blockedRule(() => resolveAt(table, IDS.fighter, "item-light-crossbow", [15, 4], {}, 30))).toBe(
      "attack.no-ammunition"
    );
    expect(() => resolveAt(table, IDS.fighter, "item-light-crossbow", [15, 4], {}, 30)).toThrow(
      "Borin has no bolts to fire from Light Crossbow."
    );
  });

  it("draws +1 ammunition first while it is equipped, and a piece that hits is not recovered", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    write(table, IDS.fighter, catalogRow("ammunition-1", { quantity: 10 }));
    fight(table, IDS.fighter);
    // d20 15 + Dex 1 + PB 3 + the arrow's 1.
    expect(resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30).attack?.total).toBe(20);
    expect(row(table, "ammunition-1")).toMatchObject({ quantity: 9 });
    expect(row(table, "ammunition-1")?.ammunitionFired).toBeUndefined();
    expect(row(table, "arrows-20")?.ammunitionLeft).toBeUndefined();
  });

  it("keeps the count when the sheet writes the row, and a bought bundle adds its pieces", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30);
    // A stale or forged count is the server's to keep.
    write(table, IDS.fighter, edit(table, IDS.fighter, "arrows-20", { ammunitionLeft: 999, equipped: true }));
    expect(row(table, "arrows-20")).toMatchObject({ quantity: 2, ammunitionLeft: 39, equipped: true });
    write(table, IDS.fighter, edit(table, IDS.fighter, "arrows-20", { quantity: 3 }));
    expect(row(table, "arrows-20")).toMatchObject({ quantity: 3, ammunitionLeft: 59 });
  });

  it("recovers half the arrows fired, rounded down, when the fight ends", async () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30);
    resolveAt(table, IDS.fighter, "item-longbow", [3], {}, 30);
    const { server, gmToken, post, log, close } = await serve(table);
    cleanups.push(close);
    expect((await post(GAME_PATHS.encounterEnd, gmToken, {})).status).toBeLessThan(300);
    const arrows = server.store.snapshot.actors
      .find((actor) => actor.id === IDS.fighter)!
      .inventory.find((entry) => entry.id === "arrows-20");
    expect(arrows).toMatchObject({ quantity: 2, ammunitionLeft: 39 });
    expect(arrows?.ammunitionFired).toBeUndefined();
    expect(await log()).toContain("Borin recovers 1 of the 2 pieces fired from Arrows (20).");
  });

  it("recovers nothing from a single piece, and clears the count", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-longbow", [15, 4], {}, 30);
    expect(recoverAmmunition(table.state, [IDS.fighter], catalog)).toEqual([]);
    expect(row(table, "arrows-20")).toMatchObject({ quantity: 2, ammunitionLeft: 39 });
    expect(row(table, "arrows-20")?.ammunitionFired).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema, type DamageSource } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { makeEffect } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { startEncounter } from "../src/encounter.js";
import { catalog, catalogRow, fighterInput, IDS, tableOf, wizardInput, write, type Table } from "./equipment-table.js";

// What dealt a creature's damage reaches the defences that read it (SRD 5.2.1): a Brooch of Shielding's "Immunity to
// damage from the Magic Missile spell", a Vorpal Sword that "ignores Resistance to Slashing damage" with that sword
// alone, a Shield of Missile Attraction's "Resistance to damage from attacks made with Ranged weapons" and its curse,
// an Arrow-Catching Shield's "+2 bonus to Armor Class against ranged attack rolls", and Steam Breath's Fire, which
// "Being underwater doesn't grant Resistance to".

const RANGED_WEAPON = ["ranged", "weapon", "ranged-weapon", "ranged-weapon-kind"];

function hit(table: Table, targetId: string, amount: number, type: string, damageSource?: DamageSource) {
  return applyDamageDetailed(
    table.state,
    targetId,
    {
      amount,
      parts: [{ amount, type }],
      sourceActorId: IDS.foe,
      ...(damageSource ? { damageSource } : {})
    },
    { role: "gm" },
    { resolveDefinition: table.resolve, catalog }
  ).application.totalApplied;
}

const ARCHER = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-monster",
  schemaVersion: 1,
  source: { name: "Test", version: "1", externalId: "archer" },
  name: "Archer",
  size: "medium",
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  armorClass: 10,
  hitPoints: { maximum: 30 },
  speedFeet: 30,
  actions: [
    {
      id: "shortbow",
      name: "Shortbow",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 4, rangeFeet: 320, rangeNormalFeet: 80 },
      damage: [{ formula: "1d6 + 2", type: "piercing" }]
    },
    {
      id: "scimitar",
      name: "Scimitar",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 4, reachFeet: 5 },
      damage: [{ formula: "1d6 + 2", type: "slashing" }]
    }
  ]
});

/** The fighter and the wizard in a fight with an archer that acts first; `feet` says how far apart each pair stands. */
function archeryRange(table: Table, feet: (a: string, b: string) => number) {
  table.state.definitions.push({ id: "def-archer", definition: ARCHER } as (typeof table.state.definitions)[number]);
  table.actor(IDS.foe).definitionId = "def-archer";
  startEncounter(
    table.state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.foe, score: 20 },
        { actorId: IDS.fighter, score: 10 },
        { actorId: IDS.wizard, score: 5 }
      ].filter((entry) => table.state.actors.some((actor) => actor.id === entry.actorId))
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
  let id = 0;
  return (actionId: string, targetId: string, faces: number[]) => {
    // Each shot is the archer's first of the turn.
    table.state.combat = { ...table.state.combat, turn: { ...table.state.combat.turn, actionUsed: false } };
    return resolveDefinitionAction(
      table.state,
      ARCHER.actions.find((action) => action.id === actionId)!,
      {
        actorId: IDS.foe,
        targetIds: [targetId],
        commandId: `51000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        commit: true
      },
      {
        random: () => faces.shift() ?? 1,
        newRollId: () => `52000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
        gmSessionId: IDS.gmSession,
        now: () => "2026-10-26T00:00:00.000Z",
        definition: ARCHER,
        catalog,
        resolveDefinition: table.resolve,
        distanceFeet: feet
      }
    );
  };
}

describe("a defence against one spell", () => {
  it("leaves a Brooch of Shielding's wearer unharmed by Magic Missile, and halves another Force spell", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("brooch-of-shielding", { attuned: true }));
    expect(hit(table, IDS.wizard, 3, "force", { spellId: "magic-missile" })).toBe(0);
    expect(hit(table, IDS.wizard, 10, "force", { spellId: "eldritch-blast" })).toBe(5);
  });

  it("carries how a shot was made to where its damage lands", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    const source = archeryRange(table, () => 30);
    expect(source("shortbow", IDS.wizard, [15, 3]).damageSource).toMatchObject({
      attackKinds: expect.arrayContaining(["ranged", "ranged-weapon-kind"])
    });
  });
});

describe("Resistance a weapon ignores", () => {
  const resistant = (table: Table) =>
    table.actor(IDS.foe).effects.push(
      makeEffect({
        id: "stoneskin",
        name: "Stoneskin",
        duration: { type: "manual" },
        modifiers: [{ type: "damage-resistance", damageTypes: ["slashing"] }]
      })
    );

  it("lets a Vorpal Sword's Slashing damage through Resistance, and not the same wielder's other blades", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("vorpal-sword", { baseId: "longsword", attuned: true }), "gm");
    resistant(table);
    const struck = (rowId: string) =>
      applyDamageDetailed(
        table.state,
        IDS.foe,
        { amount: 10, parts: [{ amount: 10, type: "slashing" }], sourceActorId: IDS.fighter, damageSource: { rowId } },
        { role: "gm" },
        { resolveDefinition: table.resolve, catalog }
      ).application.totalApplied;
    expect(struck("vorpal-sword")).toBe(10);
    expect(struck("greatsword")).toBe(5);
  });
});

describe("a Shield of Missile Attraction", () => {
  it("resists the damage of a Ranged weapon's attack, and not of a sword's or a spell's", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("shield-of-missile-attraction", { attuned: true }));
    expect(hit(table, IDS.fighter, 9, "piercing", { attackKinds: RANGED_WEAPON })).toBe(4);
    expect(hit(table, IDS.fighter, 9, "slashing", { attackKinds: ["melee", "weapon", "melee-weapon"] })).toBe(9);
    expect(hit(table, IDS.fighter, 9, "fire", { attackKinds: ["ranged", "spell"], spellId: "fire-bolt" })).toBe(9);
  });

  it("draws a shot at an ally within 10 feet onto its cursed bearer, even put away, and a sword swing stays", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("shield-of-missile-attraction", { attuned: true, equipped: false }), "gm");
    const shoot = archeryRange(table, (a, b) =>
      [a, b].includes(IDS.fighter) && [a, b].includes(IDS.wizard) ? 10 : 30
    );
    const shot = shoot("shortbow", IDS.wizard, [15, 3]);
    expect(shot.attack).toMatchObject({ targetId: IDS.fighter });
    expect(shot.tableNarration?.some((line) => line.text.includes("draws"))).toBe(true);
  });

  it("leaves a shot at a creature farther than 10 feet from the bearer where it was aimed", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("shield-of-missile-attraction", { attuned: true }), "gm");
    const shoot = archeryRange(table, () => 15);
    expect(shoot("shortbow", IDS.wizard, [15, 3]).attack).toMatchObject({ targetId: IDS.wizard });
  });
});

describe("an Arrow-Catching Shield", () => {
  it("adds 2 to its wielder's AC against a ranged attack roll and nothing against a melee one", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("arrow-catching-shield", { attuned: true }));
    const ac = table.actor(IDS.fighter).armorClass!;
    const shoot = archeryRange(table, (a, b) => ([a, b].includes(IDS.foe) ? 5 : 60));
    expect(shoot("shortbow", IDS.fighter, [10, 3]).attack?.targetAc).toBe(ac + 2);
    expect(shoot("scimitar", IDS.fighter, [10, 3]).attack?.targetAc).toBe(ac);
  });
});

describe("Fire underwater", () => {
  it("is resisted underwater, except Steam Breath's", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    archeryRange(table, () => 10);
    table.state.combat = { ...table.state.combat, underwater: true };
    expect(hit(table, IDS.wizard, 8, "fire")).toBe(4);
    expect(hit(table, IDS.wizard, 8, "fire", { fireUnderwater: true })).toBe(8);
  });
});

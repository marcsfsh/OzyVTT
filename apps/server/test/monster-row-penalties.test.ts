import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { endEncounter, startEncounter } from "../src/encounter.js";
import { CommandRejectedError } from "../src/game-store.js";
import { answerReaction } from "../src/reactions.js";
import { answerSave } from "../src/saving-throws.js";
import { catalog, catalogRow, fighterInput, IDS, tableOf, wizardInput, write, type Table } from "./equipment-table.js";

// What acid and rust do to carried armor and weapons (SRD 5.2.1 Black Pudding, Gray Ooze, Rust Monster): a cumulative
// -1 to the AC armor offers or to a weapon's attack rolls, armor destroyed at AC 10 and a weapon at -5, magic items
// spared, and Mending removing the penalty.

const MONSTERS = loadMonsterDefinitions();
const MONSTER = "10000000-0000-4000-8000-000000000901";
const NOW = () => "2026-10-19T00:00:00.000Z";
let command = 0;
const nextId = () => `60000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;

/** A table with the fighter (Chain Mail, AC 17 with Defense) facing one SRD stat block, in a fight. */
function fightWith(slug: string, characters: Parameters<typeof tableOf>[0] = { [IDS.fighter]: fighterInput() }) {
  const table = tableOf(characters, false);
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  table.state.definitions = [...table.state.definitions, { id: `${slug}-def`, definition }];
  table.state.actors.push({
    ...structuredClone(table.actor(IDS.fighter)),
    id: MONSTER,
    name: definition.name,
    kind: "monster",
    ownerSessionId: null,
    hp: { current: 100, maximum: 100, temporary: 0 },
    armorClass: definition.armorClass,
    inventory: [],
    effects: [],
    conditions: [],
    definitionId: `${slug}-def`,
    size: definition.size,
    sizeCells: 1
  } as GameState["actors"][number]);
  const fighter = table.actor(IDS.fighter);
  fighter.hp = { current: 300, maximum: 300, temporary: 0 };
  startEncounter(
    table.state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: MONSTER, score: 20 },
        { actorId: IDS.fighter, score: 10 },
        ...Object.keys(characters)
          .filter((id) => id !== IDS.fighter)
          .map((actorId) => ({ actorId, score: 5 }))
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
  return { table, definition, turn: structuredClone(table.state.combat.turn) };
}

const depsFor = (table: Table, actorId: string, faces: number[]): ResolveDependencies => ({
  random: () => faces.shift() ?? 1,
  newRollId: nextId,
  gmSessionId: IDS.gmSession,
  now: NOW,
  definition: table.resolve(table.actor(actorId).definitionId!),
  resolveDefinition: table.resolve,
  catalog
});

/** The monster uses one of its actions on the fighter. */
function monsterUses(table: Table, slug: string, actionId: string, faces: number[], objectItemId?: string) {
  const definition = table.resolve(`${slug}-def`)!;
  const action = definition.actions.find((entry) => entry.id === actionId)!;
  // Each use on a turn of its own.
  table.state.combat = { ...table.state.combat, turnActorId: MONSTER, turn: { ...FRESH_TURN } };
  return resolveDefinitionAction(
    table.state,
    action,
    {
      actorId: MONSTER,
      targetIds: [IDS.fighter],
      commandId: nextId(),
      ...(objectItemId ? { objectItemId } : {})
    },
    depsFor(table, MONSTER, faces)
  );
}

/** The character's own action by name, as its sheet offers it. */
const actionNamed = (table: Table, actorId: string, name: string) =>
  effectiveActions(table.definition(actorId), table.actor(actorId), catalog).find((action) => action.name === name);

/** The fighter's open save, failed. */
function failSave(table: Table) {
  const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.fighter)!;
  return answerSave(
    table.state,
    nextId(),
    pending.id,
    "manual",
    2,
    true,
    { role: "gm" },
    {
      random: () => 1,
      newRollId: nextId,
      sessionId: IDS.gmSession,
      role: "gm",
      now: NOW,
      resolveDefinition: table.resolve,
      catalog
    }
  );
}

const FRESH_TURN: GameState["combat"]["turn"] = fightWith("gray-ooze").turn;

const rowOf = (table: Table, id: string) => table.actor(IDS.fighter).inventory.find((row) => row.id === id);

describe("an ooze's Pseudopod eats the armor its target wears", () => {
  it("takes 1 off the AC nonmagical Chain Mail offers with each hit, and destroys it once its AC is 10", () => {
    const { table } = fightWith("black-pudding");
    expect(table.actor(IDS.fighter).armorClass).toBe(17);
    for (const expected of [16, 15, 14]) {
      monsterUses(table, "black-pudding", "dissolving-pseudopod", [19]);
      expect(table.actor(IDS.fighter).armorClass).toBe(expected);
    }
    expect(rowOf(table, "chain-mail")?.penalty).toBe(3);
    for (let hit = 0; hit < 3; hit++) monsterUses(table, "black-pudding", "dissolving-pseudopod", [19]);
    // Chain Mail's 16 at -6 is 10: gone, and the fighter is back to 10 + Dex.
    expect(rowOf(table, "chain-mail")).toBeUndefined();
    expect(table.actor(IDS.fighter).armorClass).toBe(11);
  });

  it("leaves magic armor whole", () => {
    const { table } = fightWith("gray-ooze");
    const fighter = table.actor(IDS.fighter);
    fighter.inventory = fighter.inventory.map((row) =>
      row.id === "chain-mail" ? { ...row, magic: { isMagic: true, attunementRequired: false } } : row
    );
    monsterUses(table, "gray-ooze", "pseudopod", [19]);
    expect(rowOf(table, "chain-mail")?.penalty).toBeUndefined();
    expect(fighter.armorClass).toBe(17);
  });

  it("is mended by Mending cast on the armor", () => {
    const wizard = wizardInput();
    wizard.choices = wizard.choices.map((choice) =>
      choice.kind === "cantrip" && choice.id === "light" ? { ...choice, id: "mending" } : choice
    );
    const { table } = fightWith("black-pudding", { [IDS.fighter]: fighterInput(), [IDS.wizard]: wizard });
    monsterUses(table, "black-pudding", "dissolving-pseudopod", [19]);
    monsterUses(table, "black-pudding", "dissolving-pseudopod", [19]);
    expect(table.actor(IDS.fighter).armorClass).toBe(15);
    // Mending takes a minute, so it is cast once the fight is over.
    endEncounter(table.state);
    const mending = effectiveActions(table.definition(IDS.wizard), table.actor(IDS.wizard), catalog).find(
      (action) => action.spellId === "mending"
    )!;
    resolveDefinitionAction(
      table.state,
      mending,
      { actorId: IDS.wizard, targetIds: [IDS.fighter], commandId: nextId(), objectItemId: "chain-mail" },
      depsFor(table, IDS.wizard, [])
    );
    expect(rowOf(table, "chain-mail")?.penalty).toBeUndefined();
    expect(table.actor(IDS.fighter).armorClass).toBe(17);
  });
});

describe("a rust monster's Antennae corrode the metal object it picks", () => {
  it("gives a weapon whose wielder fails the save -1 to its attack rolls, and destroys it at -5", () => {
    const { table } = fightWith("rust-monster");
    const bonus = actionNamed(table, IDS.fighter, "Greatsword")!.attack!.bonus;
    monsterUses(table, "rust-monster", "antennae", [], "greatsword");
    failSave(table);
    expect(rowOf(table, "greatsword")?.penalty).toBe(1);
    expect(actionNamed(table, IDS.fighter, "Greatsword")!.attack!.bonus).toBe(bonus - 1);
    for (let failure = 0; failure < 4; failure++) {
      monsterUses(table, "rust-monster", "antennae", [], "greatsword");
      failSave(table);
    }
    expect(rowOf(table, "greatsword")).toBeUndefined();
  });

  it("leaves the object alone on a success", () => {
    const { table } = fightWith("rust-monster");
    monsterUses(table, "rust-monster", "antennae", [], "greatsword");
    const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.fighter)!;
    answerSave(
      table.state,
      nextId(),
      pending.id,
      "manual",
      18,
      true,
      { role: "gm" },
      {
        random: () => 1,
        newRollId: nextId,
        sessionId: IDS.gmSession,
        role: "gm",
        now: NOW,
        resolveDefinition: table.resolve,
        catalog
      }
    );
    expect(rowOf(table, "greatsword")?.penalty).toBeUndefined();
  });

  it("refuses a magic weapon, and picks the worn armor when the GM names nothing", () => {
    const { table } = fightWith("rust-monster");
    write(table, IDS.fighter, catalogRow("weapon-1", { baseId: "longsword" }), "gm");
    expect(() => monsterUses(table, "rust-monster", "antennae", [], "weapon-1")).toThrow(CommandRejectedError);
    monsterUses(table, "rust-monster", "antennae", []);
    failSave(table);
    expect(rowOf(table, "chain-mail")?.penalty).toBe(1);
    expect(table.actor(IDS.fighter).armorClass).toBe(16);
  });
});

describe("a rust monster's Reflexive Antennae", () => {
  it("answer a sword's hit with Antennae, which corrode the hitter's armor on a failed save", () => {
    const { table } = fightWith("rust-monster");
    table.state.combat = { ...table.state.combat, turnActorId: IDS.fighter, turn: { ...FRESH_TURN } };
    resolveDefinitionAction(
      table.state,
      actionNamed(table, IDS.fighter, "Greatsword")!,
      { actorId: IDS.fighter, targetIds: [MONSTER], commandId: nextId() },
      depsFor(table, IDS.fighter, [15])
    );
    const prompt = table.state.combat.pendingReactions.find((entry) => entry.actorId === MONSTER)!;
    expect(prompt).toMatchObject({ kind: "triggered", cause: "hit", targetActorId: IDS.fighter });
    answerReaction(
      table.state,
      nextId(),
      prompt.id,
      true,
      undefined,
      { role: "gm" },
      {
        resolveDefinition: table.resolve,
        catalog,
        random: () => 1,
        newRollId: nextId,
        gmSessionId: IDS.gmSession,
        now: NOW
      }
    );
    failSave(table);
    expect(rowOf(table, "chain-mail")?.penalty).toBe(1);
    expect(table.actor(IDS.fighter).armorClass).toBe(16);
  });
});

describe("Corrosive Form eats the weapons and ammunition that hit it", () => {
  it("gives a nonmagical weapon that damages a black pudding -1 to its attack rolls", () => {
    const { table } = fightWith("black-pudding");
    table.state.combat = { ...table.state.combat, turnActorId: IDS.fighter };
    // A Flail's Bludgeoning damages the pudding.
    const flail = actionNamed(table, IDS.fighter, "Flail")!;
    resolveDefinitionAction(
      table.state,
      flail,
      { actorId: IDS.fighter, targetIds: [MONSTER], commandId: nextId() },
      depsFor(table, IDS.fighter, [15])
    );
    expect(rowOf(table, "flail")?.penalty).toBe(1);
    expect(actionNamed(table, IDS.fighter, "Flail")!.attack!.bonus).toBe(flail.attack!.bonus - 1);
  });

  it("destroys an arrow that hits a gray ooze, while one that misses can be found after the fight", () => {
    const { table } = fightWith("gray-ooze");
    write(table, IDS.fighter, catalogRow("longbow"), "gm");
    write(table, IDS.fighter, catalogRow("arrows-20", { equipped: false }), "gm");
    table.state.combat = { ...table.state.combat, turnActorId: IDS.fighter };
    const shoot = (face: number) =>
      resolveDefinitionAction(
        table.state,
        actionNamed(table, IDS.fighter, "Longbow")!,
        { actorId: IDS.fighter, targetIds: [MONSTER], commandId: nextId() },
        depsFor(table, IDS.fighter, [face])
      );
    shoot(15);
    expect(rowOf(table, "arrows-20")?.ammunitionFired).toBeUndefined();
    expect(rowOf(table, "longbow")?.penalty).toBeUndefined();
    shoot(1);
    expect(rowOf(table, "arrows-20")?.ammunitionFired).toBe(1);
  });
});

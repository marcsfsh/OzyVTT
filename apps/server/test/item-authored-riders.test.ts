import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { endEncounter } from "../src/encounter.js";
import { passGameTime } from "../src/game-time.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { answerSave, saveRollSources, saveSourceOf } from "../src/saving-throws.js";
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
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 magic items whose clauses the item vocabulary already covers, authored in `item-mechanics/items.ts` and
// driven through the shipped bundle with built characters: Metal Shell's immunity, the boots' Levitate on
// Concentration, the Cube of Force's Shield, the pipes' immunity after a success, the Potion of Diminution's smaller
// blows, Drain Life's healing, the robe's sight-gated save, the Potion of Water Breathing, several Fireball beads at
// once, the hour a Sword of Wounding and a Staff of Withering last, Lightning Strike's Line, the Well of Many Worlds'
// wait and the Wand of Fear's two spells.

const GM = { role: "gm" } as const;
let sequence = 0;
const nextId = () => `60000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";

const damage = (table: Table, actorId: string, amount: number, type: string) =>
  applyDamageDetailed(table.state, actorId, { amount: 0, parts: [{ amount, type }] }, GM, {
    resolveDefinition: table.resolve,
    catalog,
    newId: nextId,
    now: NOW
  });

/** Answers the first save the creature owes with this total. */
function answerAs(table: Table, actorId: string, total: number) {
  const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === actorId);
  if (!pending) throw new Error(`no save owed by ${actorId}`);
  return answerSave(table.state, nextId(), pending.id, "manual", total, true, GM, {
    random: () => 10,
    newRollId: nextId,
    sessionId: IDS.gmSession,
    role: "gm",
    now: NOW,
    resolveDefinition: table.resolve,
    catalog
  });
}

/** A fresh turn for the creature on turn, so a test can use another action. */
function freshTurn(table: Table) {
  const turn = table.state.combat.turn;
  table.state.combat.turn = {
    ...turn,
    actionUsed: false,
    bonusActionUsed: false,
    actionInstance: null,
    bonusActionInstance: null
  };
}

describe("Armor of Invulnerability's Metal Shell", () => {
  it("makes its wearer immune to Slashing for 10 minutes once a dawn, and ends when the armor comes off", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("armor-of-invulnerability", { attuned: true }), "gm");
    expect(damage(table, IDS.fighter, 12, "slashing").application.totalApplied).toBe(6);
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-armor-of-invulnerability-metal-shell", [], { targetIds: [] });
    const shell = table.actor(IDS.fighter).effects.find((effect) => effect.name === "Metal Shell");
    expect(shell?.duration).toEqual({ type: "rounds", remaining: 100 });
    expect(damage(table, IDS.fighter, 12, "slashing").application.totalApplied).toBe(0);
    freshTurn(table);
    expect(() =>
      resolveAt(table, IDS.fighter, "item-armor-of-invulnerability-metal-shell", [], { targetIds: [] })
    ).toThrow(/no uses remaining/);
    write(table, IDS.fighter, edit(table, IDS.fighter, "armor-of-invulnerability", { equipped: false }), "gm");
    expect(table.actor(IDS.fighter).effects.some((effect) => effect.name === "Metal Shell")).toBe(false);
    expect(damage(table, IDS.fighter, 12, "slashing").application.totalApplied).toBe(12);
  });
});

describe("Boots of Levitation", () => {
  it("cast Levitate on its wearer's Concentration: damage asks the save, and another spell ends it", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("boots-of-levitation", { attuned: true }));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-boots-of-levitation-levitate", [], { targetIds: [] });
    const levitating = () => table.actor(IDS.wizard).effects.find((effect) => effect.tags.includes("levitating"));
    expect(levitating()?.concentration).toBe(true);
    damage(table, IDS.wizard, 12, "bludgeoning");
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.wizard, ability: "con", dc: 10 }]);
    answerAs(table, IDS.wizard, 4);
    expect(levitating()).toBeUndefined();

    freshTurn(table);
    resolveAt(table, IDS.wizard, "item-boots-of-levitation-levitate", [], { targetIds: [] });
    expect(levitating()).toBeDefined();
    freshTurn(table);
    resolveAt(table, IDS.wizard, "spell-detect-magic", [], { targetIds: [] });
    expect(levitating()).toBeUndefined();
  });
});

describe("Cube of Force's Shield face", () => {
  it("is a Reaction cast of Shield on the cube's charges", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("cube-of-force", { attuned: true }));
    expect(actionOf(table, IDS.wizard, "item-cube-of-force-cast-shield")).toMatchObject({
      activation: "reaction",
      reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5 },
      uses: { limit: 10, per: "long-rest", pool: "cube-of-force-charges" }
    });
  });
});

describe("Pipes of Haunting", () => {
  it("leaves a creature that succeeds immune to the pipes' next tune", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("pipes-of-haunting"));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-pipes-of-haunting-play", []);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, dc: 15, immuneOnSuccess: true }]);
    answerAs(table, IDS.foe, 20);
    freshTurn(table);
    const again = resolveAt(table, IDS.wizard, "item-pipes-of-haunting-play", []);
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(again.warnings?.join(" ")).toMatch(/immune/i);
  });
});

describe("Potion of Diminution", () => {
  it("takes 1d4 off its drinker's weapon damage, never below 1", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-diminution", { equipped: false }));
    write(table, IDS.fighter, catalogRow("longsword"));
    fight(table, IDS.fighter);
    // 1d4 hours: a 2.
    resolveAt(table, IDS.fighter, "item-potion-of-diminution-drink", [2], { targetIds: [] });
    expect(table.actor(IDS.fighter).effects.find((effect) => effect.name === "Potion of Diminution")).toBeDefined();
    // A hit, the Longsword's d8 at 6 with Strength +4, and the potion's d4 at 3 taken off.
    expect(resolveAt(table, IDS.fighter, "item-longsword", [17, 6, 3]).damageTotal).toBe(6 + 4 - 3);
  });
});

describe("Rod of Lordly Might's Drain Life", () => {
  it("heals its wielder half the Necrotic damage a failed save deals", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("rod-of-lordly-might", { attuned: true }), "gm");
    const fighter = table.actor(IDS.fighter);
    fighter.hp = { ...fighter.hp, current: 10 };
    fight(table, IDS.fighter);
    // A hit with the Mace (1d6 + 4 + 3), then Drain Life's 4d6 at 3, 4, 3 and 4.
    resolveAt(table, IDS.fighter, "item-rod-of-lordly-might", [17, 3, 3, 4, 3, 4], {
      hitOptions: [{ id: "item-rod-of-lordly-might-drain-life" }]
    });
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, dc: 17, proposedDamage: 14 }]);
    answerAs(table, IDS.foe, 5);
    expect(table.actor(IDS.fighter).hp.current).toBe(10 + 7);
  });
});

describe("Robe of Scintillating Colors", () => {
  it("asks its save only of a creature that can see the wearer", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("robe-of-scintillating-colors", { attuned: true }), "gm");
    fight(table, IDS.wizard);
    table.actor(IDS.foe).conditions = [{ id: "blinded" }];
    const blinded = resolveAt(table, IDS.wizard, "item-robe-of-scintillating-colors-dazzle", []);
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(blinded.warnings?.join(" ")).toMatch(/can't see Ilyana/);
    table.actor(IDS.foe).conditions = [];
    freshTurn(table);
    resolveAt(table, IDS.wizard, "item-robe-of-scintillating-colors-dazzle", []);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, conditionIds: ["stunned"] }]);
  });
});

describe("Potion of Water Breathing", () => {
  it("lets its drinker breathe underwater for 24 hours of game time", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("potion-of-water-breathing", { equipped: false }));
    resolveAt(table, IDS.wizard, "item-potion-of-water-breathing-drink", [], { targetIds: [] });
    const breathing = () =>
      table.actor(IDS.wizard).effects.find((effect) => effect.tags.includes("water-breathing"))?.duration;
    expect(breathing()).toEqual({ type: "minutes", remaining: 1440 });
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "potion-of-water-breathing")).toBe(false);
    passGameTime(table.state, 23 * 60);
    expect(breathing()).toBeDefined();
    passGameTime(table.state, 2 * 60);
    expect(breathing()).toBeUndefined();
  });
});

describe("Necklace of Fireballs", () => {
  it("hurls up to five beads at once, 1d6 more for each after the first, to 12d6", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("necklace-of-fireballs"));
    const three = actionOf(table, IDS.wizard, "item-necklace-of-fireballs-cast-fireball-5");
    expect(three).toMatchObject({ useCost: 3, save: { dc: 15 } });
    expect(three.damage[0]?.formula).toBe("10d6");
    expect(actionOf(table, IDS.wizard, "item-necklace-of-fireballs-cast-fireball-7").damage[0]?.formula).toBe("12d6");
    expect(() => actionOf(table, IDS.wizard, "item-necklace-of-fireballs-cast-fireball-8")).toThrow();
    fight(table, IDS.wizard);
    resolveAt(
      table,
      IDS.wizard,
      "item-necklace-of-fireballs-cast-fireball-5",
      Array.from({ length: 10 }, () => 3),
      {
        areaPlaced: true
      } as never
    );
    expect(table.actor(IDS.wizard).actionUses["necklace-of-fireballs-beads"]).toBe(3);
  });
});

describe("the hour a hit's effect lasts", () => {
  it("ends a Sword of Wounding's stopped healing an hour of game time after the encounter", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("sword-of-wounding", { attuned: true, baseId: "longsword" }), "gm");
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-sword-of-wounding", [17, 4, 3, 3]);
    answerAs(table, IDS.foe, 3);
    const wounded = () => table.actor(IDS.foe).effects.find((effect) => effect.tags.includes("no-healing"));
    expect(wounded()?.duration).toEqual({ type: "minutes", remaining: 60 });
    endEncounter(table.state);
    expect(wounded()).toBeDefined();
    passGameTime(table.state, 61);
    expect(wounded()).toBeUndefined();
  });

  it("ends a Staff of Withering's Disadvantage after an hour", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("staff-of-withering", { attuned: true }), "gm");
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-staff-of-withering", [17, 4, 6, 4], {
      hitOptions: [{ id: "item-staff-of-withering-withering", effects: ["withering"] }]
    });
    answerAs(table, IDS.foe, 3);
    const withered = () => table.actor(IDS.foe).effects.find((effect) => effect.name === "Withered");
    expect(withered()?.duration).toEqual({ type: "minutes", remaining: 60 });
    endEncounter(table.state);
    passGameTime(table.state, 61);
    expect(withered()).toBeUndefined();
  });
});

describe("Staff of Thunder and Lightning's Lightning Strike", () => {
  it("is a 120-foot Line 5 feet wide", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("staff-of-thunder-and-lightning", { attuned: true }), "gm");
    expect(actionOf(table, IDS.wizard, "item-staff-of-thunder-and-lightning-lightning-strike").area).toEqual({
      shape: "line",
      sizeFeet: 120,
      widthFeet: 5
    });
  });
});

describe("Well of Many Worlds", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("waits its rolled 1d8 hours of game time before it opens another portal", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("well-of-many-worlds"));
    fight(table, IDS.wizard);
    // The wait's d8 shows 3.
    const opened = resolveAt(table, IDS.wizard, "item-well-of-many-worlds-open-portal", [3], { targetIds: [] });
    expect(opened.warnings?.join(" ")).toMatch(/3 hours/);
    freshTurn(table);
    expect(() => resolveAt(table, IDS.wizard, "item-well-of-many-worlds-open-portal", [3], { targetIds: [] })).toThrow(
      /no uses remaining/
    );
    endEncounter(table.state);
    passGameTime(table.state, 3 * 60);
    expect(table.actor(IDS.wizard).actionUses["item-well-of-many-worlds-open-portal"]).toBeUndefined();
  });

  it("starts the wait when it is opened outside an encounter", async () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("well-of-many-worlds"));
    const served = await serve(table);
    cleanups.push(served.close);
    const used = await served.post(GAME_PATHS.actionUse, served.gmToken, {
      commandId: randomUUID(),
      actorId: IDS.wizard,
      actionId: "item-well-of-many-worlds-open-portal"
    });
    expect(used.status).toBe(200);
    const wizard = served.server.store.snapshot.actors.find((actor) => actor.id === IDS.wizard)!;
    expect(wizard.readyAt["item-well-of-many-worlds-open-portal"]).toBeDefined();
    expect((await served.log()).some((text) => /Open a Portal can be used again in \d+ hours?\./.test(text))).toBe(
      true
    );
  });
});

describe("Dragon Scale Mail", () => {
  it("gives Advantage on a save against a Dragon's breath weapon, and on no other save a Dragon forces", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("dragon-scale-mail", { attuned: true }), "gm");
    const fighter = table.actor(IDS.fighter);
    const derivation = deriveEquipment(fighter, table.definition(IDS.fighter), catalog);
    const against = (actionName: string, creatureType: string) =>
      saveRollSources(fighter, "dex", derivation, false, [], creatureType, saveSourceOf({ actionName })).advantage;
    expect(against("Fire Breath (Recharge 5-6)", "dragon")).toHaveLength(1);
    expect(against("Rend", "dragon")).toEqual([]);
    expect(against("Fire Breath (Recharge 5-6)", "monstrosity")).toEqual([]);
    expect(actionOf(table, IDS.fighter, "item-dragon-scale-mail-sense-dragon").uses).toEqual({
      limit: 1,
      per: "long-rest"
    });
  });
});

describe("Wand of Fear", () => {
  it("casts Command with Flee or Grovel only for 1 charge, and Fear in a 60-foot Cone for 3", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("wand-of-fear", { attuned: true }));
    const command = actionOf(table, IDS.wizard, "item-wand-of-fear-cast-command");
    expect(command.save?.dc).toBe(15);
    expect(command.save?.failureEffect?.options?.map((option) => option.id)).toEqual(["flee", "grovel"]);
    expect(actionOf(table, IDS.wizard, "item-wand-of-fear-cast-fear")).toMatchObject({
      useCost: 3,
      area: { shape: "cone", sizeFeet: 60 },
      save: { dc: 15 },
      uses: { limit: 7, pool: "wand-of-fear-charges" }
    });
    fight(table, IDS.wizard);
    expect(() =>
      resolveAt(table, IDS.wizard, "item-wand-of-fear-cast-command", [], { optionId: "halt" } as never)
    ).toThrow(/doesn't offer that choice/);
    resolveAt(table, IDS.wizard, "item-wand-of-fear-cast-command", [], { optionId: "flee" } as never);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, dc: 15 }]);
  });
});

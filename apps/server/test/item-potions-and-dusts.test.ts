import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { AvailableActionsReply } from "@vtt/domain";
import { createInitialGameState, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { giveItem, setInventoryItem } from "../src/inventory.js";
import { storedDefinition } from "../src/actor-roster.js";
import { projectPlayerView } from "../src/projections.js";
import { answerSave } from "../src/saving-throws.js";
import { breathAtTurnEnd, breathesWater } from "../src/breath.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { FIRST_SIGHT_CHARMS_TAG, firstSightCharms, settleFirstSight } from "../src/first-sight.js";
import { passesEarth, shuntOutOfEarth } from "../src/wall-passage.js";
import { InventoryItemSchema } from "@vtt/schemas";
import { bootServer } from "./boot-server.js";
import { bardInput, build, fight as casterFight, FOE } from "./spell-casters.js";
import { startEncounter } from "../src/encounter.js";
import { cell, DIVIDER, HERO, ORC, visionGame } from "./vision-fixtures.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 potions and dusts whose text needs more than a cast: a Potion of Poison "looks, smells, and tastes like a
// Potion of Healing" until Identify reveals it, and its drinker takes "4d6 Poison damage and must succeed on a DC 13
// Constitution saving throw or have the Poisoned condition for 1 hour". Dust of Sneezing and Choking leaves a creature
// that fails "suffocating", ended by Lesser Restoration; Dust of Disappearance's Invisible lasts "2d4 minutes. The
// duration is the same for all subjects"; a Philter of Love charms its drinker by "the next time you see a creature";
// an Energy Bow's Arrow of Restraint restrains "instead of dealing damage" and its Arrow of Transport teleports a
// creature "to an unoccupied space you can see within 10 feet of you"; and a Ring of Elemental Command's wearer breathes
// water, moves through earth, and directs a compelled Elemental's next turn.

const GM = { role: "gm" } as const;
let sequence = 0;
const nextId = () => `70000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-26T00:00:00.000Z";
const OWNER = "30000000-0000-4000-8000-0000000000b1";

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

/** A fight with these creatures in it, the first on turn. */
function fightAll(table: Table, actorIds: readonly string[]): void {
  startEncounter(
    table.state,
    { mapAssetId: IDS.map, entries: actorIds.map((actorId, index) => ({ actorId, score: 20 - index })) },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("a Potion of Poison", () => {
  function poisoned(total: number) {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("potion-of-poison"), "gm");
    const row = table.actor(IDS.fighter).inventory.find((entry) => entry.recordId === "potion-of-poison")!;
    fight(table, IDS.fighter);
    const before = table.actor(IDS.fighter).hp.current;
    resolveAt(table, IDS.fighter, `item-${row.id}-drink`, [1, 2, 3, 4], { targetIds: [IDS.fighter] });
    expect(table.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.fighter, ability: "con", dc: 13, fullOnSuccess: true }
    ]);
    answerAs(table, IDS.fighter, total);
    return { taken: before - table.actor(IDS.fighter).hp.current, actor: table.actor(IDS.fighter) };
  }

  it("deals its 4d6 Poison whether the DC 13 Constitution save succeeds or fails", () => {
    expect(poisoned(20).taken).toBe(10);
    expect(poisoned(5).taken).toBe(10);
  });

  it("leaves Poisoned for an hour on a failure only", () => {
    expect(poisoned(20).actor.conditions.some((condition) => condition.id === "poisoned")).toBe(false);
    const failed = poisoned(5).actor;
    expect(failed.conditions.some((condition) => condition.id === "poisoned")).toBe(true);
    expect(
      failed.effects.some((effect) => effect.duration.type === "minutes" && effect.duration.remaining === 60)
    ).toBe(true);
  });

  it("arrives under a Potion of Healing's row id and keeps its record for the GM", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    const held = new Set(table.actor(IDS.fighter).inventory.map((row) => row.id));
    write(table, IDS.fighter, catalogRow("potion-of-poison"), "gm");
    write(table, IDS.fighter, catalogRow("potion-of-poison"), "gm");
    const added = table.actor(IDS.fighter).inventory.filter((row) => !held.has(row.id));
    const base = held.has("potion-of-healing") ? "potion-of-healing-2" : "potion-of-healing";
    expect(added[0]).toMatchObject({
      id: base,
      name: "Potion of Poison",
      recordId: "potion-of-poison",
      disguisedAs: "potion-of-healing"
    });
    expect(added[1]!.id).toMatch(/^potion-of-healing-\d$/);
  });

  it("reads as a Potion of Healing in its holder's projection until it is identified", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    table.actor(IDS.fighter).ownerSessionId = OWNER;
    write(table, IDS.fighter, catalogRow("potion-of-poison"), "gm");
    const row = table.actor(IDS.fighter).inventory.find((entry) => entry.recordId === "potion-of-poison")!;
    const seen = () =>
      projectPlayerView(table.state, OWNER, () => "online", Date.now(), { catalog }).actors.find(
        (actor) => actor.id === IDS.fighter
      )!.inventory!;
    const shown = seen().find((entry) => entry.id === row.id)!;
    expect(shown.name).toBe("Potion of Healing");
    expect(shown.description).toMatch(/regains 2d4 \+ 2 Hit Points/);
    expect(shown).not.toHaveProperty("disguisedAs");
    expect(shown.recordId === undefined || shown.recordId === "potion-of-healing").toBe(true);
    expect(JSON.stringify(seen())).not.toMatch(/poison/i);
    // Identify tells its holder what it is.
    row.identified = true;
    expect(seen().find((entry) => entry.id === row.id)).toMatchObject({
      name: "Potion of Poison",
      recordId: "potion-of-poison"
    });
  });

  it("keeps its record and name through its holder's edit, and passes for healing in a gift", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() }, false);
    table.actor(IDS.fighter).ownerSessionId = OWNER;
    write(table, IDS.fighter, catalogRow("potion-of-poison"), "gm");
    const row = table.actor(IDS.fighter).inventory.find((entry) => entry.recordId === "potion-of-poison")!;
    const shown = projectPlayerView(table.state, OWNER, () => "online", Date.now(), { catalog })
      .actors.find((actor) => actor.id === IDS.fighter)!
      .inventory!.find((entry) => entry.id === row.id)!;
    // The player's sheet sends back the row it was shown.
    setInventoryItem(table.state, IDS.fighter, { ...shown, equipped: false }, table.resolve, {
      catalog,
      role: "player"
    });
    expect(table.actor(IDS.fighter).inventory.find((entry) => entry.id === row.id)).toMatchObject({
      name: "Potion of Poison",
      recordId: "potion-of-poison",
      disguisedAs: "potion-of-healing"
    });
    const given = giveItem(table.state, IDS.fighter, IDS.wizard, row.id, table.resolve, { catalog, role: "gm" });
    expect(given.name).toBe("Potion of Healing");
    const moved = table.actor(IDS.wizard).inventory.find((entry) => entry.recordId === "potion-of-poison")!;
    expect(moved.id).toMatch(/^potion-of-healing/);
  });

  it("offers its holder a Potion of Healing's drink, under the same option id the GM sees", async () => {
    const state = createInitialGameState();
    const borin = PLACEHOLDER_ACTOR_IDS.fighter;
    const actor = state.actors.find((candidate) => candidate.id === borin)!;
    setInventoryItem(state, borin, catalogRow("potion-of-poison"), (id) => storedDefinition(state, id), {
      catalog,
      role: "gm"
    });
    const row = actor.inventory.find((entry) => entry.recordId === "potion-of-poison")!;
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const owner = booted.server.auth.issuePlayerSession();
    expect((await booted.post(GAME_PATHS.claims, owner, { commandId: randomUUID(), actorId: borin })).status).toBe(200);
    const read = async (token: string) => {
      const response = await fetch(booted.base + GAME_PATHS.actorAvailableActions.replace("{actorId}", borin), {
        headers: { authorization: `Bearer ${token}` }
      });
      return ((await response.json()) as { data: AvailableActionsReply }).data;
    };
    const id = `item-${row.id}-drink`;
    const mine = await read(owner);
    expect(mine.actions.find((entry) => entry.id === id)).toMatchObject({ name: "Drink Potion of Healing" });
    expect(JSON.stringify(mine)).not.toMatch(/Poison damage/);
    expect((await read(booted.gmToken)).actions.find((entry) => entry.id === id)).toMatchObject({
      name: "Drink the Potion"
    });
  });
});

describe("Dust of Sneezing and Choking", () => {
  function thrown() {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("dust-of-sneezing-and-choking"), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-dust-of-sneezing-and-choking-throw", [], { targetIds: [IDS.foe] }, 10);
    answerAs(table, IDS.foe, 5);
    return table;
  }

  it("leaves a creature that fails choking: a level of Exhaustion as its turns end, gone when it can breathe", () => {
    const table = thrown();
    const foe = table.actor(IDS.foe);
    expect(foe.conditions.map((condition) => condition.id)).toContain("incapacitated");
    expect(foe.effects.find((effect) => effect.breath !== undefined)).toMatchObject({
      name: "Suffocating",
      breath: { roundsLeft: 0 }
    });
    breathAtTurnEnd(table.state, foe);
    expect(table.actor(IDS.foe).conditions.find((condition) => condition.id === "exhaustion")?.level).toBe(1);
    // The save at the end of a later turn succeeds: the sneezing ends, and so do the levels it gave.
    const sneezing = table.actor(IDS.foe).effects.find((effect) => effect.name.startsWith("Sneezing"))!;
    endEffect(table.state, IDS.foe, sneezing.id);
    const after = table.actor(IDS.foe);
    expect(after.conditions.some((condition) => condition.id === "exhaustion")).toBe(false);
    expect(after.effects.some((effect) => effect.breath !== undefined)).toBe(false);
  });

  it("ends on a creature Lesser Restoration touches", () => {
    // The sneezing a failure leaves, as the dust's save puts it on.
    const failure = thrown()
      .actor(IDS.foe)
      .effects.find((effect) => effect.name.startsWith("Sneezing"))!;
    expect(failure.tags).toEqual(expect.arrayContaining(["choking", "cured-by-lesser-restoration"]));
    const { state, resolve } = casterFight(build(bardInput(["lesser-restoration"])));
    const goblin = state.actors.find((actor) => actor.id === FOE)!;
    addEffect(state, FOE, { ...failure, id: "sneezing" });
    expect(goblin.conditions.map((condition) => condition.id)).toContain("incapacitated");
    resolve("spell-lesser-restoration", {});
    const after = state.actors.find((actor) => actor.id === FOE)!;
    expect(after.effects.some((effect) => effect.id === "sneezing")).toBe(false);
    expect(after.conditions.some((condition) => condition.id === "incapacitated")).toBe(false);
  });
});

describe("Dust of Disappearance", () => {
  it("makes its user and a creature 5 feet away Invisible for the same rolled minutes, until each acts", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput(), [IDS.fighter]: fighterInput() });
    write(table, IDS.wizard, catalogRow("dust-of-disappearance"), "gm");
    fightAll(table, [IDS.wizard, IDS.fighter]);
    resolveAt(table, IDS.wizard, "item-dust-of-disappearance-throw", [3, 4], { targetIds: [IDS.fighter] }, 5);
    const given = (actorId: string) =>
      table.actor(actorId).effects.find((effect) => effect.name === "Dust of Disappearance");
    for (const actorId of [IDS.wizard, IDS.fighter]) {
      // 3 + 4 minutes, as rounds in a fight.
      expect(given(actorId)).toMatchObject({ duration: { type: "rounds", remaining: 70 } });
      expect(given(actorId)!.tags).toContain("until-it-acts");
      expect(table.actor(actorId).conditions.map((condition) => condition.id)).toContain("invisible");
    }
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "dust-of-disappearance")).toBe(false);
  });
});

describe("a Philter of Love", () => {
  const waiting = makeEffect({
    id: "philter",
    name: "Philter of Love",
    tags: [FIRST_SIGHT_CHARMS_TAG],
    duration: { type: "minutes", remaining: 10 }
  });

  it("is drunk for a 10-minute wait for the first creature its drinker sees", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("philter-of-love"), "gm");
    expect(actionOf(table, IDS.wizard, "item-philter-of-love-drink").grants).toMatchObject({
      tags: [FIRST_SIGHT_CHARMS_TAG],
      duration: { type: "minutes", minutes: 10 }
    });
  });

  it("charms its drinker for an hour by the nearest creature it sees, and waits while it sees none", () => {
    const hidden = visionGame({ walls: [DIVIDER()], actors: { [HERO]: { effects: [waiting] } } });
    expect(firstSightCharms(hidden, {})).toEqual([]);
    const state = visionGame({
      positions: { [ORC]: cell(5, 5) },
      actors: { [HERO]: { effects: [waiting] } }
    });
    expect(firstSightCharms(state, {})).toEqual([{ drinkerId: HERO, effectId: "philter", seenId: ORC }]);
    settleFirstSight(state, {});
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    expect(hero.effects.some((effect) => effect.id === "philter")).toBe(false);
    expect(hero.effects.find((effect) => effect.sourceActorId === ORC)).toMatchObject({
      duration: { type: "minutes", remaining: 60 },
      linkedConditionIds: ["charmed"]
    });
    expect(hero.conditions.map((condition) => condition.id)).toContain("charmed");
  });

  it("waits for the GM when dynamic vision is off", () => {
    const state = visionGame({ enabled: false, actors: { [HERO]: { effects: [waiting] } } });
    expect(firstSightCharms(state, {})).toEqual([]);
  });
});

describe("an Energy Bow", () => {
  it("restrains instead of dealing damage with an Arrow of Restraint: DC 15 Strength, a DC 20 Athletics escape", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b") });
    write(table, IDS.fighter, catalogRow("energy-bow", { baseId: "shortbow", attuned: true }), "gm");
    fight(table, IDS.fighter);
    resolveAt(
      table,
      IDS.fighter,
      "item-energy-bow",
      [15, 4],
      { hitOptions: [{ id: "item-energy-bow-arrow-of-restraint" }] },
      30
    );
    expect(table.actor(IDS.foe).hp.current).toBe(60);
    expect(table.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, ability: "str", dc: 15 }]);
    answerAs(table, IDS.foe, 5);
    const foe = table.actor(IDS.foe);
    expect(foe.conditions.map((condition) => condition.id)).toContain("restrained");
    expect(foe.effects.find((effect) => effect.linkedConditionIds.includes("restrained"))).toMatchObject({
      duration: { type: "rounds", remaining: 10 },
      endAction: { kind: "check", skill: "athletics", dc: 20 }
    });
  });

  it("sends a willing creature with an Arrow of Transport to a space within 10 feet of its wielder", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b"), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("energy-bow", { baseId: "shortbow", attuned: true }), "gm");
    fightAll(table, [IDS.fighter, IDS.wizard]);
    resolveAt(table, IDS.fighter, "item-energy-bow-arrow-of-transport", [], { targetIds: [IDS.wizard] }, 50);
    expect(
      table.actor(IDS.wizard).effects.find((effect) => effect.grantedTeleport !== undefined)?.grantedTeleport
    ).toMatchObject({ near: { actorId: IDS.fighter, feet: 10 } });
  });
});

describe("a Ring of Elemental Command", () => {
  it("lets the Water ring's wearer breathe water, and the Earth ring's walk through the map's walls", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("ring-of-elemental-command", { attuned: true, variantId: "water" }), "gm");
    expect(breathesWater(table.actor(IDS.wizard), table.definition(IDS.wizard))).toBe(true);
    expect(passesEarth(table.actor(IDS.wizard))).toBe(false);
    const ring = table.actor(IDS.wizard).inventory.find((row) => row.variantId === "water")!;
    write(table, IDS.wizard, { ...ring, variantId: "earth" }, "gm");
    expect(breathesWater(table.actor(IDS.wizard), table.definition(IDS.wizard))).toBe(false);
    expect(passesEarth(table.actor(IDS.wizard))).toBe(true);
  });

  it("shunts the Earth ring's wearer out of the rock when it ends its turn in a wall", () => {
    const ring = InventoryItemSchema.parse({
      id: "ring-of-elemental-command",
      name: "Ring of Elemental Command",
      equipped: true,
      attuned: true,
      variantId: "earth"
    });
    const state = visionGame({
      walls: [DIVIDER()],
      positions: { [HERO]: { x: 250, y: 275 } },
      actors: { [HERO]: { inventory: [ring] } }
    });
    expect(shuntOutOfEarth(state, HERO)).toHaveLength(1);
    const position = state.combat.tokens.find((token) => token.actorId === HERO)!.position!;
    expect(Math.abs(position.x - 250)).toBe(50);
    expect(shuntOutOfEarth(state, HERO)).toEqual([]);
  });

  it("puts an Elemental that fails Elemental Compulsion under its wearer's command until the wearer's next turn", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("ring-of-elemental-command", { attuned: true, variantId: "air" }), "gm");
    expect(actionOf(table, IDS.wizard, "item-ring-of-elemental-command-elemental-compulsion").save).toMatchObject({
      failureConditions: ["charmed"],
      failureDuration: { type: "until-source-next-turn" },
      failureEffect: { tags: ["commanded"] }
    });
  });
});

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { addEffect, makeEffect, type EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  serve,
  tableOf,
  write,
  type Table
} from "./equipment-table.js";

// The SRD's Burning hazard, a coat of Oil, Antitoxin and Basic Poison (Rules Glossary; Adventuring Gear).

const GM = { role: "gm" } as const;
let id = 0;
const nextId = () => `60000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
const NOW = () => "2026-10-16T00:00:00.000Z";
const foe = (table: Table) => table.actor(IDS.foe);
const fighter = (table: Table) => table.actor(IDS.fighter);

/** Answers the open save on `targetId` with a typed total (a failure below the DC). */
function answer(table: Table, targetId: string, total: number) {
  const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === targetId);
  if (!pending) throw new Error("no pending save");
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
/** The next combatant's turn, its turn-start dice from `faces`. */
function advance(table: Table, faces: number[]): EffectNarration[] {
  const events: EffectNarration[] = [];
  nextInitiativeTurn(table.state, events, {
    resolveDefinition: table.resolve,
    rollDie: () => faces.shift() ?? 1,
    newId: nextId,
    now: NOW,
    catalog
  });
  return events;
}
const fresh = (table: Table) => {
  table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false, actionInstance: null };
};

describe("Alchemist's Fire", () => {
  it("sets a creature that fails its save burning: 1d4 Fire at the start of each of its turns", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("alchemists-fire", { quantity: 2, equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-alchemists-fire-throw", [3]);
    answer(table, IDS.foe, 1);
    expect(foe(table).hp.current).toBe(57);
    expect(foe(table).effects).toMatchObject([
      {
        name: "Burning",
        tags: ["burning"],
        sourceActorId: IDS.fighter,
        duration: { type: "manual" },
        ongoingDamage: { damage: [{ formula: "1d4", type: "fire" }], at: "bearer-turn-start" }
      }
    ]);
    const starting = advance(table, [4]);
    expect(foe(table).hp.current).toBe(53);
    expect(starting.map((event) => event.text)).toContain("Foe takes 4 Fire damage from Burning.");
  });

  it("burns once however many flasks land", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("alchemists-fire", { quantity: 2, equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-alchemists-fire-throw", [1]);
    answer(table, IDS.foe, 1);
    fresh(table);
    resolveAt(table, IDS.fighter, "item-alchemists-fire-throw", [1]);
    answer(table, IDS.foe, 1);
    expect(foe(table).effects.filter((effect) => effect.tags.includes("burning"))).toHaveLength(1);
  });

  it("goes out when the burning creature rolls on the ground as its action, leaving it Prone", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("alchemists-fire", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-alchemists-fire-throw", [1]);
    answer(table, IDS.foe, 1);
    advance(table, [2]);
    expect(table.state.combat.turnActorId).toBe(IDS.foe);
    const putOut = resolveDefinitionAction(
      table.state,
      builtinAction("extinguish-fire")!,
      { actorId: IDS.foe, targetIds: [], commandId: nextId(), builtin: true },
      { random: () => 1, newRollId: nextId, gmSessionId: IDS.gmSession, now: NOW, catalog }
    );
    expect(putOut.effectsEnded).toEqual([{ actorId: IDS.foe, actorName: "Foe", name: "Burning" }]);
    expect(foe(table).effects).toEqual([]);
    expect(foe(table).conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(table.state.combat.turn.actionUsed).toBe(true);
    // Its next turn starts with no fire.
    const hp = foe(table).hp.current;
    advance(table, [4]);
    advance(table, [4]);
    expect(foe(table).hp.current).toBe(hp);
  });

  it("can't be put out by a creature that isn't burning", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    fight(table, IDS.fighter);
    expect(() =>
      resolveDefinitionAction(
        table.state,
        builtinAction("extinguish-fire")!,
        { actorId: IDS.fighter, targetIds: [], commandId: nextId(), builtin: true },
        { random: () => 1, newRollId: nextId, gmSessionId: IDS.gmSession, now: NOW, catalog }
      )
    ).toThrow(/requires an active Burning effect/);
  });
});

describe("a flask of Oil", () => {
  it("covers a creature that fails its save, and the next Fire damage burns the oil for 5 more", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("oil", { quantity: 2, equipped: false }));
    expect(actionOf(table, IDS.fighter, "item-oil-throw")).toMatchObject({ replacesAttack: true });
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-oil-throw", []);
    answer(table, IDS.foe, 1);
    expect(foe(table).effects).toMatchObject([
      { name: "Covered in oil", tags: ["oiled"], duration: { type: "rounds", remaining: 10 } }
    ]);
    // Cold reaches it first: nothing burns.
    applyDamageDetailed(table.state, IDS.foe, { amount: 2, parts: [{ amount: 2, type: "cold" }] }, GM, {
      resolveDefinition: table.resolve,
      catalog
    });
    expect(foe(table).hp.current).toBe(58);
    const { application, events } = applyDamageDetailed(
      table.state,
      IDS.foe,
      { amount: 3, parts: [{ amount: 3, type: "fire" }] },
      GM,
      { resolveDefinition: table.resolve, catalog }
    );
    expect(application.totalApplied).toBe(8);
    expect(events.map((event) => event.text)).toContain("The oil on Foe catches fire (5 Fire damage).");
    expect(foe(table).effects).toEqual([]);
    // Burnt off, the oil adds nothing to the next fire.
    expect(
      applyDamageDetailed(table.state, IDS.foe, { amount: 3, parts: [{ amount: 3, type: "fire" }] }, GM, {
        resolveDefinition: table.resolve,
        catalog
      }).application.totalApplied
    ).toBe(3);
  });

  it("burns when a burning creature's fire reaches it at the start of its turn", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("oil", { equipped: false }));
    write(table, IDS.fighter, catalogRow("alchemists-fire", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-oil-throw", []);
    answer(table, IDS.foe, 1);
    fresh(table);
    resolveAt(table, IDS.fighter, "item-alchemists-fire-throw", [1]);
    answer(table, IDS.foe, 1);
    // 1 Fire from the flask lit the oil: 1 + 5.
    expect(foe(table).hp.current).toBe(54);
    advance(table, [2]);
    expect(foe(table).hp.current).toBe(52);
  });
});

describe("Antitoxin", () => {
  it("gives Advantage on saves to avoid or end the Poisoned condition, and on no other save", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("antitoxin", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-antitoxin-drink", [], { targetIds: [] });
    expect(fighter(table).effects).toMatchObject([{ name: "Antitoxin", tags: ["antitoxin"] }]);
    expect(table.state.combat.turn.bonusActionUsed).toBe(true);
    expect(fighter(table).inventory.some((row) => row.id === "antitoxin")).toBe(false);
    const rolled = (conditionIds: string[]) => {
      createPendingSaves(table.state, {
        sourceActorId: IDS.foe,
        sourceName: "Foe",
        actionName: `Bite ${conditionIds.join(",")}`,
        ability: "con",
        dc: 12,
        targetIds: [IDS.fighter],
        proposedDamage: 0,
        halfOnSuccess: false,
        conditionIds,
        newSaveId: nextId,
        createdAt: 0
      });
      const pending = table.state.combat.pendingSaves.at(-1)!;
      return answerSave(table.state, nextId(), pending.id, "roll", undefined, true, GM, {
        random: () => 10,
        newRollId: nextId,
        sessionId: IDS.gmSession,
        role: "gm",
        now: NOW,
        resolveDefinition: table.resolve,
        catalog
      }).outcome.rollMode;
    };
    expect(rolled(["poisoned"])).toMatchObject({ mode: "advantage", advantage: ["Antitoxin"] });
    expect(rolled(["frightened"])).toBeUndefined();
  });
});

describe("Basic Poison", () => {
  it("coats a weapon: its next Piercing or Slashing hit deals 1d4 more Poison, then the coat is spent", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("basic-poison", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-basic-poison-coat-weapon", [], { targetIds: [] });
    expect(fighter(table).effects).toMatchObject([{ name: "Basic Poison (weapon)", damageUses: 1 }]);
    const hit = resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3, 2]);
    expect(hit.damage.map((part) => [part.type, part.total])).toEqual([
      ["slashing", 10],
      ["poison", 2]
    ]);
    expect(fighter(table).effects).toEqual([]);
    expect(hit.effectsEnded).toEqual([{ actorId: IDS.fighter, actorName: "Borin", name: "Basic Poison (weapon)" }]);
  });

  it("coats three pieces of ammunition: three hits from a launcher, and none from a sword", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("basic-poison", { equipped: false }));
    fight(table, IDS.fighter);
    resolveAt(table, IDS.fighter, "item-basic-poison-coat-ammunition", [], { targetIds: [] });
    // A greatsword hit leaves the arrows' coat alone.
    resolveAt(table, IDS.fighter, "item-greatsword", [15, 3, 3]);
    expect(fighter(table).effects).toMatchObject([{ name: "Basic Poison (ammunition)", damageUses: 3 }]);
    fresh(table);
    const shot = resolveAt(table, IDS.fighter, "item-shortbow", [15, 4, 1]);
    expect(shot.damage.map((part) => part.type)).toEqual(["piercing", "poison"]);
    expect(fighter(table).effects).toMatchObject([{ damageUses: 2 }]);
    // A miss spends none.
    resolveAt(table, IDS.fighter, "item-shortbow", [1]);
    expect(fighter(table).effects).toMatchObject([{ damageUses: 2 }]);
  });
});

describe("outside a fight", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("Antitoxin drunk on the road lasts into the next fight, and a burning creature can roll the fire out", async () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("antitoxin", { equipped: false }));
    addEffect(
      table.state,
      IDS.fighter,
      makeEffect({
        id: "fire",
        name: "Burning",
        tags: ["burning"],
        duration: { type: "manual" },
        ongoingDamage: { damage: [{ formula: "1d4", type: "fire" }], at: "bearer-turn-start" }
      })
    );
    const { server, gmToken, post, close } = await serve(table);
    cleanups.push(close);
    const use = (actionId: string) =>
      post(GAME_PATHS.actionUse, gmToken, { commandId: randomUUID(), actorId: IDS.fighter, actionId });
    expect((await use("item-antitoxin-drink")).status).toBe(200);
    expect((await use("extinguish-fire")).status).toBe(200);
    const after = server.store.snapshot.actors.find((actor) => actor.id === IDS.fighter)!;
    expect(after.effects.map((effect) => effect.name)).toEqual(["Antitoxin"]);
    expect(after.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    // Not burning any more, there is nothing to put out.
    expect((await use("extinguish-fire")).status).toBe(409);
  });

  it("Perfume applied before a talk lasts its hour and uses up the vial", async () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, catalogRow("perfume", { equipped: false }));
    const { server, gmToken, post, close } = await serve(table);
    cleanups.push(close);
    const used = await post(GAME_PATHS.actionUse, gmToken, {
      commandId: randomUUID(),
      actorId: IDS.fighter,
      actionId: "item-perfume-apply"
    });
    expect(used.status).toBe(200);
    const after = server.store.snapshot.actors.find((actor) => actor.id === IDS.fighter)!;
    expect(after.effects).toMatchObject([{ name: "Perfume", tags: ["perfume"], duration: { remaining: 60 } }]);
    expect(after.inventory.some((row) => row.id === "perfume")).toBe(false);
  });
});

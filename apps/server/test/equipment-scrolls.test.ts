import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { storedDefinition } from "../src/actor-roster.js";
import { actionAvailability } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { RulesBlockedError } from "../src/game-store.js";
import { scrollCastAction, scrollReading } from "../src/scrolls.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  library,
  resolveAt,
  serve,
  tableOf,
  wizardInput,
  write
} from "./equipment-table.js";

// SRD 5.2.1 Spell Scroll: one spell per scroll, read by a caster whose list has it; a spell above the reader's levels
// takes a check first; the DC and attack bonus come from the scroll's table; the scroll is used up.

const READ = "item-spell-scroll-read";
const scrollOf = (spellId: string, over = {}) => catalogRow("spell-scroll", { equipped: false, spellId, ...over });
/** Another scroll row of the same record, as the sheet adds one bearing another spell. */
const nthScroll = (spellId: string, n: number) => ({
  ...scrollOf(spellId),
  id: `spell-scroll-${n}`,
  recordId: "spell-scroll"
});
const secondScroll = (spellId: string) => nthScroll(spellId, 2);
const rowOf = (table: ReturnType<typeof tableOf>, actorId: string, id = "spell-scroll") =>
  table.actor(actorId).inventory.find((entry) => entry.id === id);
const blockedRule = (attempt: () => unknown): string | null => {
  try {
    attempt();
    return null;
  } catch (error) {
    return error instanceof RulesBlockedError ? error.rule : String(error);
  }
};

describe("picking a scroll's spell", () => {
  it("keeps one spell per scroll, within the levels the scroll holds", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, scrollOf("fireball"));
    expect(rowOf(table, IDS.wizard)?.spellId).toBe("fireball");
    expect(() => write(table, IDS.wizard, catalogRow("spell-scroll-cantrip", { spellId: "fireball" }))).toThrow(
      "Spell Scroll (Cantrip) holds a cantrip, and Fireball is level 3."
    );
    write(table, IDS.wizard, catalogRow("spell-scroll-level-1", { spellId: "magic-missile" }));
    expect(rowOf(table, IDS.wizard, "spell-scroll-level-1")?.spellId).toBe("magic-missile");
    expect(() => write(table, IDS.wizard, secondScroll("wish-x"))).toThrow(
      'There is no spell "wish-x" to put on Spell Scroll.'
    );
    // Anything else carries no spell.
    write(table, IDS.wizard, catalogRow("rope", { spellId: "fireball" }));
    expect(rowOf(table, IDS.wizard, "rope")?.spellId).toBeUndefined();
  });

  it("lets only the GM change the spell once it is picked, and keeps it on a write that leaves it out", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, scrollOf("fireball"));
    const { spellId: _picked, ...unpicked } = rowOf(table, IDS.wizard)!;
    write(table, IDS.wizard, { ...unpicked, quantity: 2 });
    expect(rowOf(table, IDS.wizard)).toMatchObject({ quantity: 2, spellId: "fireball" });
    expect(() => write(table, IDS.wizard, edit(table, IDS.wizard, "spell-scroll", { spellId: "shatter" }))).toThrow(
      "Spell Scroll already bears a spell. Only the GM can change it."
    );
    write(table, IDS.wizard, edit(table, IDS.wizard, "spell-scroll", { spellId: "shatter" }), "gm");
    expect(rowOf(table, IDS.wizard)?.spellId).toBe("shatter");
  });
});

describe("reading a scroll in a fight", () => {
  it("casts its spell with the scroll's DC, spends no slot, and crumbles", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, scrollOf("shatter"));
    fight(table, IDS.wizard);
    const slots = structuredClone(table.actor(IDS.wizard).spellSlots);
    const action = actionOf(table, IDS.wizard, READ);
    expect(action).toMatchObject({ name: "Cast Shatter (Spell Scroll)", activation: "action", spellId: "shatter" });
    expect(action.spellSlot).toBeUndefined();
    // Level 2: DC 13 on the scroll's table, whatever the reader's own.
    expect(action.save?.dc).toBe(13);
    const resolution = resolveAt(table, IDS.wizard, READ, [3, 3, 3]);
    expect(resolution.check).toBeUndefined();
    expect(table.state.combat.pendingSaves.map((save) => [save.dc, save.ability])).toEqual([[13, "con"]]);
    expect(table.actor(IDS.wizard).spellSlots).toEqual(slots);
    expect(rowOf(table, IDS.wizard)).toBeUndefined();
  });

  it("checks a spell above the reader's levels first: Intelligence against 10 + its level", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, scrollOf("fireball", { quantity: 2 }));
    fight(table, IDS.wizard);
    // Wizard 3 casts up to level 2, so Fireball (3) needs DC 13: d20 15 + Int 3.
    const cast = resolveAt(table, IDS.wizard, READ, [15, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(cast.check).toMatchObject({ total: 18, dc: 13, success: true });
    expect(table.state.combat.pendingSaves.map((save) => save.dc)).toEqual([15]);
    expect(rowOf(table, IDS.wizard)?.quantity).toBe(1);

    // d20 2 + 3 fails: the spell is gone, nothing else happens, and the turn's action is spent.
    table.state.combat.pendingSaves = [];
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false, actionInstance: null };
    const lost = resolveAt(table, IDS.wizard, READ, [2]);
    expect(lost.check).toMatchObject({ total: 5, dc: 13, success: false });
    expect(lost.save).toBeNull();
    expect(lost.tableNarration?.map((line) => line.text)).toEqual([
      "Ilyana fails to cast Fireball from the scroll, and the scroll is lost."
    ]);
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(table.state.combat.turn.actionUsed).toBe(true);
    expect(rowOf(table, IDS.wizard)).toBeUndefined();
  });

  it("reads with the reader's own check: a Poisoned reader rolls it with Disadvantage", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, scrollOf("fireball"));
    fight(table, IDS.wizard);
    table.actor(IDS.wizard).conditions = [{ id: "poisoned" }];
    // d20s 15 and 2 under Disadvantage: 2 + Int 3 = 5 misses DC 13, and the scroll is lost.
    const lost = resolveAt(table, IDS.wizard, READ, [15, 2]);
    expect(lost.check).toMatchObject({ total: 5, dc: 13, success: false });
    expect(rowOf(table, IDS.wizard)).toBeUndefined();
  });

  it("refuses a scroll whose spell is not on the reader's list", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, scrollOf("fireball"));
    fight(table, IDS.fighter);
    expect(blockedRule(() => resolveAt(table, IDS.fighter, READ, [15]))).toBe("spell.scroll-unreadable");
    expect(rowOf(table, IDS.fighter)?.quantity).toBe(1);
    const row = actionAvailability(
      table.state,
      table.actor(IDS.fighter),
      [actionOf(table, IDS.fighter, READ)],
      table.definition(IDS.fighter),
      false,
      undefined,
      catalog
    )[0];
    expect(row.violations).toEqual([
      {
        rule: "spell.scroll-unreadable",
        message: "Fireball is not on Borin's spell list, so the scroll is unintelligible."
      }
    ]);
  });

  it("reads a spell with nothing to roll, no target needed, and starts its Concentration", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, scrollOf("detect-magic"));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, READ, [], { targetIds: [] });
    // The sense itself is the second effect (vision/detect.ts).
    expect(table.actor(IDS.wizard).effects.map((effect) => effect.name)).toEqual([
      "Concentrating on Detect Magic",
      "Detect Magic"
    ]);
    expect(rowOf(table, IDS.wizard)).toBeUndefined();
  });

  it("attacks with the scroll's +5, and casts a cantrip at the lowest caster level", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, scrollOf("fire-bolt"));
    // Wizard 3: Fire Bolt's base 1d10, at the scroll's own attack bonus.
    expect(actionOf(table, IDS.wizard, READ)).toMatchObject({
      attack: { bonus: 5 },
      damage: [{ formula: "1d10", type: "fire" }]
    });
    // A spell from an item is cast at the lowest possible spell and caster level (SRD Spells Cast from Items), so a
    // level 5 reader's scroll Fire Bolt is still 1d10.
    const definition = table.definition(IDS.wizard);
    const fifth = {
      ...definition,
      character: {
        ...definition.character!,
        classes: definition.character!.classes.map((entry) => ({ ...entry, level: 5 }))
      }
    };
    expect(scrollCastAction(rowOf(table, IDS.wizard)!, fifth, catalog)?.damage).toEqual([
      { formula: "1d10", type: "fire" }
    ]);
  });

  it("casts a scroll at the spell's own casting time, and heals with the reader's modifier", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, scrollOf("healing-word"));
    // Not a wizard spell, so the scroll can't be read, but the action still says what reading it would do.
    expect(actionOf(table, IDS.wizard, READ)).toMatchObject({
      activation: "bonus-action",
      healing: { formula: "2d4" }
    });
  });
});

describe("a scroll's spell, cast as the spell's own cast is", () => {
  it("heals the creatures its reader picks rather than a template, and tells the turn its darts, types and targets", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, scrollOf("mass-cure-wounds"));
    // A 30-foot sphere that heals six creatures the caster chooses: picked, never templated.
    expect(actionOf(table, IDS.wizard, READ).area).toBeUndefined();
    expect(actionOf(table, IDS.wizard, READ).healing).toBeDefined();
    write(table, IDS.wizard, nthScroll("magic-missile", 2));
    write(table, IDS.wizard, nthScroll("chromatic-orb", 3));
    write(table, IDS.wizard, nthScroll("bless", 4));
    const reads = [2, 3, 4].map((n) => actionOf(table, IDS.wizard, `item-spell-scroll-${n}-read`));
    const rows = actionAvailability(
      table.state,
      table.actor(IDS.wizard),
      reads,
      table.definition(IDS.wizard),
      false,
      undefined,
      catalog
    );
    expect(rows.map((row) => [row.darts, row.damageTypes?.length ?? null, row.targeting])).toEqual([
      [3, null, "multi"],
      [null, 6, "single"],
      // Bless on each creature it targets.
      [null, null, "multi"]
    ]);
  });

  it("casts a long spell from a scroll over its turns, and keeps the scroll until the last one", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, scrollOf("identify"));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, READ, [], { targetIds: [] });
    // SRD Longer Casting Times: the casting holds Concentration over its turns, and an interrupted one loses no scroll.
    expect(table.actor(IDS.wizard).effects.find((effect) => effect.longCast)?.name).toBe("Casting Identify");
    expect(rowOf(table, IDS.wizard)?.quantity).toBe(1);
  });
});

describe("Use Magic Device", () => {
  // Thief 13: no spell list of its own, so every scroll is read with Intelligence.
  const thief = ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-character",
    schemaVersion: 1,
    source: { name: "test", version: "1" },
    name: "Nim",
    size: "medium",
    abilityScores: { str: 10, dex: 18, con: 12, int: 14, wis: 10, cha: 10 },
    proficiencyBonus: 5,
    armorClass: 15,
    hitPoints: { maximum: 80 },
    speedFeet: 30,
    token: { disposition: "friendly" },
    character: {
      classes: [{ id: "rogue", name: "Rogue", level: 13, subclass: { id: "thief", name: "Thief" } }],
      features: [{ id: "use-magic-device", kind: "subclass", sourceId: "thief" }]
    }
  });
  it("reads a cantrip or a level 1 spell reliably, and a higher one after an Intelligence (Arcana) check", () => {
    expect(scrollReading(thief, library.spellRecord("magic-missile")!, catalog)).toEqual({
      readable: true,
      ability: "int",
      check: null
    });
    expect(scrollReading(thief, library.spellRecord("fireball")!, catalog)).toEqual({
      readable: true,
      ability: "int",
      check: { ability: "int", dc: 13, skill: "arcana" }
    });
  });

  it("is what a character without it lacks", () => {
    const plain = { ...thief, character: { ...thief.character!, features: [] } };
    expect(scrollReading(plain, library.spellRecord("magic-missile")!, catalog)).toEqual({
      readable: false,
      message: "Magic Missile is not on Nim's spell list, so the scroll is unintelligible."
    });
  });
});

describe("reading a scroll outside a fight", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("refuses an unintelligible scroll, rolls a readable one, and loses a scroll whose check fails", async () => {
    const table = tableOf({ [IDS.wizard]: wizardInput(), [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.fighter, scrollOf("magic-missile"));
    write(table, IDS.wizard, scrollOf("magic-missile"));
    write(table, IDS.wizard, secondScroll("meteor-swarm"));
    // Intelligence 1: no d20 reaches Meteor Swarm's DC 19 (level 9, above the Wizard 3's levels).
    storedDefinition(table.state, `import-${IDS.wizard}`)!.abilityScores.int = 1;
    const { server, gmToken, post, log, close } = await serve(table);
    cleanups.push(close);
    const use = (actorId: string, actionId: string) =>
      post(GAME_PATHS.actionUse, gmToken, { commandId: randomUUID(), actorId, actionId, includeDamage: true });
    const inventory = (actorId: string) =>
      server.store.snapshot.actors.find((actor) => actor.id === actorId)!.inventory;

    const refused = await use(IDS.fighter, READ);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toBe(
      "Magic Missile is not on Borin's spell list, so the scroll is unintelligible."
    );
    expect(inventory(IDS.fighter).some((row) => row.id === "spell-scroll")).toBe(true);

    expect((await use(IDS.wizard, READ)).status).toBe(200);
    expect(inventory(IDS.wizard).some((row) => row.id === "spell-scroll")).toBe(false);

    const lost = await use(IDS.wizard, "item-spell-scroll-2-read");
    expect(lost.status).toBe(200);
    const rolls = server.store.snapshot.rolls.filter((roll) => roll.label?.includes("Meteor Swarm"));
    expect(rolls.map((roll) => roll.purpose)).toEqual(["check"]);
    expect(inventory(IDS.wizard).some((row) => row.id === "spell-scroll-2")).toBe(false);
    expect(await log()).toContain("Ilyana fails to cast Meteor Swarm from the scroll, and the scroll is lost.");
  });

  it("ends the reader's Short Rest when the spell is not a cantrip, as casting it does", async () => {
    // SRD Short Rest: "A Short Rest is stopped by ... Casting a spell other than a cantrip".
    const table = tableOf({ [IDS.wizard]: wizardInput(), [IDS.fighter]: fighterInput() }, false);
    write(table, IDS.wizard, scrollOf("fire-bolt"));
    write(table, IDS.wizard, secondScroll("magic-missile"));
    const { server, gmToken, post, log, close } = await serve(table);
    cleanups.push(close);
    const members = () => server.store.snapshot.rest.shortRest?.actorIds;
    const rest = await post(GAME_PATHS.restParty, gmToken, {
      commandId: randomUUID(),
      kind: "short",
      actorIds: [IDS.wizard, IDS.fighter]
    });
    expect(rest.status).toBe(200);
    const read = (actionId: string) =>
      post(GAME_PATHS.actionUse, gmToken, { commandId: randomUUID(), actorId: IDS.wizard, actionId });

    expect((await read(READ)).status).toBe(200);
    expect(members()).toEqual([IDS.wizard, IDS.fighter]);
    expect((await read("item-spell-scroll-2-read")).status).toBe(200);
    expect(members()).toEqual([IDS.fighter]);
    expect(await log()).toContain("Ilyana cast Magic Missile, which ends their Short Rest without its benefits.");
  });
});

it("derives the read action only for a scroll that bears a spell", () => {
  const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
  write(table, IDS.wizard, catalogRow("spell-scroll", { equipped: false }));
  const ids = () =>
    effectiveActions(table.definition(IDS.wizard), table.actor(IDS.wizard), catalog).map((action) => action.id);
  expect(ids()).not.toContain(READ);
  write(table, IDS.wizard, edit(table, IDS.wizard, "spell-scroll", { spellId: "burning-hands" }));
  expect(ids()).toContain(READ);
});

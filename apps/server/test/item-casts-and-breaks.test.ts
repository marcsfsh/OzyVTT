import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { addEffect, makeEffect } from "../src/effects.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { setItemLight } from "../src/item-light.js";
import { answerSave } from "../src/saving-throws.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fight,
  IDS,
  resolveAt,
  serve,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 item casts and uses the vocabulary carries: a cast through the Scrying a Crystal Ball holds, one an Amulet
// of the Planes asks a check for, a Ring of the Ram's printed +7, a Ring of Spell Turning's success that leaves a spell
// no effect, items that break as they are used (a Horn of Blasting, a Wind Fan), a Bag of Beans' beans, a Candle of
// Invocation's light and the Dragon Orb's spells.

const GM = { role: "gm" } as const;
let sequence = 0;
const nextId = () => `61000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";
const row = (table: Table, actorId: string, id: string) =>
  table.actor(actorId).inventory.find((item) => item.id === id);
const said = (result: unknown) => JSON.stringify(result);

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
  table.state.combat.turn = {
    ...table.state.combat.turn,
    actionUsed: false,
    bonusActionUsed: false,
    actionInstance: null,
    bonusActionInstance: null
  };
}

/** The wizard concentrating on a Scrying, as its cast leaves it. */
function scrying(table: Table) {
  addEffect(
    table.state,
    IDS.wizard,
    makeEffect({
      id: "scrying-cast:concentration",
      name: "Concentrating on Scrying",
      tags: ["concentrating"],
      concentration: true,
      castId: "scrying-cast",
      spell: { id: "scrying", level: 5 },
      sourceActorId: IDS.wizard,
      duration: { type: "minutes", remaining: 10 }
    })
  );
}

describe("a cast through the Scrying a Crystal Ball holds", () => {
  it("is refused without the Scrying, and takes no Concentration of its own with it", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("crystal-ball-of-mind-reading", { attuned: true }));
    fight(table, IDS.wizard);
    expect(() => resolveAt(table, IDS.wizard, "item-crystal-ball-of-mind-reading-cast-detect-thoughts", [])).toThrow(
      /cast through Scrying, which Ilyana isn't concentrating on/
    );
    scrying(table);
    resolveAt(table, IDS.wizard, "item-crystal-ball-of-mind-reading-cast-detect-thoughts", []);
    const held = table.actor(IDS.wizard).effects.filter((effect) => effect.concentration);
    expect(held.map((effect) => effect.spell?.id)).toEqual(["scrying"]);
  });

  it("the Telepathy ball's Suggestion comes once a dawn", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("crystal-ball-of-telepathy", { attuned: true }));
    expect(actionOf(table, IDS.wizard, "item-crystal-ball-of-telepathy-cast-suggestion")).toMatchObject({
      castThrough: "scrying",
      uses: { limit: 1, per: "long-rest" }
    });
  });
});

describe("Amulet of the Planes", () => {
  it("casts Plane Shift only after a DC 15 Intelligence (Arcana) check", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("amulet-of-the-planes", { attuned: true }));
    fight(table, IDS.wizard);
    const failed = resolveAt(table, IDS.wizard, "item-amulet-of-the-planes-cast-plane-shift", [2]);
    expect(said(failed)).toContain("Ilyana fails the check for Cast Plane Shift (Amulet of the Planes)");
    freshTurn(table);
    const passed = resolveAt(table, IDS.wizard, "item-amulet-of-the-planes-cast-plane-shift", [18]);
    expect(said(passed)).not.toContain("fails the check");
  });

  it("rolls the check outside a fight too", async () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("amulet-of-the-planes", { attuned: true }));
    const served = await serve(table);
    try {
      const used = await served.post(GAME_PATHS.actionUse, served.gmToken, {
        commandId: randomUUID(),
        actorId: IDS.wizard,
        actionId: "item-amulet-of-the-planes-cast-plane-shift"
      });
      expect(used.status, await used.clone().text()).toBe(200);
      const body = (await used.json()) as { data: { resolution: { check: { skill: string; dc: number } } } };
      expect(body.data.resolution.check).toMatchObject({
        skill: "Intelligence (Arcana) check for Cast Plane Shift (Amulet of the Planes)",
        dc: 15
      });
    } finally {
      await served.close();
    }
  });
});

describe("Ring of the Ram", () => {
  it("attacks at its printed +7 for 2d10 Force and 5 feet of push a charge", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("ring-of-the-ram", { attuned: true }));
    const two = actionOf(table, IDS.wizard, "item-ring-of-the-ram-ram-2");
    expect(two).toMatchObject({ attack: { bonus: 7 }, useCost: 2, onHitPush: { feet: 10 } });
    expect(two.damage).toEqual([{ formula: "4d10", type: "force" }]);
    fight(table, IDS.wizard);
    const rammed = resolveAt(table, IDS.wizard, "item-ring-of-the-ram-ram-2", [12, 5, 5, 5, 5]);
    expect(rammed.attack).toMatchObject({ total: 19, outcome: "hit" });
    expect(rammed.damageTotal).toBe(20);
    expect(rammed.warnings?.join(" ")).toContain("Foe is pushed 10 feet");
    expect(table.actor(IDS.wizard).actionUses["ring-of-the-ram-charges"]).toBe(2);
  });
});

describe("Ring of Spell Turning", () => {
  it("a successful save leaves a spell of level 7 or lower no effect on its wearer", () => {
    const fireball = (withRing: boolean) => {
      const table = tableOf({ [IDS.wizard]: wizardInput() });
      write(table, IDS.wizard, catalogRow("necklace-of-fireballs"));
      if (withRing) table.actor(IDS.foe).inventory = [catalogRow("ring-of-spell-turning", { attuned: true })];
      fight(table, IDS.wizard);
      resolveAt(table, IDS.wizard, "item-necklace-of-fireballs-cast-fireball", Array(8).fill(3), {
        areaPlaced: true
      } as never);
      return { table, answered: answerAs(table, IDS.foe, 25) };
    };
    const halved = fireball(false);
    expect(halved.table.actor(IDS.foe).hp.current).toBe(48);
    const turned = fireball(true);
    expect(turned.table.actor(IDS.foe).hp.current).toBe(60);
    expect(said(turned.answered)).toContain("Ring of Spell Turning leaves Fireball no effect on Foe.");
  });
});

describe("items that break as they are used", () => {
  it("a Horn of Blasting that explodes deals its user 10d6 Force and is gone", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("horn-of-blasting"));
    fight(table, IDS.wizard);
    const before = table.actor(IDS.wizard).hp.current;
    // The blast's 5d8, then the d100 at 20 or under, then the explosion's 10d6.
    resolveAt(table, IDS.wizard, "item-horn-of-blasting-blast", [1, 1, 1, 1, 1, 20, ...Array(10).fill(1)], {
      areaPlaced: true
    } as never);
    expect(row(table, IDS.wizard, "horn-of-blasting")).toBeUndefined();
    expect(table.actor(IDS.wizard).hp.current).toBe(Math.max(0, before - 10));
    expect(table.state.combat.pendingSaves.some((save) => save.targetActorId === IDS.foe)).toBe(true);
  });

  it("a horn that holds is blown again", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("horn-of-blasting"));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-horn-of-blasting-blast", [1, 1, 1, 1, 1, 21], { areaPlaced: true } as never);
    expect(row(table, IDS.wizard, "horn-of-blasting")).toBeDefined();
  });

  it("a Wind Fan's first use since a Long Rest is safe, and its sixth tears it with nothing cast", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("wind-fan"));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-wind-fan-cast-gust-of-wind", [], { areaPlaced: true } as never);
    expect(table.actor(IDS.wizard).actionUses["wind-fan-uses"]).toBe(1);
    freshTurn(table);
    table.state.combat.pendingSaves = [];
    table.actor(IDS.wizard).actionUses = { "wind-fan-uses": 5 };
    const torn = resolveAt(table, IDS.wizard, "item-wind-fan-cast-gust-of-wind", [100], {
      areaPlaced: true
    } as never);
    expect(said(torn)).toContain("Wind Fan breaks: the d100 shows 100");
    expect(row(table, IDS.wizard, "wind-fan")).toBeUndefined();
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(table.actor(IDS.wizard).actionUses["wind-fan-uses"]).toBeUndefined();
  });
});

describe("Bag of Beans", () => {
  it("holds 3d4 beans when added, and is a plain bag once the last is planted", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("bag-of-beans"));
    const spent = table.actor(IDS.wizard).actionUses["bag-of-beans-beans"] ?? 0;
    expect(spent).toBeGreaterThanOrEqual(0);
    expect(spent).toBeLessThanOrEqual(9);
    expect(actionOf(table, IDS.wizard, "item-bag-of-beans-dump")).toMatchObject({
      useCost: "chosen",
      area: { shape: "sphere", sizeFeet: 10 },
      save: { ability: "dex", dc: 15 }
    });
    table.actor(IDS.wizard).actionUses = { "bag-of-beans-beans": 11 };
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-bag-of-beans-plant", []);
    expect(row(table, IDS.wizard, "bag-of-beans")).toMatchObject({ dormant: true });
  });
});

describe("Candle of Invocation", () => {
  it("gives its attuned bearer Advantage on D20 Tests only while it burns", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("candle-of-invocation", { attuned: true }), "gm");
    const modes = () =>
      deriveEquipment(table.actor(IDS.wizard), table.definition(IDS.wizard), catalog)
        .carriers.filter((carrier) => carrier.sourceItemId === "candle-of-invocation")
        .flatMap((carrier) => carrier.modifiers.filter((modifier) => modifier.type === "roll-mode"));
    expect(modes()).toEqual([]);
    setItemLight(table.state, { actorId: IDS.wizard, itemId: "candle-of-invocation", lit: true }, GM, catalog);
    expect(modes()).toHaveLength(4);
    expect(actionOf(table, IDS.wizard, "item-candle-of-invocation-cast-gate").uses).toMatchObject({
      limit: 1,
      per: "never"
    });
  });
});

describe("Dragon Orb", () => {
  it("casts its spells at their printed charge costs from 7 charges", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("dragon-orb", { attuned: true }));
    expect(actionOf(table, IDS.wizard, "item-dragon-orb-cast-cure-wounds")).toMatchObject({
      useCost: 4,
      uses: { limit: 7 }
    });
    expect(actionOf(table, IDS.wizard, "item-dragon-orb-cast-scrying")).toMatchObject({ useCost: 3 });
    expect(actionOf(table, IDS.wizard, "item-dragon-orb-cast-detect-magic").uses).toBeUndefined();
    expect(actionOf(table, IDS.wizard, "item-dragon-orb-call-dragons").uses).toMatchObject({
      per: "time",
      afterHours: "1"
    });
  });
});

describe("talismans, a Carpet of Flying, and what a drink or an oil leaves", () => {
  it("a Talisman of Pure Good's last charge destroys it", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    table.actor(IDS.wizard).inventory.push(catalogRow("talisman-of-pure-good", { attuned: true }));
    table.actor(IDS.wizard).actionUses = { "talisman-of-pure-good-talisman-charges": 6 };
    fight(table, IDS.wizard);
    const rebuked = resolveAt(table, IDS.wizard, "item-talisman-of-pure-good-rebuke", []);
    expect(rebuked.warnings?.join(" ")).toContain("Talisman of Pure Good is destroyed");
    expect(row(table, IDS.wizard, "talisman-of-pure-good")).toBeUndefined();
  });

  it("a Carpet of Flying flies at its size's speed", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("carpet-of-flying", { variantId: "4x6" }), "gm");
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-carpet-of-flying-fly-4x6", [], { targetIds: [] });
    const flight = table.actor(IDS.wizard).effects.find((effect) => effect.name === "Carpet of Flying");
    expect(flight?.modifiers).toEqual([{ type: "special-speed", movement: "fly", feet: 60, hover: true }]);
    expect(flight?.tags).toContain("ends-on-landing");
  });

  it("a Potion of Mind Reading leaves its 10 minutes, and Oil of Slipperiness Freedom of Movement for 8 hours", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("potion-of-mind-reading"));
    write(table, IDS.wizard, catalogRow("oil-of-slipperiness"));
    fight(table, IDS.wizard);
    resolveAt(table, IDS.wizard, "item-potion-of-mind-reading-drink", [], { targetIds: [] });
    const reading = table.actor(IDS.wizard).effects.find((effect) => effect.tags.includes("mind-reading"));
    expect(reading?.duration).toEqual({ type: "rounds", remaining: 100 });
    expect(row(table, IDS.wizard, "potion-of-mind-reading")).toBeUndefined();
    resolveAt(table, IDS.wizard, "item-oil-of-slipperiness-apply", [], { targetIds: [IDS.wizard] });
    const oiled = table.actor(IDS.wizard).effects.find((effect) => effect.tags.includes("freedom-of-movement"));
    expect(oiled).toMatchObject({
      duration: { type: "minutes", remaining: 480 },
      conditionImmunities: ["paralyzed", "restrained"]
    });
  });
});

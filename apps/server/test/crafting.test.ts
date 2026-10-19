import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import {
  cancelCraft,
  craftEntries,
  craftEntryItems,
  craftingOffers,
  logCraftDays,
  payFromPurse,
  setCraftHelper,
  startCraft,
  workDuringDowntime,
  type CraftingDeps
} from "../src/crafting.js";
import { projectPlayerView } from "../src/projections.js";
import { scrollCastAction } from "../src/scrolls.js";
import { catalog, catalogRow, library } from "./equipment-table.js";

// SRD 5.2.1 Crafting Nonmagical Items: "you need tools, raw materials, and time ... raw materials worth half its
// purchase cost (round down) ... divide its purchase cost in GP by 10 (round a fraction up to a day) ... Divide the
// time needed to create an item by the number of characters working on it." Brewing Potions of Healing, Scribing Spell
// Scrolls and Crafting Magic Items follow their own tables.

const BREN = "10000000-0000-4000-8000-0000000000f1";
const MIRA = "10000000-0000-4000-8000-0000000000f2";
const SESSION = "30000000-0000-4000-8000-0000000000f1";
const OTHER = "30000000-0000-4000-8000-0000000000f2";
const GM = { role: "gm" } as const;
const PLAYER = { role: "player", sessionId: SESSION } as const;
const MIRA_PLAYER = { role: "player", sessionId: OTHER } as const;

/** Bren: a smith and cook with an herbalist's kit. */
const bren = {
  name: "Bren",
  armorClass: 16,
  proficiencyBonus: 2,
  abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 8 },
  hitPoints: { maximum: 30 },
  speedFeet: 30,
  actions: [],
  extensions: {},
  character: { classes: [{ id: "fighter", name: "Fighter", level: 3 }], feats: [] },
  proficiencies: { saves: [], skills: [], tools: ["smiths-tools", "cooks-utensils", "herbalism-kit"] }
} as unknown as ActorDefinition;

/** Mira: a Wizard 5, Intelligence 16, with Arcana, Calligrapher's Supplies and Magic Missile prepared. */
const mira = {
  name: "Mira",
  armorClass: 12,
  proficiencyBonus: 3,
  abilityScores: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
  hitPoints: { maximum: 27 },
  speedFeet: 30,
  actions: [],
  extensions: {},
  character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], feats: [] },
  proficiencies: {
    saves: ["int", "wis"],
    skills: [{ id: "arcana", proficiency: "proficient" }],
    tools: ["calligraphers-supplies", "smiths-tools", "woodcarvers-tools"]
  },
  spellcasting: {
    ability: "int",
    slots: [{ level: 1, max: 4 }],
    classes: [{ classId: "wizard", ability: "int", prepared: 8 }],
    spells: [
      { id: "fire-bolt", name: "Fire Bolt", level: 0, prepared: true, classId: "wizard" },
      { id: "magic-missile", name: "Magic Missile", level: 1, prepared: true, classId: "wizard" },
      { id: "shield", name: "Shield", level: 1, prepared: true, classId: "wizard" }
    ]
  }
} as unknown as ActorDefinition;

const ITEMS = library
  .equipmentSummaries()
  .map((summary) => library.equipmentRecord(summary.id))
  .filter((record): record is EquipmentReference => record !== undefined);

let ids = 0;
function table(options: Readonly<{ bren?: Record<string, unknown>; mira?: Record<string, unknown> }> = {}) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: BREN,
        name: "Bren",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        definitionId: "bren",
        ownerSessionId: SESSION,
        currency: { gp: 100 },
        inventory: [catalogRow("smiths-tools"), catalogRow("cooks-utensils"), catalogRow("herbalism-kit")],
        ...options.bren
      },
      {
        id: MIRA,
        name: "Mira",
        kind: "player-character",
        visibility: "public",
        hp: { current: 27, maximum: 27 },
        definitionId: "mira",
        ownerSessionId: OTHER,
        preparedSpellIds: ["magic-missile", "shield"],
        currency: { gp: 500 },
        inventory: [catalogRow("calligraphers-supplies"), catalogRow("component-pouch"), catalogRow("smiths-tools")],
        ...options.mira
      }
    ]
  }) as GameState;
  const deps: CraftingDeps & Readonly<{ newId: () => string }> = {
    catalog,
    items: () => ITEMS,
    resolveDefinition: (id) => (id === "bren" ? bren : id === "mira" ? mira : undefined),
    random: () => 1,
    newId: () => `60000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`
  };
  const actor = (id: string) => state.actors.find((candidate) => candidate.id === id)!;
  return { state, deps, actor };
}

const hours = (count: number) => count * 60;

describe("what each tool's Craft line makes", () => {
  it("resolves every entry of every tool's Craft line to records", () => {
    const tools = ITEMS.filter((record) => record.category === "tool");
    for (const tool of tools)
      for (const entry of craftEntries(tool.description)) {
        if (entry === "Spell Scroll") continue;
        expect(craftEntryItems(entry, ITEMS).length, `${tool.name}: ${entry}`).toBeGreaterThan(0);
      }
  });

  it("reads a band of weapons or armor with its exceptions", () => {
    const melee = craftEntryItems("Any Melee weapon (except Club, Greatclub, Quarterstaff, and Whip)", ITEMS).map(
      (record) => record.id
    );
    expect(melee).toContain("longsword");
    expect(melee).not.toContain("club");
    expect(melee).not.toContain("whip");
    expect(melee).not.toContain("longbow");
    const medium = craftEntryItems("Medium armor (except Hide)", ITEMS).map((record) => record.id);
    expect(medium).toContain("chain-shirt");
    expect(medium).not.toContain("hide-armor");
    expect(craftEntryItems("Glass Bottle", ITEMS).map((record) => record.id)).toEqual(["glass-bottle"]);
    expect(craftEntryItems("Arcane Focus", ITEMS).length).toBe(5);
  });
});

describe("crafting a nonmagical item", () => {
  it("pays half the price for raw materials and takes the price in GP over 10 days, worked as downtime", () => {
    const { state, deps, actor } = table();
    // Chain Mail sells for 75 GP: 37 GP 5 SP of raw materials and 8 days (7.5 rounded up).
    expect(startCraft(state, { actorId: BREN, itemId: "chain-mail" }, PLAYER, deps)).toBe(
      "Bren starts crafting Chain Mail: 37 GP 5 SP of raw materials and 8 days of work."
    );
    expect(actor(BREN).currency).toMatchObject({ gp: 62, sp: 5 });
    expect(state.crafting.projects).toMatchObject([
      { crafterId: BREN, itemId: "chain-mail", toolId: "smiths-tools", workMinutes: hours(64), paidCp: 3750 }
    ]);
    // Seven days of downtime are 56 hours of work; the eighth finishes it.
    workDuringDowntime(state, 0, hours(24 * 7), deps);
    expect(state.crafting.projects[0]!.doneMinutes).toBe(hours(56));
    const events = workDuringDowntime(state, hours(24 * 7), hours(24 * 8), deps);
    expect(events.map((event) => event.text)).toContain("Bren finishes crafting Chain Mail.");
    expect(state.crafting.projects).toEqual([]);
    expect(actor(BREN).inventory.find((row) => row.id === "chain-mail")).toMatchObject({ quantity: 1, armor: {} });
  });

  it("works at most 8 hours a game day, however the GM passes the time", () => {
    const { state, deps } = table();
    startCraft(state, { actorId: BREN, itemId: "chain-mail" }, PLAYER, deps);
    workDuringDowntime(state, 0, hours(6), deps);
    workDuringDowntime(state, hours(6), hours(12), deps);
    workDuringDowntime(state, hours(12), hours(20), deps);
    expect(state.crafting.projects[0]!.doneMinutes).toBe(hours(8));
  });

  it("divides the time among the characters working on it", () => {
    const { state, deps } = table();
    startCraft(state, { actorId: BREN, itemId: "chain-mail" }, PLAYER, deps);
    const project = state.crafting.projects[0]!.id;
    expect(setCraftHelper(state, { projectId: project, actorId: MIRA, helping: true }, MIRA_PLAYER, deps)).toBe(
      "Mira helps Bren craft Chain Mail."
    );
    workDuringDowntime(state, 0, hours(24 * 4), deps);
    expect(state.crafting.projects).toEqual([]);
  });

  it("stacks a finished item on the stack the crafter carries", () => {
    const { state, deps, actor } = table({
      bren: {
        inventory: [catalogRow("cooks-utensils"), { id: "rations", name: "Rations (1 day)", quantity: 2 }]
      }
    });
    // Rations sell for 5 SP: 2 SP 5 CP of raw materials and 1 day.
    startCraft(state, { actorId: BREN, itemId: "rations" }, PLAYER, deps);
    expect(actor(BREN).currency).toMatchObject({ gp: 99, sp: 7, cp: 5 });
    logCraftDays(state, { projectId: state.crafting.projects[0]!.id, days: 1 }, GM, deps);
    expect(actor(BREN).inventory.find((row) => row.id === "rations")?.quantity).toBe(3);
  });

  it("needs the tool's proficiency, the tool in the pack, the raw materials and no fight", () => {
    const { state, deps } = table();
    expect(() => startCraft(state, { actorId: BREN, itemId: "map" }, PLAYER, deps)).toThrow(
      "Crafting Map takes Cartographer's Tools, with proficiency and in the pack."
    );
    expect(() => startCraft(state, { actorId: BREN, itemId: "plate-armor" }, PLAYER, deps)).toThrow(
      "Plate Armor takes 750 GP of raw materials, and Bren's purse holds 100 GP."
    );
    expect(() => startCraft(state, { actorId: MIRA, itemId: "chain-mail" }, PLAYER, deps)).toThrow();
    const unarmed = table({ bren: { inventory: [] } });
    expect(() => startCraft(unarmed.state, { actorId: BREN, itemId: "chain-mail" }, PLAYER, unarmed.deps)).toThrow(
      "Crafting Chain Mail takes Smith's Tools, with proficiency and in the pack."
    );
    state.combat = {
      ...state.combat,
      active: true,
      turnActorId: BREN,
      initiative: [{ actorId: BREN, score: 10, tieBreaker: 0 }]
    };
    expect(() => startCraft(state, { actorId: BREN, itemId: "chain-mail" }, PLAYER, deps)).toThrow(
      "Crafting is downtime. End the fight first."
    );
  });

  it("lets only the GM log days, and the crafter's player or the GM cancel", () => {
    const { state, deps } = table();
    startCraft(state, { actorId: BREN, itemId: "chain-mail" }, PLAYER, deps);
    const project = state.crafting.projects[0]!.id;
    expect(() => logCraftDays(state, { projectId: project, days: 1 }, PLAYER, deps)).toThrow();
    expect(() => cancelCraft(state, project, MIRA_PLAYER)).toThrow();
    expect(cancelCraft(state, project, PLAYER).line).toBe("Bren stops crafting Chain Mail.");
    expect(state.crafting.projects).toEqual([]);
  });

  it("lets a player's character help only with the tool's proficiency, and one at most", () => {
    const { state, deps } = table({ mira: { definitionId: "bren", ownerSessionId: OTHER } });
    startCraft(state, { actorId: BREN, itemId: "rations" }, PLAYER, deps);
    const project = state.crafting.projects[0]!.id;
    const plain = table();
    startCraft(plain.state, { actorId: BREN, itemId: "rations" }, PLAYER, plain.deps);
    expect(() =>
      setCraftHelper(
        plain.state,
        { projectId: plain.state.crafting.projects[0]!.id, actorId: MIRA, helping: true },
        MIRA_PLAYER,
        plain.deps
      )
    ).toThrow("Helping with Rations (1 day) takes proficiency with Cook's Utensils.");
    setCraftHelper(state, { projectId: project, actorId: MIRA, helping: true }, MIRA_PLAYER, deps);
    expect(() => setCraftHelper(state, { projectId: project, actorId: MIRA, helping: true }, GM, deps)).toThrow(
      "Mira works on Rations (1 day) already."
    );
  });
});

describe("brewing, scribing and magic items", () => {
  it("brews a Potion of Healing with the Herbalism Kit for 25 GP over 1 day", () => {
    const { state, deps, actor } = table();
    startCraft(state, { actorId: BREN, itemId: "potion-of-healing" }, PLAYER, deps);
    expect(state.crafting.projects[0]).toMatchObject({
      kind: "potion-of-healing",
      workMinutes: hours(8),
      paidCp: 2500
    });
    expect(actor(BREN).currency.gp).toBe(75);
    workDuringDowntime(state, 0, hours(10), deps);
    expect(actor(BREN).inventory.find((row) => row.id === "potion-of-healing")).toMatchObject({ quantity: 1 });
  });

  it("scribes a prepared spell on a scroll that keeps the scribe's spell save DC and attack bonus", () => {
    const { state, deps, actor } = table();
    startCraft(state, { actorId: MIRA, itemId: "spell-scroll", spellId: "magic-missile" }, MIRA_PLAYER, deps);
    expect(state.crafting.projects[0]).toMatchObject({
      kind: "spell-scroll",
      itemName: "Spell Scroll (Magic Missile)",
      toolId: "calligraphers-supplies",
      workMinutes: hours(8),
      paidCp: 2500,
      scroll: { saveDc: 14, attackBonus: 6, casterLevel: 5 }
    });
    logCraftDays(state, { projectId: state.crafting.projects[0]!.id, days: 1 }, GM, deps);
    const scroll = actor(MIRA).inventory.find((row) => row.spellId === "magic-missile")!;
    expect(scroll).toMatchObject({ recordId: "spell-scroll", scribed: { saveDc: 14, attackBonus: 6 } });
    expect(scrollCastAction(scroll, mira, catalog)?.description).toContain("save DC 14, attack +6");
  });

  it("refuses a spell the scribe hasn't prepared", () => {
    const { state, deps } = table({ mira: { preparedSpellIds: ["shield"] } });
    expect(() =>
      startCraft(state, { actorId: MIRA, itemId: "spell-scroll", spellId: "magic-missile" }, MIRA_PLAYER, deps)
    ).toThrow("Mira must have Magic Missile prepared on each day of the inscription.");
  });

  it("crafts a magic item by its rarity with Arcana, paying for a base it doesn't carry", () => {
    const { state, deps, actor } = table({ mira: { currency: { gp: 400 } } });
    // A +1 Longsword: 200 GP and 10 days for an Uncommon item, and the Longsword's 15 GP.
    startCraft(state, { actorId: MIRA, itemId: "weapon-1", baseId: "longsword" }, MIRA_PLAYER, deps);
    expect(state.crafting.projects[0]).toMatchObject({
      kind: "magic-item",
      toolId: "smiths-tools",
      baseId: "longsword",
      workMinutes: hours(80),
      paidCp: 21500
    });
    expect(actor(MIRA).currency.gp).toBe(185);
    logCraftDays(state, { projectId: state.crafting.projects[0]!.id, days: 10 }, GM, deps);
    expect(actor(MIRA).inventory.find((row) => row.id === "weapon-1")).toMatchObject({ baseId: "longsword" });
  });

  it("needs Arcana for a magic item, and the spells it casts prepared", () => {
    const { state, deps } = table({ bren: { currency: { gp: 500 } } });
    expect(() => startCraft(state, { actorId: BREN, itemId: "weapon-1", baseId: "longsword" }, PLAYER, deps)).toThrow(
      "Crafting a magic item takes proficiency in Arcana, which Bren lacks."
    );
    const wand = table({ mira: { preparedSpellIds: ["shield"], inventory: [catalogRow("woodcarvers-tools")] } });
    expect(() =>
      startCraft(wand.state, { actorId: MIRA, itemId: "wand-of-magic-missiles" }, MIRA_PLAYER, wand.deps)
    ).toThrow("Mira must have Magic Missile prepared on each day of crafting.");
  });

  it("offers what each tool makes, the scrolls and the magic items, with their prices", () => {
    const { deps, actor } = table();
    const offers = craftingOffers(actor(MIRA), deps);
    expect(offers.scrolls?.spells.map((spell) => [spell.id, spell.days, spell.materialsCp])).toEqual([
      ["fire-bolt", 1, 1500],
      ["magic-missile", 1, 2500],
      ["shield", 1, 2500]
    ]);
    expect(offers.magicItems.find((item) => item.id === "potion-of-greater-healing")).toBeUndefined();
    expect(offers.magicItems.find((item) => item.id === "wand-of-magic-missiles")).toMatchObject({
      materialsCp: 20000,
      days: 10,
      toolIds: ["woodcarvers-tools"]
    });
    const brenOffers = craftingOffers(actor(BREN), deps);
    expect(brenOffers.tools.find((tool) => tool.toolId === "herbalism-kit")?.items).toContainEqual({
      id: "potion-of-healing",
      name: "Potion of Healing",
      kind: "potion-of-healing",
      materialsCp: 2500,
      days: 1
    });
    expect(brenOffers.magicItems).toEqual([]);
  });
});

describe("the purse and the player's view", () => {
  it("pays from the purse and makes change in gold, silver and copper", () => {
    expect(payFromPurse({ pp: 10, gp: 0, ep: 0, sp: 0, cp: 0 }, 100)).toEqual({ pp: 9, gp: 9, ep: 0, sp: 0, cp: 0 });
    expect(payFromPurse({ pp: 0, gp: 1, ep: 0, sp: 0, cp: 0 }, 5)).toEqual({ pp: 0, gp: 0, ep: 0, sp: 9, cp: 5 });
    expect(payFromPurse({ pp: 0, gp: 1, ep: 0, sp: 0, cp: 0 }, 101)).toBeNull();
  });

  it("shows a player the party's projects, with what one cost only on their own, and never when it started", () => {
    const { state, deps, actor } = table();
    startCraft(state, { actorId: BREN, itemId: "rations" }, PLAYER, deps);
    startCraft(state, { actorId: MIRA, itemId: "spell-scroll", spellId: "shield" }, MIRA_PLAYER, deps);
    const view = projectPlayerView(state, SESSION, () => null);
    expect(view.crafting).toEqual([
      expect.objectContaining({ crafterId: BREN, itemName: "Rations (1 day)", helperIds: [], paidCp: 25 }),
      expect.not.objectContaining({ paidCp: expect.anything() })
    ]);
    expect(view.crafting[1]).toMatchObject({ crafterId: MIRA, itemName: "Spell Scroll (Shield)" });
    expect(JSON.stringify(view.crafting)).not.toContain("startedAt");
    expect(JSON.stringify(view.crafting)).not.toContain("saveDc");
    // A hidden character's project stays with the GM.
    actor(MIRA).visibility = "gm-only";
    expect(projectPlayerView(state, SESSION, () => null).crafting.map((project) => project.crafterId)).toEqual([BREN]);
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { loadEquipment, loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { answerSave } from "../src/saving-throws.js";

// What a magic weapon's hit does beside its damage, from the shipped rows: a save it opens (Giant Slayer, Dagger of
// Venom, Sword of Wounding), what only a rolled 20 does (Sword of Sharpness, Mace of Smiting, Vorpal Sword), and the
// staffs and the Sun Blade, which swing as their own weapons and carry hit properties of their own.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const EQUIPMENT = loadEquipment();
const MONSTERS = loadMonsterDefinitions();
const IDS = {
  hero: "10000000-0000-4000-8000-000000000301",
  foe: "10000000-0000-4000-8000-000000000302",
  map: "20000000-0000-5000-8000-000000000301",
  gmSession: "30000000-0000-4000-8000-00000000030a"
};

const definition = {
  name: "Hero",
  armorClass: 15,
  proficiencyBonus: 3,
  abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 40 },
  actions: [],
  extensions: {},
  character: { classes: [{ id: "fighter", name: "Fighter", level: 5 }], feats: [] },
  proficiencies: { saves: [], skills: [], weapons: ["simple", "martial"], armor: [], tools: [] }
} as unknown as ActorDefinition;

/** The catalog id a printed name mints ("Giant Slayer" is giant-slayer). */
const recordIdOf = (name: string) => name.toLowerCase().replace(/ /g, "-");

/** A magic item as the bind mints it: its identity and the base weapon's block. */
const bound = (id: string, name: string, base: string): InventoryItem => {
  const stats = EQUIPMENT.find((record) => record.id === base)?.weapon;
  if (!stats) throw new Error(`no base weapon ${base}`);
  return InventoryItemSchema.parse({
    id,
    name,
    recordId: recordIdOf(name),
    quantity: 1,
    category: "weapon",
    equipped: true,
    attuned: true,
    baseId: base,
    weapon: {
      category: stats.category,
      damageDice: stats.damageDice,
      damageType: stats.damageType,
      rangeFeet: stats.rangeFeet,
      longRangeFeet: stats.longRangeFeet,
      ...(stats.properties ? { properties: [...stats.properties] } : {})
    }
  });
};

/** An item row as it was stored before its record carried a weapon block: the name and nothing else. */
const carried = (id: string, name: string, category: string): InventoryItem =>
  InventoryItemSchema.parse({
    id,
    name,
    recordId: recordIdOf(name),
    quantity: 1,
    category,
    equipped: true,
    attuned: true
  });

/** The hero holding `item` in a fight against a foe of the stat block `foeId`, on the hero's turn. */
function table(item: InventoryItem, foeId = "ogre") {
  const foeDefinition = MONSTERS.find((monster) => monster.source.externalId === foeId)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "foe-def", definition: foeDefinition }],
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: 15,
        speedFeet: 30,
        inventory: [item]
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 200, maximum: 200 },
        armorClass: 10,
        speedFeet: 30,
        definitionId: "foe-def"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
  const foe = state.actors.find((actor) => actor.id === IDS.foe)!;
  return { state, hero, foe };
}
type Table = ReturnType<typeof table>;

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const actionsOf = (built: Table) => effectiveActions(definition, built.hero, catalog);
const actionOf = (built: Table, id: string) => {
  const found = actionsOf(built).find((entry) => entry.id === id);
  if (!found)
    throw new Error(
      `no action ${id}: ${actionsOf(built)
        .map((entry) => entry.id)
        .join(", ")}`
    );
  return found;
};
const deps = (built: Table, faces: number[]) => ({
  random: () => {
    const face = faces.shift();
    if (face === undefined) throw new Error("dice queue empty");
    return face;
  },
  newRollId: nextId,
  gmSessionId: IDS.gmSession,
  now: () => "2026-10-18T00:00:00.000Z",
  definition,
  catalog,
  resolveDefinition: (id: string) => built.state.definitions.find((entry) => entry.id === id)?.definition
});
/** A swing with the item's attack at the foe, previewed or confirmed with the extras its hit offered. */
const swing = (
  built: Table,
  actionId: string,
  faces: number[],
  options: Readonly<{ hitOptions?: Array<{ id: string; effects?: string[] }>; commit?: boolean }> = {}
) =>
  resolveDefinitionAction(
    built.state,
    actionOf(built, actionId),
    {
      actorId: IDS.hero,
      targetIds: [IDS.foe],
      commandId: nextId(),
      ...(options.hitOptions ? { hitOptions: options.hitOptions } : {}),
      ...(options.commit === false ? { commit: false } : {})
    },
    deps(built, faces)
  );
/** The foe answers its one pending save with this total. */
const answer = (built: Table, total: number) =>
  answerSave(
    built.state,
    nextId(),
    built.state.combat.pendingSaves[0]!.id,
    "manual",
    total,
    true,
    { role: "gm" },
    {
      random: () => 10,
      newRollId: nextId,
      sessionId: IDS.gmSession,
      role: "gm",
      now: () => "2026-10-18T00:00:00.000Z",
      resolveDefinition: (id: string) => built.state.definitions.find((entry) => entry.id === id)?.definition
    }
  );

describe("a magic weapon's hit opens the save its text prints", () => {
  it("knocks a Giant Prone on a failed DC 15 Strength save from Giant Slayer, and leaves anything else alone", () => {
    const giant = table(bound("slayer", "Giant Slayer", "longsword"), "hill-giant");
    swing(giant, "item-slayer", [15, 4, 3, 3]);
    expect(giant.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.foe, ability: "str", dc: 15, conditionIds: ["prone"] }
    ]);
    answer(giant, 5);
    expect(giant.foe.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    const beast = table(bound("slayer", "Giant Slayer", "longsword"), "brown-bear");
    swing(beast, "item-slayer", [15, 4]);
    expect(beast.state.combat.pendingSaves).toEqual([]);
  });

  it("stops healing until a Sword of Wounding's repeated save ends it", () => {
    const built = table(bound("wounding", "Sword of Wounding", "longsword"));
    swing(built, "item-wounding", [15, 4, 3, 3]);
    expect(built.state.combat.pendingSaves).toMatchObject([
      { ability: "con", dc: 15, onFailEffect: { tags: ["no-healing"], repeatSave: { ability: "con" } } }
    ]);
    answer(built, 3);
    expect(built.foe.effects.find((effect) => effect.tags.includes("no-healing"))).toBeDefined();
  });

  it("spends a Dagger of Venom's coat on its next hit, which opens the poison's save, and does nothing uncoated", () => {
    const built = table(bound("venom", "Dagger of Venom", "dagger"));
    swing(built, "item-venom", [15, 2]);
    expect(built.state.combat.pendingSaves).toEqual([]);
    resolveDefinitionAction(
      built.state,
      actionOf(built, "item-venom-coat-blade"),
      { actorId: IDS.hero, targetIds: [], commandId: nextId() },
      deps(built, [])
    );
    expect(built.hero.effects.map((effect) => effect.tags)).toContainEqual(["venom-coat"]);
    // The next swing, with the action free again (the coat lasts a minute).
    built.state.combat.turn.actionUsed = false;
    built.state.combat.turn.actionInstance = null;
    swing(built, "item-venom", [15, 2, 6, 5]);
    expect(built.state.combat.pendingSaves).toMatchObject([
      { ability: "con", dc: 15, conditionIds: ["poisoned"], proposedDamage: 11 }
    ]);
    expect(built.hero.effects.some((effect) => effect.tags.includes("venom-coat"))).toBe(false);
  });
});

describe("what only a rolled 20 does", () => {
  it("adds a Sword of Sharpness's 14 Slashing and a level of Exhaustion on a 20, and nothing on a 19", () => {
    const built = table(bound("sharp", "Sword of Sharpness", "longsword"));
    const hit = swing(built, "item-sharp", [20, 4, 4]);
    expect(
      (hit.bonusDamage ?? []).filter((part) => part.source === "Sword of Sharpness").map((part) => part.amount)
    ).toEqual([7, 7]);
    expect(built.foe.conditions).toContainEqual(expect.objectContaining({ id: "exhaustion", level: 1 }));
    const plain = table(bound("sharp", "Sword of Sharpness", "longsword"));
    const nineteen = swing(plain, "item-sharp", [19, 4]);
    expect((nineteen.bonusDamage ?? []).some((part) => part.source === "Sword of Sharpness")).toBe(false);
    expect(plain.foe.conditions).toEqual([]);
  });

  it("tells the GM a Vorpal Sword's 20 takes a head", () => {
    const built = table(bound("vorpal", "Vorpal Sword", "longsword"));
    expect(swing(built, "item-vorpal", [20, 4, 4]).warnings?.join(" ")).toMatch(/cuts off one of the creature's heads/);
    const plain = table(bound("vorpal", "Vorpal Sword", "longsword"));
    expect(swing(plain, "item-vorpal", [19, 4]).warnings?.join(" ") ?? "").not.toMatch(/heads/);
  });

  it("adds a Mace of Smiting's 14 against a Construct on a 20, and names what destroys it", () => {
    const built = table(bound("smiting", "Mace of Smiting", "mace"), "iron-golem");
    const hit = swing(built, "item-smiting", [20, 3, 3]);
    const smiting = (hit.bonusDamage ?? []).filter((part) => part.source === "Mace of Smiting");
    // The +2 against a Construct, then the 7 and the 7 more a Construct takes on a 20.
    expect(smiting.map((part) => part.amount)).toEqual([2, 7, 7]);
    expect(hit.warnings?.join(" ")).toMatch(/A Construct with 25 Hit Points or fewer after this damage is destroyed/);
    const ogre = table(bound("smiting", "Mace of Smiting", "mace"));
    const plain = swing(ogre, "item-smiting", [20, 3, 3]);
    expect((plain.bonusDamage ?? []).filter((part) => part.source === "Mace of Smiting")).toHaveLength(1);
    expect(plain.warnings?.join(" ") ?? "").not.toMatch(/destroyed/);
  });
});

describe("staffs and the Sun Blade swing as their own weapons", () => {
  it("swings a Staff of Striking stored before it had a weapon block as a +3 Quarterstaff", () => {
    const built = table(carried("striking", "Staff of Striking", "staff"));
    const attack = actionOf(built, "item-striking");
    expect(attack.attack?.bonus).toBe(3 + 3 + 3);
    expect(attack.damage[0]).toMatchObject({ type: "bludgeoning" });
    expect(actionOf(built, "item-striking-two-handed").damage[0]!.formula).toMatch(/^1d8/);
  });

  it("offers 1, 2 or 3 charges of Striking on a melee hit, spends what it took, and refuses two at once", () => {
    const built = table(carried("striking", "Staff of Striking", "staff"));
    const preview = swing(built, "item-striking", [15], { commit: false });
    expect(preview.hitOffers?.map((offer) => offer.id)).toEqual(
      expect.arrayContaining(["item-striking-striking-1", "item-striking-striking-2", "item-striking-striking-3"])
    );
    const hit = swing(built, "item-striking", [15, 3, 4, 5], { hitOptions: [{ id: "item-striking-striking-2" }] });
    expect(hit.damage).toContainEqual(expect.objectContaining({ formula: "2d6", type: "force", total: 9 }));
    expect(built.hero.actionUses["striking-charges"]).toBe(2);
    const again = table(carried("striking", "Staff of Striking", "staff"));
    expect(() =>
      swing(again, "item-striking", [15, 3, 4, 5, 6], {
        hitOptions: [{ id: "item-striking-striking-1" }, { id: "item-striking-striking-2" }]
      })
    ).toThrowError(/spend the same uses, so a hit takes one of them/);
  });

  it("stuns with a Staff of Thunder and Lightning's Thunder on a failed DC 17 Constitution save", () => {
    const built = table(carried("thunder", "Staff of Thunder and Lightning", "staff"));
    swing(built, "item-thunder", [15, 3], { hitOptions: [{ id: "item-thunder-thunder" }] });
    expect(built.state.combat.pendingSaves).toMatchObject([{ ability: "con", dc: 17, conditionIds: ["stunned"] }]);
  });

  it("gives a Staff of Withering's charge 2d10 Necrotic and its save", () => {
    const built = table(carried("withering", "Staff of Withering", "staff"));
    const hit = swing(built, "item-withering", [15, 3, 6, 4], {
      hitOptions: [{ id: "item-withering-withering", effects: ["withering"] }]
    });
    expect(hit.damage).toContainEqual(expect.objectContaining({ formula: "2d10", type: "necrotic" }));
    expect(built.state.combat.pendingSaves).toMatchObject([{ ability: "con", dc: 15 }]);
  });

  it("swings the Sun Blade as a +2 Finesse Longsword that deals Radiant damage", () => {
    const built = table(carried("sun", "Sun Blade", "weapon"));
    const attack = actionOf(built, "item-sun");
    expect(attack.attack?.bonus).toBe(3 + 3 + 2);
    expect(attack.damage[0]).toMatchObject({ type: "radiant" });
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema, type ContentSkillSummary, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { deriveActorSheet } from "../src/actor-derived.js";
import { deriveEquipment, type EquipmentCatalog } from "../src/equipment-derivation.js";
import { testCatalog } from "./catalog-records.js";
import { projectGmView, projectPlayerView } from "../src/projections.js";
import { saveModifierFor, saveTotalFor } from "../src/saving-throws.js";

// The derived sheet block: item-granted skill proficiency/expertise, save bonuses, and `check-bonus`.
// Every test also asserts the negative control (unworn item, unattuned item, unrelated skill), since a
// happy-path-only test passes even when nothing consumes the derived number.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  rival: "10000000-0000-4000-8000-000000000002",
  hidden: "10000000-0000-4000-8000-000000000003",
  heroSession: "30000000-0000-4000-8000-00000000000a",
  rivalSession: "30000000-0000-4000-8000-00000000000b"
} as const;

const SKILLS: readonly ContentSkillSummary[] = [
  { id: "stealth", name: "Stealth", description: "", ability: "dex" },
  { id: "perception", name: "Perception", description: "", ability: "wis" },
  { id: "athletics", name: "Athletics", description: "", ability: "str" }
];

function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero",
    armorClass: 12,
    proficiencyBonus: 3,
    abilityScores: { str: 16, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [],
    extensions: {},
    initiativeBonus: 0,
    character: { classes: [{ id: "rogue", name: "Rogue", level: 5 }], feats: [] },
    proficiencies: { saves: ["dex"], skills: [{ id: "stealth", proficiency: "proficient" }] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem =>
  InventoryItemSchema.parse({ id: "x", name: "X", ...over });
const catalogOf = (equipment: readonly object[]): EquipmentCatalog => testCatalog({ equipment });

/** A circlet that raises Stealth to expertise and grants Perception outright. */
const CIRCLET = {
  id: "circlet-of-shadows",
  name: "Circlet of Shadows",
  category: "wondrous",
  slot: "head",
  isMagic: true,
  attunement: { required: true },
  grants: { expertise: ["stealth"], skills: ["perception"] }
};
const CIRCLET_ROW = {
  id: "circlet-of-shadows",
  name: "Circlet of Shadows",
  category: "wondrous",
  equipped: true,
  attuned: true
};
/** A standing save-bonus rider on the bearer. */
const AMULET = {
  id: "amulet-of-warding",
  name: "Amulet of Warding",
  category: "wondrous",
  slot: "neck",
  isMagic: true,
  attunement: { required: true },
  modifiers: [{ type: "save-bonus", amount: 2 }]
};

function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        ownerSessionId: IDS.heroSession,
        hp: { current: 30, maximum: 30 },
        armorClass: 12,
        definitionId: "def-hero",
        inventory
      },
      {
        id: IDS.rival,
        name: "Rival",
        kind: "player-character",
        visibility: "public",
        ownerSessionId: IDS.rivalSession,
        hp: { current: 25, maximum: 25 },
        armorClass: 13
      },
      {
        id: IDS.hidden,
        name: "Ambusher",
        kind: "monster",
        visibility: "gm-only",
        hp: { current: 40, maximum: 40 },
        armorClass: 15
      }
    ]
  });
}

const sheetFor = (state: GameState, definition: ActorDefinition, catalog: EquipmentCatalog) =>
  deriveActorSheet(state.actors[0], definition, deriveEquipment(state.actors[0], definition, catalog), SKILLS);
const skillRow = (state: GameState, definition: ActorDefinition, catalog: EquipmentCatalog, id: string) =>
  sheetFor(state, definition, catalog).skills.find((row) => row.id === id)!;

describe("criterion 11: a circlet's granted proficiency and expertise reach the sheet", () => {
  const definition = definitionOf();
  const catalog = catalogOf([CIRCLET]);

  it("raises the tier AND the rollable bonus, and names the item that did it", () => {
    const worn = skillRow(stateWith([item(CIRCLET_ROW)]), definition, catalog, "stealth");
    // Dex 16 (+3) + PB 3 doubled for expertise = +9. Proficient alone would be +6.
    expect(worn.tier).toBe("expertise");
    expect(worn.bonus).toBe(9);
    expect(worn.sources).toEqual(["Circlet of Shadows"]);

    const perception = skillRow(stateWith([item(CIRCLET_ROW)]), definition, catalog, "perception");
    expect(perception.tier).toBe("proficient"); // untrained -> proficient
    expect(perception.bonus).toBe(4); // Wis 12 (+1) + PB 3
  });

  it("gives back the BASE tier when the circlet comes off, and needs attunement to work at all", () => {
    const bare = skillRow(stateWith([]), definition, catalog, "stealth");
    expect(bare.tier).toBe("proficient");
    expect(bare.bonus).toBe(6);
    expect(bare.sources).toEqual([]);

    // Equipped but not attuned: the circlet requires attunement, so it contributes nothing.
    const unattuned = skillRow(stateWith([item({ ...CIRCLET_ROW, attuned: false })]), definition, catalog, "stealth");
    expect(unattuned.tier).toBe("proficient");
    expect(unattuned.bonus).toBe(6);

    // The base tier in the definition is untouched; an item contribution is never merged in.
    expect(definition.proficiencies!.skills).toEqual([{ id: "stealth", proficiency: "proficient" }]);
  });

  it("does not raise a skill the circlet never named", () => {
    const athletics = skillRow(stateWith([item(CIRCLET_ROW)]), definition, catalog, "athletics");
    expect(athletics.tier).toBe("none");
    expect(athletics.bonus).toBe(3); // Str 16, untrained
    expect(athletics.sources).toEqual([]);
  });
});

describe("the save chip and the rolled save are one number", () => {
  const definition = definitionOf();
  const catalog = catalogOf([AMULET]);
  const worn = [
    item({ id: "amulet-of-warding", name: "Amulet of Warding", category: "wondrous", equipped: true, attuned: true })
  ];

  it("folds the item's save bonus into the chip, and drops it when the amulet comes off", () => {
    const state = stateWith(worn);
    const dex = sheetFor(state, definition, catalog).abilities.find((row) => row.ability === "dex")!;
    // Dex 16 (+3) + PB 3 (proficient) + 2 from the amulet.
    expect(dex.save).toBe(8);
    expect(dex.saveProficient).toBe(true);
    expect(dex.saveFromItems).toBe(2);

    const bare = sheetFor(stateWith([]), definition, catalog).abilities.find((row) => row.ability === "dex")!;
    expect(bare.save).toBe(6);
    expect(bare.saveFromItems).toBe(0);
  });

  it("EQUALS what the roll path computes - the assertion that makes drift impossible", () => {
    const state = stateWith(worn);
    const derivation = deriveEquipment(state.actors[0], definition, catalog);
    for (const row of sheetFor(state, definition, catalog).abilities) {
      expect(row.save, `${row.ability} chip disagrees with the roll`).toBe(
        saveTotalFor(definition, state.actors[0], row.ability, derivation)
      );
    }
  });

  /** `saveModifierFor` must read `proficiencies.saves`, so a PC's forced save matches the sheet's chip. */
  it("reads save proficiency off the sheet, not just off a monster extension", () => {
    expect(saveModifierFor(definitionOf(), "dex")).toBe(6); // +3 Dex, +3 PB, proficient
    expect(saveModifierFor(definitionOf(), "str")).toBe(3); // +3 Str, not proficient
    // An explicit GM total still wins outright.
    const overridden = definitionOf({ proficiencies: { saves: ["dex"], skills: [], saveOverrides: { dex: 11 } } });
    expect(saveModifierFor(overridden, "dex")).toBe(11);
    // A monster (no `proficiencies` at all) still reads its open5e extension.
    const monster = definitionOf({
      proficiencies: undefined,
      extensions: { "open5e.srd-2024": { savingThrows: { dex: 7 } } }
    });
    expect(saveModifierFor(monster, "dex")).toBe(7);
  });
});

describe("check-bonus rides into ability checks and skills", () => {
  const GLOVES = {
    id: "gloves-of-surety",
    name: "Gloves of Surety",
    category: "wondrous",
    slot: "hands",
    isMagic: true,
    modifiers: [{ type: "check-bonus", amount: 1 }]
  };
  const definition = definitionOf();
  const catalog = catalogOf([GLOVES]);
  const worn = [item({ id: "gloves-of-surety", name: "Gloves of Surety", category: "wondrous", equipped: true })];

  it("raises every ability check and every skill built on one", () => {
    const sheet = sheetFor(stateWith(worn), definition, catalog);
    const str = sheet.abilities.find((row) => row.ability === "str")!;
    expect(str.check).toBe(4); // +3 Str, +1 gloves
    expect(str.checkWithProficiency).toBe(7); // and PB on top
    expect(sheet.skills.find((row) => row.id === "athletics")!.bonus).toBe(4);
    // A save is not an ability check; the gloves must not touch it.
    expect(str.save).toBe(3);
  });

  it("contributes nothing once the gloves come off", () => {
    const sheet = sheetFor(stateWith([]), definition, catalog);
    expect(sheet.abilities.find((row) => row.ability === "str")!.check).toBe(3);
    expect(sheet.skills.find((row) => row.id === "athletics")!.bonus).toBe(3);
  });
});

describe("viewer safety: the derived block never rides the broadcast projections", () => {
  // The block rides `actor:available-actions`, a request that authorizes its caller for one named actor,
  // never `PlayerView` or `GmView`. A per-actor field on the broadcast projection is how another
  // character's sheet leaks.
  const DERIVED_KEYS = ["checkWithProficiency", "saveFromItems", "saveProficient", "proficiencyBonus"] as const;

  it("keeps every derived-block field out of the player projection, for own and other actors alike", () => {
    const state = stateWith([item(CIRCLET_ROW)]);
    const projected = projectPlayerView(state, IDS.heroSession, () => null);
    const serialised = JSON.stringify(projected);
    for (const key of DERIVED_KEYS)
      expect(serialised, `"${key}" reached the broadcast player projection`).not.toContain(key);
    for (const actor of projected.actors) expect(actor).not.toHaveProperty("derived");
    // The GM-only combatant is absent entirely; nothing is derived for it.
    expect(projected.actors.map((actor) => actor.id)).toEqual([IDS.hero, IDS.rival]);
  });

  it('keeps it out of the GM projection too, so `Omit<GameState, "actors">` has nothing new to strip', () => {
    const state = stateWith([item(CIRCLET_ROW)]);
    const serialised = JSON.stringify(projectGmView(state, () => null));
    for (const key of DERIVED_KEYS) expect(serialised, `"${key}" reached the GM broadcast`).not.toContain(key);
  });

  it("never merges an item's grant into the definition, which is what the projection DOES ship", () => {
    const definition = definitionOf();
    // Deriving must not mutate: the owner's projection hands them `definition` verbatim.
    sheetFor(stateWith([item(CIRCLET_ROW)]), definition, catalogOf([CIRCLET]));
    expect(definition.proficiencies!.skills).toEqual([{ id: "stealth", proficiency: "proficient" }]);
  });
});

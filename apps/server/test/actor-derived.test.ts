import { describe, expect, it } from "vitest";
import { GameStateSchema, type ContentSkillSummary, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { deriveActorSheet } from "../src/actor-derived.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentRecordLike } from "../src/equipment-derivation.js";
import { projectGmView, projectPlayerView } from "../src/projections.js";
import { saveModifierFor, saveTotalFor } from "../src/saving-throws.js";

/**
 * The derived sheet block: criterion 11 finally reaching a player, the save split-brain closed, and
 * `check-bonus` gaining its first consumer.
 *
 * Every test here asserts the NEGATIVE control too - the unworn item, the unattuned item, the
 * unrelated skill - because the defect this block fixes was not "the number was wrong". It was that
 * `effectiveSkillTier` computed a correct number that NOTHING CALLED, and a test asserting only the
 * happy path would have passed just as green while the feature reached no player at all.
 */

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
    name: "Hero", armorClass: 12, proficiencyBonus: 3,
    abilityScores: { str: 16, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
    hitPoints: { maximum: 30 }, actions: [], extensions: {}, initiativeBonus: 0,
    character: { classes: [{ id: "rogue", name: "Rogue", level: 5 }], feats: [] },
    proficiencies: { saves: ["dex"], skills: [{ id: "stealth", proficiency: "proficient" }] },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "x", name: "X", ...over });
const catalogOf = (records: readonly EquipmentRecordLike[]): EquipmentCatalog => ({ equipmentRecord: (id) => records.find((record) => record.id === id) });

/** Criterion 11's item: a circlet that raises Stealth to expertise and grants Perception outright. */
const CIRCLET: EquipmentRecordLike = {
  id: "circlet-of-shadows", name: "Circlet of Shadows", category: "wondrous", slot: "head",
  isMagic: true, attunement: { required: true },
  grants: { expertise: ["stealth"], skills: ["perception"] }
};
const CIRCLET_ROW = { id: "circlet-of-shadows", name: "Circlet of Shadows", category: "wondrous", equipped: true, attuned: true };
/** Criterion 12's other half, as a standing rider on the bearer. */
const AMULET: EquipmentRecordLike = {
  id: "amulet-of-warding", name: "Amulet of Warding", category: "wondrous", slot: "neck",
  isMagic: true, attunement: { required: true }, modifiers: [{ type: "save-bonus", amount: 2 }]
};

function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", ownerSessionId: IDS.heroSession, hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory },
    { id: IDS.rival, name: "Rival", kind: "player-character", visibility: "public", ownerSessionId: IDS.rivalSession, hp: { current: 25, maximum: 25 }, armorClass: 13 },
    { id: IDS.hidden, name: "Ambusher", kind: "monster", visibility: "gm-only", hp: { current: 40, maximum: 40 }, armorClass: 15 }
  ] });
}

const sheetFor = (state: GameState, definition: ActorDefinition, catalog: EquipmentCatalog) =>
  deriveActorSheet(state.actors[0], definition, deriveEquipment(state.actors[0], definition, catalog), SKILLS);
const skillRow = (state: GameState, definition: ActorDefinition, catalog: EquipmentCatalog, id: string) =>
  sheetFor(state, definition, catalog).skills.find((row) => row.id === id)!;

// -------------------------------------------------------------------------------------------------
// Criterion 11 - the one criterion that authored and published but reached no player
// -------------------------------------------------------------------------------------------------

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
    expect(perception.bonus).toBe(4);           // Wis 12 (+1) + PB 3
  });

  it("gives back the BASE tier when the circlet comes off, and needs attunement to work at all", () => {
    const bare = skillRow(stateWith([]), definition, catalog, "stealth");
    expect(bare.tier).toBe("proficient");
    expect(bare.bonus).toBe(6);
    expect(bare.sources).toEqual([]);

    // Equipped but NOT attuned: the circlet demands attunement, so it contributes nothing.
    const unattuned = skillRow(stateWith([item({ ...CIRCLET_ROW, attuned: false })]), definition, catalog, "stealth");
    expect(unattuned.tier).toBe("proficient");
    expect(unattuned.bonus).toBe(6);

    // And the base tier is untouched in the definition - an item contribution is never merged in.
    expect(definition.proficiencies!.skills).toEqual([{ id: "stealth", proficiency: "proficient" }]);
  });

  it("does not raise a skill the circlet never named", () => {
    const athletics = skillRow(stateWith([item(CIRCLET_ROW)]), definition, catalog, "athletics");
    expect(athletics.tier).toBe("none");
    expect(athletics.bonus).toBe(3); // Str 16, untrained
    expect(athletics.sources).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// The save split-brain
// -------------------------------------------------------------------------------------------------

describe("the save chip and the rolled save are one number", () => {
  const definition = definitionOf();
  const catalog = catalogOf([AMULET]);
  const worn = [item({ id: "amulet-of-warding", name: "Amulet of Warding", category: "wondrous", equipped: true, attuned: true })];

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
      expect(row.save, `${row.ability} chip disagrees with the roll`).toBe(saveTotalFor(definition, state.actors[0], row.ability, derivation));
    }
  });

  /**
   * The pre-existing bug this block would otherwise have inherited: `saveModifierFor` never read
   * `proficiencies.saves`, so a proficient PC's GM-forced save rolled WITHOUT its proficiency bonus
   * while the sheet's own chip showed it.
   */
  it("reads save proficiency off the sheet, not just off a monster extension", () => {
    expect(saveModifierFor(definitionOf(), "dex")).toBe(6);  // +3 Dex, +3 PB, proficient
    expect(saveModifierFor(definitionOf(), "str")).toBe(3);  // +3 Str, NOT proficient
    // An explicit GM total still wins outright.
    const overridden = definitionOf({ proficiencies: { saves: ["dex"], skills: [], saveOverrides: { dex: 11 } } });
    expect(saveModifierFor(overridden, "dex")).toBe(11);
    // A monster (no `proficiencies` at all) still reads its open5e extension.
    const monster = definitionOf({ proficiencies: undefined, extensions: { "open5e.srd-2024": { savingThrows: { dex: 7 } } } });
    expect(saveModifierFor(monster, "dex")).toBe(7);
  });
});

// -------------------------------------------------------------------------------------------------
// check-bonus, whose first consumer this is
// -------------------------------------------------------------------------------------------------

describe("check-bonus rides into ability checks and skills", () => {
  const GLOVES: EquipmentRecordLike = {
    id: "gloves-of-surety", name: "Gloves of Surety", category: "wondrous", slot: "hands",
    isMagic: true, modifiers: [{ type: "check-bonus", amount: 1 }]
  };
  const definition = definitionOf();
  const catalog = catalogOf([GLOVES]);
  const worn = [item({ id: "gloves-of-surety", name: "Gloves of Surety", category: "wondrous", equipped: true })];

  it("raises every ability check and every skill built on one", () => {
    const sheet = sheetFor(stateWith(worn), definition, catalog);
    const str = sheet.abilities.find((row) => row.ability === "str")!;
    expect(str.check).toBe(4);                 // +3 Str, +1 gloves
    expect(str.checkWithProficiency).toBe(7);  // and PB on top
    expect(sheet.skills.find((row) => row.id === "athletics")!.bonus).toBe(4);
    // A save is NOT an ability check; the gloves must not touch it.
    expect(str.save).toBe(3);
  });

  it("contributes nothing once the gloves come off", () => {
    const sheet = sheetFor(stateWith([]), definition, catalog);
    expect(sheet.abilities.find((row) => row.ability === "str")!.check).toBe(3);
    expect(sheet.skills.find((row) => row.id === "athletics")!.bonus).toBe(3);
  });
});

// -------------------------------------------------------------------------------------------------
// Viewer safety (rule 3) - the reason this block rides a request and not the projection
// -------------------------------------------------------------------------------------------------

describe("viewer safety: the derived block never rides the broadcast projections", () => {
  /**
   * The block is deliberately NOT on `PlayerView` or `GmView`. It rides `actor:available-actions`, a
   * REQUEST that authorizes its caller for one named actor before deriving anything, rather than a
   * broadcast every connected player receives.
   *
   * That choice is what this test locks down. Move the block onto the projection - even "just for the
   * owner" - and these assertions go red, because a per-actor field that reaches `projections.ts` but
   * not `PlayerActor`'s `Omit` (or the reverse) is precisely how another character's sheet leaks.
   */
  const DERIVED_KEYS = ["checkWithProficiency", "saveFromItems", "saveProficient", "proficiencyBonus"] as const;

  it("keeps every derived-block field out of the player projection, for own and other actors alike", () => {
    const state = stateWith([item(CIRCLET_ROW)]);
    const projected = projectPlayerView(state, IDS.heroSession, () => null);
    const serialised = JSON.stringify(projected);
    for (const key of DERIVED_KEYS) expect(serialised, `"${key}" reached the broadcast player projection`).not.toContain(key);
    for (const actor of projected.actors) expect(actor).not.toHaveProperty("derived");
    // The GM-only combatant is absent entirely, as before - the derived work never happens for it.
    expect(projected.actors.map((actor) => actor.id)).toEqual([IDS.hero, IDS.rival]);
  });

  it("keeps it out of the GM projection too, so `Omit<GameState, \"actors\">` has nothing new to strip", () => {
    const state = stateWith([item(CIRCLET_ROW)]);
    const serialised = JSON.stringify(projectGmView(state, () => null));
    for (const key of DERIVED_KEYS) expect(serialised, `"${key}" reached the GM broadcast`).not.toContain(key);
  });

  it("never merges an item's grant into the definition, which is what the projection DOES ship", () => {
    const definition = definitionOf();
    // Deriving must not mutate: the owner's projection hands them `definition` verbatim, so anything
    // written in would reach the player the moment it was written.
    sheetFor(stateWith([item(CIRCLET_ROW)]), definition, catalogOf([CIRCLET]));
    expect(definition.proficiencies!.skills).toEqual([{ id: "stealth", proficiency: "proficient" }]);
  });
});

import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { importActorDefinition, rebuildActorDefinition } from "../src/actor-roster.js";
import { setInventoryItem } from "../src/inventory.js";

/**
 * ============================================================================================
 * U28 - THE SHIELD THAT LOWERED ARMOR CLASS, AND `unarmored-defense.allowShield`
 * ============================================================================================
 *
 * Measured at HEAD 186e4cf, before the fix: a Barbarian with Dex 14 / Con 16 read **AC 15**
 * bare-handed and **AC 14** holding one Shield. Picking a shield up made the character strictly
 * worse, because `armorClassFromEquipment` answered for a shield alone and its answer -
 * 10 + Dex + shield - short-circuited Unarmored Defense entirely.
 *
 * THE TWO SRD AUTHORS ARE THE TEST. `classes.v1.json` prints the Barbarian's Unarmored Defense with
 * `allowShield: true` ("You can use a Shield and still gain this benefit") and the Monk's with
 * `allowShield: false` ("while you aren't wearing armor or wielding a Shield"). Both characters
 * below are built to the SAME bare-handed AC 15 on purpose, so the shield is the only variable and
 * the four numbers cannot be produced by anything except the two authored flags being read.
 *
 * Every number here is read off a LIVE ACTOR after a real inventory write, not off a fixture: the
 * builder assembles from the real bundles, `importActorDefinition` instantiates, and the shield
 * arrives through `setInventoryItem` exactly as the sheet's equip toggle sends it. That matters
 * because the AC is re-derived at four separate call sites and a fix that reached only the builder
 * would be undone by the first reconciliation - the definition saying 17 while the table said 14.
 */

const POLICY = BuilderPolicySchema.parse({});
const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  other: "10000000-0000-4000-8000-000000000002"
} as const;

type Row = CharacterCreateRequestInput["choices"][number];
type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & { choices: Row[] };

/**
 * A Halfling Berserker at Dex 14 / Con 16 - the sheet from the bug report. Halfling because it is
 * the one SRD species that adds no number of its own, so an AC drift here belongs to the class.
 * Bare-handed: 10 + 2 (Dex) + 3 (Con) = 15.
 */
const barbarianInput = (level = 1): MutableInput => ({
  name: "Ozar", speciesId: "halfling", backgroundId: "soldier", classId: "barbarian", level,
  abilityMethod: "standard-array",
  baseScores: { str: 13, dex: 14, con: 15, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "barbarian", kind: "skill", id: "perception" },
    { level: 1, classId: "barbarian", kind: "skill", id: "survival" },
    { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "greataxe" },
    { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "handaxe" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "barbarian-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ] as Row[]
});

/**
 * A Halfling Monk at Dex 15 / Wis 16 - the Acolyte background is what carries Wisdom to 16, and its
 * Magic Initiate rows are the price of that (irrelevant to AC, and the build refuses without them).
 * Bare-handed: 10 + 2 (Dex) + 3 (Wis) = 15, deliberately the same number the Barbarian reads.
 */
const monkInput = (level = 1): MutableInput => ({
  name: "Shan", speciesId: "halfling", backgroundId: "acolyte", classId: "monk", level,
  abilityMethod: "standard-array",
  baseScores: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
  backgroundBonusAllocation: [{ ability: "wis", amount: 2 }, { ability: "int", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "monk", kind: "skill", id: "acrobatics" },
    { level: 1, classId: "monk", kind: "skill", id: "insight" },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "equipment", id: "monk-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ] as Row[]
});

/** A Halfling Fighter: the NEGATIVE CONTROL for the whole unit - no Unarmored Defense to read. */
const fighterInput = (): MutableInput => ({
  name: "Borin", speciesId: "halfling", backgroundId: "soldier", classId: "fighter", level: 1,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    // Archery, because it is the one Fighting Style carrying NO modifier at all - Defense would put
    // a +1 armour-class rider on the very number under test.
    { level: 1, classId: "fighter", kind: "fighting-style", id: "archery", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    // Fighter C is the gold-only option: it carries no armour, so this sheet reaches the table with
    // an empty armour slot and a shield alone is the ONLY thing the derivation can answer for.
    { level: 1, kind: "equipment", id: "fighter-c" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ] as Row[]
});

/**
 * One equipped row, copied from the REAL catalog record the way the sheet's add flow copies it. The
 * `armor` block is what the AC math reads, so taking it from the bundle rather than typing +2 here
 * is what makes this a test of the rule and not of my arithmetic; a missing record throws by name
 * rather than deriving a silent zero.
 */
function equippedFromCatalog(id: string): InventoryItem {
  const record = view.equipmentRecord(id);
  if (!record?.armor) throw new Error(`the SRD catalog has no armor record for "${id}"`);
  return {
    id: record.id, name: record.name, quantity: 1, equipped: true, attuned: false, category: record.category,
    armor: {
      acBase: record.armor.acBase, addDexModifier: record.armor.addDexModifier, dexModifierCap: record.armor.dexModifierCap,
      stealthDisadvantage: record.armor.stealthDisadvantage, strengthRequired: record.armor.strengthRequired
    }
  } as InventoryItem;
}

type Table = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor }>;

/** Build the sheet and put it on the table, exactly as `character.create` does. */
function onTheTable(input: MutableInput): Table {
  const definition = buildCharacterDefinition(input as CharacterCreateRequestInput, view, POLICY);
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  return { definition, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
}

/**
 * The player's own equip gesture: the same write the sheet sends, through the same reconciliation.
 * The return type is the ACTOR's, `number | undefined` - not narrowed here, so a reconciliation that
 * left no armour class at all fails the assertion by name instead of being coerced into one.
 */
function equip(table: Table, itemId: string): Actor["armorClass"] {
  setInventoryItem(table.state, IDS.hero, equippedFromCatalog(itemId),
    (id) => table.state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
  return table.hero.armorClass;
}

describe("Unarmored Defense and a shield (U28)", () => {
  /**
   * THE FOUR NUMBERS. Both characters read 15 bare-handed; the shield is the only thing that
   * changes, and it moves them in OPPOSITE directions because the two class records disagree about
   * it. Before the fix all four columns read 15 / 14 / 15 / 14 - the two authors were indis-
   * tinguishable and the Barbarian was punished for holding a shield.
   */
  it("adds a shield on top of the Barbarian's Constitution, and takes the Monk's Wisdom away", () => {
    const barbarian = onTheTable(barbarianInput());
    expect(barbarian.definition.armorClass).toBe(15); // 10 + 2 Dex + 3 Con
    expect(barbarian.hero.armorClass).toBe(15); // and the live actor agrees with the sheet it was built from
    expect(equip(barbarian, "shield")).toBe(17); // +2 ON TOP OF Constitution - the bug read 14

    const monk = onTheTable(monkInput());
    expect(monk.definition.armorClass).toBe(15); // 10 + 2 Dex + 3 Wis - the same number, on purpose
    expect(monk.hero.armorClass).toBe(15);
    expect(equip(monk, "shield")).toBe(14); // Unarmored Defense is LOST while wielding a shield: 10 + 2 + 2
  });

  /**
   * The authored contrast the four numbers rest on. If an ETL change or a bundle rebuild flipped
   * either flag the test above would still pass in one direction, so the content is asserted too -
   * this is the row that names WHY the Barbarian and the Monk differ.
   */
  it("reads the flag the two SRD class records actually print", () => {
    const flagFor = (classId: string) => {
      const feature = view.classRecord(classId)?.features.find((entry) => entry.id === "unarmored-defense");
      const modifier = feature?.modifiers.find((entry) => entry.type === "unarmored-defense");
      return modifier?.type === "unarmored-defense" ? modifier.allowShield : undefined;
    };
    expect(flagFor("barbarian")).toBe(true);
    expect(flagFor("monk")).toBe(false);
  });

  /**
   * Body armor REPLACES Unarmored Defense - both printings begin "while you aren't wearing armor" -
   * and the shield still stacks on the armor. Chain mail is heavy, so no Dexterity applies either:
   * 16 + 2 = 18, not 16 + 2 + 3 (Constitution added to armor) and not 15 + 2 (the feature kept).
   */
  it("lets body armor replace it, with the shield still stacking", () => {
    const barbarian = onTheTable(barbarianInput());
    expect(equip(barbarian, "chain-mail")).toBe(16);
    expect(equip(barbarian, "shield")).toBe(18);
  });

  /**
   * The NEGATIVE CONTROL. A Fighter has no Unarmored Defense, so a shield alone is the arithmetic
   * that always applied: 10 + Dex + 2. Nothing about this unit may reach a sheet that never had the
   * feature - which is also every monster and every PDF import, neither of which carries the
   * extension the reader looks for.
   */
  it("leaves a character without the feature on the old arithmetic", () => {
    const fighter = onTheTable(fighterInput());
    expect(fighter.hero.armorClass).toBe(12); // the stat block's own 10 + 2 Dex; Fighter A carries no armor
    expect(equip(fighter, "shield")).toBe(14); // 10 + 2 + 2, exactly as before U28
  });

  /**
   * The THIRD re-derivation site. A level-up rebuilds the definition and re-derives AC from the live
   * loadout, so the shield the Barbarian is already holding has to survive it: 17 before, 17 after.
   * Reading the same extension the builder just rewrote is what keeps them equal.
   */
  it("keeps the shielded Barbarian's armor class across a level-up", () => {
    const barbarian = onTheTable(barbarianInput());
    expect(equip(barbarian, "shield")).toBe(17);
    const levelled = buildCharacterDefinition(barbarianInput(2) as CharacterCreateRequestInput, view, POLICY);
    const actor = rebuildActorDefinition(barbarian.state, IDS.hero, levelled, catalog);
    expect(actor.armorClass).toBe(17);
  });

  /**
   * The reader is FAIL-OPEN by construction, and this is the shape that proves it: a definition
   * whose extension bag was written by something older (or by a PDF import, which writes none) still
   * derives an AC rather than a NaN. `IDS.other` keeps it off the hero's id so nothing is shared.
   */
  it("derives an ordinary shield AC for a definition carrying no unarmored-defense extension", () => {
    const { definition } = onTheTable(barbarianInput());
    const legacy = { ...definition, extensions: {} } as ActorDefinition;
    const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
    importActorDefinition(state, legacy, IDS.other, "public", catalog);
    const actor = state.actors.find((entry) => entry.id === IDS.other)!;
    expect(actor.armorClass).toBe(15); // the stored total still stands while nothing is equipped
    setInventoryItem(state, IDS.other, equippedFromCatalog("shield"),
      (id) => state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
    expect(actor.armorClass).toBe(14); // 10 + 2 + 2 - no feature is claimed, so none is granted
  });
});

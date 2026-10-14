import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { importActorDefinition, rebuildActorDefinition } from "../src/actor-roster.js";
import { setInventoryItem } from "../src/inventory.js";

// Unarmored Defense and `allowShield`: a shield must not short-circuit the feature into 10 + Dex + shield.
// The Barbarian prints `allowShield: true`, the Monk `false`; both build to a bare-handed AC 15, so the
// shield is the only variable. Every number is read off a live actor after a real inventory write, since
// AC is re-derived at several call sites.

const POLICY = BuilderPolicySchema.parse({});
const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  other: "10000000-0000-4000-8000-000000000002"
} as const;

type Row = CharacterCreateRequestInput["choices"][number];
type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & { choices: Row[] };

// A Halfling Berserker at Dex 14 / Con 16. Halfling adds no number of its own, so any AC drift belongs
// to the class. Bare-handed: 10 + 2 (Dex) + 3 (Con) = 15.
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

// A Halfling Monk at Dex 15 / Wis 16. The Acolyte background carries Wisdom to 16, and its Magic
// Initiate rows are required for the build. Bare-handed: 10 + 2 (Dex) + 3 (Wis) = 15, same as the Barbarian.
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

// A Halfling Draconic Sorcerer at level 3, the SRD's third author of this rider, which prints no Shield
// sentence at all. Dex 14 / Cha 17: bare-handed 10 + 2 + 3 = 15. Draconic Resilience arrives at level 3.
const sorcererInput = (): MutableInput => ({
  name: "Vaeryn", speciesId: "halfling", backgroundId: "acolyte", classId: "sorcerer", subclassId: "draconic-sorcery", level: 3,
  abilityMethod: "standard-array",
  baseScores: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  backgroundBonusAllocation: [{ ability: "cha", amount: 2 }, { ability: "int", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "sorcerer", kind: "skill", id: "arcana" },
    { level: 1, classId: "sorcerer", kind: "skill", id: "persuasion" },
    { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
    { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
    // Metamagic is a level-2 feature that refuses to build without its two picks; neither touches AC.
    { level: 2, classId: "sorcerer", kind: "metamagic", id: "careful-spell" },
    { level: 2, classId: "sorcerer", kind: "metamagic", id: "distant-spell" },
    { level: 1, kind: "equipment", id: "sorcerer-a" },
    { level: 1, kind: "equipment", id: "acolyte-a" }
  ] as Row[]
});

/** A Halfling Fighter: the negative control, with no Unarmored Defense to read. */
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
    // Archery carries no modifier; Defense would add a +1 armor-class rider to the number under test.
    { level: 1, classId: "fighter", kind: "fighting-style", id: "archery", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    // Fighter C is the gold-only option with no armor, so a shield alone is the only thing the derivation answers for.
    { level: 1, kind: "equipment", id: "fighter-c" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ] as Row[]
});

// One equipped row, copied from the real catalog record as the sheet's add flow copies it. The `armor`
// block is what the AC math reads; a missing record throws by name rather than deriving a silent zero.
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

/** Build the sheet and put it on the table, as `character.create` does. */
function onTheTable(input: MutableInput): Table {
  const definition = buildCharacterDefinition(input as CharacterCreateRequestInput, view, POLICY);
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  return { definition, state, hero: state.actors.find((actor) => actor.id === IDS.hero)! };
}

// The player's equip gesture: the same write the sheet sends, through the same reconciliation. The
// return type is left as `number | undefined` so a missing armor class fails the assertion by name.
function equip(table: Table, itemId: string): Actor["armorClass"] {
  setInventoryItem(table.state, IDS.hero, equippedFromCatalog(itemId),
    (id) => table.state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
  return table.hero.armorClass;
}

describe("Unarmored Defense and a shield (U28)", () => {
  // Both characters read 15 bare-handed; the shield moves them in opposite directions because the two
  // class records disagree about it.
  it("adds a shield on top of the Barbarian's Constitution, and takes the Monk's Wisdom away", () => {
    const barbarian = onTheTable(barbarianInput());
    expect(barbarian.definition.armorClass).toBe(15); // 10 + 2 Dex + 3 Con
    expect(barbarian.hero.armorClass).toBe(15); // and the live actor agrees with the sheet it was built from
    expect(equip(barbarian, "shield")).toBe(17); // +2 on top of Constitution

    const monk = onTheTable(monkInput());
    expect(monk.definition.armorClass).toBe(15); // 10 + 2 Dex + 3 Wis, the same number on purpose
    expect(monk.hero.armorClass).toBe(15);
    expect(equip(monk, "shield")).toBe(14); // Unarmored Defense is lost while wielding a shield: 10 + 2 + 2
  });

  /** The authored flags the four numbers rest on; a flipped flag would still pass the test above in one direction. */
  it("reads the flag the three SRD records actually print", () => {
    const flagIn = (features: readonly { id: string; modifiers: readonly { type: string }[] }[] | undefined) => {
      const modifier = features?.find((entry) => entry.id === "unarmored-defense" || entry.id === "draconic-resilience")
        ?.modifiers.find((entry) => entry.type === "unarmored-defense");
      return modifier?.type === "unarmored-defense" ? (modifier as { allowShield?: boolean }).allowShield : undefined;
    };
    expect(flagIn(view.classRecord("barbarian")?.features)).toBe(true);
    expect(flagIn(view.classRecord("monk")?.features)).toBe(false);
    // The Draconic Sorcerer's printing restricts only wearing armor, so its record says `true`.
    expect(flagIn(view.subclassRecord("draconic-sorcery")?.features)).toBe(true);
  });

  // The Draconic Sorcerer: 15 bare-handed, 17 with a Shield. Known limitation: the engine has no
  // armor-training gate ("only if you have training with it"), so 17 is derived for anyone.
  it("adds a shield on top of the Draconic Sorcerer's Charisma", () => {
    const sorcerer = onTheTable(sorcererInput());
    expect(sorcerer.definition.armorClass).toBe(15); // 10 + 2 Dex + 3 Cha
    expect(sorcerer.hero.armorClass).toBe(15);
    expect(equip(sorcerer, "shield")).toBe(17);
  });

  // `unarmoredDefenseOf` reads the content before the build-time extension bag, so a sheet saved with a stale
  // `allowShield: false` still gains the shield. The definition is JSON round-tripped as `GameStore` reloads it.
  it("prefers the corrected content over a pre-fix snapshot stored on the sheet", () => {
    const built = buildCharacterDefinition(sorcererInput() as CharacterCreateRequestInput, view, POLICY);
    const bag = (built.extensions as Record<string, { unarmoredDefense?: { ability: string; allowShield: boolean } }>)["open5e.srd-2024"];
    expect(bag?.unarmoredDefense, "the builder still writes the fast-path key").toMatchObject({ ability: "cha", allowShield: true });

    const stale = JSON.parse(JSON.stringify({
      ...built,
      extensions: { ...built.extensions, "open5e.srd-2024": { ...bag, unarmoredDefense: { ability: "cha", allowShield: false } } }
    })) as ActorDefinition;
    expect(stale.character?.features?.some((held) => held.id === "draconic-resilience"), "the stale sheet still names the feature").toBe(true);

    const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
    importActorDefinition(state, stale, IDS.hero, "public", catalog);
    const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
    expect(hero.armorClass).toBe(15);
    setInventoryItem(state, IDS.hero, equippedFromCatalog("shield"),
      (id) => state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
    // 17, not 14: the live rider wins over the stale flag.
    expect(hero.armorClass, "a sheet saved before the content fix must still gain the shield").toBe(17);
  });

  // Body armor replaces Unarmored Defense (both printings begin "while you aren't wearing armor") and the
  // shield still stacks. Chain mail is heavy, so no Dex: 16 + 2 = 18.
  it("lets body armor replace it, with the shield still stacking", () => {
    const barbarian = onTheTable(barbarianInput());
    expect(equip(barbarian, "chain-mail")).toBe(16);
    expect(equip(barbarian, "shield")).toBe(18);
  });

  // Negative control: a Fighter has no Unarmored Defense, so a shield alone is 10 + Dex + 2. The same
  // holds for every monster and PDF import, which carry no such extension.
  it("leaves a character without the feature on the old arithmetic", () => {
    const fighter = onTheTable(fighterInput());
    expect(fighter.hero.armorClass).toBe(12); // the stat block's own 10 + 2 Dex; Fighter C carries no armor
    expect(equip(fighter, "shield")).toBe(14); // 10 + 2 + 2
  });

  // A level-up rebuilds the definition and re-derives AC from the live loadout, so a shield already held
  // must survive it: 17 before, 17 after.
  it("keeps the shielded Barbarian's armor class across a level-up", () => {
    const barbarian = onTheTable(barbarianInput());
    expect(equip(barbarian, "shield")).toBe(17);
    const levelled = buildCharacterDefinition(barbarianInput(2) as CharacterCreateRequestInput, view, POLICY);
    const actor = rebuildActorDefinition(barbarian.state, IDS.hero, levelled, catalog);
    expect(actor.armorClass).toBe(17);
  });

  // The reader fails open: a definition claiming no feature (monster, PDF import) derives an ordinary shield
  // AC rather than NaN, and no Unarmored Defense is inferred from a class name.
  it("derives an ordinary shield AC for a definition that claims no feature at all", () => {
    const { definition } = onTheTable(barbarianInput());
    const { character: _dropped, ...stripped } = definition;
    const anonymous = { ...stripped, extensions: {} } as ActorDefinition;
    const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
    importActorDefinition(state, anonymous, IDS.other, "public", catalog);
    const actor = state.actors.find((entry) => entry.id === IDS.other)!;
    expect(actor.armorClass).toBe(15); // the stored total still stands while nothing is equipped
    setInventoryItem(state, IDS.other, equippedFromCatalog("shield"),
      (id) => state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
    expect(actor.armorClass).toBe(14); // 10 + 2 + 2 - no feature is claimed, so none is granted
  });

  // A sheet saved before the `unarmoredDefense` extension key existed (only that sub-key deleted, JSON round
  // tripped): `character.features` still names the feature, so the reader resolves it through the catalog.
  it("reaches a Barbarian saved before the extension key existed, with no rebuild", () => {
    const { definition } = onTheTable(barbarianInput());
    const bag = { ...(definition.extensions!["open5e.srd-2024"] as Record<string, unknown>) };
    delete bag.unarmoredDefense;
    const legacy = JSON.parse(JSON.stringify({ ...definition, extensions: { "open5e.srd-2024": bag } })) as ActorDefinition;
    expect(Object.keys(legacy.extensions!["open5e.srd-2024"] as object)).toEqual(["traits"]);
    expect(legacy.character!.features!.some((entry) => entry.id === "unarmored-defense")).toBe(true);

    const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
    importActorDefinition(state, legacy, IDS.other, "public", catalog);
    const actor = state.actors.find((entry) => entry.id === IDS.other)!;
    expect(actor.armorClass).toBe(15); // bare-handed, unchanged
    setInventoryItem(state, IDS.other, equippedFromCatalog("shield"),
      (id) => state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
    expect(actor.armorClass).toBe(17); // +2 on top of Constitution, read from the stored sheet's own feature
  });

  // The same legacy shape for the Monk: a fallback that granted the benefit unconditionally would also
  // read 17 here. 14 is correct because Unarmored Defense is lost to the Shield.
  it("reads the Monk's authored refusal from a sheet saved before the key existed", () => {
    const { definition } = onTheTable(monkInput());
    const bag = { ...(definition.extensions!["open5e.srd-2024"] as Record<string, unknown>) };
    delete bag.unarmoredDefense;
    const legacy = JSON.parse(JSON.stringify({ ...definition, extensions: { "open5e.srd-2024": bag } })) as ActorDefinition;
    const state = GameStateSchema.parse({ schemaVersion: 1 }) as GameState;
    importActorDefinition(state, legacy, IDS.other, "public", catalog);
    const actor = state.actors.find((entry) => entry.id === IDS.other)!;
    expect(actor.armorClass).toBe(15);
    setInventoryItem(state, IDS.other, equippedFromCatalog("shield"),
      (id) => state.definitions.find((entry) => entry.id === id)?.definition, { catalog, role: "player" });
    expect(actor.armorClass).toBe(14); // 10 + 2 + 2: the Monk's printing refuses the Shield
  });
});

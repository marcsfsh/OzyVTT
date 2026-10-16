import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { testCatalog } from "./catalog-records.js";

// An item's spell cast reads the spell's cast model, never the source's prose columns: Cure Wounds heals, Magic
// Missile fires all three darts, and a spell that only mentions an attack roll makes none.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  ally: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

/** A cleric with Wisdom 16 (+3), DC 13, +5 to hit. */
const definition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 },
  hitPoints: { maximum: 30 },
  actions: [],
  extensions: {},
  spellcasting: { ability: "wis", saveDc: 13, attackBonus: 5, spells: [], slots: [] }
} as unknown as ActorDefinition;

/** A wand that casts each spell, so each becomes an item action. */
const SPELLS = ["cure-wounds", "magic-missile", "faerie-fire", "web"];
const catalog = testCatalog({
  equipment: [
    {
      id: "test-wand",
      name: "Test Wand",
      category: "wand",
      slot: "held",
      casts: SPELLS.map((spellId) => ({ spellId }))
    }
  ],
  spells: loadSpells().filter((spell) => SPELLS.includes(spell.id))
});

function table(): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        definitionId: "def-hero",
        inventory: [InventoryItemSchema.parse({ id: "test-wand", name: "Test Wand", equipped: true })]
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "player-character",
        visibility: "public",
        hp: { current: 5, maximum: 30 }
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

const castOf = (state: GameState, spellId: string) =>
  effectiveActions(definition, state.actors[0], catalog).find(
    (action) => action.id === `item-test-wand-cast-${spellId}`
  )!;

const deps = (faces: number[]): ResolveDependencies => {
  let index = 0;
  return {
    random: () => faces.shift() ?? 1,
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-10-16T00:00:00.000Z",
    definition,
    catalog
  };
};

describe("an item's spell cast, from the spell's cast model", () => {
  it("heals an ally with Cure Wounds, adding the caster's modifier, and deals no damage", () => {
    const state = table();
    const cure = castOf(state, "cure-wounds");
    expect(cure.healing).toEqual({ formula: "2d8 + 3" });
    expect(cure.damage).toEqual([]);
    expect(cure.attack).toBeUndefined();

    const resolution = resolveDefinitionAction(
      state,
      cure,
      { actorId: IDS.hero, targetIds: [IDS.ally], commandId: "50000000-0000-4000-8000-000000000001" },
      deps([4, 5])
    );
    expect(resolution.healing).toEqual({
      total: 12,
      targets: [{ targetId: IDS.ally, targetName: "Ally", regained: 12 }]
    });
    expect(state.actors[1].hp.current).toBe(17);
    expect(state.rolls.at(-1)!.purpose).toBe("healing");
    expect(resolution.tableNarration).toContainEqual({
      kind: "heal",
      text: "Ally regains 12 hit points (Cast Cure Wounds (Test Wand)).",
      actorIds: [IDS.ally]
    });
  });

  it("fires all three of Magic Missile's darts", () => {
    expect(castOf(table(), "magic-missile").damage).toEqual([{ formula: "3d4 + 3", type: "force" }]);
  });

  it("makes no attack for a spell that only mentions attack rolls, and no damage the text only threatens", () => {
    const state = table();
    expect(castOf(state, "faerie-fire").attack).toBeUndefined();
    expect(castOf(state, "faerie-fire").save).toMatchObject({ ability: "dex", dc: 13 });
    expect(castOf(state, "web").damage).toEqual([]);
  });
});

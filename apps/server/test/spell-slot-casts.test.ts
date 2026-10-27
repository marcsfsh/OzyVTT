import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { castSlotLevel } from "../src/resolution/economy.js";
import { looseRollPlan, slotsModeFor, spendLooseUses } from "../src/tap-routing.js";

// A leveled spell cast from the sheet resolves on the server: the builder mints it as an action that spends a slot,
// a higher slot rolls that slot's dice, and outside a fight the loose route spends the slot and rolls the healing.

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);
const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const FOE = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d12";

/** A level-3 Human Sage Druid with Wisdom 17 (+3): Cure Wounds and Entangle prepared, two level 2 spell slots. */
const druid = (): CharacterCreateRequestInput =>
  ({
    name: "Maelin",
    speciesId: "human",
    backgroundId: "sage",
    classId: "druid",
    level: 3,
    subclassId: "circle-of-the-land",
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "druid", kind: "skill", id: "nature" },
      { level: 1, classId: "druid", kind: "skill", id: "perception" },
      { level: 1, classId: "druid", kind: "primal-order", id: "warden", payload: { featureId: "primal-order" } },
      { level: 1, kind: "cantrip", id: "druidcraft" },
      { level: 1, kind: "cantrip", id: "guidance" },
      { level: 1, kind: "spell", id: "entangle" },
      { level: 1, kind: "spell", id: "cure-wounds" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "minor-illusion", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "cantrip", id: "dancing-lights", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spell", id: "magic-missile", payload: { featureId: "magic-initiate-wizard" } },
      { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "magic-initiate-wizard" } },
      { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
      { level: 3, kind: "land", id: "polar", payload: { featureId: "circle-of-the-land-spells" } },
      { level: 1, kind: "equipment", id: "druid-a" },
      { level: 1, kind: "equipment", id: "sage-a" }
    ]
  }) as CharacterCreateRequestInput;

const definition = buildCharacterDefinition(druid(), view, BuilderPolicySchema.parse({}));

function fight(): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, HERO, "public", catalog);
  state.actors.push({ ...state.actors[0], id: FOE, name: "Ghoul", kind: "monster", definitionId: undefined });
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 5 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

let roll = 0;
const deps = () => ({
  random: () => 3,
  newRollId: () => `40000000-0000-4000-8000-${String((roll += 1)).padStart(12, "0")}`,
  gmSessionId: "30000000-0000-4000-8000-00000000000a",
  now: () => "2026-10-16T00:00:00.000Z",
  definition,
  catalog
});

describe("a leveled spell cast with a slot", () => {
  it("is minted as an action that spends a slot of its level, linked from the sheet", () => {
    const cure = definition.actions.find((action) => action.id === "spell-cure-wounds");
    expect(cure).toMatchObject({ spellId: "cure-wounds", spellSlot: { level: 1 }, healing: { formula: "2d8 + 3" } });
    expect(cure!.damage).toEqual([]);
    expect(definition.actions.find((action) => action.id === "spell-entangle")).toMatchObject({
      spellSlot: { level: 1 },
      save: { ability: "str", dc: 13 }
    });
    expect(definition.spellcasting!.spells.find((spell) => spell.id === "cure-wounds")!.actionId).toBe(
      "spell-cure-wounds"
    );
  });

  it("carries a reaction spell's trigger, so the table can offer it (Shield)", () => {
    const input = druid();
    const shielded = buildCharacterDefinition(
      {
        ...input,
        choices: input.choices.map((choice) =>
          choice.kind === "spell" && choice.id === "magic-missile" ? { ...choice, id: "shield" } : choice
        )
      } as CharacterCreateRequestInput,
      view,
      BuilderPolicySchema.parse({})
    );
    expect(shielded.actions.find((action) => action.id === "spell-shield")).toMatchObject({
      activation: "reaction",
      spellSlot: { level: 1 },
      reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true }
    });
  });

  it("heals with a level 2 spell slot's dice, and spends that slot", () => {
    const state = fight();
    const hero = state.actors[0];
    hero.hp = { ...hero.hp, current: 1 };
    const before = hero.spellSlots!.find((slot) => slot.level === 2)!.remaining;
    const cure = effectiveActions(definition, hero, catalog).find((action) => action.id === "spell-cure-wounds")!;
    const resolution = resolveDefinitionAction(
      state,
      cure,
      { actorId: HERO, targetIds: [HERO], commandId: "50000000-0000-4000-8000-000000000001", slotLevel: 2 },
      deps()
    );
    // 4d8 at level 2, every die a 3, plus Wisdom.
    expect(resolution.healing!.total).toBe(15);
    expect(hero.hp.current).toBe(16);
    expect(hero.spellSlots!.find((slot) => slot.level === 2)!.remaining).toBe(before - 1);
  });

  it("takes the lowest slot left at or above the spell's level when none is named", () => {
    expect(
      castSlotLevel(
        {
          spellSlots: [
            { level: 1, remaining: 0 },
            { level: 3, remaining: 2 }
          ]
        },
        1,
        undefined
      )
    ).toBe(3);
    expect(castSlotLevel({ spellSlots: [{ level: 1, remaining: 1 }] }, 1, undefined)).toBe(1);
  });
});

describe("a leveled spell cast outside an encounter", () => {
  it("spends the slot and rolls its healing, labelled as healing", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, definition, HERO, "public", catalog);
    const hero = state.actors[0];
    const actions = effectiveActions(definition, hero, catalog);
    const cure = actions.find((action) => action.id === "spell-cure-wounds")!;
    expect(looseRollPlan(cure, { includeDamage: false })).toEqual([
      { formula: "2d8 + 3", purpose: "healing", label: "Cure Wounds" }
    ]);
    const before = hero.spellSlots!.find((slot) => slot.level === 1)!.remaining;
    spendLooseUses(hero, cure, actions, 1);
    expect(hero.spellSlots!.find((slot) => slot.level === 1)!.remaining).toBe(before - 1);
  });

  it("refuses an empty slot only while the table polices spell slots; advised, it is a note", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    importActorDefinition(state, definition, HERO, "public", catalog);
    const hero = state.actors[0];
    hero.spellSlots = hero.spellSlots!.map((slot) => ({ ...slot, remaining: 0 }));
    const actions = effectiveActions(definition, hero, catalog);
    const cure = actions.find((action) => action.id === "spell-cure-wounds")!;
    expect(() => spendLooseUses(hero, cure, actions, 1, "strict")).toThrowError(/has none left/);
    expect(spendLooseUses(hero, cure, actions, 1, "assisted")).toMatchObject({
      spent: false,
      warning: expect.stringMatching(/has none left/)
    });
    expect(spendLooseUses(hero, cure, actions, 1, "freeform")).toEqual({ usesLeft: null, spent: false });
    // Slots follow the table's standing dial, which starts on Enforce.
    expect(slotsModeFor(state)).toBe("strict");
  });
});

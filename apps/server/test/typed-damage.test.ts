import { describe, expect, it } from "vitest";
import { EffectInstanceSchema, GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { applyDamageDetailed, damageAdjustmentDetail } from "../src/hit-points.js";
import { addEffect } from "../src/effects.js";
import type { EquipmentCatalog, EquipmentRecordLike } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";

/**
 * TYPED DAMAGE, END TO END (issue `4a`).
 *
 * Every case here proves the FAR end - hit points that actually moved, and the line the table reads
 * telling it why. A defence that survives into a struct and changes no number is the exact bug this
 * file exists to close, so nothing below asserts on an intermediate collection.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    schemaId: "vtt.actor-character", schemaVersion: 1, source: { name: "test", version: "1" },
    name: "Hero", size: "medium", armorClass: 12, proficiencyBonus: 2, speedFeet: 30, initiativeBonus: 0,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [], extensions: {}, token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
    ...over
  } as unknown as ActorDefinition;
}

const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "worn", name: "Worn", equipped: true, ...over });

function catalogOf(records: readonly EquipmentRecordLike[]): EquipmentCatalog {
  return { equipmentRecord: (id) => records.find((record) => record.id === id), featRecord: () => undefined };
}

function stateWith(inventory: InventoryItem[] = [], heroOver: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory, ...heroOver },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }
  ] });
}

/** Damage the hero and report what actually happened to their hit points, plus the table's line. */
function hit(state: GameState, parts: Array<{ amount: number; type: string }>, definition: ActorDefinition, catalog?: EquipmentCatalog) {
  const before = state.actors[0].hp.current;
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const outcome = applyDamageDetailed(state, IDS.hero, { amount: total, parts }, GM, {
    resolveDefinition: () => definition, ...(catalog ? { catalog } : {})
  });
  return { hpLost: before - state.actors[0].hp.current, detail: damageAdjustmentDetail(outcome.application), application: outcome.application };
}

// -------------------------------------------------------------------------------------------------
// Gap 1 - flat `damage-reduction`
// -------------------------------------------------------------------------------------------------

describe("gap 1: flat damage-reduction reaches the hit", () => {
  const reducer = (modifiers: unknown[]): EquipmentRecordLike =>
    ({ id: "plate-of-blunting", name: "Plate of Blunting", category: "armor", slot: "armor", isMagic: true, modifiers } as unknown as EquipmentRecordLike);
  const worn = () => [item({ id: "plate-of-blunting", name: "Plate of Blunting", category: "armor" })];

  it("subtracts a standing reduction from the total, and names it on the line", () => {
    const catalog = catalogOf([reducer([{ type: "damage-reduction", amount: 3 }])]);
    const result = hit(stateWith(worn()), [{ amount: 10, type: "fire" }], definitionOf(), catalog);
    expect(result.hpLost).toBe(7);
    expect(result.application.flatReduction).toBe(3);
    expect(result.detail).toContain("then -3, reduction");
  });

  it("applies AFTER resistance, never before it", () => {
    const catalog = catalogOf([reducer([{ type: "damage-reduction", amount: 3 }])]);
    // 10 fire, resisted to 5, then reduced by 3 = 2. Reduction-first would be (10-3)/2 = 3.
    const result = hit(
      stateWith(worn()),
      [{ amount: 10, type: "fire" }],
      definitionOf({ damageResistances: ["fire"] }),
      catalog
    );
    expect(result.hpLost).toBe(2);
    expect(result.detail).toContain("10 fire → 5, resistance");
    expect(result.detail).toContain("then -3, reduction");
  });

  it("honours the on-taking-damage moment and its damage-type filter", () => {
    const catalog = catalogOf([reducer([{ type: "damage-reduction", amount: 3, when: [{ type: "on-taking-damage" }, { type: "damage-type-is", damageTypes: ["fire"] }] }])]);
    expect(hit(stateWith(worn()), [{ amount: 10, type: "fire" }], definitionOf(), catalog).hpLost).toBe(7);
    expect(hit(stateWith(worn()), [{ amount: 10, type: "cold" }], definitionOf(), catalog).hpLost).toBe(10);
  });

  it("floors at zero rather than healing, and stays silent when nothing was reduced", () => {
    const catalog = catalogOf([reducer([{ type: "damage-reduction", amount: 30 }])]);
    const result = hit(stateWith(worn()), [{ amount: 5, type: "fire" }], definitionOf(), catalog);
    expect(result.hpLost).toBe(0);
    expect(result.application.flatReduction).toBe(5);

    const plain = hit(stateWith(), [{ amount: 5, type: "fire" }], definitionOf());
    expect(plain.application.flatReduction).toBeUndefined();
    expect(plain.detail).toBe("");
  });
});

// -------------------------------------------------------------------------------------------------
// Gap 2 - vulnerability had exactly one channel
// -------------------------------------------------------------------------------------------------

describe("gap 2: anything can make a target vulnerable, not just a stat block", () => {
  const curse = (state: GameState, damageTypes: string[]) => addEffect(state, IDS.hero, EffectInstanceSchema.parse({
    id: "curse-of-embers", name: "Curse of Embers", tags: ["curse"], sourceActorId: null, sourceName: "Hag",
    sourceActionId: null, startedRound: 1, duration: { type: "manual" },
    modifiers: [{ type: "damage-vulnerability", damageTypes }]
  }));

  it("doubles the damage an ACTIVE EFFECT declares vulnerable, and names the effect on the line", () => {
    const state = stateWith();
    curse(state, ["fire"]);
    const result = hit(state, [{ amount: 6, type: "fire" }], definitionOf());
    expect(result.hpLost).toBe(12);
    expect(result.detail).toContain("6 fire → 12, vulnerability: Curse of Embers");
  });

  it("leaves other types alone", () => {
    const state = stateWith();
    curse(state, ["fire"]);
    expect(hit(state, [{ amount: 6, type: "cold" }], definitionOf()).hpLost).toBe(6);
  });

  it("cancels against a same-type resistance instead of compounding (SRD 5.2.1)", () => {
    const state = stateWith();
    curse(state, ["fire"]);
    const result = hit(state, [{ amount: 6, type: "fire" }], definitionOf({ damageResistances: ["fire"] }));
    expect(result.hpLost).toBe(6);
    expect(result.detail).toBe("");
  });

  it("loses to immunity outright", () => {
    const state = stateWith();
    curse(state, ["fire"]);
    expect(hit(state, [{ amount: 6, type: "fire" }], definitionOf({ damageImmunities: ["fire"] })).hpLost).toBe(0);
  });

  it("reaches the maths from an ITEM's effect too, named by the item", () => {
    const cursedBlade = {
      id: "brand-of-the-hag", name: "Brand of the Hag", category: "weapon", slot: "weapon", isMagic: true,
      effects: [{ name: "Hag's Brand", modifiers: [{ type: "damage-vulnerability", damageTypes: ["cold"] }] }]
    } as unknown as EquipmentRecordLike;
    const state = stateWith([item({ id: "brand-of-the-hag", name: "Brand of the Hag", category: "weapon" })]);
    const result = hit(state, [{ amount: 7, type: "cold" }], definitionOf(), catalogOf([cursedBlade]));
    expect(result.hpLost).toBe(14);
    expect(result.detail).toContain("7 cold → 14, vulnerability: Brand of the Hag");
  });
});

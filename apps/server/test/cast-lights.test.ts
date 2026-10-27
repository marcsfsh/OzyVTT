import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import type { GameState, VisionLight } from "@vtt/domain";
import { InventoryItemSchema, type ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { spellCastMechanics } from "../src/item-actions.js";
import { carriedLightsOf } from "../src/vision/senses.js";
import { catalog, view } from "./spell-casters.js";
import { cell, FRIEND, HERO, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 casts and actions aimed at flames: Druidcraft's and Prestidigitation's Fire Play ("light or snuff out a
// candle, a torch, or a small campfire"), a Frost Brand drawn ("extinguish all nonmagical flames within 30 feet of
// yourself"), a Sun Blade's Magic action ("expand the Bright Light and Dim Light radii by 5 feet each or reduce them by 5
// feet each, to a maximum of 30 feet each or a minimum of 10 feet each") and Darkness cast on an object ("a 15-foot
// Emanation originating from that object").

const spells = loadSpells();
const castOf = (spellId: string): ActorAction => {
  const spell = spells.find((entry) => entry.id === spellId)!;
  return {
    id: `spell-${spellId}`,
    name: spell.name,
    activation: "action",
    description: "",
    spellId,
    ...spellCastMechanics(spell, { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 4 })
  };
};
const itemAction = (itemId: string, actionId: string) =>
  ({
    ...view.equipmentRecord(itemId)!.actions.find((action) => action.id === actionId)!,
    id: `item-${itemId}-${actionId}`
  }) as unknown as ActorAction;
const resolve = (state: GameState, action: ActorAction, input: { targetIds?: string[]; lightId?: string } = {}) =>
  resolveDefinitionAction(
    state,
    action,
    {
      actorId: HERO,
      targetIds: input.targetIds ?? [],
      commandId: randomUUID(),
      ...(input.lightId ? { lightId: input.lightId } : {})
    },
    {
      random: () => 3,
      newRollId: randomUUID,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      catalog
    }
  );
const fresh = (state: GameState) => {
  state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false } };
};
const torch = (lit: boolean) =>
  InventoryItemSchema.parse({
    id: "torch",
    name: "Torch",
    quantity: 1,
    equipped: true,
    category: "gear",
    ...(lit ? { lit: true, burnsOutAtHour: 1 } : {})
  });
const sconce = (id: string, at: { x: number; y: number }, extra: Partial<VisionLight> = {}): VisionLight => ({
  id,
  position: at,
  actorId: null,
  brightFeet: 20,
  dimFeet: 20,
  ...extra
});
const LIGHT = "60000000-0000-4000-8000-0000000000a1";
const FAR = "60000000-0000-4000-8000-0000000000a2";
const SPELL_LIGHT = "60000000-0000-4000-8000-0000000000a3";
const lightOf = (state: GameState, id: string) => state.combat.vision.lights.find((light) => light.id === id)!;

describe("Fire Play", () => {
  it("snuffs a torch set on the map within 30 feet, and lights it again", () => {
    const state = visionGame({ lights: [sconce(LIGHT, cell(5, 5)), sconce(FAR, cell(9, 1))] });
    resolve(state, castOf("druidcraft"), { lightId: LIGHT });
    expect(lightOf(state, LIGHT).out).toBe(true);
    fresh(state);
    resolve(state, castOf("druidcraft"), { lightId: LIGHT });
    expect(lightOf(state, LIGHT).out).toBeUndefined();
    fresh(state);
    expect(() => resolve(state, castOf("druidcraft"), { lightId: FAR })).toThrow("beyond Druidcraft's 30 ft");
  });

  it("puts out an ally's burning Torch within 10 feet", () => {
    const state = visionGame({
      positions: { [FRIEND]: cell(2, 5) },
      actors: { [FRIEND]: { inventory: [torch(true)] } }
    });
    resolve(state, castOf("prestidigitation"), { targetIds: [FRIEND] });
    expect(state.actors.find((actor) => actor.id === FRIEND)!.inventory[0]!.lit).toBeUndefined();
  });
});

describe("a Frost Brand drawn", () => {
  it("puts out the nonmagical flames within 30 feet, and waits an hour", () => {
    const state = visionGame({
      positions: { [FRIEND]: cell(3, 5) },
      actors: { [FRIEND]: { inventory: [torch(true)] } },
      lights: [
        sconce(LIGHT, cell(4, 5)),
        sconce(FAR, cell(9, 1)),
        sconce(SPELL_LIGHT, cell(2, 5), { source: { casterId: FRIEND, spellId: "light" } })
      ]
    });
    resolve(state, itemAction("frost-brand", "extinguish"));
    expect([lightOf(state, LIGHT).out, lightOf(state, FAR).out, lightOf(state, SPELL_LIGHT).out]).toEqual([
      true,
      undefined,
      undefined
    ]);
    expect(state.actors.find((actor) => actor.id === FRIEND)!.inventory[0]!.lit).toBeUndefined();
    expect(() => resolve(state, itemAction("frost-brand", "extinguish"))).toThrow();
  });
});

describe("a Sun Blade's light", () => {
  it("widens by 5 feet a Magic action, between 10 and 30 feet of Bright Light", () => {
    const state = visionGame({
      actors: {
        [HERO]: {
          inventory: [
            InventoryItemSchema.parse({
              id: "sun-blade",
              name: "Sun Blade",
              quantity: 1,
              equipped: true,
              category: "weapon",
              attuned: true
            })
          ]
        }
      }
    });
    resolve(state, itemAction("sun-blade", "widen-light"));
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    expect(carriedLightsOf(state, hero, { catalog })[0]).toMatchObject({ brightFeet: 20, dimFeet: 20, sunlight: true });
    for (const _ of [1, 2]) {
      fresh(state);
      resolve(state, itemAction("sun-blade", "narrow-light"));
    }
    fresh(state);
    expect(() => resolve(state, itemAction("sun-blade", "narrow-light"))).toThrow("reaches 10 to 30 ft");
  });
});

describe("Darkness on an object", () => {
  it("fills a 15-foot Emanation round the creature that carries it", () => {
    const state = visionGame({ positions: { [FRIEND]: cell(2, 5) } });
    resolve(state, castOf("darkness"), { targetIds: [FRIEND] });
    expect(state.combat.vision.areas).toEqual([
      expect.objectContaining({
        kind: "magical-darkness",
        shape: { type: "emanation", actorId: FRIEND, radiusFeet: 15 }
      })
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { setCurrency, setInventoryItem } from "../src/inventory.js";

const actorId = "60a6e172-9ff5-44a3-8a8b-93f836f0d16c";
function stateWith(inventory: unknown[], extra: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [{ id: actorId, name: "Borin", kind: "player-character", hp: { current: 10, maximum: 10 }, inventory, ...extra }] });
}
const item = (over: Record<string, unknown>) => InventoryItemSchema.parse({ id: "x", name: "X", ...over });
const noDefs = () => undefined;

describe("setInventoryItem", () => {
  it("adds a new item", () => {
    const state = stateWith([]);
    setInventoryItem(state, actorId, item({ id: "torch", name: "Torch", quantity: 5 }), noDefs);
    expect(state.actors[0].inventory).toHaveLength(1);
    expect(state.actors[0].inventory[0]).toMatchObject({ id: "torch", quantity: 5 });
  });
  it("updates an existing item by id", () => {
    const state = stateWith([{ id: "torch", name: "Torch", quantity: 5 }]);
    setInventoryItem(state, actorId, item({ id: "torch", name: "Torch", quantity: 3, equipped: true }), noDefs);
    expect(state.actors[0].inventory).toHaveLength(1);
    expect(state.actors[0].inventory[0]).toMatchObject({ quantity: 3, equipped: true });
  });
  it("removes an item when quantity drops to 0", () => {
    const state = stateWith([{ id: "torch", name: "Torch", quantity: 1 }]);
    setInventoryItem(state, actorId, item({ id: "torch", name: "Torch", quantity: 0 }), noDefs);
    expect(state.actors[0].inventory).toHaveLength(0);
  });
  it("re-derives Armor Class from equipped armor, reverting to the base when unequipped (v6 #5)", () => {
    // reconcileArmorClass only reads dex + the base armorClass, so a minimal definition suffices.
    const definition = { abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, armorClass: 12 } as unknown as ActorDefinition;
    const resolve = (id: string) => (id === "def-borin" ? definition : undefined);
    const state = stateWith([], { definitionId: "def-borin", armorClass: 12 });
    const chainMail = { id: "chain-mail", name: "Chain Mail", category: "armor", armor: { acBase: 16, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: true, strengthRequired: 13 } };
    setInventoryItem(state, actorId, item({ ...chainMail, equipped: true }), resolve);
    expect(state.actors[0].armorClass).toBe(16); // heavy armor ignores Dex
    setInventoryItem(state, actorId, item({ ...chainMail, equipped: false }), resolve);
    expect(state.actors[0].armorClass).toBe(12); // reverts to the stored base
  });
});

describe("setCurrency", () => {
  it("replaces the coin purse", () => {
    const state = stateWith([]);
    setCurrency(state, actorId, { cp: 1, sp: 2, ep: 0, gp: 42, pp: 3 });
    expect(state.actors[0].currency).toEqual({ cp: 1, sp: 2, ep: 0, gp: 42, pp: 3 });
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema } from "@vtt/schemas";
import { setCurrency, setInventoryItem } from "../src/inventory.js";

const actorId = "60a6e172-9ff5-44a3-8a8b-93f836f0d16c";
function stateWith(inventory: unknown[]): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [{ id: actorId, name: "Borin", kind: "player-character", hp: { current: 10, maximum: 10 }, inventory }] });
}
const item = (over: Record<string, unknown>) => InventoryItemSchema.parse({ id: "x", name: "X", ...over });

describe("setInventoryItem", () => {
  it("adds a new item", () => {
    const state = stateWith([]);
    setInventoryItem(state, actorId, item({ id: "torch", name: "Torch", quantity: 5 }));
    expect(state.actors[0].inventory).toHaveLength(1);
    expect(state.actors[0].inventory[0]).toMatchObject({ id: "torch", quantity: 5 });
  });
  it("updates an existing item by id", () => {
    const state = stateWith([{ id: "torch", name: "Torch", quantity: 5 }]);
    setInventoryItem(state, actorId, item({ id: "torch", name: "Torch", quantity: 3, equipped: true }));
    expect(state.actors[0].inventory).toHaveLength(1);
    expect(state.actors[0].inventory[0]).toMatchObject({ quantity: 3, equipped: true });
  });
  it("removes an item when quantity drops to 0", () => {
    const state = stateWith([{ id: "torch", name: "Torch", quantity: 1 }]);
    setInventoryItem(state, actorId, item({ id: "torch", name: "Torch", quantity: 0 }));
    expect(state.actors[0].inventory).toHaveLength(0);
  });
});

describe("setCurrency", () => {
  it("replaces the coin purse", () => {
    const state = stateWith([]);
    setCurrency(state, actorId, { cp: 1, sp: 2, ep: 0, gp: 42, pp: 3 });
    expect(state.actors[0].currency).toEqual({ cp: 1, sp: 2, ep: 0, gp: 42, pp: 3 });
  });
});

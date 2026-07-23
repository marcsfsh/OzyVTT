import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { setPreparedSpell, setSpellSlotRemaining } from "../src/spellcasting.js";
import { applyRest } from "../src/rests.js";

const actorId = "60a6e172-9ff5-44a3-8a8b-93f836f0d16c";
const defId = "import-x";
const definition = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-character", schemaVersion: 1, source: { name: "t", version: "1" }, name: "Lyra", size: "medium",
  abilityScores: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 }, proficiencyBonus: 3, armorClass: 15, hitPoints: { maximum: 20 }, speedFeet: 30,
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
  spellcasting: { ability: "int", slots: [{ level: 1, max: 4 }, { level: 2, max: 3 }], spells: [
    { id: "fire-bolt", name: "Fire Bolt", level: 0, alwaysPrepared: true },
    { id: "shield", name: "Shield", level: 1, prepared: true },
    { id: "misty-step", name: "Misty Step", level: 2, prepared: false }
  ] }
});
function stateWith(spellSlots: unknown, prepared: string[]): GameState {
  return GameStateSchema.parse({ schemaVersion: 1,
    actors: [{ id: actorId, name: "Lyra", kind: "player-character", hp: { current: 20, maximum: 20 }, definitionId: defId, spellSlots, preparedSpellIds: prepared }],
    definitions: [{ id: defId, definition }]
  });
}
const resolve = (state: GameState) => (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;

describe("setSpellSlotRemaining", () => {
  it("clamps to [0, max]", () => {
    const state = stateWith([{ level: 1, remaining: 4 }], []);
    setSpellSlotRemaining(state, actorId, 1, 2, resolve(state));
    expect(state.actors[0].spellSlots).toEqual([{ level: 1, remaining: 2 }]);
    setSpellSlotRemaining(state, actorId, 1, 99, resolve(state));
    expect(state.actors[0].spellSlots![0].remaining).toBe(4);
    setSpellSlotRemaining(state, actorId, 1, -5, resolve(state));
    expect(state.actors[0].spellSlots![0].remaining).toBe(0);
  });
  it("rejects an unknown slot level", () => {
    const state = stateWith([{ level: 1, remaining: 4 }], []);
    expect(() => setSpellSlotRemaining(state, actorId, 5, 1, resolve(state))).toThrowError(/no level-5/);
  });
});

describe("setPreparedSpell", () => {
  it("adds and removes a leveled spell but refuses cantrips", () => {
    const state = stateWith([{ level: 1, remaining: 4 }], []);
    setPreparedSpell(state, actorId, "misty-step", true, resolve(state));
    expect(state.actors[0].preparedSpellIds).toContain("misty-step");
    setPreparedSpell(state, actorId, "misty-step", false, resolve(state));
    expect(state.actors[0].preparedSpellIds).not.toContain("misty-step");
    expect(() => setPreparedSpell(state, actorId, "fire-bolt", true, resolve(state))).toThrowError(/Cantrip/);
  });
});

describe("long rest restores spellcasting", () => {
  it("refills slots and resets prepared to the sheet defaults", () => {
    const state = stateWith([{ level: 1, remaining: 0 }, { level: 2, remaining: 1 }], ["misty-step"]);
    applyRest(state, actorId, "long", resolve(state));
    expect(state.actors[0].spellSlots).toEqual([{ level: 1, remaining: 4 }, { level: 2, remaining: 3 }]);
    expect([...state.actors[0].preparedSpellIds].sort()).toEqual(["fire-bolt", "shield"]);
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { setCharacterIdentity, setCharacterProficiencies } from "../src/character-edit.js";

const actorId = "60a6e172-9ff5-44a3-8a8b-93f836f0d16c";
const defId = `import-${actorId}`;
const definition = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-character", schemaVersion: 1, source: { name: "t", version: "1" }, name: "Borin", size: "medium",
  abilityScores: { str: 18, dex: 12, con: 16, int: 10, wis: 13, cha: 8 }, proficiencyBonus: 3, armorClass: 18, hitPoints: { maximum: 40 }, speedFeet: 30,
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } }
});
function stateWith(definitionId = defId): GameState {
  return GameStateSchema.parse({ schemaVersion: 1,
    actors: [{ id: actorId, name: "Borin", kind: "player-character", hp: { current: 40, maximum: 40 }, definitionId }],
    definitions: [{ id: definitionId, definition }]
  });
}

describe("character edit", () => {
  it("sets identity on the per-PC imported definition (re-validated)", () => {
    const state = stateWith();
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 8 }], feats: [] });
    expect(state.definitions[0].definition.character?.classes[0].level).toBe(8);
  });
  it("preserves the builder's choice ledger when the sheet edits identity", () => {
    const state = stateWith();
    // the builder recorded why each pick was made; the sheet's identity editor knows nothing about it
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 4 }], feats: [], choices: [{ level: 4, kind: "asi", id: "str-plus-2" }] });
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 5 }], feats: [] });
    expect(state.definitions[0].definition.character?.classes[0].level).toBe(5);
    expect(state.definitions[0].definition.character?.choices).toEqual([{ level: 4, kind: "asi", id: "str-plus-2" }]);
  });
  it("lets the builder replace the choice ledger explicitly (respec)", () => {
    const state = stateWith();
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 4 }], feats: [], choices: [{ level: 4, kind: "asi", id: "str-plus-2" }] });
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 4 }], feats: [], choices: [{ level: 4, kind: "feat", id: "alert" }] });
    expect(state.definitions[0].definition.character?.choices).toEqual([{ level: 4, kind: "feat", id: "alert" }]);
  });
  it("sets save and skill proficiency selections", () => {
    const state = stateWith();
    setCharacterProficiencies(state, actorId, { saves: ["str", "con"], skills: [{ id: "athletics", proficiency: "expertise" }] });
    expect(state.definitions[0].definition.proficiencies?.skills[0]).toMatchObject({ id: "athletics", proficiency: "expertise" });
    expect(state.definitions[0].definition.proficiencies?.saves).toEqual(["str", "con"]);
  });
  it("refuses to edit a shared bundle definition (only import-<actorId> is editable)", () => {
    const state = stateWith("bundle-goblin");
    expect(() => setCharacterProficiencies(state, actorId, { saves: [], skills: [] })).toThrowError(/no editable sheet/);
  });
});

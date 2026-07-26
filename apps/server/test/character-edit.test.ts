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
  it("preserves hit dice and the other classes when a single-class editor saves identity", () => {
    const state = stateWith();
    // A Fighter 3 / Wizard 2 as the builder (or an import) recorded it, hit dice and all.
    setCharacterIdentity(state, actorId, { classes: [
      { id: "fighter", name: "Fighter", level: 3, hitDie: "d10" },
      { id: "wizard", name: "Wizard", level: 2, hitDie: "d6" }
    ], feats: [] });
    // The sheet's identity editor renders one class and knows nothing about `hitDie`.
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 4 }], feats: [] });
    const classes = state.definitions[0].definition.character?.classes;
    expect(classes).toEqual([
      { id: "fighter", name: "Fighter", level: 4, hitDie: "d10" },
      { id: "wizard", name: "Wizard", level: 2, hitDie: "d6" }
    ]);
  });
  it("lets a supplied class row clear a subclass it renders (only omission preserves)", () => {
    const state = stateWith();
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 3, subclass: { id: "champion", name: "Champion" }, hitDie: "d10" }], feats: [] });
    setCharacterIdentity(state, actorId, { classes: [{ id: "fighter", name: "Fighter", level: 3 }], feats: [] });
    // hitDie (which no editor renders) survives; the subclass the editor DID render is cleared.
    expect(state.definitions[0].definition.character?.classes[0]).toEqual({ id: "fighter", name: "Fighter", level: 3, hitDie: "d10" });
  });
  it("sets save and skill proficiency selections", () => {
    const state = stateWith();
    setCharacterProficiencies(state, actorId, { saves: ["str", "con"], skills: [{ id: "athletics", proficiency: "expertise" }] });
    expect(state.definitions[0].definition.proficiencies?.skills[0]).toMatchObject({ id: "athletics", proficiency: "expertise" });
    expect(state.definitions[0].definition.proficiencies?.saves).toEqual(["str", "con"]);
  });
  it("preserves training and override totals when the sheet toggles one skill", () => {
    const state = stateWith();
    // A full proficiency block as an import/builder writes it.
    setCharacterProficiencies(state, actorId, {
      saves: ["str", "con"], skills: [{ id: "athletics", proficiency: "proficient" }],
      armor: ["heavy"], weapons: ["martial"], tools: ["smiths-tools"], languages: ["common", "dwarvish"],
      saveOverrides: { str: 7 }, skillOverrides: { athletics: 9 }
    });
    // The sheet's proficiency editor sends ONLY {saves, skills} - one skill toggle must not wipe the rest.
    setCharacterProficiencies(state, actorId, { saves: ["str", "con"], skills: [{ id: "athletics", proficiency: "expertise" }] });
    expect(state.definitions[0].definition.proficiencies).toEqual({
      saves: ["str", "con"], skills: [{ id: "athletics", proficiency: "expertise" }],
      armor: ["heavy"], weapons: ["martial"], tools: ["smiths-tools"], languages: ["common", "dwarvish"],
      saveOverrides: { str: 7 }, skillOverrides: { athletics: 9 }
    });
  });
  it("lets a caller that supplies training replace it (explicit beats stored)", () => {
    const state = stateWith();
    setCharacterProficiencies(state, actorId, { saves: [], skills: [], armor: ["heavy"], languages: ["common"] });
    setCharacterProficiencies(state, actorId, { saves: [], skills: [], armor: [], languages: ["common", "elvish"] });
    expect(state.definitions[0].definition.proficiencies).toMatchObject({ armor: [], languages: ["common", "elvish"] });
  });
  it("refuses to edit a shared bundle definition (only import-<actorId> is editable)", () => {
    const state = stateWith("bundle-goblin");
    expect(() => setCharacterProficiencies(state, actorId, { saves: [], skills: [] })).toThrowError(/no editable sheet/);
  });
});

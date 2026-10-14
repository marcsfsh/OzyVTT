import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { projectPlayerView } from "../src/projections.js";

const me = "b539ef5e-16e6-46ce-bf33-3ed4b02997c1";
const other = "65cc7d6b-1150-41c4-aa9f-390439313f53";
const noPresence = () => null;

// Every optional field set, so the projection has a chance to leak each one.
const filled = {
  visibility: "public",
  hp: { current: 30, maximum: 40, temporary: 2 },
  armorClass: 17,
  initiative: 3,
  notes: "GM notes",
  definitionId: "adult-red-dragon",
  size: "large",
  sizeCells: 2,
  tokenAssetId: "7d1f7a52-5d3b-4f8e-9b35-0d5f1c1d2a11",
  conditions: [{ id: "prone" }],
  actionUses: { breath: 1 },
  conditionImmunities: ["charmed"],
  speedFeet: 40,
  legendary: { actionsPerRound: 3, resistancesPerDay: 3 },
  hitDice: { die: "d10", maximum: 5, remaining: 3, entries: [{ die: "d10", maximum: 5, remaining: 3 }] },
  healthDisplay: { style: "bar", audience: "gm" },
  lastUsedAt: 1700000000000,
  spellSlots: [{ level: 1, remaining: 2 }],
  pactSlots: { level: 1, remaining: 1 },
  preparedSpellIds: ["shield"],
  inventory: [{ id: "rope", name: "Rope", quantity: 1, equipped: false }],
  currency: { gp: 12 }
};

const state = GameStateSchema.parse({
  schemaVersion: 1,
  actors: [
    { ...filled, id: "11111111-1111-4111-8111-111111111111", name: "Monster", kind: "monster", ownerSessionId: null },
    { ...filled, id: "22222222-2222-4222-8222-222222222222", name: "Theirs", kind: "player-character", ownerSessionId: other },
    { ...filled, id: "33333333-3333-4333-8333-333333333333", name: "Mine", kind: "player-character", ownerSessionId: me }
  ]
});

const COMMON = ["id", "name", "kind", "visibility", "size", "sizeCells", "tokenAssetId", "conditions", "deathSaves", "hp", "effects", "claimStatus", "presence"];
const PARTY = ["armorClass", "initiative", "speedFeet", "definitionId"];
const OWNER = ["actionUses", "choiceOverrides", "hitDice", "spellSlots", "pactSlots", "preparedSpellIds", "inventory", "currency"];

function keysOf(name: string, partyVisibility = "name-and-class") {
  const view = projectPlayerView({ ...state, partyVisibility } as typeof state, me, noPresence);
  const actor = view.actors.find((entry) => entry.name === name);
  if (!actor) throw new Error(`${name} missing from the player view`);
  return Object.keys(actor).sort();
}

describe("player view actor fields", () => {
  it("gives a monster only table-level fields", () => {
    expect(keysOf("Monster")).toEqual([...COMMON].sort());
  });

  it("adds party fields on another player's character", () => {
    expect(keysOf("Theirs")).toEqual([...COMMON, ...PARTY].sort());
  });

  it("adds owner resources on the player's own character", () => {
    expect(keysOf("Mine")).toEqual([...COMMON, ...PARTY, ...OWNER].sort());
  });

  it("never sends GM-only values", () => {
    const serialized = JSON.stringify(projectPlayerView(state, me, noPresence));
    for (const secret of ["GM notes", "charmed", "resistancesPerDay", "lastUsedAt", other]) expect(serialized).not.toContain(secret);
  });
});

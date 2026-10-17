import { describe, expect, it } from "vitest";
import { armorClassInPlay, BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, ActorSchema, InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { answerReaction } from "../src/reactions.js";

// SRD Spell Scroll: a reader whose spell list has the spell casts it from the scroll at its casting time, so a
// reaction spell on a scroll (Shield) is offered when its trigger happens, as the caster's own Shield would be. It
// needs no slot, and the scroll crumbles once the spell is cast.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const WREN = "10000000-0000-4000-8000-0000000000a1";
const BRUTE = "10000000-0000-4000-8000-0000000000a2";
const MAP = "20000000-0000-5000-8000-0000000000a1";

function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

const builtAs = (classId: string): ActorDefinition => {
  const { request } = generateCharacterRequest({ classId, level: 1 }, library, policy, seeded(5));
  return buildCharacterDefinition(request, library, policy);
};

const BRUTE_SHEET = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-monster",
  schemaVersion: 1,
  source: { name: "Test", version: "1", externalId: "brute" },
  name: "Brute",
  size: "medium",
  abilityScores: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 8 },
  proficiencyBonus: 2,
  armorClass: 13,
  hitPoints: { maximum: 40 },
  speedFeet: 30,
  actions: [
    {
      id: "club",
      name: "Club",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 5, reachFeet: 5 },
      damage: [{ formula: "1d6 + 3", type: "bludgeoning" }]
    }
  ]
});

const SHIELD_SCROLL = InventoryItemSchema.parse({
  id: "spell-scroll",
  name: "Spell Scroll",
  quantity: 1,
  equipped: false,
  attuned: false,
  category: library.equipmentRecord("spell-scroll")!.category,
  spellId: "shield"
});

/** A reader with a scroll of Shield and no spell slot left, and a Brute whose turn it is. */
function fight(readerClass: string): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, builtAs(readerClass), WREN, "public", catalog);
  const reader = state.actors.find((candidate) => candidate.id === WREN)!;
  reader.name = "Wren";
  reader.inventory = [...reader.inventory, SHIELD_SCROLL];
  reader.spellSlots = (reader.spellSlots ?? []).map((slot) => ({ ...slot, remaining: 0 }));
  reader.armorClass = 12;
  state.actors.push(
    ActorSchema.parse({
      id: BRUTE,
      name: "Brute",
      kind: "monster",
      visibility: "public",
      hp: { current: 40, maximum: 40 },
      armorClass: 13,
      definitionId: "def-brute",
      size: "medium",
      speedFeet: 30
    })
  );
  state.definitions.push({ id: "def-brute", definition: BRUTE_SHEET });
  startEncounter(
    state,
    {
      mapAssetId: MAP,
      entries: [
        { actorId: BRUTE, score: 20 },
        { actorId: WREN, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    lookup(state),
    Date.now(),
    catalog
  );
  return state;
}

let counter = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const lookup = (state: GameState) => (definitionId: string) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition;
const dice = (faces: number[]) => () => faces.shift() ?? 1;
const deps = (state: GameState, faces: number[]) => ({
  random: dice(faces),
  newRollId: nextId,
  gmSessionId: "30000000-0000-4000-8000-00000000000a",
  now: () => "2026-10-17T00:00:00.000Z",
  resolveDefinition: lookup(state),
  catalog
});

function club(state: GameState, faces: number[]) {
  return resolveDefinitionAction(
    state,
    BRUTE_SHEET.actions[0]!,
    { actorId: BRUTE, targetIds: [WREN], commandId: nextId(), commit: true },
    { ...deps(state, faces), definition: BRUTE_SHEET }
  );
}

describe("a reaction spell on a Spell Scroll", () => {
  it("is offered when its trigger happens, and casting it uses the scroll and no slot", () => {
    const state = fight("wizard");
    // 10 + 5 = 15 hits AC 12; the scroll's Shield would make it 17.
    expect(club(state, [10]).waitingOnReaction).toBe(true);
    expect(state.combat.pendingReactions[0]).toMatchObject({ actorId: WREN, actionName: "Cast Shield (Spell Scroll)" });
    const outcome = answerReaction(
      state,
      nextId(),
      state.combat.pendingReactions[0]!.id,
      true,
      undefined,
      { role: "gm" },
      deps(state, [])
    );
    expect(outcome.resolution?.attack).toMatchObject({ total: 15, targetAc: 17, outcome: "miss" });
    const wren = state.actors.find((candidate) => candidate.id === WREN)!;
    expect(wren.inventory.some((row) => row.id === "spell-scroll")).toBe(false);
    expect(wren.spellSlots?.every((slot) => slot.remaining === 0)).toBe(true);
    expect(armorClassInPlay(wren)).toBe(17);
  });

  it("isn't offered to a reader whose spell list lacks the spell", () => {
    const state = fight("fighter");
    const resolution = club(state, [10, 4]);
    expect(resolution.waitingOnReaction).toBeUndefined();
    expect(state.combat.pendingReactions).toEqual([]);
  });
});

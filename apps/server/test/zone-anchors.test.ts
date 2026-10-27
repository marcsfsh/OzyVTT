import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { openRepeatSavesOnDamage } from "../src/save-stages.js";
import { castOptionsOf, zonesAfterMove } from "../src/spell-zones.js";
import { ALLY, FOE, FOE2, HERO, fight, view } from "./spell-casters.js";
import { answer, cell, GRID, MAP, nextId, place, savesOf, turnDeps, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Antipathy/Sympathy: "A creature of the chosen kind makes a Wisdom saving throw when it comes within 120 feet
// of the target", Frightened (antipathy) or Charmed (sympathy) on a failure. "If the Frightened or Charmed creature ends
// its turn more than 120 feet away from the target, the creature makes a Wisdom saving throw. On a successful save, the
// creature is no longer affected by the target. A creature that successfully saves against this effect is immune to it".

const CAST = "6d000000-0000-4000-8000-000000000001";
const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source?.externalId === id)!;
const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = {
  goblin: monster("goblin-warrior"),
  zombie: monster("zombie")
};
const resolveDefinition = (definitionId: string) => DEFINITIONS[definitionId];
const deps = () => ({ ...zoneDeps(), resolveDefinition });
const effectsOf = (state: GameState, actorId: string) => state.actors.find((actor) => actor.id === actorId)!.effects;
/** Feet between two creatures on the 5-foot grid, counted as the map counts a diagonal. */
const apart = (state: GameState) => (a: string, b: string) => {
  const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)!.position!;
  return (Math.max(Math.abs(at(a).x - at(b).x), Math.abs(at(a).y - at(b).y)) / 50) * 5;
};

/** Moves a creature along cells and runs the areas it meets. */
function walk(state: GameState, actorId: string, cells: ReadonlyArray<readonly [number, number]>) {
  const path = cells.map(([column, row]) => cell(column, row));
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: path[path.length - 1]! } : token
  );
  return zonesAfterMove(state, { moverId: actorId, path }, deps());
}

/** Ends turns until it is this creature's turn, then ends that one too. */
function endTurnOf(state: GameState, actorId: string) {
  while (state.combat.turnActorId !== actorId) nextInitiativeTurn(state, [], { ...turnDeps(), resolveDefinition });
  nextInitiativeTurn(state, [], { ...turnDeps(), resolveDefinition, distanceFeet: apart(state) });
}

describe("Antipathy/Sympathy round its target", () => {
  const wizard = wizardAt(15, ["antipathysympathy"]);

  /** The wizard's spell round its ally Bran, against fey, cast over its hour before the fight; the goblin is fey, the
   *  orc a zombie. */
  function spell(option: string) {
    const caster = fight(wizard, { ally: true, combat: false });
    const { state } = caster;
    state.actors.find((actor) => actor.id === FOE)!.definitionId = "goblin";
    state.actors.find((actor) => actor.id === FOE2)!.definitionId = "zombie";
    place(state, { [HERO]: cell(0, 0), [ALLY]: cell(30, 10), [FOE]: cell(0, 10), [FOE2]: cell(0, 12) });
    caster.resolve("spell-antipathysympathy", { targetIds: [ALLY], commandId: CAST, option });
    startEncounter(
      state,
      {
        mapAssetId: MAP,
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: FOE, score: 10 },
          { actorId: FOE2, score: 9 },
          { actorId: ALLY, score: 8 }
        ]
      },
      () => 10,
      GRID
    );
    return caster;
  }

  it("offers antipathy or sympathy against each creature type", () => {
    const options = castOptionsOf(
      { id: "spell-antipathysympathy", spellId: "antipathysympathy" },
      view.spellRecord("antipathysympathy")
    ).options!;
    expect(options).toHaveLength(28);
    expect(options.map((option) => option.name)).toContain("Antipathy (humanoids)");
    expect(options.map((option) => option.id)).toContain("sympathy-undead");
  });

  it("Frightens a goblin of the target when it comes within 120 feet and fails, and spares the zombie", () => {
    const { state } = spell("antipathy-fey");
    // From 150 feet to 130: still outside.
    walk(state, FOE, [
      [0, 10],
      [4, 10]
    ]);
    expect(savesOf(state, FOE)).toEqual([]);
    // On to 110 feet.
    walk(state, FOE, [
      [4, 10],
      [8, 10]
    ]);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "wis" })]);
    answer(state, FOE, 1);
    const frightened = effectsOf(state, FOE).find((effect) => effect.linkedConditionIds.includes("frightened"));
    expect(frightened).toMatchObject({ sourceActorId: ALLY });
    walk(state, FOE2, [
      [0, 12],
      [10, 12]
    ]);
    expect(savesOf(state, FOE2)).toEqual([]);
  });

  it("moves with its target onto the creatures it comes within 120 feet of", () => {
    const { state } = spell("antipathy-fey");
    walk(state, ALLY, [
      [30, 10],
      [20, 10]
    ]);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "wis" })]);
  });

  it("puts the save again only to a goblin ending its turn beyond 120 feet, and a success frees it for good", () => {
    const { state } = spell("antipathy-fey");
    walk(state, FOE, [
      [0, 10],
      [8, 10]
    ]);
    answer(state, FOE, 1);
    // Its turn ends 110 feet off: no save.
    endTurnOf(state, FOE);
    expect(savesOf(state, FOE)).toEqual([]);
    // Driven to 150 feet off, its next turn ends with the save, and a success ends the fear.
    walk(state, FOE, [
      [8, 10],
      [0, 10]
    ]);
    endTurnOf(state, FOE);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "wis" })]);
    answer(state, FOE, 30);
    expect(effectsOf(state, FOE).some((effect) => effect.linkedConditionIds.includes("frightened"))).toBe(false);

    // Immune now, it comes back within 120 feet and makes no save.
    walk(state, FOE, [
      [0, 10],
      [10, 10]
    ]);
    expect(savesOf(state, FOE)).toEqual([]);
  });

  it("lets a Charmed goblin save again when the target damages it, and only then", () => {
    const { state } = spell("sympathy-fey");
    walk(state, FOE, [
      [0, 10],
      [8, 10]
    ]);
    answer(state, FOE, 1);
    const goblin = state.actors.find((actor) => actor.id === FOE)!;
    expect(goblin.effects.some((effect) => effect.linkedConditionIds.includes("charmed"))).toBe(true);
    const ending = { newId: nextId, now: () => "2026-10-19T00:00:00.000Z" };
    expect(openRepeatSavesOnDamage(state, goblin, HERO, ending)).toEqual([]);
    expect(openRepeatSavesOnDamage(state, goblin, ALLY, ending)).toHaveLength(1);
  });
});

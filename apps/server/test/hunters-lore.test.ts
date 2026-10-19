import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { projectPlayerView } from "../src/projections.js";
import { GOBLIN, HERO, SESSION_A, SESSION_B, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 Hunter's Lore (Hunter 3): "While a creature is marked by your Hunter's Mark, you know whether that creature
// has any Immunities, Resistances, or Vulnerabilities, and if the creature has any, you know what they are." What the
// Hunter's own player receives (`projections.ts`), and no one else.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const monsters = loadMonsterDefinitions();
const content = {
  definition: (id: string) => monsters.find((definition) => definition.source.externalId === id),
  catalog
};

/** A seeded stand-in for the dice (mulberry32), so the generated Ranger is the same every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

function hunterAt(level: number, subclassId?: string) {
  const policy = BuilderPolicySchema.parse({});
  const request = generateCharacterRequest(
    { classId: "ranger", level, ...(subclassId ? { subclassId } : {}) },
    library,
    policy,
    seeded(7)
  ).request;
  return buildCharacterDefinition(request, library, policy);
}

/** The Hunter (Session A's) beside a ghost, with or without its Hunter's Mark on the ghost. */
function table(marked: boolean, hunter = hunterAt(3, "hunter")): GameState {
  const state = visionGame({
    definitions: [{ id: "hunter", definition: hunter }],
    actors: { [HERO]: { definitionId: "hunter" }, [GOBLIN]: { definitionId: "ghost", name: "Ghost" } }
  });
  if (marked)
    addEffect(
      state,
      GOBLIN,
      makeEffect({
        id: "mark",
        name: "Hunter's Mark",
        tags: ["hunters-mark"],
        sourceActorId: HERO,
        sourceName: "Borin",
        duration: { type: "manual" }
      })
    );
  return state;
}

const known = (state: GameState, session: string) =>
  projectPlayerView(state, session, () => null, 0, content).actors.find((actor) => actor.id === GOBLIN)?.knownDefences;

describe("Hunter's Lore", () => {
  it("shows the Hunter's player the marked ghost's Immunities and Resistances", () => {
    const lore = known(table(true), SESSION_A)!;
    expect(lore.damageImmunities).toEqual(expect.arrayContaining(["necrotic", "poison"]));
    expect(lore.damageResistances).toEqual(expect.arrayContaining(["acid", "fire"]));
    expect(lore.damageVulnerabilities).toEqual([]);
    expect(lore.conditionImmunities).toEqual(expect.arrayContaining(["frightened", "grappled", "paralyzed"]));
  });

  it("shows nothing to another player, nothing once the mark ends, and nothing to a Ranger without the feature", () => {
    expect(known(table(true), SESSION_B)).toBeUndefined();
    expect(known(table(false), SESSION_A)).toBeUndefined();
    expect(known(table(true, hunterAt(2)), SESSION_A)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest, type GenerateCharacterInput } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { conversionOffers, convertResource } from "../src/conversions.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";

// SRD 5.2.1 classes.md, "When you roll Initiative": Superior Inspiration (Bard 18), Perfect Focus (Monk 15),
// Archdruid's Evergreen Wild Shape (Druid 20), Persistent Rage (Barbarian 15) and Uncanny Metabolism (Monk 2).

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const HERO = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4b";
const FOE = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e4c";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

function table(input: GenerateCharacterInput) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: FOE, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }]
  });
  importActorDefinition(
    state,
    buildCharacterDefinition(generateCharacterRequest(input, library, policy, () => 1).request, library, policy),
    HERO,
    "public",
    catalog
  );
  const hero = () => state.actors.find((entry) => entry.id === HERO)!;
  const resolve = (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;
  const limit = (poolId: string) =>
    actionPools(effectiveActions(resolve(hero().definitionId!), hero(), catalog)).find((pool) => pool.id === poolId)!
      .limit;
  return {
    state,
    hero,
    limit,
    left: (poolId: string) => limit(poolId) - (hero().actionUses[poolId] ?? 0),
    spendAll: (poolId: string) => {
      hero().actionUses = { ...hero().actionUses, [poolId]: limit(poolId) };
    },
    /** The hero rolls first (20), the goblin second. */
    fight: () =>
      startEncounter(
        state,
        {
          mapAssetId: "map",
          entries: [
            { actorId: HERO, score: 20 },
            { actorId: FOE, score: 5 }
          ]
        },
        () => 10,
        GEOMETRY,
        resolve,
        Date.now(),
        catalog
      ),
    convert: (conversionId: string) =>
      convertResource(state, HERO, { conversionId }, { resolveDefinition: resolve, catalog, random: () => 4 }),
    offer: (id: string) =>
      conversionOffers(state, hero(), { resolveDefinition: resolve, catalog }).find((o) => o.id === id)
  };
}

describe("regains that happen when Initiative is rolled", () => {
  it("Superior Inspiration gives a Bard 18 Bardic Inspiration back until two are left", () => {
    const bard = table({ classId: "bard", level: 18 });
    bard.spendAll("bardic-inspiration");
    const events = bard.fight();
    expect(bard.left("bardic-inspiration")).toBe(2);
    expect(events.map((event) => event.text).join(" ")).toMatch(/Superior Inspiration/);
  });

  it("Perfect Focus gives a Monk 15 Focus Points back until four are left", () => {
    const monk = table({ classId: "monk", level: 15 });
    monk.spendAll("focus-points");
    monk.fight();
    expect(monk.left("focus-points")).toBe(4);
  });

  it("Evergreen Wild Shape gives a Druid 20 with none left one use", () => {
    const druid = table({ classId: "druid", level: 20 });
    druid.spendAll("wild-shape");
    druid.fight();
    expect(druid.left("wild-shape")).toBe(1);
  });

  it("closes the step a finished rest opened", () => {
    const bard = table({ classId: "bard", level: 5 });
    bard.hero().restStep = { after: "short-rest" };
    bard.fight();
    expect(bard.hero().restStep).toBeNull();
  });
});

describe("what a creature may choose when it rolls Initiative", () => {
  it("lets a Barbarian 15 regain every Rage with Persistent Rage until the end of its first turn", () => {
    const barbarian = table({ classId: "barbarian", level: 15 });
    barbarian.spendAll("rage");
    expect(barbarian.offer("persistent-rage")?.reason).toMatch(/rolls Initiative/);
    barbarian.fight();
    expect(barbarian.offer("persistent-rage")?.reason).toBeNull();
    barbarian.convert("persistent-rage");
    expect(barbarian.left("rage")).toBe(barbarian.limit("rage"));
    expect(barbarian.offer("persistent-rage")?.reason).toMatch(/Long Rest/);
  });

  it("closes the window when the creature's first turn ends", () => {
    const monk = table({ classId: "monk", level: 5 });
    monk.spendAll("focus-points");
    monk.hero().hp = { ...monk.hero().hp, current: 10 };
    monk.fight();
    nextInitiativeTurn(monk.state);
    expect(() => monk.convert("uncanny-metabolism")).toThrow(/before the end of/);
  });

  it("Uncanny Metabolism gives a Monk every Focus Point and its Monk level plus the Martial Arts die in Hit Points", () => {
    const monk = table({ classId: "monk", level: 5 });
    monk.spendAll("focus-points");
    monk.hero().hp = { ...monk.hero().hp, current: 3 };
    monk.fight();
    monk.convert("uncanny-metabolism");
    expect(monk.left("focus-points")).toBe(monk.limit("focus-points"));
    expect(monk.hero().hp.current).toBe(3 + 5 + 4);
  });
});

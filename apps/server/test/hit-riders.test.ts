import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { currentSpeedFeet } from "../src/speed.js";

// Hit riders that are data on their action (`ridesHit`): Giant Ancestry's boons and a damage-type pick, asserted
// as the offers a hit carries, the dice they add and what they spend. The class riders are asserted beside their
// classes (`barbarian-fighter-monk.test.ts`, `rogue-ranger-paladin-mechanics.test.ts`).

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000202",
  map: "20000000-0000-5000-8000-000000000201",
  gmSession: "30000000-0000-4000-8000-00000000020a"
};

/** A level-5 Goliath Fighter with the Giant Ancestry boon under test. */
function goliath(boon: string): CharacterCreateRequestInput {
  return {
    name: "Thane",
    speciesId: "goliath",
    backgroundId: "soldier",
    classId: "fighter",
    level: 5,
    subclassId: "champion",
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 12, int: 10, wis: 8, cha: 13 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
      { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
      {
        level: 4,
        classId: "fighter",
        kind: "asi-or-feat",
        id: "asi",
        payload: { increases: [{ ability: "dex", amount: 2 }] }
      },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "giant-ancestry", id: boon, payload: { featureId: "goliath-giant-ancestry" } }
    ] as CharacterChoice[]
  };
}

type Table = ReturnType<typeof table>;

/** The character in a fight against one foe, on its own turn. */
function table(definition: ActorDefinition) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 99, maximum: 99 },
        armorClass: 10,
        speedFeet: 30
      }
    ]
  }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
  const foe = state.actors.find((actor) => actor.id === IDS.foe)!;
  return { state, hero, foe, definition };
}

let command = 0;
const actionOf = (built: Table, id: string) =>
  effectiveActions(built.definition, built.hero, catalog).find((entry) => entry.id === id)!;
/** A Greatsword swing at the foe, previewed or confirmed with the extras its hit offered. */
const swing = (
  built: Table,
  faces: number[],
  options: Readonly<{
    hitOptions?: Array<{ id: string; damageType?: string; effects?: string[] }>;
    commit?: boolean;
  }> = {}
) =>
  resolveDefinitionAction(
    built.state,
    actionOf(built, "item-greatsword"),
    {
      actorId: IDS.hero,
      targetIds: [IDS.foe],
      commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
      ...(options.hitOptions ? { hitOptions: options.hitOptions } : {}),
      ...(options.commit === false ? { commit: false } : {})
    },
    {
      random: () => {
        const face = faces.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => `40000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-18T00:00:00.000Z",
      definition: built.definition,
      catalog,
      resolveDefinition: (id) => built.state.definitions.find((entry) => entry.id === id)?.definition
    }
  );
const offerOf = (resolution: ReturnType<typeof swing>, id: string) =>
  resolution.hitOffers?.find((offer) => offer.id === id);

describe("Giant Ancestry's boons ride a hit that deals damage", () => {
  it("adds Fire's Burn's 1d10 Fire to a hit and spends a use, and is refused tapped alone", () => {
    const built = table(buildCharacterDefinition(goliath("fires-burn"), library, policy));
    expect(() =>
      resolveDefinitionAction(
        built.state,
        actionOf(built, "fires-burn"),
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000999" },
        {
          random: () => 5,
          newRollId: () => "40000000-0000-4000-8000-000000000999",
          gmSessionId: IDS.gmSession,
          now: () => "2026-10-18T00:00:00.000Z",
          definition: built.definition,
          catalog
        }
      )
    ).toThrowError(/Fire's Burn adds to a hit/);
    expect(offerOf(swing(built, [15], { commit: false }), "fires-burn")).toMatchObject({
      dice: "1d10 Fire",
      unverified: "Only if the hit deals damage."
    });
    const hit = swing(built, [15, 3, 3, 7], { hitOptions: [{ id: "fires-burn" }] });
    expect(hit.damage).toContainEqual({ formula: "1d10", type: "fire", total: 7, source: "Fire's Burn" });
    expect(built.hero.actionUses["giant-ancestry"]).toBe(1);
  });

  it("slows the target 10 feet with Frost's Chill until the start of the Goliath's next turn", () => {
    const built = table(buildCharacterDefinition(goliath("frosts-chill"), library, policy));
    swing(built, [15, 3, 3, 4], { hitOptions: [{ id: "frosts-chill" }] });
    expect(built.foe.effects).toMatchObject([
      {
        name: "Frost's Chill",
        duration: { type: "until-source-next-turn" },
        modifiers: [{ type: "speed", amount: -10 }]
      }
    ]);
    expect(currentSpeedFeet(built.foe, deriveEquipment(built.foe, undefined, catalog))).toBe(20);
  });

  it("knocks a Large or smaller creature Prone with Hill's Tumble, and offers nothing against a Huge one", () => {
    const built = table(buildCharacterDefinition(goliath("hills-tumble"), library, policy));
    expect(offerOf(swing(built, [15], { commit: false }), "hills-tumble")).toMatchObject({ name: "Hill's Tumble" });
    swing(built, [15, 3, 3], { hitOptions: [{ id: "hills-tumble" }] });
    expect(built.foe.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    const huge = table(buildCharacterDefinition(goliath("hills-tumble"), library, policy));
    huge.foe.size = "huge";
    expect(offerOf(swing(huge, [15], { commit: false }), "hills-tumble")).toBeUndefined();
  });

  it("adds nothing when the hit deals the target no damage, and spends no use", () => {
    const built = table(buildCharacterDefinition(goliath("fires-burn"), library, policy));
    const ogre = loadMonsterDefinitions().find((monster) => monster.source.externalId === "ogre")!;
    built.state.definitions.push({ id: "slash-proof", definition: { ...ogre, damageImmunities: ["slashing"] } });
    built.foe.definitionId = "slash-proof";
    const hit = swing(built, [15, 3, 3], { hitOptions: [{ id: "fires-burn" }] });
    expect(hit.damage.some((part) => part.source === "Fire's Burn")).toBe(false);
    expect(hit.warnings).toContain("Fire's Burn: the hit dealt Foe no damage, so it adds nothing.");
    expect(built.hero.actionUses["giant-ancestry"]).toBeUndefined();
  });
});

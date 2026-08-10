import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { loadWeapons } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf, masteryReaches } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";

/**
 * ================================================================================================
 * STAGE 5 - WEAPON MASTERY
 * ================================================================================================
 *
 * All 38 SRD weapons now name a mastery, and a slug on 38 records that no engine path reads is
 * EXACTLY the failure this area has already shipped three times: it typechecks, it reviews as done,
 * and nothing at the table changes. So the data assertion below is the small half of this file, and
 * the rest is behaviour proved where a player would see it - a damage number on a MISS, and a die
 * the foe actually rolls twice and keeps the worse of.
 *
 * TWO of the eight are implemented (graze, sap). The other six are deliberately inert and the
 * derivation REFUSES TO ADVERTISE THEM (`masteryReaches`), which is the difference between "not
 * built yet" and "built and silently doing nothing". The last test in this file is the one that
 * holds that line honest: it fails the day a slug is added to the implemented set without a
 * behaviour, and it fails the day a behaviour lands without being added.
 */

const POLICY = BuilderPolicySchema.parse({});
const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

type Row = CharacterCreateRequestInput["choices"][number];
type MutableInput = { -readonly [K in keyof CharacterCreateRequestInput]: CharacterCreateRequestInput[K] } & { choices: Row[] };

/**
 * A level-3 Halfling Champion, whose three Weapon Mastery picks are the parameter of every test here.
 * Halfling for the same reason lane B1 chose it: no ability bonus and no choice of its own, so every
 * number below belongs to the weapon or the class.
 *
 * Str 15 +2 (background) = 17 (+3); proficiency 2 at level 3.
 */
const fighter = (masteries: readonly string[]): MutableInput => ({
  name: "Borin", speciesId: "halfling", backgroundId: "soldier", classId: "fighter", level: 3,
  subclassId: "champion", abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    ...masteries.map((id) => ({ level: 1, classId: "fighter", kind: "weapon-mastery", id }) as Row),
    { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
});

/** A foe that can swing back, so Sap can be proved on the die the TARGET rolls rather than inferred. */
const FOE_DEFINITION = {
  schemaId: "vtt.actor-character", schemaVersion: 1,
  source: { name: "test", version: "1" },
  name: "Foe", size: "medium",
  abilityScores: { str: 16, dex: 12, con: 14, int: 6, wis: 10, cha: 6 },
  proficiencyBonus: 2, armorClass: 13,
  hitPoints: { maximum: 200, formula: "20d10" },
  initiativeBonus: 1, speedFeet: 30,
  actions: [{ id: "claw", name: "Claw", activation: "action", description: "A claw.", attack: { bonus: 5, reachFeet: 5 }, damage: [{ formula: "1d6 + 3", type: "slashing" }] }],
  token: { disposition: "hostile", footprint: { width: 1, height: 1 } },
  extensions: {}
} as unknown as ActorDefinition;

type Built = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor; foe: Actor }>;

function table(masteries: readonly string[]): Built {
  const definition = buildCharacterDefinition(fighter(masteries) as CharacterCreateRequestInput, view, POLICY);
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [] }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  importActorDefinition(state, FOE_DEFINITION, IDS.foe, "public", catalog);
  // The hero acts first, so `until-source-next-turn` has not yet expired when the foe swings back.
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return {
    definition, state,
    hero: state.actors.find((actor) => actor.id === IDS.hero)!,
    foe: state.actors.find((actor) => actor.id === IDS.foe)!
  };
}

let command = 0;
function deps(built: Built, definition: ActorDefinition, faces: number[]): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-08T00:00:00.000Z",
    definition, catalog,
    resolveDefinition: (definitionId: string) => built.state.definitions.find((entry) => entry.id === definitionId)?.definition
  };
}

const swing = (built: Built, actionId: string, faces: number[]) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === actionId)!,
    { actorId: IDS.hero, targetIds: [IDS.foe], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    deps(built, built.definition, faces)
  );

/** The foe swings back at the hero, which is where Sap has to show up or it has not worked. */
const swingBack = (built: Built, faces: number[]) =>
  resolveDefinitionAction(
    built.state,
    FOE_DEFINITION.actions.find((action) => action.id === "claw")!,
    { actorId: IDS.foe, targetIds: [IDS.hero], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    deps(built, FOE_DEFINITION, faces)
  );

// -------------------------------------------------------------------------------------------------
// The data. Small, but it is what every behaviour below stands on.
// -------------------------------------------------------------------------------------------------

describe("every SRD weapon names its mastery", () => {
  it("covers all 38 rows with the eight printed properties, and spot-checks the table", () => {
    const weapons = loadWeapons();
    expect(weapons).toHaveLength(38);
    expect(weapons.filter((weapon) => weapon.mastery === undefined)).toEqual([]);
    // The eight the SRD defines - not nine, and not seven.
    expect([...new Set(weapons.map((weapon) => weapon.mastery))].sort())
      .toEqual(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]);
    // Spot-checks straight off the printed table, one per property, so a wholesale mis-mapping that
    // still satisfied the two assertions above cannot pass.
    const of = (id: string) => weapons.find((weapon) => weapon.id === id)?.mastery;
    expect({
      greataxe: of("greataxe"), greatsword: of("greatsword"), dagger: of("dagger"), greatclub: of("greatclub"),
      mace: of("mace"), club: of("club"), quarterstaff: of("quarterstaff"), rapier: of("rapier")
    }).toEqual({
      greataxe: "cleave", greatsword: "graze", dagger: "nick", greatclub: "push",
      mace: "sap", club: "slow", quarterstaff: "topple", rapier: "vex"
    });
  });
});

// -------------------------------------------------------------------------------------------------
// The gate: a mastery is the weapon's AND the character's, or it is nothing.
// -------------------------------------------------------------------------------------------------

describe("a mastery reaches a swing only when the character unlocked THAT weapon", () => {
  it("arms the greatsword for a Fighter who picked it, and leaves the flail alone", () => {
    const picked = deriveEquipment(table(["greatsword", "longbow", "rapier"]).hero, table(["greatsword", "longbow", "rapier"]).definition, catalog);
    expect(picked.masteryByActionId["item-greatsword"]).toEqual({ id: "graze", abilityModifier: 3 });
    // The flail is EQUIPPED and has a mastery (sap) - it is simply not one of this Fighter's three.
    expect(picked.masteryByActionId["item-flail"]).toBeUndefined();
  });

  it("arms the flail instead when that is what was picked - same sheet, different three", () => {
    const built = table(["flail", "longbow", "rapier"]);
    const derivation = deriveEquipment(built.hero, built.definition, catalog);
    expect(derivation.masteryByActionId["item-flail"]).toEqual({ id: "sap", abilityModifier: 3 });
    expect(derivation.masteryByActionId["item-greatsword"]).toBeUndefined();
  });

  it("omits a mastery the engine does not implement, rather than advertising a no-op", () => {
    // The longbow's mastery is Slow, which is NOT built. The pick is legal and the sheet records it;
    // the derivation simply does not claim the weapon has a working mastery.
    const built = table(["longbow", "rapier", "maul"]);
    const derivation = deriveEquipment(built.hero, built.definition, catalog);
    expect(derivation.masteryByActionId).toEqual({});
  });
});

// -------------------------------------------------------------------------------------------------
// GRAZE - the one that fires on a MISS.
// -------------------------------------------------------------------------------------------------

describe("Graze deals the ability modifier on a miss", () => {
  it("turns a whiffed greatsword into 3 damage, and says where it came from", () => {
    // Str 17 (+3), proficiency 2 -> +5 to hit. The foe's AC is 13, so a natural 4 (total 9) misses.
    const built = table(["greatsword", "longbow", "rapier"]);
    const miss = swing(built, "item-greatsword", [4]);
    expect(miss.attack?.outcome).toBe("miss");
    // The far end: a real number on the roll card, typed as the weapon types, and attributed.
    expect(miss.bonusDamage).toEqual([{ amount: 3, type: "slashing", source: "Graze" }]);
    // The rolled TOTAL, which is the number the roll card shows and the GM then applies - damage
    // application is its own confirm step in this engine, so this is the far end of the roll path.
    expect(miss.damageTotal).toBe(3);
  });

  it("adds NOTHING on a miss when the Fighter did not pick the greatsword", () => {
    // The negative control, and the only difference between the two sheets is the three picks.
    const built = table(["longbow", "rapier", "maul"]);
    const miss = swing(built, "item-greatsword", [4]);
    expect(miss.attack?.outcome).toBe("miss");
    expect(miss.bonusDamage).toBeUndefined();
    expect(miss.damageTotal).toBe(0);
  });

  it("does not fire on a HIT - Graze is the miss case, not a flat bonus", () => {
    const built = table(["greatsword", "longbow", "rapier"]);
    const hit = swing(built, "item-greatsword", [15, 4, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.bonusDamage).toBeUndefined();
    expect(hit.damageTotal).toBe(11); // 2d6(4+4) + 3, with no Graze on top
  });

  it("still grazes on a natural 1 - the SRD writes no carve-out for a fumble", () => {
    const built = table(["greatsword", "longbow", "rapier"]);
    const fumble = swing(built, "item-greatsword", [1]);
    expect(fumble.attack?.outcome).toBe("fumble");
    expect(fumble.bonusDamage).toEqual([{ amount: 3, type: "slashing", source: "Graze" }]);
  });
});

// -------------------------------------------------------------------------------------------------
// SAP - the one that changes a die the OTHER side rolls.
// -------------------------------------------------------------------------------------------------

describe("Sap makes the target's next attack roll worse", () => {
  it("puts a real effect on the foe, and the foe then rolls 2d20 and keeps the LOWER", () => {
    const built = table(["flail", "longbow", "rapier"]);
    const hit = swing(built, "item-flail", [15, 5]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.effectsApplied).toEqual([{ targetId: IDS.foe, targetName: "Foe", name: "Sapped by Borin", conditionIds: [] }]);
    // On the ACTOR, not just in the response - this is the half that survives to the foe's turn.
    const sapped = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(sapped.effects.map((effect) => effect.name)).toEqual(["Sapped by Borin"]);
    // Sap is not a CONDITION: nothing should render a status badge the creature does not have.
    expect(sapped.conditions).toEqual([]);

    // THE FAR END. The foe swings back and the engine rolls two dice and keeps the worse one.
    const back = swingBack(built, [18, 3, 4]);
    expect(back.rollMode).toEqual({ mode: "disadvantage", advantage: [], disadvantage: ["Sapped by Borin"] });
    expect(back.attack?.naturalRoll).toBe(3);
  });

  it("leaves the foe a single die when the Fighter did not pick the flail", () => {
    const built = table(["longbow", "rapier", "maul"]);
    const hit = swing(built, "item-flail", [15, 5]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.effectsApplied).toBeUndefined();
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);

    const back = swingBack(built, [18, 4]);
    expect(back.rollMode).toBeUndefined();
    expect(back.attack?.naturalRoll).toBe(18);
  });

  it("applies nothing on a MISS - Sap is an on-hit rider", () => {
    const built = table(["flail", "longbow", "rapier"]);
    const miss = swing(built, "item-flail", [4]);
    expect(miss.attack?.outcome).toBe("miss");
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// The honesty gate.
// -------------------------------------------------------------------------------------------------

describe("the engine claims exactly the masteries it implements", () => {
  it("names two as built and six as not, so neither half can drift silently", () => {
    // This is the test that stops Stage 5 from LOOKING finished. `masteryReaches` is the single
    // registry the derivation consults, and these are its two halves stated out loud. Implementing
    // Push means changing this list in the same commit as the behaviour and its far-end proof - and
    // adding a slug here without one turns every test above this line into a liar.
    const built = ["graze", "sap"];
    const notYet = ["cleave", "nick", "push", "slow", "topple", "vex"];
    expect(built.filter(masteryReaches)).toEqual(built);
    expect(notYet.filter(masteryReaches)).toEqual([]);
    // ...and the two halves really are the whole SRD set, so nothing can be quietly forgotten.
    expect([...built, ...notYet].sort()).toEqual([...new Set(loadWeapons().map((weapon) => weapon.mastery))].sort());
  });
});

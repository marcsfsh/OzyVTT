import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { loadWeapons } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf, masteryReaches } from "../src/equipment-derivation.js";
import { createGameOperations, type GameOperationsContext } from "../src/game-operations.js";
import { GameStore, RulesBlockedError } from "../src/game-store.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { pushTokenAway } from "../src/forced-movement.js";
import { mapDistance, tokenCreatureDistance } from "../src/movement-narration.js";
import { moveEncounterToken, setActorSize, type TokenMapGeometry } from "../src/token-placement.js";

/**
 * ================================================================================================
 * STAGE 5 - WEAPON MASTERY
 * ================================================================================================
 *
 * All 38 SRD weapons now name a mastery, and a slug on 38 records that no engine path reads is
 * EXACTLY the failure this area has already shipped three times: it typechecks, it reviews as done,
 * and nothing at the table changes. So the data assertion below is the small half of this file, and
 * the rest is behaviour proved where a player would see it - a damage number on a MISS, a die the foe
 * actually rolls twice and keeps the worse of, a condition the foe's own save put on it, a token
 * standing two squares further away than it did, and the foe's own move refused with ten fewer feet
 * in the sentence.
 *
 * FIVE of the eight are implemented (graze, push, sap, slow, topple). The other three are deliberately
 * inert and the derivation REFUSES TO ADVERTISE THEM (`masteryReaches`), which is the difference
 * between "not built yet" and "built and silently doing nothing". The last test in this file is the
 * one that holds that line honest: it fails the day a slug is added to the implemented set without a
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
 *
 * AT LEVEL 5 the same sheet is the one two-hits-in-one-action tests need: Extra Attack makes ONE
 * Attack action two swings, the level-4 ASI takes Str to 19 (+4) and proficiency reaches 3 - so a
 * mastery DC computed off those moves to 15, a different number from every test above and therefore
 * one that has to be read rather than remembered. A fourth mastery pick lands at level 4, so the
 * first three of `masteries` are the level-1 picks and any beyond them are that one.
 */
const fighter = (masteries: readonly string[], level: 3 | 5 = 3): MutableInput => ({
  name: "Borin", speciesId: "halfling", backgroundId: "soldier", classId: "fighter", level,
  subclassId: "champion", abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    ...masteries.slice(0, 3).map((id) => ({ level: 1, classId: "fighter", kind: "weapon-mastery", id }) as Row),
    ...masteries.slice(3).map((id) => ({ level: 4, classId: "fighter", kind: "weapon-mastery", id }) as Row),
    ...(level === 5
      ? [
          { level: 4, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
          { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
          { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } }
        ] as Row[]
      : []),
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

/**
 * A weapon in the Fighter's hands that no SRD starting kit hands out. `fighter-a` is Chain Mail,
 * Greatsword, Flail and Javelins and `soldier-a` is a Spear and a Shortbow, so between them the
 * masteries reachable off the shelf are Graze, Sap, Slow and Vex - NOT ONE topple or push weapon.
 * A mastery only ever arms a weapon the character is holding, so proving either one needs the row.
 *
 * The row is minted the way the builder mints one (`character-build.ts`, `consumeEquipmentOption`):
 * the catalog record supplies the weapon block, because `weaponAction` reads the mechanics off the
 * INVENTORY row rather than the catalog. Copying that shape is what keeps this a real weapon in the
 * fighter's hands rather than a fixture that hands the derivation its own answer.
 */
function weaponRow(weaponId: string): InventoryItem {
  const record = catalog.equipmentRecord(weaponId);
  if (!record?.weapon) throw new Error(`${weaponId} is not a catalog weapon`);
  // Parsed rather than cast: the row goes through the same schema a real inventory write does, so a
  // fixture that drifted from the bundle's shape fails here instead of deriving something plausible.
  return InventoryItemSchema.parse({
    id: weaponId, name: record.name, quantity: 1, equipped: true, attuned: false, category: record.category,
    weapon: {
      category: record.weapon.category, damageDice: record.weapon.damageDice, damageType: record.weapon.damageType,
      rangeFeet: record.weapon.rangeFeet, longRangeFeet: record.weapon.longRangeFeet,
      ...(record.weapon.properties ? { properties: [...record.weapon.properties] } : {})
    }
  });
}

function table(masteries: readonly string[], extraWeaponIds: readonly string[] = [], geometry: TokenMapGeometry = GEOMETRY, level: 3 | 5 = 3): Built {
  const built = buildCharacterDefinition(fighter(masteries, level) as CharacterCreateRequestInput, view, POLICY);
  const definition = extraWeaponIds.length === 0
    ? built
    : { ...built, startingInventory: [...built.startingInventory ?? [], ...extraWeaponIds.map(weaponRow)] };
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [] }) as GameState;
  importActorDefinition(state, definition, IDS.hero, "public", catalog);
  importActorDefinition(state, FOE_DEFINITION, IDS.foe, "public", catalog);
  // The hero acts first, so `until-source-next-turn` has not yet expired when the foe swings back.
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, geometry);
  return {
    definition, state,
    hero: state.actors.find((actor) => actor.id === IDS.hero)!,
    foe: state.actors.find((actor) => actor.id === IDS.foe)!
  };
}

let command = 0;
// Minted across the whole file rather than per resolve, because the real `context.newId` is: two
// swings of the same weapon used to hand their pending saves the SAME id, so answering one answered
// both and a second owed prompt could not even be expressed here.
let rollId = 0;
function deps(built: Built, definition: ActorDefinition, faces: number[]): ResolveDependencies {
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-${String(++rollId).padStart(12, "0")}`,
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
    // The SHORTBOW is the load-bearing pick: `soldier-a` puts one in Borin's hands, so the weapon is
    // equipped, the pick is legal, the sheet records it - and the ONLY reason no mastery arms the
    // swing is that its Vex is not built. (The maul that used to stand here was Topple and the longbow
    // that replaced it was Slow; both are built now, so either would have quietly turned this into a
    // test about an unequipped weapon instead of an unimplemented mastery.) The greataxe and the
    // scimitar are the unheld halves of Cleave and Nick, there to say the picks are unrestricted.
    const built = table(["shortbow", "greataxe", "scimitar"]);
    // The bow really is in his hands - without this the assertion below would pass on an empty rack.
    expect(effectiveActions(built.definition, built.hero, catalog).some((action) => action.id === "item-shortbow")).toBe(true);
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
// TOPPLE - the one that ends on a condition the FOE's own die decided.
// -------------------------------------------------------------------------------------------------

/** The GM answering the foe's save. The foe's definition is the imported one, so its CON is read off the sheet. */
const saveDeps = (built: Built, faces: number[]): SaveAnswerDependencies => ({
  random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
  newRollId: () => `40000000-0000-4000-8000-0000000000ff`, sessionId: IDS.gmSession, role: "gm",
  now: () => "2026-08-08T00:00:00.000Z",
  resolveDefinition: (definitionId: string) => built.state.definitions.find((entry) => entry.id === definitionId)?.definition,
  catalog
});
const answer = (built: Built, faces: number[]) =>
  answerSave(built.state, `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
    built.state.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, saveDeps(built, faces));

describe("Topple forces a Constitution save, and a failure lands Prone", () => {
  it("parks the save at DC 13 and the foe's own failed die puts Prone in its conditions", () => {
    // Str 17 (+3), proficiency 2 -> +5 to hit, and DC 8 + 3 + 2 = 13. A natural 15 (total 20) beats AC 13.
    const built = table(["quarterstaff", "longbow", "rapier"], ["quarterstaff"]);
    const hit = swing(built, "item-quarterstaff", [15, 3]);
    expect(hit.attack?.outcome).toBe("hit");
    // A REAL prompt in the tracker, not a warning: the ability, the DC, and the condition a failure
    // imposes are all on it, and it carries no damage (Topple deals none).
    expect(built.state.combat.pendingSaves).toMatchObject([{
      targetActorId: IDS.foe, ability: "con", dc: 13, conditionId: "prone",
      proposedDamage: 0, halfOnSuccess: false, actionName: "Topple", sourceName: "Borin"
    }]);
    // The roll card says so too, naming the DC the GM is about to read out.
    expect(hit.warnings).toContain("Topple: Foe must make a DC 13 CON save or have the Prone condition - the prompt is in the turn order.");

    // THE FAR END. The foe rolls its own Constitution save (CON 14 -> +2) and 5 + 2 = 7 is under 13.
    const outcome = answer(built, [5]).outcome;
    expect(outcome).toMatchObject({ success: false, total: 7, dc: 13, conditionApplied: true });
    expect(built.foe.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(built.state.combat.pendingSaves).toEqual([]);
  });

  it("leaves the foe standing when it makes the save - the condition is the die's, not the hit's", () => {
    const built = table(["quarterstaff", "longbow", "rapier"], ["quarterstaff"]);
    swing(built, "item-quarterstaff", [15, 3]);
    // 17 + 2 = 19 >= 13.
    const outcome = answer(built, [17]).outcome;
    expect(outcome).toMatchObject({ success: true, total: 19, conditionApplied: false });
    expect(built.foe.conditions).toEqual([]);
  });

  it("owes a save for EVERY hit - Extra Attack's two swings do not collapse into one prompt", () => {
    // Level 5, so ONE Attack action is two swings and Str 19 (+4) with proficiency 3 sets DC 15.
    // The SRD puts no once-per-turn limit on Topple (contrast Nick's explicit one), so two hits owe
    // two saves - and the prompt's dedupe key is (target, actionName, source), identical for both.
    const built = table(["quarterstaff", "longbow", "rapier", "flail"], ["quarterstaff"], GEOMETRY, 5);
    const staff = effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === "item-quarterstaff")!;
    expect(staff.attack?.count).toBe(2);
    const first = swing(built, "item-quarterstaff", [15, 3]);
    const second = swing(built, "item-quarterstaff", [15, 3]);
    expect([first.attack?.outcome, second.attack?.outcome]).toEqual(["hit", "hit"]);
    expect(second.warnings).toContain("Topple: Foe must make a DC 15 CON save or have the Prone condition - the prompt is in the turn order.");
    // TWO rows in the tracker, both live: the second hit parks BESIDE the first instead of evicting it.
    expect(built.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.foe, ability: "con", dc: 15, conditionId: "prone", actionName: "Topple" },
      { targetActorId: IDS.foe, ability: "con", dc: 15, conditionId: "prone", actionName: "Topple" }
    ]);

    // THE FAR END, and it takes both dice to reach: the foe MAKES the first save (17 + 2 = 19) and is
    // still standing, then fails the second (3 + 2 = 5 < 15) and ends on the floor. With one prompt
    // swallowed, that first success was the whole answer and the foe walked away.
    expect(answer(built, [17]).outcome).toMatchObject({ success: true, total: 19, conditionApplied: false });
    expect(built.foe.conditions).toEqual([]);
    expect(answer(built, [3]).outcome).toMatchObject({ success: false, total: 5, dc: 15, conditionApplied: true });
    expect(built.foe.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(built.state.combat.pendingSaves).toEqual([]);
  });

  it("forces nothing when the Fighter did not pick the quarterstaff - same weapon, same swing", () => {
    // The negative control: the staff is still in his hands, the mastery is still on the record, and
    // the only difference is the three picks.
    const built = table(["longbow", "rapier", "greatsword"], ["quarterstaff"]);
    const hit = swing(built, "item-quarterstaff", [15, 3]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(built.state.combat.pendingSaves).toEqual([]);
    expect(hit.warnings).toBeUndefined();
  });

  it("forces nothing on a MISS - Topple is an on-hit rider", () => {
    const built = table(["quarterstaff", "longbow", "rapier"], ["quarterstaff"]);
    const miss = swing(built, "item-quarterstaff", [2]);
    expect(miss.attack?.outcome).toBe("miss");
    expect(built.state.combat.pendingSaves).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// PUSH - the one that ends at a token somewhere else on the map.
// -------------------------------------------------------------------------------------------------

/**
 * A calibrated battlemap: 50 px cells worth 5 ft each, so 10 feet is exactly two cells and every
 * number below can be read off the grid by hand. Odd footprints snap to cell CENTRES, which is why
 * every position here is an odd multiple of 25.
 */
const GRID = {
  width: 900, height: 600,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
} as const satisfies TokenMapGeometry;

/** Cell (column, row) → its centre in image pixels, so the fixtures read as squares rather than pixels. */
const cell = (column: number, row: number) => ({ x: (column + 0.5) * 50, y: (row + 0.5) * 50 });

function battlefield(masteries: readonly string[], extraWeaponIds: readonly string[], hero: { x: number; y: number }, foe: { x: number; y: number }, level: 3 | 5 = 3): Built {
  const built = table(masteries, extraWeaponIds, GRID, level);
  moveEncounterToken(built.state, IDS.hero, hero, GRID);
  moveEncounterToken(built.state, IDS.foe, foe, GRID);
  return built;
}
const positionOf = (built: Built, actorId: string) => built.state.combat.tokens.find((token) => token.actorId === actorId)!.position;

/**
 * The same swing, plus the geometry callback. The one line inside `wired` is verbatim what
 * `game-operations.ts` hands the resolver - the operation's only extra work is fetching the map -
 * so passing `wired: false` is exactly the shape `reactions.ts` resolves with today.
 */
const pushSwing = (built: Built, actionId: string, faces: number[], wired = true, geometry: TokenMapGeometry = GRID) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === actionId)!,
    { actorId: IDS.hero, targetIds: [IDS.foe], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    { ...deps(built, built.definition, faces), ...(wired ? { pushToken: (input) => pushTokenAway(built.state, input, geometry) } : {}) }
  );

/**
 * The OTHER map a table plays on: no grid at all, just a saved image scale (`map-catalog.ts`
 * `saveScale` stores exactly this, with `calibration` still null). 5 ft every 12 px, so 10 feet is 24
 * px - and unlike the lattice above, nothing rounds the landing point back onto a nice number, which
 * is what makes it the branch where an inverted ratio would hide.
 */
const SCALED = {
  width: 900, height: 600, calibration: null,
  scale: { kind: "image-scale", distancePerPixel: 5 / 12, unit: "ft" }
} as const satisfies TokenMapGeometry;

describe("Push moves the target's token 10 feet straight away", () => {
  it("shoves the foe two cells down the row, and the table's own measure reads 10 ft", () => {
    // Borin at cell (2,2), the foe adjacent at (3,2). Str 17 (+3) + proficiency 2 = +5 to hit vs AC 13.
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(2, 2), cell(3, 2));
    const before = positionOf(built, IDS.foe)!;
    expect(before).toEqual({ x: 175, y: 125 });
    const reachBefore = tokenCreatureDistance(built.state, GRID, IDS.hero, IDS.foe);

    const hit = pushSwing(built, "item-warhammer", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");

    // THE FAR END: a different position, two whole cells further along the line away from Borin.
    const after = positionOf(built, IDS.foe)!;
    expect(after).toEqual({ x: 275, y: 125 });
    expect(mapDistance(GRID, before, after)).toEqual({ value: 10, unit: "ft" });
    // AWAY, not toward: Borin is at x=125, and the gap between the two creatures grew by the push.
    expect(after.x).toBeGreaterThan(before.x);
    expect(reachBefore).toEqual({ value: 5, unit: "ft" });
    expect(tokenCreatureDistance(built.state, GRID, IDS.hero, IDS.foe)).toEqual({ value: 15, unit: "ft" });
    expect(hit.warnings).toContain("Foe is pushed 10 ft straight away from Borin.");
  });

  it("SNAPS the landing square when the line between the two is not a clean one", () => {
    // A heavy crossbow at range, three cells across and one down. Two cells of push along that line
    // lands 2 columns over and 2/3 of a row down - a point that is NOT a cell centre - so the snap is
    // doing visible work here rather than agreeing with arithmetic that already landed on the lattice.
    // Dex 13 (+1) + proficiency 2 = +3 to hit; a natural 15 is 18 vs AC 13.
    const built = battlefield(["heavy-crossbow", "longbow", "rapier"], ["heavy-crossbow"], cell(2, 2), cell(5, 3));
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-heavy-crossbow", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");

    const after = positionOf(built, IDS.foe)!;
    // Raw destination was y = 208.33; the grid put it on the cell centre at 225.
    expect(after).toEqual({ x: 375, y: 225 });
    expect(after).toEqual(cell(7, 4));
    // And the snap did not cost the push its distance: still exactly 10 ft by the table's measure.
    expect(mapDistance(GRID, before, after)).toEqual({ value: 10, unit: "ft" });
    expect(hit.warnings).toContain("Foe is pushed 10 ft straight away from Borin.");
  });

  it("measures the same 10 feet in PIXELS on a gridless map with a saved scale", () => {
    // The scaled branch is the whole geometry an uncalibrated battlemap has: feet become pixels
    // through `distancePerPixel` rather than cells, and there is no snap to a lattice to hide an
    // inverted ratio behind. Nothing else in the repo drives it.
    const built = table(["warhammer", "longbow", "rapier"], ["warhammer"], SCALED);
    moveEncounterToken(built.state, IDS.hero, { x: 300, y: 300 }, SCALED);
    moveEncounterToken(built.state, IDS.foe, { x: 330, y: 300 }, SCALED);
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-warhammer", [15, 4], true, SCALED);
    expect(hit.attack?.outcome).toBe("hit");

    // THE FAR END: 24 px further along the line, which is what 10 ft costs at 5 ft per 12 px.
    expect(positionOf(built, IDS.foe)).toEqual({ x: 354, y: 300 });
    expect(mapDistance(SCALED, before, positionOf(built, IDS.foe)!)).toEqual({ value: 10, unit: "ft" });
    expect(hit.warnings).toContain("Foe is pushed 10 ft straight away from Borin.");
  });

  it("moves nothing when the Fighter did not pick the warhammer - same weapon, same hit", () => {
    const built = battlefield(["longbow", "rapier", "greatsword"], ["warhammer"], cell(2, 2), cell(3, 2));
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-warhammer", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(positionOf(built, IDS.foe)).toEqual(before);
    expect(hit.warnings).toBeUndefined();
  });

  it("moves nothing on a MISS - Push is an on-hit rider", () => {
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(2, 2), cell(3, 2));
    const before = positionOf(built, IDS.foe)!;
    const miss = pushSwing(built, "item-warhammer", [2]);
    expect(miss.attack?.outcome).toBe("miss");
    expect(positionOf(built, IDS.foe)).toEqual(before);
  });

  it("leaves a Huge creature where it stands and says why (SRD: Large or smaller)", () => {
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(2, 2), cell(3, 2));
    setActorSize(built.state, IDS.foe, "huge", GRID);
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-warhammer", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(positionOf(built, IDS.foe)).toEqual(before);
    expect(hit.warnings).toContain("Foe is bigger than Large and can't be pushed.");
  });

  it("degrades to a sentence when the map cannot measure 10 feet - never a refusal", () => {
    // An uncalibrated, unscaled map has no feet at all. The swing still lands, the damage still
    // stands, and the GM is told to move the token - the builtin Shove's own shape.
    const built = table(["warhammer", "longbow", "rapier"], ["warhammer"]);
    moveEncounterToken(built.state, IDS.hero, { x: 125, y: 125 }, GEOMETRY);
    moveEncounterToken(built.state, IDS.foe, { x: 175, y: 125 }, GEOMETRY);
    const before = positionOf(built, IDS.foe)!;
    const hit = resolveDefinitionAction(
      built.state,
      effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === "item-warhammer")!,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
      { ...deps(built, built.definition, [15, 4]), pushToken: (input) => pushTokenAway(built.state, input, GEOMETRY) }
    );
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.damageTotal).toBe(7);
    expect(positionOf(built, IDS.foe)).toEqual(before);
    expect(hit.warnings).toContain("Foe is pushed 10 feet straight away from Borin - move the token.");
  });

  it("degrades the same way for a combatant still in the tray, instead of throwing", () => {
    // `moveEncounterToken` REJECTS a token it cannot find, and an unplaced token has no direction to
    // be pushed along; both are checked before it is called, so an unplaced foe costs a sentence.
    const built = table(["warhammer", "longbow", "rapier"], ["warhammer"], GRID);
    expect(positionOf(built, IDS.foe)).toBeNull();
    const hit = pushSwing(built, "item-warhammer", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(positionOf(built, IDS.foe)).toBeNull();
    expect(hit.warnings).toContain("Foe is pushed 10 feet straight away from Borin - move the token.");
  });

  it("says the map REFUSED the shove when it measures zero, not 'move the token'", () => {
    // Pinned at the last column of a 900 px map: the destination is off the edge, `bounded` clamps it,
    // and the snap finds no other fitting square - so the map ANSWERED, with nothing. "Move the token
    // 10 feet" would send the GM somewhere the same bounds check has already refused.
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(16, 2), cell(17, 2));
    const before = positionOf(built, IDS.foe)!;
    expect(before).toEqual({ x: 875, y: 125 });
    const hit = pushSwing(built, "item-warhammer", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.damageTotal).toBe(7);

    expect(positionOf(built, IDS.foe)).toEqual(before);
    expect(hit.warnings).toContain("Foe is pushed straight away from Borin, but the map has nowhere to put it - the token stays where it is.");
    expect(hit.warnings).not.toContain("Foe is pushed 10 feet straight away from Borin - move the token.");
  });

  it("degrades when the resolver has no geometry callback at all - the reaction path today", () => {
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(2, 2), cell(3, 2));
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-warhammer", [15, 4], false);
    expect(hit.attack?.outcome).toBe("hit");
    expect(positionOf(built, IDS.foe)).toEqual(before);
    expect(hit.warnings).toContain("Foe is pushed 10 feet straight away from Borin - move the token.");
  });
});

// -------------------------------------------------------------------------------------------------
// SLOW - the one whose far end is on the FOE'S OWN TURN, ten feet later.
//
// It sits below Push rather than beside Sap because it needs the same calibrated battlemap: the
// budget it shrinks is measured in feet off the grid, so `GRID`, `cell` and `battlefield` all have to
// be in scope for the numbers here to be countable in squares.
// -------------------------------------------------------------------------------------------------

let slowPrompt = 0;

/**
 * The foe's own move, `cells` squares straight along its row - measured with `mapDistance` over the
 * live geometry and policed by `applyMovementRules`, which is verbatim what the `token.move` mutation
 * does (`game-operations.ts`). The refusal it throws is the sentence the player reads, so that string
 * is the far end and not a stand-in for one.
 */
const foeMoves = (built: Built, cells: number) => {
  const from = positionOf(built, IDS.foe)!;
  return applyMovementRules(built.state, {
    actorId: IDS.foe, from, to: { x: from.x + cells * 50, y: from.y }, override: null,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    resolveDefinition: (definitionId: string) => built.state.definitions.find((entry) => entry.id === definitionId)?.definition,
    newPromptId: () => `70000000-0000-4000-8000-${String(++slowPrompt).padStart(12, "0")}`,
    now: () => 0, commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`
  });
};

describe("Slow takes 10 feet off the target's Speed until the attacker's next turn", () => {
  it("shrinks the foe's OWN movement budget by 10 ft, and the attacker's next turn gives them back", () => {
    // The javelin is a Slow weapon straight out of `fighter-a`, so this needs no minted row at all.
    // Str 17 (+3) + proficiency 2 = +5 to hit; a natural 15 is 20 against AC 13.
    const built = battlefield(["javelin", "longbow", "rapier"], [], cell(2, 2), cell(3, 2));
    const hit = swing(built, "item-javelin", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.effectsApplied).toEqual([{ targetId: IDS.foe, targetName: "Foe", name: "Slowed by Borin", conditionIds: [] }]);

    const slowed = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(slowed.effects.map((effect) => effect.name)).toEqual(["Slowed by Borin"]);
    expect(slowed.effects[0].modifiers).toEqual([{ type: "speed", amount: -10 }]);
    // Slow is not a CONDITION - nothing should render a status badge the creature does not have - and
    // the SHEET's Speed is untouched. An effect that ends has to give the feet back, so the 30 on the
    // stat block stays 30 while the creature moves like a 20.
    expect(slowed.conditions).toEqual([]);
    expect(slowed.speedFeet).toBe(30);

    // THE FAR END, on the foe's own turn: 25 ft sat inside a 30 ft Speed and is now refused BY NAME.
    nextInitiativeTurn(built.state);
    expect(built.state.combat.turnActorId).toBe(IDS.foe);
    try {
      foeMoves(built, 5);
      expect.unreachable();
    } catch (error) {
      // A refusal, not a rules note: strict mode throws and the whole draft is discarded.
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("movement.exceeds-speed");
      expect((error as RulesBlockedError).message).toBe("Foe has 20 ft of movement left (this move needs 25 ft).");
    }
    // ...and 20 ft still walks, so this is a smaller budget rather than a broken one.
    expect(foeMoves(built, 4).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(20);

    // The ATTACKER's next turn begins and the effect ends there - `until-source-next-turn` is what the
    // printed "until the start of your next turn" means, and nothing else hands the feet back.
    nextInitiativeTurn(built.state);
    expect(built.state.combat.turnActorId).toBe(IDS.hero);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(25);
  });

  it("leaves the foe its whole 30 ft when the Fighter did not pick the javelin - same weapon, same hit", () => {
    // The negative control, and the only difference between the two sheets is the three picks. Graze
    // is on the greatsword he is not swinging, so nothing else can account for the feet.
    const built = battlefield(["greatsword", "longbow", "rapier"], [], cell(2, 2), cell(3, 2));
    const hit = swing(built, "item-javelin", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.effectsApplied).toBeUndefined();
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);

    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(25);
  });

  it("applies nothing on a MISS - Slow is an on-hit rider", () => {
    const built = battlefield(["javelin", "longbow", "rapier"], [], cell(2, 2), cell(3, 2));
    const miss = swing(built, "item-javelin", [2]);
    expect(miss.attack?.outcome).toBe("miss");
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);

    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
  });

  it("REFRESHES on a second hit of the same weapon - Extra Attack costs 10 feet, not 20", () => {
    // Level 5: one Attack action is two swings, so this is a real turn rather than a contrivance.
    // Both hits carry `sourceActionId: "item-javelin:slow"`, and `addEffect` replaces a grant from the
    // same source actor + source action in place - the refresh a re-declared Rage gets. Sap's key
    // shape is what buys that; nothing here caps anything.
    const built = battlefield(["javelin", "longbow", "rapier", "flail"], [], cell(2, 2), cell(3, 2), 5);
    // Str 19 (+4) + proficiency 3 = +7 to hit at this level; a natural 15 is 22 against AC 13.
    expect(effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === "item-javelin")!.attack?.count).toBe(2);
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    const slowed = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(slowed.effects.map((effect) => effect.name)).toEqual(["Slowed by Borin"]);

    // THE FAR END, and it is the number that tells the two readings apart: 30 − 10 = 20. A second
    // −10 would print 10 here, so this assertion is what would catch the stack if the key ever moved.
    nextInitiativeTurn(built.state);
    expect(() => foeMoves(built, 5)).toThrow("Foe has 20 ft of movement left (this move needs 25 ft).");
    nextInitiativeTurn(built.state);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
  });

  it("sums two -10s from two different sources, and the floor at 0 is the only cap", () => {
    // The other half of the key, and the reason it is per source rather than per target: a javelin and
    // a club are two different weapon actions, so their effects do NOT refresh each other and the foe
    // carries both. Level 5 again, because Extra Attack is what lets one turn hold two swings - and
    // the SRD lets the second one be a different weapon, which is the whole case. Two separate
    // ATTACKERS work the same way through `sourceActorId` - proven on hand-built effects, each
    // expiring with its own source's turn, in `combat-rules-regression.test.ts`. This is also the
    // approximation the handler's docblock names out loud: two hits of ONE weapon take 10 feet and
    // two hits of two weapons take 20.
    const built = battlefield(["javelin", "club", "rapier", "flail"], ["club"], cell(2, 2), cell(3, 2), 5);
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    expect(swing(built, "item-club", [15, 4]).attack?.outcome).toBe("hit");
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects.map((effect) => effect.sourceActionId))
      .toEqual(["item-javelin:slow", "item-club:slow"]);

    // THE FAR END: 30 − 10 − 10 = 10 ft, read off the refusal the foe's player is shown.
    nextInitiativeTurn(built.state);
    expect(() => foeMoves(built, 5)).toThrow("Foe has 10 ft of movement left (this move needs 25 ft).");
    // Both are sustained by the same attacker's turn, so both end together and the whole 30 returns.
    nextInitiativeTurn(built.state);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 6).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(30);
  });
});

// -------------------------------------------------------------------------------------------------
// THE OFF-TURN SWING - where a mastery's named absence has to be SPOKEN, not merely produced.
// -------------------------------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

type FeedLine = Readonly<{ kind: string; text: string; gmOnly?: boolean }>;

/**
 * The OPERATION layer, because "the resolution carries the sentence" is not narration - a rules note
 * is only real once something receives one. Everything that is not the feed is a stub, and the two
 * capture arrays ARE the far end: `logged` is the durable table feed, `broadcast` the transient toast.
 */
async function operationsFor(built: Built, duringGeometryFetch?: (live: GameStore) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-mastery-reaction-"));
  const store = new GameStore(join(directory, "game.sqlite"), built.state);
  await store.initialize();
  cleanups.push(async () => { await rm(directory, { recursive: true, force: true }); });
  const logged: FeedLine[] = [];
  const broadcast: FeedLine[] = [];
  const unused = () => { throw new Error("answering a reaction must not touch this"); };
  const operations = createGameOperations({
    store, contentLibrary: new ContentLibrary(),
    combatLog: { append: () => {} },
    mapCatalog: { get: () => undefined },
    tokenCatalog: { get: () => undefined, touchLastUsed: () => {}, rememberForDefinition: () => {} },
    // The real one is a file read, and `actionResolve` awaits it OUTSIDE the command queue - so the
    // hook is where a test can commit another command in the window that await opens.
    tokenGeometryFor: async () => { if (duringGeometryFetch) await duringGeometryFetch(store); return GRID; },
    publishGameState: async () => {},
    presentSceneMap: async () => {},
    broadcastTableEvent: (event: FeedLine) => { broadcast.push({ kind: event.kind, text: event.text, gmOnly: event.gmOnly }); },
    appendLog: (entry: FeedLine) => { logged.push({ kind: entry.kind, text: entry.text, gmOnly: entry.gmOnly }); },
    logTurnBegin: () => {}, logTimelineOutcome: () => {}, scheduleAnnotationExpiry: () => {},
    gmView: unused, playerView: unused,
    // Every die the swing still rolls after `attackNatural` pins the d20 - the pike's damage.
    random: () => 4,
    newId: () => randomUUID()
  } as unknown as GameOperationsContext);
  return { operations, store, logged, broadcast };
}

/** A `leaves-reach` prompt shaped exactly as `movement-rules.ts` mints one: Borin's pike, the foe walking out. */
function parkOpportunityAttack(built: Built): string {
  const id = "60000000-0000-4000-8000-000000000001";
  built.state.combat = {
    ...built.state.combat,
    pendingReactions: [...built.state.combat.pendingReactions, {
      id, kind: "leaves-reach" as const, actorId: IDS.hero, actionId: "opportunity-attack", actionName: "Opportunity Attack",
      sourceActorId: IDS.foe, sourceName: "Foe", targetActorId: IDS.foe,
      triggerCommandId: "50000000-0000-4000-8000-0000000000ff",
      proposedDamage: 0, proposedDamageParts: [], critical: false, createdAt: 0
    }]
  };
  return id;
}

describe("a mastery that cannot act off-turn says so where the GM reads it", () => {
  it("puts Push's 'move the token' sentence in the feed when a pike hits on an opportunity attack", async () => {
    // The pike is the reach weapon of the four that carry Push, so it is the one most often swung
    // off-turn - and `reactions.ts` resolves with NO geometry callback by design, so the whole of what
    // Push does here is the sentence. Dropping it made a named absence a silent skip.
    const built = battlefield(["pike", "longbow", "rapier"], ["pike"], cell(2, 2), cell(3, 2));
    const reactionId = parkOpportunityAttack(built);
    const { operations, store, logged, broadcast } = await operationsFor(built);
    const before = store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position;

    // +5 to hit vs AC 13, so a pinned natural 18 lands without the die queue this file's unit tests use.
    await operations.reactionAnswer({ kind: "gm", sessionId: IDS.gmSession }, {
      commandId: randomUUID(), reactionId, use: true, actionId: "item-pike", commit: true, attackNatural: 18
    });

    // THE FAR END: a row in the feed, GM-only, naming the push the engine could not perform.
    expect(logged).toContainEqual({
      kind: "action", gmOnly: true,
      text: "Rules note: Foe is pushed 10 feet straight away from Borin - move the token."
    });
    // ...and the swing itself is untouched: it still hit, still narrated, and the token really did NOT
    // move, which is what makes the sentence an instruction rather than a report.
    expect(broadcast.some((line) => line.kind === "reaction" && line.text.includes("made an opportunity attack against Foe - HIT"))).toBe(true);
    expect(store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position).toEqual(before);
  });

  it("does not shove a token onto the map the fight just left", async () => {
    // `actionResolve` reads the grid BEFORE its mutation opens, so a scene switch committing in that
    // window would snap and bound-clamp against the departed map and then narrate that distance as
    // the truth. Forced movement never rejects, so the stale map degrades to the same sentence an
    // unmeasurable one gets - the swing that already hit stands.
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(2, 2), cell(3, 2));
    const { operations, store, logged } = await operationsFor(built, async (live) => {
      await live.execute({ id: randomUUID(), type: "test.scene-switch" }, (state) => {
        state.combat = { ...state.combat, mapAssetId: "20000000-0000-5000-8000-000000000002" };
      });
    });
    const before = store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position;

    await operations.actionResolve({ kind: "gm", sessionId: IDS.gmSession }, {
      commandId: randomUUID(), actorId: IDS.hero, actionId: "item-warhammer", targetIds: [IDS.foe], attackNatural: 18
    });

    // THE FAR END: the foe stands exactly where it stood, and the GM is told to place it by hand.
    expect(store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position).toEqual(before);
    expect(logged).toContainEqual({
      kind: "action", gmOnly: true,
      text: "Rules note: Foe is pushed 10 feet straight away from Borin - move the token."
    });
  });

  it("shoves for real down the same path when the map did NOT change - the control for the guard above", async () => {
    const built = battlefield(["warhammer", "longbow", "rapier"], ["warhammer"], cell(2, 2), cell(3, 2));
    const { operations, store, logged } = await operationsFor(built);

    await operations.actionResolve({ kind: "gm", sessionId: IDS.gmSession }, {
      commandId: randomUUID(), actorId: IDS.hero, actionId: "item-warhammer", targetIds: [IDS.foe], attackNatural: 18
    });

    expect(store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position).toEqual(cell(5, 2));
    expect(logged).toContainEqual({ kind: "action", gmOnly: true, text: "Rules note: Foe is pushed 10 ft straight away from Borin." });
  });

  it("says nothing on a PREVIEW - the sentence lands once, on the answer that spends the reaction", async () => {
    const built = battlefield(["pike", "longbow", "rapier"], ["pike"], cell(2, 2), cell(3, 2));
    const reactionId = parkOpportunityAttack(built);
    const { operations, logged } = await operationsFor(built);

    await operations.reactionAnswer({ kind: "gm", sessionId: IDS.gmSession }, {
      commandId: randomUUID(), reactionId, use: true, actionId: "item-pike", commit: false, attackNatural: 18
    });
    expect(logged.filter((line) => line.text.startsWith("Rules note:"))).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// The honesty gate.
// -------------------------------------------------------------------------------------------------

describe("the engine claims exactly the masteries it implements", () => {
  it("names five as built and three as not, so neither half can drift silently", () => {
    // This is the test that stops Stage 5 from LOOKING finished. `masteryReaches` is the single
    // registry the derivation consults, and these are its two halves stated out loud. Implementing
    // Cleave means changing this list in the same commit as the behaviour and its far-end proof - and
    // adding a slug here without one turns every test above this line into a liar.
    const built = ["graze", "push", "sap", "slow", "topple"];
    const notYet = ["cleave", "nick", "vex"];
    expect(built.filter(masteryReaches)).toEqual(built);
    expect(notYet.filter(masteryReaches)).toEqual([]);
    // ...and the two halves really are the whole SRD set, so nothing can be quietly forgotten.
    expect([...built, ...notYet].sort()).toEqual([...new Set(loadWeapons().map((weapon) => weapon.mastery))].sort());
  });
});

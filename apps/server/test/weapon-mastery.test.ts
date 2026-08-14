import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { loadWeapons } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf, masteryReaches } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";
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
 * actually rolls twice and keeps the worse of, a condition the foe's own save put on it, and a token
 * standing two squares further away than it did.
 *
 * FOUR of the eight are implemented (graze, push, sap, topple). The other four are deliberately inert
 * and the derivation REFUSES TO ADVERTISE THEM (`masteryReaches`), which is the difference between
 * "not built yet" and "built and silently doing nothing". The last test in this file is the one that
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

function table(masteries: readonly string[], extraWeaponIds: readonly string[] = [], geometry: TokenMapGeometry = GEOMETRY): Built {
  const built = buildCharacterDefinition(fighter(masteries) as CharacterCreateRequestInput, view, POLICY);
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
    // The longbow's mastery is Slow, the rapier's is Vex and the club's is Slow again - NONE of them
    // is built. (The maul that used to stand here was Topple, which now is, so keeping it would have
    // made this a test about an unequipped weapon rather than an unimplemented mastery.) Each pick is
    // legal and the sheet records it; the derivation simply does not claim a working mastery.
    const built = table(["longbow", "rapier", "club"]);
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

function battlefield(masteries: readonly string[], extraWeaponIds: readonly string[], hero: { x: number; y: number }, foe: { x: number; y: number }): Built {
  const built = table(masteries, extraWeaponIds, GRID);
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
const pushSwing = (built: Built, actionId: string, faces: number[], wired = true) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === actionId)!,
    { actorId: IDS.hero, targetIds: [IDS.foe], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    { ...deps(built, built.definition, faces), ...(wired ? { pushToken: (input) => pushTokenAway(built.state, input, GRID) } : {}) }
  );

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
// The honesty gate.
// -------------------------------------------------------------------------------------------------

describe("the engine claims exactly the masteries it implements", () => {
  it("names four as built and four as not, so neither half can drift silently", () => {
    // This is the test that stops Stage 5 from LOOKING finished. `masteryReaches` is the single
    // registry the derivation consults, and these are its two halves stated out loud. Implementing
    // Cleave means changing this list in the same commit as the behaviour and its far-end proof - and
    // adding a slug here without one turns every test above this line into a liar.
    const built = ["graze", "push", "sap", "topple"];
    const notYet = ["cleave", "nick", "slow", "vex"];
    expect(built.filter(masteryReaches)).toEqual(built);
    expect(notYet.filter(masteryReaches)).toEqual([]);
    // ...and the two halves really are the whole SRD set, so nothing can be quietly forgotten.
    expect([...built, ...notYet].sort()).toEqual([...new Set(loadWeapons().map((weapon) => weapon.mastery))].sort());
  });
});

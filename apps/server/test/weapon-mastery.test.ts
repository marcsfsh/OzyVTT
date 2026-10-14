import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type CombatLogEntry, type GameState, type MutationResult } from "@vtt/domain";
import { loadWeapons } from "@vtt/content-srd-5.2.1";
import { EffectInstanceSchema, InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, equipmentCatalogOf, masteryReaches } from "../src/equipment-derivation.js";
import { createGameOperations, type GameOperationsContext } from "../src/game-operations.js";
import { GameStore, RulesBlockedError } from "../src/game-store.js";
import { addCombatant, nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { MapAssetStore } from "../src/map-assets.js";
import { createServer } from "../src/server.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { addEffect } from "../src/effects.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { pushTokenAway } from "../src/forced-movement.js";
import { mapDistance, tokenCreatureDistance } from "../src/movement-narration.js";
import { moveEncounterToken, setActorSize, type TokenMapGeometry } from "../src/token-placement.js";

// Weapon Mastery, proved where a player sees it: damage on a miss, a foe's die rolled twice keeping the
// worse, a condition from the foe's own save, a pushed token, a smaller Speed on the foe's turn. Five
// masteries are implemented; the derivation does not advertise the other three (`masteryReaches`).

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

// A level-3 Halfling Champion whose three mastery picks are each test's parameter (Str 17, proficiency 2).
// At level 5 Extra Attack gives two swings, Str is 19 and proficiency 3, so a mastery DC moves to 15.
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

/** A foe that can swing back, so Sap is proved on the die the target rolls. */
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

// Starting kits reach only Graze, Sap, Slow and Vex, so Topple and Push need a weapon row minted as
// `consumeEquipmentOption` mints one (`weaponAction` reads mechanics off the inventory row).
function weaponRow(weaponId: string): InventoryItem {
  const record = catalog.equipmentRecord(weaponId);
  if (!record?.weapon) throw new Error(`${weaponId} is not a catalog weapon`);
  // Parsed rather than cast, so a row that drifted from the bundle's shape fails here.
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
// Minted file-wide, as the real `context.newId` is, so two swings of the same weapon get distinct
// pending-save ids.
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

/** The foe swings back at the hero, which is where Sap has to show up. */
const swingBack = (built: Built, faces: number[]) =>
  resolveDefinitionAction(
    built.state,
    FOE_DEFINITION.actions.find((action) => action.id === "claw")!,
    { actorId: IDS.foe, targetIds: [IDS.hero], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    deps(built, FOE_DEFINITION, faces)
  );

describe("every SRD weapon names its mastery", () => {
  it("covers all 38 rows with the eight printed properties, and spot-checks the table", () => {
    const weapons = loadWeapons();
    expect(weapons).toHaveLength(38);
    expect(weapons.filter((weapon) => weapon.mastery === undefined)).toEqual([]);
    expect([...new Set(weapons.map((weapon) => weapon.mastery))].sort())
      .toEqual(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]);
    // Spot-checks off the printed table, one per property, so a wholesale mis-mapping cannot pass.
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

// The gate: a mastery needs both the weapon's property and the character's pick.

describe("a mastery reaches a swing only when the character unlocked THAT weapon", () => {
  it("arms the greatsword for a Fighter who picked it, and leaves the flail alone", () => {
    const picked = deriveEquipment(table(["greatsword", "longbow", "rapier"]).hero, table(["greatsword", "longbow", "rapier"]).definition, catalog);
    expect(picked.masteryByActionId["item-greatsword"]).toEqual({ id: "graze", abilityModifier: 3 });
    // The flail is equipped and has a mastery (sap), but it is not one of this Fighter's three.
    expect(picked.masteryByActionId["item-flail"]).toBeUndefined();
  });

  it("arms the flail instead when that is what was picked - same sheet, different three", () => {
    const built = table(["flail", "longbow", "rapier"]);
    const derivation = deriveEquipment(built.hero, built.definition, catalog);
    expect(derivation.masteryByActionId["item-flail"]).toEqual({ id: "sap", abilityModifier: 3 });
    expect(derivation.masteryByActionId["item-greatsword"]).toBeUndefined();
  });

  it("omits a mastery the engine does not implement, rather than advertising a no-op", () => {
    // The shortbow is held, legally picked and recorded; only the unimplemented Vex leaves it unarmed. The
    // greataxe and scimitar are unheld picks, showing picks are unrestricted.
    const built = table(["shortbow", "greataxe", "scimitar"]);
    expect(effectiveActions(built.definition, built.hero, catalog).some((action) => action.id === "item-shortbow")).toBe(true);
    const derivation = deriveEquipment(built.hero, built.definition, catalog);
    expect(derivation.masteryByActionId).toEqual({});
  });
});

// Graze: fires on a miss.

describe("Graze deals the ability modifier on a miss", () => {
  it("turns a whiffed greatsword into 3 damage, and says where it came from", () => {
    // Str 17 (+3), proficiency 2 -> +5 to hit. The foe's AC is 13, so a natural 4 (total 9) misses.
    const built = table(["greatsword", "longbow", "rapier"]);
    const miss = swing(built, "item-greatsword", [4]);
    expect(miss.attack?.outcome).toBe("miss");
    // A real number on the roll card, typed as the weapon types, and attributed.
    expect(miss.bonusDamage).toEqual([{ amount: 3, type: "slashing", source: "Graze" }]);
    // The rolled total, which the roll card shows and the GM then applies (damage application is its own
    // confirm step).
    expect(miss.damageTotal).toBe(3);
  });

  it("adds NOTHING on a miss when the Fighter did not pick the greatsword", () => {
    // Negative control: the only difference between the two sheets is the three picks.
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

// Sap: changes a die the other side rolls.

describe("Sap makes the target's next attack roll worse", () => {
  it("puts a real effect on the foe, and the foe then rolls 2d20 and keeps the LOWER", () => {
    const built = table(["flail", "longbow", "rapier"]);
    const hit = swing(built, "item-flail", [15, 5]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.effectsApplied).toEqual([{ targetId: IDS.foe, targetName: "Foe", name: "Sapped by Borin", conditionIds: [] }]);
    // On the actor, not just in the response: this is what survives to the foe's turn.
    const sapped = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(sapped.effects.map((effect) => effect.name)).toEqual(["Sapped by Borin"]);
    expect(sapped.conditions).toEqual([]);

    // The foe swings back and the engine rolls two dice and keeps the worse one.
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

// Topple: ends on a condition the foe's own die decided.

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
    // A real prompt in the tracker: the ability, the DC and the condition a failure imposes are on it,
    // and it carries no damage (Topple deals none).
    expect(built.state.combat.pendingSaves).toMatchObject([{
      targetActorId: IDS.foe, ability: "con", dc: 13, conditionId: "prone",
      proposedDamage: 0, halfOnSuccess: false, actionName: "Topple", sourceName: "Borin"
    }]);
    // Two sentences, split by what may cross: the GM's keeps the DC; the table's names what forced the
    // save and carries no number, because the DC is the attacker's.
    expect(hit.warnings).toContain("Topple: Foe's save is DC 13 - the prompt is in the turn order.");
    expect(hit.tableNarration).toEqual([{ kind: "save", text: "Borin's Topple forces Foe to make a CON save or have the Prone condition.", actorIds: [IDS.hero, IDS.foe] }]);
    expect(JSON.stringify(hit.tableNarration)).not.toContain("13");

    // The foe rolls its own Constitution save (CON 14 -> +2) and 5 + 2 = 7 is under 13.
    const outcome = answer(built, [5]).outcome;
    expect(outcome).toMatchObject({ success: false, total: 7, dc: 13, conditionApplied: true });
    expect(built.foe.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(built.state.combat.pendingSaves).toEqual([]);
  });

  it("leaves the foe standing when it makes the save - the condition is the die's, not the hit's", () => {
    const built = table(["quarterstaff", "longbow", "rapier"], ["quarterstaff"]);
    swing(built, "item-quarterstaff", [15, 3]);
    const outcome = answer(built, [17]).outcome;
    expect(outcome).toMatchObject({ success: true, total: 19, conditionApplied: false });
    expect(built.foe.conditions).toEqual([]);
  });

  it("owes a save for EVERY hit - Extra Attack's two swings do not collapse into one prompt", () => {
    // Level 5: two swings, DC 15. The SRD puts no once-per-turn limit on Topple, so two hits owe two saves
    // even though both share the prompt's dedupe key.
    const built = table(["quarterstaff", "longbow", "rapier", "flail"], ["quarterstaff"], GEOMETRY, 5);
    const staff = effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === "item-quarterstaff")!;
    expect(staff.attack?.count).toBe(2);
    const first = swing(built, "item-quarterstaff", [15, 3]);
    const second = swing(built, "item-quarterstaff", [15, 3]);
    expect([first.attack?.outcome, second.attack?.outcome]).toEqual(["hit", "hit"]);
    expect(second.warnings).toContain("Topple: Foe's save is DC 15 - the prompt is in the turn order.");
    expect(second.tableNarration).toEqual([{ kind: "save", text: "Borin's Topple forces Foe to make a CON save or have the Prone condition.", actorIds: [IDS.hero, IDS.foe] }]);
    // Two live rows in the tracker: the second hit parks beside the first instead of evicting it.
    expect(built.state.combat.pendingSaves).toMatchObject([
      { targetActorId: IDS.foe, ability: "con", dc: 15, conditionId: "prone", actionName: "Topple" },
      { targetActorId: IDS.foe, ability: "con", dc: 15, conditionId: "prone", actionName: "Topple" }
    ]);

    // The foe makes the first save (17 + 2 = 19), then fails the second (3 + 2 = 5 < 15) and is knocked prone.
    expect(answer(built, [17]).outcome).toMatchObject({ success: true, total: 19, conditionApplied: false });
    expect(built.foe.conditions).toEqual([]);
    expect(answer(built, [3]).outcome).toMatchObject({ success: false, total: 5, dc: 15, conditionApplied: true });
    expect(built.foe.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(built.state.combat.pendingSaves).toEqual([]);
  });

  it("forces nothing when the Fighter did not pick the quarterstaff - same weapon, same swing", () => {
    // Negative control: the staff is in his hands and the mastery is on the record; only the picks differ.
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

// Push: ends at a token somewhere else on the map.

// A calibrated battlemap: 50 px cells worth 5 ft each, so 10 feet is two cells. Odd footprints snap to
// cell centres, so every position is an odd multiple of 25.
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

// The same swing plus the geometry callback. `wired` mirrors what `game-operations.ts` hands the
// resolver; `wired: false` is how `reactions.ts` resolves.
const pushSwing = (built: Built, actionId: string, faces: number[], wired = true, geometry: TokenMapGeometry = GRID) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === actionId)!,
    { actorId: IDS.hero, targetIds: [IDS.foe], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    { ...deps(built, built.definition, faces), ...(wired ? { pushToken: (input) => pushTokenAway(built.state, input, geometry) } : {}) }
  );

// A map with no grid, just a saved image scale (`saveScale` in `map-catalog.ts`, `calibration` null).
// 5 ft every 12 px, so 10 feet is 24 px; nothing rounds the landing point, so an inverted ratio shows.
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

    const after = positionOf(built, IDS.foe)!;
    expect(after).toEqual({ x: 275, y: 125 });
    expect(mapDistance(GRID, before, after)).toEqual({ value: 10, unit: "ft" });
    // Away, not toward: Borin is at x=125, and the gap grew by the push.
    expect(after.x).toBeGreaterThan(before.x);
    expect(reachBefore).toEqual({ value: 5, unit: "ft" });
    expect(tokenCreatureDistance(built.state, GRID, IDS.hero, IDS.foe)).toEqual({ value: 15, unit: "ft" });
    expect(hit.tableNarration).toEqual([{ kind: "movement", text: "Foe is pushed 10 ft straight away from Borin.", actorIds: [IDS.hero, IDS.foe] }]);
    expect(hit.warnings).toBeUndefined();
  });

  it("SNAPS the landing square when the line between the two is not a clean one", () => {
    // A heavy crossbow three cells across and one down: two cells of push lands off a cell centre, so the snap
    // does visible work. Dex 13 (+1) + proficiency 2 = +3 to hit; a natural 15 is 18 vs AC 13.
    const built = battlefield(["heavy-crossbow", "longbow", "rapier"], ["heavy-crossbow"], cell(2, 2), cell(5, 3));
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-heavy-crossbow", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");

    const after = positionOf(built, IDS.foe)!;
    // Raw destination was y = 208.33; the grid put it on the cell centre at 225.
    expect(after).toEqual({ x: 375, y: 225 });
    expect(after).toEqual(cell(7, 4));
    // The snap did not cost the push its distance: still exactly 10 ft by the table's measure.
    expect(mapDistance(GRID, before, after)).toEqual({ value: 10, unit: "ft" });
    expect(hit.tableNarration).toEqual([{ kind: "movement", text: "Foe is pushed 10 ft straight away from Borin.", actorIds: [IDS.hero, IDS.foe] }]);
    expect(hit.warnings).toBeUndefined();
  });

  it("measures the same 10 feet in PIXELS on a gridless map with a saved scale", () => {
    // An uncalibrated scaled map converts feet to pixels through `distancePerPixel` with no lattice snap.
    const built = table(["warhammer", "longbow", "rapier"], ["warhammer"], SCALED);
    moveEncounterToken(built.state, IDS.hero, { x: 300, y: 300 }, SCALED);
    moveEncounterToken(built.state, IDS.foe, { x: 330, y: 300 }, SCALED);
    const before = positionOf(built, IDS.foe)!;
    const hit = pushSwing(built, "item-warhammer", [15, 4], true, SCALED);
    expect(hit.attack?.outcome).toBe("hit");

    // 24 px further along the line, which is 10 ft at 5 ft per 12 px.
    expect(positionOf(built, IDS.foe)).toEqual({ x: 354, y: 300 });
    expect(mapDistance(SCALED, before, positionOf(built, IDS.foe)!)).toEqual({ value: 10, unit: "ft" });
    expect(hit.tableNarration).toEqual([{ kind: "movement", text: "Foe is pushed 10 ft straight away from Borin.", actorIds: [IDS.hero, IDS.foe] }]);
    expect(hit.warnings).toBeUndefined();
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
    // An uncalibrated, unscaled map has no feet. The swing lands, the damage stands, and the GM is told to
    // move the token, as the builtin Shove does.
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
    // `moveEncounterToken` rejects a token it cannot find, and an unplaced token has no direction, so both
    // are checked first and an unplaced foe costs only a sentence.
    const built = table(["warhammer", "longbow", "rapier"], ["warhammer"], GRID);
    expect(positionOf(built, IDS.foe)).toBeNull();
    const hit = pushSwing(built, "item-warhammer", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(positionOf(built, IDS.foe)).toBeNull();
    expect(hit.warnings).toContain("Foe is pushed 10 feet straight away from Borin - move the token.");
  });

  it("says the map REFUSED the shove when it measures zero, not 'move the token'", () => {
    // Pinned at the last column of a 900 px map: the destination is off the edge, `bounded` clamps it and
    // the snap finds no other fitting square, so nothing moves and no "move the token" instruction is given.
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

// Slow: the effect shows on the foe's own turn. It needs the calibrated battlemap above, since the
// budget it shrinks is measured in feet off the grid.

let slowPrompt = 0;

// The foe's own move, `cells` squares along its row, measured with `mapDistance` and policed by
// `applyMovementRules` as the `token.move` mutation does. The refusal is the sentence the player reads.
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
    // The javelin is a Slow weapon from `fighter-a`, so no minted row is needed. Str 17 (+3) +
    // proficiency 2 = +5 to hit; a natural 15 is 20 against AC 13.
    const built = battlefield(["javelin", "longbow", "rapier"], [], cell(2, 2), cell(3, 2));
    const hit = swing(built, "item-javelin", [15, 4]);
    expect(hit.attack?.outcome).toBe("hit");
    expect(hit.effectsApplied).toEqual([{ targetId: IDS.foe, targetName: "Foe", name: "Slowed by Borin", conditionIds: [] }]);

    const slowed = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(slowed.effects.map((effect) => effect.name)).toEqual(["Slowed by Borin"]);
    expect(slowed.effects[0].modifiers).toEqual([{ type: "speed", amount: -10 }]);
    // Slow is not a condition, and the sheet's Speed is untouched: the stat block stays 30 while the
    // creature moves like a 20, so the feet return when the effect ends.
    expect(slowed.conditions).toEqual([]);
    expect(slowed.speedFeet).toBe(30);

    // On the foe's own turn: 25 ft fit inside a 30 ft Speed and is now refused by name.
    nextInitiativeTurn(built.state);
    expect(built.state.combat.turnActorId).toBe(IDS.foe);
    try {
      foeMoves(built, 5);
      expect.unreachable();
    } catch (error) {
      // A refusal, not a rules note: strict mode throws and the draft is discarded.
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("movement.exceeds-speed");
      expect((error as RulesBlockedError).message).toBe("Foe has 20 ft of movement left (this move needs 25 ft).");
    }
    expect(foeMoves(built, 4).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(20);

    // The attacker's next turn begins and the effect ends: `until-source-next-turn` is the printed "until
    // the start of your next turn".
    nextInitiativeTurn(built.state);
    expect(built.state.combat.turnActorId).toBe(IDS.hero);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(25);
  });

  it("leaves the foe its whole 30 ft when the Fighter did not pick the javelin - same weapon, same hit", () => {
    // Negative control: only the three picks differ. Graze is on the unused greatsword.
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
    // Level 5: one Attack action is two swings. Both hits carry `sourceActionId: "item-javelin:slow"`, and
    // `addEffect` replaces a grant from the same source actor and action in place.
    const built = battlefield(["javelin", "longbow", "rapier", "flail"], [], cell(2, 2), cell(3, 2), 5);
    // Str 19 (+4) + proficiency 3 = +7 to hit; a natural 15 is 22 against AC 13.
    expect(effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === "item-javelin")!.attack?.count).toBe(2);
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    const slowed = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(slowed.effects.map((effect) => effect.name)).toEqual(["Slowed by Borin"]);

    // 30 - 10 = 20. A stacked second -10 would print 10.
    nextInitiativeTurn(built.state);
    expect(() => foeMoves(built, 5)).toThrow("Foe has 20 ft of movement left (this move needs 25 ft).");
    nextInitiativeTurn(built.state);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
  });

  it("a javelin AND a club from one attacker are still ONE reduction - Slow does not stack with Slow", () => {
    // SRD 5.2.1 "Combining Game Effects": same-named effects don't combine, so two Slow hits from any weapons
    // are 30 - 10 = 20. Level 5 for two swings, the second with a different weapon.
    const built = battlefield(["javelin", "club", "rapier", "flail"], ["club"], cell(2, 2), cell(3, 2), 5);
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    expect(swing(built, "item-club", [15, 4]).attack?.outcome).toBe("hit");
    // 20 ft, not 10, in the sentence the foe's player is shown.
    nextInitiativeTurn(built.state);
    expect(() => foeMoves(built, 5)).toThrow("Foe has 20 ft of movement left (this move needs 25 ft).");
    // Two rows, one effect: the rows stay separate because each has its own duration, and the read
    // collapses them because they name the same effect.
    const slowed = built.state.actors.find((actor) => actor.id === IDS.foe)!;
    expect(slowed.effects.map((effect) => effect.sourceActionId)).toEqual(["item-javelin:slow", "item-club:slow"]);
    expect(slowed.effects.map((effect) => effect.stackKey)).toEqual(["mastery:slow", "mastery:slow"]);
    expect(foeMoves(built, 4).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(20);
    // Both are sustained by the same attacker's turn, so both end together and the whole 30 returns.
    nextInitiativeTurn(built.state);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 6).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(30);
  });

  it("a DIFFERENT game effect still stacks with the Slow - the −15 that proves the grouping is by NAME", () => {
    // Control: a homebrew curse is not a Slow, so it carries its own key and the two sum: 30 - 10 - 5 = 15.
    const built = battlefield(["javelin", "longbow", "rapier"], [], cell(2, 2), cell(3, 2));
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    addEffect(built.state, IDS.foe, EffectInstanceSchema.parse({
      id: "curse-1", name: "Clinging Tar", tags: [], sourceActorId: null, sourceName: null, sourceActionId: "tar",
      startedRound: 1, duration: { type: "encounter" }, stackKey: "homebrew:tar",
      modifiers: [{ type: "speed", amount: -5 }]
    }));

    nextInitiativeTurn(built.state);
    expect(() => foeMoves(built, 4)).toThrow("Foe has 15 ft of movement left (this move needs 20 ft).");
    expect(foeMoves(built, 3).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(15);
  });

  it("the Slow outlives the attacker's own death - the printed duration runs to a turn a dying creature still has", () => {
    // Slow does not end when the attacker is defeated: the SRD prints "until the start of your next turn"
    // and a creature at 0 HP still has a next turn (`nextInitiativeTurn` skips nobody).
    const built = battlefield(["javelin", "longbow", "rapier"], [], cell(2, 2), cell(3, 2));
    expect(swing(built, "item-javelin", [15, 4]).attack?.outcome).toBe("hit");
    applyDamageDetailed(built.state, IDS.hero, { amount: 999 }, { role: "gm" });
    expect(built.state.actors.find((actor) => actor.id === IDS.hero)!.hp.current).toBe(0);

    // The foe's own turn, and the refusal still names the reduced number.
    nextInitiativeTurn(built.state);
    expect(built.state.combat.turnActorId).toBe(IDS.foe);
    expect(() => foeMoves(built, 5)).toThrow("Foe has 20 ft of movement left (this move needs 25 ft).");
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects.map((effect) => effect.name)).toEqual(["Slowed by Borin"]);

    // ...and the dying attacker's turn begins anyway, which is where the feet come back.
    nextInitiativeTurn(built.state);
    expect(built.state.combat.turnActorId).toBe(IDS.hero);
    expect(built.state.actors.find((actor) => actor.id === IDS.foe)!.effects).toEqual([]);
    nextInitiativeTurn(built.state);
    expect(foeMoves(built, 5).warning).toBeNull();
    expect(built.state.combat.turn.movementUsedFeet).toBe(25);
  });
});

// The off-turn swing, where a mastery that cannot be applied must be narrated.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

type FeedLine = Readonly<{ kind: string; text: string; gmOnly?: boolean; actorIds?: readonly string[] }>;

// The operation layer, since a rules note only matters once something receives it. Everything but the
// feed is a stub: `logged` is the durable table feed, `broadcast` the transient toast.
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
    // The real one is a file read that `actionResolve` awaits outside the command queue, so this hook can
    // commit another command in that window.
    tokenGeometryFor: async () => { if (duringGeometryFetch) await duringGeometryFetch(store); return GRID; },
    publishGameState: async () => {},
    presentSceneMap: async () => {},
    broadcastTableEvent: (event: FeedLine) => { broadcast.push({ kind: event.kind, text: event.text, gmOnly: event.gmOnly }); },
    // `actorIds` is captured because the real `appendLog` (`server.ts`) makes a row GM-only when any
    // combatant it names is hidden.
    appendLog: (entry: FeedLine) => { logged.push({ kind: entry.kind, text: entry.text, gmOnly: entry.gmOnly, actorIds: entry.actorIds }); },
    logTurnBegin: () => {}, logTimelineOutcome: () => {}, scheduleAnnotationExpiry: () => {},
    gmView: unused, playerView: unused,
    // Every die the swing rolls after `attackNatural` pins the d20: the pike's damage.
    random: () => 4,
    newId: () => randomUUID()
  } as unknown as GameOperationsContext);
  return { operations, store, logged, broadcast };
}

/** A `leaves-reach` prompt shaped as `movement-rules.ts` mints one: Borin's pike, the foe walking out. */
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
    // The pike is the reach weapon among the Push weapons, so it is the one swung off-turn, and
    // `reactions.ts` resolves with no geometry callback, so Push here is only the sentence.
    const built = battlefield(["pike", "longbow", "rapier"], ["pike"], cell(2, 2), cell(3, 2));
    const reactionId = parkOpportunityAttack(built);
    const { operations, store, logged, broadcast } = await operationsFor(built);
    const before = store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position;

    // +5 to hit vs AC 13, so a pinned natural 18 lands.
    await operations.reactionAnswer({ kind: "gm", sessionId: IDS.gmSession }, {
      commandId: randomUUID(), reactionId, use: true, actionId: "item-pike", commit: true, attackNatural: 18
    });

    // A GM-only feed row naming the push the engine could not perform.
    expect(logged).toContainEqual({
      kind: "action", gmOnly: true, actorIds: [IDS.hero],
      text: "Rules note: Foe is pushed 10 feet straight away from Borin - move the token."
    });
    // ...and the swing itself still hit and narrated, and the token did not move, so the sentence is an
    // instruction rather than a report.
    expect(broadcast.some((line) => line.kind === "reaction" && line.text.includes("made an opportunity attack against Foe - HIT"))).toBe(true);
    expect(store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position).toEqual(before);
  });

  it("does not shove a token onto the map the fight just left", async () => {
    // `actionResolve` reads the grid before its mutation opens, so a scene switch in between must not be
    // measured against the departed map; the push degrades to the unmeasurable-map sentence.
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

    // The foe stands where it stood, and the GM is told to place it by hand.
    expect(store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position).toEqual(before);
    expect(logged).toContainEqual({
      kind: "action", gmOnly: true, actorIds: [IDS.hero],
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
    // ...and the sentence is a `movement` row naming both combatants with no gmOnly of its own, so the
    // feed's gate decides, as with `narrateTokenMove`'s public half.
    expect(logged).toContainEqual({ kind: "movement", gmOnly: undefined, actorIds: [IDS.hero, IDS.foe], text: "Foe is pushed 10 ft straight away from Borin." });
    // One moment, one row: it did not also print as a rules note.
    expect(logged.filter((line) => line.text.includes("pushed 10 ft"))).toHaveLength(1);
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

// The table's own line on a player's socket: `appendLog` (`server.ts`) re-derives GM-only-ness and
// `projectFeedRow` runs per recipient, so these boot the real service and read `log:entry` payloads.

const LURKER = "10000000-0000-4000-8000-000000000003";

/** A 900x600 PNG header, which is all `inspectMapImage` reads. */
function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function joinSocket(base: string, token: string) {
  const socket = connect(base, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out.")), 5_000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
  });
  const joined = await new Promise<{ ok: boolean; message?: string }>((resolve) => socket.emit("session:join", { token }, resolve));
  if (!joined.ok) throw new Error(joined.message ?? "Session join failed.");
  return socket;
}

const emitCommand = (socket: Socket, event: string, payload: unknown) =>
  new Promise<MutationResult>((resolve) => (socket.emit as (...args: unknown[]) => void)(event, payload, resolve));

/** Wait for the player's socket to receive a matching row; a timeout is a failure, not a skip. */
async function heardLine(heard: readonly CombatLogEntry[], matches: (text: string) => boolean, what: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const found = heard.find((entry) => matches(entry.text));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`The player socket never received ${what}. It heard: ${JSON.stringify(heard.map((entry) => entry.text))}`);
}

// The fixture battlefield plus a combatant the GM has not revealed. The stalker is present in every
// test, so a feed row leaking its name fails the push and topple tests too.
function hiddenAmongThem(masteries: readonly string[], extraWeaponIds: readonly string[]): Built {
  const built = battlefield(masteries, extraWeaponIds, cell(2, 2), cell(3, 2));
  importActorDefinition(built.state, { ...FOE_DEFINITION, name: "Unseen Stalker" } as ActorDefinition, LURKER, "gm-only", catalog);
  addCombatant(built.state, LURKER, 5, () => 1, GRID);
  // Diagonally adjacent to Borin (5 ft by the engine's Chebyshev measure), with two clear cells for a
  // 10 ft shove, so the map edge cannot clamp the push.
  moveEncounterToken(built.state, LURKER, cell(3, 3), GRID);
  return built;
}

// The real service on a real port, with a GM socket and a bystander player socket on the feed. The
// player claims nobody: they are the rest of the table.
async function liveTable(built: Built) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-mastery-live-"));
  const mapAssetsPath = join(directory, "map-assets");
  // Asset ids derive from the image's sha-256, so the fixture's encounter is repointed at the real
  // battlemap and the server's own `tokenGeometryFor` supplies the geometry.
  const assets = new MapAssetStore(mapAssetsPath);
  await assets.initialize();
  const imported = await assets.import(png(GRID.width, GRID.height), "arena.png");
  built.state.combat = { ...built.state.combat, mapAssetId: imported.metadata.id };

  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath,
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: built.state
  });
  await server.initialize();
  server.mapCatalog.register(imported.metadata.id, "Arena", "battlemap");
  server.mapCatalog.saveCalibration(imported.metadata.id, { calibration: GRID.calibration, verifiedAt: null, verificationPoint: null, verificationErrorPx: null });
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  const playerToken = server.auth.issuePlayerSession();
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("The live server did not bind.");
  const base = `http://127.0.0.1:${address.port}`;
  const gm = await joinSocket(base, gmToken);
  const player = await joinSocket(base, playerToken);
  const heard: CombatLogEntry[] = [];
  const gmHeard: CombatLogEntry[] = [];
  player.on("log:entry", (entry: CombatLogEntry) => { heard.push(entry); });
  // The GM's feed is captured too: the DC must be present for the GM and absent for the player, or
  // "it does not cross" is indistinguishable from "it was never written".
  gm.on("log:entry", (entry: CombatLogEntry) => { gmHeard.push(entry); });
  cleanups.push(async () => {
    gm.disconnect(); player.disconnect(); server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { server, gm, player, heard, gmHeard };
}

const swingAt = (gm: Socket, actionId: string, targetId: string) =>
  emitCommand(gm, "action:resolve", { commandId: randomUUID(), actorId: IDS.hero, actionId, targetIds: [targetId], attackNatural: 18 });

describe("the table's own line reaches a player, not just the GM", () => {
  it("hands a bystanding player the sentence for the push that really moved the token", async () => {
    const built = hiddenAmongThem(["warhammer", "quarterstaff", "rapier"], ["warhammer", "quarterstaff"]);
    const { server, gm, heard } = await liveTable(built);

    const resolved = await swingAt(gm, "item-warhammer", IDS.foe);
    expect(resolved).toMatchObject({ ok: true });

    // A payload the player's own socket received, carrying the literal sentence.
    const line = await heardLine(heard, (text) => text.includes("pushed"), "the push narration");
    expect(line.text).toBe("Foe is pushed 10 ft straight away from Borin.");
    expect(line.gmOnly).toBe(false);
    expect(server.store.snapshot.combat.tokens.find((token) => token.actorId === IDS.foe)!.position).toEqual(cell(5, 2));
  });

  it("gives the table the line that names the save, and keeps Topple's DC in the GM's feed alone", async () => {
    const built = hiddenAmongThem(["quarterstaff", "warhammer", "rapier"], ["quarterstaff"]);
    const { server, gm, heard, gmHeard } = await liveTable(built);

    const resolved = await swingAt(gm, "item-quarterstaff", IDS.foe);
    expect(resolved).toMatchObject({ ok: true });

    // The line naming what forced the Constitution save reaches the table.
    const line = await heardLine(heard, (text) => text.includes("Topple"), "the topple narration");
    expect(line.text).toBe("Borin's Topple forces Foe to make a CON save or have the Prone condition.");
    expect(line.gmOnly).toBe(false);

    // The DC is the attacker's number and does not cross. The tracker holds a real save with a real DC,
    // and the GM's feed carries it; the player's never does.
    expect(server.store.snapshot.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, ability: "con", dc: 13, actionName: "Topple" }]);
    const playerHeard = JSON.stringify(heard);
    expect(playerHeard).not.toContain("DC 13");
    expect(playerHeard).not.toContain("Rules note");
    expect(playerHeard).not.toContain("the prompt is in the turn order");
    await heardLine(gmHeard, (text) => text.startsWith("Rules note:"), "the GM's own rules note");
    expect(gmHeard.map((entry) => entry.text)).toContain("Rules note: Topple: Foe's save is DC 13 - the prompt is in the turn order.");
  });

  it("says nothing to the table when the shoved creature is one the GM has not revealed", async () => {
    const built = hiddenAmongThem(["warhammer", "quarterstaff", "rapier"], ["warhammer"]);
    const { server, gm, heard } = await liveTable(built);

    const resolved = await swingAt(gm, "item-warhammer", LURKER);
    expect(resolved).toMatchObject({ ok: true });
    // The shove really happened, so narration here would be a leak.
    expect(server.store.snapshot.combat.tokens.find((token) => token.actorId === LURKER)!.position).toEqual(cell(5, 5));

    // A sentinel: a later, definitely public row on the same socket. Rows reach a connection in write
    // order, so once it arrives the push line was never sent.
    await emitCommand(gm, "initiative:next", { commandId: randomUUID() });
    await heardLine(heard, (text) => text.includes("turn."), "the turn line that marks the end of the wait");
    const playerHeard = JSON.stringify(heard);
    expect(playerHeard).not.toContain("Unseen Stalker");
    expect(playerHeard).not.toContain("pushed");
  });
});

// Two gates on the same sentence: the resolver's stamp, and the ack that carries it back.

/** The same swing as `swing`, aimed anywhere, the hidden combatant included. */
const swingTarget = (built: Built, actionId: string, targetId: string, faces: number[]) =>
  resolveDefinitionAction(
    built.state,
    effectiveActions(built.definition, built.hero, catalog).find((action) => action.id === actionId)!,
    { actorId: IDS.hero, targetIds: [targetId], commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}` },
    deps(built, built.definition, faces)
  );

describe("the resolver stamps its own verdict on the table's line, and the ack respects it", () => {
  it("marks the line gmOnly when the swing names a combatant the GM has not revealed", () => {
    // `namesAHiddenCombatant` decides this field; a Topple against the stalker exercises its true branch.
    const built = hiddenAmongThem(["quarterstaff", "warhammer", "rapier"], ["quarterstaff"]);
    expect(swingTarget(built, "item-quarterstaff", LURKER, [15, 3]).tableNarration).toEqual([{
      kind: "save",
      text: "Borin's Topple forces Unseen Stalker to make a CON save or have the Prone condition.",
      actorIds: [IDS.hero, LURKER],
      gmOnly: true
    }]);
  });

  it("leaves it UNSTAMPED when the same swing names only public combatants - the control", () => {
    // A fresh table, since the action slot is spent once per turn. This control rules out a field
    // hardcoded to true.
    const built = hiddenAmongThem(["quarterstaff", "warhammer", "rapier"], ["quarterstaff"]);
    expect(swingTarget(built, "item-quarterstaff", IDS.foe, [15, 3]).tableNarration).toEqual([{
      kind: "save",
      text: "Borin's Topple forces Foe to make a CON save or have the Prone condition.",
      actorIds: [IDS.hero, IDS.foe]
    }]);
  });

  // The GM hides a player's own character and that player swings at a public foe. `canInitiateForActor`
  // ignores the actor's visibility, so the resolve is allowed but its line is stamped GM-only.
  async function hiddenSwinger(built: Built) {
    const table = await liveTable(built);
    expect(await emitCommand(table.player, "character:claim", { commandId: randomUUID(), actorId: IDS.hero })).toMatchObject({ ok: true });
    expect(await emitCommand(table.gm, "actor:set-visibility", { commandId: randomUUID(), actorId: IDS.hero, visibility: "gm-only" })).toMatchObject({ ok: true });
    return table;
  }
  const topple = (socket: Socket) => emitCommand(socket, "action:resolve", { commandId: randomUUID(), actorId: IDS.hero, actionId: "item-quarterstaff", targetIds: [IDS.foe], attackNatural: 18 }) as Promise<{ ok: boolean; resolution?: { tableNarration?: ReadonlyArray<{ text: string; gmOnly?: boolean }> } }>;

  it("strips the gmOnly line off the ACK a player receives, feed and ack agreeing", async () => {
    const { gm, player, heard, server } = await hiddenSwinger(hiddenAmongThem(["quarterstaff", "warhammer", "rapier"], ["quarterstaff"]));

    const ack = await topple(player);
    expect(ack).toMatchObject({ ok: true });
    // The swing happened: a resolution came back and a save is parked, so the sentence would be a leak.
    expect(ack.resolution).toBeDefined();
    expect(server.store.snapshot.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, actionName: "Topple" }]);

    // The sentence naming the hidden swinger is not in the player's copy of the payload.
    expect(ack.resolution?.tableNarration).toBeUndefined();
    expect(JSON.stringify(ack)).not.toContain("Topple forces");

    await emitCommand(gm, "initiative:next", { commandId: randomUUID() });
    await heardLine(heard, (text) => text.includes("turn."), "the turn line that marks the end of the wait");
    expect(JSON.stringify(heard)).not.toContain("Topple forces");
  });

  it("keeps that same line on the GM's ack - the console this gate must not break", async () => {
    const { gm, server } = await hiddenSwinger(hiddenAmongThem(["quarterstaff", "warhammer", "rapier"], ["quarterstaff"]));

    const ack = await topple(gm);
    expect(ack).toMatchObject({ ok: true });
    expect(server.store.snapshot.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, actionName: "Topple" }]);
    expect(ack.resolution?.tableNarration).toEqual([{
      kind: "save",
      text: "Borin's Topple forces Foe to make a CON save or have the Prone condition.",
      actorIds: [IDS.hero, IDS.foe],
      gmOnly: true
    }]);
  });
});

// The engine claims exactly the masteries it implements.

describe("the engine claims exactly the masteries it implements", () => {
  it("names five as built and three as not, so neither half can drift silently", () => {
    // `masteryReaches` is the single registry the derivation consults. Implementing another mastery means
    // changing this list together with the behaviour and its test.
    const built = ["graze", "push", "sap", "slow", "topple"];
    const notYet = ["cleave", "nick", "vex"];
    expect(built.filter(masteryReaches)).toEqual(built);
    expect(notYet.filter(masteryReaches)).toEqual([]);
    expect([...built, ...notYet].sort()).toEqual([...new Set(loadWeapons().map((weapon) => weapon.mastery))].sort());
  });
});

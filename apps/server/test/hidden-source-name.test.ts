import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { builtinAction } from "../src/builtin-actions.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { startEncounter } from "../src/encounter.js";
import { projectPlayerView } from "../src/projections.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";

const POLICY = BuilderPolicySchema.parse({});
const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);

const IDS = {
  attacker: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  target: "10000000-0000-4000-8000-000000000002",
  playerSession: "30000000-0000-4000-8000-0000000000a1",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

/** Distinctive on purpose: every assertion below is a substring search for exactly this string. */
const ATTACKER_NAME = "Vashkar the Unseen";
const MASK = "A hidden threat";

type Row = CharacterCreateRequestInput["choices"][number];

const attackerBuild = (): CharacterCreateRequestInput => ({
  name: ATTACKER_NAME, speciesId: "halfling", backgroundId: "soldier", classId: "fighter", level: 3,
  subclassId: "champion", abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "club" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "mace" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
    { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ] as Row[]
});

/** A stat-block action carrying a declared on-hit rider - the third of the four authoring sites. */
const SHADOW_BITE = {
  id: "shadow-bite", name: "Shadow Bite", activation: "action", description: "A bite from the dark.",
  attack: { bonus: 10, reachFeet: 5 },
  damage: [{ formula: "1d4", type: "piercing" }],
  onHit: [{ conditions: [{ id: "restrained" }], escapeDc: 13 }]
} as const;

/** The player's own claimed character: public, 200 HP so four swings cannot drop it, AC 13. */
const TARGET_DEFINITION = {
  schemaId: "vtt.actor-character", schemaVersion: 1,
  source: { name: "test", version: "1" },
  name: "Mira Dawnwood", size: "medium",
  abilityScores: { str: 16, dex: 12, con: 14, int: 6, wis: 10, cha: 6 },
  proficiencyBonus: 2, armorClass: 13,
  hitPoints: { maximum: 200, formula: "20d10" },
  initiativeBonus: 1, speedFeet: 30,
  actions: [],
  token: { disposition: "hostile", footprint: { width: 1, height: 1 } },
  extensions: {}
} as unknown as ActorDefinition;

function weaponRow(weaponId: string): InventoryItem {
  const record = catalog.equipmentRecord(weaponId);
  if (!record?.weapon) throw new Error(`${weaponId} is not a catalog weapon`);
  return InventoryItemSchema.parse({
    id: weaponId, name: record.name, quantity: 1, equipped: true, attuned: false, category: record.category,
    weapon: {
      category: record.weapon.category, damageDice: record.weapon.damageDice, damageType: record.weapon.damageType,
      rangeFeet: record.weapon.rangeFeet, longRangeFeet: record.weapon.longRangeFeet,
      ...(record.weapon.properties ? { properties: [...record.weapon.properties] } : {})
    }
  });
}

let command = 0;
let rollId = 0;
const nextCommand = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;

/**
 * Runs all FOUR sites that bake an attacker's name into an effect's free-form `name`, against one
 * public claimed player character, and returns what that player's own client is handed.
 */
function fight(visibility: "public" | "gm-only") {
  const built = buildCharacterDefinition(attackerBuild(), view, POLICY);
  const definition = {
    ...built,
    actions: [...(built.actions ?? []), SHADOW_BITE],
    startingInventory: [...built.startingInventory ?? [], weaponRow("club"), weaponRow("mace")]
  } as unknown as ActorDefinition;
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [] }) as GameState;
  importActorDefinition(state, definition, IDS.attacker, visibility, catalog);
  importActorDefinition(state, TARGET_DEFINITION, IDS.target, "public", catalog);
  const target = state.actors.find((actor) => actor.id === IDS.target)!;
  target.ownerSessionId = IDS.playerSession;
  // The attacker acts first, so `until-source-next-turn` riders are still live when the projection runs.
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.attacker, score: 20 }, { actorId: IDS.target, score: 10 }] }, () => 1, { width: 900, height: 600, calibration: null });
  // Freeform so four swings in one turn are not an action-economy argument; nothing below reads the dial.
  state.combat = { ...state.combat, rulesMode: "freeform" };
  const attacker = state.actors.find((actor) => actor.id === IDS.attacker)!;

  const deps = (faces: number[], definitionFor: ActorDefinition = definition): ResolveDependencies => ({
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-${String(++rollId).padStart(12, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-08T00:00:00.000Z",
    definition: definitionFor, catalog,
    resolveDefinition: (definitionId: string) => state.definitions.find((entry) => entry.id === definitionId)?.definition
  });
  const swing = (actionId: string, faces: number[]) =>
    resolveDefinitionAction(state, effectiveActions(definition, attacker, catalog).find((action) => action.id === actionId)!,
      { actorId: IDS.attacker, targetIds: [IDS.target], commandId: nextCommand() }, deps(faces));

  // SITE 1 - weapon-mastery.ts `slow`.  SITE 2 - weapon-mastery.ts `sap`.
  const slowed = swing("item-club", [15, 4]);
  const sapped = swing("item-mace", [15, 4]);
  // SITE 3 - action-resolution.ts declared on-hit rider.
  const bitten = swing("shadow-bite", [15, 3]);
  // SITE 4 - action-resolution.ts unarmed Grapple: the name rides a PENDING SAVE first...
  resolveDefinitionAction(state, builtinAction("unarmed-grapple")!,
    { actorId: IDS.attacker, targetIds: [IDS.target], commandId: nextCommand(), builtin: true }, deps([]));
  const promptView = projectPlayerView(state, IDS.playerSession, () => null);
  // ...and becomes an effect when the save is failed.
  const saveDeps: SaveAnswerDependencies = {
    random: () => 1, newRollId: () => "40000000-0000-4000-8000-0000000000ff",
    sessionId: IDS.gmSession, role: "gm", now: () => "2026-08-08T00:00:00.000Z",
    resolveDefinition: (definitionId: string) => state.definitions.find((entry) => entry.id === definitionId)?.definition,
    catalog
  };
  answerSave(state, nextCommand(), state.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, saveDeps);

  const struck = state.actors.find((actor) => actor.id === IDS.target)!;
  return {
    state, promptView,
    outcomes: [slowed.attack?.outcome, sapped.attack?.outcome, bitten.attack?.outcome],
    /** What the SERVER stored - the four authoring sites' raw output, before any projection. */
    storedNames: struck.effects.map((effect) => effect.name),
    playerView: projectPlayerView(state, IDS.playerSession, () => null),
    target: struck as Actor
  };
}

describe("a hidden attacker's real name never reaches the player it just hit", () => {
  it("masks the attacker inside every effect NAME the four authoring sites bake it into", () => {
    const { outcomes, storedNames, playerView, promptView } = fight("gm-only");
    // The fixture really ran all four sites: the stored state is the unmasked truth the GM keeps.
    expect(outcomes).toEqual(["hit", "hit", "hit"]);
    expect(storedNames).toEqual([
      `Slowed by ${ATTACKER_NAME}`,
      `Sapped by ${ATTACKER_NAME}`,
      `Restrained by ${ATTACKER_NAME} (Shadow Bite)`,
      `Grappled by ${ATTACKER_NAME}`
    ]);

    // THE FAR END: the whole payload the player's client is handed, serialised. A name hiding in any
    // other string is caught here too - this is not an assertion about one field.
    expect(JSON.stringify(playerView)).not.toContain(ATTACKER_NAME);
    expect(JSON.stringify(promptView)).not.toContain(ATTACKER_NAME);

    // ...and the chips still say something. An empty chip would be a worse bug than the leak.
    expect(playerView.actors.find((actor) => actor.id === IDS.target)!.effects.map((effect) => effect.name)).toEqual([
      `Slowed by ${MASK}`,
      `Sapped by ${MASK}`,
      `Restrained by ${MASK} (Shadow Bite)`,
      `Grappled by ${MASK}`
    ]);
    // The pending-save prompt carries the same free-form name one step earlier, and is masked too.
    expect(promptView.combat.pendingSaves.map((save) => save.onFailEffect?.name)).toEqual([`Grappled by ${MASK}`]);
  });

  it("still names a PUBLIC attacker in all four - the control that proves the effects did not vanish", () => {
    const { outcomes, playerView, promptView } = fight("public");
    expect(outcomes).toEqual(["hit", "hit", "hit"]);
    expect(JSON.stringify(playerView)).toContain(ATTACKER_NAME);
    expect(playerView.actors.find((actor) => actor.id === IDS.target)!.effects.map((effect) => effect.name)).toEqual([
      `Slowed by ${ATTACKER_NAME}`,
      `Sapped by ${ATTACKER_NAME}`,
      `Restrained by ${ATTACKER_NAME} (Shadow Bite)`,
      `Grappled by ${ATTACKER_NAME}`
    ]);
    expect(promptView.combat.pendingSaves.map((save) => save.onFailEffect?.name)).toEqual([`Grappled by ${ATTACKER_NAME}`]);
  });
});

/**
 * THE GUARD ON THE SUBSTITUTION ITSELF. `name` is free-form, so the mask is a text replacement, and a
 * text replacement is exactly where a two-letter creature mangles an unrelated word. These are the
 * two inputs that break a naive `replaceAll`.
 */
describe("the mask replaces a whole name, never a fragment of another word", () => {
  const SHORT = "20000000-0000-4000-8000-000000000001";
  const NAMELESS = "20000000-0000-4000-8000-000000000002";
  const BEARER = "20000000-0000-4000-8000-000000000003";
  const effect = (id: string, name: string, sourceActorId: string, sourceName: string | null) =>
    ({ id, name, sourceActorId, sourceName, duration: { type: "manual" } });
  const state = () => GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: SHORT, name: "Al", kind: "monster", visibility: "gm-only", hp: { current: 9, maximum: 9 } },
      { id: NAMELESS, name: "Nobody", kind: "monster", visibility: "gm-only", hp: { current: 9, maximum: 9 } },
      {
        id: BEARER, name: "Mira Dawnwood", kind: "player-character", visibility: "public",
        hp: { current: 20, maximum: 20 }, ownerSessionId: IDS.playerSession,
        effects: [
          // "Al" appears twice: once as a whole word to be replaced, once inside "Alarmed" to be left.
          effect("e1", "Alarmed by Al", SHORT, "Al"),
          // A source with no recorded name: nothing to find, and a zero-width pattern would rewrite
          // the entire label into the mask.
          effect("e2", "Cursed", NAMELESS, ""),
          effect("e3", "Withered", NAMELESS, null)
        ]
      }
    ]
  }) as GameState;

  it("replaces the standalone name and leaves the word that merely begins with it", () => {
    const projected = projectPlayerView(state(), IDS.playerSession, () => null);
    expect(projected.actors.find((actor) => actor.id === BEARER)!.effects.map((entry) => entry.name))
      .toEqual([`Alarmed by ${MASK}`, "Cursed", "Withered"]);
    // Both hidden sources still collapse to the mask in the field that carries the identity.
    expect(projected.actors.find((actor) => actor.id === BEARER)!.effects.map((entry) => entry.sourceName))
      .toEqual([MASK, MASK, MASK]);
  });
});

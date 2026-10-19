import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter, endEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyRest } from "../src/rests.js";
import { RulesBlockedError } from "../src/game-store.js";

// SRD 5.2.1 monster spellcasting: a stat block's At Will and N/Day spells are cast actions at its printed numbers.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  ally: "10000000-0000-4000-8000-000000000003",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

const library = new ContentLibrary();
const catalog = equipmentCatalogOf(library.forAudience("gm"));
const hero = {
  schemaId: "vtt.actor-character",
  name: "Hero",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 40 },
  armorClass: 12,
  extensions: {},
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
  actions: []
} as unknown as ActorDefinition;
const monster = (slug: string) => library.monsterForInstance(slug)!;
const resolveDefinition = (id: string) => (id === "hero" ? hero : monster(id));
const actionOf = (slug: string, actionId: string) => {
  const action = monster(slug).actions.find((candidate) => candidate.id === actionId);
  if (!action) throw new Error(`${slug} has no ${actionId}`);
  return action;
};

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-17T00:00:00.000Z";

/** The foe's fight against two heroes; it is the foe's turn. */
function fight(foe: string): GameState {
  const definition = monster(foe);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.hero, name: "Hero", kind: "player-character", hp: { current: 40, maximum: 40 }, definitionId: "hero" },
      {
        id: IDS.foe,
        name: definition.name,
        kind: "monster",
        hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum },
        definitionId: foe,
        armorClass: definition.armorClass
      },
      { id: IDS.ally, name: "Ally", kind: "player-character", hp: { current: 40, maximum: 40 }, definitionId: "hero" }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.foe, score: 20 },
        { actorId: IDS.hero, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

function deps(faces: number[], foe: string): ResolveDependencies {
  return {
    random: () => faces.shift() ?? 3,
    newRollId: nextId,
    gmSessionId: IDS.gm,
    now: NOW,
    definition: monster(foe),
    resolveDefinition,
    catalog
  };
}
const cast = (state: GameState, foe: string, action: ActorAction, targetIds: string[], faces: number[] = []) =>
  resolveDefinitionAction(state, action, { actorId: IDS.foe, targetIds, commandId: nextId() }, deps(faces, foe));
/** A fresh turn for the foe, so the next cast has an action to spend. */
const nextTurn = (state: GameState) => {
  state.combat = {
    ...state.combat,
    turnActorId: IDS.foe,
    turn: { ...state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
};

describe("a stat block's spells as cast actions", () => {
  it("lists a mage's spells after its Spellcasting, at its save DC, with its per-day uses", () => {
    const actions = monster("mage").actions;
    const at = actions.findIndex((action) => action.id === "spellcasting");
    expect(actions.slice(at + 1, at + 10).map((action) => action.name)).toEqual([
      "Detect Magic",
      "Light",
      "Mage Armor",
      "Mage Hand",
      "Prestidigitation",
      "Fireball",
      "Invisibility",
      "Cone of Cold",
      "Fly"
    ]);
    expect(actionOf("mage", "spellcasting-fireball")).toMatchObject({
      activation: "action",
      spellId: "fireball",
      save: { ability: "dex", dc: 14, successDamage: "half" },
      damage: [{ formula: "8d6", type: "fire" }],
      area: { shape: "sphere", sizeFeet: 20 },
      uses: { limit: 2, per: "long-rest" }
    });
    expect(actionOf("mage", "spellcasting-fireball")).not.toHaveProperty("spellSlot");
    expect(actionOf("mage", "spellcasting-detect-magic")).not.toHaveProperty("uses");
  });

  it("casts a mage's Fireball for real: the saves are against magic, and the third cast in a day is refused", () => {
    const state = fight("mage");
    const fireball = actionOf("mage", "spellcasting-fireball");
    cast(state, "mage", fireball, [IDS.hero, IDS.ally], [3, 3, 3, 3, 3, 3, 3, 3]);
    expect(state.combat.pendingSaves).toHaveLength(2);
    expect(state.combat.pendingSaves[0]).toMatchObject({ dc: 14, ability: "dex", proposedDamage: 24, magical: true });
    expect(state.actors.find((actor) => actor.id === IDS.foe)?.actionUses).toEqual({ "spellcasting-fireball": 1 });
    nextTurn(state);
    cast(state, "mage", fireball, [IDS.hero]);
    nextTurn(state);
    expect(() => cast(state, "mage", fireball, [IDS.hero])).toThrow(RulesBlockedError);
    // A Long Rest gives the day's casts back.
    endEncounter(state);
    applyRest(state, IDS.foe, "long", resolveDefinition, catalog);
    expect(state.actors.find((actor) => actor.id === IDS.foe)?.actionUses).toEqual({});
  });

  it("casts a red dragon's Scorching Ray with three rays at its +12, in place of a Rend in its Multiattack", () => {
    const rays = actionOf("adult-red-dragon", "spellcasting-scorching-ray");
    expect(rays.attack).toMatchObject({ bonus: 12, count: 3, rangeFeet: 120 });
    const state = fight("adult-red-dragon");
    const rend = actionOf("adult-red-dragon", "rend");
    cast(state, "adult-red-dragon", actionOf("adult-red-dragon", "multiattack"), []);
    cast(state, "adult-red-dragon", rend, [IDS.hero], [10, 3, 3, 3]);
    cast(state, "adult-red-dragon", rend, [IDS.hero], [10, 3, 3, 3]);
    // The third attack is the spell: allowed in the Rend's place, with nothing left after it.
    const resolution = cast(state, "adult-red-dragon", rays, [IDS.hero], [15, 3, 3]);
    expect(resolution.attack?.total).toBe(27);
    expect(() => cast(state, "adult-red-dragon", rend, [IDS.hero])).toThrow(RulesBlockedError);
  });

  it("casts an ancient black dragon's Acid Arrow at level 4 when it replaces an attack", () => {
    expect(actionOf("ancient-black-dragon", "spellcasting-acid-arrow").damage).toEqual([
      { formula: "4d4", type: "acid" }
    ]);
    const upcast = actionOf("ancient-black-dragon", "spellcasting-acid-arrow-level-4");
    expect(upcast.name).toBe("Acid Arrow (level 4)");
    expect(upcast.damage).toEqual([{ formula: "6d4", type: "acid" }]);
    expect(actionOf("ancient-black-dragon", "multiattack").multiattackReplacements).toEqual([
      { actionIds: ["spellcasting-acid-arrow-level-4"], attacks: 1 }
    ]);
  });

  it("makes a legendary action that uses Spellcasting the cast itself, keeping its cost", () => {
    expect(actionOf("adult-red-dragon", "fiery-rays")).toMatchObject({
      activation: "other",
      legendary: { cost: 1, oncePerRound: true },
      spellId: "scorching-ray",
      attack: { bonus: 12, count: 3 }
    });
    expect(actionOf("adult-black-dragon", "frightful-presence")).toMatchObject({
      spellId: "fear",
      save: { ability: "wis", dc: 17, failureConditions: ["frightened"] },
      area: { shape: "cone", sizeFeet: 30 }
    });
  });

  it("works out the numbers a stat block leaves out, and shares a Divine Aid's uses among its spells", () => {
    // The priest prints no DC: 8 + PB 2 + Wis 3.
    expect(actionOf("priest", "spellcasting").castsSpells).toMatchObject({
      ability: "wis",
      saveDc: 13,
      attackBonus: 5
    });
    expect(actionOf("priest", "divine-aid-3-day-healing-word")).toMatchObject({
      activation: "bonus-action",
      healing: { formula: "2d4 + 3" },
      uses: { limit: 3, per: "long-rest", pool: "divine-aid-3-day" }
    });
    // The mage's 3/Day Misty Step is itself the cast.
    expect(actionOf("mage", "misty-step-3-day")).toMatchObject({
      spellId: "misty-step",
      uses: { limit: 3, per: "long-rest" }
    });
  });

  it("groups each cast under its spell list for the GM's action list", () => {
    const summaries = library.forAudience("gm").monsterActionSummaries("mage")!;
    expect(summaries.find((summary) => summary.id === "spellcasting")?.spellList).toEqual({
      ability: "int",
      saveDc: 14,
      attackBonus: 6
    });
    expect(summaries.find((summary) => summary.id === "spellcasting-fly")).toMatchObject({
      castFrom: "spellcasting",
      usesLimit: 1,
      usesPer: "long-rest"
    });
    expect(summaries.find((summary) => summary.id === "misty-step-3-day")).not.toHaveProperty("castFrom");
  });
});

describe("a pit fiend's Hellfire Spellcasting", () => {
  it("casts two Fireballs for one recharge, either of which can be a Hold Monster or a Wall of Fire", () => {
    const hellfire = actionOf("pit-fiend", "hellfire-spellcasting");
    expect(hellfire.multiattack).toEqual([{ actionId: "hellfire-spellcasting-fireball-level-5", count: 2 }]);
    expect(actionOf("pit-fiend", "hellfire-spellcasting-fireball-level-5")).toMatchObject({
      name: "Fireball (level 5)",
      damage: [{ formula: "10d6", type: "fire" }],
      save: { ability: "dex", dc: 21 }
    });
    const state = fight("pit-fiend");
    const fiend = state.actors.find((actor) => actor.id === IDS.foe)!;
    cast(state, "pit-fiend", hellfire, []);
    expect(fiend.actionUses).toEqual({ "hellfire-spellcasting": 1 });
    cast(state, "pit-fiend", actionOf("pit-fiend", "hellfire-spellcasting-fireball-level-5"), [IDS.hero]);
    cast(state, "pit-fiend", actionOf("pit-fiend", "hellfire-spellcasting-hold-monster-level-7"), [IDS.ally]);
    // Both casts shared the one use, and the plan is spent.
    expect(fiend.actionUses).toEqual({ "hellfire-spellcasting": 1 });
    expect(() =>
      cast(state, "pit-fiend", actionOf("pit-fiend", "hellfire-spellcasting-fireball-level-5"), [IDS.hero])
    ).toThrow(RulesBlockedError);
    // Until it recharges, neither the action nor one of its casts on its own is allowed.
    nextTurn(state);
    expect(() => cast(state, "pit-fiend", hellfire, [])).toThrow(RulesBlockedError);
    expect(() =>
      cast(state, "pit-fiend", actionOf("pit-fiend", "hellfire-spellcasting-wall-of-fire"), [IDS.hero])
    ).toThrow(RulesBlockedError);
  });
});

describe("a stat block's Invisibility", () => {
  it("makes the Imp Invisible until its Sting's attack roll ends the spell", () => {
    const state = fight("imp");
    const imp = state.actors.find((actor) => actor.id === IDS.foe)!;
    cast(state, "imp", actionOf("imp", "invisibility"), [IDS.foe]);
    expect(imp.conditions.map((condition) => condition.id)).toEqual(["invisible"]);
    nextTurn(state);
    cast(state, "imp", actionOf("imp", "sting"), [IDS.hero], [15, 3, 3, 3]);
    expect(imp.conditions).toEqual([]);
    expect(imp.effects).toEqual([]);
  });
});

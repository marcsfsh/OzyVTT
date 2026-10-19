import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import {
  addEffect,
  endEffect,
  endEncounterEffects,
  makeEffect,
  releaseGrapplesOutOfRange,
  type EffectNarration
} from "../src/effects.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { applyDamageDetailed, healActor } from "../src/hit-points.js";
import { answerSave, createPendingSaves, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { applyRest } from "../src/rests.js";
import { currentSpeedFeet } from "../src/speed.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { builtinAction } from "../src/builtin-actions.js";
import { turnReminder } from "../src/turn-reminder.js";
import { projectPlayerView } from "../src/projections.js";
import { testCatalog } from "./catalog-records.js";

// How conditions and effects end (SRD 5.2.1 Rules Glossary, conditions; Playing the Game, Concentration): every
// failed save's condition is a source-linked effect with its printed duration, the turn's end is a real step,
// and nothing outlives what the text says.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  ally: "10000000-0000-4000-8000-000000000003",
  session: "30000000-0000-4000-8000-000000000001",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;

const definition = {
  name: "Anyone",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 30 },
  armorClass: 12,
  extensions: {},
  actions: []
} as unknown as ActorDefinition;
const monster = (slug: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === slug)!;
const monsterAction = (slug: string, actionId: string) => monster(slug).actions.find((entry) => entry.id === actionId)!;
const resolveDefinition = (id: string) => (id === "plain" ? definition : monster(id));
const catalog = testCatalog({ spells: loadSpells() as unknown as object[] });

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-16T00:00:00.000Z";

/** The hero (a PC), a foe built from `foeDefinition`, and an ally PC; initiative hero, foe, ally. */
function game(foeDefinition = "plain"): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 30, maximum: 30 },
        ownerSessionId: IDS.session,
        definitionId: "plain",
        speedFeet: 30,
        armorClass: 12
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        hp: { current: 40, maximum: 40 },
        definitionId: foeDefinition,
        speedFeet: 30,
        armorClass: 12
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "player-character",
        hp: { current: 25, maximum: 25 },
        definitionId: "plain",
        speedFeet: 30,
        armorClass: 12
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const conditionIds = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);

function resolveDeps(faces: number[], definitionId = "plain"): ResolveDependencies {
  return {
    random: () => faces.shift() ?? 10,
    newRollId: nextId,
    gmSessionId: IDS.gm,
    now: NOW,
    definition: resolveDefinition(definitionId),
    resolveDefinition,
    catalog
  };
}
function saveDeps(faces: number[]): SaveAnswerDependencies {
  return {
    random: () => faces.shift() ?? 10,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition,
    catalog
  };
}
const turnDeps = { resolveDefinition, rollDie: () => 1, newId: nextId, now: NOW };

/** Answers the only open save on `targetId` with a typed total. */
function answer(state: GameState, targetId: string, total: number): EffectNarration[] {
  const pending = state.combat.pendingSaves.find((save) => save.targetActorId === targetId);
  if (!pending) throw new Error("no pending save");
  return answerSave(state, nextId(), pending.id, "manual", total, true, GM, saveDeps([])).events;
}
/** Hands the turn to `actorId` with a fresh action economy. */
const setTurn = (state: GameState, actorId: string) => {
  state.combat = {
    ...state.combat,
    turnActorId: actorId,
    turn: { ...state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
};
const advance = (state: GameState) => {
  const events: EffectNarration[] = [];
  nextInitiativeTurn(state, events, turnDeps);
  return events;
};

describe("save-imposed conditions end per their text", () => {
  it("a ghoul's paralysis ends at the end of the target's next turn, not before", () => {
    const state = game("ghoul");
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      monsterAction("ghoul", "claw"),
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([18, 3, 3], "ghoul")
    );
    answer(state, IDS.hero, 1);
    expect(conditionIds(state, IDS.hero)).toEqual(["paralyzed"]);
    const effect = actor(state, IDS.hero).effects[0];
    expect(effect).toMatchObject({
      name: "Paralyzed by Foe (Claw)",
      sourceActorId: IDS.foe,
      duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
    });
    advance(state); // the ghoul's turn ends: the hero's paralysis stays
    expect(conditionIds(state, IDS.hero)).toEqual(["paralyzed"]);
    advance(state); // the ally's ends; the hero's starts, still Paralyzed through it
    expect(state.combat.turnActorId).toBe(IDS.hero);
    expect(conditionIds(state, IDS.hero)).toEqual(["paralyzed"]);
    const ending = advance(state); // the hero's turn ends
    expect(conditionIds(state, IDS.hero)).toEqual([]);
    expect(ending.some((event) => /no longer Paralyzed/.test(event.text))).toBe(true);
  });

  it("a second claw refreshes the paralysis, which still ends on time", () => {
    const state = game("ghoul");
    const claw = (faces: number[]) => {
      setTurn(state, IDS.foe);
      resolveDefinitionAction(
        state,
        monsterAction("ghoul", "claw"),
        { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
        resolveDeps(faces, "ghoul")
      );
      answer(state, IDS.hero, 1);
    };
    claw([18, 2, 2]);
    // Advantage against a Paralyzed target, and a critical hit within 5 feet: twice the dice.
    claw([18, 18, 2, 2, 2, 2]);
    expect(actor(state, IDS.hero).effects).toHaveLength(1);
    expect(actor(state, IDS.hero).conditions).toEqual([{ id: "paralyzed" }]);
    advance(state);
    advance(state);
    advance(state); // the hero's turn ends
    expect(conditionIds(state, IDS.hero)).toEqual([]);
  });

  it("an otyugh's bite poisons until ended: the save that ends it, after a Long Rest, is the GM's", () => {
    const state = game("otyugh");
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      monsterAction("otyugh", "bite"),
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([15, 4, 4], "otyugh")
    );
    expect(actor(state, IDS.hero).effects[0]).toMatchObject({
      name: "Poisoned by Foe (Bite)",
      duration: { type: "manual" },
      linkedConditionIds: ["poisoned"]
    });
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    applyRest(state, IDS.hero, "long", resolveDefinition);
    expect(conditionIds(state, IDS.hero)).toEqual(["poisoned"]);
  });

  it("an otyugh's stun ends at the start of the otyugh's next turn", () => {
    const state = game("otyugh");
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      monsterAction("otyugh", "tentacle-slam"),
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([5, 5, 5], "otyugh")
    );
    answer(state, IDS.hero, 1);
    expect(conditionIds(state, IDS.hero)).toEqual(["stunned"]);
    advance(state); // ally
    advance(state); // hero
    expect(conditionIds(state, IDS.hero)).toEqual(["stunned"]);
    advance(state); // the otyugh's turn starts
    expect(conditionIds(state, IDS.hero)).toEqual([]);
  });

  it("a repeated save opens as the bearer's turn ends, and a success ends the effect", () => {
    const state = game();
    const holdPerson = loadSpells().find((spell) => spell.id === "hold-person")!;
    createPendingSaves(state, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Hold Person",
      ability: "wis",
      dc: 13,
      targetIds: [IDS.ally],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: holdPerson.save!.failureConditions,
      onFailEffect: {
        name: "Paralyzed by Foe (Hold Person)",
        tags: [],
        linkedConditionIds: ["paralyzed"],
        escapeDc: null,
        sourceActorId: IDS.foe,
        sourceName: "Foe",
        repeatSave: { ability: "wis", dc: 13 }
      },
      newSaveId: nextId,
      createdAt: 0
    });
    answer(state, IDS.ally, 2);
    expect(conditionIds(state, IDS.ally)).toEqual(["paralyzed"]);
    advance(state); // hero -> foe
    advance(state); // foe -> ally
    expect(state.combat.pendingSaves).toEqual([]);
    const ending = advance(state); // the ally's turn ends
    expect(ending.some((event) => /repeats the WIS save/.test(event.text))).toBe(true);
    const repeat = state.combat.pendingSaves.find((save) => save.targetActorId === IDS.ally)!;
    expect(repeat).toMatchObject({ ability: "wis", dc: 13, conditionIds: [] });
    // A failure changes nothing; a success at the next turn's end ends it.
    answer(state, IDS.ally, 5);
    expect(conditionIds(state, IDS.ally)).toEqual(["paralyzed"]);
    advance(state);
    advance(state);
    advance(state);
    answer(state, IDS.ally, 15);
    expect(conditionIds(state, IDS.ally)).toEqual([]);
    expect(actor(state, IDS.ally).effects).toEqual([]);
  });

  it("a save-imposed grapple names its grappler, takes Escape, and ends with the grappler", () => {
    const state = game("constrictor-snake");
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      monsterAction("constrictor-snake", "constrict"),
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([3, 3, 3], "constrictor-snake")
    );
    answer(state, IDS.hero, 1);
    const grapple = actor(state, IDS.hero).effects[0];
    expect(grapple).toMatchObject({
      tags: ["grapple"],
      escapeDc: 12,
      sourceActorId: IDS.foe,
      endsWhenSourceDefeated: true
    });
    // Shooting the snake: no "grappler unknown" Disadvantage.
    setTurn(state, IDS.hero);
    const shot = resolveDefinitionAction(
      state,
      {
        id: "shortbow",
        name: "Shortbow",
        activation: "action",
        description: "",
        attack: { bonus: 4, rangeFeet: 80 },
        damage: [{ formula: "1d6", type: "piercing" }]
      },
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextId() },
      resolveDeps([12, 3])
    );
    expect(shot.rollMode?.disadvantage ?? []).toEqual([]);
    // The snake drops: the Archer is free.
    applyDamageDetailed(state, IDS.foe, { amount: 999 }, GM, { resolveDefinition });
    expect(conditionIds(state, IDS.hero)).toEqual([]);
  });

  it("Escape a Grapple works against a save-imposed grapple, and Restrained ends with it", () => {
    const state = game("behir");
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      monsterAction("behir", "constrict"),
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([3, 3, 3, 3, 3, 3, 3], "behir")
    );
    answer(state, IDS.hero, 1);
    expect(conditionIds(state, IDS.hero)).toEqual(["grappled", "restrained"]);
    setTurn(state, IDS.hero);
    resolveDefinitionAction(
      state,
      builtinAction("escape-grapple")!,
      { actorId: IDS.hero, targetIds: [], commandId: nextId(), builtin: true },
      resolveDeps([20])
    );
    expect(conditionIds(state, IDS.hero)).toEqual([]);
  });

  it("a grapple ends once a move takes the two farther apart than its range", () => {
    const state = game();
    addEffect(
      state,
      IDS.hero,
      makeEffect({
        id: "held",
        name: "Grappled by Foe",
        tags: ["grapple"],
        sourceActorId: IDS.foe,
        duration: { type: "manual" },
        linkedConditionIds: ["grappled"],
        escapeDc: 12,
        rangeFeet: 10
      })
    );
    expect(releaseGrapplesOutOfRange(state, IDS.foe, () => 10)).toEqual([]);
    // Someone else's move never measures this grapple.
    expect(releaseGrapplesOutOfRange(state, IDS.ally, () => 60)).toEqual([]);
    releaseGrapplesOutOfRange(state, IDS.foe, () => 15);
    expect(conditionIds(state, IDS.hero)).toEqual([]);
  });

  it("a condition set on its own survives the end of an effect that also links it", () => {
    const state = game();
    // Entangle's Restrained (bare, from the GM) and a crocodile's bite holding Restrained too.
    setCondition(state, IDS.hero, "restrained", true, undefined, GM);
    addEffect(
      state,
      IDS.hero,
      makeEffect({
        id: "bite",
        name: "Grappled by Foe (Bite)",
        tags: ["grapple"],
        sourceActorId: IDS.foe,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        linkedConditionIds: ["grappled", "restrained"],
        escapeDc: 12
      })
    );
    applyDamageDetailed(state, IDS.foe, { amount: 999 }, GM, { resolveDefinition });
    expect(conditionIds(state, IDS.hero)).toEqual(["restrained"]);
  });

  it("Hypnotic Pattern charms, incapacitates and stops the target, until it takes damage", () => {
    const state = game();
    const pattern = loadSpells().find((spell) => spell.id === "hypnotic-pattern")!;
    resolveDefinitionAction(
      state,
      {
        id: "spell-hypnotic-pattern",
        name: "Hypnotic Pattern",
        activation: "action",
        description: "",
        damage: [],
        save: { ...pattern.save!, dc: 15 },
        spellId: "hypnotic-pattern"
      },
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextId() },
      resolveDeps([])
    );
    answer(state, IDS.foe, 3);
    const foe = actor(state, IDS.foe);
    expect(conditionIds(state, IDS.foe)).toEqual(["charmed", "incapacitated"]);
    expect(currentSpeedFeet(foe, deriveEquipment(foe, definition, undefined))).toBe(0);
    applyDamageDetailed(state, IDS.foe, { amount: 1 }, GM, { resolveDefinition });
    expect(conditionIds(state, IDS.foe)).toEqual([]);
    expect(currentSpeedFeet(foe, deriveEquipment(foe, definition, undefined))).toBe(30);
  });

  it("Power Word Stun stuns a target of 150 HP or fewer with no save, then repeats a CON save each turn", () => {
    const state = game();
    const stun = loadSpells().find((spell) => spell.id === "power-word-stun")!;
    const resolution = resolveDefinitionAction(
      state,
      {
        id: "spell-power-word-stun",
        name: "Power Word Stun",
        activation: "action",
        description: "",
        damage: [],
        save: { ...stun.save!, dc: 18 },
        spellId: "power-word-stun"
      },
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextId() },
      resolveDeps([])
    );
    expect(state.combat.pendingSaves).toEqual([]);
    expect(conditionIds(state, IDS.foe)).toEqual(["stunned"]);
    expect(resolution.tableNarration?.some((line) => /Foe is Stunned by Hero/.test(line.text))).toBe(true);
    advance(state); // hero -> foe
    advance(state); // the foe's turn ends: its CON save opens
    expect(state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.foe, ability: "con", dc: 18 }]);
  });

  it("Power Word Stun leaves a target over 150 HP its Speed 0 until the start of the caster's next turn", () => {
    const state = game();
    actor(state, IDS.foe).hp = { current: 200, maximum: 200, temporary: 0 };
    const stun = loadSpells().find((spell) => spell.id === "power-word-stun")!;
    const resolution = resolveDefinitionAction(
      state,
      {
        id: "spell-power-word-stun",
        name: "Power Word Stun",
        activation: "action",
        description: "",
        damage: [],
        save: { ...stun.save!, dc: 18 },
        spellId: "power-word-stun"
      },
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextId() },
      resolveDeps([])
    );
    const speed = () =>
      currentSpeedFeet(actor(state, IDS.foe), deriveEquipment(actor(state, IDS.foe), definition, undefined));
    expect(conditionIds(state, IDS.foe)).toEqual([]);
    expect(speed()).toBe(0);
    expect(
      resolution.tableNarration?.some((line) => /Foe's Speed is 0 until the start of Hero's next turn/.test(line.text))
    ).toBe(true);
    advance(state); // the foe's turn: it can't move
    expect(speed()).toBe(0);
    advance(state); // the ally's
    advance(state); // the hero's turn starts: the foe can move again
    expect(speed()).toBe(30);
  });
});

describe("conditions that bring others, and what they do", () => {
  it("Unconscious brings Prone, which stays when Unconscious ends", () => {
    const state = game();
    setCondition(state, IDS.foe, "unconscious", true, undefined, GM);
    expect(conditionIds(state, IDS.foe)).toEqual(["prone", "unconscious"]);
    setCondition(state, IDS.foe, "unconscious", false, undefined, GM);
    expect(conditionIds(state, IDS.foe)).toEqual(["prone"]);
  });

  it("Stunned no longer zeroes Speed (SRD 5.2.1)", () => {
    const state = game();
    setCondition(state, IDS.foe, "stunned", true, undefined, GM);
    const foe = actor(state, IDS.foe);
    expect(currentSpeedFeet(foe, deriveEquipment(foe, definition, undefined))).toBe(30);
  });

  it("Exhaustion gains a level each time it is received, from any path, and level 6 is death", () => {
    const state = game();
    setCondition(state, IDS.ally, "exhaustion", true, 3, GM);
    createPendingSaves(state, {
      sourceActorId: IDS.foe,
      sourceName: "Foe",
      actionName: "Sap",
      ability: "con",
      dc: 15,
      targetIds: [IDS.ally],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: ["exhaustion"],
      newSaveId: nextId,
      createdAt: 0
    });
    answer(state, IDS.ally, 1);
    expect(actor(state, IDS.ally).conditions).toEqual([{ id: "exhaustion", level: 4 }]);
    // An on-hit "+1 Exhaustion" rider adds a level too.
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      {
        id: "draining-touch",
        name: "Draining Touch",
        activation: "action",
        description: "",
        attack: { bonus: 10, reachFeet: 5 },
        damage: [],
        onHit: [{ conditions: [{ id: "exhaustion", level: 1 }] }]
      },
      { actorId: IDS.foe, targetIds: [IDS.ally], commandId: nextId() },
      resolveDeps([15])
    );
    expect(actor(state, IDS.ally).conditions).toEqual([{ id: "exhaustion", level: 5 }]);
    const events = setCondition(state, IDS.ally, "exhaustion", true, undefined, GM);
    expect(actor(state, IDS.ally).hp.current).toBe(0);
    expect(events.some((event) => /dies of Exhaustion/.test(event.text))).toBe(true);
  });

  it("an incapacitating condition from any path breaks Concentration and releases grapples", () => {
    const state = game();
    addEffect(
      state,
      IDS.hero,
      makeEffect({
        id: "held",
        name: "Grappled by Foe",
        tags: ["grapple"],
        sourceActorId: IDS.foe,
        duration: { type: "manual" },
        linkedConditionIds: ["grappled"],
        escapeDc: 13
      })
    );
    addEffect(
      state,
      IDS.foe,
      makeEffect({
        id: "focus",
        name: "Concentrating",
        sourceActorId: IDS.foe,
        concentration: true,
        duration: { type: "manual" }
      })
    );
    // A homebrew stunning on-hit rider lands on the grappling, concentrating foe.
    resolveDefinitionAction(
      state,
      {
        id: "stunning-fist",
        name: "Stunning Fist",
        activation: "action",
        description: "",
        attack: { bonus: 10, reachFeet: 5 },
        damage: [],
        onHit: [{ conditions: [{ id: "stunned" }] }]
      },
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextId() },
      resolveDeps([15])
    );
    expect(conditionIds(state, IDS.foe)).toEqual(["stunned"]);
    expect(conditionIds(state, IDS.hero)).toEqual([]);
    expect(actor(state, IDS.foe).effects.map((effect) => effect.name)).toEqual(["Stunned by Hero (Stunning Fist)"]);
  });

  it("Dodge lapses at Speed 0", () => {
    const state = game();
    setTurn(state, IDS.hero);
    resolveDefinitionAction(
      state,
      builtinAction("dodge")!,
      { actorId: IDS.hero, targetIds: [], commandId: nextId(), builtin: true },
      resolveDeps([])
    );
    const hero = actor(state, IDS.hero);
    expect(deriveEquipment(hero, definition, undefined).carriers.length).toBe(1);
    setCondition(state, IDS.hero, "grappled", true, undefined, GM);
    expect(deriveEquipment(hero, definition, undefined).carriers).toEqual([]);
  });

  it("a knocked-out monster at 0 HP with no dying state wakes when it regains hit points", () => {
    const state = game();
    const foe = actor(state, IDS.foe);
    foe.hp.current = 0;
    foe.conditions = [{ id: "prone" }, { id: "unconscious" }];
    healActor(state, IDS.foe, 5, GM);
    expect(conditionIds(state, IDS.foe)).toEqual(["prone"]);
  });
});

describe("the fight's end and a Long Rest end only what they should", () => {
  it("encounter end sweeps turn-measured effects and keeps those that last until ended", () => {
    const state = game();
    addEffect(state, IDS.hero, makeEffect({ id: "blessed", name: "Shrine blessing", duration: { type: "manual" } }));
    addEffect(state, IDS.hero, makeEffect({ id: "short", name: "Bless", duration: { type: "rounds", remaining: 4 } }));
    endEncounterEffects(state, [IDS.hero, IDS.foe, IDS.ally]);
    expect(actor(state, IDS.hero).effects.map((effect) => effect.id)).toEqual(["blessed"]);
  });

  it("a Long Rest ends the rester's Concentration on others and keeps a curse", () => {
    const state = game();
    addEffect(state, IDS.hero, makeEffect({ id: "curse", name: "Cursed", duration: { type: "manual" } }));
    addEffect(
      state,
      IDS.foe,
      makeEffect({
        id: "hex",
        name: "Hexed",
        sourceActorId: IDS.ally,
        concentration: true,
        duration: { type: "manual" }
      })
    );
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    applyRest(state, IDS.hero, "long", resolveDefinition);
    applyRest(state, IDS.ally, "long", resolveDefinition);
    expect(actor(state, IDS.hero).effects.map((effect) => effect.id)).toEqual(["curse"]);
    expect(actor(state, IDS.foe).effects).toEqual([]);
  });

  it("a Long Rest wakes a knocked-out creature, since its hit points come back", () => {
    const state = game();
    applyDamageDetailed(state, IDS.hero, { amount: 40, nonlethal: true }, GM, { resolveDefinition });
    expect(actor(state, IDS.hero).effects.map((effect) => effect.name)).toEqual(["Knocked out"]);
    state.combat = { ...state.combat, active: false, initiative: [], turnActorId: null };
    applyRest(state, IDS.hero, "long", resolveDefinition);
    expect(actor(state, IDS.hero).effects).toEqual([]);
    expect(conditionIds(state, IDS.hero)).toEqual(["prone"]);
  });
});

describe("damage an effect deals at the start of a turn", () => {
  /** The foe's `actionId` lands on the hero through a failed save. */
  function failed(state: GameState, slug: string, actionId: string) {
    setTurn(state, IDS.foe);
    resolveDefinitionAction(
      state,
      monsterAction(slug, actionId),
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId() },
      resolveDeps([], slug)
    );
    answer(state, IDS.hero, 1);
  }
  /** The next turn, its dice from `faces`. */
  const advanceRolling = (state: GameState, faces: number[]) => {
    const events: EffectNarration[] = [];
    nextInitiativeTurn(state, events, { ...turnDeps, rollDie: () => faces.shift() ?? 1 });
    return events;
  };

  it("a swallow's acid lands at the start of each of the swallower's turns, through the bearer's defences", () => {
    const state = game("behir");
    failed(state, "behir", "swallow");
    const hero = actor(state, IDS.hero);
    expect(hero.effects[0]).toMatchObject({
      name: "Blinded by Foe (Swallow)",
      ongoingDamage: { damage: [{ formula: "6d6", type: "acid" }], at: "source-turn-start" }
    });
    advanceRolling(state, [6, 6, 6, 6, 6, 6]); // the ally's turn
    advanceRolling(state, [6, 6, 6, 6, 6, 6]); // the hero's own turn: not the swallower's
    expect(hero.hp.current).toBe(30);
    addEffect(
      state,
      IDS.hero,
      makeEffect({
        id: "ward",
        name: "Acid ward",
        duration: { type: "manual" },
        modifiers: [{ type: "damage-resistance", damageTypes: ["acid"] }]
      })
    );
    const events = advanceRolling(state, [1, 2, 3, 4, 5, 6]); // the behir's turn: 21 acid, halved
    expect(hero.hp.current).toBe(20);
    expect(events.map((event) => event.text)).toContain(
      "Hero takes 10 Acid damage from Blinded by Foe (Swallow) (21 acid → 10, resistance: Acid ward)."
    );
    // Ended, it deals nothing more.
    endEffect(state, IDS.hero, hero.effects[0].id);
    advanceRolling(state, []);
    advanceRolling(state, []);
    advanceRolling(state, [6, 6, 6, 6, 6, 6]);
    expect(hero.hp.current).toBe(20);
  });

  it("poison at the start of the bearer's own turns, until its repeated save ends it", () => {
    const state = game("vrock");
    failed(state, "vrock", "spores");
    const hero = actor(state, IDS.hero);
    advanceRolling(state, [9]); // the ally's turn
    expect(hero.hp.current).toBe(30);
    const starting = advanceRolling(state, [7]); // the hero's turn starts
    expect(hero.hp.current).toBe(23);
    // The effect takes the action's name without its "(Recharge 6)".
    expect(hero.effects.map((effect) => effect.name)).toEqual(["Poisoned by Foe (Spores)"]);
    expect(starting.map((event) => event.text)).toContain("Hero takes 7 Poison damage from Poisoned by Foe (Spores).");
    advanceRolling(state, []); // the hero's turn ends: the repeated save opens
    answer(state, IDS.hero, 20);
    expect(hero.effects).toEqual([]);
    advanceRolling(state, []);
    advanceRolling(state, [9]);
    expect(hero.hp.current).toBe(23);
  });

  it("a source at 0 HP has no turns to deal it on", () => {
    const state = game("behir");
    failed(state, "behir", "swallow");
    actor(state, IDS.foe).hp.current = 0;
    advanceRolling(state, []);
    advanceRolling(state, []);
    advanceRolling(state, [6, 6, 6, 6, 6, 6]);
    expect(actor(state, IDS.hero).hp.current).toBe(30);
  });

  it("a save that follows the damage ends the effect on a success (Searing Smite)", () => {
    const state = game();
    addEffect(
      state,
      IDS.foe,
      makeEffect({
        id: "searing",
        name: "Searing Smite",
        sourceActorId: IDS.hero,
        sourceName: "Hero",
        duration: { type: "rounds", remaining: 10 },
        ongoingDamage: {
          damage: [{ formula: "2d6", type: "fire" }],
          at: "bearer-turn-start",
          saveToEnd: { ability: "con", dc: 13 }
        }
      })
    );
    const events = advanceRolling(state, [3, 4]); // the foe's turn starts
    expect(actor(state, IDS.foe).hp.current).toBe(33);
    expect(events.map((event) => event.text)).toEqual(
      expect.arrayContaining([
        "Foe takes 7 Fire damage from Searing Smite.",
        "Foe makes the CON save against Searing Smite (DC 13); a success ends it."
      ])
    );
    answer(state, IDS.foe, 5);
    expect(actor(state, IDS.foe).effects).toHaveLength(1);
    advanceRolling(state, []);
    advanceRolling(state, []);
    advanceRolling(state, [1, 1]);
    expect(actor(state, IDS.foe).hp.current).toBe(31);
    answer(state, IDS.foe, 15);
    expect(actor(state, IDS.foe).effects).toEqual([]);
  });

  it("keeps the dice with the GM: players see the effect, not its ongoing damage", () => {
    const state = game("behir");
    failed(state, "behir", "swallow");
    const view = projectPlayerView(state, IDS.session, () => null);
    const effect = view.actors.find((entry) => entry.id === IDS.hero)!.effects[0];
    expect(effect.name).toBe("Blinded by Foe (Swallow)");
    expect(effect).not.toHaveProperty("ongoingDamage");
  });
});

describe("the turn-start reminder", () => {
  it("lists the incoming combatant's conditions and effects, with where they came from and time left", () => {
    const state = game();
    setCondition(state, IDS.hero, "prone", true, undefined, GM);
    addEffect(
      state,
      IDS.hero,
      makeEffect({
        id: "claw",
        name: "Paralyzed by Foe (Claw)",
        sourceActorId: IDS.foe,
        sourceName: "Foe",
        duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
        linkedConditionIds: ["paralyzed"]
      })
    );
    expect(turnReminder(state, IDS.hero)).toBe("Hero: Prone; Paralyzed by Foe (Claw) (ends at the end of this turn).");
    expect(turnReminder(state, IDS.ally)).toBeNull();
    // A hidden source is masked for the table.
    actor(state, IDS.foe).visibility = "gm-only";
    expect(turnReminder(state, IDS.hero)).toBe(
      "Hero: Prone; Paralyzed by A hidden threat (Claw) (ends at the end of this turn)."
    );
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";

// SRD "repeats the save": when a failure's effect asks its bearer for the save again (the end or the start of each of
// its turns, once at the end of its next turn, when it takes damage), what a failed repeat deals and what it turns the
// effect into, successes and failures counted apart, and a success's immunity.

const IDS = {
  caster: "10000000-0000-4000-8000-000000000501",
  target: "10000000-0000-4000-8000-000000000502",
  friend: "10000000-0000-4000-8000-000000000503",
  gm: "30000000-0000-4000-8000-00000000050a",
  map: "20000000-0000-5000-8000-000000000501"
} as const;
const GM = { role: "gm" } as const;

const plain = {
  name: "Anyone",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 60 },
  armorClass: 12,
  extensions: {},
  actions: []
} as unknown as ActorDefinition;
const hostile = { ...plain, token: { disposition: "hostile", footprint: { width: 1, height: 1 } } } as ActorDefinition;
const resolveDefinition = (id: string) => (id === "hostile" ? hostile : plain);

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";

/** The caster (a monster) goes first, then the target (a character), then the target's friend. */
function game(): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.caster, name: "Caster", kind: "monster", hp: { current: 60, maximum: 60 }, definitionId: "hostile" },
      { id: IDS.target, name: "Target", kind: "player-character", hp: { current: 60, maximum: 60 }, definitionId: "x" },
      { id: IDS.friend, name: "Friend", kind: "player-character", hp: { current: 60, maximum: 60 }, definitionId: "x" }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.caster, score: 20 },
        { actorId: IDS.target, score: 15 },
        { actorId: IDS.friend, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const conditions = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);
const deps = (faces: number[] = []): ResolveDependencies => ({
  random: () => faces.shift() ?? 4,
  newRollId: nextId,
  gmSessionId: IDS.gm,
  now: NOW,
  definition: hostile,
  resolveDefinition
});
const saveDeps = (faces: number[] = []): SaveAnswerDependencies => ({
  random: () => faces.shift() ?? 4,
  newRollId: nextId,
  sessionId: IDS.gm,
  role: "gm",
  now: NOW,
  resolveDefinition
});
const turnDeps = (faces: number[] = []) => ({
  resolveDefinition,
  rollDie: () => faces.shift() ?? 4,
  newId: nextId,
  now: NOW
});

function act(
  state: GameState,
  save: NonNullable<ActorAction["save"]>,
  extra: Partial<ActorAction> = {},
  offTurn = false
) {
  const action = {
    id: "gaze",
    name: "Gaze",
    activation: "action",
    description: "",
    damage: [],
    save,
    ...extra
  } as ActorAction;
  return resolveDefinitionAction(
    state,
    action,
    {
      actorId: IDS.caster,
      targetIds: [IDS.target],
      commandId: nextId(),
      // Off its turn, the GM's ruling lets the caster act.
      ...(offTurn ? { override: { families: ["economy" as const] } } : {})
    },
    deps()
  );
}
/** The target's open save, answered with a typed total. */
function answer(state: GameState, total: number, faces: number[] = []) {
  const pending = state.combat.pendingSaves.find((save) => save.targetActorId === IDS.target)!;
  return answerSave(state, nextId(), pending.id, "manual", total, true, GM, saveDeps(faces));
}
/** Moves on to the start of `actorId`'s turn. */
function turnTo(state: GameState, actorId: string, faces: number[] = []) {
  const events: Parameters<typeof nextInitiativeTurn>[1] = [];
  for (let guard = 0; guard < 6 && state.combat.turnActorId !== actorId; guard += 1)
    nextInitiativeTurn(state, events, turnDeps(faces));
  return events!;
}
/** Plays on through the end of the target's next turn. */
function pastTargetTurn(state: GameState, faces: number[] = []) {
  turnTo(state, IDS.target, faces);
  nextInitiativeTurn(state, [], turnDeps(faces));
}
const pendingFor = (state: GameState) => state.combat.pendingSaves.filter((save) => save.targetActorId === IDS.target);

const stagedSleep = {
  ability: "con",
  dc: 15,
  successDamage: "none",
  failureConditions: ["incapacitated"],
  failureDuration: { type: "until-bearer-turn-end" },
  repeatOnce: true,
  secondFailure: { conditions: ["unconscious"], duration: { type: "rounds", rounds: 100 }, endsOnDamage: true }
} as NonNullable<ActorAction["save"]>;

describe("a save repeated once, at the end of the target's next turn", () => {
  it("holds the first failure until that save, and a second failure brings the harsher one", () => {
    const state = game();
    act(state, stagedSleep);
    answer(state, 3);
    expect(conditions(state, IDS.target)).toEqual(["incapacitated"]);
    // The target's own turn ends: the Incapacitated holds and the save is asked again.
    turnTo(state, IDS.target);
    turnTo(state, IDS.friend);
    expect(conditions(state, IDS.target)).toEqual(["incapacitated"]);
    expect(pendingFor(state)).toMatchObject([
      { ability: "con", dc: 15, actionName: "Incapacitated by Caster (Gaze) - repeat save" }
    ]);
    answer(state, 2);
    expect(conditions(state, IDS.target)).toEqual(["prone", "unconscious"]);
    expect(actor(state, IDS.target).effects).toMatchObject([
      { name: "Unconscious by Caster (Gaze)", endsOnDamage: true, duration: { type: "rounds", remaining: 100 } }
    ]);
    // Damage ends the sleep.
    applyDamageDetailed(state, IDS.target, { amount: 1, parts: [{ amount: 1, type: "slashing" }] }, GM);
    expect(actor(state, IDS.target).effects).toEqual([]);
  });

  it("ends on a success at that save, and asks nothing more", () => {
    const state = game();
    act(state, stagedSleep);
    answer(state, 3);
    turnTo(state, IDS.friend);
    answer(state, 20);
    expect(actor(state, IDS.target).effects).toEqual([]);
    expect(conditions(state, IDS.target)).toEqual([]);
    turnTo(state, IDS.target);
    turnTo(state, IDS.friend);
    expect(pendingFor(state)).toEqual([]);
  });

  it("waits a turn more when the failure lands during the target's own turn", () => {
    const state = game();
    state.combat = { ...state.combat, turnActorId: IDS.target };
    act(state, stagedSleep, {}, true);
    answer(state, 3);
    turnTo(state, IDS.friend);
    expect(pendingFor(state)).toEqual([]);
    turnTo(state, IDS.target);
    turnTo(state, IDS.friend);
    expect(pendingFor(state)).toHaveLength(1);
  });

  it("leaves a failure with no second stage to run its course", () => {
    const state = game();
    const { secondFailure: _second, ...once } = stagedSleep;
    act(state, { ...once, failureConditions: ["restrained"], failureDuration: undefined } as typeof stagedSleep);
    answer(state, 3);
    turnTo(state, IDS.friend);
    answer(state, 3);
    expect(conditions(state, IDS.target)).toEqual(["restrained"]);
    expect(actor(state, IDS.target).effects[0]!.repeatSave).toBeUndefined();
  });
});

describe("successes and failures counted apart", () => {
  const counted = {
    ability: "con",
    dc: 15,
    successDamage: "none",
    failureConditions: ["restrained"],
    repeatTally: 3,
    secondFailure: { conditions: ["petrified"] }
  } as NonNullable<ActorAction["save"]>;

  it("turns the restraint to stone on the third failure, whatever came between", () => {
    const state = game();
    act(state, counted);
    answer(state, 3);
    for (const total of [3, 20, 3]) {
      pastTargetTurn(state);
      answer(state, total);
    }
    expect(conditions(state, IDS.target)).toEqual(["restrained"]);
    pastTargetTurn(state);
    answer(state, 3);
    expect(conditions(state, IDS.target)).toEqual(["petrified"]);
    expect(actor(state, IDS.target).effects).toMatchObject([
      { name: "Petrified by Caster (Gaze)", duration: { type: "manual" } }
    ]);
  });

  it("ends on the third success", () => {
    const state = game();
    act(state, counted);
    answer(state, 3);
    for (const total of [20, 3, 20]) {
      pastTargetTurn(state);
      answer(state, total);
    }
    expect(conditions(state, IDS.target)).toEqual(["restrained"]);
    expect(actor(state, IDS.target).effects[0]!.repeatSave?.tally).toEqual({ needed: 3, successes: 2, failures: 1 });
    pastTargetTurn(state);
    answer(state, 20);
    expect(actor(state, IDS.target).effects).toEqual([]);
  });
});

describe("what a failed repeat deals, and repeats as a turn starts", () => {
  it("rolls a failed repeat's damage when the save opens and lands it on a failure", () => {
    const state = game();
    act(state, {
      ability: "wis",
      dc: 15,
      successDamage: "none",
      failureConditions: ["frightened"],
      repeatSave: true,
      repeatFailureDamage: [{ formula: "2d10", type: "psychic" }]
    } as NonNullable<ActorAction["save"]>);
    answer(state, 3);
    turnTo(state, IDS.target);
    nextInitiativeTurn(state, [], turnDeps([6, 7]));
    expect(pendingFor(state)).toMatchObject([
      { proposedDamage: 13, proposedDamageParts: [{ amount: 13, type: "psychic" }] }
    ]);
    answer(state, 3);
    expect(actor(state, IDS.target).hp.current).toBe(47);
    pastTargetTurn(state, [1, 1]);
    answer(state, 20);
    expect(actor(state, IDS.target).hp.current).toBe(47);
    expect(actor(state, IDS.target).effects).toEqual([]);
  });

  it("asks the restrained target as its turn starts, and its success frees it", () => {
    const state = game();
    act(state, {
      ability: "dex",
      dc: 15,
      successDamage: "none",
      failureConditions: ["restrained"],
      repeatAtTurnStart: true
    } as NonNullable<ActorAction["save"]>);
    answer(state, 3);
    turnTo(state, IDS.target);
    expect(pendingFor(state)).toHaveLength(1);
    answer(state, 20);
    expect(conditions(state, IDS.target)).toEqual([]);
    turnTo(state, IDS.friend);
    expect(pendingFor(state)).toEqual([]);
  });
});

describe("a save repeated whenever the target takes damage", () => {
  const charm = {
    ability: "wis",
    dc: 15,
    successDamage: "none",
    failureConditions: ["charmed"],
    repeatOnDamage: {}
  } as NonNullable<ActorAction["save"]>;

  it("asks for the save as damage lands, and only then", () => {
    const state = game();
    act(state, charm);
    answer(state, 3);
    turnTo(state, IDS.friend);
    expect(pendingFor(state)).toEqual([]);
    applyDamageDetailed(state, IDS.target, { amount: 5, parts: [{ amount: 5, type: "fire" }] }, GM, {
      resolveDefinition,
      newId: nextId,
      now: NOW
    });
    expect(pendingFor(state)).toMatchObject([{ ability: "wis", dc: 15 }]);
    answer(state, 20);
    expect(conditions(state, IDS.target)).toEqual([]);
  });

  it("gives the save Advantage where the text does, and passes over the source's own damage where it says so", () => {
    const state = game();
    act(state, { ...charm, repeatOnDamage: { advantage: true, notFromSource: true } } as typeof charm);
    answer(state, 3);
    const hurt = (sourceActorId: string) =>
      applyDamageDetailed(state, IDS.target, { amount: 5, parts: [{ amount: 5, type: "fire" }], sourceActorId }, GM, {
        resolveDefinition,
        newId: nextId,
        now: NOW
      });
    hurt(IDS.caster);
    expect(pendingFor(state)).toEqual([]);
    hurt(IDS.friend);
    const pending = pendingFor(state)[0]!;
    expect(pending.advantageFrom).toBe("Triggered by damage");
    const { outcome } = answerSave(state, nextId(), pending.id, "roll", undefined, false, GM, saveDeps([5, 18]));
    expect(outcome.rollMode?.advantage).toContain("Triggered by damage");
  });
});

describe("what a save's first roll can carry", () => {
  it("adds an Exhaustion level on a failure", () => {
    const state = game();
    act(state, {
      ability: "con",
      dc: 16,
      successDamage: "none",
      failureConditions: [],
      failureExhaustion: 1
    } as NonNullable<ActorAction["save"]>);
    answer(state, 3);
    expect(actor(state, IDS.target).conditions).toEqual([{ id: "exhaustion", level: 1 }]);
  });

  it("makes a successful target immune to that action for the encounter", () => {
    const state = game();
    const moan = {
      ability: "wis",
      dc: 13,
      successDamage: "none",
      failureConditions: ["frightened"],
      immuneOnSuccess: true
    } as NonNullable<ActorAction["save"]>;
    act(state, moan);
    answer(state, 20);
    const again = act(state, moan, { activation: "bonus-action" });
    expect(pendingFor(state)).toEqual([]);
    expect(again.warnings?.join(" ")).toMatch(/Target is immune to Caster's Gaze, so it makes no save/);
  });

  it("gives Advantage to a target whose side is fighting the source's", () => {
    const state = game();
    act(state, { ...stagedSleep, advantageIfFighting: true } as typeof stagedSleep);
    expect(pendingFor(state)).toMatchObject([{ advantageFrom: "Fighting the source's side" }]);
  });
});

import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { addEffect, makeEffect, type EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { CommandRejectedError } from "../src/game-store.js";
import { projectPlayerView } from "../src/projections.js";
import { checkOrder, requireStartOrdered } from "../src/simultaneous-effects.js";
import { askEndOrder, playStartSteps } from "../src/turn-boundaries.js";
import { build, catalog, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 Rules Glossary, Simultaneous Effects: "If two or more things happen at the same time on a creature's turn,
// the person at the game table (player or Game Master) who controls that creature decides the order in which those
// things happen."

const PLAYER = "30000000-0000-4000-8000-0000000000b1";
const wizard = build(wizardInput(["magic-missile"]));
let ids = 0;
const deps = {
  resolveDefinition: () => undefined,
  rollDie: () => 3,
  newId: () => `51000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
  now: () => "2026-10-19T00:00:00.000Z",
  catalog,
  askOrder: true
};
const hero = (state: GameState) => state.actors.find((actor) => actor.id === HERO)!;

/** Puts an effect on the hero: Temporary Hit Points each turn, or damage at the start or end of each of its turns. */
function bear(
  state: GameState,
  id: string,
  name: string,
  extra: Partial<Parameters<typeof makeEffect>[0]>,
  source: Readonly<{ actorId: string | null; name: string }> = { actorId: HERO, name: "Ansel" }
) {
  addEffect(
    state,
    HERO,
    makeEffect({
      id,
      name,
      sourceActorId: source.actorId,
      sourceName: source.name,
      startedRound: 1,
      duration: { type: "manual" },
      ...extra
    })
  );
}

const burning = (at: "bearer-turn-start" | "bearer-turn-end", formula = "1d6") => ({
  ongoingDamage: { at, damage: [{ formula, type: "fire" as const }] }
});

/** The hero's next turn, its start held for its controller's order. */
function heroStarts(state: GameState): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (let step = 0; step < 3; step += 1) nextInitiativeTurn(state, events, deps);
  expect(state.combat.turnActorId).toBe(HERO);
  return events;
}

function heroicAndBurning() {
  const { state } = fight(wizard);
  bear(state, "61000000-0000-4000-8000-000000000001", "Heroism", { temporaryHitPointsEachTurn: 5 });
  bear(state, "61000000-0000-4000-8000-000000000002", "Searing Smite", burning("bearer-turn-start"));
  return state;
}

describe("two things at the start of a turn", () => {
  it("wait for the creature's controller, and nothing lands until the order comes", () => {
    const state = heroicAndBurning();
    const before = hero(state).hp.current;
    const events = heroStarts(state);
    expect(state.combat.turnSteps).toMatchObject({
      actorId: HERO,
      boundary: "start",
      steps: [{ name: "Heroism" }, { name: "Searing Smite" }]
    });
    expect(hero(state).hp).toMatchObject({ current: before, temporary: 0 });
    expect(events.map((event) => event.text)).toContain(
      "2 things happen at once as Ansel's turn starts. Ansel's controller puts them in order."
    );
  });

  it("land in the order given: Temporary Hit Points first soak the fire", () => {
    const state = heroicAndBurning();
    const before = hero(state).hp.current;
    heroStarts(state);
    const [temporary, fire] = state.combat.turnSteps!.steps.map((step) => step.key);
    playStartSteps(state, deps, [temporary!, fire!]);
    expect(hero(state).hp).toMatchObject({ current: before, temporary: 2 });
    expect(state.combat.turnSteps).toBeNull();
  });

  it("land in the order given: the fire first, then the Temporary Hit Points", () => {
    const state = heroicAndBurning();
    const before = hero(state).hp.current;
    heroStarts(state);
    const [temporary, fire] = state.combat.turnSteps!.steps.map((step) => step.key);
    playStartSteps(state, deps, [fire!, temporary!]);
    expect(hero(state).hp).toMatchObject({ current: before - 3, temporary: 5 });
  });

  it("simply happen, in the listed order, when nobody is asked", () => {
    const state = heroicAndBurning();
    const before = hero(state).hp.current;
    for (let step = 0; step < 3; step += 1) nextInitiativeTurn(state, [], { ...deps, askOrder: false });
    expect(state.combat.turnSteps).toBeNull();
    expect(hero(state).hp).toMatchObject({ current: before, temporary: 2 });
  });

  it("happen as listed once the turn ends unanswered", () => {
    const state = heroicAndBurning();
    heroStarts(state);
    nextInitiativeTurn(state, [], deps);
    expect(state.combat.turnSteps).toBeNull();
    expect(hero(state).hp.temporary).toBe(2);
  });

  it("hold the creature's player back from acting until they are in order, and leave the GM free", () => {
    const state = heroicAndBurning();
    heroStarts(state);
    hero(state).ownerSessionId = PLAYER;
    expect(() => requireStartOrdered(state, HERO, { role: "player", sessionId: PLAYER })).toThrow(CommandRejectedError);
    expect(() => requireStartOrdered(state, HERO, { role: "gm" })).not.toThrow();
  });

  it("take an answer only from the creature's controller, naming every step once", () => {
    const state = heroicAndBurning();
    heroStarts(state);
    hero(state).ownerSessionId = PLAYER;
    const waiting = state.combat.turnSteps!;
    const keys = waiting.steps.map((step) => step.key);
    expect(() =>
      checkOrder(state, { role: "player", sessionId: "30000000-0000-4000-8000-0000000000c2" }, waiting.id, keys)
    ).toThrow();
    expect(() => checkOrder(state, { role: "player", sessionId: PLAYER }, waiting.id, [keys[0]!, keys[0]!])).toThrow(
      CommandRejectedError
    );
    expect(checkOrder(state, { role: "player", sessionId: PLAYER }, waiting.id, [...keys].reverse()).id).toBe(
      waiting.id
    );
  });
});

describe("the player's view of the steps", () => {
  it("reaches only the creature's own player, with a hidden source left out of a step's name", () => {
    const state = heroicAndBurning();
    bear(state, "61000000-0000-4000-8000-000000000003", "Orc's Curse", burning("bearer-turn-start", "1d4"), {
      actorId: FOE2,
      name: "Orc"
    });
    state.actors.find((actor) => actor.id === FOE2)!.visibility = "gm-only";
    heroStarts(state);
    hero(state).ownerSessionId = PLAYER;
    const own = projectPlayerView(state, PLAYER, () => null).combat.turnSteps;
    expect(own?.steps.map((step) => step.name)).toEqual(["Heroism", "Searing Smite", "A hidden threat's Curse"]);
    expect(
      projectPlayerView(state, "30000000-0000-4000-8000-0000000000c2", () => null).combat.turnSteps
    ).toBeUndefined();
  });
});

describe("two things at the end of a turn", () => {
  function burningAtEnd() {
    const { state } = fight(wizard);
    bear(state, "62000000-0000-4000-8000-000000000001", "Acid Arrow", {
      ongoingDamage: { at: "bearer-turn-end", damage: [{ formula: "2", type: "acid" }] }
    });
    bear(state, "62000000-0000-4000-8000-000000000002", "Searing Smite", burning("bearer-turn-end"));
    return state;
  }

  it("keep the turn with its creature until its controller orders them", () => {
    const state = burningAtEnd();
    const events: EffectNarration[] = [];
    expect(askEndOrder(state, events, deps)).toBe(true);
    expect(state.combat.turnActorId).toBe(HERO);
    expect(state.combat.turnSteps).toMatchObject({
      boundary: "end",
      steps: [{ name: "Acid Arrow" }, { name: "Searing Smite" }]
    });
  });

  it("land in the order given as the turn passes", () => {
    const state = burningAtEnd();
    askEndOrder(state, [], deps);
    const waiting = state.combat.turnSteps!;
    state.combat.turnSteps = { ...waiting, order: [...waiting.steps.map((step) => step.key)].reverse() };
    const events: EffectNarration[] = [];
    nextInitiativeTurn(state, events, deps);
    const damage = events.filter((event) => event.kind === "damage").map((event) => event.text);
    expect(damage[0]).toMatch(/Searing Smite/);
    expect(damage[1]).toMatch(/Acid Arrow/);
    expect(state.combat.turnSteps).toBeNull();
    expect(state.combat.turnActorId).toBe(FOE);
  });

  it("asks nothing for a single thing", () => {
    const { state } = fight(wizard);
    bear(state, "62000000-0000-4000-8000-000000000003", "Searing Smite", burning("bearer-turn-end"));
    expect(askEndOrder(state, [], deps)).toBe(false);
  });
});

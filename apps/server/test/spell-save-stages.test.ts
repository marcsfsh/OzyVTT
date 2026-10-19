import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { nextInitiativeTurn } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { setCondition } from "../src/actor-conditions.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { currentSpeedFeet } from "../src/speed.js";
import { saveRollSources } from "../src/saving-throws.js";
import { actorOf, answer, cast, caster } from "./spell-lifetimes-kit.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { endOfTurn } from "../src/turn-boundaries.js";
import { DIVIDER, GOBLIN, HERO as VISION_HERO, visionGame } from "./vision-fixtures.js";
import { ALLY, catalog, FOE, HERO } from "./spell-casters.js";

// What a spell's save does after the first roll (SRD 5.2.1 text): Sleep's second save, Flesh to Stone's and Contagion's
// three of a kind, Weird's and Phantasmal Killer's damage on a failed repeat, saves repeated as damage lands (Hideous
// Laughter, the Dominate spells), Advantage in a fight (Charm Person), and what a success leaves.

const NOW = () => "2026-10-19T00:00:00.000Z";
let ids = 0;
const nextId = () => `70000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
const resolveDefinition = (state: GameState) => (id: string) =>
  state.definitions.find((entry) => entry.id === id)?.definition;
const conditions = (state: GameState, id: string) => actorOf(state, id).conditions.map((condition) => condition.id);
const pendingFor = (state: GameState, id: string) =>
  state.combat.pendingSaves.filter((save) => save.targetActorId === id);

/** Plays on through the end of `actorId`'s next turn. */
function pastTurnOf(state: GameState, actorId: string, faces: number[] = []) {
  const deps = {
    resolveDefinition: resolveDefinition(state),
    rollDie: () => faces.shift() ?? 3,
    newId: nextId,
    now: NOW
  };
  for (let guard = 0; guard < 6 && state.combat.turnActorId !== actorId; guard += 1)
    nextInitiativeTurn(state, [], deps);
  nextInitiativeTurn(state, [], deps);
}
/** Back to the Wizard's turn, with its action fresh. */
function wizardsTurn(state: GameState) {
  const deps = { resolveDefinition: resolveDefinition(state), rollDie: () => 3, newId: nextId, now: NOW };
  for (let guard = 0; guard < 6 && state.combat.turnActorId !== HERO; guard += 1) nextInitiativeTurn(state, [], deps);
}
const hurt = (state: GameState, id: string, amount: number, sourceActorId?: string) =>
  applyDamageDetailed(
    state,
    id,
    { amount, parts: [{ amount, type: "fire" }], ...(sourceActorId ? { sourceActorId } : {}) },
    { role: "gm" },
    { resolveDefinition: resolveDefinition(state), newId: nextId, now: NOW, rollDie: () => 3 }
  );
/** A creature of `type` for the foe to be. */
function makeFoeA(state: GameState, type: string) {
  const definition = {
    name: "Thing",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    hitPoints: { maximum: 200 },
    armorClass: 12,
    actions: [],
    token: { disposition: "hostile", footprint: { width: 1, height: 1 } },
    extensions: { "open5e.srd-2024": { type } }
  } as unknown as ActorDefinition;
  state.definitions.push({ id: `${type}-def`, definition } as GameState["definitions"][number]);
  actorOf(state, FOE).definitionId = `${type}-def`;
}

describe("Sleep", () => {
  it("asks for the save again at the end of the target's next turn, and a second failure puts it to sleep", () => {
    const table = caster();
    cast(table, "sleep");
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["incapacitated"]);
    pastTurnOf(table.state, FOE);
    expect(conditions(table.state, FOE)).toEqual(["incapacitated"]);
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["prone", "unconscious"]);
    expect(actorOf(table.state, FOE).effects[0]).toMatchObject({ endsOnDamage: true, duration: { type: "manual" } });
    hurt(table.state, FOE, 1);
    expect(conditions(table.state, FOE)).toEqual(["prone"]);
  });

  it("can't put to sleep a creature that doesn't sleep", () => {
    const table = caster();
    actorOf(table.state, FOE).conditionImmunities = ["exhaustion"];
    cast(table, "sleep");
    const { outcome } = answer(table.state, FOE, 1);
    expect(outcome).toMatchObject({ success: true, autoSucceeded: "doesn't sleep" });
    expect(conditions(table.state, FOE)).toEqual([]);
  });
});

describe("Flesh to Stone", () => {
  it("turns the target to stone on its third failure, whatever succeeded between", () => {
    const table = caster();
    cast(table, "flesh-to-stone");
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["restrained"]);
    for (const face of [2, 19, 2, 2]) {
      pastTurnOf(table.state, FOE);
      answer(table.state, FOE, face);
    }
    expect(conditions(table.state, FOE)).toEqual(["petrified"]);
  });

  it("stops a target that succeeds where it stands until the caster's next turn, and spares a Construct", () => {
    const table = caster();
    cast(table, "flesh-to-stone");
    answer(table.state, FOE, 19);
    const foe = actorOf(table.state, FOE);
    expect(foe.effects).toMatchObject([{ name: "Flesh to Stone", speedZero: true }]);
    foe.speedFeet = 30;
    expect(currentSpeedFeet(foe, deriveEquipment(foe, undefined, catalog))).toBe(0);
    const construct = caster();
    makeFoeA(construct.state, "construct");
    cast(construct, "flesh-to-stone");
    expect(answer(construct.state, FOE, 1).outcome).toMatchObject({ success: true, autoSucceeded: "Construct" });
  });
});

describe("Contagion", () => {
  it("ends on three successes, and lasts its 7 days after three failures", () => {
    const table = caster();
    cast(table, "contagion");
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["poisoned"]);
    for (const face of [19, 2, 19, 19]) {
      pastTurnOf(table.state, FOE);
      answer(table.state, FOE, face);
    }
    expect(conditions(table.state, FOE)).toEqual([]);
    const lasting = caster();
    cast(lasting, "contagion");
    answer(lasting.state, FOE, 2);
    for (const face of [2, 2, 2]) {
      pastTurnOf(lasting.state, FOE);
      answer(lasting.state, FOE, face);
    }
    expect(actorOf(lasting.state, FOE).effects).toMatchObject([
      { linkedConditionIds: ["poisoned"], duration: { type: "minutes", remaining: 10080 } }
    ]);
    expect(actorOf(lasting.state, FOE).effects[0]!.repeatSave).toBeUndefined();
  });
});

describe("damage on a failed repeat", () => {
  it("deals Weird's 5d10 Psychic on each failed save at the end of a Frightened target's turn", () => {
    const table = caster();
    cast(table, "weird", {}, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    answer(table.state, FOE, 2);
    const hp = actorOf(table.state, FOE).hp.current;
    pastTurnOf(table.state, FOE, [4, 4, 4, 4, 4]);
    expect(pendingFor(table.state, FOE)).toMatchObject([{ proposedDamage: 20 }]);
    answer(table.state, FOE, 2);
    expect(actorOf(table.state, FOE).hp.current).toBe(hp - 20);
  });

  it("deals Phantasmal Killer's damage again at the level it was cast", () => {
    const table = caster();
    cast(table, "phantasmal-killer", { slotLevel: 5 }, [1, 1, 1, 1, 1]);
    answer(table.state, FOE, 2);
    expect(actorOf(table.state, FOE).effects[0]!.repeatSave?.failureDamage).toEqual([
      { formula: "5d10", type: "psychic" }
    ]);
    pastTurnOf(table.state, FOE, [2, 2, 2, 2, 2]);
    expect(pendingFor(table.state, FOE)).toMatchObject([{ proposedDamage: 10 }]);
  });
});

describe("saves repeated when the target takes damage", () => {
  it("gives Hideous Laughter's damage-triggered save Advantage, and keeps the target from standing up meanwhile", () => {
    const table = caster();
    cast(table, "hideous-laughter");
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["incapacitated", "prone"]);
    expect(() =>
      setCondition(table.state, FOE, "prone", false, undefined, { role: "player", sessionId: "s" } as never)
    ).toThrow();
    hurt(table.state, FOE, 3, ALLY);
    const pending = pendingFor(table.state, FOE)[0]!;
    expect(pending.advantageFrom).toBe("Triggered by damage");
    answer(table.state, FOE, 19);
    expect(conditions(table.state, FOE)).toEqual(["prone"]);
  });

  it("repeats Dominate Person's save as damage lands, and gives the first save Advantage in a fight", () => {
    const table = caster();
    makeFoeA(table.state, "humanoid");
    cast(table, "dominate-person");
    expect(pendingFor(table.state, FOE)).toMatchObject([{ advantageFrom: "Fighting the source's side" }]);
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["charmed"]);
    pastTurnOf(table.state, FOE);
    expect(pendingFor(table.state, FOE)).toEqual([]);
    hurt(table.state, FOE, 4, ALLY);
    expect(pendingFor(table.state, FOE)).toHaveLength(1);
    answer(table.state, FOE, 19);
    expect(conditions(table.state, FOE)).toEqual([]);
  });

  it("gives Charm Person's save Advantage when the caster's side is fighting the target", () => {
    const table = caster();
    makeFoeA(table.state, "humanoid");
    cast(table, "charm-person");
    expect(pendingFor(table.state, FOE)).toMatchObject([{ advantageFrom: "Fighting the source's side" }]);
  });
});

describe("what a success or a failure leaves besides conditions", () => {
  it("weakens a creature that fails against Ray of Enfeeblement, and spends a success on its next attack", () => {
    const table = caster();
    cast(table, "ray-of-enfeeblement");
    answer(table.state, FOE, 2);
    const foe = actorOf(table.state, FOE);
    const sources = saveRollSources(foe, "str", deriveEquipment(foe, undefined, catalog));
    expect(sources.disadvantage.map((claim) => claim.label)).toContain("Ray of Enfeeblement");
    expect(foe.effects[0]!.repeatSave).toMatchObject({ ability: "con" });
    const saved = caster();
    cast(saved, "ray-of-enfeeblement");
    answer(saved.state, FOE, 19);
    expect(actorOf(saved.state, FOE).effects).toMatchObject([
      { name: "Ray of Enfeeblement", tags: ["until-own-attack"], duration: { type: "until-source-next-turn" } }
    ]);
  });

  it("leaves a dancer rooted in place, with Disadvantage on Dexterity saves", () => {
    const table = caster();
    cast(table, "irresistible-dance");
    answer(table.state, FOE, 2);
    const foe = actorOf(table.state, FOE);
    expect(foe.effects[0]).toMatchObject({ speedZero: true, repeatSave: { byAction: true, timing: "none" } });
    const sources = saveRollSources(foe, "dex", deriveEquipment(foe, undefined, catalog));
    expect(sources.disadvantage.length).toBeGreaterThan(0);
    wizardsTurn(table.state);
    const saved = caster();
    cast(saved, "irresistible-dance");
    answer(saved.state, FOE, 19);
    expect(actorOf(saved.state, FOE).effects).toMatchObject([
      { name: "Dancing", speedZero: true, duration: { type: "until-bearer-turn-end" } }
    ]);
  });
});

describe("Fear", () => {
  it("asks for no save at the end of the turn while the map can't say the caster is out of sight", () => {
    const table = caster();
    cast(table, "fear");
    answer(table.state, FOE, 2);
    expect(conditions(table.state, FOE)).toEqual(["frightened"]);
    expect(actorOf(table.state, FOE).effects[0]!.repeatSave).toMatchObject({ unseenSource: true });
    pastTurnOf(table.state, FOE);
    expect(pendingFor(table.state, FOE)).toEqual([]);
  });

  /** The goblin Frightened by Borin's Fear, as the cast leaves it, with or without a wall between them. */
  const frightened = (walls: ReturnType<typeof DIVIDER>[]) => {
    const state = visionGame({ walls });
    const goblin = state.actors.find((actor) => actor.id === GOBLIN)!;
    addEffect(
      state,
      GOBLIN,
      makeEffect({
        id: "fear-on-goblin",
        name: "Frightened by Borin (Fear)",
        sourceActorId: VISION_HERO,
        sourceName: "Borin",
        duration: { type: "rounds", remaining: 10 },
        linkedConditionIds: ["frightened"],
        repeatSave: { ability: "wis", dc: 15, unseenSource: true }
      })
    );
    return { state, goblin };
  };

  it("asks for the save when the Frightened creature ends its turn out of the caster's sight", () => {
    const { state } = frightened([DIVIDER()]);
    endOfTurn(state, GOBLIN, [], { newId: nextId, now: NOW, resolveDefinition: () => undefined });
    expect(pendingFor(state, GOBLIN)).toMatchObject([{ ability: "wis", dc: 15 }]);
    const { state: open } = frightened([]);
    endOfTurn(open, GOBLIN, [], { newId: nextId, now: NOW, resolveDefinition: () => undefined });
    expect(pendingFor(open, GOBLIN)).toEqual([]);
  });

  it("ends what lasts only while its source is in sight (Horror Nimbus) once the turn ends out of it", () => {
    const { state, goblin } = frightened([DIVIDER()]);
    goblin.effects = goblin.effects.map((effect) => ({ ...effect, repeatSave: undefined, endsOutOfSight: true }));
    endOfTurn(state, GOBLIN, [], { newId: nextId, now: NOW, resolveDefinition: () => undefined });
    expect(goblin.effects).toEqual([]);
    expect(goblin.conditions).toEqual([]);
  });
});

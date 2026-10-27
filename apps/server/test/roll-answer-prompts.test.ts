import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { rollAbilityCheck } from "../src/check-rolls.js";
import { startEncounter } from "../src/encounter.js";
import { answerReaction } from "../src/reactions.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";

// Another creature's answer to a roll (SRD 5.2.1): Cutting Words takes the Bardic Inspiration die off a creature's
// attack roll, check or damage roll; Countercharm rerolls a failed save against Charmed or Frightened with Advantage;
// Improve Fate adds or takes 2d4 off any D20 Test within 60 feet; a sphinx's Burst of Ingenuity adds 2. The roll waits
// on the prompt, and the answer finishes it.

const IDS = {
  bard: "10000000-0000-4000-8000-0000000000b1",
  ally: "10000000-0000-4000-8000-0000000000b2",
  goblin: "10000000-0000-4000-8000-0000000000b3",
  gm: "30000000-0000-4000-8000-0000000000b9",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const NOW = "2026-10-18T00:00:00.000Z";

function definition(name: string, actions: readonly object[]): ActorDefinition {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase() },
    name,
    size: "medium",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 14,
    hitPoints: { maximum: 30 },
    speedFeet: 30,
    actions
  });
}

const SCIMITAR = {
  id: "scimitar",
  name: "Scimitar",
  activation: "action",
  description: "A test swing.",
  attack: { bonus: 4, reachFeet: 5 },
  damage: [{ formula: "1d6 + 2", type: "slashing" }]
};
const CUTTING_WORDS = {
  id: "cutting-words",
  name: "Cutting Words",
  activation: "reaction",
  description: "A test answer.",
  damage: [],
  uses: { limit: 3, per: "long-rest", pool: "bardic-inspiration" },
  answer: {
    rolls: ["attack", "check", "damage"],
    whose: "other",
    rangeFeet: 60,
    when: "success",
    effect: { kind: "subtract", amount: "1d8" }
  }
};
const COUNTERCHARM = {
  id: "countercharm",
  name: "Countercharm",
  activation: "reaction",
  description: "A test answer.",
  damage: [],
  answer: {
    rolls: ["save"],
    whose: "any",
    rangeFeet: 30,
    when: "failure",
    versus: { conditions: ["charmed", "frightened"] },
    effect: { kind: "reroll", advantage: true }
  }
};
const IMPROVE_FATE = {
  id: "boon-of-fate",
  name: "Improve Fate",
  activation: "other",
  description: "A test answer.",
  damage: [],
  uses: { limit: 1, per: "encounter" },
  answer: {
    rolls: ["attack", "save", "check", "death-save"],
    whose: "any",
    rangeFeet: 60,
    when: "any",
    effect: { kind: "add-or-subtract", amount: "2d4" }
  }
};

/** A goblin, a Lore Bard and an ally, in that turn order. */
function table(bardActions: readonly object[]): GameState {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.bard, name: "Lyra", def: "bard-def", kind: "player-character" },
      { id: IDS.ally, name: "Borin", def: "ally-def", kind: "player-character" },
      { id: IDS.goblin, name: "Goblin", def: "goblin-def", kind: "monster" }
    ].map((actor) => ({
      id: actor.id,
      name: actor.name,
      kind: actor.kind,
      visibility: "public",
      hp: { current: 30, maximum: 30 },
      armorClass: 14,
      definitionId: actor.def
    })),
    definitions: [
      { id: "bard-def", definition: definition("Lyra", [SCIMITAR, ...bardActions]) },
      { id: "ally-def", definition: definition("Borin", [SCIMITAR]) },
      { id: "goblin-def", definition: definition("Goblin", [SCIMITAR]) }
    ]
  });
  startEncounter(
    game,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.goblin, score: 20 },
        { actorId: IDS.bard, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null },
    lookup(game)
  );
  return game;
}

let counter = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const lookup = (game: GameState) => (definitionId: string) =>
  game.definitions.find((entry) => entry.id === definitionId)?.definition;
const dice = (faces: number[]) => (sides: number) => {
  const face = faces.shift();
  if (face === undefined) throw new Error(`dice queue empty (d${sides})`);
  return face;
};
const actor = (game: GameState, id: string) => game.actors.find((candidate) => candidate.id === id)!;
/** The goblin stands next to the ally, and the bard 20 feet from both, unless `feet` says otherwise. */
const apart =
  (feet: Readonly<Record<string, number>>) =>
  (a: string, b: string): number | null =>
    feet[`${a}:${b}`] ?? feet[`${b}:${a}`] ?? ([a, b].includes(IDS.goblin) && [a, b].includes(IDS.ally) ? 5 : 20);

function goblinSwings(game: GameState, at: string, faces: number[], feet: Readonly<Record<string, number>> = {}) {
  return resolveDefinitionAction(
    game,
    SCIMITAR as ActorDefinition["actions"][number],
    { actorId: IDS.goblin, targetIds: [at], commandId: nextId(), commit: true },
    {
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: () => NOW,
      definition: lookup(game)("goblin-def"),
      resolveDefinition: lookup(game),
      distanceFeet: apart(feet)
    }
  );
}

function answer(
  game: GameState,
  use: boolean,
  faces: number[] = [],
  options: Readonly<{ subtract?: boolean }> = {},
  feet: Readonly<Record<string, number>> = {}
) {
  return answerReaction(
    game,
    nextId(),
    game.combat.pendingReactions[0]!.id,
    use,
    undefined,
    GM,
    {
      resolveDefinition: lookup(game),
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: () => NOW,
      distanceFeet: apart(feet)
    },
    options
  );
}

describe("Cutting Words on an attack roll that hits", () => {
  it("holds the hit at its roll, and the die taken off turns it into a miss", () => {
    const game = table([CUTTING_WORDS]);
    const swing = goblinSwings(game, IDS.ally, [12]);
    expect(swing.waitingOnReaction).toBe(true);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "roll-answer",
      rollKind: "attack",
      actorId: IDS.bard,
      actionName: "Cutting Words",
      answerDoes: "-1d8",
      targetActorId: IDS.ally
    });
    const answered = answer(game, true, [5]);
    expect(answered.resolution?.attack).toMatchObject({ total: 11, outcome: "miss" });
    expect(actor(game, IDS.ally).hp.current).toBe(30);
    expect(actor(game, IDS.bard).actionUses["bardic-inspiration"]).toBe(1);
    expect(game.combat.reactionsUsed).toContain(IDS.bard);
  });

  it("declined, the attack hits with the same die, and its damage roll is the next roll Cutting Words may answer", () => {
    const game = table([CUTTING_WORDS]);
    goblinSwings(game, IDS.ally, [12]);
    const answered = answer(game, false, [4]);
    expect(answered.resolution?.attack).toMatchObject({ total: 16, outcome: "hit" });
    expect(game.combat.pendingReactions[0]).toMatchObject({ rollKind: "damage", proposedDamage: 6 });
    answer(game, false);
    expect(actor(game, IDS.ally).hp.current).toBe(24);
  });

  it("isn't offered on a miss, out of range, or with the Reaction spent", () => {
    const missed = table([CUTTING_WORDS]);
    goblinSwings(missed, IDS.ally, [3, 4]);
    expect(missed.combat.pendingReactions).toEqual([]);
    const far = table([CUTTING_WORDS]);
    goblinSwings(far, IDS.ally, [12, 4], { [`${IDS.bard}:${IDS.goblin}`]: 70 });
    expect(far.combat.pendingReactions.filter((prompt) => prompt.kind === "roll-answer")).toEqual([]);
    const spent = table([CUTTING_WORDS]);
    spent.combat.reactionsUsed = [IDS.bard];
    goblinSwings(spent, IDS.ally, [12, 4]);
    expect(spent.combat.pendingReactions.filter((prompt) => prompt.kind === "roll-answer")).toEqual([]);
  });
});

describe("Cutting Words on a damage roll", () => {
  it("takes the die off a hit's damage before it lands", () => {
    // This bard's Cutting Words answers only damage rolls, so the hit lands and its damage waits.
    const game = table([{ ...CUTTING_WORDS, answer: { ...CUTTING_WORDS.answer, rolls: ["damage"] } }]);
    goblinSwings(game, IDS.ally, [12, 6]);
    expect(game.combat.pendingReactions[0]).toMatchObject({ rollKind: "damage", proposedDamage: 8 });
    answer(game, true, [5]);
    expect(actor(game, IDS.ally).hp.current).toBe(27);
  });
});

describe("Countercharm on a failed save against Frightened", () => {
  const fear = (game: GameState) => {
    const id = nextId();
    createPendingSaves(game, {
      sourceActorId: IDS.goblin,
      sourceName: "Goblin",
      actionName: "Scary Face",
      ability: "wis",
      dc: 13,
      targetIds: [IDS.ally],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: ["frightened"],
      newSaveId: () => id,
      createdAt: 0
    });
    return id;
  };
  const confirm = (game: GameState, saveId: string, faces: number[]) =>
    answerSave(game, nextId(), saveId, "roll", undefined, true, GM, {
      random: dice(faces),
      newRollId: nextId,
      sessionId: IDS.gm,
      role: "gm",
      now: () => NOW,
      resolveDefinition: lookup(game),
      distanceFeet: apart({})
    });

  it("holds the failed save's confirm, and the reroll with Advantage stands", () => {
    const game = table([COUNTERCHARM]);
    const saveId = fear(game);
    const held = confirm(game, saveId, [5]);
    expect(held.outcome).toMatchObject({ committed: false, awaitingAnswer: true, success: false });
    expect(actor(game, IDS.ally).conditions).toEqual([]);
    expect(() => confirm(game, saveId, [])).toThrow(/waits on an answer/);
    const answered = answer(game, true, [4, 17]);
    expect(answered.save).toMatchObject({ committed: true, success: true, natural: 17 });
    expect(actor(game, IDS.ally).conditions).toEqual([]);
    expect(game.combat.pendingSaves).toEqual([]);
    expect(game.combat.reactionsUsed).toContain(IDS.bard);
  });

  it("declined, the failure lands", () => {
    const game = table([COUNTERCHARM]);
    const saveId = fear(game);
    confirm(game, saveId, [5]);
    expect(answer(game, false).save).toMatchObject({ committed: true, success: false });
    expect(actor(game, IDS.ally).conditions.map((condition) => condition.id)).toEqual(["frightened"]);
  });

  it("isn't asked about a save against Paralyzed, or one 40 feet away", () => {
    const game = table([COUNTERCHARM]);
    const id = nextId();
    createPendingSaves(game, {
      sourceActorId: IDS.goblin,
      sourceName: "Goblin",
      actionName: "Hold",
      ability: "wis",
      dc: 13,
      targetIds: [IDS.ally],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: ["paralyzed"],
      newSaveId: () => id,
      createdAt: 0
    });
    expect(confirm(game, id, [5]).outcome.committed).toBe(true);
    const far = table([COUNTERCHARM]);
    const farSave = fear(far);
    const committed = answerSave(far, nextId(), farSave, "roll", undefined, true, GM, {
      random: dice([5]),
      newRollId: nextId,
      sessionId: IDS.gm,
      role: "gm",
      now: () => NOW,
      resolveDefinition: lookup(far),
      distanceFeet: apart({ [`${IDS.bard}:${IDS.ally}`]: 40 })
    });
    expect(committed.outcome.committed).toBe(true);
  });
});

describe("Improve Fate on another creature's roll", () => {
  it("takes 2d4 off the goblin's attack roll, and is spent until the next fight", () => {
    const game = table([IMPROVE_FATE]);
    goblinSwings(game, IDS.ally, [11]);
    expect(game.combat.pendingReactions[0]).toMatchObject({ actionName: "Improve Fate", answerEither: true });
    const answered = answer(game, true, [2, 3], { subtract: true });
    expect(answered.resolution?.attack).toMatchObject({ total: 10, outcome: "miss" });
    expect(actor(game, IDS.bard).actionUses["boon-of-fate"]).toBe(1);
    // Improve Fate is no Reaction: the bard's is still free.
    expect(game.combat.reactionsUsed).not.toContain(IDS.bard);
  });

  it("adds 2d4 to an ally's check, which the check's result then reads", () => {
    const game = table([IMPROVE_FATE]);
    const rolled = rollAbilityCheck(
      game,
      GM,
      { commandId: nextId(), actorId: IDS.ally, subject: { ability: "str" }, dc: 15, visibility: "public" },
      { random: dice([10]), newId: nextId, sessionId: IDS.gm, now: () => NOW, resolveDefinition: lookup(game) }
    );
    expect(rolled.outcome).toMatchObject({ total: 10, success: false });
    expect(game.combat.pendingReactions[0]).toMatchObject({ rollKind: "check", actorId: IDS.bard });
    answer(game, true, [4, 3]);
    expect(game.rollCalls).toEqual([]);
    const held = game.heldRolls.find((entry) => entry.key === `check:${IDS.ally}`)!;
    expect(held.answers).toEqual([expect.objectContaining({ name: "Improve Fate", bonus: 7 })]);
  });
});

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { armorClassInPlay, GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { expireEffectsAtTurnStart } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerReaction } from "../src/reactions.js";
import { createGameCommands, type CommandContext } from "../src/commands/index.js";
import { ContentLibrary } from "../src/content-library.js";
import { GameStore } from "../src/game-store.js";
import { createStateReader } from "../src/state-reader.js";

// The reactions past Uncanny Dodge and opportunity attacks (SRD 5.2.1): an AC bonus against an attack that would
// hit (Parry, Shield), and striking back at a creature that dealt damage (Hellish Rebuke, Retaliation, Storm's
// Thunder).

const IDS = {
  fighter: "10000000-0000-4000-8000-000000000001",
  knight: "10000000-0000-4000-8000-000000000002",
  wizard: "10000000-0000-4000-8000-000000000003",
  brute: "10000000-0000-4000-8000-000000000004",
  barbarian: "10000000-0000-4000-8000-000000000005",
  goliath: "10000000-0000-4000-8000-000000000006",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

function definition(name: string, armorClass: number, actions: readonly object[]): ActorDefinition {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase() },
    name,
    size: "medium",
    abilityScores: { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 14 },
    proficiencyBonus: 2,
    armorClass,
    hitPoints: { maximum: 40 },
    speedFeet: 30,
    actions
  });
}

const knight = loadMonsterDefinitions().find((monster) => monster.source.externalId === "knight")!;
const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = {
  fighter: definition("Corin", 16, [
    {
      id: "longsword",
      name: "Longsword",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 5, reachFeet: 5 },
      damage: [{ formula: "1d8 + 3", type: "slashing" }]
    },
    {
      id: "shortbow",
      name: "Shortbow",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 5, rangeFeet: 320, rangeNormalFeet: 80 },
      damage: [{ formula: "1d6 + 3", type: "piercing" }]
    }
  ]),
  knight,
  wizard: definition("Wren", 12, [
    {
      id: "spell-shield",
      name: "Shield",
      activation: "reaction",
      description: "A test action.",
      damage: [],
      spellSlot: { level: 1 },
      spellId: "shield",
      reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true }
    },
    {
      id: "spell-hellish-rebuke",
      name: "Hellish Rebuke",
      activation: "reaction",
      description: "A test action.",
      save: { ability: "dex", dc: 13, successDamage: "half" },
      damage: [{ formula: "2d10", type: "fire" }],
      spellSlot: { level: 1 },
      spellId: "hellish-rebuke",
      reaction: { trigger: "damaged-by-creature", response: "strike-back", rangeFeet: 60 }
    }
  ]),
  brute: definition("Brute", 13, [
    {
      id: "club",
      name: "Club",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 5, reachFeet: 5, count: 2 },
      damage: [{ formula: "1d6 + 3", type: "bludgeoning" }]
    }
  ]),
  barbarian: definition("Torga", 14, [
    {
      id: "greataxe",
      name: "Greataxe",
      activation: "action",
      description: "A test action.",
      attack: { bonus: 6, reachFeet: 5 },
      damage: [{ formula: "1d12 + 4", type: "slashing" }]
    },
    {
      id: "retaliation",
      name: "Retaliation",
      activation: "reaction",
      description: "A test action.",
      damage: [],
      reaction: { trigger: "damaged-by-creature", response: "melee-attack", rangeFeet: 5 }
    }
  ]),
  goliath: definition("Kara", 15, [
    {
      id: "storms-thunder",
      name: "Storm's Thunder",
      activation: "reaction",
      description: "A test action.",
      damage: [{ formula: "1d8", type: "thunder" }],
      uses: { limit: 2, per: "long-rest" },
      reaction: { trigger: "damaged-by-creature", response: "strike-back", rangeFeet: 60 }
    }
  ])
};

const ACTORS = {
  fighter: { name: "Corin", kind: "player-character", armorClass: 16, hp: 40 },
  knight: { name: "Knight", kind: "monster", armorClass: 18, hp: 52 },
  wizard: { name: "Wren", kind: "player-character", armorClass: 12, hp: 30 },
  brute: { name: "Brute", kind: "monster", armorClass: 13, hp: 40 },
  barbarian: { name: "Torga", kind: "player-character", armorClass: 14, hp: 50 },
  goliath: { name: "Kara", kind: "player-character", armorClass: 15, hp: 40 }
} as const;
type Who = keyof typeof ACTORS;

/** The named combatants in a live encounter, the first one's turn. */
function buildGame(order: readonly Who[]): GameState {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: order.map((who) => ({
      id: IDS[who],
      name: ACTORS[who].name,
      kind: ACTORS[who].kind,
      visibility: "public",
      hp: { current: ACTORS[who].hp, maximum: ACTORS[who].hp },
      armorClass: ACTORS[who].armorClass,
      definitionId: `def-${who}`,
      size: "medium",
      speedFeet: 30,
      ...(who === "wizard" ? { spellSlots: [{ level: 1, remaining: 2 }] } : {})
    })),
    definitions: order.map((who) => ({ id: `def-${who}`, definition: DEFINITIONS[who] }))
  });
  startEncounter(
    game,
    { mapAssetId: IDS.map, entries: order.map((who, index) => ({ actorId: IDS[who], score: 20 - index })) },
    () => 1,
    { width: 900, height: 600, calibration: null },
    (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition
  );
  return game;
}

let counter = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const lookup = (game: GameState) => (definitionId: string) =>
  game.definitions.find((entry) => entry.id === definitionId)?.definition;
const dice = (faces: number[]) => () => {
  const face = faces.shift();
  if (face === undefined) throw new Error("dice queue empty");
  return face;
};
const actor = (game: GameState, who: Who) => game.actors.find((candidate) => candidate.id === IDS[who])!;

function attack(game: GameState, who: Who, actionId: string, target: Who, faces: number[]) {
  const action = DEFINITIONS[who].actions.find((candidate) => candidate.id === actionId)!;
  return resolveDefinitionAction(
    game,
    action,
    { actorId: IDS[who], targetIds: [IDS[target]], commandId: nextId(), commit: true },
    {
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-16T00:00:00.000Z",
      definition: DEFINITIONS[who],
      resolveDefinition: lookup(game)
    }
  );
}

function answer(
  game: GameState,
  use: boolean,
  faces: number[] = [],
  options: Readonly<{ commit?: boolean; attackNatural?: number }> = {}
) {
  return answerReaction(
    game,
    nextId(),
    game.combat.pendingReactions[0].id,
    use,
    undefined,
    { role: "gm" },
    {
      resolveDefinition: lookup(game),
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-16T00:00:00.000Z"
    },
    options
  );
}

function damage(
  game: GameState,
  who: Who,
  from: Who,
  amount: number,
  distanceFeet?: (a: string, b: string) => number | null
) {
  return applyDamageDetailed(
    game,
    IDS[who],
    { amount, parts: [{ amount, type: "bludgeoning" }], sourceActorId: IDS[from], sourceName: ACTORS[from].name },
    { role: "gm" },
    { resolveDefinition: lookup(game), newId: nextId, now: () => "2026-10-16T00:00:00.000Z", distanceFeet }
  );
}

describe("Parry: an AC reaction against a melee attack that would hit", () => {
  it("holds the hit at its roll: the attack is spent, no damage rolls, and the Knight is prompted", () => {
    const game = buildGame(["fighter", "knight"]);
    // 14 + 5 = 19 meets AC 18, and Parry's +2 would make it 20.
    const resolution = attack(game, "fighter", "longsword", "knight", [14]);
    expect(resolution.waitingOnReaction).toBe(true);
    expect(resolution.attack).toMatchObject({ total: 19, targetAc: 18, outcome: "hit" });
    expect(resolution.damage).toEqual([]);
    expect(game.combat.turn.actionUsed).toBe(true);
    expect(game.combat.pendingReactions).toHaveLength(1);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "attack-would-hit",
      actorId: IDS.knight,
      actionName: "Parry",
      acBonus: 2,
      sourceActorId: IDS.fighter,
      parkedAttack: { actionId: "longsword", attackNatural: 14, untilNextTurn: false }
    });
  });

  it("used: the same die meets the raised AC and misses, and the Knight's reaction is spent", () => {
    const game = buildGame(["fighter", "knight"]);
    attack(game, "fighter", "longsword", "knight", [14]);
    const outcome = answer(game, true);
    expect(outcome.resolution?.attack).toMatchObject({
      total: 19,
      targetAc: 20,
      outcome: "miss",
      reactionAcBonus: { amount: 2, source: "Parry" }
    });
    expect(actor(game, "knight").hp.current).toBe(52);
    expect(game.combat.reactionsUsed).toContain(IDS.knight);
    expect(game.combat.pendingReactions).toEqual([]);
    // The attack's own cost was paid when it rolled, so finishing it spends nothing more.
    expect(game.combat.turn.actionUsed).toBe(true);
  });

  it("declined: the attack hits and its damage lands", () => {
    const game = buildGame(["fighter", "knight"]);
    attack(game, "fighter", "longsword", "knight", [14]);
    const outcome = answer(game, false, [5]);
    expect(outcome.resolution?.attack).toMatchObject({ targetAc: 18, outcome: "hit" });
    expect(outcome.appliedDamage).toBe(8);
    expect(actor(game, "knight").hp.current).toBe(52 - 8);
    expect(game.combat.reactionsUsed).not.toContain(IDS.knight);
  });

  it("is not offered when +2 can't turn the hit, on a critical hit, or against a ranged attack", () => {
    const game = buildGame(["fighter", "knight"]);
    // 18 + 5 = 23 still hits AC 20.
    expect(attack(game, "fighter", "longsword", "knight", [18, 4]).waitingOnReaction).toBeUndefined();
    const crit = buildGame(["fighter", "knight"]);
    expect(attack(crit, "fighter", "longsword", "knight", [20, 4, 4]).waitingOnReaction).toBeUndefined();
    const ranged = buildGame(["fighter", "knight"]);
    expect(attack(ranged, "fighter", "shortbow", "knight", [14, 3]).waitingOnReaction).toBeUndefined();
    expect(ranged.combat.pendingReactions).toEqual([]);
  });

  it("reads the SRD stat block's Parry", () => {
    expect(knight.actions.find((action) => action.id === "parry")?.reaction).toEqual({
      trigger: "hit-by-attack",
      response: "ac-bonus",
      amount: 2,
      melee: true
    });
  });
});

describe("Shield: +5 AC until the caster's next turn", () => {
  it("used: spends a slot, turns the hit into a miss, and the next attack meets AC 17 unprompted", () => {
    const game = buildGame(["brute", "wizard"]);
    // 10 + 5 = 15 hits AC 12; +5 makes it 17.
    expect(attack(game, "brute", "club", "wizard", [10]).waitingOnReaction).toBe(true);
    const outcome = answer(game, true);
    expect(outcome.resolution?.attack).toMatchObject({ total: 15, targetAc: 17, outcome: "miss" });
    const wren = actor(game, "wizard");
    expect(wren.spellSlots).toEqual([{ level: 1, remaining: 1 }]);
    expect(wren.effects.map((effect) => effect.name)).toEqual(["Shield"]);
    expect(armorClassInPlay(wren)).toBe(17);
    // The Club's second swing: 11 + 5 = 16 against the Shield.
    const second = attack(game, "brute", "club", "wizard", [11]);
    expect(second.attack).toMatchObject({ targetAc: 17, outcome: "miss" });
    expect(second.waitingOnReaction).toBeUndefined();
    // It lasts until the start of Wren's next turn.
    expireEffectsAtTurnStart(game, IDS.wizard);
    expect(armorClassInPlay(actor(game, "wizard"))).toBe(12);
  });

  it("is offered only while a slot is left", () => {
    const game = buildGame(["brute", "wizard"]);
    actor(game, "wizard").spellSlots = [{ level: 1, remaining: 0 }];
    const resolution = attack(game, "brute", "club", "wizard", [10, 4]);
    expect(resolution.waitingOnReaction).toBeUndefined();
    expect(resolution.attack?.outcome).toBe("hit");
    expect(game.combat.pendingReactions).toEqual([]);
  });
});

describe("striking back at a creature that dealt damage", () => {
  it("Hellish Rebuke: the damage opens a prompt, and using it forces the attacker's save and spends a slot", () => {
    const game = buildGame(["brute", "wizard"]);
    const taken = damage(game, "wizard", "brute", 7);
    expect(taken.events).toContainEqual({
      kind: "reaction",
      text: "Wren may use Hellish Rebuke against Brute.",
      actorId: IDS.wizard
    });
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "damaged-by-creature",
      actorId: IDS.wizard,
      targetActorId: IDS.brute,
      rollsAttack: false
    });
    const outcome = answer(game, true, [6, 4]);
    expect(outcome.resolution?.save).toMatchObject({ ability: "dex", dc: 13 });
    expect(game.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: IDS.brute, ability: "dex", dc: 13, proposedDamage: 10 })
    ]);
    expect(actor(game, "wizard").spellSlots).toEqual([{ level: 1, remaining: 1 }]);
    expect(game.combat.reactionsUsed).toContain(IDS.wizard);
    expect(game.combat.pendingReactions).toEqual([]);
  });

  it("opens nothing for a hidden attacker, out of range on the map, or a second time while one waits", () => {
    const hidden = buildGame(["brute", "wizard"]);
    actor(hidden, "brute").visibility = "gm-only";
    damage(hidden, "wizard", "brute", 7);
    expect(hidden.combat.pendingReactions).toEqual([]);

    const far = buildGame(["brute", "wizard"]);
    damage(far, "wizard", "brute", 7, () => 70);
    expect(far.combat.pendingReactions).toEqual([]);
    damage(far, "wizard", "brute", 7, () => 60);
    expect(far.combat.pendingReactions).toHaveLength(1);
    damage(far, "wizard", "brute", 7, () => 60);
    expect(far.combat.pendingReactions).toHaveLength(1);
  });

  it("Retaliation: a melee swing, previewed then confirmed, lands on the creature that dealt the damage", () => {
    const game = buildGame(["brute", "barbarian"]);
    damage(game, "barbarian", "brute", 9);
    expect(game.combat.pendingReactions[0]).toMatchObject({ actionName: "Retaliation", rollsAttack: true });
    const preview = answer(game, true, [12], { commit: false });
    expect(preview.resolution?.preview).toBe(true);
    expect(game.combat.pendingReactions).toHaveLength(1);
    // 12 + 6 = 18 hits AC 13; 7 + 4 = 11 slashing.
    const outcome = answer(game, true, [7], { commit: true, attackNatural: 12 });
    expect(outcome.resolution).toMatchObject({ actionName: "Greataxe", activation: "reaction" });
    expect(outcome.appliedDamage).toBe(11);
    expect(actor(game, "brute").hp.current).toBe(40 - 11);
    expect(game.combat.reactionsUsed).toContain(IDS.barbarian);
    expect(game.combat.pendingReactions).toEqual([]);
  });

  it("Storm's Thunder: damage with no roll to make lands at once and spends a use", () => {
    const game = buildGame(["brute", "goliath"]);
    damage(game, "goliath", "brute", 6);
    const outcome = answer(game, true, [5]);
    expect(outcome.appliedDamage).toBe(5);
    expect(actor(game, "brute").hp.current).toBe(40 - 5);
    expect(actor(game, "goliath").actionUses["storms-thunder"]).toBe(1);
  });

  it("the struck creature's own reaction can answer the strike: the Knight may Parry Torga's Retaliation", () => {
    const game = buildGame(["fighter", "knight", "barbarian"]);
    damage(game, "barbarian", "knight", 9);
    // 13 + 6 = 19 hits AC 18; Parry would make it 20.
    const outcome = answer(game, true, [], { commit: true, attackNatural: 13 });
    expect(outcome.resolution?.waitingOnReaction).toBe(true);
    expect(game.combat.pendingReactions).toEqual([
      expect.objectContaining({ kind: "attack-would-hit", actorId: IDS.knight, sourceActorId: IDS.barbarian })
    ]);
    // Declined, the parked swing finishes and its damage lands on the Knight.
    const finished = answer(game, false, [7]);
    expect(finished.resolution?.attack?.outcome).toBe("hit");
    expect(actor(game, "knight").hp.current).toBe(52 - 11);
  });
});

// The command layer: what the table hears when a prompt opens and is answered.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function table(game: GameState, faces: number[]) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-reactions-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new GameStore(join(directory, "game.sqlite"), game);
  await store.initialize();
  const heard: string[] = [];
  const unused = () => {
    throw new Error("not read by these commands");
  };
  const commands = createGameCommands({
    store,
    readState: createStateReader(store).read,
    contentLibrary: new ContentLibrary(),
    combatLog: { append: () => {} },
    mapCatalog: { get: () => undefined },
    tokenCatalog: { get: () => undefined, touchLastUsed: () => {}, rememberForDefinition: () => {} },
    tokenGeometryFor: async () => ({ width: 900, height: 600, calibration: null }),
    publishGameState: async () => {},
    presentSceneMap: async () => {},
    broadcastTableEvent: (event: { text: string }) => heard.push(event.text),
    appendLog: (entry: { text: string }) => heard.push(entry.text),
    logTurnBegin: () => {},
    logTimelineOutcome: () => {},
    scheduleAnnotationExpiry: () => {},
    gmView: unused,
    playerView: unused,
    random: dice(faces),
    newId: () => randomUUID()
  } as unknown as CommandContext);
  const gm = { kind: "gm", sessionId: IDS.gmSession } as const;
  const run = (type: string, payload: object) =>
    commands.dispatch(type as never, gm, { commandId: randomUUID(), ...payload } as never);
  return { store, heard, run };
}

describe("what the table hears", () => {
  it("a Parry: the attack waits on the answer, then misses", async () => {
    const { store, heard, run } = await table(buildGame(["fighter", "knight"]), []);
    await run("action.resolve", {
      actorId: IDS.fighter,
      actionId: "longsword",
      targetIds: [IDS.knight],
      attackNatural: 14
    });
    expect(heard).toContain("Knight may use Parry - the attack waits on their answer.");
    await run("reaction.answer", { reactionId: store.snapshot.combat.pendingReactions[0].id, use: true });
    expect(heard).toContain("Knight used Parry - Corin's Longsword misses.");
  });

  it("Hellish Rebuke: the GM's applied damage names its source, and the answer forces the save", async () => {
    const { store, heard, run } = await table(buildGame(["brute", "wizard"]), [6, 4]);
    await run("actor.apply-damage", {
      actorId: IDS.wizard,
      amount: 7,
      parts: [{ amount: 7, type: "bludgeoning" }],
      sourceActorId: IDS.brute,
      sourceName: "Brute's Club"
    });
    expect(heard).toContain("Wren may use Hellish Rebuke against Brute.");
    await run("reaction.answer", { reactionId: store.snapshot.combat.pendingReactions[0].id, use: true });
    expect(heard).toContain("Wren used Hellish Rebuke against Brute - DC 13 DEX save.");
    expect(store.snapshot.combat.pendingSaves).toHaveLength(1);
  });
});

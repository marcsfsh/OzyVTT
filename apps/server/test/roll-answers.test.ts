import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition, type RollAnswer } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { answerAbilityCheck, rollAbilityCheck, type CheckRollDependencies } from "../src/check-rolls.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import { answerSave, createPendingSaves, type SaveAnswerOptions } from "../src/saving-throws.js";
import { evaluateActionEconomy } from "../src/resolution/economy.js";

// Answers to a roll after it is seen (SRD 5.2.1): each one is data on an action or an effect, offered on the roll's
// own look before it counts, applied by the server to the held dice, and paid for with its uses or its Reaction.

const IDS = {
  hero: "10000000-0000-4000-8000-0000000000a1",
  bard: "10000000-0000-4000-8000-0000000000a2",
  foe: "10000000-0000-4000-8000-0000000000a3",
  gm: "30000000-0000-4000-8000-0000000000a9",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const NOW = "2026-10-18T00:00:00.000Z";

type ActionInput = Readonly<Record<string, unknown>>;

/** A plain answer action (no activation of its own), as the content authors one. */
const answerAction = (id: string, name: string, answer: Partial<RollAnswer>, extra: ActionInput = {}): ActionInput => ({
  id,
  name,
  activation: "other",
  description: "A test answer.",
  damage: [],
  answer,
  ...extra
});

function definition(name: string, actions: readonly ActionInput[], overrides: Record<string, unknown> = {}) {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase() },
    name,
    size: "medium",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 12,
    hitPoints: { maximum: 40 },
    speedFeet: 30,
    actions,
    ...overrides
  });
}

const SWORD: ActionInput = {
  id: "sword",
  name: "Sword",
  activation: "action",
  description: "A test sword.",
  attack: { bonus: 4, reachFeet: 5 },
  damage: [{ formula: "1d8 + 2", type: "slashing" }]
};

/** A fight with the hero (first), an optional bard ally and a foe with AC 15. */
function table(hero: ActorDefinition, bard?: ActorDefinition, fight = true): GameState {
  const foe = definition("Foe", [SWORD], { armorClass: 15 });
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: hero.name,
        kind: "player-character",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: 12,
        definitionId: "hero-def"
      },
      ...(bard
        ? [
            {
              id: IDS.bard,
              name: bard.name,
              kind: "player-character",
              visibility: "public",
              hp: { current: 30, maximum: 30 },
              armorClass: 13,
              definitionId: "bard-def"
            }
          ]
        : []),
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 50, maximum: 50 },
        armorClass: 15,
        definitionId: "foe-def"
      }
    ],
    definitions: [
      { id: "hero-def", definition: hero },
      ...(bard ? [{ id: "bard-def", definition: bard }] : []),
      { id: "foe-def", definition: foe }
    ]
  });
  if (fight)
    startEncounter(
      game,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.hero, score: 20 },
          ...(bard ? [{ actorId: IDS.bard, score: 15 }] : []),
          { actorId: IDS.foe, score: 10 }
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
const hero = (game: GameState) => game.actors.find((actor) => actor.id === IDS.hero)!;

/** A Wisdom save the hero owes at DC 15 (or the given), against the foe. */
function oweSave(game: GameState, extra: Partial<Parameters<typeof createPendingSaves>[1]> = {}): string {
  const id = nextId();
  createPendingSaves(game, {
    sourceActorId: IDS.foe,
    sourceName: "Foe",
    actionName: "Glare",
    ability: "wis",
    dc: 15,
    targetIds: [IDS.hero],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    newSaveId: () => id,
    createdAt: 0,
    ...extra
  });
  return id;
}

function save(
  game: GameState,
  saveId: string,
  faces: number[],
  commit: boolean,
  options: SaveAnswerOptions = {},
  mode?: "advantage" | "disadvantage"
) {
  return answerSave(
    game,
    nextId(),
    saveId,
    "roll",
    undefined,
    commit,
    GM,
    {
      random: dice(faces),
      newRollId: nextId,
      sessionId: IDS.gm,
      role: "gm",
      now: () => NOW,
      resolveDefinition: lookup(game)
    },
    false,
    mode,
    undefined,
    options
  );
}

function swing(game: GameState, faces: number[], options: Readonly<Record<string, unknown>> = {}) {
  const attacker = game.definitions.find((entry) => entry.id === "hero-def")!.definition;
  return resolveDefinitionAction(
    game,
    attacker.actions.find((action) => action.id === "sword")!,
    {
      actorId: IDS.hero,
      targetIds: [IDS.foe],
      commandId: nextId(),
      holdKey: `attack:${IDS.hero}`,
      ...options
    },
    {
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: () => NOW,
      definition: attacker,
      resolveDefinition: lookup(game)
    }
  );
}

function checkDeps(game: GameState, faces: number[]): CheckRollDependencies {
  return {
    random: dice(faces),
    newId: nextId,
    sessionId: IDS.gm,
    now: () => NOW,
    resolveDefinition: lookup(game)
  };
}

const REROLL_FAILED_SAVE: Partial<RollAnswer> = {
  rolls: ["save", "death-save"],
  when: "failure",
  effect: { kind: "reroll", bonus: 9 }
};

describe("a failed save rerolled with a bonus (Indomitable)", () => {
  const fighter = definition("Borin", [
    SWORD,
    answerAction("indomitable", "Indomitable", REROLL_FAILED_SAVE, { uses: { limit: 1, per: "long-rest" } })
  ]);

  it("is offered on the failed preview, and the new roll plus the Fighter level stands", () => {
    const game = table(fighter);
    const saveId = oweSave(game);
    const preview = save(game, saveId, [8], false);
    expect(preview.outcome).toMatchObject({ success: false, total: 8 });
    expect(preview.outcome.answers?.map((answer) => answer.id)).toEqual(["indomitable"]);
    const answered = save(game, saveId, [7], false, { answer: { id: "indomitable" } });
    expect(answered.outcome).toMatchObject({ success: true, total: 16, natural: 7 });
    expect(answered.outcome.answered).toEqual([{ name: "Indomitable", change: "rerolled, +9" }]);
    expect(hero(game).actionUses.indomitable).toBe(1);
    // The confirm reads the same rerolled die and its bonus.
    expect(save(game, saveId, [], true).outcome).toMatchObject({ success: true, total: 16, committed: true });
  });

  it("isn't offered on a success, or once its use is spent", () => {
    const game = table(fighter);
    expect(save(game, oweSave(game), [18], false).outcome.answers).toBeUndefined();
    hero(game).actionUses = { indomitable: 1 };
    expect(save(game, oweSave(game), [3], false).outcome.answers).toBeUndefined();
    const saveId = oweSave(game);
    save(game, saveId, [3], false);
    expect(() => save(game, saveId, [], false, { answer: { id: "indomitable" } })).toThrow(/no uses left/);
  });

  it("answers only on a look of its own, after the die was rolled", () => {
    const game = table(fighter);
    const saveId = oweSave(game);
    expect(() => save(game, saveId, [], false, { answer: { id: "indomitable" } })).toThrow(/Roll first/);
    save(game, saveId, [3], false);
    expect(() => save(game, saveId, [], true, { answer: { id: "indomitable" } })).toThrow(/look of its own/);
  });

  it("can't be taken alone from the turn list: it waits for a roll to answer", () => {
    const game = table(fighter);
    const evaluation = evaluateActionEconomy(
      game,
      hero(game),
      fighter.actions.find((action) => action.id === "indomitable")!,
      [],
      fighter
    );
    expect(evaluation.violations.map((violation) => violation.rule)).toContain("roll.answers-a-roll");
  });
});

describe("a reroll that costs a Focus Point (Disciplined Survivor)", () => {
  const monk = definition("Shan", [
    SWORD,
    answerAction(
      "disciplined-survivor",
      "Disciplined Survivor",
      { rolls: ["save", "death-save"], when: "failure", effect: { kind: "reroll" } },
      { uses: { limit: 14, per: "short-rest", pool: "focus-points" } }
    )
  ]);

  it("spends one point from the shared pool and keeps the new roll, even a worse one", () => {
    const game = table(monk);
    const saveId = oweSave(game);
    save(game, saveId, [9], false);
    expect(save(game, saveId, [4], false, { answer: { id: "disciplined-survivor" } }).outcome).toMatchObject({
      success: false,
      total: 4
    });
    expect(hero(game).actionUses["focus-points"]).toBe(1);
  });

  it("isn't offered with no points left", () => {
    const game = table(monk);
    hero(game).actionUses = { "focus-points": 14 };
    expect(save(game, oweSave(game), [4], false).outcome.answers).toBeUndefined();
  });
});

describe("a d20 turned into a 20 (Stroke of Luck)", () => {
  const rogue = definition("Pip", [
    SWORD,
    answerAction(
      "stroke-of-luck",
      "Stroke of Luck",
      { rolls: ["attack", "save", "check", "death-save"], when: "failure", effect: { kind: "set-d20", face: 20 } },
      { uses: { limit: 1, per: "short-rest" } }
    )
  ]);

  it("turns a failed check's d20 into a 20 and spends the use; a second failure before a rest gets nothing", () => {
    const game = table(rogue, undefined, false);
    const rolled = rollAbilityCheck(
      game,
      GM,
      { commandId: nextId(), actorId: IDS.hero, subject: { ability: "dex" }, dc: 15, visibility: "public" },
      checkDeps(game, [4])
    );
    expect(rolled.outcome).toMatchObject({ total: 4, success: false });
    expect(rolled.outcome.answers?.map((answer) => answer.id)).toEqual(["stroke-of-luck"]);
    const answered = answerAbilityCheck(
      game,
      GM,
      { commandId: nextId(), actorId: IDS.hero, answer: { id: "stroke-of-luck" } },
      checkDeps(game, [])
    );
    expect(answered.outcome).toMatchObject({ natural: 20, total: 20, success: true });
    expect(hero(game).actionUses["stroke-of-luck"]).toBe(1);
    const again = rollAbilityCheck(
      game,
      GM,
      { commandId: nextId(), actorId: IDS.hero, subject: { ability: "dex" }, dc: 15, visibility: "public" },
      checkDeps(game, [2])
    );
    expect(again.outcome.answers).toBeUndefined();
  });

  it("turns a missed attack's d20 into a 20, which is a Critical Hit", () => {
    const game = table(rogue);
    expect(swing(game, [5], { commit: false }).attack).toMatchObject({ outcome: "miss" });
    const answered = swing(game, [], { commit: false, answer: { id: "stroke-of-luck" } });
    expect(answered.attack).toMatchObject({ naturalRoll: 20, total: 24, outcome: "crit" });
    const landed = swing(game, [6, 5], { commit: true });
    expect(landed.attack).toMatchObject({ naturalRoll: 20, outcome: "crit" });
    expect(landed.damage[0].total).toBe(13);
  });
});

describe("a die added to a failed check, kept on a failure (Tactical Mind)", () => {
  const fighter = definition("Borin", [
    SWORD,
    {
      id: "second-wind",
      name: "Second Wind",
      activation: "bonus-action",
      description: "Heal.",
      damage: [],
      healing: { formula: "1d10 + 2", self: true },
      uses: { limit: 2, per: "long-rest" }
    },
    answerAction(
      "tactical-mind",
      "Tactical Mind",
      { rolls: ["check"], when: "failure", effect: { kind: "add", amount: "1d10", keepUseOnFailure: true } },
      { uses: { limit: 2, per: "long-rest", pool: "second-wind" } }
    )
  ]);
  const athletics = (game: GameState, face: number) =>
    rollAbilityCheck(
      game,
      GM,
      { commandId: nextId(), actorId: IDS.hero, subject: { ability: "str" }, dc: 15, visibility: "public" },
      checkDeps(game, [face])
    );
  const tacticalMind = (game: GameState, faces: number[]) =>
    answerAbilityCheck(
      game,
      GM,
      { commandId: nextId(), actorId: IDS.hero, answer: { id: "tactical-mind" } },
      checkDeps(game, faces)
    );

  it("adds 1d10, and a success spends a use of Second Wind", () => {
    const game = table(fighter, undefined, false);
    athletics(game, 13);
    expect(tacticalMind(game, [4]).outcome).toMatchObject({ total: 17, success: true });
    expect(hero(game).actionUses["second-wind"]).toBe(1);
  });

  it("keeps the use when the check still fails, and is offered no second time on that roll", () => {
    const game = table(fighter, undefined, false);
    athletics(game, 2);
    const answered = tacticalMind(game, [3]);
    expect(answered.outcome).toMatchObject({ total: 5, success: false });
    expect(answered.outcome.answered).toEqual([{ name: "Tactical Mind", change: "+3, use kept" }]);
    expect(answered.outcome.answers).toBeUndefined();
    expect(hero(game).actionUses["second-wind"]).toBeUndefined();
  });
});

describe("a d10 added after seeing a check or save (Dark One's Own Luck)", () => {
  const warlock = definition("Vex", [
    SWORD,
    answerAction(
      "dark-ones-own-luck",
      "Dark One's Own Luck",
      { rolls: ["check", "save", "death-save"], when: "any", effect: { kind: "add", amount: "1d10" } },
      { uses: { limit: 3, per: "long-rest" } }
    )
  ]);

  it("adds to a failed save and turns it, once per roll", () => {
    const game = table(warlock);
    const saveId = oweSave(game);
    save(game, saveId, [12], false);
    expect(save(game, saveId, [5], false, { answer: { id: "dark-ones-own-luck" } }).outcome).toMatchObject({
      success: true,
      total: 17
    });
    expect(hero(game).actionUses["dark-ones-own-luck"]).toBe(1);
    expect(() => save(game, saveId, [5], false, { answer: { id: "dark-ones-own-luck" } })).toThrow(
      /already answered this roll/
    );
  });

  it("doesn't answer an attack roll", () => {
    const game = table(warlock);
    expect(swing(game, [3], { commit: false }).attack?.answers).toBeUndefined();
  });
});

describe("a natural 1 rerolled (the halfling's Luck)", () => {
  const halfling = definition("Rosie", [
    SWORD,
    answerAction("halfling-luck", "Luck", {
      rolls: ["attack", "save", "check", "death-save"],
      when: "natural-one",
      effect: { kind: "reroll", one: true }
    })
  ]);

  it("rerolls an attack's natural 1 for free, the new roll standing, and spends no Heroic Inspiration", () => {
    const game = table(halfling);
    hero(game).heroicInspiration = true;
    const preview = swing(game, [1], { commit: false });
    expect(preview.attack).toMatchObject({ naturalRoll: 1, outcome: "fumble" });
    expect(preview.attack?.answers?.map((answer) => answer.id)).toEqual(["halfling-luck"]);
    const answered = swing(game, [14], { commit: false, answer: { id: "halfling-luck" } });
    expect(answered.attack).toMatchObject({ naturalRoll: 14, total: 18, outcome: "hit" });
    expect(hero(game).heroicInspiration).toBe(true);
  });

  it("isn't offered on a 2", () => {
    const game = table(halfling);
    expect(swing(game, [2], { commit: false }).attack?.answers).toBeUndefined();
  });

  it("rerolls the die that shows 1 under Disadvantage, keeping the other", () => {
    const game = table(halfling);
    const saveId = oweSave(game);
    expect(save(game, saveId, [1, 18], false, {}, "disadvantage").outcome).toMatchObject({ natural: 1 });
    expect(
      save(game, saveId, [12], false, { answer: { id: "halfling-luck" } }, "disadvantage").outcome
    ).toMatchObject({ natural: 12, total: 12 });
  });
});

describe("a missed attack that hits instead (Boon of Combat Prowess)", () => {
  const champion = definition("Ozar", [
    SWORD,
    answerAction(
      "boon-of-combat-prowess",
      "Peerless Aim",
      { rolls: ["attack"], when: "failure", effect: { kind: "hit" } },
      { uses: { limit: 1, per: "own-turn" } }
    )
  ]);

  it("turns the miss into a hit that isn't a Critical Hit, and its damage lands", () => {
    const game = table(champion);
    expect(swing(game, [3], { commit: false }).attack).toMatchObject({ outcome: "miss" });
    expect(swing(game, [], { commit: false, answer: { id: "boon-of-combat-prowess" } }).attack).toMatchObject({
      outcome: "hit"
    });
    const landed = swing(game, [5], { commit: true });
    expect(landed.attack).toMatchObject({ outcome: "hit", answered: [{ name: "Peerless Aim", change: "hits" }] });
    expect(landed.damage[0].total).toBe(7);
    expect(hero(game).actionUses["boon-of-combat-prowess"]).toBe(1);
  });

  it("isn't offered on a hit, or again before the start of the bearer's next turn", () => {
    expect(swing(table(champion), [16], { commit: false }).attack?.answers).toBeUndefined();
    const spent = table(champion);
    hero(spent).actionUses = { "boon-of-combat-prowess": 1 };
    expect(swing(spent, [2], { commit: false }).attack?.answers).toBeUndefined();
  });
});

describe("a die added to a failed roll, spent only on a success (Peerless Skill)", () => {
  const bard = definition("Lyra", [
    SWORD,
    answerAction(
      "peerless-skill",
      "Peerless Skill",
      { rolls: ["check", "attack"], when: "failure", effect: { kind: "add", amount: "1d10", keepUseOnFailure: true } },
      { uses: { limit: 3, per: "long-rest", pool: "bardic-inspiration" } }
    )
  ]);

  it("adds the die to a missed attack, which hits and spends the use", () => {
    const game = table(bard);
    swing(game, [8], { commit: false });
    expect(swing(game, [6], { commit: false, answer: { id: "peerless-skill" } }).attack).toMatchObject({
      total: 18,
      outcome: "hit"
    });
    expect(hero(game).actionUses["bardic-inspiration"]).toBe(1);
  });

  it("keeps the use when the attack still misses", () => {
    const game = table(bard);
    swing(game, [2], { commit: false });
    expect(swing(game, [1], { commit: false, answer: { id: "peerless-skill" } }).attack).toMatchObject({
      total: 7,
      outcome: "miss"
    });
    expect(hero(game).actionUses["bardic-inspiration"]).toBeUndefined();
  });
});

describe("a Bardic Inspiration die given to another creature", () => {
  const inspire: ActionInput = {
    id: "bardic-inspiration",
    name: "Bardic Inspiration",
    activation: "bonus-action",
    description: "Inspire another creature.",
    damage: [],
    uses: { limit: 3, per: "long-rest" },
    grants: {
      name: "Bardic Inspiration",
      tags: ["bardic-inspiration"],
      target: "target",
      duration: { type: "manual" },
      notSelf: true,
      onlyOne: true,
      answer: {
        rolls: ["attack", "save", "check", "death-save"],
        when: "failure",
        effect: { kind: "add", amount: "1d8" }
      }
    }
  };
  const lyra = definition("Lyra", [SWORD, inspire]);
  const borin = definition("Borin", [SWORD]);
  const inspireTo = (game: GameState, targetId: string) =>
    resolveDefinitionAction(
      game,
      lyra.actions.find((action) => action.id === "bardic-inspiration")!,
      { actorId: IDS.bard, targetIds: [targetId], commandId: nextId(), override: { families: ["economy"] } },
      {
        random: dice([]),
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: () => NOW,
        definition: lyra,
        resolveDefinition: lookup(game)
      }
    );

  it("is held by the ally, added to its failed save, and spent", () => {
    const game = table(borin, lyra);
    inspireTo(game, IDS.hero);
    expect(hero(game).effects.map((effect) => effect.name)).toEqual(["Bardic Inspiration"]);
    const saveId = oweSave(game);
    const preview = save(game, saveId, [10], false);
    const offer = preview.outcome.answers?.[0];
    expect(offer).toMatchObject({ name: "Bardic Inspiration", does: "+1d8" });
    expect(save(game, saveId, [6], false, { answer: { id: offer!.id } }).outcome).toMatchObject({
      success: true,
      total: 16
    });
    expect(hero(game).effects).toEqual([]);
  });

  it("isn't given to the bard itself, or to a creature that already holds one", () => {
    const game = table(borin, lyra);
    expect(() => inspireTo(game, IDS.bard)).toThrow(/another creature/);
    inspireTo(game, IDS.hero);
    expect(() => inspireTo(game, IDS.hero)).toThrow(/only one at a time/);
  });
});

describe("a failed Dexterity save turned into a success with a Reaction (Ring of Evasion)", () => {
  const wearer = definition("Kara", [
    SWORD,
    answerAction(
      "evade",
      "Evade",
      { rolls: ["save"], when: "failure", abilities: ["dex"], effect: { kind: "succeed" } },
      { activation: "reaction", uses: { limit: 3, per: "long-rest", pool: "ring-of-evasion-charges" } }
    )
  ]);

  it("spends the Reaction and a charge, and the save succeeds", () => {
    const game = table(wearer);
    const saveId = oweSave(game, {
      ability: "dex",
      proposedDamage: 20,
      proposedDamageParts: [{ amount: 20, type: "fire" }],
      halfOnSuccess: true
    });
    save(game, saveId, [4], false);
    expect(save(game, saveId, [], false, { answer: { id: "evade" } }).outcome).toMatchObject({
      success: true,
      appliedDamage: 10
    });
    expect(game.combat.reactionsUsed).toContain(IDS.hero);
    expect(hero(game).actionUses["ring-of-evasion-charges"]).toBe(1);
    expect(save(game, saveId, [], true).outcome).toMatchObject({ success: true, appliedDamage: 10 });
  });

  it("isn't offered on a Wisdom save, or with the Reaction spent", () => {
    const game = table(wearer);
    expect(save(game, oweSave(game), [4], false).outcome.answers).toBeUndefined();
    game.combat.reactionsUsed = [IDS.hero];
    expect(save(game, oweSave(game, { ability: "dex" }), [4], false).outcome.answers).toBeUndefined();
  });
});

describe("a reroll that needs the bearer able to act (a Luck Blade's luck)", () => {
  const wielder = definition("Corin", [
    SWORD,
    answerAction(
      "luck",
      "Luck",
      {
        rolls: ["attack", "save", "check", "death-save"],
        when: "failure",
        notWhileIncapacitated: true,
        effect: { kind: "reroll" }
      },
      { uses: { limit: 1, per: "long-rest" } }
    )
  ]);

  it("rerolls a failed save once a day, and never while Incapacitated", () => {
    const game = table(wielder);
    const saveId = oweSave(game);
    save(game, saveId, [5], false);
    expect(save(game, saveId, [17], false, { answer: { id: "luck" } }).outcome).toMatchObject({ success: true });
    hero(game).actionUses = {};
    setCondition(game, IDS.hero, "incapacitated", true, undefined, GM);
    expect(save(game, oweSave(game), [5], false).outcome.answers).toBeUndefined();
  });
});

describe("a save against a spell aimed at the bearer alone (Staff of Charming's Resist Enchantment)", () => {
  const holder = definition("Wren", [
    SWORD,
    answerAction(
      "resist-enchantment",
      "Resist Enchantment",
      {
        rolls: ["save"],
        when: "failure",
        versus: { spellSchools: ["enchantment"], singleTarget: true },
        effect: { kind: "succeed" }
      },
      { uses: { limit: 1, per: "long-rest" } }
    )
  ]);

  it("turns a failed save against Charm Person aimed only at the holder into a success", () => {
    const game = table(holder);
    const saveId = oweSave(game, {
      conditionIds: ["charmed"],
      spell: { id: "charm-person", school: "enchantment", level: 1, singleTarget: true }
    });
    save(game, saveId, [3], false);
    expect(save(game, saveId, [], false, { answer: { id: "resist-enchantment" } }).outcome.success).toBe(true);
  });

  it("isn't offered against an Enchantment spell aimed at several creatures, or another school", () => {
    const game = table(holder);
    const many = oweSave(game, { spell: { id: "hold-person", school: "enchantment", level: 3, singleTarget: false } });
    expect(save(game, many, [3], false).outcome.answers).toBeUndefined();
    const fire = oweSave(game, { spell: { id: "fireball", school: "evocation", level: 3, singleTarget: true } });
    expect(save(game, fire, [3], false).outcome.answers).toBeUndefined();
  });
});

// The authored records, built by the real builder from the bundles: the numbers the answers carry.
const policy = BuilderPolicySchema.parse({});
const library = new ContentLibrary().forAudience("gm");

describe("the answers the SRD records carry once built", () => {
  const fighter = (level: number): CharacterCreateRequestInput =>
    ({
      name: "Borin",
      speciesId: "halfling",
      backgroundId: "soldier",
      classId: "fighter",
      level,
      subclassId: "champion",
      abilityMethod: "standard-array",
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      backgroundBonusAllocation: [
        { ability: "str", amount: 2 },
        { ability: "con", amount: 1 }
      ],
      hp: { mode: "average" },
      choices: [
        { level: 1, kind: "language", id: "dwarvish" },
        { level: 1, kind: "language", id: "giant" },
        { level: 1, classId: "fighter", kind: "skill", id: "survival" },
        { level: 1, classId: "fighter", kind: "skill", id: "perception" },
        {
          level: 1,
          classId: "fighter",
          kind: "fighting-style",
          id: "defense",
          payload: { featureId: "fighting-style" }
        },
        ...["greatsword", "flail", "longbow", "rapier"].map((id) => ({
          level: 1,
          classId: "fighter",
          kind: "weapon-mastery",
          id
        })),
        { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
        {
          level: 7,
          classId: "fighter",
          kind: "fighting-style",
          id: "archery",
          payload: { featureId: "additional-fighting-style" }
        },
        ...[4, 6, 8].flatMap((at) => [
          { level: at, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
          { level: at, kind: "ability-score", id: "con", payload: { featureId: "ability-score-improvement" } },
          { level: at, kind: "ability-score", id: "wis", payload: { featureId: "ability-score-improvement" } }
        ]),
        { level: 1, kind: "tool", id: "gaming-set-dice" },
        { level: 1, kind: "equipment", id: "fighter-a" },
        { level: 1, kind: "equipment", id: "soldier-a" }
      ]
    }) as unknown as CharacterCreateRequestInput;

  it("a Fighter 9's Indomitable rerolls with +9, Tactical Mind spends Second Wind, and a halfling has Luck", () => {
    const built = buildCharacterDefinition(fighter(9), library, policy);
    const actionOf = (id: string) => built.actions.find((action) => action.id === id);
    expect(actionOf("indomitable")?.answer?.effect).toEqual({ kind: "reroll", bonus: 9 });
    expect(actionOf("tactical-mind")?.uses).toMatchObject({ pool: "second-wind", limit: 3 });
    expect(actionOf("halfling-luck")?.answer).toMatchObject({
      when: "natural-one",
      effect: { kind: "reroll", one: true }
    });
  });
});

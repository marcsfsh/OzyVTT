import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { actionAvailability, resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { answerReaction, dismissReaction } from "../src/reactions.js";
import { applyDamageDetailed, healActor } from "../src/hit-points.js";
import { setCondition } from "../src/actor-conditions.js";
import { answerSave, saveRollSources } from "../src/saving-throws.js";
import { builtinAction } from "../src/builtin-actions.js";
import { addEffect, endEffect, endEncounterEffects, expireEffectsAtTurnStart, hasEffectTag } from "../src/effects.js";
import { applyRest, spendHitDice } from "../src/rests.js";
import { hitDiceFromDefinition } from "../src/actor-roster.js";
import { applyTimelineRestore, timelineDirtied } from "../src/combat-history.js";
import { projectPlayerCombat, projectPlayerView } from "../src/projections.js";
import { setLegendaryUsed } from "../src/turn-economy.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { creatureDistance, mapDistance, tokenCreatureDistance } from "../src/movement-narration.js";
import { gridToImage } from "../src/grid-calibration.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";

/**
 * Regression suite derived from the two archived replay encounters (Torva/Pip/Sable vs two giant
 * crocodiles): the manual GM run's rules mistakes - double Frenzy with no Rage on round 1, a
 * single-roll Extra Attack, unresisted crocodile damage against a raging barbarian, grapples that
 * never existed as state, and 1-HP procedural heals standing in for a dying state - must now be
 * blocked, guided, or engine-owned (ADR-0020). Numbers reference the gap-analysis report's tests.
 */

const IDS = {
  torva: "10000000-0000-4000-8000-000000000001",
  pip: "10000000-0000-4000-8000-000000000002",
  sable: "10000000-0000-4000-8000-000000000003",
  croc1: "10000000-0000-4000-8000-000000000004",
  croc2: "10000000-0000-4000-8000-000000000005",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const torvaDefinition = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
const pipDefinition = ActorDefinitionSchema.parse(loadActorFixture("pip-underbough"));
const sableDefinition = ActorDefinitionSchema.parse(loadActorFixture("sable-vex"));
const crocodileDefinition = loadMonsterDefinitions().find((monster) => monster.source.externalId === "giant-crocodile")!;

const actionOf = (definition: ActorDefinition, id: string) => definition.actions.find((action) => action.id === id)!;

let commandCounter = 0;
const nextCommandId = () => `50000000-0000-4000-8000-${String(++commandCounter).padStart(12, "0")}`;

function deps(faces: number[], definition?: ActorDefinition, distanceFeet?: (a: string, b: string) => number | null): ResolveDependencies {
  let rollIndex = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-${String(rollIndex++).padStart(12, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-07-18T00:00:00.000Z",
    hasCondition: () => true,
    definition,
    distanceFeet
  };
}

/** The replay party + crocodiles, definitions stored, encounter live in the given initiative order. */
function buildGame(order: readonly { actorId: string; score: number }[] = [
  { actorId: IDS.torva, score: 16 }, { actorId: IDS.pip, score: 12 }, { actorId: IDS.croc2, score: 12 }, { actorId: IDS.croc1, score: 8 }, { actorId: IDS.sable, score: 5 }
]): GameState {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.torva, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current: 75, maximum: 75 }, armorClass: 15, definitionId: "import-torva", size: "medium", speedFeet: 40 },
      { id: IDS.pip, name: "Pip Underbough", kind: "player-character", visibility: "public", hp: { current: 52, maximum: 52 }, armorClass: 16, definitionId: "import-pip", size: "small", speedFeet: 25 },
      { id: IDS.sable, name: "Sable Vex", kind: "player-character", visibility: "public", hp: { current: 52, maximum: 52 }, armorClass: 13, definitionId: "import-sable", size: "medium", speedFeet: 30 },
      { id: IDS.croc1, name: "Giant Crocodile", kind: "monster", visibility: "public", hp: { current: 85, maximum: 85 }, armorClass: 14, definitionId: "giant-crocodile", size: "huge", speedFeet: 30 },
      { id: IDS.croc2, name: "Giant Crocodile 2", kind: "monster", visibility: "public", hp: { current: 85, maximum: 85 }, armorClass: 14, definitionId: "giant-crocodile", size: "huge", speedFeet: 30 }
    ],
    definitions: [
      { id: "import-torva", definition: torvaDefinition },
      { id: "import-pip", definition: pipDefinition },
      { id: "import-sable", definition: sableDefinition },
      { id: "giant-crocodile", definition: crocodileDefinition }
    ]
  });
  startEncounter(game, { mapAssetId: IDS.map, entries: order }, () => 1, GEOMETRY, (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition);
  return game;
}

const resolve = (game: GameState, definition: ActorDefinition, actionId: string, input: { actorId: string; targetIds?: readonly string[]; rollMode?: "advantage" | "disadvantage" | "normal"; override?: { reason: string } }, faces: number[], distanceFeet?: (a: string, b: string) => number | null) =>
  resolveDefinitionAction(game, actionOf(definition, actionId), { actorId: input.actorId, targetIds: input.targetIds ?? [], commandId: nextCommandId(), rollMode: input.rollMode ?? null, override: input.override ?? null }, deps(faces, definition, distanceFeet));

describe("report test 1 - Rage and Frenzy on round 1", () => {
  it("blocks Frenzy without an active Rage, offers the legal path, and blocks a second bonus action", () => {
    const game = buildGame();
    // The manual run's very first mistake: Frenzy with no Rage.
    expect(() => resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []))
      .toThrow(RulesBlockedError);
    expect(() => resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []))
      .toThrow(/requires an active Raging effect/);

    // The legal path: Rage as the bonus action grants the effect and spends a use.
    const rage = resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    expect(rage.effectGranted).toEqual({ name: "Rage", tags: ["raging"] });
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    expect(torva.effects.map((effect) => effect.name)).toEqual(["Rage"]);
    expect(torva.actionUses.rage).toBe(1);
    expect(game.combat.turn.bonusActionUsed).toBe(true);

    // Frenzy now satisfies its Rage requirement but the bonus action is spent - the round-1 double
    // Frenzy the manual run performed is exactly what strict mode rejects.
    expect(() => resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []))
      .toThrow(/already used a bonus action/);
    try {
      resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("economy.bonus-action-used");
      expect((error as RulesBlockedError).overridable).toBe(true);
    }
  });

  it("rejects a fifth Rage once the long-rest pool is spent", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    torva.actionUses = { rage: 4 };
    expect(() => resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []))
      .toThrow(/no uses remaining \(4\/long rest\)/);
  });

  it("allows the invalid sequence in assisted mode but reports the conflicts as warnings", () => {
    const game = buildGame();
    game.combat = { ...game.combat, rulesMode: "assisted" };
    const frenzy = resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    expect(frenzy.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/requires an active Raging effect/)]));
    expect(frenzy.attack?.outcome).toBe("hit");
  });
});

describe("report test 2 - Extra Attack", () => {
  it("gives the Attack action two attacks consuming one action slot, then blocks a third", () => {
    const game = buildGame();
    const first = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    expect(first.attack?.outcome).toBe("hit"); // 15 + 7 = 22 vs AC 14
    expect(game.combat.turn.actionUsed).toBe(true);
    expect(first.componentsRemaining).toEqual({ attack: 1 });

    // Attack 2 of 2 may even switch weapons (SRD Extra Attack) - the pool is generic.
    const second = resolve(game, torvaDefinition, "handaxe-thrown", { actorId: IDS.torva, targetIds: [IDS.croc2] }, [12, 4]);
    expect(second.attack?.outcome).toBe("hit");
    expect(second.componentsRemaining).toBeNull();

    expect(() => resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []))
      .toThrow(/no attacks remaining in this action/);
  });
});

describe("report test 3 - Reckless Attack", () => {
  it("grants advantage on Torva's attacks this turn and advantage to attacks against her until her next turn", () => {
    const game = buildGame([{ actorId: IDS.torva, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    const reckless = resolve(game, torvaDefinition, "reckless-attack", { actorId: IDS.torva }, []);
    expect(reckless.effectGranted?.tags).toEqual(["reckless"]);

    const attack = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [3, 18, 6]);
    expect(attack.rollMode).toEqual({ mode: "advantage", advantage: ["Reckless Attack"], disadvantage: [] });
    expect(attack.attack?.naturalRoll).toBe(18); // 2d20kh1 kept the higher die

    // The crocodile's turn: attacks against the reckless barbarian have advantage too.
    nextInitiativeTurn(game);
    const bite = resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.torva] }, [2, 19, 5, 5, 5]);
    expect(bite.rollMode?.mode).toBe("advantage");
    expect(bite.rollMode?.advantage).toEqual(["Target: Reckless Attack"]);

    // Reckless expires when Torva's own next turn starts (the crocodile's grapple, if it landed, is
    // its own source-linked effect and rightly persists).
    nextInitiativeTurn(game);
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects.filter((effect) => effect.tags.includes("reckless"))).toEqual([]);
  });
});

describe("report test 4 - Rage damage and resistance", () => {
  it("adds +2 rage damage as an explainable bonus line", () => {
    const game = buildGame();
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    const attack = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    expect(attack.bonusDamage).toEqual([{ amount: 2, type: "slashing", source: "Rage" }]);
    expect(attack.damageTotal).toBe(12); // 1d12(6) + 4 + 2
  });

  it("halves the crocodile's typed damage against the raging barbarian with a visible breakdown (17 → 8)", () => {
    const game = buildGame();
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    const outcome = applyDamageDetailed(game, IDS.torva, { amount: 17, parts: [{ amount: 17, type: "bludgeoning" }], sourceName: "Giant Crocodile" }, { role: "gm" }, { resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition });
    expect(outcome.application.parts).toEqual([{ type: "bludgeoning", amount: 17, adjusted: 8, adjustment: "resistance", adjustmentSource: "Rage" }]);
    expect(outcome.application.totalApplied).toBe(8);
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.hp.current).toBe(67);
  });
});

describe("report test 5 - critical hits and Savage Attacks", () => {
  it("doubles the dice and adds exactly one declared bonus weapon die on a natural 20", () => {
    const game = buildGame();
    const crit = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [20, 6, 6, 6]);
    expect(crit.crit).toBe(true);
    expect(crit.damage).toEqual([{ formula: "3d12 + 4", type: "slashing", total: 22 }]); // 2 doubled + 1 Savage Attacks
  });
});

describe("report test 6 (partial) - Sneak Attack once per turn", () => {
  it("spends the shared per-turn pool and refreshes it on the next turn", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 12 }, { actorId: IDS.croc1, score: 8 }]);
    const first = resolve(game, pipDefinition, "rapier-sneak-attack", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [15, 5, 3, 3, 3, 3]);
    expect(first.attack?.outcome).toBe("hit");
    expect(game.combat.turn.turnUses[`${IDS.pip}:sneak-attack`]).toBe(1);
    expect(() => resolve(game, pipDefinition, "rapier-sneak-attack", { actorId: IDS.pip, targetIds: [IDS.croc1] }, []))
      .toThrow(/no uses remaining \(1\/turn\)/);
    nextInitiativeTurn(game);
    expect(game.combat.turn.turnUses).toEqual({});
  });
});

describe("report test 8 - crocodile Multiattack, grapple riders, and target rules", () => {
  it("tracks one Bite + one Tail per Multiattack, applies the source-linked grapple, and forbids Tail against the held target", () => {
    const game = buildGame([{ actorId: IDS.croc1, score: 20 }, { actorId: IDS.pip, score: 12 }, { actorId: IDS.torva, score: 8 }]);

    // Bite opens the Multiattack plan and, on a hit, grapples: Grappled + Restrained as ONE
    // source-linked effect carrying the printed escape DC - the state the manual run never had.
    const bite = resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 5, 5, 5]);
    expect(bite.attack?.outcome).toBe("hit");
    expect(bite.componentsRemaining).toEqual({ bite: 0, tail: 1 });
    expect(bite.effectsApplied).toEqual([{ targetId: IDS.pip, targetName: "Pip Underbough", name: "Grappled by Giant Crocodile (Bite)", conditionIds: ["grappled", "restrained"] }]);
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.conditions.map((condition) => condition.id)).toEqual(["grappled", "restrained"]);
    expect(pip.effects[0].escapeDc).toBe(15);
    expect(pip.effects[0].sourceActorId).toBe(IDS.croc1);

    // "…can't be targeted by the crocodile's Tail."
    expect(() => resolve(game, crocodileDefinition, "tail", { actorId: IDS.croc1, targetIds: [IDS.pip] }, []))
      .toThrow(/grappled by Giant Crocodile and can't be targeted by Tail/);

    // Tail against someone else consumes the remaining component and knocks them Prone.
    const tail = resolve(game, crocodileDefinition, "tail", { actorId: IDS.croc1, targetIds: [IDS.torva] }, [15, 4, 4, 4]);
    expect(tail.effectsApplied?.[0].conditionIds).toEqual(["prone"]);
    expect(tail.componentsRemaining).toBeNull();
    expect(() => resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.torva] }, []))
      .toThrow(/no attacks remaining/);

    // Defeating the crocodile releases everything it sustained: the replay's lost-grapple bug, inverted.
    applyDamageDetailed(game, IDS.croc1, { amount: 85 }, { role: "gm" });
    expect(game.actors.find((actor) => actor.id === IDS.pip)!.conditions).toEqual([]);
    expect(game.actors.find((actor) => actor.id === IDS.pip)!.effects).toEqual([]);
  });

  it("skips the grapple rider for targets above the printed size cap", () => {
    const game = buildGame();
    const gargantuan = game.actors.find((actor) => actor.id === IDS.croc2)!;
    gargantuan.size = "gargantuan";
    nextInitiativeTurn(game); nextInitiativeTurn(game); nextInitiativeTurn(game); // croc1's turn
    const bite = resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.croc2] }, [15, 5, 5, 5]);
    expect(bite.effectsApplied).toBeUndefined();
    expect(bite.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/too large/)]));
  });
});

describe("report test 9 - zero HP, dying, and healing", () => {
  it("drops a player character into the dying state instead of a bare 0", () => {
    const game = buildGame();
    const outcome = applyDamageDetailed(game, IDS.pip, { amount: 60, parts: [{ amount: 60, type: "piercing" }] }, { role: "gm" });
    expect(outcome.application.droppedToZero).toBe(true);
    expect(outcome.application.instantDeath).toBe(false);
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    expect(pip.conditions.map((condition) => condition.id)).toEqual(["prone", "unconscious"]);
  });

  it("ticks death-save failures for damage while dying (two on a crit) and kills on massive overflow", () => {
    const game = buildGame();
    applyDamageDetailed(game, IDS.pip, { amount: 52 }, { role: "gm" });
    expect(applyDamageDetailed(game, IDS.pip, { amount: 5 }, { role: "gm" }).application.deathSaveFailuresAdded).toBe(1);
    expect(applyDamageDetailed(game, IDS.pip, { amount: 5, critical: true }, { role: "gm" }).application.deathSaveFailuresAdded).toBe(2);
    expect(game.actors.find((actor) => actor.id === IDS.pip)!.deathSaves?.failures).toBe(3);

    const fresh = buildGame();
    const overkill = applyDamageDetailed(fresh, IDS.pip, { amount: 104, parts: [{ amount: 104, type: "fire" }] }, { role: "gm" });
    expect(overkill.application.instantDeath).toBe(true);
  });

  it("healing from 0 restores consciousness and clears the dying state; Prone stays until they stand", () => {
    const game = buildGame();
    applyDamageDetailed(game, IDS.pip, { amount: 60 }, { role: "gm" });
    const events = healActor(game, IDS.pip, 5, { role: "gm" });
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.hp.current).toBe(5);
    expect(pip.deathSaves).toBeNull();
    expect(pip.conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(events).toEqual([{ kind: "condition", text: "Pip Underbough regained consciousness.", actorId: IDS.pip }]);
  });
});

describe("report test 12 - GM override", () => {
  it("rejects an illegal second bonus action, then allows it with an audited override", () => {
    const game = buildGame();
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    expect(() => resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []))
      .toThrow(RulesBlockedError);
    const overridden = resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1], override: { reason: "Homebrew: haste variant grants a second bonus action" } }, [15, 6]);
    expect(overridden.overridden).toEqual({ rule: "economy.bonus-action-used", reason: "Homebrew: haste variant grants a second bonus action" });
    expect(overridden.attack?.outcome).toBe("hit");
  });
});

describe("effect lifecycle - Frenzy's Exhaustion and Rage duration", () => {
  it("fires Exhaustion exactly once when the Frenzied Rage ends, however it ends", () => {
    const game = buildGame();
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1], override: { reason: "test: frenzy same turn" } }, [15, 6]);
    // Re-resolving Frenzy on a later turn refreshes the single marker, never stacks it.
    nextInitiativeTurn(game); nextInitiativeTurn(game); nextInitiativeTurn(game); nextInitiativeTurn(game); nextInitiativeTurn(game);
    resolve(game, torvaDefinition, "frenzy", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    expect(torva.effects.filter((effect) => effect.tags.includes("frenzied"))).toHaveLength(1);

    // Ending the Rage cascades the Frenzied marker (endsWithTag) and its Exhaustion lands once.
    const rageEffect = torva.effects.find((effect) => effect.tags.includes("raging"))!;
    endEffect(game, IDS.torva, rageEffect.id);
    expect(torva.effects).toEqual([]);
    expect(torva.conditions).toEqual([{ id: "exhaustion", level: 1 }]);
  });

  it("ends the fight's effects at encounter end but leaves non-combatants' effects alone (parked scenes)", () => {
    const game = buildGame([{ actorId: IDS.torva, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    // Sable is not in this fight - a parked scene's effect on her must survive the sweep.
    const sable = game.actors.find((actor) => actor.id === IDS.sable)!;
    sable.effects = [{ id: "parked", name: "Parked Blessing", tags: [], sourceActorId: null, sourceName: null, sourceActionId: null, startedRound: 1, duration: { type: "encounter" }, endsWhenSourceDefeated: false, modifiers: [], linkedConditionIds: [], escapeDc: null, onEnd: [], endsWithTag: null }];
    endEncounterEffects(game, game.combat.initiative.map((entry) => entry.actorId));
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects).toEqual([]);
    expect(sable.effects).toHaveLength(1);
  });

  it("counts Rage down by rounds at Torva's own turn start", () => {
    const game = buildGame([{ actorId: IDS.torva, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    expireEffectsAtTurnStart(game, IDS.torva);
    const rage = game.actors.find((actor) => actor.id === IDS.torva)!.effects[0];
    expect(rage.duration).toEqual({ type: "rounds", remaining: 9 });
  });

  it("a raging character dropped to 0 HP stops raging (and the Frenzy marker follows)", () => {
    const game = buildGame();
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    applyDamageDetailed(game, IDS.torva, { amount: 75 }, { role: "gm" });
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    expect(torva.effects).toEqual([]);
    expect(torva.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
  });
});

describe("timeline restore covers rules-engine state", () => {
  it("rewinding across a Rage grant and dying transition restores effects, death saves, and uses", () => {
    const game = buildGame();
    const snapshot = structuredClone(game);
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    applyDamageDetailed(game, IDS.pip, { amount: 60 }, { role: "gm" });
    applyTimelineRestore(game, snapshot, null);
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(torva.effects).toEqual([]);
    expect(torva.actionUses).toEqual({});
    expect(pip.deathSaves).toBeNull();
    // The strict engine accepts the replayed turn from the restored state.
    expect(resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []).effectGranted?.name).toBe("Rage");
  });
});

describe("advantage aggregation from conditions and distance", () => {
  it("prone targets give advantage within 5 feet and disadvantage beyond (2024 rule)", () => {
    const game = buildGame([{ actorId: IDS.torva, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    const croc = game.actors.find((actor) => actor.id === IDS.croc1)!;
    croc.conditions = [{ id: "prone" }];
    const adjacent = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [3, 18, 6], () => 5);
    expect(adjacent.rollMode).toEqual({ mode: "advantage", advantage: ["Target is Prone (within 5 ft)"], disadvantage: [] });
    const far = buildGame([{ actorId: IDS.torva, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    far.actors.find((actor) => actor.id === IDS.croc1)!.conditions = [{ id: "prone" }];
    const beyond = resolve(far, torvaDefinition, "handaxe-thrown", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [18, 3, 4], () => 30);
    expect(beyond.rollMode).toEqual({ mode: "disadvantage", advantage: [], disadvantage: ["Target is Prone (beyond 5 ft)"] });
  });

  it("cancels advantage against disadvantage and explains both sides", () => {
    const game = buildGame([{ actorId: IDS.torva, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    resolve(game, torvaDefinition, "reckless-attack", { actorId: IDS.torva }, []);
    game.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "poisoned" }];
    const attack = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    expect(attack.rollMode).toEqual({ mode: "normal", advantage: ["Reckless Attack"], disadvantage: ["Attacker is Poisoned"] });
  });

  it("upgrades a hit on an adjacent unconscious target to a critical hit", () => {
    const game = buildGame([{ actorId: IDS.croc1, score: 20 }, { actorId: IDS.pip, score: 12 }]);
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    pip.conditions = [{ id: "unconscious" }];
    const bite = resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [2, 12, 5, 5, 5, 5, 5, 5], () => 5);
    expect(bite.rollMode?.advantage).toEqual(["Target is Unconscious"]);
    expect(bite.attack?.outcome).toBe("crit"); // 12 + 8 = 20 vs AC 16, adjacent + unconscious
    expect(bite.crit).toBe(true);
  });
});

describe("prose-only Multiattack degrades strict blocking to warnings", () => {
  it("warns instead of rejecting extra attacks for a monster whose Multiattack is unstructured", () => {
    const proseDefinition = ActorDefinitionSchema.parse({
      schemaId: "vtt.actor-monster", schemaVersion: 1, source: { name: "Test", version: "1", externalId: "prose-beast" },
      name: "Prose Beast", size: "large", abilityScores: { str: 18, dex: 12, con: 16, int: 4, wis: 10, cha: 6 },
      proficiencyBonus: 3, armorClass: 14, hitPoints: { maximum: 60 }, speedFeet: 40,
      actions: [
        { id: "multiattack", name: "Multiattack", activation: "action", description: "The beast attacks twice, in any combination.", damage: [] },
        { id: "claw", name: "Claw", activation: "action", description: "Melee Attack Roll: +7.", attack: { bonus: 7, reachFeet: 5 }, damage: [{ formula: "1d8 + 4", type: "slashing" }] }
      ]
    });
    const game = buildGame();
    const croc = game.actors.find((actor) => actor.id === IDS.croc2)!;
    croc.definitionId = "prose-beast";
    game.definitions = [...game.definitions, { id: "prose-beast", definition: proseDefinition }];
    // Default order ties Pip and Croc 2 at 12; name order puts "Giant Crocodile 2" first.
    nextInitiativeTurn(game); // croc2's turn
    resolveDefinitionAction(game, proseDefinition.actions[1], { actorId: IDS.croc2, targetIds: [IDS.torva], commandId: nextCommandId() }, deps([15, 5], proseDefinition));
    const second = resolveDefinitionAction(game, proseDefinition.actions[1], { actorId: IDS.croc2, targetIds: [IDS.torva], commandId: nextCommandId() }, deps([15, 5], proseDefinition));
    expect(second.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Multiattack is prose-only/)]));
    expect(second.attack?.outcome).toBe("hit");
  });
});

describe("report test 2/3 supplement - Eldritch Blast beams", () => {
  it("gives the level-7 warlock two beams on one action, each with its own target", () => {
    const game = buildGame([{ actorId: IDS.sable, score: 16 }, { actorId: IDS.croc1, score: 8 }]);
    const first = resolve(game, sableDefinition, "eldritch-blast", { actorId: IDS.sable, targetIds: [IDS.croc1] }, [15, 7]);
    expect(first.componentsRemaining).toEqual({ attack: 1 });
    const second = resolve(game, sableDefinition, "eldritch-blast", { actorId: IDS.sable, targetIds: [IDS.croc1] }, [12, 3]);
    expect(second.componentsRemaining).toBeNull();
    expect(() => resolve(game, sableDefinition, "eldritch-blast", { actorId: IDS.sable, targetIds: [IDS.croc1] }, []))
      .toThrow(/no attacks remaining/);
  });
});

describe("reaction prompts - Uncanny Dodge (ADR-0020 amendment)", () => {
  // Prompt creation needs the TARGET's definition, so these resolves carry the game's own resolver.
  const gameResolver = (game: GameState) => (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition;
  const reactionDeps = (game: GameState, faces: number[] = []) => ({
    resolveDefinition: gameResolver(game),
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-${String(900 + faces.length).padStart(12, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-07-18T00:00:00.000Z"
  });
  const resolveLive = (game: GameState, definition: ActorDefinition, actionId: string, input: { actorId: string; targetIds?: readonly string[] }, faces: number[]) =>
    resolveDefinitionAction(game, actionOf(definition, actionId), { actorId: input.actorId, targetIds: input.targetIds ?? [], commandId: nextCommandId() }, { ...deps(faces, definition), resolveDefinition: gameResolver(game) });

  it("parks a hit's damage on a pending prompt instead of the apply button", () => {
    const game = buildGame();
    // Croc 1 bites Pip: 15 + 8 = 23 vs AC 16 hits; 6+6+6+5 = 23 piercing.
    const bite = resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    expect(bite.reactionPrompts).toEqual([{ actorId: IDS.pip, actorName: "Pip Underbough", actionName: "Uncanny Dodge" }]);
    expect(game.combat.pendingReactions).toHaveLength(1);
    const prompt = game.combat.pendingReactions[0];
    expect(prompt).toMatchObject({ actorId: IDS.pip, actionId: "uncanny-dodge", sourceActorId: IDS.croc1, sourceName: "Giant Crocodile", proposedDamage: 23, proposedDamageParts: [{ amount: 23, type: "piercing" }], critical: false });
    // The bite's grapple rider still applied immediately - only the DAMAGE waits on the answer.
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.conditions.map((condition) => condition.id).sort()).toEqual(["grappled", "restrained"]);
    expect(pip.hp.current).toBe(52); // nothing applied yet
  });

  it("answering use spends the reaction and applies half; the prompt clears", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    const outcome = answerReaction(game, nextCommandId(), game.combat.pendingReactions[0].id, true, undefined, { role: "gm" }, reactionDeps(game));
    expect(outcome).toMatchObject({ used: true, appliedDamage: 11, actorName: "Pip Underbough", actionName: "Uncanny Dodge" }); // floor(23/2)
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.hp.current).toBe(52 - 11);
    expect(game.combat.reactionsUsed).toContain(IDS.pip);
    expect(game.combat.pendingReactions).toHaveLength(0);
  });

  it("declining applies the full parked damage and keeps the reaction", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    const outcome = answerReaction(game, nextCommandId(), game.combat.pendingReactions[0].id, false, undefined, { role: "gm" }, reactionDeps(game));
    expect(outcome).toMatchObject({ used: false, appliedDamage: 23 });
    expect(game.actors.find((actor) => actor.id === IDS.pip)!.hp.current).toBe(52 - 23);
    expect(game.combat.reactionsUsed).not.toContain(IDS.pip);
    expect(game.combat.pendingReactions).toHaveLength(0);
  });

  it("offers no prompt when the reaction is already spent, the reactor is incapacitated, or the mode is freeform", () => {
    const spent = buildGame();
    spent.combat = { ...spent.combat, reactionsUsed: [IDS.pip] };
    expect(resolveLive(spent, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]).reactionPrompts).toBeUndefined();
    expect(spent.combat.pendingReactions).toHaveLength(0);

    const stunned = buildGame();
    stunned.actors.find((actor) => actor.id === IDS.pip)!.conditions = [{ id: "stunned" }];
    // A stunned target gives the attack advantage, so the roll consumes two d20 faces.
    expect(resolveLive(stunned, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 3, 6, 6, 6]).reactionPrompts).toBeUndefined();

    const freeform = buildGame();
    freeform.combat = { ...freeform.combat, rulesMode: "freeform" };
    expect(resolveLive(freeform, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]).reactionPrompts).toBeUndefined();
  });

  it("a spent reaction rejects use (decline stays open) and the GM dismiss drops the prompt without damage", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    game.combat = { ...game.combat, reactionsUsed: [IDS.pip] }; // spent between the hit and the answer
    const promptId = game.combat.pendingReactions[0].id;
    expect(() => answerReaction(game, nextCommandId(), promptId, true, undefined, { role: "gm" }, reactionDeps(game)))
      .toThrow(/already used a reaction/);
    expect(game.combat.pendingReactions).toHaveLength(1); // still owed an answer
    expect(() => dismissReaction(game, promptId, { role: "player", sessionId: IDS.gmSession })).toThrow(/Only the GM/);
    dismissReaction(game, promptId, { role: "gm" });
    expect(game.combat.pendingReactions).toHaveLength(0);
    expect(game.actors.find((actor) => actor.id === IDS.pip)!.hp.current).toBe(52); // dismiss never applies damage
  });

  it("a player may answer only their own claimed character's prompt", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    const promptId = game.combat.pendingReactions[0].id;
    expect(() => answerReaction(game, nextCommandId(), promptId, true, undefined, { role: "player", sessionId: IDS.gmSession }, reactionDeps(game)))
      .toThrow();
    game.actors.find((actor) => actor.id === IDS.pip)!.ownerSessionId = IDS.gmSession;
    const outcome = answerReaction(game, nextCommandId(), promptId, true, undefined, { role: "player", sessionId: IDS.gmSession }, reactionDeps(game));
    expect(outcome.used).toBe(true);
  });

  it("prompts persist across a turn advance so parked damage is never silently lost", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    nextInitiativeTurn(game);
    expect(game.combat.pendingReactions).toHaveLength(1);
  });
});

describe("incapacitation gates the action economy (SRD 2024 Incapacitated)", () => {
  it("blocks actions, bonus actions, and reactions for an incapacitated combatant, with the rule named", () => {
    const game = buildGame();
    game.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "unconscious" }];
    try {
      resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("condition.incapacitated");
    }
    expect(() => resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []))
      .toThrow(/Unconscious and can't take actions, bonus actions, or reactions/);
  });
});

describe("available-actions projection (server-computed availability)", () => {
  it("reports the same rules the resolve path enforces, with uses and instance counts", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    const before = actionAvailability(game, torva, torvaDefinition.actions, torvaDefinition);
    const frenzyRow = before.find((row) => row.id === "frenzy")!;
    expect(frenzyRow.available).toBe(false);
    expect(frenzyRow.violations.map((violation) => violation.rule)).toContain("feature.requires-effect");
    const rageRow = before.find((row) => row.id === "rage")!;
    expect(rageRow).toMatchObject({ available: true, usesRemaining: 4 });

    // Rage, then the first Greataxe swing: the report tracks the spent bonus action, the spent use,
    // and the open Extra Attack instance.
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6, 6]);
    const after = actionAvailability(game, torva, torvaDefinition.actions, torvaDefinition);
    expect(after.find((row) => row.id === "rage")).toMatchObject({ available: false, usesRemaining: 3 });
    expect(after.find((row) => row.id === "greataxe")).toMatchObject({ available: true, componentsRemaining: 1 });
    expect(after.find((row) => row.id === "frenzy")!.violations.map((violation) => violation.rule)).toContain("economy.bonus-action-used");
  });

  it("never mutates state", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    const snapshot = JSON.stringify(game);
    actionAvailability(game, torva, torvaDefinition.actions, torvaDefinition);
    expect(JSON.stringify(game)).toBe(snapshot);
  });
});

describe("SRD condition modifiers - Tier A completeness (Playing the Game / conditions appendix)", () => {
  it("frightened imposes attack disadvantage with an explainable source", () => {
    const game = buildGame();
    game.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "frightened" }];
    // Disadvantage: two d20 faces, keep the lower (15 → kept 3): 3 + 7 = 10 vs AC 14 misses.
    const swing = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 3]);
    expect(swing.rollMode?.mode).toBe("disadvantage");
    expect(swing.rollMode?.disadvantage).toContain("Attacker is Frightened");
    expect(swing.attack?.outcome).toBe("miss");
  });

  it("invisible grants the unseen attacker advantage and its attackers disadvantage", () => {
    const game = buildGame();
    game.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "invisible" }];
    const out = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [3, 15, 6]);
    expect(out.rollMode?.advantage).toContain("Attacker is Invisible");
    expect(out.attack?.outcome).toBe("hit"); // kept the 15

    const back = buildGame();
    back.actors.find((actor) => actor.id === IDS.pip)!.conditions = [{ id: "invisible" }];
    nextInitiativeTurn(back); // croc2's turn (ties: Giant Crocodile 2 before Pip)
    const bite = resolve(back, crocodileDefinition, "bite", { actorId: IDS.croc2, targetIds: [IDS.pip] }, [18, 4, 6, 6, 6]);
    expect(bite.rollMode?.disadvantage).toContain("Target is Invisible");
  });

  it("a grappled attacker has disadvantage against everyone except the grappler (SRD Grappled)", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    torva.conditions = [{ id: "grappled" }];
    torva.effects = [{
      id: "grip", name: "Grappled by Giant Crocodile", tags: ["grapple"], sourceActorId: IDS.croc1, sourceName: "Giant Crocodile",
      sourceActionId: "bite:0", startedRound: 1, duration: { type: "manual" }, endsWhenSourceDefeated: true, endsWithTag: null,
      modifiers: [], linkedConditionIds: ["grappled"], escapeDc: 15, onEnd: []
    }];
    const versusOther = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc2] }, [15, 3]);
    expect(versusOther.rollMode?.disadvantage).toContain("Attacker is Grappled (target isn't the grappler)");
    const versusGrappler = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    expect(versusGrappler.rollMode).toBeUndefined(); // plain d20 vs the grappler
    expect(versusGrappler.attack?.outcome).toBe("hit");
  });

  it("hitting a Paralyzed creature from within 5 feet is a critical hit (SRD Paralyzed)", () => {
    const game = buildGame();
    game.actors.find((actor) => actor.id === IDS.croc1)!.conditions = [{ id: "paralyzed" }];
    // Paralyzed target also gives advantage: [3, 12] keeps 12 → 19 vs AC 14 hits → upgraded to crit.
    // Crit damage: 1d12 doubled + 1 Savage Attacks die = 3d12.
    const swing = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [3, 12, 6, 6, 6], () => 5);
    expect(swing.attack?.outcome).toBe("crit");
    expect(swing.crit).toBe(true);
    expect(swing.damage[0].total).toBe(6 + 6 + 6 + 4);
  });

  it("exhaustion subtracts 2 × level from attack rolls with an explanatory note (SRD Exhaustion)", () => {
    const game = buildGame();
    game.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "exhaustion", level: 2 }];
    // 11 + 7 − 4 = 14 vs AC 14: still a hit, but only because of equal-or-exceeds.
    const swing = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [11, 6]);
    expect(swing.attack?.total).toBe(14);
    expect(swing.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Exhaustion 2: −4 to the attack roll/)]));
  });

  it("exhaustion level 6 is death - engine-owned for PCs and monsters (SRD Exhaustion)", () => {
    const game = buildGame();
    const events = setCondition(game, IDS.torva, "exhaustion", true, 6, { role: "gm" });
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    expect(torva.hp.current).toBe(0);
    expect(torva.deathSaves).toEqual({ successes: 0, failures: 3, stable: false });
    expect(events.some((event) => /dies of Exhaustion/.test(event.text))).toBe(true);

    setCondition(game, IDS.croc1, "exhaustion", true, 6, { role: "gm" });
    expect(game.actors.find((actor) => actor.id === IDS.croc1)!.hp.current).toBe(0);
  });

  it("petrified grants resistance to all damage and poison immunity (SRD Petrified)", () => {
    const game = buildGame();
    game.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "petrified" }];
    const outcome = applyDamageDetailed(game, IDS.torva, { amount: 27, parts: [{ amount: 17, type: "bludgeoning" }, { amount: 10, type: "poison" }] }, { role: "gm" }, { resolveDefinition: (id) => game.definitions.find((entry) => entry.id === id)?.definition });
    expect(outcome.application.parts).toEqual([
      { type: "bludgeoning", amount: 17, adjusted: 8, adjustment: "resistance", adjustmentSource: "Petrified" },
      { type: "poison", amount: 10, adjusted: 0, adjustment: "immunity", adjustmentSource: "Petrified" }
    ]);
    expect(outcome.application.totalApplied).toBe(8);
  });

  it("condition immunity skips with narration instead of applying (SRD Immunity)", () => {
    const game = buildGame();
    const croc = game.actors.find((actor) => actor.id === IDS.croc1)!;
    croc.conditionImmunities = ["prone"];
    const events = setCondition(game, IDS.croc1, "prone", true, undefined, { role: "gm" });
    expect(croc.conditions.some((condition) => condition.id === "prone")).toBe(false);
    expect(events[0].text).toMatch(/immune to Prone - not applied/);
  });

  it("a charmed creature can't target its charmer with harmful effects (SRD Charmed)", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    torva.conditions = [{ id: "charmed" }];
    torva.effects = [{
      id: "charm", name: "Charmed", tags: [], sourceActorId: IDS.croc1, sourceName: "Giant Crocodile",
      sourceActionId: null, startedRound: 1, duration: { type: "manual" }, endsWhenSourceDefeated: true, endsWithTag: null,
      modifiers: [], linkedConditionIds: ["charmed"], escapeDc: null, onEnd: []
    }];
    try {
      resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("condition.charmed-charmer");
    }
    // Other targets stay legal.
    const other = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc2] }, [15, 6]);
    expect(other.attack?.outcome).toBe("hit");
  });
});

describe("SRD generic actions - builtin catalog (rules glossary [Action] entries)", () => {
  const resolveBuiltin = (game: GameState, actionId: string, input: { actorId: string; targetIds?: readonly string[]; note?: string; effectId?: string }, faces: number[], definition?: ActorDefinition) =>
    resolveDefinitionAction(game, builtinAction(actionId)!, { actorId: input.actorId, targetIds: input.targetIds ?? [], commandId: nextCommandId(), builtin: true, note: input.note ?? null, effectId: input.effectId ?? null, rollMode: null, override: null }, { ...deps(faces, definition), resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition });

  it("Dodge consumes the action, imposes incoming disadvantage and Dex-save advantage, and lapses while incapacitated", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    const dodge = resolveBuiltin(game, "dodge", { actorId: IDS.pip }, [], pipDefinition);
    expect(dodge.effectGranted).toEqual({ name: "Dodging", tags: ["dodging"] });
    expect(game.combat.turn.actionUsed).toBe(true);
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;

    // Incoming attack rolls at disadvantage, labeled.
    const bite = resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [18, 2, 6, 6, 6]);
    expect(bite.rollMode?.disadvantage).toContain("Target: Dodging");
    // Dex saves gain advantage from the same effect.
    expect(saveRollSources(pip, "dex").advantage.map((entry) => entry.label)).toContain("Dodging");
    expect(saveRollSources(pip, "str").advantage).toHaveLength(0);

    // SRD: the benefits lapse while incapacitated (voidWhileIncapacitated).
    pip.conditions = [{ id: "stunned" }];
    expect(saveRollSources(pip, "dex").advantage).toHaveLength(0);
  });

  it("a second builtin action strict-blocks on the spent slot, like any stat-block action", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    resolveBuiltin(game, "disengage", { actorId: IDS.pip }, [], pipDefinition);
    expect(hasEffectTag(game.actors.find((actor) => actor.id === IDS.pip)!, "disengaged")).toBe(true);
    expect(() => resolveBuiltin(game, "dash", { actorId: IDS.pip }, [], pipDefinition)).toThrow(/already used an action/);
  });

  it("Help grants the chosen ally attack advantage that expires at the helper's next turn", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.torva, score: 12 }, { actorId: IDS.croc1, score: 8 }]);
    const help = resolveBuiltin(game, "help", { actorId: IDS.pip, targetIds: [IDS.torva] }, [], pipDefinition);
    expect(help.effectsApplied).toEqual([{ targetId: IDS.torva, targetName: "Torva Grimtusk", name: "Helped", conditionIds: [] }]);

    nextInitiativeTurn(game); // Torva's turn - the bearer attacks with advantage.
    const swing = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [3, 15, 6]);
    expect(swing.rollMode?.advantage).toContain("Helped");

    nextInitiativeTurn(game); // croc
    nextInitiativeTurn(game); // Pip's next turn: the help (sustained by Pip) expires.
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects.some((effect) => effect.name === "Helped")).toBe(false);
  });

  it("Hide rolls Dex (Stealth) vs DC 15, grants Invisible on success, and attacking reveals", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    // Pip Dex +4: face 12 → 16 ≥ 15 succeeds.
    const hide = resolveBuiltin(game, "hide", { actorId: IDS.pip }, [12], pipDefinition);
    expect(hide.check).toMatchObject({ total: 16, dc: 15, success: true });
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.conditions.some((condition) => condition.id === "invisible")).toBe(true);

    // Attacking from hiding: the attack keeps the Invisible advantage, then the Hiding ends.
    game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false, actionInstance: null } };
    const strike = resolve(game, pipDefinition, "rapier", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [2, 18, 5]);
    expect(strike.rollMode?.advantage).toContain("Attacker is Invisible");
    expect(strike.effectsEnded).toEqual([{ actorId: IDS.pip, actorName: "Pip Underbough", name: "Hiding" }]);
    expect(pip.conditions.some((condition) => condition.id === "invisible")).toBe(false);
  });

  it("a failed Hide still spends the action and grants nothing", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    const hide = resolveBuiltin(game, "hide", { actorId: IDS.pip }, [5], pipDefinition);
    expect(hide.check).toMatchObject({ total: 9, dc: 15, success: false });
    expect(game.actors.find((actor) => actor.id === IDS.pip)!.effects).toHaveLength(0);
    expect(game.combat.turn.actionUsed).toBe(true);
  });

  it("Unarmed Strike materializes Str + PB and deals flat 1 + Str Bludgeoning (SRD Unarmed Strike)", () => {
    const game = buildGame();
    // Torva Str +4, PB +3 → attack +7; face 10 → 17 vs AC 14 hits; damage flat 5 bludgeoning.
    const strike = resolveBuiltin(game, "unarmed-strike", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [10], torvaDefinition);
    expect(strike.attack).toMatchObject({ total: 17, outcome: "hit" });
    expect(strike.bonusDamage).toEqual([{ amount: 5, type: "bludgeoning", source: "Unarmed Strike" }]);
    expect(strike.damageTotal).toBe(5);
  });

  it("Unarmed grapple: target saves vs 8 + Str + PB; failure applies the escapable Grappled effect; escape frees; a stunned grappler releases", () => {
    const game = buildGame();
    // Torva grapples Pip (small - within one size): DC 8 + 4 + 3 = 15; Pip's better save is Dex (+7).
    const grapple = resolveBuiltin(game, "unarmed-grapple", { actorId: IDS.torva, targetIds: [IDS.pip] }, [], torvaDefinition);
    expect(grapple.save).toMatchObject({ ability: "dex", dc: 15 });
    expect(game.combat.pendingSaves).toHaveLength(1);
    expect(game.combat.pendingSaves[0].onFailEffect).toMatchObject({ name: "Grappled by Torva Grimtusk", escapeDc: 15, sourceActorId: IDS.torva });

    // Fail the save (face 2 → 9 < 15): the Grappled effect lands with its linked condition.
    const answered = answerSave(game, nextCommandId(), game.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, {
      random: () => 2, newRollId: () => "40000000-0000-4000-8000-000000000099", sessionId: IDS.gmSession, role: "gm", now: () => "2026-07-18T00:00:00.000Z",
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition
    });
    expect(answered.outcome.success).toBe(false);
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.conditions.some((condition) => condition.id === "grappled")).toBe(true);
    const hold = pip.effects.find((effect) => effect.tags.includes("grapple"))!;
    expect(hold.escapeDc).toBe(15);

    // Escape attempt (Pip's turn): Dex +4, face 6 → 10 < 15 fails; face 12 → 16 ≥ 15 frees.
    nextInitiativeTurn(game); // to Pip
    const miss = resolveBuiltin(game, "escape-grapple", { actorId: IDS.pip }, [6], pipDefinition);
    expect(miss.check).toMatchObject({ dc: 15, success: false });
    expect(pip.conditions.some((condition) => condition.id === "grappled")).toBe(true);
    game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false, actionInstance: null } };
    const escape = resolveBuiltin(game, "escape-grapple", { actorId: IDS.pip }, [12], pipDefinition);
    expect(escape.check).toMatchObject({ dc: 15, success: true });
    expect(pip.conditions.some((condition) => condition.id === "grappled")).toBe(false);

    // Re-grapple, then stun the grappler: SRD Grappling - an incapacitated grappler releases.
    game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false, actionInstance: null } };
    resolveBuiltin(game, "unarmed-grapple", { actorId: IDS.torva, targetIds: [IDS.pip] }, [], torvaDefinition);
    answerSave(game, nextCommandId(), game.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, {
      random: () => 2, newRollId: () => "40000000-0000-4000-8000-000000000098", sessionId: IDS.gmSession, role: "gm", now: () => "2026-07-18T00:00:00.000Z",
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition
    });
    expect(pip.conditions.some((condition) => condition.id === "grappled")).toBe(true);
    const events = setCondition(game, IDS.torva, "stunned", true, undefined, { role: "gm" });
    expect(pip.conditions.some((condition) => condition.id === "grappled")).toBe(false);
    expect(events.some((event) => /Grappled by Torva Grimtusk ended/.test(event.text))).toBe(true);
  });

  it("rejects grappling a target more than one size larger", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    try {
      resolveBuiltin(game, "unarmed-grapple", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [], pipDefinition);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("target.too-large-to-grapple");
    }
  });

  it("Ready parks the trigger; resolving off-turn releases it and spends the reaction (SRD Ready)", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    const ready = resolveBuiltin(game, "ready", { actorId: IDS.pip, note: "shoot the first crocodile that surfaces" }, [], pipDefinition);
    expect(ready.effectGranted?.name).toBe("Readied: shoot the first crocodile that surfaces");
    nextInitiativeTurn(game); // croc's turn - Pip acts off-turn, releasing the ready.
    const release = resolve(game, pipDefinition, "shortbow", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [15, 4]);
    expect(release.effectsEnded?.some((ended) => ended.name.startsWith("Readied:"))).toBe(true);
    expect(game.combat.reactionsUsed).toContain(IDS.pip);
  });

  it("builtins resolve for a combatant with no definition at all", () => {
    const game = buildGame();
    const extraId = "10000000-0000-4000-8000-00000000000e";
    game.actors.push({ id: extraId, name: "Hired Guard", kind: "npc", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null, conditions: [], effects: [], deathSaves: null, actionUses: {}, conditionImmunities: [] });
    game.combat = { ...game.combat, initiative: [...game.combat.initiative, { actorId: extraId, score: 1, tieBreaker: 0 }] };
    const dodge = resolveBuiltin(game, "dodge", { actorId: extraId }, []);
    expect(dodge.effectGranted?.name).toBe("Dodging");
  });
});

describe("movement rules - speed budget and opportunity attacks (SRD Movement and Position)", () => {
  // Feet-space positions with a straight Euclidean distance stand in for the calibrated map.
  const feet = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  const place = (game: GameState, actorId: string, x: number, y: number) => {
    game.combat = { ...game.combat, tokens: game.combat.tokens.map((token) => token.actorId === actorId ? { ...token, position: { x, y } } : token) };
  };
  let promptSeq = 0;
  const moveRules = (game: GameState, actorId: string, from: { x: number; y: number }, to: { x: number; y: number }, override: { reason: string } | null = null) =>
    applyMovementRules(game, {
      actorId, from, to, distance: feet, override,
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition,
      newPromptId: () => `70000000-0000-4000-8000-${String(++promptSeq).padStart(12, "0")}`,
      now: () => 0, commandId: nextCommandId()
    });

  it("accumulates spent feet and strict-blocks an overrun with the remaining budget named", () => {
    const game = buildGame(); // Torva's turn, speed 40 from the fixture
    place(game, IDS.torva, 0, 0);
    moveRules(game, IDS.torva, { x: 0, y: 0 }, { x: 30, y: 0 });
    expect(game.combat.turn.movementUsedFeet).toBe(30);
    try {
      moveRules(game, IDS.torva, { x: 30, y: 0 }, { x: 50, y: 0 }); // 20 more > 40 total
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("movement.exceeds-speed");
      expect((error as RulesBlockedError).message).toMatch(/10 ft of movement left/);
    }
    // The GM override allows and still accumulates; assisted mode warns instead of blocking.
    const overridden = moveRules(game, IDS.torva, { x: 30, y: 0 }, { x: 50, y: 0 }, { reason: "difficult terrain house rule" });
    expect(overridden.overridden).toBe("difficult terrain house rule");
    expect(game.combat.turn.movementUsedFeet).toBe(50);
  });

  it("Dash doubles the budget; a grappled mover has Speed 0; exhaustion subtracts 5 ft per level", () => {
    const dash = buildGame();
    dash.actors.find((actor) => actor.id === IDS.torva)!.effects = [{
      id: "d", name: "Dashing", tags: ["dashing"], sourceActorId: IDS.torva, sourceName: "Torva Grimtusk", sourceActionId: "dash",
      startedRound: 1, duration: { type: "until-source-next-turn" }, endsWhenSourceDefeated: true, voidWhileIncapacitated: false,
      endsWithTag: null, modifiers: [], linkedConditionIds: [], escapeDc: null, onEnd: []
    }];
    moveRules(dash, IDS.torva, { x: 0, y: 0 }, { x: 70, y: 0 }); // 70 ≤ 80 with Dash
    expect(dash.combat.turn.movementUsedFeet).toBe(70);

    const held = buildGame();
    held.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "grappled" }];
    expect(() => moveRules(held, IDS.torva, { x: 0, y: 0 }, { x: 5, y: 0 })).toThrow(/Speed is 0/);

    const tired = buildGame();
    tired.actors.find((actor) => actor.id === IDS.torva)!.conditions = [{ id: "exhaustion", level: 2 }];
    expect(() => moveRules(tired, IDS.torva, { x: 0, y: 0 }, { x: 35, y: 0 })).toThrow(/30 ft of movement left/);
  });

  it("off-turn moves never accumulate or block (GM repositioning stays free)", () => {
    const game = buildGame(); // Torva's turn - move Pip
    const outcome = moveRules(game, IDS.pip, { x: 0, y: 0 }, { x: 500, y: 0 });
    expect(outcome.warning).toBeNull();
    expect(game.combat.turn.movementUsedFeet).toBe(0);
  });

  it("leaving a crocodile's reach opens an opportunity-attack prompt; Disengage suppresses it", () => {
    const game = buildGame();
    place(game, IDS.croc1, 0, 0);
    // Torva starts adjacent (5 ft) and retreats to 30 ft: past the croc's 10 ft tail reach.
    const outcome = moveRules(game, IDS.torva, { x: 5, y: 0 }, { x: 30, y: 0 });
    expect(outcome.prompts).toEqual([{ actorId: IDS.croc1, name: "Giant Crocodile" }]);
    const prompt = game.combat.pendingReactions[0];
    expect(prompt).toMatchObject({ kind: "leaves-reach", actorId: IDS.croc1, targetActorId: IDS.torva, actionName: "Opportunity Attack" });

    const safe = buildGame();
    place(safe, IDS.croc1, 0, 0);
    safe.actors.find((actor) => actor.id === IDS.torva)!.effects = [{
      id: "dis", name: "Disengaged", tags: ["disengaged"], sourceActorId: IDS.torva, sourceName: "Torva Grimtusk", sourceActionId: "disengage",
      startedRound: 1, duration: { type: "until-source-next-turn" }, endsWhenSourceDefeated: true, voidWhileIncapacitated: false,
      endsWithTag: null, modifiers: [], linkedConditionIds: [], escapeDc: null, onEnd: []
    }];
    expect(moveRules(safe, IDS.torva, { x: 5, y: 0 }, { x: 30, y: 0 }).prompts).toHaveLength(0);
  });

  it("no prompt when the enemy's reaction is spent or it is incapacitated", () => {
    const spent = buildGame();
    place(spent, IDS.croc1, 0, 0);
    spent.combat = { ...spent.combat, reactionsUsed: [IDS.croc1] };
    expect(moveRules(spent, IDS.torva, { x: 5, y: 0 }, { x: 30, y: 0 }).prompts).toHaveLength(0);

    const stunned = buildGame();
    place(stunned, IDS.croc1, 0, 0);
    stunned.actors.find((actor) => actor.id === IDS.croc1)!.conditions = [{ id: "stunned" }];
    expect(moveRules(stunned, IDS.torva, { x: 5, y: 0 }, { x: 30, y: 0 }).prompts).toHaveLength(0);
  });

  it("answering the opportunity prompt swings a real melee attack and auto-applies the damage", () => {
    const game = buildGame();
    place(game, IDS.croc1, 0, 0);
    moveRules(game, IDS.torva, { x: 5, y: 0 }, { x: 30, y: 0 });
    const promptId = game.combat.pendingReactions[0].id;
    // Croc bites: 15 + 8 = 23 hits AC 15; 6+6+6+5 = 23 piercing, applied immediately.
    const outcome = answerReaction(game, nextCommandId(), promptId, true, "bite", { role: "gm" }, {
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition,
      random: (() => { const faces = [15, 6, 6, 6]; return () => faces.shift()!; })(),
      newRollId: (() => { let n = 800; return () => `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
      gmSessionId: IDS.gmSession,
      now: () => "2026-07-18T00:00:00.000Z"
    });
    expect(outcome.used).toBe(true);
    expect(outcome.resolution?.attack?.outcome).toBe("hit");
    expect(outcome.appliedDamage).toBe(23);
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.hp.current).toBe(75 - 23);
    expect(game.combat.reactionsUsed).toContain(IDS.croc1);
    expect(game.combat.pendingReactions).toHaveLength(0);
  });

  it("the opportunity swing never range-checks the mover's arrival position (SRD: the attack lands before they leave reach)", () => {
    // Live-smoke regression: the mover has ARRIVED far away by answer time (arrival-timing
    // approximation), and on a measurable map a strict range check would wrongly block the swing.
    const game = buildGame();
    place(game, IDS.croc1, 0, 0);
    place(game, IDS.torva, 5, 0);
    moveRules(game, IDS.torva, { x: 5, y: 0 }, { x: 45, y: 0 }); // 40 ft - well past the 10 ft reach
    const outcome = answerReaction(game, nextCommandId(), game.combat.pendingReactions[0].id, true, "bite", { role: "gm" }, {
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition,
      random: (() => { const faces = [15, 6, 6, 6]; return () => faces.shift()!; })(),
      newRollId: (() => { let n = 810; return () => `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
      gmSessionId: IDS.gmSession,
      now: () => "2026-07-18T00:00:00.000Z"
    });
    expect(outcome.used).toBe(true);
    expect(outcome.resolution?.attack?.outcome).toBe("hit");
  });

  it("standing from Prone costs half Speed and blocks when the budget is short (SRD Prone)", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    torva.conditions = [{ id: "prone" }];
    game.combat = { ...game.combat, turn: { ...game.combat.turn, movementUsedFeet: 25 } }; // 15 left of 40
    expect(() => setCondition(game, IDS.torva, "prone", false, undefined, { role: "gm" }))
      .toThrow(/Standing up costs 20 ft/);
    game.combat = { ...game.combat, turn: { ...game.combat.turn, movementUsedFeet: 10 } };
    const events = setCondition(game, IDS.torva, "prone", false, undefined, { role: "gm" });
    expect(events.some((event) => /stood up \(20 ft of movement\)/.test(event.text))).toBe(true);
    expect(game.combat.turn.movementUsedFeet).toBe(30);
    expect(torva.conditions.some((condition) => condition.id === "prone")).toBe(false);
  });
});

describe("range and reach validation (SRD Making an Attack / Range)", () => {
  it("blocks a melee swing beyond reach and a shot beyond maximum range; unmeasurable skips", () => {
    const game = buildGame();
    try {
      resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [], () => 15);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("range.out-of-reach");
    }
    // Pip's shortbow (80/320): 350 ft is beyond maximum range.
    const far = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    try {
      resolve(far, pipDefinition, "shortbow", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [], () => 350);
      expect.unreachable();
    } catch (error) {
      expect((error as RulesBlockedError).rule).toBe("range.out-of-range");
    }
    // No distance function → the checks skip entirely (the unmeasurable pattern).
    const blind = buildGame();
    expect(resolve(blind, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]).attack?.outcome).toBe("hit");
  });

  it("rolls disadvantage in the long-range band and when an able enemy is within 5 feet", () => {
    const long = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    const shot = resolve(long, pipDefinition, "shortbow", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [18, 3], () => 200);
    expect(shot.rollMode?.disadvantage).toContain("Long range (beyond 80 ft)");

    // Adjacent crocodile spoils the shot at any range (ranged in close combat).
    const crowded = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 12 }, { actorId: IDS.croc2, score: 8 }]);
    const distances: Record<string, number> = { [IDS.croc1]: 40, [IDS.croc2]: 5 };
    const jostled = resolve(crowded, pipDefinition, "shortbow", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [18, 3], (_a, b) => distances[b] ?? null);
    expect(jostled.rollMode?.disadvantage).toContain("Enemy within 5 feet (Giant Crocodile 2)");
  });
});

describe("cover - GM-adjudicated, server math (SRD Cover)", () => {
  const resolveCover = (game: GameState, definition: ActorDefinition, actionId: string, input: { actorId: string; targetIds?: readonly string[]; cover?: "half" | "three-quarters" | "total"; override?: { reason: string } }, faces: number[]) =>
    resolveDefinitionAction(game, actionOf(definition, actionId), { actorId: input.actorId, targetIds: input.targetIds ?? [], commandId: nextCommandId(), rollMode: null, override: input.override ?? null, cover: input.cover ?? null }, deps(faces, definition));

  it("half cover adds +2 AC: a 15 vs AC 14 now misses, with the bonus shown on the result", () => {
    const game = buildGame();
    // Torva +7: face 8 → 15, a hit against the croc's bare AC 14 - but not against 16 behind half cover.
    const swing = resolveCover(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1], cover: "half" }, [8, 6]);
    expect(swing.attack).toMatchObject({ total: 15, targetAc: 16, outcome: "miss", coverBonus: 2 });
  });

  it("three-quarters cover adds +5 to the Dexterity save it forces", () => {
    const game = buildGame([{ actorId: IDS.sable, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    resolveCover(game, sableDefinition, "fireball", { actorId: IDS.sable, targetIds: [IDS.croc1], cover: "three-quarters" }, [4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(game.combat.pendingSaves[0]).toMatchObject({ ability: "dex", dc: 15, saveBonus: 5 });
    // Croc Dex −1: face 10 → 10 − 1 + 5 (cover) = 14, still a failure against DC 15 - but the +5 landed.
    const answered = answerSave(game, nextCommandId(), game.combat.pendingSaves[0].id, "roll", undefined, true, { role: "gm" }, {
      random: () => 10, newRollId: () => "40000000-0000-4000-8000-000000000d10", sessionId: IDS.gmSession, role: "gm", now: () => "2026-07-18T00:00:00.000Z",
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition
    });
    expect(answered.outcome).toMatchObject({ total: 14, success: false });
  });

  it("total cover blocks targeting in strict mode; an audited override lets the corner-case shot through", () => {
    const game = buildGame();
    try {
      resolveCover(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1], cover: "total" }, [18, 6]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("cover.total");
    }
    game.combat = { ...game.combat, turn: { ...game.combat.turn, actionUsed: false, actionInstance: null } };
    const overridden = resolveCover(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1], cover: "total", override: { reason: "firing through the arrow slit" } }, [18, 6]);
    expect(overridden.overridden).toEqual({ rule: "cover.total", reason: "firing through the arrow slit" });
    expect(overridden.attack?.outcome).toBe("hit");
  });
});

describe("concentration (SRD Concentration)", () => {
  const sustained = (id: string, name: string, sourceActorId: string, sourceName: string) => ({
    id, name, tags: [], sourceActorId, sourceName, sourceActionId: null, startedRound: 1,
    duration: { type: "manual" as const }, endsWhenSourceDefeated: true, voidWhileIncapacitated: false,
    concentration: true, modifiers: [], linkedConditionIds: [], escapeDc: null, onEnd: [], endsWithTag: null
  });
  const gameDeps = (game: GameState) => ({ resolveDefinition: (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition, newId: () => nextCommandId(), now: () => "2026-07-18T00:00:00.000Z" });

  it("starting a second concentration effect ends the first (one at a time)", () => {
    const game = buildGame();
    const events: Parameters<typeof addEffect>[3] = [];
    addEffect(game, IDS.torva, sustained("conc-hex-1", "Hexed", IDS.sable, "Sable Vex"), events);
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects.some((effect) => effect.id === "conc-hex-1")).toBe(true);
    addEffect(game, IDS.croc1, sustained("conc-hex-2", "Hexed", IDS.sable, "Sable Vex"), events);
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects.some((effect) => effect.id === "conc-hex-1")).toBe(false);
    expect(game.actors.find((actor) => actor.id === IDS.croc1)!.effects.some((effect) => effect.id === "conc-hex-2")).toBe(true);
    expect(events.some((event) => /Hexed ended/.test(event.text))).toBe(true);
  });

  it("damage prompts a CON save at DC max(10, half damage) that ends the sustained effects on a committed failure", () => {
    const game = buildGame();
    addEffect(game, IDS.torva, sustained("conc-hex", "Hexed", IDS.sable, "Sable Vex"));
    const outcome = applyDamageDetailed(game, IDS.sable, { amount: 44, sourceName: "Crocodile bite" }, { role: "gm" }, gameDeps(game));
    expect(outcome.events.some((event) => /DC 22 Constitution save to keep concentrating/.test(event.text))).toBe(true);
    expect(game.combat.pendingSaves[0]).toMatchObject({ targetActorId: IDS.sable, ability: "con", dc: 22, actionName: "Concentration check", endsEffects: [{ actorId: IDS.torva, effectId: "conc-hex" }] });
    // Manual total (GM escape hatch) keeps the test independent of Sable's CON modifier: 3 < 22 fails.
    const answered = answerSave(game, nextCommandId(), game.combat.pendingSaves[0].id, "manual", 3, true, { role: "gm" }, {
      random: () => 1, newRollId: () => "40000000-0000-4000-8000-000000000d20", sessionId: IDS.gmSession, role: "gm", now: () => "2026-07-18T00:00:00.000Z",
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition
    });
    expect(answered.outcome.success).toBe(false);
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects).toHaveLength(0);
  });

  it("caps the concentration DC at 30; small hits still prompt at the DC 10 floor", () => {
    const game = buildGame();
    addEffect(game, IDS.pip, sustained("conc-big", "Warded", IDS.torva, "Torva Grimtusk"));
    applyDamageDetailed(game, IDS.torva, { amount: 70, sourceName: "Cave-in" }, { role: "gm" }, gameDeps(game));
    expect(game.combat.pendingSaves[0].dc).toBe(30);

    const small = buildGame();
    addEffect(small, IDS.pip, sustained("conc-small", "Warded", IDS.torva, "Torva Grimtusk"));
    applyDamageDetailed(small, IDS.torva, { amount: 4, sourceName: "Dart" }, { role: "gm" }, gameDeps(small));
    expect(small.combat.pendingSaves[0].dc).toBe(10);
  });

  it("an incapacitating condition breaks concentration immediately", () => {
    const game = buildGame();
    addEffect(game, IDS.torva, sustained("conc-stun", "Hexed", IDS.sable, "Sable Vex"));
    const events = setCondition(game, IDS.sable, "stunned", true, undefined, { role: "gm" });
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects).toHaveLength(0);
    expect(events.some((event) => /Hexed ended/.test(event.text))).toBe(true);
  });

  it("dropping to 0 HP breaks concentration and does not prompt a save", () => {
    const game = buildGame();
    addEffect(game, IDS.torva, sustained("conc-zero", "Hexed", IDS.sable, "Sable Vex"));
    applyDamageDetailed(game, IDS.sable, { amount: 52, sourceName: "Crocodile death roll" }, { role: "gm" }, gameDeps(game));
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.effects).toHaveLength(0);
    expect(game.combat.pendingSaves).toHaveLength(0);
  });
});

describe("surprise - initiative Disadvantage (SRD 2024 Surprise)", () => {
  it("a surprised combatant with no explicit score rolls two d20s and keeps the lower", () => {
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: IDS.torva, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current: 75, maximum: 75 } },
        { id: IDS.pip, name: "Pip Underbough", kind: "player-character", visibility: "public", hp: { current: 52, maximum: 52 } },
        { id: IDS.croc1, name: "Giant Crocodile", kind: "monster", visibility: "public", hp: { current: 85, maximum: 85 } }
      ]
    });
    const faces = [15, 3, 10];
    startEncounter(game, { mapAssetId: IDS.map, entries: [
      { actorId: IDS.torva, surprised: true },
      { actorId: IDS.pip },
      { actorId: IDS.croc1, score: 12 }
    ] }, () => { const face = faces.shift(); if (face === undefined) throw new Error("d20 queue empty"); return face; }, GEOMETRY, () => undefined);
    // Torva (surprised): min(15, 3) = 3. Pip: single roll 10. Croc: explicit 12. Order: croc, pip, torva.
    expect(game.combat.initiative.map((entry) => ({ actorId: entry.actorId, score: entry.score }))).toEqual([
      { actorId: IDS.croc1, score: 12 }, { actorId: IDS.pip, score: 10 }, { actorId: IDS.torva, score: 3 }
    ]);
    expect(faces).toHaveLength(0);
  });
});

describe("rests (SRD Resting) - short rests re-arm only per-short-rest pools", () => {
  const FIGHTER_ID = "10000000-0000-4000-8000-00000000000f";
  const withSecondWind: ActorDefinition = {
    ...pipDefinition,
    actions: [...pipDefinition.actions, { ...actionOf(pipDefinition, "cunning-action"), id: "second-wind", name: "Second Wind", uses: { limit: 1, per: "short-rest" } }]
  };
  const buildResting = () => {
    const game = buildGame();
    game.definitions.push({ id: "import-fighter", definition: withSecondWind });
    game.actors.push({
      id: FIGHTER_ID, name: "Hired Fighter", kind: "player-character", visibility: "public",
      hp: { current: 6, maximum: 20, temporary: 0 }, ownerSessionId: null, conditions: [], effects: [],
      deathSaves: null, actionUses: { "second-wind": 1, "action-surge": 1 }, conditionImmunities: [], definitionId: "import-fighter"
    });
    return game;
  };
  const resolveDef = (game: GameState) => (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition;

  it("a short rest clears per-short-rest pools, leaves other pools and hit points alone", () => {
    const game = buildResting();
    applyRest(game, FIGHTER_ID, "short", resolveDef(game));
    const fighter = game.actors.find((actor) => actor.id === FIGHTER_ID)!;
    expect(fighter.actionUses).toEqual({ "action-surge": 1 });
    expect(fighter.hp.current).toBe(6);
  });

  it("a long rest still clears everything and restores hit points", () => {
    const game = buildResting();
    applyRest(game, FIGHTER_ID, "long", resolveDef(game));
    const fighter = game.actors.find((actor) => actor.id === FIGHTER_ID)!;
    expect(fighter.actionUses).toEqual({});
    expect(fighter.hp.current).toBe(20);
  });

  it("rests are blocked for a combatant in the live encounter", () => {
    const game = buildResting();
    expect(() => applyRest(game, IDS.torva, "short", resolveDef(game))).toThrow(/End the encounter/);
  });
});

describe("underwater combat (SRD Underwater Combat) - GM environment toggle", () => {
  it("melee attacks take Disadvantage unless they deal piercing damage", () => {
    const game = buildGame();
    game.combat = { ...game.combat, underwater: true };
    const axe = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 3, 6]);
    expect(axe.rollMode?.disadvantage).toContain("Underwater (non-piercing melee)");

    const stab = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    stab.combat = { ...stab.combat, underwater: true };
    const rapier = resolve(stab, pipDefinition, "rapier", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [15, 5]);
    expect(rapier.rollMode?.disadvantage ?? []).not.toContain("Underwater (non-piercing melee)");
  });

  it("ranged attacks automatically miss beyond normal range (strict violation range.underwater)", () => {
    const game = buildGame([{ actorId: IDS.pip, score: 20 }, { actorId: IDS.croc1, score: 8 }]);
    game.combat = { ...game.combat, underwater: true };
    // Shortbow 80/320: 100 ft is legal on dry land (long range, Disadvantage) but an auto-miss underwater.
    try {
      resolve(game, pipDefinition, "shortbow", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [18, 3], () => 100);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RulesBlockedError);
      expect((error as RulesBlockedError).rule).toBe("range.underwater");
    }
    const close = resolve(game, pipDefinition, "shortbow", { actorId: IDS.pip, targetIds: [IDS.croc1] }, [18, 3], () => 60);
    expect(close.attack?.outcome).toBe("hit");
  });

  it("everyone underwater resists fire damage, attributed to the environment", () => {
    const game = buildGame();
    game.combat = { ...game.combat, underwater: true };
    const outcome = applyDamageDetailed(game, IDS.pip, { amount: 10, parts: [{ amount: 10, type: "fire" }], sourceName: "Flame jet" }, { role: "gm" }, { resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition });
    expect(outcome.application.totalApplied).toBe(5);
    expect(outcome.application.parts[0]).toMatchObject({ adjustment: "resistance", adjustmentSource: "Underwater" });
  });

  it("a fresh encounter starts dry, and pre-underwater snapshots parse to underwater: false", () => {
    expect(buildGame().combat.underwater).toBe(false);
    const legacy = GameStateSchema.parse({ schemaVersion: 1 });
    expect(legacy.combat.underwater).toBe(false);
  });
});

describe("knocking out a creature (SRD) - nonlethal damage", () => {
  it("a nonlethal drop to 0 leaves a character Unconscious and stable instead of dying", () => {
    const game = buildGame();
    const outcome = applyDamageDetailed(game, IDS.pip, { amount: 52, nonlethal: true, sourceName: "Pommel strike" }, { role: "gm" }, { resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition });
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.hp.current).toBe(0);
    expect(pip.deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
    expect(pip.conditions.some((condition) => condition.id === "unconscious")).toBe(true);
    expect(outcome.application.instantDeath).toBe(false);
    expect(outcome.events.some((event) => /knocked out/.test(event.text))).toBe(true);
  });

  it("a nonlethal drop to 0 leaves a monster Unconscious, not defeated", () => {
    const game = buildGame();
    const outcome = applyDamageDetailed(game, IDS.croc1, { amount: 85, nonlethal: true, sourceName: "Pommel strike" }, { role: "gm" }, { resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition });
    expect(outcome.application.defeated).toBe(false);
    expect(game.actors.find((actor) => actor.id === IDS.croc1)!.conditions.some((condition) => condition.id === "unconscious")).toBe(true);
  });
});

describe("multiattack ergonomics - no pre-selection needed (report bug 5)", () => {
  it("tapping Multiattack mid-instance continues the plan instead of blocking; a spent plan still rejects", () => {
    const game = buildGame([{ actorId: IDS.croc1, score: 20 }, { actorId: IDS.torva, score: 8 }]);
    // Bite straight away (no Multiattack tap first): the plan opens with the Tail still owed.
    // (Face 2 misses AC 15 so the grapple rider doesn't block the Tail's later targeting.)
    resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.torva] }, [2, 6, 6, 6]);
    expect(game.combat.turn.actionInstance).toEqual({ actorId: IDS.croc1, components: { bite: 0, tail: 1 } });
    // Tapping the Multiattack row now is a continue (reports the remaining plan), not an override dialog.
    const plan = resolve(game, crocodileDefinition, "multiattack", { actorId: IDS.croc1 }, []);
    expect(plan.componentsRemaining).toEqual({ bite: 0, tail: 1 });
    // A second Bite names what IS left instead of a dead-end message.
    expect(() => resolve(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.torva] }, [2, 6, 6, 6]))
      .toThrow(/no Bite left in this action - remaining: 1× Tail/);
    // Spend the Tail; with the plan empty, Multiattack rejects like any exhausted action.
    resolve(game, crocodileDefinition, "tail", { actorId: IDS.croc1, targetIds: [IDS.torva] }, [10, 6, 6, 6, 6]);
    expect(() => resolve(game, crocodileDefinition, "multiattack", { actorId: IDS.croc1 }, []))
      .toThrow(/no attacks remaining/);
  });
});

describe("creature size and distance - footprint-aware, edge-to-edge (SRD Creature Size / Space)", () => {
  // 50 px cells at 5 ft, no rotation: cell centers at 25+50k, intersections at 50k.
  const CALIBRATION = { kind: "square" as const, origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
  const CALIBRATED = { width: 900, height: 600, calibration: CALIBRATION } as const;
  const medium = (x: number, y: number) => ({ position: { x, y }, sizeCells: 1, sizePx: 41 });
  const large = (x: number, y: number) => ({ position: { x, y }, sizeCells: 2, sizePx: 96 });
  const huge = (x: number, y: number) => ({ position: { x, y }, sizeCells: 3, sizePx: 146 });

  it("a Medium creature adjacent to a Large or Huge one is 5 ft away, not its center-to-center 7.5-10 ft", () => {
    // Large 2x2 centers on an intersection: center-to-center reads 1.5 cells; edge-to-edge is 1 cell.
    expect(creatureDistance(CALIBRATED, medium(25, 75), large(100, 100))!.value).toBe(5);
    // Huge 3x3 centers on a cell: center-to-center reads 2 cells (10 ft); edge-to-edge is 5 ft.
    expect(creatureDistance(CALIBRATED, medium(25, 125), huge(125, 125))!.value).toBe(5);
    // Two Medium neighbors stay 5 ft; a genuinely distant Large reads its true gap.
    expect(creatureDistance(CALIBRATED, medium(25, 75), medium(75, 75))!.value).toBe(5);
    expect(creatureDistance(CALIBRATED, medium(25, 75), large(300, 100))!.value).toBe(25);
  });

  it("an adjacent Medium attacker can melee a Huge creature (report bug: 'reportedly 10 ft away when in fact 5 ft')", () => {
    const game = buildGame();
    game.combat = { ...game.combat, tokens: game.combat.tokens.map((token) =>
      token.actorId === IDS.torva ? { ...token, position: { x: 75, y: 125 } }
      : token.actorId === IDS.croc1 ? { ...token, position: { x: 175, y: 125 }, sizeCells: 3, sizePx: 146 }
      : token) };
    const distanceFeet = (a: string, b: string) => tokenCreatureDistance(game, CALIBRATED, a, b)?.value ?? null;
    expect(distanceFeet(IDS.torva, IDS.croc1)).toBe(5); // center-to-center would read 10
    const swing = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6], distanceFeet);
    expect(swing.attack).not.toBeNull(); // no range.out-of-reach throw
  });

  it("a Large/Huge creature moving out of reach still provokes the opportunity attack (report bug 3)", () => {
    const game = buildGame([{ actorId: IDS.croc1, score: 20 }, { actorId: IDS.torva, score: 8 }]); // croc's turn
    game.combat = { ...game.combat, tokens: game.combat.tokens.map((token) =>
      token.actorId === IDS.torva ? { ...token, position: { x: 75, y: 125 } }
      : token.actorId === IDS.croc1 ? { ...token, position: { x: 175, y: 125 }, sizeCells: 3, sizePx: 146 }
      : token) };
    const crocToken = game.combat.tokens.find((token) => token.actorId === IDS.croc1)!;
    const outcome = applyMovementRules(game, {
      actorId: IDS.croc1,
      from: { x: 175, y: 125 },
      to: { x: 425, y: 125 },
      distance: (a, b) => mapDistance(CALIBRATED, a, b)?.value ?? null,
      creatureDistance: (enemy, moverPoint) => {
        const enemyToken = game.combat.tokens.find((token) => token.actorId === enemy.actorId)!;
        return creatureDistance(CALIBRATED, { position: enemy.position, sizeCells: enemyToken.sizeCells, sizePx: enemyToken.sizePx }, { position: moverPoint, sizeCells: crocToken.sizeCells, sizePx: crocToken.sizePx })?.value ?? null;
      },
      override: { reason: "test: ignore the budget" },
      resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition,
      newPromptId: () => "70000000-0000-4000-8000-000000000f01",
      now: () => 0,
      commandId: nextCommandId()
    });
    // Center-to-center the croc's from-position read 10 ft from Torva (beyond his 5 ft reach), so the
    // old math thought it was never in reach and no prompt fired. Edge-to-edge it starts at 5 ft.
    expect(outcome.prompts).toEqual([{ actorId: IDS.torva, name: "Torva Grimtusk" }]);
  });

  it("gridless maps with a saved scale subtract each token's radius beyond its central cell", () => {
    const scaled = { width: 900, height: 600, calibration: null, scale: { distancePerPixel: 0.1, unit: "ft" } } as const;
    // Centers 100 px apart -> 10 ft raw; the huge token's extra radius (146 - 146/3)/2 ≈ 48.7 px trims it to ~5.1 ft.
    const value = creatureDistance(scaled, medium(100, 100), { position: { x: 200, y: 100 }, sizeCells: 3, sizePx: 146 })!.value;
    expect(value).toBeCloseTo(5.13, 1);
  });

  it("washes out snapping dust so a truly-adjacent creature reads exactly 5 ft (report bug: '5 ft away but out of reach')", () => {
    // A realistic wizard-drawn grid: off-origin, a hair of rotation, and positions that went through
    // the 0.001-px position rounding. Center-to-edge here lands at 5.0001-ish ft raw; the fix rounds it.
    const skewed = { width: 900, height: 600, calibration: { kind: "square" as const, origin: { x: 0.333, y: 0.777 }, cellSizePx: 50, rotationRadians: 0.0009, distancePerCell: 5 } } as const;
    const round3 = (value: number) => Math.round(value * 1000) / 1000; // mimic the token-placement 0.001-px snap
    const at = (col: number, row: number) => {
      const raw = gridToImage(skewed.calibration, { column: col, row });
      return { x: round3(raw.x), y: round3(raw.y) };
    };
    // Medium at a cell center (col 2.5), Large 2x2 centered on the adjacent intersection (col 4) - edge-to-edge 1 cell.
    const mediumAt = { position: at(2.5, 3.5), sizeCells: 1, sizePx: 41 };
    const largeAt = { position: at(4, 3), sizeCells: 2, sizePx: 96 };
    expect(creatureDistance(skewed, mediumAt, largeAt)!.value).toBe(5); // not 5.0001

    // And the reach check forgives sub-foot slack directly: a 5.08 ft read is still within a 5 ft reach.
    const game = buildGame();
    const swing = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6], () => 5.08);
    expect(swing.attack).not.toBeNull();
    // A genuine step out (a full cell beyond) still blocks.
    expect(() => resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6], () => 10)).toThrowError(/out of reach|beyond/i);
  });
});

describe("save-for-damage applies on a failed save (report bug: breath weapons dealt no damage)", () => {
  const brassDragon = loadMonsterDefinitions().find((monster) => monster.source.externalId === "adult-brass-dragon")!;
  const DRAGON = "10000000-0000-4000-8000-000000000009";

  function buildBreathGame(): GameState {
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: IDS.torva, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current: 75, maximum: 75 }, armorClass: 15, definitionId: "import-torva", size: "medium" },
        { id: DRAGON, name: "Adult Brass Dragon", kind: "monster", visibility: "public", hp: { current: 172, maximum: 172 }, armorClass: 18, definitionId: "adult-brass-dragon", size: "huge" }
      ],
      definitions: [
        { id: "import-torva", definition: torvaDefinition },
        { id: "adult-brass-dragon", definition: brassDragon }
      ]
    });
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: DRAGON, score: 20 }, { actorId: IDS.torva, score: 8 }] }, () => 1, GEOMETRY, (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition);
    return game;
  }

  it("rolls the breath damage at resolve and applies it on a committed failure (half on success)", () => {
    const game = buildBreathGame();
    // Fire Breath: DC 18 DEX, Failure 10d8 fire, Success half. Roll all 1s → 10 fire proposed.
    resolve(game, brassDragon, "fire-breath", { actorId: DRAGON, targetIds: [IDS.torva] }, Array(10).fill(1));
    const pending = game.combat.pendingSaves.find((save) => save.targetActorId === IDS.torva)!;
    expect(pending).toMatchObject({ ability: "dex", dc: 18, halfOnSuccess: true });
    expect(pending.proposedDamageParts).toEqual([{ amount: 10, type: "fire" }]);

    // Torva fails the save → full 10 fire applied (this is the bug: previously proposedDamage was 0).
    const saveDeps = { random: () => 3, newRollId: (() => { let n = 700; return () => `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(), sessionId: IDS.gmSession, role: "gm" as const, now: () => "2026-07-18T00:00:00.000Z", resolveDefinition: (id: string) => game.definitions.find((entry) => entry.id === id)?.definition };
    const answered = answerSave(game, nextCommandId(), pending.id, "manual", 5, true, { role: "gm" }, saveDeps);
    expect(answered.outcome).toMatchObject({ success: false, committed: true, appliedDamage: 10 });
    expect(game.actors.find((actor) => actor.id === IDS.torva)!.hp.current).toBe(65);

    // A success halves it (SRD "Success: Half damage") - 5 fire.
    const game2 = buildBreathGame();
    resolve(game2, brassDragon, "fire-breath", { actorId: DRAGON, targetIds: [IDS.torva] }, Array(10).fill(1));
    const pending2 = game2.combat.pendingSaves[0];
    answerSave(game2, nextCommandId(), pending2.id, "manual", 25, true, { role: "gm" }, { ...saveDeps, resolveDefinition: (id: string) => game2.definitions.find((entry) => entry.id === id)?.definition });
    expect(game2.actors.find((actor) => actor.id === IDS.torva)!.hp.current).toBe(70);
  });
});

describe("recharge abilities (SRD Recharge X-Y; Foundry-parity adoption)", () => {
  const wyrmlingDefinition = loadMonsterDefinitions().find((monster) => monster.source.externalId === "white-dragon-wyrmling")!;
  const DRAGON = "10000000-0000-4000-8000-000000000006";

  /** Torva vs a white dragon wyrmling, optionally with the breath already spent before the fight starts. */
  function buildDragonGame(preSpent = false): GameState {
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: IDS.torva, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current: 75, maximum: 75 }, armorClass: 15, definitionId: "import-torva", size: "medium", speedFeet: 40 },
        { id: DRAGON, name: "White Dragon Wyrmling", kind: "monster", visibility: "public", hp: { current: 32, maximum: 32 }, armorClass: 16, definitionId: "white-dragon-wyrmling", size: "medium", speedFeet: 30, actionUses: preSpent ? { "cold-breath": 1 } : {} }
      ],
      definitions: [
        { id: "import-torva", definition: torvaDefinition },
        { id: "white-dragon-wyrmling", definition: wyrmlingDefinition }
      ]
    });
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.torva, score: 16 }, { actorId: DRAGON, score: 10 }] }, () => 1, GEOMETRY, (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition);
    return game;
  }
  const dragonDeps = (game: GameState, die: number) => ({
    resolveDefinition: (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition,
    rollDie: () => die
  });

  it("blocks a spent breath, keeps it spent on a low start-of-turn roll, and re-arms on the threshold", () => {
    const game = buildDragonGame();
    nextInitiativeTurn(game); // the dragon's turn
    resolve(game, wyrmlingDefinition, "cold-breath", { actorId: DRAGON, targetIds: [IDS.torva] }, Array(5).fill(1)); // 5d8 cold
    expect(game.actors.find((actor) => actor.id === DRAGON)!.actionUses["cold-breath"]).toBe(1);
    // Round 2, low roll (2 < 5): the pool stays spent and the table sees why.
    const lowEvents: { text: string; actorId: string }[] = [];
    nextInitiativeTurn(game, lowEvents as never, dragonDeps(game, 2)); // Torva (no dragon pools roll)
    nextInitiativeTurn(game, lowEvents as never, dragonDeps(game, 2)); // dragon's turn start: d6 = 2
    expect(game.actors.find((actor) => actor.id === DRAGON)!.actionUses["cold-breath"]).toBe(1);
    expect(lowEvents.some((event) => event.actorId === DRAGON && /stays spent \(rolled 2, needs 5\+\)/.test(event.text))).toBe(true);
    expect(() => resolve(game, wyrmlingDefinition, "cold-breath", { actorId: DRAGON, targetIds: [IDS.torva] }, []))
      .toThrowError(/recharges on 5\+ at the start of its turn/);
    // Round 3, threshold roll (5): re-armed, and the breath resolves again.
    const highEvents: { text: string; actorId: string }[] = [];
    nextInitiativeTurn(game, highEvents as never, dragonDeps(game, 5));
    nextInitiativeTurn(game, highEvents as never, dragonDeps(game, 5));
    expect(game.actors.find((actor) => actor.id === DRAGON)!.actionUses["cold-breath"]).toBeUndefined();
    expect(highEvents.some((event) => event.actorId === DRAGON && /recharges \(rolled 5\)/.test(event.text))).toBe(true);
    const again = resolve(game, wyrmlingDefinition, "cold-breath", { actorId: DRAGON, targetIds: [IDS.torva] }, Array(5).fill(1));
    expect(again.save?.dc).toBe(12);
  });

  it("does not roll for an armed pool, and paths without deps skip recharge entirely", () => {
    const game = buildDragonGame();
    // Armed pool: advancing to the dragon's turn must not consume the (empty) die queue.
    expect(() => nextInitiativeTurn(game, [], { resolveDefinition: (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition, rollDie: () => { throw new Error("rolled for an armed pool"); } })).not.toThrow();
  });

  it("a fresh encounter starts recharge pools armed", () => {
    const game = buildDragonGame(true);
    // startEncounter (inside the builder) cleared the pre-spent pool alongside per-encounter uses.
    expect(game.actors.find((actor) => actor.id === DRAGON)!.actionUses["cold-breath"]).toBeUndefined();
  });

  it("short and long rests re-arm recharge pools out of combat", () => {
    for (const kind of ["short", "long"] as const) {
      const game = GameStateSchema.parse({
        schemaVersion: 1,
        actors: [{ id: DRAGON, name: "White Dragon Wyrmling", kind: "monster", visibility: "public", hp: { current: 32, maximum: 32 }, armorClass: 16, definitionId: "white-dragon-wyrmling", size: "medium", actionUses: { "cold-breath": 1 } }],
        definitions: [{ id: "white-dragon-wyrmling", definition: wyrmlingDefinition }]
      });
      applyRest(game, DRAGON, kind, (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition);
      expect(game.actors[0].actionUses["cold-breath"], kind).toBeUndefined();
    }
  });

  it("the definition schema pins recharge uses to a threshold (and only recharge uses)", () => {
    const base = JSON.parse(JSON.stringify(wyrmlingDefinition));
    base.actions.find((action: { id: string }) => action.id === "cold-breath").uses = { limit: 1, per: "recharge" };
    expect(ActorDefinitionSchema.safeParse(base).success).toBe(false);
    base.actions.find((action: { id: string }) => action.id === "cold-breath").uses = { limit: 1, per: "long-rest", recharge: 5 };
    expect(ActorDefinitionSchema.safeParse(base).success).toBe(false);
    base.actions.find((action: { id: string }) => action.id === "cold-breath").uses = { limit: 1, per: "recharge", recharge: 5 };
    expect(ActorDefinitionSchema.safeParse(base).success).toBe(true);
  });
});

describe("legendary actions + Legendary Resistance (SRD 2024; Foundry-parity adoption)", () => {
  const BOSS = "10000000-0000-4000-8000-000000000007";
  const bossDefinition = ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster", schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: "test-boss" },
    name: "Test Boss", size: "large",
    abilityScores: { str: 20, dex: 14, con: 18, int: 10, wis: 12, cha: 16 },
    proficiencyBonus: 4, armorClass: 17, hitPoints: { maximum: 150 }, speedFeet: 40,
    token: { disposition: "hostile" },
    legendary: { actionsPerRound: 3, resistancesPerDay: 3 },
    actions: [
      { id: "tail-swipe", name: "Tail Swipe", activation: "other", description: "Legendary tail.", attack: { bonus: 9, reachFeet: 10 }, damage: [{ formula: "1d8 + 5", type: "bludgeoning" }], legendary: { cost: 1 } },
      { id: "wing-storm", name: "Wing Storm", activation: "other", description: "Costs 2 legendary actions.", save: { ability: "dex", dc: 15 }, damage: [], legendary: { cost: 2 } },
      { id: "dread-word", name: "Dread Word", activation: "action", description: "Wisdom save or take psychic damage.", save: { ability: "wis", dc: 14 }, damage: [{ formula: "2d6", type: "psychic" }] }
    ]
  });

  /** Torva (turn 1) vs the boss: the boss is off-turn, exactly when legendary actions are legal. */
  function buildBossGame(bossActionUses: Record<string, number> = {}): GameState {
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: IDS.torva, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current: 75, maximum: 75 }, armorClass: 15, definitionId: "import-torva", size: "medium", speedFeet: 40 },
        { id: BOSS, name: "Test Boss", kind: "monster", visibility: "public", hp: { current: 150, maximum: 150 }, armorClass: 17, definitionId: "test-boss", size: "large", speedFeet: 40, actionUses: bossActionUses, legendary: { actionsPerRound: 3, resistancesPerDay: 3 } }
      ],
      definitions: [
        { id: "import-torva", definition: torvaDefinition },
        { id: "test-boss", definition: bossDefinition }
      ]
    });
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.torva, score: 16 }, { actorId: BOSS, score: 10 }] }, () => 1, GEOMETRY, (definitionId) => game.definitions.find((entry) => entry.id === definitionId)?.definition);
    return game;
  }

  it("spends the per-round pool off-turn, blocks past it and on its own turn, and refills at its turn start", () => {
    const game = buildBossGame();
    // Torva's turn: the boss swipes (cost 1; d20 15 + 9 = 24 hits AC 15, 1d8 → 4).
    resolve(game, bossDefinition, "tail-swipe", { actorId: BOSS, targetIds: [IDS.torva] }, [15, 4]);
    expect(game.combat.legendaryUsed[BOSS]).toBe(1);
    // Wing Storm costs 2 → the pool is empty (3/3 spent).
    resolve(game, bossDefinition, "wing-storm", { actorId: BOSS, targetIds: [IDS.torva] }, []);
    expect(game.combat.legendaryUsed[BOSS]).toBe(3);
    expect(() => resolve(game, bossDefinition, "tail-swipe", { actorId: BOSS, targetIds: [IDS.torva] }, [15, 4]))
      .toThrowError(/0 of 3 legendary actions left/);
    // The boss's own turn starts: the pool refills - but legendary actions are off-turn only.
    nextInitiativeTurn(game);
    expect(game.combat.legendaryUsed[BOSS]).toBeUndefined();
    expect(() => resolve(game, bossDefinition, "tail-swipe", { actorId: BOSS, targetIds: [IDS.torva] }, [15, 4]))
      .toThrowError(/other creatures' turns/);
  });

  it("GM manual pool set works, is GM-only, dirties the timeline, and restores on rewind", () => {
    const game = buildBossGame();
    const before = structuredClone(game);
    setLegendaryUsed(game, BOSS, 2, { role: "gm" });
    expect(game.combat.legendaryUsed[BOSS]).toBe(2);
    expect(timelineDirtied(before, game)).toBe(true);
    expect(() => setLegendaryUsed(game, BOSS, 1, { role: "player", sessionId: IDS.gmSession })).toThrowError(/Only the GM/);
    setLegendaryUsed(game, BOSS, 0, { role: "gm" });
    expect(BOSS in game.combat.legendaryUsed).toBe(false);
    // A timeline restore brings the spent pool back with the rest of the combat slice.
    const snapshot = structuredClone(game);
    snapshot.combat = { ...snapshot.combat, legendaryUsed: { [BOSS]: 3 } };
    applyTimelineRestore(game, snapshot, 0);
    expect(game.combat.legendaryUsed[BOSS]).toBe(3);
  });

  it("players never see the legendary pool or the actor's legendary resources", () => {
    const game = buildBossGame();
    setLegendaryUsed(game, BOSS, 2, { role: "gm" });
    expect("legendaryUsed" in projectPlayerCombat(game)).toBe(false);
    const bossAsSeen = projectPlayerView(game, undefined, () => null).actors.find((actor) => actor.id === BOSS)!;
    expect("legendary" in bossAsSeen).toBe(false);
  });

  const saveDeps = (game: GameState, face: number) => ({
    random: () => face,
    newRollId: (() => { let n = 900; return () => `40000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
    sessionId: IDS.gmSession, role: "gm" as const, now: () => "2026-07-18T00:00:00.000Z",
    resolveDefinition: (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition
  });

  it("Legendary Resistance flips a previewed failure into a committed success and spends the daily pool", () => {
    const game = buildBossGame();
    // Torva forces a boss save (Dread Word: DC 14 WIS, 2d6 psychic → 3 + 4 = 7 proposed damage).
    resolve(game, bossDefinition, "dread-word", { actorId: IDS.torva, targetIds: [BOSS] }, [3, 4]);
    const saveId = game.combat.pendingSaves[0].id;
    // Preview: d20 3 + WIS +1 = 4 < 14 - a failure about to land 7 psychic.
    const preview = answerSave(game, nextCommandId(), saveId, "roll", undefined, false, { role: "gm" }, saveDeps(game, 3));
    expect(preview.outcome).toMatchObject({ success: false, committed: false, appliedDamage: 7 });
    // Commit with Legendary Resistance: forced success - the SUCCESS outcome still applies (this
    // save halves on success: 3 of 7), one daily use spent, narrated.
    const committed = answerSave(game, nextCommandId(), saveId, "manual", preview.outcome.total, true, { role: "gm" }, saveDeps(game, 3), true);
    expect(committed.outcome).toMatchObject({ success: true, committed: true, appliedDamage: 3 });
    const boss = game.actors.find((actor) => actor.id === BOSS)!;
    expect(boss.hp.current).toBe(147);
    expect(boss.actionUses["legendary-resistance"]).toBe(1);
    expect(committed.events.some((event) => /Legendary Resistance to succeed \(2 of 3 remaining\)/.test(event.text))).toBe(true);
    expect(game.combat.pendingSaves).toHaveLength(0);
  });

  it("Legendary Resistance rejects when exhausted, spends nothing on a natural success, and re-arms on a long rest", () => {
    const exhausted = buildBossGame({ "legendary-resistance": 3 });
    resolve(exhausted, bossDefinition, "dread-word", { actorId: IDS.torva, targetIds: [BOSS] }, [3, 4]);
    expect(() => answerSave(exhausted, nextCommandId(), exhausted.combat.pendingSaves[0].id, "manual", 2, true, { role: "gm" }, saveDeps(exhausted, 3), true))
      .toThrowError(/no Legendary Resistance left/);
    // A natural success with the flag set spends nothing - "succeed instead" only matters on a failure.
    const fresh = buildBossGame();
    resolve(fresh, bossDefinition, "dread-word", { actorId: IDS.torva, targetIds: [BOSS] }, [3, 4]);
    const committed = answerSave(fresh, nextCommandId(), fresh.combat.pendingSaves[0].id, "manual", 20, true, { role: "gm" }, saveDeps(fresh, 3), true);
    expect(committed.outcome.success).toBe(true);
    expect(fresh.actors.find((actor) => actor.id === BOSS)!.actionUses["legendary-resistance"]).toBeUndefined();
    // Long rest re-arms the daily pool (day = long rest, out of combat).
    const resting = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [{ id: BOSS, name: "Test Boss", kind: "monster", visibility: "public", hp: { current: 150, maximum: 150 }, armorClass: 17, definitionId: "test-boss", actionUses: { "legendary-resistance": 2 } }],
      definitions: [{ id: "test-boss", definition: bossDefinition }]
    });
    applyRest(resting, BOSS, "long", (definitionId) => resting.definitions.find((entry) => entry.id === definitionId)?.definition);
    expect(resting.actors[0].actionUses["legendary-resistance"]).toBeUndefined();
  });

  it("the SRD bundle carries legendary resources (adult red dragon golden check + coverage floors)", () => {
    const monsters = loadMonsterDefinitions();
    const dragon = monsters.find((monster) => monster.source.externalId === "adult-red-dragon")!;
    expect(dragon.legendary).toEqual({ actionsPerRound: 3, resistancesPerDay: 3 });
    expect(dragon.actions.find((action) => action.id === "commanding-presence")!.legendary).toEqual({ cost: 1 });
    // SRD 5.2.1: all 30 legendary creatures print "Legendary Action Uses: 3" (the lair bump stays
    // prose); 32 creatures carry Legendary Resistance; every legendary action row costs 1.
    expect(monsters.filter((monster) => monster.legendary?.actionsPerRound === 3).length).toBe(30);
    expect(monsters.filter((monster) => monster.legendary?.resistancesPerDay !== undefined).length).toBe(32);
    expect(monsters.flatMap((monster) => monster.actions).filter((action) => action.legendary).length).toBe(82);
  });
});

describe("hit dice (SRD Hit Point Dice; short-rest healing adoption)", () => {
  const HERO = "10000000-0000-4000-8000-000000000008";
  function buildRestingGame(remaining = 7, current = 30): GameState {
    return GameStateSchema.parse({
      schemaVersion: 1,
      actors: [{ id: HERO, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current, maximum: 75 }, armorClass: 15, definitionId: "import-torva", hitDice: { die: "d12", maximum: 7, remaining } }],
      definitions: [{ id: "import-torva", definition: torvaDefinition }]
    });
  }
  const resolveTorva = (game: GameState) => (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition;

  it("seeds the pool from the definition's hit-point formula, or leaves it unmodeled", () => {
    expect(hitDiceFromDefinition(torvaDefinition)).toEqual(torvaDefinition.hitPoints.formula
      ? { die: `d${torvaDefinition.hitPoints.formula.match(/d(\d+)/)![1]}`, maximum: Number.parseInt(torvaDefinition.hitPoints.formula, 10), remaining: Number.parseInt(torvaDefinition.hitPoints.formula, 10) }
      : null);
    const formulaless = ActorDefinitionSchema.parse({ ...JSON.parse(JSON.stringify(torvaDefinition)), hitPoints: { maximum: 20 } });
    expect(hitDiceFromDefinition(formulaless)).toBeNull();
    const crocodile = loadMonsterDefinitions().find((monster) => monster.source.externalId === "giant-crocodile")!;
    expect(hitDiceFromDefinition(crocodile)).toMatchObject({ die: "d12", remaining: 9 });
  });

  it("each spent die heals its face + Con modifier (minimum 1) through healActor and decrements the pool", () => {
    const game = buildRestingGame();
    // Torva's Con modifier from the fixture; faces 1 and 8.
    const conModifier = Math.floor((torvaDefinition.abilityScores.con - 10) / 2);
    const outcome = spendHitDice(game, HERO, [1, 8], { role: "gm" }, resolveTorva(game));
    expect(outcome.conModifier).toBe(conModifier);
    expect(outcome.healed).toBe(Math.max(1, 1 + conModifier) + Math.max(1, 8 + conModifier));
    expect(game.actors[0].hp.current).toBe(30 + outcome.healed);
    expect(game.actors[0].hitDice).toMatchObject({ remaining: 5 });
  });

  it("clamps each die to a minimum of 1 HP even with a negative Con modifier", () => {
    const frail = ActorDefinitionSchema.parse({ ...JSON.parse(JSON.stringify(torvaDefinition)), abilityScores: { ...torvaDefinition.abilityScores, con: 6 } });
    const game = buildRestingGame();
    game.definitions = [{ id: "import-torva", definition: frail }];
    const outcome = spendHitDice(game, HERO, [1, 1], { role: "gm" }, resolveTorva(game));
    expect(outcome.conModifier).toBe(-2);
    expect(outcome.healed).toBe(2); // two dice, both clamped to 1
  });

  it("rejects spending past the pool, without a pool, or while in an active encounter", () => {
    const empty = buildRestingGame(1);
    expect(() => spendHitDice(empty, HERO, [4, 4], { role: "gm" }, resolveTorva(empty))).toThrowError(/1 Hit Die left/);
    const unmodeled = buildRestingGame();
    unmodeled.actors[0].hitDice = null;
    expect(() => spendHitDice(unmodeled, HERO, [4], { role: "gm" }, resolveTorva(unmodeled))).toThrowError(/no Hit Dice pool/);
    const fighting = buildDiceGameInCombat();
    expect(() => spendHitDice(fighting, IDS.torva, [4], { role: "gm" }, (definitionId) => fighting.definitions.find((entry) => entry.id === definitionId)?.definition)).toThrowError(/end the encounter/i);
  });

  function buildDiceGameInCombat(): GameState {
    const game = buildGame();
    game.actors = game.actors.map((actor) => actor.id === IDS.torva ? { ...actor, hitDice: { die: "d12" as const, maximum: 7, remaining: 7 } } : actor);
    return game;
  }

  it("a long rest restores all spent Hit Point Dice (SRD 5.2.1 Regain All HP)", () => {
    const game = buildRestingGame(2, 10);
    applyRest(game, HERO, "long", resolveTorva(game));
    expect(game.actors[0].hitDice).toEqual({ die: "d12", maximum: 7, remaining: 7 });
    expect(game.actors[0].hp.current).toBe(75);
  });

  it("hit dice reach only the owning player; other players and old saves stay safe", () => {
    const game = buildRestingGame();
    const OWNER = "30000000-0000-4000-8000-00000000000b";
    game.actors[0].ownerSessionId = OWNER;
    const ownView = projectPlayerView(game, OWNER, () => null).actors[0];
    expect(ownView.hitDice).toEqual({ die: "d12", maximum: 7, remaining: 7 });
    const strangerView = projectPlayerView(game, "30000000-0000-4000-8000-00000000000c", () => null).actors[0];
    expect("hitDice" in strangerView).toBe(false);
    // Pre-hit-dice saves parse with the null default (additive-state pattern).
    const legacy = GameStateSchema.parse({ schemaVersion: 1, actors: [{ id: HERO, name: "Old Save", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 } }] });
    expect(legacy.actors[0].hitDice).toBeNull();
  });
});

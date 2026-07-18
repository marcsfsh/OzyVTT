import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { actionAvailability, resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { answerReaction, dismissReaction } from "../src/reactions.js";
import { applyDamageDetailed, healActor } from "../src/hit-points.js";
import { endEffect, endEncounterEffects, expireEffectsAtTurnStart } from "../src/effects.js";
import { applyTimelineRestore } from "../src/combat-history.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { RulesBlockedError } from "../src/game-store.js";

/**
 * Regression suite derived from the two archived replay encounters (Torva/Pip/Sable vs two giant
 * crocodiles): the manual GM run's rules mistakes — double Frenzy with no Rage on round 1, a
 * single-roll Extra Attack, unresisted crocodile damage against a raging barbarian, grapples that
 * never existed as state, and 1-HP procedural heals standing in for a dying state — must now be
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
      { id: IDS.torva, name: "Torva Grimtusk", kind: "player-character", visibility: "public", hp: { current: 75, maximum: 75 }, armorClass: 15, definitionId: "import-torva", size: "medium" },
      { id: IDS.pip, name: "Pip Underbough", kind: "player-character", visibility: "public", hp: { current: 52, maximum: 52 }, armorClass: 16, definitionId: "import-pip", size: "small" },
      { id: IDS.sable, name: "Sable Vex", kind: "player-character", visibility: "public", hp: { current: 52, maximum: 52 }, armorClass: 13, definitionId: "import-sable", size: "medium" },
      { id: IDS.croc1, name: "Giant Crocodile", kind: "monster", visibility: "public", hp: { current: 85, maximum: 85 }, armorClass: 14, definitionId: "giant-crocodile", size: "huge" },
      { id: IDS.croc2, name: "Giant Crocodile 2", kind: "monster", visibility: "public", hp: { current: 85, maximum: 85 }, armorClass: 14, definitionId: "giant-crocodile", size: "huge" }
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

describe("report test 1 — Rage and Frenzy on round 1", () => {
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

    // Frenzy now satisfies its Rage requirement but the bonus action is spent — the round-1 double
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

describe("report test 2 — Extra Attack", () => {
  it("gives the Attack action two attacks consuming one action slot, then blocks a third", () => {
    const game = buildGame();
    const first = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6]);
    expect(first.attack?.outcome).toBe("hit"); // 15 + 7 = 22 vs AC 14
    expect(game.combat.turn.actionUsed).toBe(true);
    expect(first.componentsRemaining).toEqual({ attack: 1 });

    // Attack 2 of 2 may even switch weapons (SRD Extra Attack) — the pool is generic.
    const second = resolve(game, torvaDefinition, "handaxe-thrown", { actorId: IDS.torva, targetIds: [IDS.croc2] }, [12, 4]);
    expect(second.attack?.outcome).toBe("hit");
    expect(second.componentsRemaining).toBeNull();

    expect(() => resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, []))
      .toThrow(/no attacks remaining in this action/);
  });
});

describe("report test 3 — Reckless Attack", () => {
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

describe("report test 4 — Rage damage and resistance", () => {
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

describe("report test 5 — critical hits and Savage Attacks", () => {
  it("doubles the dice and adds exactly one declared bonus weapon die on a natural 20", () => {
    const game = buildGame();
    const crit = resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [20, 6, 6, 6]);
    expect(crit.crit).toBe(true);
    expect(crit.damage).toEqual([{ formula: "3d12 + 4", type: "slashing", total: 22 }]); // 2 doubled + 1 Savage Attacks
  });
});

describe("report test 6 (partial) — Sneak Attack once per turn", () => {
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

describe("report test 8 — crocodile Multiattack, grapple riders, and target rules", () => {
  it("tracks one Bite + one Tail per Multiattack, applies the source-linked grapple, and forbids Tail against the held target", () => {
    const game = buildGame([{ actorId: IDS.croc1, score: 20 }, { actorId: IDS.pip, score: 12 }, { actorId: IDS.torva, score: 8 }]);

    // Bite opens the Multiattack plan and, on a hit, grapples: Grappled + Restrained as ONE
    // source-linked effect carrying the printed escape DC — the state the manual run never had.
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

describe("report test 9 — zero HP, dying, and healing", () => {
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

describe("report test 12 — GM override", () => {
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

describe("effect lifecycle — Frenzy's Exhaustion and Rage duration", () => {
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
    // Sable is not in this fight — a parked scene's effect on her must survive the sweep.
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

describe("report test 2/3 supplement — Eldritch Blast beams", () => {
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

describe("reaction prompts — Uncanny Dodge (ADR-0020 amendment)", () => {
  // Prompt creation needs the TARGET's definition, so these resolves carry the game's own resolver.
  const gameResolver = (game: GameState) => (definitionId: string) => game.definitions.find((entry) => entry.id === definitionId)?.definition;
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
    // The bite's grapple rider still applied immediately — only the DAMAGE waits on the answer.
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.conditions.map((condition) => condition.id).sort()).toEqual(["grappled", "restrained"]);
    expect(pip.hp.current).toBe(52); // nothing applied yet
  });

  it("answering use spends the reaction and applies half; the prompt clears", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    const outcome = answerReaction(game, game.combat.pendingReactions[0].id, true, { role: "gm" }, { resolveDefinition: gameResolver(game) });
    expect(outcome).toMatchObject({ used: true, appliedDamage: 11, actorName: "Pip Underbough", actionName: "Uncanny Dodge" }); // floor(23/2)
    const pip = game.actors.find((actor) => actor.id === IDS.pip)!;
    expect(pip.hp.current).toBe(52 - 11);
    expect(game.combat.reactionsUsed).toContain(IDS.pip);
    expect(game.combat.pendingReactions).toHaveLength(0);
  });

  it("declining applies the full parked damage and keeps the reaction", () => {
    const game = buildGame();
    resolveLive(game, crocodileDefinition, "bite", { actorId: IDS.croc1, targetIds: [IDS.pip] }, [15, 6, 6, 6]);
    const outcome = answerReaction(game, game.combat.pendingReactions[0].id, false, { role: "gm" }, { resolveDefinition: gameResolver(game) });
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
    expect(() => answerReaction(game, promptId, true, { role: "gm" }, { resolveDefinition: gameResolver(game) }))
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
    expect(() => answerReaction(game, promptId, true, { role: "player", sessionId: IDS.gmSession }, { resolveDefinition: gameResolver(game) }))
      .toThrow();
    game.actors.find((actor) => actor.id === IDS.pip)!.ownerSessionId = IDS.gmSession;
    const outcome = answerReaction(game, promptId, true, { role: "player", sessionId: IDS.gmSession }, { resolveDefinition: gameResolver(game) });
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
    const before = actionAvailability(game, torva, torvaDefinition);
    const frenzyRow = before.find((row) => row.id === "frenzy")!;
    expect(frenzyRow.available).toBe(false);
    expect(frenzyRow.violations.map((violation) => violation.rule)).toContain("feature.requires-effect");
    const rageRow = before.find((row) => row.id === "rage")!;
    expect(rageRow).toMatchObject({ available: true, usesRemaining: 4 });

    // Rage, then the first Greataxe swing: the report tracks the spent bonus action, the spent use,
    // and the open Extra Attack instance.
    resolve(game, torvaDefinition, "rage", { actorId: IDS.torva }, []);
    resolve(game, torvaDefinition, "greataxe", { actorId: IDS.torva, targetIds: [IDS.croc1] }, [15, 6, 6]);
    const after = actionAvailability(game, torva, torvaDefinition);
    expect(after.find((row) => row.id === "rage")).toMatchObject({ available: false, usesRemaining: 3 });
    expect(after.find((row) => row.id === "greataxe")).toMatchObject({ available: true, componentsRemaining: 1 });
    expect(after.find((row) => row.id === "frenzy")!.violations.map((violation) => violation.rule)).toContain("economy.bonus-action-used");
  });

  it("never mutates state", () => {
    const game = buildGame();
    const torva = game.actors.find((actor) => actor.id === IDS.torva)!;
    const snapshot = JSON.stringify(game);
    actionAvailability(game, torva, torvaDefinition);
    expect(JSON.stringify(game)).toBe(snapshot);
  });
});

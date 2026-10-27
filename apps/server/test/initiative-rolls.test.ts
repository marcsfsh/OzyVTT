import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import {
  addCombatant,
  nextInitiativeTurn,
  rollRemainingInitiative,
  rollSelfInitiative,
  offerInitiativeSwap,
  setInitiativeScore,
  startEncounter,
  swapInitiative
} from "../src/encounter.js";
import type { ActorDefinition } from "@vtt/schemas";
import { evaluateActionEconomy } from "../src/resolution/economy.js";
import { rerollInitiative } from "../src/initiative-reroll.js";
import { makeEffect } from "../src/effects.js";

const PC = "10000000-0000-4000-8000-000000000001";
const PC2 = "10000000-0000-4000-8000-000000000003";
const MON = "10000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-00000000000a";
const OWNER2 = "30000000-0000-4000-8000-00000000000b";
const MAP = "20000000-0000-5000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const queue = (values: number[]) => {
  const q = [...values];
  return () => q.shift() ?? 1;
};

// Alpha (init +2, owned), Beta (init +0, owned), Goblin (monster). Player-rolled initiative parks the two PCs.
function fresh(mode: "immediate" | "wait" = "immediate"): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: PC,
        name: "Alpha",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        ownerSessionId: OWNER,
        initiative: 2
      },
      {
        id: PC2,
        name: "Beta",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        ownerSessionId: OWNER2,
        initiative: 0
      },
      { id: MON, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } }
    ],
    combat: { playerInitiativeMode: mode }
  });
}
const started = (mode: "immediate" | "wait", rolls: number[]) => {
  const game = fresh(mode);
  startEncounter(
    game,
    { mapAssetId: MAP, entries: [{ actorId: PC }, { actorId: PC2 }, { actorId: MON }], playersRollInitiative: true },
    queue(rolls),
    GEOMETRY
  );
  return game;
};
const scoreOf = (game: GameState, id: string) => game.combat.initiative.find((entry) => entry.actorId === id)?.score;

describe("player-rolled initiative", () => {
  it("parks only claimed player-characters (not monsters) with a provisional auto-roll", () => {
    const game = started("immediate", [10, 10, 15]); // Alpha 10+2=12, Beta 10, Goblin 15
    expect([...game.combat.pendingInitiative].sort()).toEqual([PC, PC2].sort());
    expect(scoreOf(game, PC)).toBe(12);
    expect(scoreOf(game, MON)).toBe(15);
    expect(game.combat.turnActorId).toBe(MON); // provisional order: Goblin 15 on top
  });

  it("does not park anyone when playersRollInitiative is off", () => {
    const game = fresh("immediate");
    startEncounter(game, { mapAssetId: MAP, entries: [{ actorId: PC }, { actorId: MON }] }, queue([9, 9]), GEOMETRY);
    expect(game.combat.pendingInitiative).toEqual([]);
  });

  it("lets a player roll their own initiative (die + modifier), clearing their pending flag", () => {
    const game = started("immediate", [10, 10, 15]);
    const total = rollSelfInitiative(game, PC, { natural: 18 }, queue([]));
    expect(total).toBe(20); // 18 + 2
    expect(scoreOf(game, PC)).toBe(20);
    expect(game.combat.pendingInitiative).toEqual([PC2]);
  });

  it("refuses a second roll once initiative is set, and rejects an unknown actor", () => {
    const game = started("immediate", [10, 10, 15]);
    rollSelfInitiative(game, PC, { natural: 18 }, queue([]));
    expect(() => rollSelfInitiative(game, PC, { natural: 5 }, queue([]))).toThrow(/already set/);
    expect(() => rollSelfInitiative(game, "99999999-0000-4000-8000-000000000000", {}, queue([7]))).toThrow(
      /not in this encounter/
    );
  });

  it("immediate mode never blocks turn advancement, even with rolls still pending", () => {
    const game = started("immediate", [10, 10, 15]);
    expect(game.combat.pendingInitiative.length).toBe(2);
    expect(() => nextInitiativeTurn(game)).not.toThrow();
  });

  it("wait mode holds turns until everyone has rolled, then begins on the final order", () => {
    const game = started("wait", [10, 10, 15]);
    expect(() => nextInitiativeTurn(game)).toThrow(/still rolling initiative/);
    rollSelfInitiative(game, PC, { natural: 18 }, queue([])); // Alpha 20
    expect(() => nextInitiativeTurn(game)).toThrow(/still rolling initiative/); // Beta still pending
    rollSelfInitiative(game, PC2, { natural: 12 }, queue([])); // Beta 12
    expect(game.combat.pendingInitiative).toEqual([]);
    // Gather complete: turns begin on the final order (Alpha 20, Goblin 15, Beta 12) from the top.
    expect(game.combat.turnActorId).toBe(PC);
    expect(game.combat.round).toBe(1);
    expect(() => nextInitiativeTurn(game)).not.toThrow();
  });

  it("lets the GM settle the rest with the start's rolls to begin a wait-mode encounter", () => {
    const game = started("wait", [10, 10, 15]); // Alpha 12, Beta 10, Goblin 15
    rollRemainingInitiative(game);
    expect(game.combat.pendingInitiative).toEqual([]);
    // The provisional rolls already followed the rules and are in the feed, so they stand.
    expect(scoreOf(game, PC)).toBe(12);
    expect(scoreOf(game, PC2)).toBe(10);
    expect(game.combat.turnActorId).toBe(MON);
    expect(() => nextInitiativeTurn(game)).not.toThrow();
  });

  it("a GM-set score clears that actor's pending roll", () => {
    const game = started("wait", [10, 10, 15]);
    setInitiativeScore(game, PC, 25);
    expect(game.combat.pendingInitiative).toEqual([PC2]);
    expect(scoreOf(game, PC)).toBe(25);
  });
});

const order = (game: GameState) => game.combat.initiative.map((entry) => entry.actorId);
const turn = (game: GameState) => game.combat.turnActorId;

describe("a late roll mid-round", () => {
  it("doesn't skip a combatant whose new score lands ahead of the current turn", () => {
    const game = started("immediate", [8, 5, 20]); // Alpha 10, Beta 5, Goblin 20
    nextInitiativeTurn(game); // Goblin acted; Alpha's turn
    expect(turn(game)).toBe(PC);
    rollSelfInitiative(game, PC2, { natural: 19 }, queue([])); // Beta 19, which would sort above Alpha
    nextInitiativeTurn(game);
    expect(turn(game)).toBe(PC2); // Beta still gets round 1
    expect(game.combat.round).toBe(1);
    nextInitiativeTurn(game);
    // A new round sorts fully.
    expect(game.combat.round).toBe(2);
    expect(order(game)).toEqual([MON, PC2, PC]);
    expect(turn(game)).toBe(MON);
  });

  it("doesn't give a second turn to a combatant who acted and then rolled low", () => {
    const game = started("immediate", [18, 5, 10]); // Alpha 20, Beta 5, Goblin 10
    expect(turn(game)).toBe(PC);
    nextInitiativeTurn(game); // Alpha acted; Goblin's turn
    rollSelfInitiative(game, PC, { natural: 1 }, queue([])); // Alpha 3, which would sort last
    nextInitiativeTurn(game);
    expect(turn(game)).toBe(PC2);
    nextInitiativeTurn(game);
    expect(game.combat.round).toBe(2);
    expect(turn(game)).toBe(MON);
  });

  it("keeps the same guarantee when the GM edits a score", () => {
    const game = started("immediate", [8, 5, 20]); // Alpha 10, Beta 5, Goblin 20
    rollRemainingInitiative(game);
    nextInitiativeTurn(game); // Alpha's turn
    setInitiativeScore(game, PC2, 30);
    nextInitiativeTurn(game);
    expect(turn(game)).toBe(PC2);
  });
});

describe("what the rules give an initiative roll", () => {
  const withConditions = (conditions: Array<{ id: string; level?: number }>) => {
    const game = fresh("immediate");
    game.actors[0].conditions = conditions;
    return game;
  };
  const startAlone = (game: GameState, rolls: number[], surprised = false) => {
    startEncounter(game, { mapAssetId: MAP, entries: [{ actorId: PC, surprised }] }, queue(rolls), GEOMETRY);
    return scoreOf(game, PC);
  };

  it("gives Invisible Advantage, Incapacitated Disadvantage, and takes Exhaustion off the total", () => {
    expect(startAlone(withConditions([{ id: "invisible" }]), [4, 17])).toBe(19); // max(4, 17) + 2
    expect(startAlone(withConditions([{ id: "stunned" }]), [4, 17])).toBe(6); // min(4, 17) + 2
    expect(startAlone(withConditions([{ id: "exhaustion", level: 2 }]), [10])).toBe(8); // 10 + 2 - 4
    // Invisible and Surprised cancel to one die.
    expect(startAlone(withConditions([{ id: "invisible" }]), [4, 17], true)).toBe(6);
  });

  it("keeps Surprise for a player who rolls their own initiative later", () => {
    const game = fresh("immediate");
    startEncounter(
      game,
      { mapAssetId: MAP, entries: [{ actorId: PC, surprised: true }, { actorId: MON }], playersRollInitiative: true },
      queue([10, 10, 10]),
      GEOMETRY
    );
    expect(rollSelfInitiative(game, PC, {}, queue([15, 3]))).toBe(5); // Disadvantage: min(15, 3) + 2
  });

  it("rolls a mid-encounter joiner under the same rules, fresh", () => {
    const game = fresh("immediate");
    startEncounter(game, { mapAssetId: MAP, entries: [{ actorId: PC2 }] }, queue([10]), GEOMETRY);
    game.actors[0].conditions = [{ id: "invisible" }];
    const rolls: unknown[] = [];
    addCombatant(game, PC, undefined, queue([3, 16]), GEOMETRY, 0, (roll) => rolls.push(roll));
    expect(scoreOf(game, PC)).toBe(18); // max(3, 16) + 2
    expect(rolls).toEqual([{ actorId: PC, natural: 16, modifier: 2, total: 18, mode: "advantage" }]);
  });

  it("rolls once for a group of identical monsters when the GM asks", () => {
    const game = fresh("immediate");
    const second = { ...game.actors[2], id: "10000000-0000-4000-8000-000000000004", name: "Goblin 2" };
    game.actors[2].definitionId = "goblin-warrior";
    game.actors.push({ ...second, definitionId: "goblin-warrior" });
    const rolls: unknown[] = [];
    startEncounter(
      game,
      { mapAssetId: MAP, entries: [{ actorId: MON }, { actorId: second.id }], groupMonsters: true },
      queue([7, 19]),
      GEOMETRY,
      undefined,
      0,
      undefined,
      (roll) => rolls.push(roll)
    );
    expect(scoreOf(game, MON)).toBe(7);
    expect(scoreOf(game, second.id)).toBe(7);
    expect(rolls.length).toBe(1);
  });
});

describe("Alert's Initiative Swap", () => {
  it("trades two scores before either has acted, and refuses afterwards or while Incapacitated", () => {
    const game = started("immediate", [8, 5, 20]); // Alpha 10, Beta 5, Goblin 20
    rollRemainingInitiative(game);
    swapInitiative(game, PC, PC2);
    expect(scoreOf(game, PC)).toBe(5);
    expect(scoreOf(game, PC2)).toBe(10);
    game.actors[1].conditions = [{ id: "paralyzed" }];
    expect(() => swapInitiative(game, PC, PC2)).toThrow(/Paralyzed/);
    game.actors[1].conditions = [];
    nextInitiativeTurn(game); // Beta now acts
    nextInitiativeTurn(game);
    expect(() => swapInitiative(game, PC, PC2)).toThrow(/before either has acted/);
  });
});

describe("Alert's Initiative Swap from a player", () => {
  /** Alpha holds Alert; the two characters belong to different players. */
  const ALERT = {
    name: "Alpha",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    hitPoints: { maximum: 20 },
    armorClass: 12,
    extensions: { test: { traits: [{ name: "Alert" }] } },
    actions: []
  } as unknown as ActorDefinition;
  const resolveDefinition = (id: string) => (id === "alert" ? ALERT : undefined);
  const table = () => {
    const game = started("immediate", [8, 5, 20]); // Alpha 10, Beta 5, Goblin 20
    rollRemainingInitiative(game);
    game.actors[0]!.definitionId = "alert";
    return game;
  };
  const player = (sessionId: string) => ({ role: "player", sessionId }) as const;

  it("is offered by the Alert holder's player and made when the ally's player takes it", () => {
    const game = table();
    expect(offerInitiativeSwap(game, player(OWNER), PC, PC2, resolveDefinition)).toBe("offered");
    expect(scoreOf(game, PC)).toBe(10);
    expect(game.combat.initiativeSwapOffers).toEqual([{ actorId: PC, withActorId: PC2 }]);
    expect(offerInitiativeSwap(game, player(OWNER2), PC2, PC, resolveDefinition)).toBe("swapped");
    expect(scoreOf(game, PC)).toBe(5);
    expect(scoreOf(game, PC2)).toBe(10);
    expect(game.combat.initiativeSwapOffers).toEqual([]);
  });

  it("refuses a character without Alert, another player's character, and an enemy", () => {
    const game = table();
    expect(() => offerInitiativeSwap(game, player(OWNER2), PC2, PC, resolveDefinition)).toThrow(/doesn't have/);
    expect(() => offerInitiativeSwap(game, player(OWNER2), PC, PC2, resolveDefinition)).toThrow(/your own/);
    expect(() => offerInitiativeSwap(game, player(OWNER), PC, MON, resolveDefinition)).toThrow(/willing ally/);
  });

  it("is still the GM's to make at once", () => {
    const game = table();
    expect(offerInitiativeSwap(game, { role: "gm" }, PC2, MON, resolveDefinition)).toBe("swapped");
    expect(scoreOf(game, PC2)).toBe(20);
  });
});

describe("a wait-mode encounter before everyone has rolled", () => {
  it("refuses actions, since the turn economy resets when turns begin", () => {
    const game = started("wait", [10, 10, 15]); // Goblin 15 is the provisional top
    const goblin = game.actors.find((actor) => actor.id === MON)!;
    const swing = { id: "club", name: "Club", activation: "action", damage: [] } as never;
    const blocked = evaluateActionEconomy(game, goblin, swing, [], undefined);
    expect(blocked.violations.map((violation) => violation.rule)).toContain("initiative.gathering");
    rollRemainingInitiative(game);
    const open = evaluateActionEconomy(game, goblin, swing, [], undefined);
    expect(open.violations.map((violation) => violation.rule)).not.toContain("initiative.gathering");
  });
});

describe("ties", () => {
  it("lets the GM put one tied combatant before another", () => {
    const game = fresh("immediate");
    startEncounter(
      game,
      {
        mapAssetId: MAP,
        entries: [
          { actorId: PC, score: 12 },
          { actorId: PC2, score: 12 }
        ]
      },
      queue([]),
      GEOMETRY
    );
    expect(order(game)).toEqual([PC, PC2]); // Alpha's +2 modifier breaks the tie
    setInitiativeScore(game, PC2, 12, 3);
    nextInitiativeTurn(game);
    nextInitiativeTurn(game);
    expect(order(game)).toEqual([PC2, PC]);
  });
});

// SRD 5.2.1 Heroic Inspiration: "you can expend it to reroll any die immediately after rolling it, and you must use the
// new roll." Initiative is a Dexterity check, so its die may be rerolled before the character's first turn.
describe("Heroic Inspiration on an initiative roll", () => {
  const player = { role: "player" as const, sessionId: OWNER };

  it("rerolls the held die once Heroic Inspiration is spent, and the new score sets the order", () => {
    const game = started("wait", [10, 10, 15]);
    rollSelfInitiative(game, PC, {}, queue([3]));
    expect(scoreOf(game, PC)).toBe(5);
    expect(() => rerollInitiative(game, PC, player, undefined, queue([18]))).toThrowError(
      /Alpha has no Heroic Inspiration to reroll the die with/
    );
    game.actors.find((actor) => actor.id === PC)!.heroicInspiration = true;
    expect(rerollInitiative(game, PC, player, undefined, queue([18]))).toBe(20);
    expect(scoreOf(game, PC)).toBe(20);
    expect(game.actors.find((actor) => actor.id === PC)!.heroicInspiration).toBe(false);
    // The die is spent: a second reroll has nothing held to throw again.
    expect(() => rerollInitiative(game, PC, { role: "gm" }, undefined, queue([1]))).toThrowError(
      /Roll initiative first/
    );
  });

  it("is refused once the encounter has come to the character's first turn", () => {
    const game = started("immediate", [10, 10, 1]);
    rollSelfInitiative(game, PC, {}, queue([10]));
    rollSelfInitiative(game, PC2, {}, queue([1]));
    // Alpha 12 leads the order, so Alpha's turn has begun.
    expect(game.combat.turnActorId).toBe(PC);
    game.actors.find((actor) => actor.id === PC)!.heroicInspiration = true;
    expect(() => rerollInitiative(game, PC, player, undefined, queue([18]))).toThrowError(
      /rerolled only right after it is rolled, before Alpha's first turn/
    );
  });
});

// SRD 5.2.1 Initiative: "you make a Dexterity check", so the dice a rider adds to or takes off an ability check reach
// it (here a homebrew curse's -1d6).
describe("dice riders on initiative", () => {
  it("rolls the dice a check rider adds and counts them in the score", () => {
    const game = fresh("immediate");
    game.actors
      .find((actor) => actor.id === PC)!
      .effects.push(
        makeEffect({
          id: "curse",
          name: "Muddled",
          startedRound: 1,
          duration: { type: "rounds", remaining: 10 },
          modifiers: [{ type: "check-bonus", amount: 0, dice: "-1d6", when: [{ type: "on-ability-check" }] }]
        })
      );
    startEncounter(
      game,
      { mapAssetId: MAP, entries: [{ actorId: PC }, { actorId: MON }] },
      queue([12, 9]),
      GEOMETRY,
      undefined,
      Date.now(),
      undefined,
      undefined,
      () => 4
    );
    // Alpha: 12 + 2 - 4.
    expect(scoreOf(game, PC)).toBe(10);
    expect(scoreOf(game, MON)).toBe(9);
  });
});

import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { projectPlayerCombat, projectPlayerRollCalls } from "../src/projections.js";

// A defeated monster takes no more turns, a dying character keeps its own, and the table only offers what is still
// owed: no second death save, and no roll call the player has answered.

const IDS = {
  hero: "10000000-0000-4000-8000-0000000000c1",
  goblin: "10000000-0000-4000-8000-0000000000c2",
  boss: "10000000-0000-4000-8000-0000000000c3",
  map: "20000000-0000-5000-8000-0000000000c1",
  player: "30000000-0000-4000-8000-0000000000c1"
} as const;

function fight() {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Lyra",
        kind: "player-character",
        hp: { current: 20, maximum: 20 },
        ownerSessionId: IDS.player
      },
      { id: IDS.goblin, name: "Goblin Warrior", kind: "monster", hp: { current: 7, maximum: 7 } },
      { id: IDS.boss, name: "Goblin Boss", kind: "monster", hp: { current: 21, maximum: 21 } }
    ]
  });
  startEncounter(
    game,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.goblin, score: 15 },
        { actorId: IDS.boss, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return game;
}
const actor = (game: ReturnType<typeof fight>, id: string) => game.actors.find((candidate) => candidate.id === id)!;

describe("turns in an encounter", () => {
  it("passes over a defeated monster, in the round and across its end", () => {
    const game = fight();
    actor(game, IDS.goblin).hp.current = 0;
    nextInitiativeTurn(game);
    expect(game.combat.turnActorId).toBe(IDS.boss);
    // The boss falls too: the order comes back round to Lyra in round 2.
    actor(game, IDS.boss).hp.current = 0;
    nextInitiativeTurn(game);
    expect(game.combat.turnActorId).toBe(IDS.hero);
    expect(game.combat.round).toBe(2);
  });

  it("gives a defeated monster its turn back once it is healed", () => {
    const game = fight();
    actor(game, IDS.goblin).hp.current = 0;
    actor(game, IDS.goblin).hp.current = 3;
    nextInitiativeTurn(game);
    expect(game.combat.turnActorId).toBe(IDS.goblin);
  });

  it("keeps a dying character's turn, and a troll's whose turn decides whether it rises", () => {
    const game = fight();
    actor(game, IDS.hero).hp.current = 0;
    actor(game, IDS.goblin).hp.current = 0;
    actor(game, IDS.goblin).effects = [
      {
        id: "40000000-0000-4000-8000-0000000000c1",
        name: "Down at 0 HP (Regeneration)",
        tags: ["regenerating-at-zero"],
        sourceActorId: null,
        sourceName: null,
        startedRound: 1,
        duration: { type: "manual" }
      }
    ] as unknown as ReturnType<typeof fight>["actors"][number]["effects"];
    nextInitiativeTurn(game);
    expect(game.combat.turnActorId).toBe(IDS.goblin);
    nextInitiativeTurn(game);
    nextInitiativeTurn(game);
    expect(game.combat.turnActorId).toBe(IDS.hero);
  });

  it("tells the dying character's player that this turn's death save is made", () => {
    const game = fight();
    expect(projectPlayerCombat(game, IDS.player).turn).not.toHaveProperty("deathSaveRolled");
    game.combat.turn = { ...game.combat.turn, deathSaveRolled: true };
    expect(projectPlayerCombat(game, IDS.player).turn.deathSaveRolled).toBe(true);
  });

  it("ends a roll call for the player once their character has answered it", () => {
    const game = fight();
    game.rollCalls = [
      {
        id: "50000000-0000-4000-8000-0000000000c1",
        kind: "check",
        subject: { kind: "skill", skill: "perception" },
        dc: 14,
        blind: false,
        entries: [{ actorId: IDS.hero }],
        createdAt: 0
      }
    ] as unknown as typeof game.rollCalls;
    expect(projectPlayerRollCalls(game, IDS.player)).toHaveLength(1);
    game.rollCalls = game.rollCalls.map((call) => ({
      ...call,
      entries: call.entries.map((entry) => ({ ...entry, result: { total: 15, natural: 14, success: true } }))
    })) as unknown as typeof game.rollCalls;
    expect(projectPlayerRollCalls(game, IDS.player)).toEqual([]);
  });
});

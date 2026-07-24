import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { nextInitiativeTurn, rollRemainingInitiative, rollSelfInitiative, setInitiativeScore, startEncounter } from "../src/encounter.js";

const PC = "10000000-0000-4000-8000-000000000001";
const PC2 = "10000000-0000-4000-8000-000000000003";
const MON = "10000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-00000000000a";
const OWNER2 = "30000000-0000-4000-8000-00000000000b";
const MAP = "20000000-0000-5000-8000-000000000001";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const queue = (values: number[]) => { const q = [...values]; return () => q.shift() ?? 1; };

// Alpha (init +2, owned), Beta (init +0, owned), Goblin (monster). Player-rolled initiative parks the two PCs.
function fresh(mode: "immediate" | "wait" = "immediate"): GameState {
  return GameStateSchema.parse({ schemaVersion: 1,
    actors: [
      { id: PC, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: OWNER, initiative: 2 },
      { id: PC2, name: "Beta", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: OWNER2, initiative: 0 },
      { id: MON, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } }
    ],
    combat: { playerInitiativeMode: mode }
  });
}
const started = (mode: "immediate" | "wait", rolls: number[]) => {
  const game = fresh(mode);
  startEncounter(game, { mapAssetId: MAP, entries: [{ actorId: PC }, { actorId: PC2 }, { actorId: MON }], playersRollInitiative: true }, queue(rolls), GEOMETRY);
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
    expect(() => rollSelfInitiative(game, "99999999-0000-4000-8000-000000000000", {}, queue([7]))).toThrow(/not in this encounter/);
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

  it("lets the GM roll for the rest to start a wait-mode fight", () => {
    const game = started("wait", [10, 10, 15]);
    rollRemainingInitiative(game, queue([20, 1])); // Alpha 20+2=22, Beta 1+0=1
    expect(game.combat.pendingInitiative).toEqual([]);
    expect(scoreOf(game, PC)).toBe(22);
    expect(game.combat.turnActorId).toBe(PC); // Alpha 22 tops Goblin 15, Beta 1
    expect(() => nextInitiativeTurn(game)).not.toThrow();
  });

  it("a GM-set score clears that actor's pending roll", () => {
    const game = started("wait", [10, 10, 15]);
    setInitiativeScore(game, PC, 25);
    expect(game.combat.pendingInitiative).toEqual([PC2]);
    expect(scoreOf(game, PC)).toBe(25);
  });
});

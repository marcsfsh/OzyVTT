import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { endEncounter, nextInitiativeTurn, previousInitiativeTurn, setInitiativeScore, startEncounter } from "../src/encounter.js";

const IDS = {
  alpha: "10000000-0000-4000-8000-000000000001",
  beta: "10000000-0000-4000-8000-000000000002",
  gamma: "10000000-0000-4000-8000-000000000003",
  map: "20000000-0000-5000-8000-000000000001"
} as const;

function state() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.alpha, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 }, initiative: 2 },
    { id: IDS.beta, name: "Beta", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 }, initiative: 0 },
    { id: IDS.gamma, name: "Gamma", kind: "monster", visibility: "gm-only", hp: { current: 10, maximum: 10 }, initiative: 5 }
  ] });
}

describe("authoritative encounter and Initiative", () => {
  it("starts from manual/server-rolled scores with deterministic tie-breaking", () => {
    const game = state();
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.alpha, score: 10 }, { actorId: IDS.beta }, { actorId: IDS.gamma, score: 10 }] }, () => 8);
    expect(game.combat).toMatchObject({ active: true, round: 1, turnActorId: IDS.gamma, mapAssetId: IDS.map });
    expect(game.combat.initiative).toEqual([
      { actorId: IDS.gamma, score: 10, tieBreaker: 5 },
      { actorId: IDS.alpha, score: 10, tieBreaker: 2 },
      { actorId: IDS.beta, score: 8, tieBreaker: 0 }
    ]);
  });

  it("advances, wraps rounds, moves backward, edits scores, and ends without discarding history", () => {
    const game = state();
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.alpha, score: 15 }, { actorId: IDS.beta, score: 10 }] }, () => 1);
    nextInitiativeTurn(game);
    expect(game.combat).toMatchObject({ round: 1, turnActorId: IDS.beta });
    nextInitiativeTurn(game);
    expect(game.combat).toMatchObject({ round: 2, turnActorId: IDS.alpha });
    previousInitiativeTurn(game);
    expect(game.combat).toMatchObject({ round: 1, turnActorId: IDS.beta });
    setInitiativeScore(game, IDS.beta, 20);
    expect(game.combat.initiative.map(({ actorId, score }) => ({ actorId, score }))).toEqual([{ actorId: IDS.beta, score: 20 }, { actorId: IDS.alpha, score: 15 }]);
    expect(game.combat.turnActorId).toBe(IDS.beta);
    endEncounter(game);
    expect(game.combat).toMatchObject({ active: false, turnActorId: null, mapAssetId: IDS.map });
    expect(game.combat.initiative).toHaveLength(2);
  });

  it("rejects duplicate, missing, malformed, and out-of-sequence mutations", () => {
    const game = state();
    expect(() => startEncounter(game, { mapAssetId: IDS.map, entries: [] }, () => 10)).toThrow("Choose 1 to 200");
    expect(() => startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.alpha }, { actorId: IDS.alpha }] }, () => 10)).toThrow("only once");
    expect(() => startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: "30000000-0000-4000-8000-000000000001" }] }, () => 10)).toThrow("no longer exists");
    expect(() => nextInitiativeTurn(game)).toThrow("Start an encounter");
    expect(() => endEncounter(game)).toThrow("no active encounter");
    const active = state();
    startEncounter(active, { mapAssetId: IDS.map, entries: [{ actorId: IDS.alpha, score: 10 }] }, () => 10);
    expect(() => startEncounter(active, { mapAssetId: IDS.map, entries: [{ actorId: IDS.beta, score: 9 }] }, () => 10)).toThrow("End the active encounter");
    expect(() => setInitiativeScore(active, IDS.alpha, 1001)).toThrow("-1000 to 1000");
  });
});

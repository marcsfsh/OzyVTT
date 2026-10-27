import { describe, expect, it } from "vitest";
import type { GmView, PlayerView } from "@vtt/domain";
import { nextTurnWords } from "../encounter/PlayerTurnCard";
import { turnTiles } from "./TurnTiles";

// The strip's turn order: the GM's real order, a player's projected one, and NEXT as the next entry that audience has.

const gm = (turnActorId: string) =>
  ({
    actors: [
      { id: "a", name: "Lyra", kind: "player-character", visibility: "public" },
      { id: "b", name: "Goblin", kind: "monster", visibility: "gm-only" },
      { id: "c", name: "Borin", kind: "player-character", visibility: "public" }
    ],
    combat: {
      turnActorId,
      initiative: [
        { actorId: "a", score: 19 },
        { actorId: "b", score: 12 },
        { actorId: "c", score: 9 }
      ]
    }
  }) as unknown as GmView;

const player = (turnActorId: string | null, hiddenTurn: boolean) =>
  ({
    actors: [],
    combat: {
      turnActorId,
      hiddenTurn,
      initiative: [
        { actorId: "a", name: "Lyra", score: 19 },
        { actorId: "c", name: "Borin", score: 9 }
      ]
    }
  }) as unknown as PlayerView;

const marks = (tiles: ReturnType<typeof turnTiles>) =>
  tiles.map(
    (tile) => `${tile.name}${tile.acting ? " acting" : ""}${tile.next ? " next" : ""}${tile.acted ? " done" : ""}`
  );

describe("the turn order in the strip", () => {
  it("gives the GM the real order, with hidden creatures marked, and wraps NEXT at the round's end", () => {
    expect(marks(turnTiles({ role: "gm", state: gm("b") }))).toEqual(["Lyra done", "Goblin acting", "Borin next"]);
    expect(marks(turnTiles({ role: "gm", state: gm("c") }))).toEqual(["Lyra next", "Goblin done", "Borin acting"]);
    expect(turnTiles({ role: "gm", state: gm("a") }).map((tile) => tile.hidden)).toEqual([false, true, false]);
  });

  it("gives a player the next entry they can see, and marks nothing during a hidden turn", () => {
    expect(marks(turnTiles({ role: "player", state: player("a", false) }))).toEqual(["Lyra acting", "Borin next"]);
    expect(marks(turnTiles({ role: "player", state: player(null, true) }))).toEqual(["Lyra", "Borin"]);
  });
});

describe("when a player's character acts next", () => {
  const combat = (activeId: string, hiddenTurn = false) =>
    ({
      round: 3,
      hiddenTurn,
      initiative: ["a", "b", "c", "d"].map((actorId) => ({ actorId, active: actorId === activeId }))
    }) as unknown as PlayerView["combat"];

  it("says next, later this round, or the next round, and nothing during a hidden turn", () => {
    expect(nextTurnWords(combat("b"), "c")).toBe("Your turn is next");
    expect(nextTurnWords(combat("a"), "d")).toBe("Your turn comes later this round");
    expect(nextTurnWords(combat("c"), "a")).toBe("Your next turn is in round 4");
    expect(nextTurnWords(combat("d"), "a")).toBe("Your turn is next");
    expect(nextTurnWords(combat("b", true), "c")).toBeNull();
  });
});

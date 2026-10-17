import { describe, expect, it } from "vitest";
import type { PlayerView } from "@vtt/domain";
import { creatureNumbers, tokenLabel, withNumberedNames } from "./numbering";

// Creatures of one kind carry their number on the token and in every list, read from names the viewer already has.

const view = (names: readonly string[]) =>
  ({
    actors: names.map((name, index) => ({ id: `a${index}`, name, kind: "monster" })),
    combat: { initiative: names.map((name, index) => ({ actorId: `a${index}`, name })) }
  }) as unknown as PlayerView;

describe("numbered monsters", () => {
  it("names the first of a kind as its badge reads, in the roster and the order", () => {
    const named = withNumberedNames(view(["Goblin Warrior", "Goblin Warrior 2", "Goblin Boss"]));
    expect(named.actors.map((actor) => actor.name)).toEqual(["Goblin Warrior 1", "Goblin Warrior 2", "Goblin Boss"]);
    expect(named.combat.initiative.map((entry) => ("name" in entry ? entry.name : ""))).toEqual([
      "Goblin Warrior 1",
      "Goblin Warrior 2",
      "Goblin Boss"
    ]);
  });

  it("numbers only from the creatures this view holds", () => {
    // The second goblin is hidden from this player, so the first stays as it is.
    const alone = view(["Goblin Warrior", "Goblin Boss"]);
    expect(withNumberedNames(alone)).toBe(alone);
    expect(creatureNumbers(alone.actors).size).toBe(0);
  });

  it("keeps token labels short", () => {
    expect(tokenLabel({ id: "a", name: "Goblin Warrior 1", kind: "monster" }, 1)).toBe("Goblin 1");
    expect(tokenLabel({ id: "b", name: "Lyra Emberwise", kind: "player-character" }, undefined)).toBe("Lyra");
  });
});

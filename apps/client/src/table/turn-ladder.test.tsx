import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { GmView, PlayerView } from "@vtt/domain";

vi.mock("../actors/ActorPortrait", () => ({ ActorPortrait: () => <span />, frameOf: () => "party" }));

import { turnLadder } from "./ladderRows";
import { TurnLadder } from "./TurnLadder";

// The Ladder (table spec 2.2, rule 5): hit points by role, conditions, the acting row, and before a fight.

const gm = (active = true) =>
  ({
    actors: [
      {
        id: "a",
        name: "Lyra",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 40, temporary: 0 },
        conditions: []
      },
      {
        id: "b",
        name: "Goblin Boss",
        kind: "monster",
        visibility: "public",
        hp: { current: 5, maximum: 21, temporary: 0 },
        conditions: [{ id: "prone" }]
      }
    ],
    definitions: [],
    combat: {
      active,
      round: 2,
      turnActorId: "b",
      tokens: [],
      initiative: [
        { actorId: "a", score: 19 },
        { actorId: "b", score: 12 }
      ]
    }
  }) as unknown as GmView;

const player = (hiddenTurn = false) =>
  ({
    actors: [
      {
        id: "a",
        name: "Lyra",
        kind: "player-character",
        claimStatus: "mine",
        hp: { kind: "exact", current: 20, maximum: 40, temporary: 0 }
      },
      { id: "b", name: "Goblin Boss", kind: "monster", hp: { kind: "band", band: "bloodied" } }
    ],
    combat: {
      active: true,
      round: 2,
      turnActorId: hiddenTurn ? null : "b",
      hiddenTurn,
      tokens: [],
      initiative: [
        { actorId: "a", name: "Lyra", score: 19, health: "healthy", conditionIds: [], conditions: [] },
        {
          actorId: "b",
          name: "Goblin Boss",
          score: 12,
          health: "bloodied",
          conditionIds: ["prone"],
          conditions: ["Prone"]
        }
      ]
    }
  }) as unknown as PlayerView;

describe("the Ladder's rows", () => {
  it("gives the GM every creature's hit points and conditions", () => {
    const [lyra, boss] = turnLadder({ role: "gm", state: gm() });
    expect(lyra?.hp?.current).toBe(20);
    expect(boss?.hp?.current).toBe(5);
    expect(boss?.conditions).toEqual([{ id: "prone", label: "Prone", harmful: true }]);
  });

  it("gives a player the party's hit points and a foe's band word, never its number", () => {
    const [lyra, boss] = turnLadder({ role: "player", state: player() });
    expect(lyra?.hp?.current).toBe(20);
    expect(boss?.hp).toBeNull();
    expect(boss?.band).toBe("bloodied");
    render(<TurnLadder role="player" state={player()} token={null} />);
    const row = screen.getByRole("button", { name: /^Goblin Boss/ });
    expect(within(row).getByText("Bloodied")).toBeTruthy();
    expect(row.textContent).not.toMatch(/5\/21|21/);
    expect(within(row).getByText("Prone")).toHaveClass("is-harmful");
  });

  it("marks the acting row and NEXT, and says the GM is taking a hidden turn", () => {
    render(<TurnLadder role="gm" state={gm()} token="gm" />);
    expect(screen.getByRole("button", { name: /^Goblin Boss, initiative 12, acting/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByRole("button", { name: /^Lyra, initiative 19, next/ })).toBeTruthy();
    render(<TurnLadder role="player" state={player(true)} token={null} />);
    expect(screen.getByText("The GM is taking a turn")).toBeTruthy();
  });

  it("reads -- for initiative before the fight", () => {
    render(<TurnLadder role="gm" state={gm(false)} token="gm" />);
    expect(screen.getByRole("button", { name: /^Lyra, initiative not rolled/ })).toHaveTextContent("--");
  });
});

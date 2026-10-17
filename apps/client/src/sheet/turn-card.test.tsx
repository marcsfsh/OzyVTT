import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ActionList } from "./ActionList";
import { TurnCard, defaultTiles, tilesOf } from "./TurnCard";
import type { TurnCost, TurnOption } from "./turn-options";

// The phone's turn card: favourite tiles two to a row, coloured and named by what they cost; every option a tap away;
// the pins the player chooses; and off the turn only a Reaction stays live.

const option = (
  id: string,
  name: string,
  cost: TurnCost,
  extra: Partial<TurnOption> & { strikes?: boolean } = {}
): TurnOption => {
  const { strikes = true, ...rest } = extra;
  return {
    id,
    name,
    cost,
    kind: "spell",
    costWords: cost === "bonus-action" ? "Bonus Action" : cost === "reaction" ? "Reaction" : "Action",
    line: "",
    effect: "+8 · 120 ft · 2d10 fire",
    concentration: false,
    spell: null,
    freeLeft: undefined,
    slot: null,
    reason: null,
    mastery: null,
    children: [],
    summary: {
      id,
      name,
      activation: cost === "bonus-action" ? "bonus-action" : cost === "reaction" ? "reaction" : "action",
      attackBonus: strikes ? 8 : null,
      saveAbility: null,
      damage: []
    } as unknown as ContentActionSummary,
    ...rest
  };
};

const FIRE_BOLT = option("spell-fire-bolt", "Fire Bolt", "action", { costWords: "Action · cantrip" });
const MISSILE = option("spell-magic-missile", "Magic Missile", "action", {
  costWords: "Action · level 1+",
  slot: { level: 1, remaining: 3, max: 4, pact: false }
});
const FIREBALL = option("spell-fireball", "Fireball", "action");
const FLY = option("spell-fly", "Fly", "action", { strikes: false });
const DAGGER = option("item-dagger", "Dagger", "action", { kind: "weapon", mastery: "Nick" });
const MISTY = option("spell-misty-step", "Misty Step", "bonus-action", { strikes: false });
const SHIELD = option("spell-shield", "Shield", "reaction", { strikes: false });
const LIGHT = option("item-dagger-light", "Dagger (Light extra attack)", "bonus-action", {
  kind: "weapon",
  reason: "Attack with another Light weapon first."
});
const ALL = [FIRE_BOLT, MISSILE, FIREBALL, FLY, DAGGER, MISTY, SHIELD, LIGHT];

describe("the turn card's tiles", () => {
  it("fill themselves with no history: actions that strike, a Bonus Action and a Reaction", () => {
    expect(defaultTiles(ALL, {}).map((tile) => tile.name)).toEqual([
      "Fire Bolt",
      "Magic Missile",
      "Fireball",
      "Dagger",
      "Misty Step",
      "Shield"
    ]);
  });

  it("put the options used most first, and the pins alone once there are any", () => {
    expect(defaultTiles(ALL, { "spell-fly": 9, "spell-shield": 3 })[0]!.name).toBe("Fly");
    expect(tilesOf(ALL, ["spell-shield", "gone-option", "spell-fly"], {}).map((tile) => tile.name)).toEqual([
      "Shield",
      "Fly"
    ]);
  });

  it("name what each costs, the weapon's mastery, and a levelled spell's slots", () => {
    render(
      <TurnCard options={ALL} myTurn round={2} acting={null} busy={false} pins={null} counts={{}} onUse={() => {}} />
    );
    const card = within(screen.getByRole("region", { name: "Your turn" }));
    expect(card.getByRole("heading", { name: "Your turn" })).toBeTruthy();
    expect(card.getByText("Round 2")).toBeTruthy();
    const missile = card.getByRole("button", { name: /Magic Missile/ });
    expect(missile.textContent).toContain("Action · level 1+");
    expect(missile.textContent).toContain("level 1");
    expect(card.getByRole("button", { name: /Dagger · Nick/ })).toBeTruthy();
    expect(missile.classList.contains("is-action")).toBe(true);
    expect(card.getByRole("button", { name: /Misty Step/ }).classList.contains("is-bonus-action")).toBe(true);
  });

  it("off the turn, names who acts and keeps only a Reaction live", () => {
    const used = vi.fn();
    render(
      <TurnCard
        options={ALL}
        myTurn={false}
        round={2}
        acting="Goblin 1"
        busy={false}
        pins={null}
        counts={{}}
        onUse={used}
      />
    );
    expect(screen.getByRole("heading", { name: "Goblin 1 is acting" })).toBeTruthy();
    const bolt = screen.getByRole("button", { name: /Fire Bolt/ }) as HTMLButtonElement;
    expect(bolt.disabled).toBe(true);
    expect(bolt.textContent).toContain("Waits for your turn");
    fireEvent.click(screen.getByRole("button", { name: /Shield/ }));
    expect(used).toHaveBeenCalledWith(SHIELD);
  });

  it("opens every option in place, with a way back", () => {
    render(
      <TurnCard options={ALL} myTurn round={1} acting={null} busy={false} pins={null} counts={{}} onUse={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: "All 8 options" }));
    expect(screen.getByRole("region", { name: "Bonus Action" })).toBeTruthy();
    // An option the server says waits gives its reason.
    expect(screen.getByText("Attack with another Light weapon first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the favourites" }));
    expect(screen.getByRole("button", { name: "All 8 options" })).toBeTruthy();
  });

  it("pins and unpins favourites, up to eight", () => {
    const setPins = vi.fn();
    render(
      <TurnCard
        options={ALL}
        myTurn
        round={1}
        acting={null}
        busy={false}
        pins={["spell-fire-bolt"]}
        counts={{}}
        onSetPins={setPins}
        onUse={() => {}}
      />
    );
    expect(
      screen.getAllByRole("button", { name: /Fire Bolt|Magic Missile/ }).map((tile) => tile.textContent)
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit favourites" }));
    const choose = within(screen.getByRole("group", { name: "Choose the favourites" }));
    expect(choose.getByRole("button", { name: /Fire Bolt/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(choose.getByRole("button", { name: /Shield/ }));
    expect(setPins).toHaveBeenLastCalledWith(["spell-fire-bolt", "spell-shield"]);
    fireEvent.click(choose.getByRole("button", { name: /Fire Bolt/ }));
    expect(setPins).toHaveBeenLastCalledWith([]);
  });
});

describe("the laptop's list", () => {
  it("groups options by cost, names a weapon's mastery, and keeps a Reaction for off the turn", () => {
    render(<ActionList options={ALL} myTurn busy={false} onUse={() => {}} />);
    expect(screen.getAllByRole("region").map((group) => group.getAttribute("aria-label"))).toEqual([
      "Action",
      "Bonus Action",
      "Reaction"
    ]);
    expect(screen.getByRole("button", { name: /Dagger · Nick/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Shield/ }).textContent).toContain("Off turn");
  });
});

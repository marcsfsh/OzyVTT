import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ActionList } from "../sheet/ActionList";
import type { CostTab, TurnCost, TurnOption } from "../sheet/turn-options";
import { TurnTabs, useCostTab, type TurnEconomy } from "./TurnTabs";

// The turn's cost tabs (table spec 2.3): Action at the start of a turn, the next unspent cost once the chosen one is
// spent, the Reaction while the creature waits, and each tab's options with the favourites first.

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

const ready = { used: false, now: true };
const economyOf = (spent: Partial<Record<"action" | "bonus" | "reaction", boolean>> = {}, now = true): TurnEconomy => ({
  action: { used: spent.action === true, now },
  bonus: { used: spent.bonus === true, now },
  reaction: { ...ready, used: spent.reaction === true },
  move: now ? { speedFeet: 30, usedFeet: 10 } : null
});

function Tabs({ turn, economy, waiting = false }: Readonly<{ turn: string; economy: TurnEconomy; waiting?: boolean }>) {
  const [tab, setTab] = useCostTab(turn, economy, waiting);
  return <TurnTabs label="Your turn resources" economy={economy} tab={tab} onTab={setTab} />;
}
const chosen = () =>
  screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-pressed") === "true")
    ?.getAttribute("aria-label");

describe("the cost tabs", () => {
  it("open on Action at the start of a turn", () => {
    render(<Tabs turn="1:lyra" economy={economyOf()} />);
    expect(chosen()).toBe("Action, ready");
    expect(screen.getByText("Action · ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move, 20 feet left" })).toBeTruthy();
  });

  it("move to the next unspent cost when the chosen one is spent, and stay where they are put", () => {
    const { rerender } = render(<Tabs turn="1:lyra" economy={economyOf()} />);
    rerender(<Tabs turn="1:lyra" economy={economyOf({ action: true })} />);
    expect(chosen()).toBe("Bonus Action, ready");
    fireEvent.click(screen.getByRole("button", { name: "Move, 20 feet left" }));
    expect(screen.getByText(/Move · 20 ft left of 30/)).toBeTruthy();
    rerender(<Tabs turn="1:lyra" economy={economyOf({ action: true, bonus: true })} />);
    expect(chosen()).toBe("Move, 20 feet left");
  });

  it("open on Action again when the next turn starts", () => {
    const { rerender } = render(<Tabs turn="1:lyra" economy={economyOf()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Reaction/ }));
    rerender(<Tabs turn="2:lyra" economy={economyOf()} />);
    expect(chosen()).toBe("Action, ready");
  });

  it("choose the Reaction while the creature waits, with Action and Bonus Action NOT NOW", () => {
    render(<Tabs turn="1:goblin" economy={economyOf({}, false)} waiting />);
    expect(chosen()).toBe("Reaction, ready");
    expect(screen.getByRole("button", { name: "Action, not now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bonus Action, not now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move, not now" })).toBeTruthy();
  });

  it("show a Legendary tab with how many are left", () => {
    render(
      <TurnTabs
        label="This turn"
        economy={{ ...economyOf(), legendary: { left: 2, max: 3 } }}
        tab="legendary"
        onTab={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: "Legendary, 2 of 3 left" })).toBeTruthy();
    expect(screen.getByText("Legendary · 2 of 3 left")).toBeTruthy();
  });
});

describe("a cost tab's list", () => {
  const FIRE_BOLT = option("spell-fire-bolt", "Fire Bolt", "action");
  const DAGGER = option("item-dagger", "Dagger", "action", { kind: "weapon" });
  const MISTY = option("spell-misty-step", "Misty Step", "bonus-action", { strikes: false });
  const SHIELD = option("spell-shield", "Shield", "reaction", { strikes: false });
  const BREW = option("item-brew", "Drink a brew", "other", { kind: "item" });
  const options = [FIRE_BOLT, DAGGER, MISTY, SHIELD, BREW];
  const list = (tab: Exclude<CostTab, "move" | "legendary">, pins: string[] = []) =>
    render(<ActionList options={options} myTurn busy={false} table tab={tab} pins={pins} onUse={() => undefined} />);
  const names = (container: HTMLElement) =>
    [...container.querySelectorAll(".cs-action-name")].map((name) => name.textContent);

  it("lists only what the tab costs, with what costs nothing after the Action's rows", () => {
    const { container } = list("action");
    expect(names(container)).toEqual(["Fire Bolt", "Dagger", "Drink a brew"]);
    expect(within(container).getByLabelText("No action")).toBeTruthy();
  });

  it("puts the favourites first with a star, and doesn't list them twice", () => {
    const { container } = list("action", ["item-dagger", "spell-shield"]);
    expect(names(container)).toEqual(["Favourite: Dagger", "Fire Bolt", "Drink a brew"]);
    expect(within(within(container).getByLabelText("Favourites")).getByTitle("Favourite")).toBeTruthy();
  });

  it("says when nothing costs the tab", () => {
    render(
      <ActionList
        options={[FIRE_BOLT]}
        myTurn
        busy={false}
        table
        tab="bonus-action"
        empty="Nothing here costs a Bonus Action."
        onUse={() => undefined}
      />
    );
    expect(screen.getByText("Nothing here costs a Bonus Action.")).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@vtt/ui";

vi.mock("../codex/useRecapBadge", () => ({ useRecapBadge: () => ({ unread: 0, markSeen: () => {} }) }));

import { GmTabBar } from "./GmShell";
import { PlayerTabBar } from "./PlayerShell";

// Every page has the theme in its app bar, for the GM and for players: one square that opens Dusk and Dawn. A
// choice made there is the device's theme everywhere, Settings included.

beforeEach(() => {
  localStorage.removeItem("vtt.theme");
  localStorage.setItem("vtt.theme", "dusk");
  document.documentElement.setAttribute("data-theme", "dusk");
});
afterEach(() => document.documentElement.removeAttribute("data-theme"));

const bars = [
  ["the GM's app bar", () => <GmTabBar />],
  ["a player's app bar", () => <PlayerTabBar token="player-token" />]
] as const;

describe.each(bars)("the theme switch in %s", (_, bar) => {
  it("names the current theme and offers the two, by the names people read", async () => {
    const user = userEvent.setup();
    render(bar());
    const trigger = screen.getByLabelText("Theme: Dusk");
    await user.click(trigger);
    const choices = screen.getAllByRole("menuitemradio", { hidden: true });
    expect(choices.map((choice) => choice.textContent)).toEqual(["Dusk", "Dawn"]);
    expect(within(choices[0]).getByText("Dusk").closest("button")).toHaveAttribute("aria-checked", "true");
    expect(choices[1]).toHaveAttribute("aria-checked", "false");
  });

  it("applies and keeps the choice", async () => {
    const user = userEvent.setup();
    render(bar());
    await user.click(screen.getByLabelText("Theme: Dusk"));
    await user.click(screen.getByRole("menuitemradio", { name: "Dawn", hidden: true }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dawn");
    expect(localStorage.getItem("vtt.theme")).toBe("dawn");
    expect(screen.getByLabelText("Theme: Dawn")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Theme: Dawn"));
    await user.click(screen.getByRole("menuitemradio", { name: "Dusk", hidden: true }));
    expect(localStorage.getItem("vtt.theme")).toBe("dusk");
  });

  it("agrees with the Settings switch, whichever changes the theme", async () => {
    const user = userEvent.setup();
    render(
      <>
        {bar()}
        <ThemeToggle />
      </>
    );
    await user.click(screen.getByRole("button", { name: "Dawn" }));
    expect(screen.getByLabelText("Theme: Dawn")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Theme: Dawn"));
    await user.click(screen.getByRole("menuitemradio", { name: "Dusk", hidden: true }));
    expect(screen.getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
  });
});

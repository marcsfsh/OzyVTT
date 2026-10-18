import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { THEMES, ThemeToggle } from "@vtt/ui";

vi.mock("../codex/useRecapBadge", () => ({ useRecapBadge: () => ({ unread: 0, markSeen: () => {} }) }));

import { GmTabBar } from "./GmShell";
import { PlayerTabBar } from "./PlayerShell";

// Every page has the theme in its app bar, for the GM and for players: one square that opens the four hours. A
// choice made there is the device's theme everywhere, Settings included.

beforeEach(() => {
  localStorage.removeItem("vtt.theme");
  document.documentElement.setAttribute("data-theme", "dark");
});
afterEach(() => document.documentElement.removeAttribute("data-theme"));

const bars = [
  ["the GM's app bar", () => <GmTabBar />],
  ["a player's app bar", () => <PlayerTabBar token="player-token" />]
] as const;

describe.each(bars)("the theme switch in %s", (_, bar) => {
  it("names the current theme and offers the four, by the names people read", async () => {
    const user = userEvent.setup();
    render(bar());
    const trigger = screen.getByLabelText("Theme: Night");
    await user.click(trigger);
    const choices = screen.getAllByRole("menuitemradio", { hidden: true });
    expect(choices.map((choice) => choice.textContent)).toEqual(["Night", "Dusk", "Dawn", "Day"]);
    expect(within(choices[0]).getByText("Night").closest("button")).toHaveAttribute("aria-checked", "true");
    expect(choices[2]).toHaveAttribute("aria-checked", "false");
  });

  it("applies and keeps the choice, with the new stored id for Dawn and the old ones for the rest", async () => {
    const user = userEvent.setup();
    render(bar());
    await user.click(screen.getByLabelText("Theme: Night"));
    await user.click(screen.getByRole("menuitemradio", { name: "Dawn", hidden: true }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dawn");
    expect(localStorage.getItem("vtt.theme")).toBe("dawn");
    expect(screen.getByLabelText("Theme: Dawn")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Theme: Dawn"));
    await user.click(screen.getByRole("menuitemradio", { name: "Day", hidden: true }));
    expect(localStorage.getItem("vtt.theme")).toBe("light");
  });

  it("agrees with the Settings switch, whichever changes the theme", async () => {
    const user = userEvent.setup();
    render(
      <>
        {bar()}
        <ThemeToggle />
      </>
    );
    await user.click(screen.getByRole("button", { name: "Dusk" }));
    expect(screen.getByLabelText("Theme: Dusk")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Theme: Dusk"));
    await user.click(screen.getByRole("menuitemradio", { name: "Night", hidden: true }));
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the no-flash script in each page", () => {
  it.each(["index.html", "sheet.html", "viewer.html"])("knows every theme in %s", (page) => {
    const html = readFileSync(join(process.cwd(), page), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).toContain('"vtt.theme"');
    for (const theme of THEMES) expect(script, theme).toContain(`"${theme}"`);
  });
});

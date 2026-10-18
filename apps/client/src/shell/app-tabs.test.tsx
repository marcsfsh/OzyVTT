import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppTabs, type AppTab } from "./AppTabs";

const TABS: AppTab[] = ["Table", "Scenes", "Roster", "Codex", "Compendium", "Sound", "Shared screen", "Settings"].map(
  (name) => ({ id: name.toLowerCase(), label: name, name })
);

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

/** Answers min-width queries from a viewport width; jsdom's shim answers false to everything. */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: !min || width >= Number(min[1]),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
const menuNames = () => screen.queryAllByRole("menuitem", { hidden: true }).map((item) => item.textContent);

describe("the GM tab bar at every width", () => {
  it("shows every tab on a laptop, with Rules beside them", () => {
    setViewport(1280);
    render(<AppTabs tabs={TABS} activeId="table" onChange={vi.fn()} ariaLabel="Sections" fits={[8, 5, 4, 3]} />);
    expect(tabNames()).toEqual(TABS.map((tab) => tab.name));
    expect(menuNames()).toEqual([]);
    expect(screen.getByRole("button", { name: "Rules" })).toBeInTheDocument();
  });

  it("keeps every tab one tap away on a phone: three in the bar, the rest and Rules under More", async () => {
    const user = userEvent.setup();
    setViewport(390);
    const onChange = vi.fn();
    render(<AppTabs tabs={TABS} activeId="table" onChange={onChange} ariaLabel="Sections" fits={[8, 5, 4, 3]} />);
    expect(tabNames()).toEqual(["Table", "Scenes", "Roster"]);
    expect(menuNames()).toEqual(["Codex", "Compendium", "Sound", "Shared screen", "Settings", "Rules"]);
    expect(screen.getByLabelText("More sections")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Settings", hidden: true }));
    expect(onChange).toHaveBeenCalledWith("settings");
  });

  it("names the More trigger after the current section when that section is in the menu", () => {
    setViewport(390);
    render(<AppTabs tabs={TABS} activeId="settings" onChange={vi.fn()} ariaLabel="Sections" fits={[8, 5, 4, 3]} />);
    const trigger = screen.getByLabelText("Settings, more sections");
    expect(trigger).toHaveTextContent("Settings");
    expect(screen.getByRole("menuitem", { name: "Settings", hidden: true })).toHaveAttribute("aria-current", "page");
  });
});

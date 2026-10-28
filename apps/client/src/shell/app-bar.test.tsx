import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render as renderBare, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiRequest = vi.fn();
vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  apiBlob: vi.fn(async () => new Blob())
}));

import type { ReactElement } from "react";
import { GameStateSchema, type GmView, type PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { GmBottomTabs, GmTopBar, PlayerBottomTabs, PlayerTopBar } from "./AppBar";
import { ReconnectBar } from "./ReconnectBar";

// The shells (DESIGN.md, Layout): the GM's four sections and utilities, a player's three sections and their
// character, the phone's bottom tabs, and the reconnecting bar. The addresses stay as they were.

function gmView(): GmView {
  const state = GameStateSchema.parse({ schemaVersion: 1 }) as unknown as GmView;
  return {
    ...state,
    actors: [
      { id: "lyra", name: "Lyra Emberwise", kind: "player-character", ownerSessionId: "s1", presence: "online" },
      { id: "borin", name: "Borin Stoneguard", kind: "player-character", ownerSessionId: "s2", presence: "offline" }
    ] as unknown as GmView["actors"]
  };
}
const playerView = (mine = true): PlayerView =>
  ({
    ...(GameStateSchema.parse({ schemaVersion: 1 }) as unknown as PlayerView),
    actors: [{ id: "lyra", name: "Lyra Emberwise", kind: "player-character", claimStatus: mine ? "mine" : "available" }]
  }) as unknown as PlayerView;

const render = (ui: ReactElement) => renderBare(<ToastProvider>{ui}</ToastProvider>);

/** Answers min- and max-width queries from a viewport width. */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: (!min || width >= Number(min[1])) && (!max || width <= Number(max[1])),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const original = window.matchMedia;
beforeEach(() => {
  apiRequest.mockResolvedValue({
    presentation: { revision: 1, enabled: true, activeMap: { assetId: "m1" } }
  });
});
afterEach(() => {
  window.matchMedia = original;
  goTo("/");
  localStorage.clear();
});

const sectionNames = (name: string) =>
  within(screen.getByRole("tablist", { name }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

describe("the GM's top bar", () => {
  it("shows Play, Prep, Codex and Compendium, lighting Prep on each of its pages", async () => {
    setViewport(1280);
    goTo("/encounters/maps");
    render(<GmTopBar state={gmView()} token="gm" />);
    expect(sectionNames("GM sections")).toEqual(["Play", "Prep", "Codex", "Compendium"]);
    expect(screen.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Table screen, on")).toBeInTheDocument();
    // Who is connected is the claimed characters whose players are online, as the projection says.
    expect(screen.getByRole("img", { name: "1 character online" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search, Ctrl K" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("lights no section on a utility page, and the bar stays reachable from the keyboard", () => {
    setViewport(1280);
    goTo("/viewer-controls");
    render(<GmTopBar state={gmView()} token="gm" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
  });

  it("goes back to where the GM was in a section, and to its front page from the section itself", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    localStorage.setItem("vtt.gm-last-location.section.prep", "/prep/tokens");
    goTo("/table");
    render(<GmTopBar state={gmView()} token="gm" />);
    await user.click(screen.getByRole("tab", { name: "Prep" }));
    expect(window.location.pathname).toBe("/prep/tokens");
    await user.click(screen.getByRole("tab", { name: "Prep" }));
    expect(window.location.pathname).toBe("/encounters");
  });

  it("puts the live encounter picker in the bar on Play, and opens the table screen's settings from its lamp", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/table");
    render(<GmTopBar state={gmView()} token="gm" />);
    expect(screen.getByLabelText("Encounters")).toHaveTextContent("No encounter live");
    await user.click(await screen.findByLabelText("Table screen, on"));
    await user.click(screen.getByRole("menuitem", { name: "Table screen settings" }));
    expect(window.location.pathname).toBe("/viewer-controls");
  });

  it("gives Play's strip the top of a phone, where Play is its own header", () => {
    setViewport(390);
    goTo("/table");
    const { container } = render(<GmTopBar state={gmView()} token="gm" />);
    expect(container.querySelector(".app-bar")).toBeNull();
  });

  it("moves the sections to the bottom tabs on a phone and keeps the utilities in the top bar", () => {
    setViewport(390);
    goTo("/codex");
    render(
      <>
        <GmTopBar state={gmView()} token="gm" />
        <GmBottomTabs />
      </>
    );
    expect(screen.getAllByRole("tablist", { name: "GM sections" })).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: "GM sections" })).toHaveClass("app-bottom-tabs");
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("the search launcher", () => {
  it("opens with Ctrl K where no section has its own search, and offers the GM the Compendium", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/table");
    render(<GmTopBar state={gmView()} token="gm" />);
    await user.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Search" });
    await user.click(within(dialog).getByRole("button", { name: /Search the Compendium/ }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/compendium?openSearch=1");
  });

  it("leaves Ctrl K to a section with its own search", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/codex");
    render(<GmTopBar state={gmView()} token="gm" />);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("gives a player no Compendium door", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/table");
    render(<PlayerTopBar state={playerView()} codexUnread={0} onCodexSeen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Search, Ctrl K" }));
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(within(dialog).queryByRole("button", { name: /Compendium/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Search the Codex/ })).toBeInTheDocument();
  });
});

describe("a player's bars", () => {
  it("shows Table, Sheet and Codex on a laptop, with the character they play", () => {
    setViewport(1280);
    goTo("/me");
    render(<PlayerTopBar state={playerView()} codexUnread={2} onCodexSeen={vi.fn()} />);
    expect(sectionNames("Player sections")).toEqual(["Table", "Sheet", "Codex, 2 new"]);
    expect(screen.getByRole("tab", { name: "Sheet" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Playing Lyra" })).toBeInTheDocument();
  });

  it("says when no character is claimed yet", () => {
    setViewport(1280);
    goTo("/table");
    render(<PlayerTopBar state={playerView(false)} codexUnread={0} onCodexSeen={vi.fn()} />);
    expect(screen.getByText("No character yet")).toBeInTheDocument();
  });

  it("adds Log to the phone's tabs, at the table's log address", async () => {
    const user = userEvent.setup();
    setViewport(390);
    goTo("/table");
    render(<PlayerBottomTabs codexUnread={0} onCodexSeen={vi.fn()} />);
    expect(sectionNames("Player sections")).toEqual(["Table", "Sheet", "Codex", "Log"]);
    await user.click(screen.getByRole("tab", { name: "Log" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/table?panel=log");
    expect(screen.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the reconnecting bar", () => {
  it("waits while the table is not current, then says it is back for 2 seconds", () => {
    vi.useFakeTimers();
    const { rerender } = render(<ReconnectBar current />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<ReconnectBar current={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Wait Reconnecting\. Wait before making changes\.$/);
    rerender(<ReconnectBar current />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Back at the table$/);
    act(() => vi.advanceTimersByTime(2100));
    expect(screen.queryByRole("status")).toBeNull();
    vi.useRealTimers();
  });
});

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
import { SearchDialog } from "./SearchDialog";
import { closeSearch } from "./search-store";

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
  closeSearch();
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
    render(<GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />);
    expect(sectionNames("GM sections")).toEqual(["Play", "Prep", "Codex", "Compendium"]);
    expect(screen.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Search, Ctrl K" })).toBeInTheDocument();
    // The one menu (frame spec 2.1): its face counts the players online, as the projection says; the table screen,
    // who is here, the theme and Settings live inside it.
    expect(screen.getByLabelText("GM menu, 1 player online")).toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "Table screen, on" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Who is here, 1 of / })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("lights no section on a utility page, and the bar stays reachable from the keyboard", () => {
    setViewport(1280);
    goTo("/viewer-controls");
    render(<GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
  });

  it("goes back to where the GM was in a section, and to its front page from the section itself", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    localStorage.setItem("vtt.gm-last-location.section.prep", "/prep/tokens");
    goTo("/table");
    render(<GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Prep" }));
    expect(window.location.pathname).toBe("/prep/tokens");
    await user.click(screen.getByRole("tab", { name: "Prep" }));
    expect(window.location.pathname).toBe("/encounters");
  });

  it("puts the live encounter picker in the bar on Play, and opens the table screen's settings from its lamp", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/table");
    render(<GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />);
    expect(screen.getByLabelText("Encounters")).toHaveTextContent("No encounter live");
    await user.click(await screen.findByLabelText("Table screen, on"));
    await user.click(screen.getByRole("menuitem", { name: "Table screen settings" }));
    expect(window.location.pathname).toBe("/viewer-controls");
  });

  it("gives Play's strip the top of a phone, where Play is its own header", () => {
    setViewport(390);
    goTo("/table");
    const { container } = render(<GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />);
    expect(container.querySelector(".app-bar")).toBeNull();
  });

  it("has no top bar on a phone: the sections are the bottom tabs, with More as the fifth", async () => {
    const user = userEvent.setup();
    setViewport(390);
    goTo("/codex");
    const { container } = render(
      <>
        <GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />
        <GmBottomTabs state={gmView()} token="gm" onSignOut={() => {}} />
      </>
    );
    expect(container.querySelector(".app-bar")).toBeNull();
    expect(screen.getAllByRole("tablist", { name: "GM sections" })).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: "GM sections" })).toHaveClass("app-bottom-tabs");
    // More opens its sheet above the tabs, with the menu's rows: Settings among them.
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const sheet = within(screen.getByRole("dialog", { name: "More" }));
    expect(sheet.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
  });
});

describe("the More sheet's rows that ask", () => {
  it("keeps the sheet while Sign out asks, so the question can open over it", async () => {
    const user = userEvent.setup();
    setViewport(390);
    goTo("/codex");
    const onSignOut = vi.fn();
    render(<GmBottomTabs state={gmView()} token="gm" onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(within(screen.getByRole("dialog", { name: "More" })).getByRole("menuitem", { name: "Sign out" }));
    const ask = screen.getByRole("dialog", { name: "Sign out on this device?" });
    await user.click(within(ask).getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });
});

describe("the one search", () => {
  const places = (dialog: HTMLElement) =>
    within(within(dialog).getByRole("group", { name: "Where to look" }))
      .getAllByRole("button")
      .map((place) => ({ name: place.textContent, on: place.getAttribute("aria-pressed") === "true" }));
  const startsAt = (dialog: HTMLElement) => places(dialog).find((place) => place.on)?.name;

  it("opens with Ctrl K on every page, the Codex included, at the section the GM is in", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    for (const [path, place] of [
      ["/table", "Compendium"],
      ["/encounters/maps", "Compendium"],
      ["/codex", "Codex"],
      ["/compendium", "Compendium"],
      ["/viewer-controls", "Go to"]
    ] as const) {
      goTo(path);
      const view = render(<SearchDialog role="gm" token="gm" sections={[]} />);
      await user.keyboard("{Control>}k{/Control}");
      const dialog = screen.getByRole("dialog", { name: "Search" });
      expect(startsAt(dialog), path).toBe(place);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
      view.unmount();
    }
  });

  it("opens from the bar's search button, and the GM's places include the Compendium", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/table");
    render(
      <>
        <GmTopBar state={gmView()} token="gm" onSignOut={() => {}} />
        <SearchDialog role="gm" token="gm" sections={[]} />
      </>
    );
    await user.click(screen.getByRole("button", { name: "Search, Ctrl K" }));
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(places(dialog).map((place) => place.name)).toEqual(["Codex", "Compendium", "Rules", "Go to"]);
  });

  it("gives a player no Compendium place, and starts on Rules at the table", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/table");
    render(
      <>
        <PlayerTopBar state={playerView()} codexUnread={0} onCodexSeen={vi.fn()} onLeave={() => {}} />
        <SearchDialog role="player" token="player" sections={[]} />
      </>
    );
    await user.click(screen.getByRole("button", { name: "Search, Ctrl K" }));
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(places(dialog).map((place) => place.name)).toEqual(["Codex", "Rules", "Go to"]);
    expect(startsAt(dialog)).toBe("Rules");
  });

  it("goes to a page from Go to, and closes behind itself", async () => {
    const user = userEvent.setup();
    setViewport(1280);
    goTo("/viewer-controls");
    render(<SearchDialog role="gm" token="gm" sections={[{ label: "Prep · Maps", path: "/encounters/maps" }]} />);
    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByLabelText("Go to a page or setting"), "maps");
    await user.keyboard("{Enter}");
    expect(window.location.pathname).toBe("/encounters/maps");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });
});

describe("a player's bars", () => {
  it("shows Table, Sheet and Codex on a laptop, with the character they play as the menu's face", () => {
    setViewport(1280);
    goTo("/me");
    render(<PlayerTopBar state={playerView()} codexUnread={2} onCodexSeen={vi.fn()} onLeave={() => {}} />);
    expect(sectionNames("Player sections")).toEqual(["Table", "Sheet", "Codex, 2 new"]);
    expect(screen.getByRole("tab", { name: "Sheet" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Menu, playing Lyra")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Leave the table" })).toBeInTheDocument();
  });

  it("says when no character is claimed yet", () => {
    setViewport(1280);
    goTo("/table");
    render(<PlayerTopBar state={playerView(false)} codexUnread={0} onCodexSeen={vi.fn()} onLeave={() => {}} />);
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

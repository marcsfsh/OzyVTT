import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();
const listFolders = vi.fn();
const listConnections = vi.fn();
const party = vi.fn();
const getSettings = vi.fn();
const chronicle = vi.fn();
const listMaps = vi.fn();
const getCalendar = vi.fn();
const listSessions = vi.fn();
const listQuests = vi.fn();
const listStanding = vi.fn();
const playerPages = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      listConnections: (...a: unknown[]) => listConnections(...a),
      party: (...a: unknown[]) => party(...a),
      getSettings: (...a: unknown[]) => getSettings(...a)
    },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a) },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    sessionApi: { ...actual.sessionApi, list: (...a: unknown[]) => listSessions(...a) },
    questApi: { ...actual.questApi, list: (...a: unknown[]) => listQuests(...a) },
    standingApi: { ...actual.standingApi, list: (...a: unknown[]) => listStanding(...a) },
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => playerPages(...a),
      listMaps: async () => [],
      chronicle: async () => [],
      listConnections: async () => [],
      calendar: async () => null,
      sessions: async () => [],
      quests: async () => [],
      standing: async () => [],
      party: async () => null
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";

/**
 * 761-849px: CSS fixes the sidebar at a 56px track, so the markup must collapse to match. jsdom has no
 * layout, so this checks that labels leave the accessibility tree and each icon gets `title`/`aria-label`.
 */

/** Drive `matchMedia` from a viewport width; jsdom's shim answers `false` to everything. */
function setViewport(width: number): void {
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const PAGE = {
  id: "p1",
  title: "Strahd",
  entityType: "character" as const,
  fields: {},
  folder: null,
  tags: [],
  revealedToPlayers: false,
  bannerAssetId: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  rev: 1,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};

beforeEach(() => {
  localStorage.clear();
  listPages.mockResolvedValue([PAGE]);
  listFolders.mockResolvedValue([]);
  listConnections.mockResolvedValue([]);
  party.mockResolvedValue(null);
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: true, intervalSeconds: 1 } });
  chronicle.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  getCalendar.mockResolvedValue({
    yearName: "DR",
    months: [{ name: "Hammer", days: 30 }],
    weekdays: [],
    currentInstant: 0,
    publishedInstant: 0
  });
  listSessions.mockResolvedValue({ sessions: [], activeSessionId: null });
  listQuests.mockResolvedValue([]);
  listStanding.mockResolvedValue([]);
  playerPages.mockResolvedValue([
    {
      id: "p1",
      title: "Strahd",
      entityType: "character",
      folder: null,
      tags: [],
      bannerAssetId: null,
      updatedAt: "2026-07-28T00:00:00.000Z"
    }
  ]);
});
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
  localStorage.clear();
});

/** The aside's nav; the drawer's always-expanded copy has the same name. */
const asideNav = () => screen.getAllByRole("navigation", { name: "Codex sections" })[0];

describe("The GM sidebar in the 761-849 band", () => {
  it("renders the rail even though the stored preference says open", async () => {
    setViewport(768);
    goTo("/codex");
    render(
      <ToastProvider>
        <CodexShell gmToken="gm" />
      </ToastProvider>
    );
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const nav = within(asideNav());
    // Rail: items are named by title/aria-label, with no visible label text.
    expect(nav.getByRole("button", { name: "Quests" })).toHaveAttribute("title", "Quests");
    expect(nav.queryByText("Quests")).not.toBeInTheDocument();
    // The group eyebrows go too.
    expect(nav.queryByText("World")).not.toBeInTheDocument();
    // No collapse toggle: there is nothing to expand into at this width.
    expect(nav.queryByRole("button", { name: /the sidebar/ })).not.toBeInTheDocument();
  });

  it("names the search entry, which is a bare glyph once the label is gone", async () => {
    setViewport(768);
    goTo("/codex");
    render(
      <ToastProvider>
        <CodexShell gmToken="gm" />
      </ToastProvider>
    );
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(within(asideNav()).getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("is expanded again at 900px, where the track is 220px", async () => {
    setViewport(900);
    goTo("/codex");
    render(
      <ToastProvider>
        <CodexShell gmToken="gm" />
      </ToastProvider>
    );
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const nav = within(asideNav());
    expect(nav.getByRole("button", { name: "Quests" })).not.toHaveAttribute("title");
    expect(nav.getByText("World")).toBeInTheDocument();
    expect(nav.getByRole("button", { name: "Collapse the sidebar" })).toBeInTheDocument();
  });

  it("leaves the GM's stored preference alone: leaving the band restores what they chose", async () => {
    setViewport(768);
    goTo("/codex");
    render(
      <ToastProvider>
        <CodexShell gmToken="gm" />
      </ToastProvider>
    );
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(localStorage.getItem("codex-sidebar")).toBe("open");
  });
});

describe("The player sidebar in the 761-849 band", () => {
  /** Players have no collapse control here either. */
  it("renders the rail, with every icon named", async () => {
    setViewport(768);
    goTo("/codex");
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerPages).toHaveBeenCalled());

    const nav = within(asideNav());
    expect(nav.getByRole("button", { name: "Journal" })).toHaveAttribute("title", "Journal");
    expect(nav.queryByText("Journal")).not.toBeInTheDocument();
    expect(nav.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("is expanded again at 900px", async () => {
    setViewport(900);
    goTo("/codex");
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerPages).toHaveBeenCalled());
    expect(within(asideNav()).getByText("Journal")).toBeInTheDocument();
  });
});

/** Every test drives the toggle in both directions; collapsing must never hide the way back. */
describe("Collapsing the sidebar is reversible (both directions)", () => {
  const renderGm = async () => {
    goTo("/codex");
    render(
      <ToastProvider>
        <CodexShell gmToken="gm" />
      </ToastProvider>
    );
    await waitFor(() => expect(listPages).toHaveBeenCalled());
  };

  it("collapses, still offers the way back, and expands again", async () => {
    setViewport(1280);
    const user = userEvent.setup();
    await renderGm();

    const nav = () => within(asideNav());
    await user.click(nav().getByRole("button", { name: "Collapse the sidebar" }));

    await waitFor(() => expect(nav().getByRole("button", { name: "Quests" })).toHaveAttribute("title", "Quests"));
    // The way back is on screen and operable.
    const expand = nav().getByRole("button", { name: "Expand the sidebar" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    await waitFor(() => expect(nav().getByText("World")).toBeInTheDocument());
    expect(nav().getByRole("button", { name: "Collapse the sidebar" })).toHaveAttribute("aria-expanded", "true");
    expect(nav().getByRole("button", { name: "Quests" })).not.toHaveAttribute("title");
  });

  it("offers the way back after a RELOAD into the stored preference", async () => {
    setViewport(1280);
    const user = userEvent.setup();
    // The preference persists across reloads.
    localStorage.setItem("codex-sidebar", "rail");
    await renderGm();

    const nav = () => within(asideNav());
    expect(nav().getByRole("button", { name: "Quests" })).toHaveAttribute("title", "Quests");
    await user.click(nav().getByRole("button", { name: "Expand the sidebar" }));

    await waitFor(() => expect(nav().getByText("World")).toBeInTheDocument());
    expect(localStorage.getItem("codex-sidebar")).toBe("open");
  });

  it("still hides the toggle in the forced 761-849 band, whatever the preference says", async () => {
    // In the forced band there is no toggle even with a "rail" preference: nothing to expand into.
    setViewport(800);
    localStorage.setItem("codex-sidebar", "rail");
    await renderGm();

    const nav = within(asideNav());
    expect(nav.queryByRole("button", { name: /the sidebar/ })).not.toBeInTheDocument();
    expect(nav.getByRole("button", { name: "Quests" })).toHaveAttribute("title", "Quests");
  });
});

describe("The player gets the same affordance, in the same words", () => {
  const renderPlayer = async (props: { embedded?: boolean } = {}) => {
    goTo("/codex");
    render(<PlayerCodex token="player" {...props} />);
    await waitFor(() => expect(playerPages).toHaveBeenCalled());
  };

  it("collapses and expands again, on its own stored preference", async () => {
    setViewport(1280);
    const user = userEvent.setup();
    await renderPlayer();

    const nav = () => within(asideNav());
    await user.click(nav().getByRole("button", { name: "Collapse the sidebar" }));
    await waitFor(() => expect(nav().getByRole("button", { name: "Journal" })).toHaveAttribute("title", "Journal"));
    // The player's own key, separate from the GM's.
    expect(localStorage.getItem("codex-player-sidebar")).toBe("rail");
    expect(localStorage.getItem("codex-sidebar")).toBeNull();

    await user.click(nav().getByRole("button", { name: "Expand the sidebar" }));
    await waitFor(() => expect(nav().getByText("Journal")).toBeInTheDocument());
  });

  it("offers no collapse inside the GM's embedded preview", async () => {
    setViewport(1280);
    await renderPlayer({ embedded: true });
    // The preview is a modal inside the viewport, so no collapse toggle.
    expect(within(asideNav()).queryByRole("button", { name: /the sidebar/ })).not.toBeInTheDocument();
  });

  it("still hides the toggle in the forced band", async () => {
    setViewport(800);
    await renderPlayer();
    expect(within(asideNav()).queryByRole("button", { name: /the sidebar/ })).not.toBeInTheDocument();
  });
});

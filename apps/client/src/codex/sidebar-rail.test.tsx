import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

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
      listPages: (...a: unknown[]) => listPages(...a), listFolders: (...a: unknown[]) => listFolders(...a),
      listConnections: (...a: unknown[]) => listConnections(...a), party: (...a: unknown[]) => party(...a),
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
      listMaps: async () => [], chronicle: async () => [], listConnections: async () => [],
      calendar: async () => null, sessions: async () => [], quests: async () => [],
      standing: async () => [], party: async () => null
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";

/**
 * **761–849px — the band nobody looked at.**
 *
 * `codex.css` pins the sidebar to a 56px grid track from 761px and only widens it at 850px, but the
 * components never knew: the GM's `collapsed` came from a localStorage preference that defaults to
 * "open" and the player passed none at all. At 768px — an iPad in portrait, a half-width laptop window —
 * thirteen labels, three group eyebrows and the ⌘K chip rendered into a 20px content box and spilled
 * over the main column, with the hamburger and the phone drawer both hidden so the broken strip was the
 * only navigation there was. Neither verification pass loaded a width in the band.
 *
 * jsdom loads no stylesheet and has no layout, so what is testable here is the half that CSS could never
 * have fixed anyway: **the markup agrees with the track.** Labels leave the accessibility tree, and each
 * icon gains the `title`/`aria-label` that is the only thing naming it once they have.
 */

/** Drive `matchMedia` from a real viewport width, since jsdom's own shim answers `false` to everything. */
function setViewport(width: number): void {
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches, media: query, onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const PAGE = {
  id: "p1", title: "Strahd", entityType: "character" as const, fields: {}, folder: null, tags: [],
  revealedToPlayers: false, bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
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
  getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [], currentInstant: 0, publishedInstant: 0 });
  listSessions.mockResolvedValue({ sessions: [], activeSessionId: null });
  listQuests.mockResolvedValue([]);
  listStanding.mockResolvedValue([]);
  playerPages.mockResolvedValue([{ id: "p1", title: "Strahd", entityType: "character", folder: null, tags: [], bannerAssetId: null, updatedAt: "2026-07-28T00:00:00.000Z" }]);
});
const realMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = realMatchMedia; localStorage.clear(); });

/** The aside's nav — the drawer's copy is always expanded and is a second node with the same name. */
const asideNav = () => screen.getAllByRole("navigation", { name: "Codex sections" })[0];

describe("The GM sidebar in the 761–849 band", () => {
  it("renders the rail even though the stored preference says open", async () => {
    setViewport(768);
    goTo("/codex");
    render(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const nav = within(asideNav());
    // Rail: the item is named by its title/aria-label, and no visible label text remains.
    expect(nav.getByRole("button", { name: "Quests" })).toHaveAttribute("title", "Quests");
    expect(nav.queryByText("Quests")).not.toBeInTheDocument();
    // The group eyebrows go with them — three unbreakable words that had no ellipsis rule at all.
    expect(nav.queryByText("World")).not.toBeInTheDocument();
    // And the collapse toggle: there is nothing to expand into at this width.
    expect(nav.queryByRole("button", { name: /the sidebar/ })).not.toBeInTheDocument();
  });

  it("names the search entry, which is a bare glyph once the label is gone", async () => {
    setViewport(768);
    goTo("/codex");
    render(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(within(asideNav()).getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("is expanded again at 900px, where the track is 220px", async () => {
    setViewport(900);
    goTo("/codex");
    render(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const nav = within(asideNav());
    expect(nav.getByRole("button", { name: "Quests" })).not.toHaveAttribute("title");
    expect(nav.getByText("World")).toBeInTheDocument();
    expect(nav.getByRole("button", { name: "Collapse the sidebar" })).toBeInTheDocument();
  });

  it("leaves the GM's stored preference alone — leaving the band restores what they chose", async () => {
    setViewport(768);
    goTo("/codex");
    render(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(localStorage.getItem("codex-sidebar")).toBe("open");
  });
});

describe("The player sidebar in the 761–849 band", () => {
  /**
   * Worse for the player than for the GM: they have no collapse control and no persisted preference, so
   * before this the crushed strip was permanent for as long as the window was that wide.
   */
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

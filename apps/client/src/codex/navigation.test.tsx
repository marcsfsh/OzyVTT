import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
// The dashboard's feeds are stubbed so entering Home doesn't reach `fetch`.
const timeline = vi.fn();
const listMaps = vi.fn();
const getCalendar = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listConnections: (...a: unknown[]) => listRelationships(...a),
      party: (...a: unknown[]) => listLinks(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a)
    },
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a), timeline: (...a: unknown[]) => timeline(...a) },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import type { CodexPage, CodexPageSummary } from "./api";

/** Cross-section navigation: which section is active, a type card sets the filter and lands on Pages, and filters clear. */
const summary = (id: string, title: string, entityType: CodexPageSummary["entityType"], tags: string[] = []): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags, revealedToPlayers: false,
  bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});
const PAGES = [summary("p1", "Strahd", "character", ["villain"]), summary("p2", "Barovia", "location")];

/** `CodexShell` uses `useToast`, so render it inside a ToastProvider as the app does. */
const renderWorkspace = () => (goTo("/codex/pages"), render)(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);

describe("Codex shell — cross-mode navigation", () => {
  beforeEach(() => {
    listPages.mockResolvedValue(PAGES);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    search.mockResolvedValue({ hits: [], truncated: false });
    timeline.mockResolvedValue([]);
    listMaps.mockResolvedValue([]);
    getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] });
    getPage.mockImplementation(async (_t: string, id: string) => ({
      page: { ...PAGES.find((p) => p.id === id)!, playerBody: "", gmBody: "", gmFields: {} } as CodexPage,
      connections: []
    }));
  });

  it("starts on Pages — the GM's first action is actionable", async () => {
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Pages" })).toHaveAttribute("aria-current", "page");
  });

  it("switches mode when a mode tab is chosen", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("Campaign → Pages prepares its destination: picking a type filters the notebook AND lands on Pages", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    await user.click(await screen.findByText(/character/i));
    expect(screen.getByRole("button", { name: "Pages" })).toHaveAttribute("aria-current", "page");
    // The filter names the type, and the non-matching page is filtered out.
    expect(await screen.findByText(/Characters/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Barovia")).not.toBeInTheDocument());
    expect(screen.getByText("Strahd")).toBeInTheDocument();
  });

  it("clearing the filter restores the full notebook", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    await user.click(await screen.findByText(/character/i));
    await user.click(await screen.findByRole("button", { name: /clear (kind|tag) filter/i }));
    expect(await screen.findByText("Barovia")).toBeInTheDocument();
  });
});

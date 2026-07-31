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
// CI-7 gave the Campaign mode three feeds of its own; they are stubbed here so entering the mode does
// not reach a real `fetch`, but this file is still about navigation, not about what the dashboard says.
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
      listRelationships: (...a: unknown[]) => listRelationships(...a),
      listLinks: (...a: unknown[]) => listLinks(...a),
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
import { CodexShell } from "./CodexShell";
import type { CodexPage, CodexPageSummary } from "./api";

/**
 * CF-5 coverage area 3 of 3: **cross-mode navigation**.
 *
 * The assessment's third root cause is that the suite is "a shell but not a system" — a star into Pages
 * with no return edges. M7 will add those edges, so these tests pin the shell's *current* contract:
 * which mode is active, that a Campaign type card sets the filter AND lands on Pages, and that a filter is
 * cleared rather than left stale. Without this, M7's navigation work has nothing to regress against.
 */
const summary = (id: string, title: string, entityType: CodexPageSummary["entityType"], tags: string[] = []): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags, revealedToPlayers: false,
  bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});
const PAGES = [summary("p1", "Strahd", "character", ["villain"]), summary("p2", "Barovia", "location")];

/** The app mounts inside a ToastProvider (`main.tsx:411`); `CodexShell` uses `useToast`, so a bare
    render would throw. Rendering it the way the app does is the point of an integration-shaped test. */
const renderWorkspace = () => render(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);

describe("Codex shell — cross-mode navigation", () => {
  beforeEach(() => {
    listPages.mockResolvedValue(PAGES);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    search.mockResolvedValue([]);
    timeline.mockResolvedValue([]);
    listMaps.mockResolvedValue([]);
    getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] });
    getPage.mockImplementation(async (_t: string, id: string) => ({
      page: { ...PAGES.find((p) => p.id === id)!, playerBody: "", gmBody: "", gmFields: {} } as CodexPage,
      backlinks: [], relationships: []
    }));
  });

  it("starts on Pages — the GM's first action is actionable", async () => {
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches mode when a mode tab is chosen", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    expect(screen.getByRole("tab", { name: "Campaign" })).toHaveAttribute("aria-selected", "true");
  });

  it("Campaign → Pages prepares its destination: picking a type filters the notebook AND lands on Pages", async () => {
    // This handoff is the one the design calls the best transition in the suite; M7 makes every other
    // jump match it, so its current behaviour is worth pinning.
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    await user.click(await screen.findByText(/character/i));
    expect(screen.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
    // The filter chip is visible and names the type, and the non-matching page is filtered out.
    expect(await screen.findByText(/Characters/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Barovia")).not.toBeInTheDocument());
    expect(screen.getByText("Strahd")).toBeInTheDocument();
  });

  it("clearing the filter restores the full notebook", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    await user.click(await screen.findByText(/character/i));
    await user.click(await screen.findByRole("button", { name: /clear filter/i }));
    expect(await screen.findByText("Barovia")).toBeInTheDocument();
  });
});

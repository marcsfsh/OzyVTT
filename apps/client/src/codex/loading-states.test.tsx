import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
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
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a)
    },
    // CI-7: the Campaign dashboard's own three feeds. They resolve EMPTY in every test below on
    // purpose — an empty journal and an empty atlas are what make `pages` the deciding feed for the
    // empty state under test, exactly as they were before the dashboard had any other data.
    journalApi: { ...actual.journalApi, timeline: (...a: unknown[]) => timeline(...a) },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { CodexWorkspace } from "./CodexWorkspace";

/**
 * CF-2: **an empty state must never front-run its own fetch.**
 *
 * The bug these pin: every mode renders its empty branch off `list.length === 0`, which is also the
 * state before the first response lands. So a GM with a full campaign was told "No entries yet" /
 * "No entities yet" for one round-trip. M4 fixed this for the Pages rail only; these cover the modes
 * that were missed, which is exactly where the milestone's own stated bar ("every mode shows a
 * loading and an error state") was not met.
 *
 * Each test holds the fetch open deliberately — resolving it would hide the very window under test.
 */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

const renderWorkspace = () => render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);

describe("Codex loading states (CF-2)", () => {
  beforeEach(() => {
    listRelationships.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    search.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
    timeline.mockResolvedValue([]);
    listMaps.mockResolvedValue([]);
    getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] });
  });

  it("Campaign does not claim the campaign is empty while pages are still loading", async () => {
    const pages = deferred<unknown[]>();
    listPages.mockReturnValue(pages.promise);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    // The fetch is still open: the invitation to create a first page must not be on screen.
    expect(screen.queryByText(/No entries yet/i)).not.toBeInTheDocument();

    // ...and once it settles with real data, the mode renders content rather than the empty branch.
    pages.resolve([{
      id: "p1", title: "Strahd", entityType: "character", fields: {}, folder: null, tags: [],
      revealedToPlayers: false, bannerAssetId: null, rev: 1,
      createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
    }]);
    await waitFor(() => expect(screen.queryByText(/No entries yet/i)).not.toBeInTheDocument());
    expect(await screen.findByText("Strahd")).toBeInTheDocument();
  });

  it("Graph does not claim there are no entities while pages are still loading", async () => {
    const pages = deferred<unknown[]>();
    listPages.mockReturnValue(pages.promise);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Graph" }));
    expect(screen.queryByText(/No entities yet/i)).not.toBeInTheDocument();
    pages.resolve([]);
    // A genuinely empty campaign SHOULD reach the empty state — the fix must not suppress it forever.
    expect(await screen.findByText(/No entities yet/i)).toBeInTheDocument();
  });

  it("still shows the empty state once the fetch settles empty (the fix must not swallow it)", async () => {
    listPages.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    expect(await screen.findByText(/No entries yet/i)).toBeInTheDocument();
  });
});

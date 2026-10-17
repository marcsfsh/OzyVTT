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
    // The dashboard's other feeds resolve empty, so `pages` decides the empty state under test.
    journalApi: {
      ...actual.journalApi,
      forPage: (...a: unknown[]) => forPage(...a),
      timeline: (...a: unknown[]) => timeline(...a)
    },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";

/** An empty state must not show before its fetch settles. Each test holds the fetch open on purpose. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const renderWorkspace = () =>
  (goTo("/codex/pages"), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );

describe("Codex loading states (CF-2)", () => {
  beforeEach(() => {
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    search.mockResolvedValue({ hits: [], truncated: false });
    getPage.mockResolvedValue({ page: null, connections: [] });
    timeline.mockResolvedValue([]);
    listMaps.mockResolvedValue([]);
    getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] });
  });

  it("Campaign does not claim the campaign is empty while pages are still loading", async () => {
    const pages = deferred<unknown[]>();
    listPages.mockReturnValue(pages.promise);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Home" }));
    // Fetch still open: no first-page invitation yet.
    expect(screen.queryByText(/No pages yet/i)).not.toBeInTheDocument();

    pages.resolve([
      {
        id: "p1",
        title: "Strahd",
        entityType: "character",
        fields: {},
        folder: null,
        tags: [],
        revealedToPlayers: false,
        bannerAssetId: null,
        rev: 1,
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z"
      }
    ]);
    await waitFor(() => expect(screen.queryByText(/No pages yet/i)).not.toBeInTheDocument());
    expect(await screen.findByText("Strahd")).toBeInTheDocument();
  });

  it("Graph does not claim there are no entities while pages are still loading", async () => {
    const pages = deferred<unknown[]>();
    listPages.mockReturnValue(pages.promise);
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.queryByText(/No pages yet/i)).not.toBeInTheDocument();
    pages.resolve([]);
    // A genuinely empty campaign still reaches the empty state.
    expect(await screen.findByText(/No pages yet/i)).toBeInTheDocument();
  });

  it("still shows the empty state once the fetch settles empty (the fix must not swallow it)", async () => {
    listPages.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("heading", { name: "Make your first page" })).toBeInTheDocument();
  });
});

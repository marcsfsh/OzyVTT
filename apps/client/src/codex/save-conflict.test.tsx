import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const updatePage = vi.fn();
const getPage = vi.fn();
// The editor's Connections area reads entries and pins on mount; stub them so no error Alert appears.
const markersForPage = vi.fn();
const forPage = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      updatePage: (...a: unknown[]) => updatePage(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a) }
  };
});

import { PageEditor } from "./PageEditor";
import type { CodexPage } from "@vtt/domain";
import { ApiError } from "../lib/api";

/**
 * `PageEditor`'s save path: debounced autosave, serialized saves, and revision resync on 409. The Codex is
 * single-writer with last-writer-wins, so these assert what the code does.
 */
const page: CodexPage = {
  id: "page-1",
  title: "Barovia",
  entityType: "location",
  fields: {},
  hiddenFields: [],
  characterUpdatedAt: {},
  folder: null,
  tags: [],
  revealedToPlayers: false,
  bannerAssetId: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  rev: 3,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  playerUpdatedAt: "2026-07-28T00:00:00.000Z",
  firstShownAt: null,
  playerBody: "Fog.",
  blocks: []
};

function renderEditor() {
  return render(
    <PageEditor
      gmToken="gm"
      page={page}
      pages={[page]}
      connections={[]}
      autosave={{ enabled: true, intervalSeconds: 1 }}
      onChange={() => {}}
      onDeleted={() => {}}
      onNavigate={() => {}}
      onOpenConnection={vi.fn()}
      onConnectionsChanged={() => {}}
    />
  );
}

describe("PageEditor save/conflict path", () => {
  beforeEach(() => {
    updatePage.mockReset();
    getPage.mockReset();
    updatePage.mockResolvedValue({ ...page, rev: 4 });
    getPage.mockResolvedValue({ page: { ...page, rev: 9 }, connections: [] });
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
  });

  it("autosaves an edit, showing the in-flight state then settling", async () => {
    // `SaveState` shows "Saved" for both idle and saved, so assert the "Saving..." transition instead.
    let release!: (value: unknown) => void;
    updatePage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/title/i), "!");
    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(await screen.findByText(/saving/i, {}, { timeout: 4000 })).toBeInTheDocument();
    release({ ...page, rev: 4 });
    await waitFor(() => expect(screen.queryByText(/saving/i)).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it("sends the page's current rev as expectedRev: the optimistic-concurrency check", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/title/i), "!");
    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 4000 });
    const [, , input] = updatePage.mock.calls[0] as [string, string, { expectedRev?: number }];
    expect(input.expectedRev).toBe(3);
  });

  it("on a 409 it surfaces the conflict and resyncs the revision from the server", async () => {
    updatePage.mockRejectedValueOnce(new ApiError("This page changed since you opened it.", 409, "conflict"));
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/title/i), "!");
    // The editor re-reads the page for the current revision. `findAllByText` because `SaveState` also
    // renders the label in an `nh-sr-only` live region.
    const shown = await screen.findAllByText(/changed elsewhere/i, {}, { timeout: 4000 });
    expect(shown.length).toBeGreaterThan(0);
    await waitFor(() => expect(getPage).toHaveBeenCalled(), { timeout: 4000 });
  });

  it("does not save when nothing changed", async () => {
    renderEditor();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(updatePage).not.toHaveBeenCalled();
  });
});

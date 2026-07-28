import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const updatePage = vi.fn();
const getPage = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, updatePage: (...a: unknown[]) => updatePage(...a), getPage: (...a: unknown[]) => getPage(...a) }
  };
});

import { PageEditor } from "./PageEditor";
import { CodexRequestError, type CodexPage } from "./api";

/**
 * CF-5 coverage area 2 of 3: **the save / conflict path**.
 *
 * `PageEditor` autosaves on a debounce, serialises concurrent saves, and resyncs its revision on a 409.
 * This is the most intricate logic in the Codex and M4 is about to refactor the file wholesale, so these
 * are characterization tests: they pin *today's* behaviour so a behaviour-preserving refactor can be
 * proven behaviour-preserving.
 *
 * Note D-4: the Codex is single-writer and last-writer-wins is deliberate policy. These tests therefore
 * assert what the code does, not an idealised concurrency model.
 */
const page: CodexPage = {
  id: "page-1", title: "Barovia", entityType: "location", fields: {}, gmFields: {},
  folder: null, tags: [], revealedToPlayers: false, bannerAssetId: null, rev: 3,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
  playerBody: "Fog.", gmBody: ""
};

function renderEditor() {
  return render(
    <PageEditor gmToken="gm" page={page} pages={[page]} backlinks={[]} relationships={[]}
      onChange={() => {}} onDeleted={() => {}} onNavigate={() => {}} onRelationshipsChanged={() => {}} />
  );
}

describe("PageEditor save/conflict path", () => {
  beforeEach(() => {
    updatePage.mockReset();
    getPage.mockReset();
    updatePage.mockResolvedValue({ ...page, rev: 4 });
    getPage.mockResolvedValue({ page: { ...page, rev: 9 }, backlinks: [], relationships: [] });
  });

  it("autosaves an edit, showing the in-flight state then settling", async () => {
    // NOTE: the shared `SaveState` renders "Saved" for BOTH idle and saved, so asserting that text
    // proves nothing on its own. Assert the *transition* instead: "Saving…" only ever appears while a
    // save is genuinely in flight, so seeing it and then seeing it go is real evidence.
    let release!: (value: unknown) => void;
    updatePage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/title/i), "!");
    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 4000 });
    expect(await screen.findByText(/saving/i, {}, { timeout: 4000 })).toBeInTheDocument();
    release({ ...page, rev: 4 });
    await waitFor(() => expect(screen.queryByText(/saving/i)).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it("sends the page's current rev as expectedRev — the optimistic-concurrency check", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/title/i), "!");
    await waitFor(() => expect(updatePage).toHaveBeenCalled(), { timeout: 4000 });
    const [, , input] = updatePage.mock.calls[0] as [string, string, { expectedRev?: number }];
    expect(input.expectedRev).toBe(3);
  });

  it("on a 409 it surfaces the conflict and resyncs the revision from the server", async () => {
    updatePage.mockRejectedValueOnce(new CodexRequestError("This page changed since you opened it.", 409, "conflict"));
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText(/title/i), "!");
    // The GM is told, and the editor re-reads the page to pick up the server's current revision.
    // `findAllByText` because `SaveState` deliberately renders a settled label twice — once visibly and
    // once in an `nh-sr-only` live region — so a single-match query throws on the accessible duplicate.
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

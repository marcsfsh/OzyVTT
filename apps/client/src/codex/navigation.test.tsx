import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
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
    }
  };
});

import { CodexWorkspace } from "./CodexWorkspace";
import type { CodexPage, CodexPageSummary } from "./api";

/**
 * CF-5 coverage area 3 of 3: **cross-mode navigation**.
 *
 * The assessment's third root cause is that the suite is "a shell but not a system" — a star into Pages
 * with no return edges. M7 will add those edges, so these tests pin the shell's *current* contract:
 * which mode is active, that a World type card sets the filter AND lands on Pages, and that a filter is
 * cleared rather than left stale. Without this, M7's navigation work has nothing to regress against.
 */
const summary = (id: string, title: string, entityType: CodexPageSummary["entityType"], tags: string[] = []): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags, revealedToPlayers: false,
  bannerAssetId: null, rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});
const PAGES = [summary("p1", "Strahd", "character", ["villain"]), summary("p2", "Barovia", "location")];

describe("Codex shell — cross-mode navigation", () => {
  beforeEach(() => {
    listPages.mockResolvedValue(PAGES);
    listRelationships.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    search.mockResolvedValue([]);
    getPage.mockImplementation(async (_t: string, id: string) => ({
      page: { ...PAGES.find((p) => p.id === id)!, playerBody: "", gmBody: "", gmFields: {} } as CodexPage,
      backlinks: [], relationships: []
    }));
  });

  it("starts on Pages — the GM's first action is actionable", async () => {
    render(<CodexWorkspace gmToken="gm" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches mode when a mode tab is chosen", async () => {
    const user = userEvent.setup();
    render(<CodexWorkspace gmToken="gm" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "World" }));
    expect(screen.getByRole("tab", { name: "World" })).toHaveAttribute("aria-selected", "true");
  });

  it("World → Pages prepares its destination: picking a type filters the notebook AND lands on Pages", async () => {
    // This handoff is the one the design calls the best transition in the suite; M7 makes every other
    // jump match it, so its current behaviour is worth pinning.
    const user = userEvent.setup();
    render(<CodexWorkspace gmToken="gm" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "World" }));
    await user.click(await screen.findByText(/character/i));
    expect(screen.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
    // The filter chip is visible and names the type, and the non-matching page is filtered out.
    expect(await screen.findByText(/Characters/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Barovia")).not.toBeInTheDocument());
    expect(screen.getByText("Strahd")).toBeInTheDocument();
  });

  it("clearing the filter restores the full notebook", async () => {
    const user = userEvent.setup();
    render(<CodexWorkspace gmToken="gm" />);
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "World" }));
    await user.click(await screen.findByText(/character/i));
    await user.click(await screen.findByRole("button", { name: /clear filter/i }));
    expect(await screen.findByText("Barovia")).toBeInTheDocument();
  });
});

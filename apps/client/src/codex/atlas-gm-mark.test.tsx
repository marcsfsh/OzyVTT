import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const listPages = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { AtlasView } from "./AtlasView";
import type { CodexMap } from "./api";

/**
 * **The atlas's "players can't see this map yet" mark is a system glyph, not an emoji.**
 *
 * It used to be a literal 🔒 on every unrevealed drill chip. design-language §0 forbids that and names the
 * failure mode: an emoji renders at a platform-chosen size, in a hue this palette does not own, and cannot
 * take `currentColor`, so it can never match the rest of the app's GM-only vocabulary. It replaces with
 * `IconEyeOff` — the design system's own "GM only" glyph, the one `/styleguide` documents under that name.
 *
 * Two things are worth pinning, because losing either would put the emoji back in substance if not in form:
 * the mark is an SVG that inherits its colour, and it still SAYS "GM only" to a screen reader (the emoji's
 * own announced name was "locked", which is not the same claim).
 */
const MAP = (id: string, name: string, revealedToPlayers: boolean, parentMapId: string | null = null): CodexMap => ({
  id, assetId: `a-${id}`, name, kind: "regional", parentMapId, revealedToPlayers, sortKey: 0, tags: [],
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});

/** Two roots (so the top-level switcher renders) and a child under the first (so "Drill into" renders).
    Both unrevealed chips carry the mark; the revealed root must not. */
const MAPS = [MAP("m1", "Barovia", false), MAP("m2", "Faerûn", true), MAP("m3", "Castle Ravenloft", false, "m1")];

const renderAtlas = () =>
  render(<ToastProvider><AtlasView gmToken="gm" scenes={[]} actors={[]} activeSceneId={null} onActivateScene={vi.fn()} mapId={null} pinId={null} autosave={{ enabled: true, intervalSeconds: 1 }} onQuickCreate={vi.fn()} onNavigate={vi.fn()} onReplaceQuery={vi.fn()} /></ToastProvider>);

describe("Atlas GM-only mark — an SVG glyph, never an emoji (design-language §0)", () => {
  beforeEach(() => {
    listMaps.mockResolvedValue(MAPS);
    listAssets.mockResolvedValue([]);
    listMarkers.mockResolvedValue([]);
    listPages.mockResolvedValue([]);
  });

  it("marks every unrevealed map, and only those", async () => {
    renderAtlas();
    await waitFor(() => expect(listMaps).toHaveBeenCalled());

    // Barovia (root, hidden) and Castle Ravenloft (child, hidden) — Faerûn is shown to players.
    const marks = await screen.findAllByRole("img", { name: "GM only" });
    expect(marks).toHaveLength(2);
    for (const chip of screen.getAllByRole("button")) {
      const hidden = within(chip).queryByRole("img", { name: "GM only" }) !== null;
      if (chip.textContent?.includes("Faerûn")) expect(hidden).toBe(false);
    }
  });

  it("renders the mark as an SVG taking currentColor, with no emoji anywhere in the atlas", async () => {
    const { container } = renderAtlas();
    await waitFor(() => expect(listMaps).toHaveBeenCalled());

    const mark = (await screen.findAllByRole("img", { name: "GM only" }))[0];
    const svg = mark.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("fill", "currentColor");
    // The glyph itself is decorative: the wrapper owns the accessible name, so it is not announced twice.
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent ?? "").not.toContain("\u{1F512}");
  });
});

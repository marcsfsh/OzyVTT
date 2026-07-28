import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, atlasApi: { ...actual.atlasApi, updateMarker: vi.fn(), deleteMarker: vi.fn() } };
});

import { MarkerInspector } from "./MarkerInspector";
import type { CodexMap, CodexMarker } from "./api";

/**
 * CD-6: **a shown pin on a secret map is invisible to players, and nothing said so.**
 *
 * Revealing a marker feels like it published it. It does not: the player never receives the map, so the
 * pin rides along in the dark. The GM had no way to notice — there was no warning, and the pin's own
 * reveal switch reads "on". These pin the warning and, just as importantly, pin that it stays quiet in
 * the three states where there is nothing wrong (a secret pin, a revealed map, both revealed).
 */
const MAP = (revealed: boolean): CodexMap => ({
  id: "m1", assetId: "a1", name: "Barovia", kind: "regional", parentMapId: null,
  revealedToPlayers: revealed, sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});
const MARKER = (revealed: boolean): CodexMarker => ({
  id: "k1", mapId: "m1", x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Castle Ravenloft",
  revealedToPlayers: revealed, pageIds: [], subMapId: null, sceneIds: [], actorId: null, tags: [],
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});

const renderInspector = (markerRevealed: boolean, mapRevealed: boolean, onRevealMap?: () => void) =>
  render(
    <MarkerInspector
      gmToken="gm" marker={MARKER(markerRevealed)} maps={[MAP(mapRevealed)]} pages={[]} scenes={[]} actors={[]}
      activeSceneId={null} onUpdated={vi.fn()} onDeleted={vi.fn()} onOpenMap={vi.fn()} onOpenPage={vi.fn()}
      onCreatePage={vi.fn()} onRevealPage={vi.fn()} onRevealMap={onRevealMap} onActivateScene={vi.fn()}
      onOpenReplay={vi.fn()} onClose={vi.fn()}
    />
  );

describe("MarkerInspector — shown pin on a secret map (CD-6)", () => {
  it("warns when the pin is shown but its map is still secret", () => {
    renderInspector(true, false);
    expect(screen.getByText(/still secret/i)).toBeInTheDocument();
    expect(screen.getByText("Barovia")).toBeInTheDocument();   // names the map that needs revealing
  });

  it("offers to reveal the map when the caller can do it", async () => {
    const onRevealMap = vi.fn();
    renderInspector(true, false, onRevealMap);
    const action = screen.getByRole("button", { name: /show the map too/i });
    action.click();
    expect(onRevealMap).toHaveBeenCalledTimes(1);
  });

  it("still warns without an action when the caller cannot reveal the map", () => {
    renderInspector(true, false);
    expect(screen.getByText(/still secret/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show the map too/i })).not.toBeInTheDocument();
  });

  // The quiet cases. A warning that fires when nothing is wrong is noise the GM learns to ignore.
  it("stays quiet when the map is revealed", () => {
    renderInspector(true, true);
    expect(screen.queryByText(/still secret/i)).not.toBeInTheDocument();
  });

  it("stays quiet when the pin itself is secret — nothing is being promised to players", () => {
    renderInspector(false, false);
    expect(screen.queryByText(/still secret/i)).not.toBeInTheDocument();
  });
});

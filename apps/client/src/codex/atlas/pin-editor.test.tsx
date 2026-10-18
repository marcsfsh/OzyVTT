import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const updateMarker = vi.fn();
const revealMarker = vi.fn();
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    atlasApi: {
      ...actual.atlasApi,
      updateMarker: (...a: unknown[]) => updateMarker(...a),
      revealMarker: (...a: unknown[]) => revealMarker(...a),
      deleteMarker: vi.fn()
    }
  };
});

import type { CodexMap, CodexMarker } from "@vtt/domain";
import { PinEditor } from "./PinEditor";

const MAP = (revealed: boolean): CodexMap => ({
  id: "m1",
  assetId: "a1",
  name: "Barovia",
  kind: "regional",
  parentMapId: null,
  revealedToPlayers: revealed,
  sortKey: 0,
  tags: ["faerun"],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
});
const MARKER = (over: Partial<CodexMarker> = {}): CodexMarker => ({
  id: "k1",
  mapId: "m1",
  x: 0.5,
  y: 0.5,
  iconId: "pin",
  iconColor: "#FF2E9A",
  label: "Old Svalich Road",
  revealedToPlayers: true,
  pageIds: [],
  subMapId: null,
  sceneIds: [],
  actorId: null,
  isParty: false,
  tags: ["dungeon"],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

const renderEditor = (
  marker: CodexMarker,
  options: Readonly<{ mapRevealed?: boolean; autosave?: boolean; onRevealMap?: () => void }> = {}
) =>
  render(
    <PinEditor
      gmToken="gm"
      marker={marker}
      maps={[MAP(options.mapRevealed ?? true)]}
      pages={[]}
      scenes={[]}
      actors={[]}
      activeSceneId={null}
      autosave={{ enabled: options.autosave ?? true, intervalSeconds: 1 }}
      onUpdated={vi.fn()}
      onDeleted={vi.fn()}
      onOpenMap={vi.fn()}
      onOpenPage={vi.fn()}
      onCreatePage={vi.fn()}
      onRevealPage={vi.fn()}
      onRevealMap={options.onRevealMap}
      onActivateScene={vi.fn()}
      onDone={vi.fn()}
    />
  );

const WARNING = "This pin is shown to players, but the map is hidden from them. Players cannot see either.";

describe("A shown pin on a hidden map", () => {
  it("warns, names the map, and offers to show it when the caller can", async () => {
    const onRevealMap = vi.fn();
    renderEditor(MARKER(), { mapRevealed: false, onRevealMap });
    expect(screen.getByText(/is hidden from them\. Players cannot see either\./)).toBeInTheDocument();
    expect(screen.getByText("Barovia")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /show the map too/i }));
    expect(onRevealMap).toHaveBeenCalledTimes(1);
  });

  it("still warns, with no action, when the caller can't show the map", () => {
    renderEditor(MARKER(), { mapRevealed: false });
    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show the map too/i })).not.toBeInTheDocument();
  });

  it("stays quiet when the map is revealed, or when the pin itself is hidden", () => {
    const shown = renderEditor(MARKER(), { mapRevealed: true });
    expect(screen.queryByText(/is hidden from them/)).not.toBeInTheDocument();
    shown.unmount();
    renderEditor(MARKER({ revealedToPlayers: false }), { mapRevealed: false });
    expect(screen.queryByText(/is hidden from them/)).not.toBeInTheDocument();
  });
});

describe("A pin's tags and label", () => {
  it("shows the stored tags", () => {
    renderEditor(MARKER({ tags: ["dungeon", "shop"] }));
    const chosen = screen.getByRole("list", { name: /chosen/i });
    expect(chosen).toHaveTextContent("dungeon");
    expect(chosen).toHaveTextContent("shop");
  });

  it("saves a new tag, slugified to the server's rule, with the label in one write", async () => {
    updateMarker.mockResolvedValue(MARKER());
    renderEditor(MARKER({ tags: ["dungeon"] }));
    await userEvent.setup().type(screen.getByLabelText("Tags"), "Old Mill{Enter}");
    await waitFor(() => expect(updateMarker).toHaveBeenCalled(), { timeout: 4_000 });
    expect(updateMarker).toHaveBeenCalledWith("gm", "k1", { label: "Old Svalich Road", tags: ["dungeon", "old-mill"] });
  });

  it("with autosave off, holds a typed label as a draft and writes it only on Save pin", async () => {
    updateMarker.mockResolvedValue(MARKER());
    renderEditor(MARKER({ tags: [] }), { autosave: false });
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "Save pin" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Tser Pool");
    expect(updateMarker).not.toHaveBeenCalled();
    expect(await screen.findByText(/Unsaved changes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save pin" }));
    await waitFor(() => expect(updateMarker).toHaveBeenCalledWith("gm", "k1", { label: "Tser Pool", tags: [] }));
  });

  it("with autosave off, keeps Who sees it immediate, with its word under the switch", async () => {
    revealMarker.mockResolvedValue(MARKER({ revealedToPlayers: false }));
    renderEditor(MARKER({ tags: [] }), { autosave: false });
    expect(screen.getByText("Everyone")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("switch", { name: "Show this pin to players" }));
    await waitFor(() => expect(revealMarker).toHaveBeenCalledWith("gm", "k1", false));
  });
});

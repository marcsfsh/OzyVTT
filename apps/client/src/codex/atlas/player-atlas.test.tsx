import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../../scene/mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 1000, height: 800 }),
  imagePointFromClient: (_svg: unknown, x: number, y: number) => ({ x, y }),
  clampPoint: (point: { x: number; y: number }) => point
}));
const listMarkers = vi.fn();
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    playerCodexApi: { ...actual.playerCodexApi, listMarkers: (...a: unknown[]) => listMarkers(...a) }
  };
});

import { fireEvent } from "@testing-library/react";
import type { PlayerCodexMap, PlayerCodexMarker, PlayerCodexPageSummary } from "@vtt/domain";
import { PlayerAtlas } from "./PlayerAtlas";

const MAPS: PlayerCodexMap[] = [
  { id: "m1", assetId: "a1", name: "Saltmere", kind: "regional", parentMapId: null, tags: [] },
  { id: "m2", assetId: "a2", name: "Docks", kind: "battlemap", parentMapId: "m1", tags: [] }
];
const PIN = (over: Partial<PlayerCodexMarker> = {}): PlayerCodexMarker => ({
  id: "k1",
  mapId: "m1",
  x: 100,
  y: 200,
  iconId: "tower",
  iconColor: "#2DE2FF",
  label: "Harbourmaster's Tower",
  pageIds: ["p1"],
  subMapId: null,
  tags: [],
  isParty: false,
  ...over
});
const PAGES: PlayerCodexPageSummary[] = [
  {
    id: "p1",
    title: "Ysolde Varn",
    entityType: "character",
    tags: [],
    bannerAssetId: null,
    playerUpdatedAt: "2026-10-01T00:00:00.000Z"
  } as PlayerCodexPageSummary
];

function renderAtlas(query = "") {
  const onQueryChange = vi.fn();
  render(
    <PlayerAtlas
      token="pl"
      maps={MAPS}
      pages={PAGES}
      mapId={null}
      query={new URLSearchParams(query)}
      onFilterChange={vi.fn()}
      onQueryChange={onQueryChange}
      onOpen={vi.fn()}
    />
  );
  return onQueryChange;
}

beforeEach(() => {
  localStorage.clear();
  listMarkers.mockResolvedValue([PIN(), PIN({ id: "k2", label: "The party", pageIds: [], isParty: true })]);
});

describe("The players' atlas", () => {
  it("opens on the first top-level map with its pins, and no GM control", async () => {
    renderAtlas();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText("Ysolde Varn")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Set party position" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hidden pins" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
    // A right-click opens nothing on a player's map.
    fireEvent.contextMenu(document.querySelector(".atlas-map-svg")!, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("reads a selected pin with its pages and nothing to edit", async () => {
    renderAtlas("pin=k1");
    const view = await screen.findByRole("region", { name: "Pin: Harbourmaster's Tower" });
    expect(within(view).getByText("Ysolde Varn")).toBeInTheDocument();
    expect(within(view).queryByRole("button", { name: "Edit pin" })).not.toBeInTheDocument();
    expect(within(view).queryByRole("button", { name: "Set party position here" })).not.toBeInTheDocument();
  });

  it("selects a pin through the address", async () => {
    const onQueryChange = renderAtlas();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Harbourmaster's Tower/ }));
    expect(onQueryChange).toHaveBeenCalled();
    const params = new URLSearchParams();
    onQueryChange.mock.calls[0][0](params);
    expect(params.get("pin")).toBe("k1");
  });

  it("lists the shared maps inside", async () => {
    renderAtlas();
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Maps inside" }));
    expect(within(screen.getByRole("list", { name: "Maps inside this one" })).getByText("Docks")).toBeInTheDocument();
  });
});

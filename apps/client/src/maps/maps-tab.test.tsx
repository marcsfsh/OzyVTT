import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@vtt/ui";

vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// Every map draws at once, 700 by 500, on 50 px squares; thumbnails stay as their placeholder.
vi.mock("../scene/mapImage", async (original) => ({
  ...(await original<typeof import("../scene/mapImage")>()),
  useAuthorizedMapImage: (id: string | null) =>
    id ? { status: "ready", url: "blob:map", width: 700, height: 500 } : { status: "idle" },
  useCachedMapThumbnail: () => null
}));
vi.mock("../scene/gridPreview", async (original) => ({
  ...(await original<typeof import("../scene/gridPreview")>()),
  useMapCalibration: () => ({
    status: "ready",
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
  })
}));

import { goTo } from "../../test/route";
import { IDS, gmView, mapAsset, serveScenes } from "../../test/scenes-fakes";
import { setViewport } from "../../test/viewport";
import { ScenesShell } from "../scenes/ScenesShell";

const onLibraryChanged = vi.fn();

function renderTab(path: string) {
  goTo(path);
  return render(
    <ToastProvider>
      <ScenesShell state={gmView()} token="gm" onLibraryChanged={onLibraryChanged} onOpenMap={vi.fn()} />
    </ToastProvider>
  );
}
const here = () => `${window.location.pathname}${window.location.search}`;
const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr")!;

afterEach(() => {
  vi.unstubAllGlobals();
  onLibraryChanged.mockClear();
});

describe("the maps table", () => {
  it("lists every map with its type, grid, size, folder and the scenes on it, newest first", async () => {
    serveScenes();
    renderTab("/scenes/maps");
    await screen.findByRole("table");
    const names = within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("button")[0]!.textContent);
    expect(names).toEqual(["Sunken crypt", "Old tunnels", "Saltmere"]);
    expect(rowOf("Sunken crypt")).toHaveTextContent("Battle map50 px squares · 5 ft700 × 500Dungeons2 scenes");
    expect(rowOf("Saltmere")).toHaveTextContent("Regional mapNo grid yet800 × 600NoneNo scene");
  });

  it("shows only the types ticked in the Type dropdown, and keeps them in the address", async () => {
    const user = userEvent.setup();
    serveScenes();
    renderTab("/scenes/maps");
    await user.click(await screen.findByRole("button", { name: "Type: all 3" }));
    await user.click(screen.getByRole("checkbox", { name: "Regional map" }));
    expect(screen.getByText("2 of 3 maps")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saltmere" })).toBeNull();
    expect(new URLSearchParams(window.location.search).get("type")).toBe("battlemap,world");
  });

  it("filters by grid and folder from the flyout", async () => {
    const user = userEvent.setup();
    serveScenes();
    renderTab("/scenes/maps");
    await user.click(await screen.findByRole("button", { name: "Filters" }));
    const flyout = screen.getByRole("complementary", { name: "Filter maps" });
    await user.click(within(flyout).getByRole("button", { name: "No grid yet" }));
    expect(screen.getByText("2 of 3 maps")).toBeInTheDocument();
    await user.click(within(flyout).getByRole("button", { name: "Dungeons" }));
    expect(screen.getByText("1 of 3 maps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Old tunnels" })).toBeInTheDocument();
    await user.click(within(flyout).getByRole("button", { name: "Clear the filters" }));
    expect(screen.getByText("3 maps")).toBeInTheDocument();
  });

  it("opens a map from its row", async () => {
    const user = userEvent.setup();
    serveScenes();
    renderTab("/scenes/maps");
    await user.click(await screen.findByRole("button", { name: "Old tunnels" }));
    expect(here()).toBe(`/scenes/maps/${IDS.tunnels}`);
  });
});

describe("a map's page", () => {
  it("is one document: its grid, its type and folder, and where it is used", async () => {
    serveScenes();
    renderTab(`/scenes/maps/${IDS.crypt}`);
    expect(await screen.findByRole("heading", { name: "Sunken crypt" })).toBeInTheDocument();
    const grid = screen.getByRole("region", { name: "Grid" });
    expect(grid).toHaveTextContent("50 px squares · 5 ft");
    const used = screen.getByRole("region", { name: "Where it is used" });
    expect(within(used).getByRole("button", { name: "Crypt ambush" })).toBeInTheDocument();
    expect(within(used).getByRole("button", { name: "Camp at the ford" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show the grid" })).toBeChecked();
  });

  it("names the atlas map drawn from the image", async () => {
    serveScenes();
    renderTab(`/scenes/maps/${IDS.town}`);
    expect(await screen.findByText(/The Saltmere coast/)).toBeInTheDocument();
  });

  it("changes the map's type in one write, then reads the library again", async () => {
    const user = userEvent.setup();
    const server = serveScenes();
    renderTab(`/scenes/maps/${IDS.tunnels}`);
    await user.selectOptions(await screen.findByLabelText("Type"), "world");
    await waitFor(() =>
      expect(server.calls).toContainEqual(
        expect.objectContaining({ method: "PATCH", path: `/api/v1/map-assets/${IDS.tunnels}`, body: { kind: "world" } })
      )
    );
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled());
  });

  it("starts a new scene on a battle map with its one primary", async () => {
    const user = userEvent.setup();
    serveScenes();
    renderTab(`/scenes/maps/${IDS.crypt}`);
    await user.click(await screen.findByRole("button", { name: "New scene on this map" }));
    expect(here()).toBe(`/scenes/new?map=${IDS.crypt}`);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sunken crypt/ })).toHaveAttribute("aria-pressed", "true")
    );
  });
});

describe("adding a map as steps", () => {
  it("uploads the image with its name, type and folder, then opens its Grid step", async () => {
    const user = userEvent.setup();
    const keep = mapAsset("20000000-0000-5000-8000-0000000000e1", "Ruined keep", { folder: "Dungeons" });
    const server = serveScenes({ uploaded: keep });
    const { container } = renderTab("/scenes/maps/new");
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      expect.stringContaining("Upload"),
      expect.stringContaining("Grid"),
      expect.stringContaining("Check the alignment"),
      expect.stringContaining("Name and use")
    ]);
    expect(screen.getByRole("button", { name: "Upload map" })).toBeDisabled();

    await user.upload(
      container.querySelector<HTMLInputElement>("input.map-upload-input")!,
      new File(["png"], "keep.png", { type: "image/png" })
    );
    expect(screen.getByRole("img", { name: "The chosen image, keep.png" })).toBeInTheDocument();
    // Choosing the image names the map after its file, until the GM types another.
    expect(screen.getByLabelText("Map name")).toHaveValue("keep");
    await user.clear(screen.getByLabelText("Map name"));
    await user.type(screen.getByLabelText("Map name"), "Ruined keep");
    await user.type(screen.getByRole("combobox", { name: "Folder" }), "Dungeons{Enter}");
    await user.click(screen.getByRole("button", { name: "Upload map" }));

    await waitFor(() => expect(here()).toBe(`/scenes/maps/${keep.id}?step=grid`));
    const upload = server.calls.find((call) => call.method === "POST")!;
    expect(Object.fromEntries(new URLSearchParams(upload.search))).toEqual(
      expect.objectContaining({ filename: "keep.png", name: "Ruined keep", kind: "battlemap", folder: "Dungeons" })
    );
    expect(onLibraryChanged).toHaveBeenCalled();
  });

  it("asks how the map measures distance at its Grid step", async () => {
    serveScenes();
    renderTab(`/scenes/maps/${IDS.tunnels}?step=grid`);
    expect(await screen.findByRole("heading", { name: "Grid" })).toBeInTheDocument();
    expect(screen.getByText("Printed square grid")).toBeInTheDocument();
    expect(screen.getByText("Gridless battle map")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Old tunnels" })).toBeInTheDocument();
  });

  it("says to mark the grid first when Check is opened before it", async () => {
    serveScenes();
    renderTab(`/scenes/maps/${IDS.tunnels}?step=check`);
    expect(await screen.findByText("Mark the grid first, then check it here.")).toBeInTheDocument();
  });

  it("ends with the name and folder, and a new scene on it", async () => {
    const user = userEvent.setup();
    const server = serveScenes();
    renderTab(`/scenes/maps/${IDS.crypt}?step=use`);
    expect(await screen.findByRole("heading", { name: "Name and use" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Folder"), "");
    await waitFor(() =>
      expect(server.calls).toContainEqual(expect.objectContaining({ method: "PATCH", body: { folder: null } }))
    );
    await user.click(screen.getByRole("button", { name: "New scene on this map" }));
    expect(here()).toBe(`/scenes/new?map=${IDS.crypt}`);
  });

  it("goes back where it came from: the table, after setting the grid of its map", async () => {
    const user = userEvent.setup();
    serveScenes();
    renderTab(`/scenes/maps/${IDS.crypt}?step=use&back=%2Ftable`);
    await user.click(await screen.findByRole("button", { name: "Back to the table" }));
    expect(here()).toBe("/table");
  });

  it("keeps the steps as a strip on a phone, with the image in a bar", async () => {
    setViewport(390);
    serveScenes();
    renderTab("/scenes/maps/new");
    const strip = await screen.findByRole("tablist", { name: "Steps" });
    expect(
      within(strip)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["Upload", "Grid", "Check", "Use"]);
    expect(screen.getByRole("button", { name: "Open the map" })).toHaveTextContent("No image yet");
  });
});

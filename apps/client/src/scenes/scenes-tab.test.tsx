import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
const read = vi.fn(async (..._args: unknown[]) => ({ ok: false }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: (...args: unknown[]) => read(...args)
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// Every map draws at once, 700 by 500, on 50 px squares; thumbnails stay as their placeholder.
vi.mock("../scene/mapImage", async (original) => ({
  ...(await original<typeof import("../scene/mapImage")>()),
  useAuthorizedMapImage: (id: string | null) =>
    id ? { status: "ready", url: "blob:map", width: 700, height: 500 } : { status: "idle" },
  useCachedMapThumbnail: () => null,
  imagePointFromClient: (_svg: unknown, x: number, y: number) => ({ x, y })
}));
vi.mock("../scene/gridPreview", async (original) => ({
  ...(await original<typeof import("../scene/gridPreview")>()),
  useMapCalibration: () => ({
    status: "ready",
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
  })
}));

import { goTo } from "../../test/route";
import { AMBUSH, IDS, gmView, mapAsset, serveScenes } from "../../test/scenes-fakes";
import { setViewport } from "../../test/viewport";
import { armPlacement } from "../scene/tableGeometry";
import { ScenesShell } from "./ScenesShell";

const onLibraryChanged = vi.fn();

function renderTab(path: string, view: GmView = gmView()) {
  goTo(path);
  return render(
    <ToastProvider>
      <ScenesShell state={view} token="gm" onLibraryChanged={onLibraryChanged} onOpenMap={vi.fn()} />
    </ToastProvider>
  );
}
const here = () => `${window.location.pathname}${window.location.search}`;
const commands = (type: string) => command.mock.calls.filter(([name]) => name === type).map(([, payload]) => payload);

beforeEach(() => {
  serveScenes();
});
afterEach(() => {
  vi.unstubAllGlobals();
  command.mockReset();
  command.mockImplementation(async () => ({ ok: true }));
  read.mockReset();
  read.mockImplementation(async () => ({ ok: false }));
  onLibraryChanged.mockClear();
  act(() => armPlacement(null));
});

describe("the Scenes tab's front page", () => {
  it("starts with what needs the GM, each with the action that answers it", async () => {
    const user = userEvent.setup();
    renderTab("/scenes");
    const needs = await screen.findByRole("region", { name: "Needs you · 5" });
    const rows = within(needs).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Crypt ambush · 1 token waits in the tray, off the map."),
      expect.stringContaining("Tunnel chase · Old tunnels has no grid yet"),
      expect.stringContaining("Tunnel chase · 2 tokens wait in the tray, off the map."),
      expect.stringContaining("Camp at the ford · Nobody is in this scene yet."),
      expect.stringContaining("Saltmere has no grid yet.")
    ]);
    await user.click(within(rows[1]!).getByRole("button", { name: "Set the grid" }));
    expect(here()).toBe(`/scenes/maps/${IDS.tunnels}?step=grid`);
  });

  it("goes from a waiting token to the step that places it", async () => {
    const user = userEvent.setup();
    renderTab("/scenes");
    const needs = await screen.findByRole("region", { name: /^Needs you/ });
    await user.click(within(within(needs).getAllByRole("listitem")[0]!).getByRole("button", { name: "Go to it" }));
    expect(here()).toBe(`/scenes/${IDS.ambush}?step=tokens`);
  });

  it("lists recent changes newest first, each saying who sees it", async () => {
    renderTab("/scenes");
    const recent = await screen.findByRole("region", { name: "Recent changes" });
    const rows = within(recent).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Camp at the ford");
    expect(within(rows[0]!).getByText("Hidden from players")).toBeInTheDocument();
  });

  it("names the live scene first, with the way to its table", async () => {
    renderTab("/scenes", gmView(undefined, IDS.ambush));
    const needs = await screen.findByRole("region", { name: /^Needs you/ });
    expect(within(needs).getAllByRole("listitem")[0]).toHaveTextContent("Crypt ambush is live.");
    expect(within(needs).getByRole("button", { name: "Go to the table" })).toBeInTheDocument();
  });
});

describe("the scenes table", () => {
  it("lists every scene with its state, map, tokens, light and Codex session", async () => {
    renderTab("/scenes/list");
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText("Session 6")).toBeInTheDocument());
    const ambush = within(table).getByRole("button", { name: "Crypt ambush" }).closest("tr")!;
    expect(ambush).toHaveTextContent("Prepared");
    expect(ambush).toHaveTextContent("Sunken crypt");
    expect(ambush).toHaveTextContent("4 tokens · 1 in the tray");
    expect(ambush).toHaveTextContent("Vision on · dim · 1 wall · 1 door");
  });

  it("filters from the flyout and keeps the filters in the address", async () => {
    const user = userEvent.setup();
    renderTab("/scenes/list");
    await screen.findByText("Session 6");
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const flyout = screen.getByRole("complementary", { name: "Filter scenes" });
    await user.click(within(flyout).getByRole("button", { name: "Staged in the Codex" }));
    expect(screen.getByText("1 of 3 scenes")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("codex")).toBe("linked");
    expect(screen.getByRole("button", { name: "Filters · 1" })).toBeInTheDocument();

    await user.click(within(flyout).getByRole("button", { name: "Staged in the Codex" }));
    expect(screen.getByText("3 scenes")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("reads its filters back from a link", async () => {
    renderTab("/scenes/list?tray=1");
    expect(await screen.findByText("2 of 3 scenes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Camp at the ford" })).toBeNull();
  });

  it("shows only the states ticked in the State dropdown", async () => {
    const user = userEvent.setup();
    renderTab("/scenes/list", gmView(undefined, IDS.ambush));
    await user.click(await screen.findByRole("button", { name: "State: all 4" }));
    await user.click(screen.getByRole("checkbox", { name: "Prepared" }));
    expect(screen.getByRole("button", { name: "State: Live, Fight parked, Replay" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3 scenes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crypt ambush" })).toBeInTheDocument();
  });

  it("sorts by several columns from the Sort dialog", async () => {
    const user = userEvent.setup();
    renderTab("/scenes/list");
    await user.click(await screen.findByRole("button", { name: "Sort: Your order" }));
    const dialog = within(screen.getByRole("dialog", { name: "Sort" }));
    await user.selectOptions(dialog.getByLabelText("Sort by: column"), "name");
    await user.click(dialog.getByRole("button", { name: "Add a level" }));
    await user.click(dialog.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("button", { name: "Sort: Name, then Your order" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sort")).toBe("name:asc,order:asc");
    const names = within(screen.getByRole("table"))
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((text) => ["Crypt ambush", "Tunnel chase", "Camp at the ford"].includes(text ?? ""));
    expect(names).toEqual(["Camp at the ford", "Crypt ambush", "Tunnel chase"]);
  });

  it("opens a scene from its row", async () => {
    const user = userEvent.setup();
    renderTab("/scenes/list");
    await user.click(await screen.findByRole("button", { name: "Tunnel chase" }));
    expect(here()).toBe(`/scenes/${IDS.chase}`);
  });
});

describe("a scene's page", () => {
  it("is one document: its state, its map and grid, what it still needs, and Make live", async () => {
    const user = userEvent.setup();
    renderTab(`/scenes/${IDS.ambush}`);
    expect(await screen.findByRole("heading", { name: "Crypt ambush" })).toBeInTheDocument();
    expect(
      screen.getByText("Prepared. Players and the table screen see none of it until you make it live.")
    ).toBeInTheDocument();
    expect(screen.getByText("1 token waits in the tray, off the map.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("50 px squares · 5 ft")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Tokens · 4" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make live" }));
    expect(commands("scene:activate")).toEqual([{ sceneId: IDS.ambush }]);
  });

  it("shows in place what the table screen would show, and goes back to the GM's view", async () => {
    const user = userEvent.setup();
    read.mockImplementation(async (type) =>
      type === "scene:preview"
        ? {
            ok: true,
            mapAssetId: IDS.crypt,
            screen: {
              initiative: { visible: false, round: 1, hiddenTurn: false, entries: [] },
              encounter: { mapAssetId: IDS.crypt, tokens: [] }
            }
          }
        : { ok: false }
    );
    renderTab(`/scenes/${IDS.ambush}`);
    await user.selectOptions(await screen.findByLabelText("See as"), "screen");
    expect(screen.getByText("What the table screen shows once this scene is live.")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith("scene:preview", { sceneId: IDS.ambush });
    await waitFor(() => expect(document.querySelector(".sc-preview-screen .viewer-stage")).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Back to your view" }));
    expect(screen.queryByText(/What the table screen shows/)).toBeNull();
  });

  it("asks the server what one character's player would see", async () => {
    const user = userEvent.setup();
    read.mockImplementation(() => new Promise(() => {}));
    renderTab(`/scenes/${IDS.ambush}`);
    await user.selectOptions(await screen.findByLabelText("See as"), IDS.lyra);
    expect(read).toHaveBeenCalledWith("scene:preview", { sceneId: IDS.ambush, actorId: IDS.lyra });
    expect(screen.getByText("What Lyra Emberwise's player sees once this scene is live.")).toBeInTheDocument();
  });

  it("names the Codex session that stages it", async () => {
    renderTab(`/scenes/${IDS.ambush}`);
    expect(await screen.findByText("Session 6")).toBeInTheDocument();
  });

  it("says so when the scene is gone, with the way back to the list", async () => {
    renderTab(`/scenes/${IDS.ambush}`, gmView([]));
    expect(await screen.findByText("That scene no longer exists. It may have been deleted.")).toBeInTheDocument();
  });
});

describe("making a scene as steps", () => {
  it("makes the scene from its map, then opens its Tokens and monsters step", async () => {
    const user = userEvent.setup();
    const NEW = "30000000-0000-4000-8000-0000000000d1";
    command.mockImplementation(async (type) => (type === "scene:create" ? { ok: true, sceneId: NEW } : { ok: true }));
    renderTab("/scenes/new");
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      expect.stringContaining("Map"),
      expect.stringContaining("Tokens and monsters"),
      expect.stringContaining("Walls and light"),
      expect.stringContaining("Sound"),
      expect.stringContaining("Review and make live")
    ]);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: /Sunken crypt/ }));
    await user.type(screen.getByLabelText("Scene name"), "Bone pit");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(commands("scene:create")).toEqual([
      { name: "Bone pit", mapAssetId: IDS.crypt, combatantIds: [IDS.lyra, IDS.borin] }
    ]);
    await waitFor(() => expect(here()).toBe(`/scenes/${NEW}?step=tokens`));
    expect(screen.getByRole("status")).toHaveTextContent("Opening the scene…");
  });

  it("uploads a map from its first step and tells the rest of the app the library changed", async () => {
    const user = userEvent.setup();
    const cave = mapAsset("20000000-0000-5000-8000-0000000000d2", "Cave");
    serveScenes({ uploaded: cave });
    const { container } = renderTab("/scenes/new");
    await screen.findByRole("button", { name: /Sunken crypt/ });
    const input = container.querySelector<HTMLInputElement>("input.map-picker-file")!;
    await user.upload(input, new File(["png"], "cave.png", { type: "image/png" }));
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled());
  });

  it("walks a scene's steps, each with its question, and ends at Make live", async () => {
    const user = userEvent.setup();
    renderTab(`/scenes/${IDS.ambush}?step=map`);
    expect(await screen.findByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByLabelText("Scene name")).toHaveValue("Crypt ambush");

    await user.click(screen.getByRole("button", { name: "Next: Tokens" }));
    expect(here()).toBe(`/scenes/${IDS.ambush}?step=tokens`);
    expect(screen.getByRole("heading", { name: "Tokens and monsters" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In this scene" })).toHaveTextContent("4 staged · 3 on the map");

    await user.click(screen.getByRole("button", { name: "Next: Light" }));
    expect(screen.getByRole("heading", { name: "Walls and light" })).toBeInTheDocument();
    expect(screen.getByText("1 wall · 1 door")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next: Sound" }));
    expect(screen.getByRole("heading", { name: "Sound" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(screen.getByRole("heading", { name: "Review and make live" })).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make live" }));
    expect(commands("scene:activate")).toEqual([{ sceneId: IDS.ambush }]);
  });

  it("goes back a step with Back, and leaves the review with Done for now", async () => {
    const user = userEvent.setup();
    renderTab(`/scenes/${IDS.ambush}?step=review`);
    await user.click(await screen.findByRole("button", { name: "Done for now" }));
    expect(here()).toBe(`/scenes/${IDS.ambush}`);
  });

  it("places a token from its step: Place arms the map beside it", async () => {
    const user = userEvent.setup();
    renderTab(`/scenes/${IDS.ambush}?step=tokens`);
    await user.click(await screen.findByRole("button", { name: "Place Goblin Boss on the map" }));
    expect(await screen.findByText("Tap the map where Goblin Boss goes.")).toBeInTheDocument();
  });

  it("turns vision on for this scene alone", async () => {
    const user = userEvent.setup();
    renderTab(`/scenes/${IDS.chase}?step=light`);
    await user.click(await screen.findByRole("switch", { name: "Dynamic vision" }));
    expect(commands("vision:set-enabled")).toEqual([{ enabled: true, sceneId: IDS.chase }]);
  });

  it("renames the scene from its name field", async () => {
    const user = userEvent.setup();
    renderTab(`/scenes/${AMBUSH.id}?step=review`);
    const name = await screen.findByLabelText("Scene name");
    await user.clear(name);
    await user.type(name, "Crypt brawl{Enter}");
    expect(commands("scene:rename")).toEqual([{ sceneId: IDS.ambush, name: "Crypt brawl" }]);
  });
});

describe("on a phone", () => {
  it("puts the sections in a tab bar under the thumb", async () => {
    setViewport(390);
    renderTab("/scenes/list");
    const bar = await screen.findByRole("navigation", { name: "Scenes sections" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["Overview", "Scenes", "New", "Maps"]);
  });

  it("runs the steps as a strip and keeps the map in a bar that opens it full screen", async () => {
    const user = userEvent.setup();
    setViewport(390);
    renderTab(`/scenes/${IDS.ambush}?step=tokens`);
    const strip = await screen.findByRole("tablist", { name: "Steps" });
    expect(
      within(strip)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["Map", "Tokens", "Light", "Sound", "Review"]);
    await user.click(screen.getByRole("button", { name: "Open the map" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("opens the map full screen when Place is pressed, armed for the next tap", async () => {
    const user = userEvent.setup();
    setViewport(390);
    renderTab(`/scenes/${IDS.ambush}?step=tokens`);
    await user.click(await screen.findByRole("button", { name: "Place Goblin Boss on the map" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(await screen.findByText("Tap the map where Goblin Boss goes.")).toBeInTheDocument();
  });

  it("keeps See as in the scene's menu", async () => {
    const user = userEvent.setup();
    setViewport(390);
    read.mockImplementation(() => new Promise(() => {}));
    renderTab(`/scenes/${IDS.ambush}`);
    expect(screen.queryByLabelText("See as")).toBeNull();
    await user.click(await screen.findByLabelText("Crypt ambush actions"));
    await user.click(screen.getByRole("menuitem", { name: "See as Borin Stoneguard" }));
    expect(screen.getByText("What Borin Stoneguard's player sees once this scene is live.")).toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { AMBUSH, CAMP, CHASE, IDS, gmView, mapAsset, serveScenes } from "../../test/scenes-fakes";
import { setViewport } from "../../test/viewport";
import { armPlacement } from "../scene/tableGeometry";
import { ScenesShell } from "./ScenesShell";
import { PrepFrame } from "../shell/AppBar";

const onLibraryChanged = vi.fn();

function renderTab(path: string, view: GmView = gmView()) {
  goTo(path);
  return render(
    <ToastProvider>
      <PrepFrame>
        <ScenesShell state={view} token="gm" onLibraryChanged={onLibraryChanged} onOpenMap={vi.fn()} />
      </PrepFrame>
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

const card = (name: string) => screen.getByRole("listitem", { name });
const cardNames = async () =>
  within(await screen.findByRole("list", { name: "Encounters" }))
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));

describe("the Encounters shelf", () => {
  it("has no Maps and Encounters toggle: they are Prep's pages, with New encounter as the bar's Cup", async () => {
    const user = userEvent.setup();
    renderTab("/encounters");
    expect(await screen.findByRole("list", { name: "Encounters" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Maps and encounters" })).toBeNull();
    const pages = within(screen.getByRole("tablist", { name: "Prep pages" }));
    expect(pages.getByRole("tab", { name: "Encounters" })).toHaveAttribute("aria-selected", "true");
    expect(pages.getByRole("tab", { name: "Maps" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New map" }));
    expect(here()).toBe("/encounters/maps/new");
    cleanup();
    renderTab("/encounters/list");
    await user.click(screen.getAllByRole("button", { name: "New encounter" })[0]!);
    expect(here()).toBe("/encounters/new");
  });

  it("sorts encounters by what needs attention, and by whether their combat has run", async () => {
    // A parked fight: running, with whose turn it is.
    const chaseRunning = {
      ...CHASE,
      combat: { ...CHASE.combat, active: true, round: 1, turnActorId: CHASE.combat.initiative[0]!.actorId }
    };
    const campDone = { ...CAMP, endedAt: Date.parse("2026-10-18T12:00:00.000Z") };
    const first = renderTab("/encounters?sort=attention:asc");
    // The chase has no grid and two tokens in the tray: the most to do.
    expect((await cardNames())[0]).toBe("Tunnel chase");
    first.unmount();
    renderTab("/encounters?sort=progress:asc", gmView([AMBUSH, chaseRunning, campDone]));
    expect(await cardNames()).toEqual(["Crypt ambush", "Tunnel chase", "Camp at the ford"]);
    expect(card("Tunnel chase")).toHaveTextContent("Encounter parked");
    expect(card("Camp at the ford")).toHaveTextContent("Ended");
  });

  it("shows each encounter as a card: its state tag, map, who is in it and whether it is ready", async () => {
    renderTab("/encounters/list");
    await screen.findByRole("list", { name: "Encounters" });
    const ambush = card("Crypt ambush");
    expect(ambush).toHaveTextContent("Sunken crypt");
    // One token waits in the tray, so the ambush is a Draft until it is placed.
    expect(ambush).toHaveTextContent("Draft");
    expect(ambush).toHaveTextContent("1 token waits in the tray");
    expect(card("Tunnel chase")).toHaveTextContent("No grid yet");
  });

  it("filters from the flyout and keeps the filters in the address", async () => {
    const user = userEvent.setup();
    renderTab("/encounters/list");
    await screen.findByRole("list", { name: "Encounters" });
    await waitFor(() => expect(read).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const flyout = screen.getByRole("complementary", { name: "Filter encounters" });
    await user.click(within(flyout).getByRole("button", { name: "Staged in the Codex" }));
    await waitFor(() => expect(screen.getByText("1 of 3 encounters")).toBeInTheDocument());
    expect(new URLSearchParams(window.location.search).get("codex")).toBe("linked");
    expect(screen.getByRole("button", { name: "Filters · 1" })).toBeInTheDocument();

    await user.click(within(flyout).getByRole("button", { name: "Staged in the Codex" }));
    expect(screen.getByText("3 encounters")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("reads its filters back from a link", async () => {
    renderTab("/encounters/list?tray=1");
    expect(await screen.findByText("2 of 3 encounters")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Camp at the ford" })).toBeNull();
  });

  it("shows only the state its chip picks, and adds Live while an encounter is live", async () => {
    const user = userEvent.setup();
    renderTab("/encounters/list", gmView(undefined, IDS.ambush));
    const chips = within(await screen.findByRole("group", { name: "State" }));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "All",
      "Draft",
      "Prepared",
      "Ended",
      "Live"
    ]);
    await user.click(chips.getByRole("button", { name: "Live" }));
    expect(new URLSearchParams(window.location.search).get("tag")).toBe("live");
    expect(screen.getByText("1 of 3 encounters")).toBeInTheDocument();
    expect(await cardNames()).toEqual(["Crypt ambush"]);
    await user.click(chips.getByRole("button", { name: "All" }));
    expect(screen.getByText("3 encounters")).toBeInTheDocument();
  });

  it("sorts by several columns from the Sort dialog", async () => {
    const user = userEvent.setup();
    renderTab("/encounters/list");
    await user.click(await screen.findByRole("button", { name: "Sort: Your order" }));
    const dialog = within(screen.getByRole("dialog", { name: "Sort" }));
    await user.selectOptions(dialog.getByLabelText("Sort by: column"), "name");
    await user.click(dialog.getByRole("button", { name: "Add a level" }));
    await user.click(dialog.getByRole("button", { name: "Sort" }));
    expect(screen.getByRole("button", { name: "Sort: Name, then Your order" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("sort")).toBe("name:asc,order:asc");
    expect(await cardNames()).toEqual(["Camp at the ford", "Crypt ambush", "Tunnel chase"]);
  });

  it("opens an encounter from its card, and keeps the rest in the card's menu", async () => {
    const user = userEvent.setup();
    renderTab("/encounters/list");
    await screen.findByRole("list", { name: "Encounters" });
    await user.click(within(card("Tunnel chase")).getByLabelText("Tunnel chase actions"));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(expect.arrayContaining(["Make live", "Rename", "Duplicate", "Delete encounter"]));
    expect(items).not.toContain("Edit its steps");
    await user.keyboard("{Escape}");
    await user.click(within(card("Tunnel chase")).getByRole("button", { name: "Open Tunnel chase" }));
    expect(here()).toBe(`/encounters/${IDS.chase}`);
  });

  it("drags a card to reorder in Your order, sending the new order", async () => {
    renderTab("/encounters/list");
    await screen.findByRole("list", { name: "Encounters" });
    const rects: Record<string, DOMRect> = {
      [IDS.ambush]: new DOMRect(0, 0, 270, 200),
      [IDS.chase]: new DOMRect(290, 0, 270, 200),
      [IDS.camp]: new DOMRect(580, 0, 270, 200)
    };
    for (const item of document.querySelectorAll<HTMLElement>("[data-scene-id]"))
      item.getBoundingClientRect = () => rects[item.dataset.sceneId!]!;
    const grip = screen.getByRole("button", { name: "Drag to reorder Camp at the ford" });
    act(() => {
      grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 10 }));
    });
    await waitFor(() => expect(commands("encounter:reorder")).toHaveLength(1));
    expect(commands("encounter:reorder")[0]).toEqual({ order: [IDS.camp, IDS.ambush, IDS.chase] });
  });
});

describe("an encounter's page", () => {
  it("is the workbench: its title row, Who is in it, Rules, Light and sound, what is missing and Make live", async () => {
    const user = userEvent.setup();
    renderTab(`/encounters/${IDS.ambush}`);
    expect(await screen.findByRole("heading", { name: "Crypt ambush" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit the map" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist", { name: "About Crypt ambush" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Who is in it · 4",
      "Rules",
      "Light and sound"
    ]);
    // The foot names what is missing, each with Go to it, over Make live.
    const foot = within(screen.getByRole("region", { name: "Not ready yet" }));
    expect(foot.getByText("1 token waits in the tray, off the map.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Light and sound" }));
    await waitFor(() => expect(screen.getByText("50 px squares · 5 ft")).toBeInTheDocument());
    await user.click(foot.getByRole("button", { name: "Go to it" }));
    expect(screen.getByRole("tab", { name: "Who is in it · 4" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Make live" }));
    expect(commands("encounter:activate")).toEqual([{ encounterId: IDS.ambush }]);
  });

  it("shows in place what the table screen would show, and goes back to the GM's view", async () => {
    const user = userEvent.setup();
    read.mockImplementation(async (type) =>
      type === "encounter:preview"
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
    renderTab(`/encounters/${IDS.ambush}`);
    await user.click(await screen.findByLabelText("Crypt ambush actions"));
    await user.click(screen.getByRole("menuitem", { name: "See as the table screen" }));
    expect(screen.getByText("What the table screen shows once this encounter is live.")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith("encounter:preview", { encounterId: IDS.ambush });
    await waitFor(() => expect(document.querySelector(".sc-preview-screen .viewer-stage")).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Back to your view" }));
    expect(screen.queryByText(/What the table screen shows/)).toBeNull();
  });

  it("asks the server what one character's player would see", async () => {
    const user = userEvent.setup();
    read.mockImplementation(() => new Promise(() => {}));
    renderTab(`/encounters/${IDS.ambush}`);
    await user.click(await screen.findByLabelText("Crypt ambush actions"));
    await user.click(screen.getByRole("menuitem", { name: "See as Lyra Emberwise" }));
    expect(read).toHaveBeenCalledWith("encounter:preview", { encounterId: IDS.ambush, actorId: IDS.lyra });
    expect(screen.getByText("What Lyra Emberwise's player sees once this encounter is live.")).toBeInTheDocument();
  });

  it("names the Codex session that stages it on its title row's line", async () => {
    renderTab(`/encounters/${IDS.ambush}`);
    expect(await screen.findByText(/In the Codex: Session 6/)).toBeInTheDocument();
  });

  it("says so when the encounter is gone, with the way back to the list", async () => {
    renderTab(`/encounters/${IDS.ambush}`, gmView([]));
    expect(await screen.findByText("That encounter no longer exists. It may have been deleted.")).toBeInTheDocument();
  });
});

describe("making an encounter as steps", () => {
  it("makes the encounter from its map, then opens its Tokens and monsters step", async () => {
    const user = userEvent.setup();
    const NEW = "30000000-0000-4000-8000-0000000000d1";
    command.mockImplementation(async (type) =>
      type === "encounter:create" ? { ok: true, encounterId: NEW } : { ok: true }
    );
    renderTab("/encounters/new");
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
    await user.type(screen.getByLabelText("Encounter name"), "Bone pit");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(commands("encounter:create")).toEqual([
      { name: "Bone pit", mapAssetId: IDS.crypt, combatantIds: [IDS.lyra, IDS.borin] }
    ]);
    await waitFor(() => expect(here()).toBe(`/encounters/${NEW}?step=tokens`));
    expect(screen.getByRole("status")).toHaveTextContent("Opening the encounter…");
  });

  it("uploads a map from its first step and tells the rest of the app the library changed", async () => {
    const user = userEvent.setup();
    const cave = mapAsset("20000000-0000-5000-8000-0000000000d2", "Cave");
    serveScenes({ uploaded: cave });
    const { container } = renderTab("/encounters/new");
    await screen.findByRole("button", { name: /Sunken crypt/ });
    const input = container.querySelector<HTMLInputElement>("input.map-picker-file")!;
    await user.upload(input, new File(["png"], "cave.png", { type: "image/png" }));
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled());
  });

  it("walks an encounter's steps, each with its question, and ends at Make live", async () => {
    const user = userEvent.setup();
    renderTab(`/encounters/${IDS.ambush}?step=map`);
    expect(await screen.findByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByLabelText("Encounter name")).toHaveValue("Crypt ambush");

    await user.click(screen.getByRole("button", { name: "Next: Tokens" }));
    expect(here()).toBe(`/encounters/${IDS.ambush}?step=tokens`);
    expect(screen.getByRole("heading", { name: "Tokens and monsters" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "In this encounter" })).toHaveTextContent("4 staged · 3 on the map");

    await user.click(screen.getByRole("button", { name: "Next: Light" }));
    expect(screen.getByRole("heading", { name: "Walls and light" })).toBeInTheDocument();
    expect(screen.getByText("1 wall · 1 door")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next: Sound" }));
    expect(screen.getByRole("heading", { name: "Sound" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(screen.getByRole("heading", { name: "Review and make live" })).toBeInTheDocument();
    expect(screen.getByText("Tokens", { selector: "dt" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make live" }));
    expect(commands("encounter:activate")).toEqual([{ encounterId: IDS.ambush }]);
  });

  it("goes back a step with Back, and leaves the review with Done for now", async () => {
    const user = userEvent.setup();
    renderTab(`/encounters/${IDS.ambush}?step=review`);
    await user.click(await screen.findByRole("button", { name: "Done for now" }));
    expect(here()).toBe(`/encounters/${IDS.ambush}`);
  });

  it("places a token from its step: Place arms the map beside it", async () => {
    const user = userEvent.setup();
    renderTab(`/encounters/${IDS.ambush}?step=tokens`);
    await user.click(await screen.findByRole("button", { name: "Place Goblin Boss on the map" }));
    expect(await screen.findByText("Tap the map where Goblin Boss goes.")).toBeInTheDocument();
  });

  it("turns vision on for this encounter alone", async () => {
    const user = userEvent.setup();
    renderTab(`/encounters/${IDS.chase}?step=light`);
    await user.click(await screen.findByRole("switch", { name: "Dynamic vision" }));
    expect(commands("vision:set-enabled")).toEqual([{ enabled: true, encounterId: IDS.chase }]);
  });

  it("renames the encounter from its name field", async () => {
    const user = userEvent.setup();
    renderTab(`/encounters/${AMBUSH.id}?step=review`);
    const name = await screen.findByLabelText("Encounter name");
    await user.clear(name);
    await user.type(name, "Crypt brawl{Enter}");
    expect(commands("encounter:rename")).toEqual([{ encounterId: IDS.ambush, name: "Crypt brawl" }]);
  });
});

describe("on a phone", () => {
  it("lists Prep's pages as the strip under the header, with New encounter as its plus and two cards to a row", async () => {
    setViewport(390);
    renderTab("/encounters/list");
    const pages = await screen.findByRole("tablist", { name: "Prep pages" });
    expect(
      within(pages)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["Encounters", "Party", "Maps", "Tokens", "Sound", "Replays"]);
    expect(within(pages).getByRole("tab", { name: "Encounters" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tablist", { name: "Maps and encounters" })).toBeNull();
    expect(screen.getByRole("button", { name: "New encounter" })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Encounters" })).toBeInTheDocument();
  });

  it("runs the steps as a strip and keeps the map in a bar that opens it full screen", async () => {
    const user = userEvent.setup();
    setViewport(390);
    renderTab(`/encounters/${IDS.ambush}?step=tokens`);
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
    renderTab(`/encounters/${IDS.ambush}?step=tokens`);
    await user.click(await screen.findByRole("button", { name: "Place Goblin Boss on the map" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(await screen.findByText("Tap the map where Goblin Boss goes.")).toBeInTheDocument();
  });

  it("keeps See as in the encounter's menu", async () => {
    const user = userEvent.setup();
    setViewport(390);
    read.mockImplementation(() => new Promise(() => {}));
    renderTab(`/encounters/${IDS.ambush}`);
    expect(screen.queryByLabelText("See as")).toBeNull();
    await user.click(await screen.findByLabelText("Crypt ambush actions"));
    await user.click(screen.getByRole("menuitem", { name: "See as Borin Stoneguard" }));
    expect(screen.getByText("What Borin Stoneguard's player sees once this encounter is live.")).toBeInTheDocument();
  });
});

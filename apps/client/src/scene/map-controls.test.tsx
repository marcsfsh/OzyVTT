import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: true }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// jsdom has no layout, so a client point is the image point.
vi.mock("./mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 600, height: 400 }),
  imagePointFromClient: (_svg: unknown, x: number, y: number) => ({ x, y })
}));
const GRID = vi.hoisted(() => ({
  status: "ready",
  calibration: { kind: "square", origin: { x: 10, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
}));
vi.mock("./gridPreview", async (original) => ({
  ...(await original<typeof import("./gridPreview")>()),
  useMapCalibration: () => GRID
}));

import { EncounterMap } from "./EncounterMap";
import { DockToolsTarget } from "../table/dockTools";

// The map's own controls sit on the map on every size; on a laptop its tools move into the table's dock, and the
// tray is a chip that opens on demand (table spec 2.1, rule 6).

const LYRA = "10000000-0000-4000-8000-0000000000b1";
const GOBLIN = "10000000-0000-4000-8000-0000000000b2";
const MAP = "20000000-0000-5000-8000-0000000000b1";
const SCENE = "30000000-0000-4000-8000-0000000000b1";
const actor = (id: string, name: string, kind: string, claimStatus?: string) => ({
  id,
  name,
  kind,
  visibility: "public",
  hp: { current: 10, maximum: 10, temporary: 0 },
  conditions: [],
  effects: [],
  presence: null,
  ...(claimStatus ? { claimStatus } : {})
});
const actors = [
  actor(LYRA, "Lyra", "player-character", "mine"),
  actor(GOBLIN, "Goblin", "monster")
] as unknown as GmView["actors"];
const tokens = [
  { actorId: LYRA, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 },
  { actorId: GOBLIN, position: null, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }
];

function map(props: Partial<Parameters<typeof EncounterMap>[0]> = {}, dock: HTMLElement | null = null) {
  return render(
    <ToastProvider>
      <DockToolsTarget.Provider value={dock}>
        <EncounterMap
          assetId={MAP}
          token="gm"
          role="gm"
          actors={actors}
          tokens={tokens}
          annotations={[]}
          revision={3}
          activeActorId={null}
          moveSceneId={SCENE}
          {...props}
        />
      </DockToolsTarget.Provider>
    </ToastProvider>
  );
}

afterEach(() => {
  command.mockClear();
  document.body.innerHTML = "";
});

describe("the map's controls", () => {
  it("zooms out and in from the map itself", () => {
    map();
    const controls = screen.getByRole("group", { name: "Map controls" });
    expect(within(controls).getByRole("button", { name: "Zoom out" })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: "Zoom in" })).toBeTruthy();
  });

  it("centres the GM on whoever acts, and offers nothing to centre on before a turn", () => {
    map();
    expect(screen.queryByRole("button", { name: "Centre on who acts" })).toBeNull();
    document.body.innerHTML = "";
    map({ activeActorId: LYRA });
    expect(screen.getByRole("button", { name: "Centre on who acts" })).toBeTruthy();
  });

  it("brings a player's own token into view", () => {
    map({ role: "player", token: "player" });
    expect(screen.getByRole("button", { name: "Bring your token into view" })).toBeTruthy();
  });
});

describe("the tray chip", () => {
  it("counts the unplaced tokens and opens the tray on demand", () => {
    map();
    expect(screen.queryByLabelText("Staging tray")).toBeNull();
    const chip = screen.getByRole("button", { name: /^Tray\b/ });
    expect(chip.textContent).toContain("1");
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    act(() => fireEvent.click(chip));
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByLabelText("Staging tray")).getByRole("button", { name: /Goblin/ })).toBeTruthy();
  });

  it("has no chip once every token is placed", () => {
    map({ tokens: tokens.map((t) => ({ ...t, position: { x: 125, y: 75 } })) });
    expect(screen.queryByRole("button", { name: /^Tray\b/ })).toBeNull();
  });
});

describe("the tools in the dock", () => {
  it("renders the map's tools into the dock when the table gives it one", () => {
    const dock = document.createElement("div");
    document.body.append(dock);
    map({}, dock);
    expect(within(dock).getByRole("toolbar", { name: "Map tools" })).toBeTruthy();
    // The controls stay on the map.
    expect(within(dock).queryByRole("group", { name: "Map controls" })).toBeNull();
    expect(screen.getByRole("group", { name: "Map controls" })).toBeTruthy();
  });

  it("keeps the tools beside the map without a dock", () => {
    const { container } = map();
    expect(within(container).getByRole("toolbar", { name: "Map tools" })).toBeTruthy();
  });
});

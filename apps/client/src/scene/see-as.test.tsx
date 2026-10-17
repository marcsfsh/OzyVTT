import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const read = vi.fn(async (..._args: unknown[]) => ({ ok: true, enabled: true, visible: [], actorIds: [] }) as unknown);
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: (...args: unknown[]) => read(...args)
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
vi.mock("./mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 600, height: 400 })
}));
const GRID = vi.hoisted(() => ({
  status: "ready",
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
}));
vi.mock("./gridPreview", async (original) => ({
  ...(await original<typeof import("./gridPreview")>()),
  useMapCalibration: () => GRID
}));

import { EncounterMap } from "./EncounterMap";

// The GM's vision and light tools live in the rail: Walls and Light, with the ambient light, the vision switch and
// "See as a token" in Light's options. Seeing through a token's eyes puts a violet GM-only row above the map with
// one way out.

const LYRA = "10000000-0000-4000-8000-0000000000b1";
const MAP = "20000000-0000-5000-8000-0000000000b1";
const actors = [
  {
    id: LYRA,
    name: "Lyra",
    kind: "player-character",
    visibility: "public",
    hp: { current: 37, maximum: 44, temporary: 0 },
    conditions: [],
    effects: [],
    presence: null
  }
] as unknown as GmView["actors"];
const tokens = [{ actorId: LYRA, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50, sizeCells: 1 }];
const vision = {
  enabled: true,
  ambient: "dim",
  walls: [],
  lights: [],
  measure: { width: 600, height: 400, pixelsPerFoot: 10 },
  explored: null
} as unknown as GmView["combat"]["vision"];

describe("the GM's vision tools", () => {
  it("open beside the map, and seeing as a token shows a GM-only row with one Exit", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EncounterMap
          assetId={MAP}
          token="gm"
          role="gm"
          actors={actors}
          tokens={tokens}
          annotations={[]}
          revision={3}
          activeActorId={null}
          vision={vision}
        />
      </ToastProvider>
    );
    const rail = screen.getByRole("toolbar", { name: "Map tools" });
    expect(within(rail).getByRole("button", { name: "Walls" })).toBeTruthy();
    await user.click(within(rail).getByRole("button", { name: "Light" }));
    const light = screen.getByRole("group", { name: "Light" });
    expect(within(light).getByRole("group", { name: "Ambient light" })).toBeTruthy();
    expect(within(light).getByRole("switch", { name: "Vision" })).toBeTruthy();
    await user.selectOptions(within(light).getByLabelText("See as a token"), "Lyra");
    expect(read).toHaveBeenCalledWith("vision:preview", { actorId: LYRA });
    expect(screen.getByText("Seeing what Lyra sees · GM only")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exit" }));
    expect(screen.queryByText(/Seeing what Lyra sees/)).toBeNull();
  });
});

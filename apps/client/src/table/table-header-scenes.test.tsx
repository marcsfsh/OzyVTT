import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { goTo } from "../../test/route";
import { IDS, gmView, serveScenes } from "../../test/scenes-fakes";
import { TableHeader } from "./TableHeader";

// Scenes are prepared on the Scenes tab; the table's header switches between them and opens that tab.

function header(view: GmView) {
  return render(
    <ToastProvider>
      <TableHeader
        role="gm"
        state={view}
        gm={{ token: "gm", liveMapName: "Sunken crypt", viewerPreview: { on: false, onToggle: vi.fn() } }}
      />
    </ToastProvider>
  );
}
const here = () => `${window.location.pathname}${window.location.search}`;

beforeEach(() => {
  serveScenes();
  goTo("/table");
});
afterEach(() => {
  vi.unstubAllGlobals();
  command.mockClear();
});

describe("the table's scene menu", () => {
  it("names the live scene and makes another live in one press when no fight is on", async () => {
    const user = userEvent.setup();
    header(gmView(undefined, IDS.ambush));
    await user.click(screen.getByLabelText("Scenes · Crypt ambush is live"));
    const menu = screen.getByRole("menuitem", { name: "All scenes" }).closest<HTMLElement>("[role=menu]")!;
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Make Tunnel chase live", "Make Camp at the ford live", "Open Crypt ambush", "All scenes", "New scene"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Make Tunnel chase live" }));
    expect(command).toHaveBeenCalledWith("scene:activate", { sceneId: IDS.chase });
  });

  it("asks first while a fight is on, since the fight is parked", async () => {
    const user = userEvent.setup();
    const live = gmView(undefined, IDS.ambush);
    header({ ...live, combat: { ...live.combat, active: true } });
    await user.click(screen.getByLabelText("Scenes · Crypt ambush is live"));
    await user.click(screen.getByRole("menuitem", { name: "Make Tunnel chase live" }));
    expect(command).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Make scene live?" });
    await user.click(within(dialog).getByRole("button", { name: "Make live" }));
    expect(command).toHaveBeenCalledWith("scene:activate", { sceneId: IDS.chase });
  });

  it("opens the live scene's page on the Scenes tab", async () => {
    const user = userEvent.setup();
    header(gmView(undefined, IDS.ambush));
    await user.click(screen.getByLabelText("Scenes · Crypt ambush is live"));
    await user.click(screen.getByRole("menuitem", { name: "Open Crypt ambush" }));
    expect(here()).toBe(`/scenes/${IDS.ambush}`);
  });

  it("says when no scene is live, and offers a new one", async () => {
    const user = userEvent.setup();
    header(gmView());
    expect(screen.getByText("No scene live")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Scenes"));
    await user.click(screen.getByRole("menuitem", { name: "New scene" }));
    expect(here()).toBe("/scenes/new");
  });
});

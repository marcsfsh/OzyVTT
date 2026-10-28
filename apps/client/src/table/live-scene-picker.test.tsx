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
import { LiveScenePicker } from "./LiveScenePicker";

// Scenes are prepared in Prep; the live scene picker on Play switches between them and opens Prep's Scenes page.

function header(view: GmView) {
  return render(
    <ToastProvider>
      <LiveScenePicker state={view} />
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

describe("the live encounter picker", () => {
  it("names the live encounter and makes another live in one press when no combat is on", async () => {
    const user = userEvent.setup();
    header(gmView(undefined, IDS.ambush));
    await user.click(screen.getByLabelText("Encounters · Crypt ambush is live"));
    const menu = screen.getByRole("menuitem", { name: "All encounters" }).closest<HTMLElement>("[role=menu]")!;
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual([
      "Make Tunnel chase live",
      "Make Camp at the ford live",
      "Open Crypt ambush",
      "All encounters",
      "New encounter"
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "Make Tunnel chase live" }));
    expect(command).toHaveBeenCalledWith("encounter:activate", { encounterId: IDS.chase });
  });

  it("asks first while combat is on, since combat is parked", async () => {
    const user = userEvent.setup();
    const live = gmView(undefined, IDS.ambush);
    header({ ...live, combat: { ...live.combat, active: true } });
    await user.click(screen.getByLabelText("Encounters · Crypt ambush is live"));
    await user.click(screen.getByRole("menuitem", { name: "Make Tunnel chase live" }));
    expect(command).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Make encounter live?" });
    await user.click(within(dialog).getByRole("button", { name: "Make live" }));
    expect(command).toHaveBeenCalledWith("encounter:activate", { encounterId: IDS.chase });
  });

  it("opens the live encounter's page in Prep", async () => {
    const user = userEvent.setup();
    header(gmView(undefined, IDS.ambush));
    await user.click(screen.getByLabelText("Encounters · Crypt ambush is live"));
    await user.click(screen.getByRole("menuitem", { name: "Open Crypt ambush" }));
    expect(here()).toBe(`/encounters/${IDS.ambush}`);
  });

  it("says when no encounter is live, and offers a new one", async () => {
    const user = userEvent.setup();
    header(gmView());
    expect(screen.getByText("No encounter live")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Encounters"));
    await user.click(screen.getByRole("menuitem", { name: "New encounter" }));
    expect(here()).toBe("/encounters/new");
  });
});

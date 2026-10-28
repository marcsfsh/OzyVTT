import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiRequest = vi.fn();
vi.mock("../lib/api", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import { ToastProvider } from "@vtt/ui";
import { ReplayList } from "./ReplayList";
import { dateOnly } from "./replays";

// Replays are called by their scene and the day they were fought, with how long the fight ran, until the GM names one.

const ENDED = "2026-10-17T20:30:00.000Z";
const archive = (over: Record<string, unknown> = {}) => ({
  id: 7,
  archivedAt: ENDED,
  startedAt: "2026-10-17T20:18:00.000Z",
  endedAt: ENDED,
  turnCount: 1,
  playerVisible: false,
  name: null,
  encounterName: "Goblin cave",
  ...over
});

function serve(encounters: readonly unknown[]) {
  apiRequest.mockImplementation(async (path: string) =>
    path === "/api/v1/replays" ? { replays: encounters } : { id: 7, name: "Ambush at the bridge" }
  );
}

describe("the replay list", () => {
  beforeEach(() => apiRequest.mockReset());

  it("names a replay by its encounter and day, with its length in turns and minutes", async () => {
    serve([archive(), archive({ id: 8, encounterName: null, turnCount: 3 })]);
    render(<ReplayList role="gm" token="gm" onOpen={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByText(`Goblin cave · ${dateOnly(ENDED)}`)).toBeTruthy();
    expect(screen.getByText("1 turn · 12 min")).toBeTruthy();
    // A fight with no live scene is a Fight.
    expect(screen.getByText(`Encounter · ${dateOnly(ENDED)}`)).toBeTruthy();
    expect(screen.getByText("3 turns · 12 min")).toBeTruthy();
  });

  it("puts the GM's name first, with the encounter and day under it", async () => {
    serve([archive({ name: "Ambush at the bridge" })]);
    render(<ReplayList role="gm" token="gm" onOpen={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByText("Ambush at the bridge")).toBeTruthy();
    expect(screen.getByText(`Goblin cave · ${dateOnly(ENDED)} · 1 turn · 12 min`)).toBeTruthy();
  });

  it("lets the GM rename one", async () => {
    serve([archive()]);
    const user = userEvent.setup();
    render(<ReplayList role="gm" token="gm" onOpen={() => {}} />, { wrapper: ToastProvider });
    await user.click(await screen.findByText("More"));
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { name: "Rename the replay" });
    await user.type(within(dialog).getByLabelText("Name"), "Ambush at the bridge");
    await user.click(within(dialog).getByRole("button", { name: "Save name" }));
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/v1/replays/7/name",
      expect.objectContaining({ token: "gm", body: { name: "Ambush at the bridge" } })
    );
  });

  it("offers a player no rename", async () => {
    serve([archive({ encounterName: undefined, playerVisible: true })]);
    render(<ReplayList role="player" token="player" onOpen={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByText(`Encounter · ${dateOnly(ENDED)}`)).toBeTruthy();
    expect(screen.queryByText("More")).toBeNull();
  });
});

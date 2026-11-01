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

  it("lists replays as a table, named by their encounter and day, with their turns and length", async () => {
    serve([archive(), archive({ id: 8, encounterName: null, turnCount: 3 })]);
    render(<ReplayList role="gm" token="gm" onOpen={() => {}} />, { wrapper: ToastProvider });
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent(`Goblin cave · ${dateOnly(ENDED)}`);
    expect(rows[0]).toHaveTextContent("12 min");
    // A fight with no live scene is an Encounter.
    expect(rows[1]).toHaveTextContent(`Encounter · ${dateOnly(ENDED)}`);
    expect(rows[1]).toHaveTextContent("3");
  });

  it("puts the GM's name first, and shows the chosen replay beside the table", async () => {
    const user = userEvent.setup();
    serve([archive({ name: "Ambush at the bridge" }), archive({ id: 8, turnCount: 3 })]);
    render(<ReplayList role="gm" token="gm" onOpen={() => {}} />, { wrapper: ToastProvider });
    const beside = await screen.findByRole("complementary", { name: "Ambush at the bridge" });
    expect(within(beside).getByText(`Goblin cave · ${dateOnly(ENDED)} · 1 turn · 12 min`)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: `Goblin cave · ${dateOnly(ENDED)}` }));
    expect(screen.getByRole("complementary", { name: `Goblin cave · ${dateOnly(ENDED)}` })).toHaveTextContent(
      "3 turns · 12 min"
    );
    // Players see it writes the replay's visibility.
    await user.click(screen.getByRole("switch", { name: "Show this replay to players" }));
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/v1/replays/8/visibility",
      expect.objectContaining({ body: { playerVisible: true } })
    );
  });

  it("lets the GM rename one", async () => {
    serve([archive()]);
    const user = userEvent.setup();
    render(<ReplayList role="gm" token="gm" onOpen={() => {}} />, { wrapper: ToastProvider });
    await user.click(await screen.findByLabelText("More actions for this replay"));
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const dialog = screen.getByRole("dialog", { name: "Rename the replay" });
    await user.type(within(dialog).getByLabelText("Name"), "Ambush at the bridge");
    await user.click(within(dialog).getByRole("button", { name: "Save name" }));
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/v1/replays/7/name",
      expect.objectContaining({ token: "gm", body: { name: "Ambush at the bridge" } })
    );
  });

  it("offers a player no rename and no eye", async () => {
    serve([archive({ encounterName: undefined, playerVisible: true })]);
    render(<ReplayList role="player" token="player" onOpen={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByRole("button", { name: `Encounter · ${dateOnly(ENDED)}` })).toBeTruthy();
    expect(screen.queryByLabelText("More actions for this replay")).toBeNull();
    expect(screen.queryByText("Players see it")).toBeNull();
  });
});

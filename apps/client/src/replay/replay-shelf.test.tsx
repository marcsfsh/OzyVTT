import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("../lib/api", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import { ReplayShelf } from "./ReplayShelf";

// A player's list as the server sends it: shared replays only, and never the encounter's own name.
const replay = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  archivedAt: "2026-10-17T20:30:00.000Z",
  startedAt: "2026-10-17T20:18:00.000Z",
  endedAt: "2026-10-17T20:30:00.000Z",
  turnCount: 12,
  playerVisible: true,
  name: null,
  ...over
});

function serve(list: readonly unknown[]) {
  apiRequest.mockResolvedValue({ replays: list });
}

describe("a player's replay cards", () => {
  beforeEach(() => apiRequest.mockReset());

  it("shows nothing when nothing is shared", async () => {
    serve([]);
    const { container } = render(<ReplayShelf token="player" onOpen={() => {}} onAll={() => {}} />);
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a card's replay from Watch, naming it by the GM's name or as an encounter", async () => {
    serve([replay(3, { name: "Ambush at the bridge" }), replay(2)]);
    const onOpen = vi.fn();
    render(<ReplayShelf token="player" onOpen={onOpen} onAll={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Replays · 2" })).toBeTruthy();
    expect(screen.getByText("Ambush at the bridge")).toBeTruthy();
    expect(screen.getByText(/^Encounter · /, { selector: "b" })).toBeTruthy();
    expect(screen.getAllByText("12 turns")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Watch Ambush at the bridge" }));
    expect(onOpen).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("button", { name: /All replays/ })).toBeNull();
  });

  it("shows four cards and All replays past them", async () => {
    serve([1, 2, 3, 4, 5].map((id) => replay(id)));
    const onAll = vi.fn();
    render(<ReplayShelf token="player" onOpen={() => {}} onAll={onAll} />);
    fireEvent.click(await screen.findByRole("button", { name: "All replays · 5" }));
    expect(onAll).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /^Watch/ })).toHaveLength(4);
  });
});

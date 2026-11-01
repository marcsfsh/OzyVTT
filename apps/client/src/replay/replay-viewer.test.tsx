import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GameStateSchema } from "@vtt/domain";

const apiRequest = vi.fn();
vi.mock("../lib/api", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import { ToastProvider } from "@vtt/ui";
import { ReplayViewer } from "./ReplayViewer";
import { dateOnly } from "./replays";

// The viewer's header names the replay the way the list does: the GM's name for it, else its scene and day.

const ENDED = "2026-10-17T20:30:00.000Z";
const STARTED = "2026-10-17T20:18:00.000Z";
const summary = (over: Record<string, unknown> = {}) => ({
  id: 7,
  archivedAt: ENDED,
  startedAt: STARTED,
  endedAt: ENDED,
  turnCount: 1,
  playerVisible: true,
  name: null,
  encounterName: "Goblin cave",
  ...over
});
const gmDocument = {
  archiveSchemaVersion: 1,
  startedAt: STARTED,
  endedAt: ENDED,
  turnCount: 1,
  turns: [
    {
      index: 0,
      kind: "turn",
      label: "Round 1",
      revision: 1,
      at: STARTED,
      state: GameStateSchema.parse({ schemaVersion: 1 })
    }
  ],
  log: []
};
const playerDocument = {
  id: 7,
  startedAt: STARTED,
  endedAt: ENDED,
  turnCount: 1,
  attribution: null,
  turns: [
    {
      index: 0,
      at: STARTED,
      label: "Round 1",
      combat: { mapAssetId: null, tokens: [], initiative: [], turnActorId: null },
      actors: [],
      log: []
    }
  ]
};

function serve(list: readonly unknown[], document: unknown) {
  apiRequest.mockImplementation(async (path: string) =>
    path === "/api/v1/replays" ? { replays: list } : { document }
  );
}

describe("the replay viewer's header", () => {
  beforeEach(() => apiRequest.mockReset());

  it("names the replay by its encounter and day for the GM", async () => {
    serve([summary()], gmDocument);
    render(<ReplayViewer role="gm" token="gm" archiveId={7} onBack={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByRole("heading", { name: `Goblin cave · ${dateOnly(ENDED)}` })).toBeTruthy();
  });

  it("names it by the GM's name for a player", async () => {
    // A player's list carries the GM's name and never the scene.
    serve([summary({ name: "Ambush at the bridge", encounterName: undefined })], playerDocument);
    render(<ReplayViewer role="player" token="player" archiveId={7} onBack={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByRole("heading", { name: "Ambush at the bridge" })).toBeTruthy();
  });

  it("lists the whole fight beside the map, the turn on screen lit, and goes to a turn when pressed", async () => {
    const twoTurns = {
      ...gmDocument,
      turnCount: 2,
      turns: [gmDocument.turns[0], { ...gmDocument.turns[0], index: 1, label: "Round 2", revision: 2 }]
    };
    serve([summary()], twoTurns);
    render(<ReplayViewer role="gm" token="gm" archiveId={7} onBack={() => {}} />, { wrapper: ToastProvider });
    const first = await screen.findByRole("button", { name: /^Round 1/ });
    expect(first).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: /^Round 2/ }));
    expect(screen.getByRole("button", { name: /^Round 2/ })).toHaveAttribute("aria-current", "step");
  });

  it("goes to a turn pressed on the line, and counts it", async () => {
    const turns = [0, 1, 2].map((index) => ({
      ...gmDocument.turns[0],
      index,
      label: `Turn ${index + 1}`,
      revision: index + 1
    }));
    serve([summary()], { ...gmDocument, turnCount: 3, turns });
    render(<ReplayViewer role="gm" token="gm" archiveId={7} onBack={() => {}} />, { wrapper: ToastProvider });
    const line = await screen.findByRole("slider", { name: "Turn position" });
    expect(line).toHaveAttribute("aria-valuetext", "Turn 01 of 3");
    line.getBoundingClientRect = () => ({
      left: 0,
      width: 200,
      top: 0,
      height: 44,
      right: 200,
      bottom: 44,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    fireEvent.pointerDown(line, { clientX: 190, pointerId: 1 });
    expect(line).toHaveAttribute("aria-valuetext", "Turn 03 of 3");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  sceneName: "Goblin cave",
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
    path === "/api/v1/encounters" ? { encounters: list } : { document }
  );
}

describe("the replay viewer's header", () => {
  beforeEach(() => apiRequest.mockReset());

  it("names the replay by its scene and day for the GM", async () => {
    serve([summary()], gmDocument);
    render(<ReplayViewer role="gm" token="gm" archiveId={7} onBack={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByRole("heading", { name: `Goblin cave · ${dateOnly(ENDED)}` })).toBeTruthy();
  });

  it("names it by the GM's name for a player", async () => {
    // A player's list carries the GM's name and never the scene.
    serve([summary({ name: "Ambush at the bridge", sceneName: undefined })], playerDocument);
    render(<ReplayViewer role="player" token="player" archiveId={7} onBack={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByRole("heading", { name: "Ambush at the bridge" })).toBeTruthy();
  });
});

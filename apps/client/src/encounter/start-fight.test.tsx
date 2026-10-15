import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameStateSchema, type GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { EncounterPanel } from "./EncounterPanel";

const ARIA = "10000000-0000-4000-8000-000000000001";
const BORIN = "10000000-0000-4000-8000-000000000002";
const MAP = "20000000-0000-4000-8000-000000000001";

const stateWith = (combat: Record<string, unknown>, revision: number): GmView => {
  const actor = (id: string, name: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 40, maximum: 40 }
  });
  return GameStateSchema.parse({
    schemaVersion: 1,
    revision,
    actors: [actor(ARIA, "Aria"), actor(BORIN, "Borin")],
    combat: { mapAssetId: MAP, ...combat }
  }) as unknown as GmView;
};

describe("starting a second fight", () => {
  it("rolls everyone again instead of reusing the last fight's order", async () => {
    const user = userEvent.setup();
    const fighting = stateWith(
      {
        active: true,
        round: 3,
        turnActorId: ARIA,
        initiative: [
          { actorId: ARIA, score: 17 },
          { actorId: BORIN, score: 11 }
        ]
      },
      12
    );
    const panel = (state: GmView) => (
      <ToastProvider>
        <EncounterPanel role="gm" state={state} selectedMap={null} />
      </ToastProvider>
    );
    const { rerender } = render(panel(fighting));
    rerender(panel(stateWith({ active: false }, 13)));

    await user.click(screen.getByRole("button", { name: /Start the fight/ }));
    const calls = (socket.emit as unknown as { mock: { calls: [string, { entries?: unknown[] }][] } }).mock.calls;
    const start = calls.find(([event]) => event === "encounter:start");
    expect(start?.[1].entries).toEqual([{ actorId: ARIA }, { actorId: BORIN }]);
  });
});

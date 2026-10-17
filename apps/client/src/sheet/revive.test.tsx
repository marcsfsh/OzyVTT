import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmActor, PlayerActor } from "@vtt/domain";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { ActorReviveSchema } from "@vtt/domain/commands";
import { HpControls } from "./HitPoints";
import { GmTools } from "./GmTools";

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;

const DEAD = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Bryn",
  kind: "player-character",
  visibility: "public",
  hp: { current: 0, maximum: 24, temporary: 0 },
  deathSaves: { successes: 1, failures: 3, stable: false },
  conditions: [{ id: "unconscious" }, { id: "prone" }],
  effects: []
};

// SRD "Dead": nothing but a revival brings a dead creature back, so its sheet offers only that, to the GM.
describe("a dead character's hit points", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offer the GM a Revive in the GM tools with the hit points typed, and nothing that would heal", async () => {
    const user = userEvent.setup();
    render(
      <>
        <HpControls actor={DEAD as unknown as GmActor} role="gm" onFeedback={() => {}} />
        <GmTools actor={DEAD as unknown as GmActor} state={undefined} onFeedback={() => {}} />
      </>
    );
    expect(screen.getByText("Dead. Revive Bryn from the GM tools.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Heal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set HP" })).toBeNull();
    await user.type(screen.getByLabelText("Amount"), "1");
    await user.click(screen.getByRole("button", { name: "Revive" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("actor:revive");
    expect(ActorReviveSchema.parse({ ...payload, commandId: "10000000-0000-4000-8000-0000000000aa" })).toMatchObject({
      actorId: DEAD.id,
      hitPoints: 1
    });
  });

  it("tell the player why there is nothing to do", () => {
    const mine = { ...DEAD, hp: { kind: "exact", current: 0, maximum: 24, temporary: 0 }, claimStatus: "mine" };
    render(<HpControls actor={mine as unknown as PlayerActor} role="player" onFeedback={() => {}} />);
    expect(screen.getByText("Dead. Ask the GM: only a revival brings Bryn back.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Heal" })).toBeNull();
    expect(screen.queryByLabelText("Amount")).toBeNull();
  });
});

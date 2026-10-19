import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { ActorNourishSchema } from "@vtt/domain/commands";
import { socket } from "../socket";
import { FoodAndWater } from "./FoodAndWater";
import type { SheetActor } from "./sheet-model";

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const COMMAND = { commandId: "10000000-0000-4000-8000-0000000000aa" };

describe("the sheet's food and water", () => {
  it("eats a carried Bead of Nourishment as a day's food", async () => {
    (socket.emit as unknown as { mockImplementation: (run: (...args: EmitCall) => void) => void }).mockImplementation(
      (_event, _payload, ack) => ack({ ok: true, revision: 1 })
    );
    const actor = {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Aria",
      kind: "player-character",
      nourishment: { foodPounds: 0, waterPints: 8, daysUnfed: 0, hungerLevels: 0, thirstLevels: 0 },
      inventory: [{ id: "bead-of-nourishment", name: "Bead of Nourishment", quantity: 2 }]
    } as unknown as SheetActor;
    const feedback = vi.fn();
    render(<FoodAndWater actor={actor} role="player" onFeedback={feedback} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Eat a Bead of Nourishment (2)" }));
    const [event, payload] = (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls.at(-1)!;
    expect(event).toBe("actor:nourish");
    expect(ActorNourishSchema.parse({ ...payload, ...COMMAND })).toMatchObject({ actorId: actor.id, food: "bead" });
    expect(feedback).toHaveBeenCalledWith("Ate a Bead of Nourishment.");
  });
});

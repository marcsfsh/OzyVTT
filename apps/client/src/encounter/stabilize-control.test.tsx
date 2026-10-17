import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { socket } from "../socket";
import { ActorStabilizeSchema } from "@vtt/domain/commands";
import { aidGiverOf, StabilizeControl, stabilizeRefusal, type AidGiver } from "./StabilizeControl";

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const TARGET = "10000000-0000-4000-8000-000000000002";
const ILSE: AidGiver = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Ilse",
  hasKit: true,
  knowsSpareTheDying: true
};
const valid = (payload: Record<string, unknown>) =>
  ActorStabilizeSchema.parse({ ...payload, commandId: "10000000-0000-4000-8000-0000000000aa" });

// SRD Stabilizing a Character: first aid, a Healer's Kit or Spare the Dying, chosen by whoever gives the aid.
describe("the stabilize buttons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("send the player's own character as the helper, with the method they tapped", async () => {
    const user = userEvent.setup();
    render(<StabilizeControl targetId={TARGET} targetName="Bryn" helpers={[ILSE]} gm={false} onFeedback={() => {}} />);
    expect(screen.queryByRole("button", { name: "Mark stable" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Healer's Kit" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("actor:stabilize");
    expect(valid(payload)).toMatchObject({ actorId: TARGET, method: "healers-kit", helperId: ILSE.id });
  });

  it("offer only what the helper has: first aid always, a kit or the cantrip when carried or known", () => {
    const bare: AidGiver = { ...ILSE, hasKit: false, knowsSpareTheDying: false };
    render(<StabilizeControl targetId={TARGET} targetName="Bryn" helpers={[bare]} gm={false} onFeedback={() => {}} />);
    expect(screen.getByRole("button", { name: "First aid" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Healer's Kit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Spare the Dying" })).toBeNull();
  });

  it("let the GM rule it stable, with no helper on the wire", async () => {
    const user = userEvent.setup();
    render(<StabilizeControl targetId={TARGET} targetName="Bryn" helpers={[]} gm onFeedback={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Mark stable" }));
    const [, payload] = emitted().at(-1)!;
    expect(valid(payload)).toEqual(expect.objectContaining({ actorId: TARGET, method: "gm" }));
    expect("helperId" in payload).toBe(false);
  });

  it("count a second carried kit, read by the record it copies", () => {
    const carrying = (inventory: ReadonlyArray<{ id: string; recordId?: string; quantity: number }>) =>
      aidGiverOf({ id: ILSE.id, name: "Ilse", inventory }, null).hasKit;
    expect(carrying([{ id: "healers-kit-2", recordId: "healers-kit", quantity: 1 }])).toBe(true);
    expect(carrying([{ id: "healers-kit", quantity: 0 }])).toBe(false);
  });

  it("report only a refusal, leaving the aid given to the table feed", () => {
    expect(
      stabilizeRefusal({
        ok: true,
        stabilize: { stabilized: false, woke: false, check: { natural: 2, total: 6, dc: 10 } }
      })
    ).toBeNull();
    expect(stabilizeRefusal({ ok: false, message: "Bryn is 10 ft away - first aid needs Ilse beside them." })).toBe(
      "Bryn is 10 ft away - first aid needs Ilse beside them."
    );
  });
});

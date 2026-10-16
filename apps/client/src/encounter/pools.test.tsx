import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import type { ContentActionSummary } from "@vtt/domain";
import { ActionResolveSchema, ActorRestoreUsesSchema, ActorSpendUsesSchema } from "@vtt/domain/commands";
import { ToastProvider } from "@vtt/ui";
import { socket } from "../socket";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { SheetPools } from "./SheetPools";
import { beginTargeting, clearTargeting, resolveTargeting, toggleTarget, useTargeting } from "./targeting";

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const COMMAND = { commandId: "10000000-0000-4000-8000-0000000000aa" };
const PALADIN = "60000000-0000-4000-8000-000000000001";
const ALLY = "60000000-0000-4000-8000-000000000002";

const action = (fields: Partial<ContentActionSummary>): ContentActionSummary => ({
  id: "lay-on-hands",
  name: "Lay on Hands",
  activation: "bonus-action",
  description: "Touch a creature and restore Hit Points from the pool.",
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [],
  area: null,
  attackCount: null,
  usesLimit: 25,
  usesPer: "long-rest",
  usesRecharge: null,
  usesPool: "lay-on-hands",
  requiresEffectTag: null,
  multiattack: null,
  grants: false,
  reaction: null,
  ...fields
});
const HEAL = action({ useCost: "chosen", targeting: "single" });
const CURE = action({ id: "lay-on-hands-cure-poison", name: "Lay on Hands: Cure Poison", useCost: 5 });

// SRD Lay on Hands: "restore a number of Hit Points to that creature, up to the maximum amount remaining in the pool".
describe("a pool spent by any amount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTargeting();
  });

  it("lists what is left of each pool once, and the player spends several at once", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <SheetPools actorId={PALADIN} role="player" actions={[HEAL, CURE]} spent={{ "lay-on-hands": 7 }} />
      </ToastProvider>
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Lay on Hands")).toBeTruthy();
    expect(within(row).getByText("18/25 · long rest")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Give back" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Increase" }));
    await user.click(within(row).getByRole("button", { name: "Increase" }));
    await user.click(within(row).getByRole("button", { name: "Spend" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("actor:spend-uses");
    expect(ActorSpendUsesSchema.parse({ ...payload, ...COMMAND })).toMatchObject({
      actorId: PALADIN,
      poolId: "lay-on-hands",
      amount: 3
    });
  });

  it("lets the GM give uses back", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <SheetPools actorId={PALADIN} role="gm" actions={[HEAL]} spent={{ "lay-on-hands": 7 }} />
      </ToastProvider>
    );
    await user.click(screen.getByRole("button", { name: "Give back" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("actor:restore-uses");
    expect(ActorRestoreUsesSchema.parse({ ...payload, ...COMMAND })).toMatchObject({
      poolId: "lay-on-hands",
      amount: 1
    });
  });

  it("asks how many points Lay on Hands spends, and sends them with the resolve", async () => {
    const user = userEvent.setup();
    act(() => beginTargeting(HEAL, PALADIN));
    function Picker() {
      const session = useTargeting();
      return session ? (
        <ActionTargetPicker
          picking={session}
          targets={[{ id: ALLY, label: "Bryn" }]}
          busy={false}
          onRoll={() => resolveTargeting(undefined, () => {})}
        />
      ) : null;
    }
    render(<Picker />);
    const spend = screen.getByRole("group", { name: "How much of Lay on Hands to spend" });
    for (let step = 0; step < 6; step += 1) await user.click(within(spend).getByRole("button", { name: "Increase" }));
    act(() => toggleTarget(ALLY));
    await user.click(screen.getByRole("button", { name: "Roll Lay on Hands" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("action:resolve");
    expect(ActionResolveSchema.parse({ ...payload, ...COMMAND })).toMatchObject({
      actionId: "lay-on-hands",
      targetIds: [ALLY],
      spend: 7
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => {
  // Every command is answered at once, so one test's resolve leaves nothing busy for the next.
  const emit = vi.fn((_event: string, _payload: unknown, ack: (reply: unknown) => void) =>
    ack({ ok: false, message: "Not resolved in this test." })
  );
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import type { ContentActionSummary } from "@vtt/domain";
import { ActionResolveSchema } from "@vtt/domain/commands";
import { socket } from "../socket";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { beginTargeting, clearTargeting, resolveTargeting, toggleTarget, useTargeting } from "./targeting";

// SRD 5.2.1 Restoring Touch: "you can also remove one or more of the following conditions", 5 points of the pool each;
// and Preserve Life: "divide those Hit Points among them". Both are picked in the target picker, at phone size too.

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const COMMAND = { commandId: "10000000-0000-4000-8000-0000000000aa" };
const USER = "60000000-0000-4000-8000-000000000001";
const BRYN = "60000000-0000-4000-8000-000000000002";
const CATO = "60000000-0000-4000-8000-000000000003";

const action = (fields: Partial<ContentActionSummary>): ContentActionSummary => ({
  id: "lay-on-hands-restoring-touch",
  name: "Lay on Hands: Restoring Touch",
  activation: "bonus-action",
  description: "Touch a creature, restore Hit Points and end conditions.",
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [],
  area: null,
  attackCount: null,
  usesLimit: 70,
  usesPer: "long-rest",
  usesRecharge: null,
  usesPool: "lay-on-hands",
  requiresEffectTag: null,
  multiattack: null,
  grants: false,
  reaction: null,
  ...fields
});

function Picker({ targets }: Readonly<{ targets: ReadonlyArray<{ id: string; label: string }> }>) {
  const session = useTargeting();
  return session ? (
    <ActionTargetPicker
      picking={session}
      targets={targets}
      busy={false}
      onRoll={() => resolveTargeting(undefined, () => {})}
    />
  ) : null;
}

const lastResolve = () => {
  const [event, payload] = emitted().at(-1)!;
  expect(event).toBe("action:resolve");
  return ActionResolveSchema.parse({ ...payload, ...COMMAND });
};

describe("picks a heal or a cure asks for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTargeting();
  });

  it("picks the conditions Restoring Touch also ends, with no Hit Points restored", async () => {
    const user = userEvent.setup();
    const touch = action({
      useCost: "chosen",
      targeting: "single",
      conditionPicks: { conditions: ["blinded", "stunned"], pointsEach: 5 }
    });
    act(() => beginTargeting(touch, USER));
    render(<Picker targets={[{ id: BRYN, label: "Bryn" }]} />);
    const restore = screen.getByRole("group", { name: "How much of Lay on Hands: Restoring Touch to spend" });
    await user.click(within(restore).getByRole("button", { name: "Decrease" }));
    act(() => toggleTarget(BRYN));
    const roll = () => screen.getByRole("button", { name: "Roll Lay on Hands: Restoring Touch" }) as HTMLButtonElement;
    // Nothing picked spends nothing.
    expect(roll().disabled).toBe(true);
    const picks = screen.getByRole("group", { name: "Also end · 5 points each" });
    await user.click(within(picks).getByRole("checkbox", { name: "Blinded" }));
    await user.click(within(picks).getByRole("checkbox", { name: "Stunned" }));
    await user.click(roll());
    expect(lastResolve()).toMatchObject({
      actionId: "lay-on-hands-restoring-touch",
      spend: 0,
      conditionIds: ["blinded", "stunned"]
    });
  });

  it("divides Preserve Life's pool as the player sets it", async () => {
    const user = userEvent.setup();
    const preserve = action({
      id: "preserve-life",
      name: "Channel Divinity: Preserve Life",
      activation: "action",
      targeting: "multi",
      dividesHealing: 25
    });
    act(() => beginTargeting(preserve, USER));
    render(
      <Picker
        targets={[
          { id: BRYN, label: "Bryn" },
          { id: CATO, label: "Cato" }
        ]}
      />
    );
    act(() => toggleTarget(BRYN));
    act(() => toggleTarget(CATO));
    const bryn = screen.getByRole("group", { name: "Hit Points for Bryn" });
    for (let step = 0; step < 3; step += 1) await user.click(within(bryn).getByRole("button", { name: "Increase" }));
    const cato = screen.getByRole("group", { name: "Hit Points for Cato" });
    for (let step = 0; step < 2; step += 1) await user.click(within(cato).getByRole("button", { name: "Increase" }));
    expect(screen.getByText(/25 Hit Points to divide: 20 left/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Roll Channel Divinity: Preserve Life" }));
    expect(lastResolve()).toMatchObject({ actionId: "preserve-life", healingShares: { [BRYN]: 3, [CATO]: 2 } });
  });
});

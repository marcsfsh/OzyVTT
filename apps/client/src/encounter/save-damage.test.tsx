import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingSave } from "@vtt/domain";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; it is routed to
// `socket.emit` here so the assertions read one call list.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { SavePrompt } from "./SavePrompt";

/**
 * The save prompt's damage field reaches the wire through the shared payload builder. The hit-point
 * outcome is tested in `save-damage.mirror.test.ts`.
 */

const SAVE: PendingSave = {
  id: "60000000-0000-4000-8000-000000000001",
  targetActorId: "10000000-0000-4000-8000-000000000002",
  ability: "dex",
  dc: 15,
  sourceActorId: "10000000-0000-4000-8000-000000000001",
  sourceName: "Dragon",
  actionName: "Fire Breath",
  proposedDamage: 17,
  proposedDamageParts: [{ amount: 17, type: "fire" }],
  halfOnSuccess: true,
  conditionIds: [],
  saveBonus: 0,
  createdAt: 0
};

/**
 * The same 17 split across two damage types. The server floors the success halving per part, so an
 * amended 12 lands as 3 + 2 = 5 rather than `floor(12 / 2)` = 6, which proves the prompt prints the
 * server's number. The mirror test runs this save through the real `answerSave`.
 */
const TWO_TYPE: PendingSave = {
  ...SAVE,
  proposedDamageParts: [
    { amount: 9, type: "fire" },
    { amount: 8, type: "cold" }
  ]
};

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const lastAnswer = () =>
  emitted()
    .filter(([event]) => event === "save:answer")
    .at(-1)![1];

/** What the prompt handed its parent: how a refusal reaches the answerer. */
const feedback: string[] = [];

/**
 * The prompt in the roll mode under test; manual mode never auto-rolls. Wrapped in `<StrictMode>`
 * like the app (`main.tsx`): its mount → cleanup → mount once left the recheck's mounted flag
 * cleared, swallowing every recheck ack.
 */
const mount = (save: PendingSave, rollMode: "auto" | "manual" = "manual") =>
  render(
    <StrictMode>
      <SavePrompt
        save={save}
        targetName="Borin"
        canDismiss={false}
        onFeedback={(text) => {
          feedback.push(text);
        }}
        rollMode={rollMode}
      />
    </StrictMode>
  );

/** Comfortably longer than the prompt's `RECHECK_AMEND_MS` debounce. */
const RECHECK_WAIT_MS = 600;

const answers = () => emitted().filter(([event]) => event === "save:answer");
/** Answers the newest `save:answer` as the server would: an uncommitted projection. */
const ack = (
  outcome: Readonly<{ total: number; success: boolean; appliedDamage: number; conditionApplied?: boolean }>
) => {
  const [, , acknowledge] = answers().at(-1)!;
  acknowledge({ ok: true, outcome: { dc: 15, conditionApplied: false, committed: false, ...outcome } });
};
/**
 * Waits for the debounced recheck by count rather than shape: the mount roll is itself an
 * uncommitted `save:answer`, so "the last one has commit: false" would already be true.
 */
const nextAnswer = async (before: number) => {
  await waitFor(() => expect(answers().length, "no further save:answer was sent").toBe(before + 1));
  return answers().at(-1)![1];
};

describe("the save prompt's damage field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feedback.length = 0;
  });

  it("asks for the damage in manual mode, offering the rolled number as the fallback", () => {
    mount(SAVE);
    const field = screen.getByLabelText(/Damage on a failure/) as HTMLInputElement;
    // Empty in manual mode, with the rolled 17 as the placeholder; leaving it alone applies the roll.
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("17");
    // The label names the halving rule, because the field holds the pre-halving number.
    expect(field).toHaveAccessibleName("Damage on a failure, half on a success");
  });

  it("pre-fills the rolled number in auto mode, to be amended", () => {
    mount(SAVE, "auto");
    expect((screen.getByLabelText(/Damage on a failure/) as HTMLInputElement).value).toBe("17");
  });

  it("shows no damage field on a save that deals none", () => {
    // Grapple and Shove mint saves with a proposal of 0; there is nothing to amend.
    mount({ ...SAVE, proposedDamage: 0, proposedDamageParts: undefined, halfOnSuccess: false });
    expect(screen.queryByLabelText(/Damage on a failure/)).toBeNull();
  });

  it("carries the typed damage on the answer as a pre-halving override", async () => {
    const user = userEvent.setup();
    mount(SAVE);
    await user.type(screen.getByLabelText(/Damage on a failure/), "12");
    await user.type(screen.getByLabelText("Rolled save total"), "18");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastAnswer()).toMatchObject({
      saveId: SAVE.id,
      method: "manual",
      total: 18,
      commit: true,
      damageOverride: 12
    });
  });

  it("sends no damage field when the answerer leaves the number alone", async () => {
    const user = userEvent.setup();
    mount(SAVE);
    await user.type(screen.getByLabelText("Rolled save total"), "18");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect("damageOverride" in lastAnswer()).toBe(false);
  });

  it("re-asks the server what an amend applies, and prints THAT number", async () => {
    const user = userEvent.setup();
    // Auto mode rolls on mount; answer that preview as the server would, with the post-halving 8.
    mount(TWO_TYPE, "auto");
    ack({ total: 18, success: true, appliedDamage: 8 });
    expect(await screen.findByText("8 dmg")).toBeTruthy();

    // Amend the proposal: 8 is now stale, and 12 is pre-halving, so the prompt shows only what was
    // typed until the server answers again.
    await user.clear(screen.getByLabelText(/Damage on a failure/));
    await user.type(screen.getByLabelText(/Damage on a failure/), "12");
    expect(screen.queryByText("8 dmg")).toBeNull();
    expect(screen.getByText("Amended to 12 - checking")).toBeTruthy();

    // The recheck is Confirm's payload with `commit: false`: nothing is rolled or applied.
    expect(await nextAnswer(1)).toMatchObject({
      saveId: SAVE.id,
      method: "manual",
      total: 18,
      commit: false,
      damageOverride: 12
    });

    // 5 is the server's answer for this save (see the mirror test). Neither 12 nor any halving of it
    // is 5, so the line must be showing the server's number.
    ack({ total: 18, success: true, appliedDamage: 5 });
    expect(await screen.findByText("5 dmg (amended - rolled 17)")).toBeTruthy();
    expect(screen.queryByText(/^12 dmg/)).toBeNull();
    expect(screen.queryByText(/^6 dmg/)).toBeNull();

    // Confirm still sends the pre-halving 12; the server does the halving and resistances.
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(lastAnswer()).toMatchObject({ method: "manual", total: 18, commit: true, damageOverride: 12 });
  });

  it("says 'no damage' when the amend lands as none - a success on a save that does not halve", async () => {
    // `halfOnSuccess: false` + success: the server applies 0, and only the server says so.
    const user = userEvent.setup();
    mount({ ...SAVE, halfOnSuccess: false }, "auto");
    ack({ total: 18, success: true, appliedDamage: 0 });
    expect(await screen.findByText("no damage")).toBeTruthy();

    await user.clear(screen.getByLabelText(/Damage on a failure/));
    await user.type(screen.getByLabelText(/Damage on a failure/), "12");
    expect(await nextAnswer(1)).toMatchObject({ commit: false, damageOverride: 12 });
    ack({ total: 18, success: true, appliedDamage: 0 });
    expect(await screen.findByText("no damage (amended - rolled 17)")).toBeTruthy();
  });

  it("stops checking and stops claiming when the server refuses the recheck", async () => {
    const user = userEvent.setup();
    mount(SAVE, "auto");
    ack({ total: 18, success: true, appliedDamage: 8 });
    expect(await screen.findByText("8 dmg")).toBeTruthy();

    await user.clear(screen.getByLabelText(/Damage on a failure/));
    await user.type(screen.getByLabelText(/Damage on a failure/), "9999");
    expect(await nextAnswer(1)).toMatchObject({ commit: false, damageOverride: 9999 });
    const [, , refuse] = answers().at(-1)!;
    refuse({ ok: false, message: "Enter the damage as a whole number from 0 to 1000." });

    // No outcome and no loop: the line shows the typed number, and the refusal reaches the answerer
    // through the parent's feedback channel.
    expect(await screen.findByText("Amended to 9999")).toBeTruthy();
    expect(feedback.at(-1)).toBe("Enter the damage as a whole number from 0 to 1000.");
    const sends = answers().length;
    await new Promise((resolve) => setTimeout(resolve, RECHECK_WAIT_MS));
    expect(answers().length, "the refused recheck retried").toBe(sends);
  });
});

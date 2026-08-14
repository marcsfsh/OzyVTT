import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingSave } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));

import { socket } from "../socket";
import { SavePrompt } from "./EncounterPanel";

/**
 * ISSUE `4b`'s CLIENT HALF, at the surface: the save prompt now has a damage field, and what the
 * answerer types into it reaches the wire.
 *
 * The far end - that the emitted number comes off hit points, keeps its damage type, and is halved
 * once rather than twice - is `save-damage.mirror.test.ts`, which drives the same payload builder
 * into the server's own `answerSave`. This file is the other half of that join: it proves the
 * COMPONENT calls the builder, so the mirror test is testing the app rather than a module the app
 * happens to ship beside.
 */

const SAVE: PendingSave = {
  id: "60000000-0000-4000-8000-000000000001",
  targetActorId: "10000000-0000-4000-8000-000000000002",
  ability: "dex", dc: 15,
  sourceActorId: "10000000-0000-4000-8000-000000000001",
  sourceName: "Dragon", actionName: "Fire Breath",
  proposedDamage: 17, proposedDamageParts: [{ amount: 17, type: "fire" }],
  halfOnSuccess: true, conditionId: null, saveBonus: 0, createdAt: 0
};

/**
 * The same 17, split across two damage types. The server re-weights an amend across the parts and
 * floors the success halving PER PART, so an amended 12 lands as 3 + 2 = **5** where `floor(12 / 2)`
 * is 6 - the gap that makes "the prompt prints the server's number" a claim a test can hold.
 * `save-damage.mirror.test.ts` runs this exact save through the real `answerSave` for the 5.
 */
const TWO_TYPE: PendingSave = { ...SAVE, proposedDamageParts: [{ amount: 9, type: "fire" }, { amount: 8, type: "cold" }] };

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const lastAnswer = () => emitted().filter(([event]) => event === "save:answer").at(-1)![1];

/** What the prompt handed its parent - the channel a refusal reaches the answerer through. */
const feedback: string[] = [];

/**
 * The prompt, in the roll mode under test. Manual mode never auto-rolls, so nothing is emitted on
 * mount.
 *
 * UNDER `<StrictMode>`, because the app is (`main.tsx`). Its mount → cleanup → mount is not a
 * formality here: the recheck's "am I still mounted?" ref was cleared by that simulated unmount and
 * never re-armed, which swallowed every recheck ack in a real browser while every test here passed.
 * Found at 375px in Chromium 2026-08-10; this is the shape of it jsdom CAN hold.
 */
const mount = (save: PendingSave, rollMode: "auto" | "manual" = "manual") =>
  render(<StrictMode><SavePrompt save={save} targetName="Borin" canDismiss={false} onFeedback={(text) => { feedback.push(text); }} rollMode={rollMode} /></StrictMode>);

/** Comfortably longer than the prompt's own `RECHECK_AMEND_MS` debounce. */
const RECHECK_WAIT_MS = 600;

const answers = () => emitted().filter(([event]) => event === "save:answer");
/** Answer the newest `save:answer` as the SERVER would - an uncommitted projection. */
const ack = (outcome: Readonly<{ total: number; success: boolean; appliedDamage: number; conditionApplied?: boolean }>) => {
  const [, , acknowledge] = answers().at(-1)!;
  acknowledge({ ok: true, outcome: { dc: 15, conditionApplied: false, committed: false, ...outcome } });
};
/**
 * Wait for the debounced recheck the amend schedules, by COUNT rather than by shape - the mount roll
 * is itself an uncommitted `save:answer`, so "the last one has commit: false" is satisfied before
 * the recheck exists and would let every assertion below run against the wrong call.
 */
const nextAnswer = async (before: number) => {
  await waitFor(() => expect(answers().length, "no further save:answer was sent").toBe(before + 1));
  return answers().at(-1)![1];
};

describe("the save prompt's damage field", () => {
  beforeEach(() => { vi.clearAllMocks(); feedback.length = 0; });

  it("asks for the damage in manual mode, offering the rolled number as the fallback", () => {
    mount(SAVE);
    const field = screen.getByLabelText(/Damage on a failure/) as HTMLInputElement;
    // Empty, not pre-filled: a table rolling physical dice is ASKED for its number. The auto-rolled
    // 17 is the placeholder, so leaving it alone still applies what the engine rolled.
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("17");
    // The half-on-success rule is named, because the field holds the PRE-halving number.
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
    expect(lastAnswer()).toMatchObject({ saveId: SAVE.id, method: "manual", total: 18, commit: true, damageOverride: 12 });
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
    // Auto mode rolls on mount; answer that preview as the server would, with the POST-halving 8.
    mount(TWO_TYPE, "auto");
    ack({ total: 18, success: true, appliedDamage: 8 });
    expect(await screen.findByText("8 dmg")).toBeTruthy();

    // Amend the proposal underneath it. 8 was computed from 17 and is now a lie - and so is 12,
    // which is the PRE-halving proposal: the server applies `floor(12 / 2)`. The prompt says only
    // what it typed until the server answers again.
    await user.clear(screen.getByLabelText(/Damage on a failure/));
    await user.type(screen.getByLabelText(/Damage on a failure/), "12");
    expect(screen.queryByText("8 dmg")).toBeNull();
    expect(screen.getByText("Amended to 12 - checking")).toBeTruthy();

    // The recheck is Confirm's payload with the commit taken off - nothing is rolled or applied.
    expect(await nextAnswer(1)).toMatchObject({ saveId: SAVE.id, method: "manual", total: 18, commit: false, damageOverride: 12 });

    // THE FAR END: 5 is the server's own answer for this save (`save-damage.mirror.test.ts` runs the
    // same recheck through the real `answerSave` and gets 5 - 9 fire + 8 cold re-weighted to 7 + 5
    // and floored per part), and 5 is what the row now reads. `floor(12 / 2)` is 6 and the field
    // holds 12, so neither the typed number nor any halving of it can be what is on screen.
    ack({ total: 18, success: true, appliedDamage: 5 });
    expect(await screen.findByText("5 dmg (amended - rolled 17)")).toBeTruthy();
    expect(screen.queryByText(/^12 dmg/)).toBeNull();
    expect(screen.queryByText(/^6 dmg/)).toBeNull();

    // Confirm still sends the pre-halving 12; the server does the halving and the resistances.
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(lastAnswer()).toMatchObject({ method: "manual", total: 18, commit: true, damageOverride: 12 });
  });

  it("says 'no damage' when the amend lands as none - a success on a save that does not halve", async () => {
    // `halfOnSuccess: false` + success is the case the old line got most wrong: it printed the typed
    // number where the server applies ZERO. Nothing here computes that; the server says so.
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

    // No outcome to show and no loop: the line names the typed number and nothing else, and the
    // refusal itself reaches the answerer through the parent's feedback channel.
    expect(await screen.findByText("Amended to 9999")).toBeTruthy();
    expect(feedback.at(-1)).toBe("Enter the damage as a whole number from 0 to 1000.");
    const sends = answers().length;
    await new Promise((resolve) => setTimeout(resolve, RECHECK_WAIT_MS));
    expect(answers().length, "the refused recheck retried").toBe(sends);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;
const lastAnswer = () => emitted().filter(([event]) => event === "save:answer").at(-1)![1];

/** The prompt, in the roll mode under test. Manual mode never auto-rolls, so nothing is emitted on mount. */
const mount = (save: PendingSave, rollMode: "auto" | "manual" = "manual") =>
  render(<SavePrompt save={save} targetName="Borin" canDismiss={false} onFeedback={() => {}} rollMode={rollMode} />);

describe("the save prompt's damage field", () => {
  beforeEach(() => { vi.clearAllMocks(); });

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

  it("stops claiming the previewed number once the damage is amended under it", async () => {
    const user = userEvent.setup();
    // Auto mode rolls on mount; answer that preview as the server would, with the POST-halving 8.
    mount(SAVE, "auto");
    const [, , acknowledge] = emitted().filter(([event]) => event === "save:answer").at(-1)!;
    acknowledge({ ok: true, outcome: { total: 18, dc: 15, success: true, appliedDamage: 8, conditionApplied: false, committed: false } });
    expect(await screen.findByText("8 dmg")).toBeTruthy();

    // Amend the proposal underneath it. 8 was computed from 17 and is now a lie; the honest line is
    // the pre-halving number, labelled - `ActionRunner`'s "(manual - rolled N)" idiom.
    await user.clear(screen.getByLabelText(/Damage on a failure/));
    await user.type(screen.getByLabelText(/Damage on a failure/), "12");
    expect(screen.queryByText("8 dmg")).toBeNull();
    expect(screen.getByText("12 dmg (amended - rolled 17)")).toBeTruthy();

    // Confirm applies the pre-halving 12; the server does the halving and the resistances.
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(lastAnswer()).toMatchObject({ method: "manual", total: 18, commit: true, damageOverride: 12 });
  });
});

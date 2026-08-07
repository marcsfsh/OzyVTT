import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentActionSummary } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

import { socket } from "../socket";
import { AskTheGmPrompt } from "./RuleAsk";
import { beginTargeting, clearTargeting, resolveTargeting, toggleTarget } from "./targeting";

/**
 * WHAT THIS PINS, and why it is a test rather than a comment.
 *
 * Ask-the-GM was driven end to end for the first time on 2026-08-05, and the drive found that a
 * single-target ATTACK could never be allowed. The runner sends an attack as a PREVIEW
 * (`commit: false`), which the server defines as "the attack roll only - no damage/riders/economy",
 * and the blocked payload was parked verbatim. So the GM's Allow replayed a preview on the GM's own
 * socket: a d20 landed in the log, no damage applied, neither side was told, and the player's next
 * attempt was refused identically - a loop with no way out. A save or template action was already
 * sent committing, which is exactly why those worked and attacks did not.
 *
 * The fix is one expression in `targeting.ts`: the parked command always commits. These two tests
 * are the memory of it - the first that the runner still previews (so the fix did not change what a
 * player rolls), the second that what gets PARKED commits.
 */

const ATTACK: ContentActionSummary = {
  id: "dagger", name: "Dagger", activation: "action", description: "A dagger.",
  attackBonus: 5, reachFeet: 5, rangeFeet: null, rangeNormalFeet: null,
  saveAbility: null, saveDc: null, damage: [{ formula: "1d4+2", type: "piercing" }],
  area: null, attackCount: null, usesLimit: null, usesPer: null, usesRecharge: null,
  usesPool: null, requiresEffectTag: null, multiattack: null, grants: false, reaction: null,
  targeting: "single"
};
const ATTACKER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const BLOCK = { ok: false as const, blocked: { rule: "economy.action-used", message: "Lyra Emberwise has already used an action this turn.", overridable: true } };

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;

/**
 * Roll the attack, then have the server refuse it the way Enforce does, and return what the runner
 * actually sent. The acknowledgement is ALWAYS delivered: the store's `busy` flag is module state and
 * an un-acked resolve would make the next test's `resolveTargeting` a no-op.
 */
function refuseTheAttack(): Record<string, unknown> {
  beginTargeting(ATTACK, ATTACKER);
  toggleTarget(TARGET);
  resolveTargeting(7, () => {});
  const [event, payload, acknowledge] = emitted().at(-1)!;
  expect(event).toBe("action:resolve");
  acknowledge(BLOCK);
  return payload;
}

describe("asking the GM about a refused move", () => {
  beforeEach(() => { clearTargeting(); vi.clearAllMocks(); });

  it("still sends the attack itself as a preview, so the player keeps their confirm step", () => {
    expect(refuseTheAttack().commit).toBe(false);
  });

  it("parks a COMMITTING command, because an allowed preview would change nothing", async () => {
    refuseTheAttack();
    render(<AskTheGmPrompt onFeedback={() => {}} />);
    // The refusal is stated where it happened - on the action path this is the only place it appears.
    expect(screen.getByText(BLOCK.blocked.message)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ask the GM" }));
    const [event, payload] = emitted().at(-1)!;
    expect(event).toBe("rules:ask");
    expect(payload.type).toBe("action.resolve");
    const parked = payload.payload as Record<string, unknown>;
    expect(parked.commit).toBe(true);
    expect(parked.actorId).toBe(ATTACKER);
    expect(parked.targetIds).toEqual([TARGET]);
  });
});

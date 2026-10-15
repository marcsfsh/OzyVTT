import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentActionSummary } from "@vtt/domain";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; it is routed to
// `socket.emit` here so the assertions read one call list.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, timeout: () => timed } };
});

import { socket } from "../socket";
import { AskTheGmPrompt } from "./RuleAsk";
import { beginTargeting, clearTargeting, resolveTargeting, toggleTarget } from "./targeting";

/**
 * An attack is sent as a preview (`commit: false`: attack roll only), but the command parked for the
 * GM must commit, or Allow replays a preview: a d20 lands, no damage applies, and the player is
 * refused again. The first test checks the runner still previews; the second that the parked
 * command commits (`targeting.ts`).
 */

const ATTACK: ContentActionSummary = {
  id: "dagger",
  name: "Dagger",
  activation: "action",
  description: "A dagger.",
  attackBonus: 5,
  reachFeet: 5,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [{ formula: "1d4+2", type: "piercing" }],
  area: null,
  attackCount: null,
  usesLimit: null,
  usesPer: null,
  usesRecharge: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  grants: false,
  reaction: null,
  targeting: "single"
};
const ATTACKER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const BLOCK = {
  ok: false as const,
  blocked: {
    rule: "economy.action-used",
    message: "Lyra Emberwise has already used an action this turn.",
    overridable: true
  }
};

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;

/**
 * Rolls the attack, has the server refuse it as Enforce does, and returns what the runner sent. The
 * ack is always delivered: the store's `busy` flag is module state, and an un-acked resolve would
 * make the next test's `resolveTargeting` a no-op.
 */
async function refuseTheAttack(): Promise<Record<string, unknown>> {
  beginTargeting(ATTACK, ATTACKER);
  toggleTarget(TARGET);
  resolveTargeting(7, () => {});
  const [event, payload, acknowledge] = emitted().at(-1)!;
  expect(event).toBe("action:resolve");
  acknowledge(BLOCK);
  // The reply settles a promise, so the store updates on the next microtask.
  await Promise.resolve();
  return payload;
}

describe("asking the GM about a refused move", () => {
  beforeEach(() => {
    clearTargeting();
    vi.clearAllMocks();
  });

  it("still sends the attack itself as a preview, so the player keeps their confirm step", async () => {
    expect((await refuseTheAttack()).commit).toBe(false);
  });

  it("parks a COMMITTING command, because an allowed preview would change nothing", async () => {
    await refuseTheAttack();
    render(<AskTheGmPrompt onFeedback={() => {}} />);
    // On the action path this is the only place the refusal appears.
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

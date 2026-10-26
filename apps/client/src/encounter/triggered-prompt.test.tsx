import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerPendingReaction } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ReactionPrompt } from "./ReactionPrompt";

// The prompts a stat block's own reactions open: what set them off, and what the GM's answer sends.

const GAZE: PlayerPendingReaction = {
  id: "60000000-0000-4000-8000-000000000011",
  kind: "triggered",
  cause: "turn-start",
  actorId: "10000000-0000-4000-8000-000000000012",
  actionId: "unnerving-gaze",
  actionName: "Unnerving Gaze",
  targetActorId: "10000000-0000-4000-8000-000000000013",
  sourceName: "Borin",
  triggerCommandId: "50000000-0000-4000-8000-000000000011",
  proposedDamage: 0,
  proposedDamageParts: [],
  critical: false,
  weighed: null,
  acBonus: null,
  rollsAttack: false,
  createdAt: 0
};

const mount = (reaction: PlayerPendingReaction) =>
  render(
    <ReactionPrompt
      reaction={reaction}
      actorName="Chain Devil"
      canDismiss
      onFeedback={() => {}}
      rollMode="auto"
      viewer="gm"
    />
  );

describe("a stat block's reaction prompt", () => {
  it("says what set it off, and Use answers it", async () => {
    const user = userEvent.setup();
    mount(GAZE);
    expect(screen.getByText(/Borin starts its turn nearby/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use Unnerving Gaze" }));
    expect(command).toHaveBeenCalledWith("reaction:answer", { reactionId: GAZE.id, use: true });
  });

  it("names a hit, a move's end and damage taken", () => {
    const { unmount } = mount({ ...GAZE, cause: "hit", actionName: "Reflexive Antennae" });
    expect(screen.getByText(/Borin hit Chain Devil/)).toBeTruthy();
    unmount();
    const moved = mount({ ...GAZE, cause: "move-end", actionName: "Pursuit" });
    expect(screen.getByText(/Borin ends its move nearby/)).toBeTruthy();
    moved.unmount();
    mount({ ...GAZE, cause: "damaged", actionName: "Split", targetActorId: null, sourceName: "Chain Devil" });
    expect(screen.getByText(/Chain Devil took damage/)).toBeTruthy();
  });
});

describe("Deflect Missile's prompt", () => {
  it("sends the creature picked for the force, the attacker unless another is", async () => {
    const user = userEvent.setup();
    command.mockClear();
    mount({
      ...GAZE,
      kind: "hit-by-attack",
      cause: undefined,
      actionId: "deflect-missile",
      actionName: "Deflect Missile (Recharge 5-6)",
      targetActorId: null,
      sourceName: "Archer",
      proposedDamage: 8,
      proposedDamageParts: [{ amount: 8, type: "piercing" }],
      damageResponse: { kind: "reduce", formula: "1d10 + 6" },
      redirectChoices: [
        { actorId: "10000000-0000-4000-8000-000000000021", name: "Archer" },
        { actorId: "10000000-0000-4000-8000-000000000022", name: "Mage" }
      ]
    });
    await user.selectOptions(screen.getByRole("combobox"), "Mage");
    await user.click(screen.getByRole("button", { name: /Deflect Missile/ }));
    expect(command).toHaveBeenCalledWith("reaction:answer", {
      reactionId: GAZE.id,
      use: true,
      redirectTo: "10000000-0000-4000-8000-000000000022"
    });
  });
});

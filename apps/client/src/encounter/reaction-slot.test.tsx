import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlayerPendingReaction } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true, outcome: { used: true, appliedDamage: 0 } }));
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { ReactionPrompt } from "./ReactionPrompt";

/** Hellish Rebuke, offered to a Warlock with level 1 and level 2 slots left. */
const REBUKE: PlayerPendingReaction = {
  id: "60000000-0000-4000-8000-000000000001",
  kind: "damaged-by-creature",
  actorId: "10000000-0000-4000-8000-000000000002",
  actionId: "spell-hellish-rebuke",
  actionName: "Hellish Rebuke",
  targetActorId: "10000000-0000-4000-8000-000000000009",
  sourceName: "Orc",
  triggerCommandId: "50000000-0000-4000-8000-000000000001",
  proposedDamage: 0,
  proposedDamageParts: [],
  critical: false,
  weighed: null,
  acBonus: null,
  rollsAttack: false,
  slotLevels: [1, 2],
  createdAt: 0
};

const mount = (reaction: PlayerPendingReaction) =>
  render(
    <ReactionPrompt
      reaction={reaction}
      actorName="Vex"
      canDismiss={false}
      onFeedback={() => {}}
      rollMode="manual"
      viewer="player"
    />
  );

describe("a reaction spell's slot", () => {
  it("is the lowest by default, and a higher one picked is sent with the answer", async () => {
    mount(REBUKE);
    expect(screen.getByRole("button", { name: "Cast with a level 1 spell slot" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Cast with a level 2 spell slot" }));
    fireEvent.click(screen.getByRole("button", { name: "Cast Hellish Rebuke" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(
        "reaction:answer",
        expect.objectContaining({ reactionId: REBUKE.id, use: true, slotLevel: 2 })
      )
    );
  });

  it("offers no choice when only one slot level is left", () => {
    mount({ ...REBUKE, slotLevels: [2] });
    expect(screen.queryByRole("group", { name: "Spell slot for Hellish Rebuke" })).toBeNull();
  });
});

describe("a Counterspell prompt", () => {
  it("says a spell waits on it, and lets it go or casts Counterspell", () => {
    mount({
      ...REBUKE,
      kind: "casts-spell",
      actionId: "spell-counterspell",
      actionName: "Counterspell",
      slotLevels: [3]
    });
    expect(screen.getByText(/Orc is casting a spell, which waits on the answer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cast Counterspell" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Let it go" })).toBeTruthy();
  });
});

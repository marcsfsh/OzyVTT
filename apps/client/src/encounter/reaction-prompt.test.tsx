import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlayerPendingReaction } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { ReactionPrompt } from "./ReactionPrompt";

/** Uncanny Dodge against a 17-fire bite, as `parkReaction` leaves it for a fire-resistant rogue. */
const DODGE: PlayerPendingReaction = {
  id: "60000000-0000-4000-8000-000000000001",
  kind: "hit-by-attack",
  actorId: "10000000-0000-4000-8000-000000000002",
  actionId: "uncanny-dodge",
  actionName: "Uncanny Dodge",
  targetActorId: null,
  sourceName: "Dragon",
  triggerCommandId: "50000000-0000-4000-8000-000000000001",
  proposedDamage: 17,
  proposedDamageParts: [{ amount: 17, type: "fire" }],
  critical: false,
  weighed: { use: 4, decline: 8 },
  acBonus: null,
  rollsAttack: false,
  createdAt: 0
};

const mount = (reaction: PlayerPendingReaction) =>
  render(
    <ReactionPrompt reaction={reaction} actorName="Borin" canDismiss={false} onFeedback={() => {}} rollMode="auto" />
  );

describe("the reaction prompt's buttons", () => {
  it("name what each answer takes off after the reactor's defences", () => {
    mount(DODGE);
    expect(screen.getByRole("button", { name: "Use - take 4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline - take 8" })).toBeTruthy();
  });

  it("falls back to the raw numbers for a prompt parked before they were weighed", () => {
    mount({ ...DODGE, weighed: null });
    expect(screen.getByRole("button", { name: "Use - take 8" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline - take 17" })).toBeTruthy();
  });
});

describe("the prompt for each trigger", () => {
  it("offers Parry's AC bonus before the attack lands", () => {
    mount({
      ...DODGE,
      kind: "attack-would-hit",
      actionId: "parry",
      actionName: "Parry",
      proposedDamage: 0,
      proposedDamageParts: [],
      weighed: null,
      acBonus: 2
    });
    expect(screen.getByText(/attack would hit; \+2 AC/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use - +2 AC" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline - take the hit" })).toBeTruthy();
  });

  it("strikes back with the spell itself, or with a melee swing to roll first", () => {
    const rebuke: PlayerPendingReaction = {
      ...DODGE,
      kind: "damaged-by-creature",
      actionId: "spell-hellish-rebuke",
      actionName: "Hellish Rebuke",
      targetActorId: "10000000-0000-4000-8000-000000000009",
      proposedDamage: 0,
      proposedDamageParts: [],
      weighed: null
    };
    const { unmount } = render(
      <ReactionPrompt reaction={rebuke} actorName="Borin" canDismiss={false} onFeedback={() => {}} rollMode="manual" />
    );
    expect(screen.getByText(/Dragon damaged you/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    unmount();
    render(
      <ReactionPrompt
        reaction={{ ...rebuke, actionId: "retaliation", actionName: "Retaliation", rollsAttack: true }}
        actorName="Borin"
        canDismiss={false}
        onFeedback={() => {}}
        rollMode="manual"
      />
    );
    expect(screen.getByRole("button", { name: "Attack" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });
});

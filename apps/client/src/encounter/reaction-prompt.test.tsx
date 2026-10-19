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
    <ReactionPrompt
      reaction={reaction}
      actorName="Borin"
      canDismiss={false}
      onFeedback={() => {}}
      rollMode="auto"
      viewer="player"
    />
  );

describe("the reaction prompt's buttons", () => {
  it("name what each answer takes off after the reactor's defences", () => {
    mount(DODGE);
    expect(screen.getByRole("button", { name: "Use Uncanny Dodge · take 4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take 8" })).toBeTruthy();
  });

  it("falls back to the raw numbers for a prompt parked before they were weighed", () => {
    mount({ ...DODGE, weighed: null });
    expect(screen.getByRole("button", { name: "Use Uncanny Dodge · take 8" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take 17" })).toBeTruthy();
  });
});

describe("the prompt for each trigger", () => {
  it("offers Feather Fall for a falling creature, with how far it falls", () => {
    mount({
      ...DODGE,
      kind: "falls",
      actionId: "spell-feather-fall",
      actionName: "Feather Fall (1st, Reaction)",
      sourceName: "Kesh",
      targetActorId: "10000000-0000-4000-8000-000000000003",
      proposedDamage: 0,
      proposedDamageParts: [],
      weighed: null,
      fallFeet: 40
    });
    expect(screen.getByText(/Kesh is falling 40 ft/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cast Feather Fall" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

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
    expect(screen.getByText(/attack would hit Borin\. \+2 AC turns it into a miss/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Parry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take the hit" })).toBeTruthy();
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
      <ReactionPrompt
        reaction={rebuke}
        actorName="Borin"
        canDismiss={false}
        onFeedback={() => {}}
        rollMode="manual"
        viewer="player"
      />
    );
    expect(screen.getByText(/Dragon damaged Borin/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cast Hellish Rebuke" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    unmount();
    render(
      <ReactionPrompt
        reaction={{ ...rebuke, actionId: "retaliation", actionName: "Retaliation", rollsAttack: true }}
        actorName="Borin"
        canDismiss={false}
        onFeedback={() => {}}
        rollMode="manual"
        viewer="player"
      />
    );
    expect(screen.getByRole("button", { name: "Attack" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });
});

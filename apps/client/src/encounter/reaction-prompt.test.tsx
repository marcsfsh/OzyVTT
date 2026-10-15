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

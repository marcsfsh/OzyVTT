import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlayerPendingReaction } from "@vtt/domain";

const PREVIEW = {
  ok: true,
  outcome: {
    used: false,
    appliedDamage: 0,
    resolution: {
      actionName: "Shortsword",
      activation: "reaction",
      attack: {
        targetId: "10000000-0000-4000-8000-000000000009",
        targetName: "Goblin",
        naturalRoll: 15,
        total: 21,
        targetAc: 15,
        outcome: "hit"
      },
      save: null,
      damage: [],
      damageTotal: 0,
      crit: false,
      effectGranted: null,
      componentsRemaining: null,
      overridden: null,
      preview: true,
      hitOffers: [{ id: "sneak-attack", name: "Sneak Attack", dice: "3d6 Piercing", cost: "once per turn" }]
    }
  }
};
const command = vi.fn(async (..._args: unknown[]) => PREVIEW as unknown);
vi.mock("../lib/command", () => ({ command: (...args: unknown[]) => command(...args) }));

import { ReactionPrompt } from "./ReactionPrompt";

const LEAVING: PlayerPendingReaction = {
  id: "60000000-0000-4000-8000-000000000002",
  kind: "leaves-reach",
  actorId: "10000000-0000-4000-8000-000000000002",
  actionId: "opportunity-attack",
  actionName: "Opportunity Attack",
  targetActorId: "10000000-0000-4000-8000-000000000009",
  sourceName: "Goblin",
  triggerCommandId: "50000000-0000-4000-8000-000000000001",
  proposedDamage: 0,
  proposedDamageParts: [],
  critical: false,
  weighed: null,
  acBonus: null,
  rollsAttack: true,
  createdAt: 0
};

describe("an opportunity attack's hit", () => {
  it("offers Sneak Attack on the rolled swing and sends it with the confirm", async () => {
    render(
      <ReactionPrompt reaction={LEAVING} actorName="Pip" canDismiss={false} onFeedback={() => {}} rollMode="auto" />
    );
    const extra = await screen.findByRole("button", { name: "Sneak Attack +3d6 Piercing" });
    fireEvent.click(extra);
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("reaction:answer", {
        reactionId: LEAVING.id,
        use: true,
        commit: true,
        attackNatural: 15,
        hitOptions: [{ id: "sneak-attack" }]
      })
    );
  });
});

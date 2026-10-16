import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ActionResolution } from "@vtt/domain";
import { AttackOutcome, AttackPreview } from "./AttackPreview";

type Attack = NonNullable<ActionResolution["attack"]>;

const attack = (fields: Partial<Attack>): Attack => ({
  targetId: "10000000-0000-4000-8000-000000000002",
  targetName: "Goblin",
  naturalRoll: 10,
  total: 17,
  targetAc: 15,
  outcome: "hit",
  ...fields
});

// Bless and Bane add dice to an attack roll: rolled when the attack is confirmed, so a preview can't name its outcome.
describe("an attack roll with an effect's dice", () => {
  it("shows the rolled dice inside the total", () => {
    render(
      <AttackOutcome
        attack={attack({ total: 20, bonusDice: [{ label: "Bless", dice: "1d4", total: 3 }] })}
        audience="gm"
      />
    );
    expect(screen.getByText("20 (Bless +3) vs AC 15 - HIT (nat 10) vs Goblin")).toBeTruthy();
  });

  it("previews them as still to roll, naming no outcome and confirming plainly", () => {
    render(
      <AttackPreview
        attack={attack({ total: 14, outcome: "miss", bonusDice: [{ label: "Bless", dice: "1d4", total: null }] })}
        busy={false}
        rollMode="auto"
        bonusMode="auto"
        onFeedback={() => {}}
        resolve={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    render(
      <AttackOutcome
        attack={attack({ total: 14, outcome: "miss", bonusDice: [{ label: "Bane", dice: "-1d4", total: null }] })}
        audience="gm"
      />
    );
    expect(screen.getByText("14 - 1d4 Bane vs AC 15 (nat 10) vs Goblin")).toBeTruthy();
  });

  it("still names a natural 20 or 1 while they are pending", () => {
    render(
      <AttackOutcome
        attack={attack({
          naturalRoll: 20,
          outcome: "crit",
          bonusDice: [{ label: "Bless", dice: "1d4", total: null }]
        })}
        audience="player"
      />
    );
    expect(screen.getByText(/CRITICAL HIT/)).toBeTruthy();
  });
});

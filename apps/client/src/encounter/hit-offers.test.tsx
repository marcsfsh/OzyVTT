import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActionResolution, HitOffer } from "@vtt/domain";
import { AttackPreview } from "./AttackPreview";
import type { ResolveOptions } from "./targeting";

const HIT: NonNullable<ActionResolution["attack"]> = {
  targetId: "10000000-0000-4000-8000-000000000002",
  targetName: "Foe",
  naturalRoll: 18,
  total: 23,
  targetAc: null,
  outcome: "hit"
};

const SNEAK: HitOffer = { id: "sneak-attack", name: "Sneak Attack", dice: "3d6 Piercing", cost: "once per turn" };
const SMITE: HitOffer = {
  id: "spell-divine-smite",
  name: "Divine Smite",
  dice: "2d8 Radiant",
  cost: "a level 1 spell slot and your Bonus Action",
  slotLevels: [1, 2]
};
const STRIKE: HitOffer = {
  id: "divine-strike",
  name: "Divine Strike",
  dice: "1d8 Radiant or Necrotic",
  cost: "once per turn",
  damageTypes: ["radiant", "necrotic"]
};

const mount = (hitOffers: readonly HitOffer[]) => {
  const resolve = vi.fn<(options: ResolveOptions) => void>();
  render(
    <AttackPreview
      attack={HIT}
      busy={false}
      viewer="player"
      inspired
      onFeedback={() => {}}
      hitOffers={hitOffers}
      resolve={resolve}
    />
  );
  return resolve;
};

describe("the extras a previewed hit offers", () => {
  it("adds nothing unless the attacker turns an extra on", () => {
    const resolve = mount([SNEAK]);
    expect(screen.getByRole("button", { name: "Sneak Attack +3d6 Piercing" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByText("Costs once per turn.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    // The server holds the die shown, so Confirm names none.
    expect(resolve).toHaveBeenLastCalledWith({ commit: true });
  });

  it("sends the chosen extras with Confirm, and with their slot or type", () => {
    const resolve = mount([SNEAK, SMITE, STRIKE]);
    fireEvent.click(screen.getByRole("button", { name: "Sneak Attack +3d6 Piercing" }));
    fireEvent.click(screen.getByRole("button", { name: "Divine Smite +2d8 Radiant" }));
    fireEvent.click(screen.getByRole("button", { name: "Level 2 slot" }));
    fireEvent.click(screen.getByRole("button", { name: "Divine Strike +1d8 Radiant or Necrotic" }));
    fireEvent.click(screen.getByRole("button", { name: "Necrotic" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    expect(resolve).toHaveBeenLastCalledWith({
      commit: true,
      hitOptions: [
        { id: "sneak-attack" },
        { id: "spell-divine-smite", slotLevel: 2 },
        { id: "divine-strike", damageType: "necrotic" }
      ]
    });
  });

  it("keeps a reroll a plain preview, and says what the engine couldn't check", () => {
    const resolve = mount([
      { ...SNEAK, unverified: "The map can't show whether an ally is within 5 feet of the target." }
    ]);
    expect(screen.getByText(/The map can't show whether an ally/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sneak Attack +3d6 Piercing" }));
    fireEvent.click(screen.getByRole("button", { name: "Reroll · Heroic Inspiration" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: false, reroll: true });
  });
});

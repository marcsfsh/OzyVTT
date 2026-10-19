import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActionResolution } from "@vtt/domain";
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

const PREVIEW: ActionResolution = {
  actionName: "Fire Bolt",
  activation: "action",
  attack: HIT,
  save: null,
  damage: [],
  damageTotal: 0,
  crit: false,
  preview: true,
  damageLook: "offered"
};

const LOOK: ActionResolution = {
  ...PREVIEW,
  damage: [{ formula: "2d10", type: "fire", total: 3 }],
  damageTotal: 3,
  heldDamage: {
    dice: [
      { sides: 10, face: 1, own: true },
      { sides: 10, face: 2, own: true }
    ],
    answered: [],
    answers: [
      { id: "empowered-spell", name: "Empowered Spell", dice: 1, ownOnly: true, cost: "1 Sorcery Point" },
      { id: "heroic-inspiration", name: "Heroic Inspiration", dice: 1, ownOnly: false, cost: "Heroic Inspiration" }
    ]
  }
};

const mount = (look: ActionResolution) => {
  const resolve = vi.fn<(options: ResolveOptions) => void>();
  render(
    <AttackPreview attack={HIT} busy={false} viewer="player" onFeedback={() => {}} look={look} resolve={resolve} />
  );
  return resolve;
};

describe("a look at a hit's damage before it counts", () => {
  it("offers Roll damage on a previewed hit that may be answered", () => {
    const resolve = mount(PREVIEW);
    fireEvent.click(screen.getByRole("button", { name: "Roll damage" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: false, damageLook: true });
  });

  it("shows the held dice, sends the dice picked with an answer, and confirms the hit", () => {
    const resolve = mount(LOOK);
    expect(screen.getByText(/Damage:/).textContent).toContain("2d10 fire = 3");
    const empowered = screen.getByRole("button", { name: /Empowered Spell · reroll 1 die/ }) as HTMLButtonElement;
    expect(empowered.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "d10 showing 1" }));
    expect(empowered.disabled).toBe(false);
    // Empowered Spell here rerolls one die, so a second pick is too many.
    fireEvent.click(screen.getByRole("button", { name: "d10 showing 2" }));
    expect(empowered.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "d10 showing 2" }));
    fireEvent.click(empowered);
    expect(resolve).toHaveBeenLastCalledWith({
      commit: false,
      damageLook: true,
      damageAnswer: { id: "empowered-spell", dice: [0] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: true });
  });
});

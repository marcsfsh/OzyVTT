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
  targetAc: 13,
  outcome: "hit"
} as NonNullable<ActionResolution["attack"]>;

const lookWith = (picked?: "push" | "sap" | "slow") =>
  ({
    actionName: "Greatsword",
    activation: "action",
    attack: HIT,
    save: null,
    damage: [],
    damageTotal: 0,
    crit: false,
    preview: true,
    masteryOptions: {
      own: { id: "graze", name: "Graze" },
      alternatives: [
        { id: "push", name: "Push" },
        { id: "sap", name: "Sap" },
        { id: "slow", name: "Slow" }
      ],
      ...(picked ? { picked } : {})
    }
  }) as unknown as ActionResolution;

const mount = (look: ActionResolution) => {
  const resolve = vi.fn<(options: ResolveOptions) => void>();
  render(
    <AttackPreview attack={HIT} busy={false} viewer="player" onFeedback={() => {}} look={look} resolve={resolve} />
  );
  return resolve;
};

describe("Tactical Master's mastery choice on a previewed attack", () => {
  it("offers the weapon's own property beside Push, Sap and Slow, and looks again with the one picked", () => {
    const resolve = mount(lookWith());
    expect(screen.getByRole("button", { name: "Graze" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: false, mastery: "push" });
  });

  it("confirms with the picked property", () => {
    const resolve = mount(lookWith("sap"));
    expect(screen.getByRole("button", { name: "Sap" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    expect(resolve).toHaveBeenLastCalledWith({ mastery: "sap", commit: true });
  });
});

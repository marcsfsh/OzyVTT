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

const mount = (push: ActionResolution["push"]) => {
  const resolve = vi.fn<(options: ResolveOptions) => void>();
  render(<AttackPreview attack={HIT} busy={false} viewer="gm" onFeedback={() => {}} push={push} resolve={resolve} />);
  return resolve;
};

describe("the Push choice on a previewed hit", () => {
  it("confirms the full distance unless the attacker picks less", () => {
    const resolve = mount({ targetName: "Foe", maxFeet: 10 });
    expect(screen.getByRole("button", { name: "10 ft" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: true, pushFeet: 10 });

    fireEvent.click(screen.getByRole("button", { name: "No push" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: true, pushFeet: 0 });
  });

  it("leaves a reroll preview without a push distance", () => {
    const resolve = mount({ targetName: "Foe", maxFeet: 10 });
    fireEvent.click(screen.getByRole("button", { name: "5 ft" }));
    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: false, reroll: true });
  });

  it("asks nothing when the hit offers no push", () => {
    const resolve = mount(null);
    expect(screen.queryByRole("group", { name: /Push/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm hit" }));
    expect(resolve).toHaveBeenLastCalledWith({ commit: true });
  });
});

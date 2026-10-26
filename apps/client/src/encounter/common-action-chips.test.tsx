import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContentActionSummary } from "@vtt/domain";
import { CommonActionChips } from "./CommonActionChips";

const builtin = (
  id: string,
  name: string,
  activation: ContentActionSummary["activation"],
  requiresEffectTag: string | null = null
): ContentActionSummary =>
  ({ id, name, activation, description: name, damage: [], requiresEffectTag }) as unknown as ContentActionSummary;

const ACTIONS = [
  builtin("dash", "Dash", "action"),
  builtin("hide-bonus", "Hide (Cunning Action)", "bonus-action"),
  builtin("move-sphere", "Move the Sphere", "bonus-action", "sphere-control"),
  builtin("search", "Search", "action")
];

const chips = () =>
  Array.from(
    screen.getByRole("group", { name: "Common actions" }).querySelectorAll("button:not(.builtin-more)"),
    (button) => button.textContent
  );

describe("the common action chips", () => {
  it("keeps a Bonus Action an effect calls for behind More until the effect is on the creature", () => {
    render(<CommonActionChips actions={ACTIONS} busy={false} onUse={() => {}} />);
    expect(chips()).toEqual(["Dash", "Hide (Cunning Action)"]);
  });

  it("brings it forward while its effect lasts", () => {
    render(<CommonActionChips actions={ACTIONS} busy={false} effectTags={["sphere-control"]} onUse={() => {}} />);
    expect(chips()).toEqual(["Move the Sphere", "Dash", "Hide (Cunning Action)"]);
  });
});

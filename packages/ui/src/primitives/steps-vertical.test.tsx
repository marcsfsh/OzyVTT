/**
 * The vertical step list, for a column beside a step body (the homebrew wizards). jsdom has no layout, so this checks
 * the markup the stylesheet keys on, the jumps a non-linear flow allows, and that the CSS keeps the 44px floor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Steps } from "./Steps";

const STEPS = [
  { label: "What it is", state: "done" as const },
  { label: "How it's cast", state: "incomplete" as const },
  { label: "What it does" },
  { label: "Review" }
];

describe("Steps, vertical", () => {
  it("marks the list for the vertical layout and leaves the rail as it was by default", () => {
    const { container, rerender } = render(<Steps steps={STEPS} current={0} orientation="vertical" />);
    expect(container.querySelector("ol.nh-steps")?.classList.contains("nh-steps--vertical")).toBe(true);
    rerender(<Steps steps={STEPS} current={0} />);
    expect(container.querySelector("ol.nh-steps")?.classList.contains("nh-steps--vertical")).toBe(false);
  });

  it("lets every step but the current one be jumped to when the flow allows it, and says which are unfinished", async () => {
    const onStepSelect = vi.fn();
    render(<Steps steps={STEPS} current={2} orientation="vertical" onStepSelect={onStepSelect} maxSelectable={3} />);
    const jumps = screen.getAllByRole("button");
    expect(jumps.map((jump) => jump.textContent)).toEqual([
      "What it is — done",
      "How it's cast — not finished",
      "4Review"
    ]);
    await userEvent.click(jumps[2]);
    expect(onStepSelect).toHaveBeenCalledWith(3);
  });

  it("keeps each row at the tap floor and lets a long name wrap", () => {
    const css = readFileSync(`${process.cwd()}/src/primitives/Steps.css`, "utf8");
    const rule = (selector: string) => css.split(`${selector} {`)[1]?.split("}")[0] ?? "";
    expect(rule(".nh-steps--vertical .nh-step")).toContain("min-height: var(--tap-min)");
    expect(rule(".nh-steps--vertical .nh-step-label")).toContain("white-space: normal");
  });
});

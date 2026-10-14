/**
 * The label band: in a `FieldGrid` row, a Field-wrapped input's well starts one label line plus one row-gap
 * below the cell top, so `Stepper` and `Switch` must reserve the same band. jsdom has no layout, so this checks
 * structure and the CSS source wiring (`--nh-label-band` is declared from `.nh-field`'s metrics and the modifiers
 * use it); `scripts/primitive-align-check.mjs` measures the geometry in a browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Stepper } from "./Stepper";
import { Switch } from "./Switch";

const css = (file: string): string => readFileSync(`${process.cwd()}/src/primitives/${file}`, "utf8");
/** The declaration block for one selector, with comments and newlines flattened. */
function ruleFor(source: string, selector: string): string {
  const match = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

describe("the label band is one named token, derived from the field metrics it has to match", () => {
  it("declares --nh-label-band in forms.css as label line-box + field gap", () => {
    const forms = css("forms.css");
    // Read the two rules the band restates rather than hard-coding values, so a retune fails here.
    const labelFont = ruleFor(forms, ".nh-field-label");
    const fieldGap = ruleFor(forms, ".nh-field");
    const size = labelFont.match(/font:\s*600\s*var\((--[\w-]+)\)\s*\/\s*([\d.]+)/);
    const gap = fieldGap.match(/gap:\s*var\((--[\w-]+)\)/);
    expect(size, ".nh-field-label no longer states its font as `600 var(--size) / <line-height>`").not.toBeNull();
    expect(gap, ".nh-field no longer states its row gap as a single token").not.toBeNull();

    const [, sizeToken, lineHeight] = size!;
    const [, gapToken] = gap!;
    expect(
      ruleFor(forms, ":root"),
      `--nh-label-band must stay the arithmetic of the two rules above it — ${sizeToken} × ${lineHeight} + ${gapToken}.\n` +
        `Fix: if a field's label metrics changed, change this calc in the same edit; the band exists to be the SAME height.`
    ).toBe(`--nh-label-band: calc(var(${sizeToken}) * ${lineHeight} + var(${gapToken}));`);
  });

  it("is spent by the switch modifier as margin, so the tap target is not pushed with it", () => {
    // `margin-top`: the 44px `::after` and the paint are measured from the border box, so padding would drag the hit
    // area down.
    const switchCss = css("Switch.css");
    expect(ruleFor(switchCss, ".nh-switch--banded")).toBe("margin-top: var(--nh-label-band);");
    // The band is measured to the track, and the labeled form pads above the track, so labeled+banded gives that
    // padding back. The two rules must change together.
    const padding = ruleFor(switchCss, ".nh-switch--labeled").match(/padding:\s*var\((--[\w-]+)\)/);
    expect(padding, ".nh-switch--labeled no longer states its padding as a single token").not.toBeNull();
    expect(ruleFor(switchCss, ".nh-switch--banded.nh-switch--labeled")).toBe(
      `margin-top: calc(var(--nh-label-band) - var(${padding![1]}));`
    );
  });

  it("is matched — not spent — by the labeled stepper, which stacks its own real label into the band", () => {
    // The stepper has a label, so it needs the same gap under the same font, not a spacer.
    const stepper = css("Stepper.css");
    expect(ruleFor(stepper, ".nh-stepper--labeled")).toContain("display: grid");
    expect(ruleFor(stepper, ".nh-stepper--labeled")).toContain("gap: var(--space-2)");
    // Same font shorthand as `.nh-field-label`.
    expect(ruleFor(stepper, ".nh-stepper-label")).toContain(
      ruleFor(css("forms.css"), ".nh-field-label").match(/font:[^;]+;/)![0]
    );
  });
});

describe("Stepper (D23a)", () => {
  it("stacks a visible label into the band, before the controls, and marks the row as banded", () => {
    const { container } = render(<Stepper value={3} onChange={() => {}} label="Dice" />);
    const root = container.querySelector(".nh-stepper")!;
    expect(root.className).toContain("nh-stepper--labeled");
    // Document order is the band: label first, then controls.
    expect([...root.children].map((child) => child.className)).toEqual(["nh-stepper-label", "nh-stepper-controls"]);
    expect(screen.getByText("Dice")).toBeInTheDocument();
  });

  it("renders no band at all without a visible label — the six ability steppers keep their inline row", () => {
    const { container } = render(<Stepper value={10} onChange={() => {}} aria-label="Strength" />);
    const root = container.querySelector(".nh-stepper")!;
    expect(root.className).not.toContain("nh-stepper--labeled");
    expect(root.querySelector(".nh-stepper-label")).toBeNull();
    expect([...root.children].map((child) => child.className)).toEqual(["nh-stepper-controls"]);
    // No band outside a form context.
    expect(screen.getByRole("group", { name: "Strength" })).toBeInTheDocument();
  });

  it("clamps to its bounds and disables the spent edge", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<Stepper value={6} onChange={onChange} min={1} max={6} label="Dice" />);
    expect(screen.getByRole("button", { name: "Increase" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Decrease" }));
    expect(onChange).toHaveBeenCalledWith(5);

    view.rerender(<Stepper value={1} onChange={onChange} min={1} max={6} label="Dice" />);
    expect(screen.getByRole("button", { name: "Decrease" })).toBeDisabled();
    // Both edges disabled, so the clamp is visible rather than a silent correction.
    expect(screen.getByRole("button", { name: "Increase" })).toBeEnabled();
  });

  it("renders the value through `format`, and stays quiet unless asked to announce", () => {
    const view = render(
      <Stepper value={0} onChange={() => {}} label="Modifier" format={(v) => (v === 0 ? "±0" : `+${v}`)} />
    );
    const value = view.container.querySelector(".nh-stepper-value")!;
    expect(value.textContent).toBe("±0");
    // Opt-in, so several steppers on one screen don't compete as live regions.
    expect(value.getAttribute("aria-live")).toBeNull();
    view.rerender(<Stepper value={2} onChange={() => {}} label="Modifier" announceValue />);
    expect(view.container.querySelector(".nh-stepper-value")!.getAttribute("aria-live")).toBe("polite");
  });
});

describe("Switch (D23b)", () => {
  it("takes the band only when asked, and keeps its label INSIDE the button either way", () => {
    const { container, rerender } = render(<Switch checked={false} onChange={() => {}} label="Auto-stage" />);
    const button = screen.getByRole("switch");
    expect(button.className).not.toContain("nh-switch--banded");

    rerender(<Switch checked={false} onChange={() => {}} label="Auto-stage" banded />);
    expect(screen.getByRole("switch").className).toContain("nh-switch--banded");
    // The band is margin on the button itself; a wrapper would break the tap target.
    expect(container.firstElementChild).toBe(button);
    expect(button.querySelector(".nh-switch-label")!.textContent).toBe("Auto-stage");
    expect(button.querySelector(".nh-switch-track")).not.toBeNull();
  });

  it("keeps the 44px tap-target class and role=switch semantics through the band change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Auto-stage" banded />);
    const button = screen.getByRole("switch");
    // jsdom can't measure the ::after extension, but the class that paints it must stay on the element.
    expect(button.className).toContain("tap-target");
    expect(button).toHaveAttribute("aria-checked", "false");
    await user.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("names itself from its label, and takes an explicit aria-label when the label is the state", () => {
    const view = render(<Switch checked onChange={() => {}} label="Auto-stage" />);
    expect(screen.getByRole("switch")).toHaveAccessibleName("Auto-stage");
    view.rerender(
      <Switch checked onChange={() => {}} label="Shown to players" aria-label="Show this page to players" />
    );
    // A constant accessible name, not one that changes with the state label.
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show this page to players");
  });
});

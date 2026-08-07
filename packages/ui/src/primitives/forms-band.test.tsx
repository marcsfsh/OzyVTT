/**
 * D23 (a) and (b) — the label band, and the two controls that had to learn about it.
 *
 * The defect, reported from the homebrew forms and reproduced against the primitives: in a `FieldGrid`
 * row, an Input/Select/Textarea is wrapped in a `Field`, which stacks a label over the control, so its
 * well begins one label-height plus one row-gap below the cell top. A `Stepper` rendered its label
 * *beside* the control and a `Switch` rendered no label band at all, so both started at the cell top —
 * roughly 25px high — and the stepper dragged its centred label up out of the label row with it.
 *
 * **What this file can and cannot prove.** jsdom loads no stylesheet and lays out no boxes, so it cannot
 * measure that the tops line up. It is split accordingly, and both halves are here:
 *   - STRUCTURE: the elements and modifier classes that produce the band exist, in the right order, and
 *     only in the cases that should have one.
 *   - SOURCE WIRING: the rules those classes resolve to really are the band — `--nh-label-band` is
 *     declared, it is derived from the very `.nh-field` metrics it has to match, and the modifiers spend
 *     it. A class with no rule behind it is the way this regresses silently, so the rules are read.
 * The geometry itself (top(.nh-stepper-controls) === top(.nh-input) ±1px, at 390 and 1280) is measured
 * by `scripts/primitive-align-check.mjs` against the /styleguide alignment row.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Stepper } from "./Stepper";
import { Switch } from "./Switch";

const css = (file: string): string => readFileSync(`${process.cwd()}/src/primitives/${file}`, "utf8");
/** The declaration block for one selector, with comments and newlines flattened out of the way. */
function ruleFor(source: string, selector: string): string {
  const match = source.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1].replace(/\s+/g, " ").trim();
}

describe("the label band is one named token, derived from the field metrics it has to match", () => {
  it("declares --nh-label-band in forms.css as label line-box + field gap", () => {
    const forms = css("forms.css");
    // The two rules the band is a restatement of. Read them rather than hard-coding 13px/8px, so the
    // day someone re-tunes a field's label this fails HERE, naming the pairing, instead of shipping a
    // band that silently no longer matches anything.
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
    // `margin-top`, deliberately: `.tap-target`'s 44px `::after` extension and the button's own paint are
    // both measured from its border box, so padding here would drag the hit area down with the track.
    const switchCss = css("Switch.css");
    expect(ruleFor(switchCss, ".nh-switch--banded")).toBe("margin-top: var(--nh-label-band);");
    // The band is measured to the TRACK, and the labeled form pads itself above the track — so the
    // labeled+banded pair has to hand that padding back. This landed because the browser check measured
    // the row 4.00px out, which is exactly the size of `.nh-switch--labeled`'s own top padding: the two
    // rules are one decision and drift apart the moment either is edited alone.
    const padding = ruleFor(switchCss, ".nh-switch--labeled").match(/padding:\s*var\((--[\w-]+)\)/);
    expect(padding, ".nh-switch--labeled no longer states its padding as a single token").not.toBeNull();
    expect(ruleFor(switchCss, ".nh-switch--banded.nh-switch--labeled")).toBe(`margin-top: calc(var(--nh-label-band) - var(${padding![1]}));`);
  });

  it("is matched — not spent — by the labeled stepper, which stacks its own real label into the band", () => {
    // The stepper HAS a label, so it does not need a spacer; it needs the same gap under the same font.
    const stepper = css("Stepper.css");
    expect(ruleFor(stepper, ".nh-stepper--labeled")).toContain("display: grid");
    expect(ruleFor(stepper, ".nh-stepper--labeled")).toContain("gap: var(--space-2)");
    // Same font shorthand as `.nh-field-label`, or the band is the right height for the wrong text.
    expect(ruleFor(stepper, ".nh-stepper-label")).toContain(ruleFor(css("forms.css"), ".nh-field-label").match(/font:[^;]+;/)![0]);
  });
});

describe("Stepper (D23a)", () => {
  it("stacks a visible label into the band, before the controls, and marks the row as banded", () => {
    const { container } = render(<Stepper value={3} onChange={() => {}} label="Dice" />);
    const root = container.querySelector(".nh-stepper")!;
    expect(root.className).toContain("nh-stepper--labeled");
    // Document order IS the band: a label after the controls would render below them, which is a
    // different layout that happens to use the same class.
    expect([...root.children].map((child) => child.className)).toEqual(["nh-stepper-label", "nh-stepper-controls"]);
    expect(screen.getByText("Dice")).toBeInTheDocument();
  });

  it("renders no band at all without a visible label — the six ability steppers keep their inline row", () => {
    const { container } = render(<Stepper value={10} onChange={() => {}} aria-label="Strength" />);
    const root = container.querySelector(".nh-stepper")!;
    expect(root.className).not.toContain("nh-stepper--labeled");
    expect(root.querySelector(".nh-stepper-label")).toBeNull();
    expect([...root.children].map((child) => child.className)).toEqual(["nh-stepper-controls"]);
    // A phantom band in a non-form context is the regression the `iff` above exists to prevent.
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
    // Both edges disabled means neither can be walked past, which is what makes the clamp honest rather
    // than a silent correction of a value the caller thinks it set.
    expect(screen.getByRole("button", { name: "Increase" })).toBeEnabled();
  });

  it("renders the value through `format`, and stays quiet unless asked to announce", () => {
    const view = render(<Stepper value={0} onChange={() => {}} label="Modifier" format={(v) => (v === 0 ? "±0" : `+${v}`)} />);
    const value = view.container.querySelector(".nh-stepper-value")!;
    expect(value.textContent).toBe("±0");
    // Six steppers on one screen would be six live regions shouting over each other, so this is opt-in.
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
    // The band is margin on the BUTTON. A wrapper element around it would break the tap target and the
    // label's membership of it — which is the whole reason the fix is a spacer and not a `Field`.
    expect(container.firstElementChild).toBe(button);
    expect(button.querySelector(".nh-switch-label")!.textContent).toBe("Auto-stage");
    expect(button.querySelector(".nh-switch-track")).not.toBeNull();
  });

  it("keeps the 44px tap-target class and role=switch semantics through the band change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Auto-stage" banded />);
    const button = screen.getByRole("switch");
    // jsdom cannot measure the ::after extension; what it CAN hold is that the class which paints it is
    // still on the element the band moved. Losing it silently is exactly how a phone loses the target.
    expect(button.className).toContain("tap-target");
    expect(button).toHaveAttribute("aria-checked", "false");
    await user.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("names itself from its label, and takes an explicit aria-label when the label is the state", () => {
    const view = render(<Switch checked onChange={() => {}} label="Auto-stage" />);
    expect(screen.getByRole("switch")).toHaveAccessibleName("Auto-stage");
    view.rerender(<Switch checked onChange={() => {}} label="Shown to players" aria-label="Show this page to players" />);
    // A label that CHANGES with the state would rename the control on every click, so a constant
    // accessible name wins outright — this is the reveal control's contract.
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show this page to players");
  });
});

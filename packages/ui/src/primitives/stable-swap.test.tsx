/**
 * D23c — the control whose label is its state must not resize when the state changes.
 *
 * Reported as "the Show-to-players toggle changes position when clicked, so after the first click you
 * have to move the mouse", and the reported cause was the real one: the label swaps a 15-character
 * string for a 19-character one inside the same `<button>` as the track, and the cluster it sits in is
 * right-anchored, so the extra width grows leftward and takes the track out from under the pointer.
 *
 * **Structure here, geometry in the browser.** jsdom has no layout, so "the box did not move" is not
 * assertable in this file; `scripts/primitive-align-check.mjs` clicks the real control and compares the
 * track's bounding box before and after. What IS assertable — and is the thing that would be quietly
 * deleted by someone tidying up — is that the reservation is present, carries the other state's exact
 * string, and is out of the accessibility tree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StableSwap } from "./StableSwap";
import { Switch } from "./Switch";

const ghostOf = (root: HTMLElement) => root.querySelector<HTMLElement>(".nh-stableswap-ghost");

describe("StableSwap", () => {
  it("shows the current text and reserves the other one, hidden and unannounced", () => {
    const { container } = render(<StableSwap current="Shown to players" alternate="Hidden from players" />);
    expect(screen.getByText("Shown to players")).toBeInTheDocument();

    const ghost = ghostOf(container)!;
    expect(ghost, "the width reservation is gone — the control will resize when its label changes").not.toBeNull();
    expect(ghost.getAttribute("data-stable-swap-alt")).toBe("Hidden from players");
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    // The reserved string is generated content, not a text node — see the component's own note. It must
    // never become readable text, or every reveal control starts claiming both states at once.
    expect(ghost.textContent).toBe("");
    expect(container.textContent).toBe("Shown to players");
  });

  it("resolves the reservation through CSS that actually paints it", () => {
    // A `data-` attribute nothing renders reserves no width at all, and nothing in the DOM would say so.
    const css = readFileSync(`${process.cwd()}/src/primitives/StableSwap.css`, "utf8");
    expect(css).toContain("content: attr(data-stable-swap-alt)");
    expect(css).toContain("visibility: hidden");
    // One grid cell holding both, so the cell takes the wider — the mechanism in one declaration.
    expect(css).toContain("display: inline-grid");
    expect(css).toContain("grid-area: 1 / 1");
  });
});

describe("Switch with a state-dependent label", () => {
  it("reserves the other state's width, and swaps the two on toggle", () => {
    const view = render(<Switch checked onChange={() => {}} label="Shown to players" labelAlternate="Hidden from players" aria-label="Show this page to players" />);
    const button = screen.getByRole("switch");
    expect(button.textContent).toBe("Shown to players");
    expect(ghostOf(button)!.getAttribute("data-stable-swap-alt")).toBe("Hidden from players");

    view.rerender(<Switch checked={false} onChange={() => {}} label="Hidden from players" labelAlternate="Shown to players" aria-label="Show this page to players" />);
    expect(screen.getByRole("switch").textContent).toBe("Hidden from players");
    // The reservation swaps with the label, so the wider string is reserved in BOTH states rather than
    // only in the one that happens to be shorter.
    expect(ghostOf(screen.getByRole("switch"))!.getAttribute("data-stable-swap-alt")).toBe("Shown to players");
    // The name never moves with the label — the control is the same control in both states.
    expect(screen.getByRole("switch")).toHaveAccessibleName("Show this page to players");
  });

  it("stays a plain label when no alternate is given — nothing pays for a reservation it does not need", () => {
    const { container } = render(<Switch checked={false} onChange={() => {}} label="Auto-stage" />);
    expect(ghostOf(container)).toBeNull();
    expect(container.querySelector(".nh-switch-label")!.textContent).toBe("Auto-stage");
  });
});

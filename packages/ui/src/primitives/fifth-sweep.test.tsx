import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KindCard } from "./KindCard";

// The fifth sweep's parts drawn once (ADR-0076): one tag, one close, one stepper, tabs, fields, lamps and text shades.

const read = (path: string) => readFileSync(`${process.cwd()}/src/${path}`, "utf8");

describe("the shared sizes", () => {
  it("draws every tag in VT323 16px in a 22px box", () => {
    expect(read("primitives/Tag.css")).toMatch(
      /\.nh-tag \{[^}]*height: 22px;[^}]*font: 400 16px \/ 1 var\(--font-numeric\);/
    );
  });

  it("closes a dialog with an 18px icon in a 40px button, 44px under a finger", () => {
    const css = read("primitives/Modal.css");
    expect(css).toMatch(/\.nh-modal-close \{[^}]*width: 40px;\s*height: 40px;/);
    expect(css).toMatch(/\.nh-modal-close svg \{\s*width: 18px;\s*height: 18px;/);
    expect(css).toMatch(/\(max-width: 760px\) \{\s*\.nh-modal-close \{\s*width: var\(--tap-min\);/);
  });

  it("draws a stepper at 40px with its number in VT323 22px, 44px under a finger", () => {
    const css = read("primitives/Stepper.css");
    expect(css).toMatch(/\.nh-stepper-btn \{[^}]*min-width: 40px;\s*min-height: 40px;/);
    expect(css).toMatch(/\.nh-stepper-value \{[^}]*font: 400 22px \/ 1 var\(--font-numeric\);/);
  });

  it("writes a tab's words at 14px and a lamp at 8px", () => {
    expect(read("primitives/Tabs.css")).toMatch(/font: 600 14px \/ 1 var\(--font-label\);/);
    expect(read("primitives/Lamp.css")).toMatch(/\.nh-status-lamp \{[^}]*width: 8px;\s*height: 8px;/);
  });

  it("gives amber, magenta and violet words Dawn's darker shades", () => {
    const tokens = read("styles/design-tokens.css");
    const dawn = tokens.slice(tokens.indexOf('[data-theme="dawn"] {'));
    expect(dawn).toMatch(/--caution-text: #875400;/);
    expect(dawn).toMatch(/--magenta-text: #a3246b;/);
    expect(dawn).toMatch(/--violet-text: #6a44bf;/);
  });
});

describe("a kind card", () => {
  it("shows its name, the count and its line, and opens its list", () => {
    render(<KindCard icon={<svg />} name="People" count={4} line="2 revealed" onOpen={() => {}} />);
    const card = screen.getByRole("region", { name: "People" });
    expect(card).toHaveTextContent("Open PeoplePeople42 revealed");
    expect(screen.getByText("4")).toHaveClass("nh-kindcard-count");
  });
});

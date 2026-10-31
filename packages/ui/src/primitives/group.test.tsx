import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Group } from "./Group";

// The Cradle (ADR-0048): the title is the one eyebrow, the GM tag follows it, an open group has no box, and a group
// inside a group draws none of its own.

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = readFileSync(`${process.cwd()}/src/primitives/Group.css`, "utf8");
  document.head.append(style);
});
afterEach(() => style.remove());

/** Whether the Cradle's box is drawn for this element: jsdom does not compute pseudo-elements, so the rules that hide
 *  the box are matched against the element directly. */
function boxed(element: Element) {
  const rules = [...(style.sheet?.cssRules ?? [])].filter(
    (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.display === "none"
  );
  return !rules.some((rule) =>
    rule.selectorText
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector.endsWith("::before"))
      .some((selector) => element.matches(selector.replace(/::before$/, "")))
  );
}

describe("Group", () => {
  it("names itself by its title, drawn as the eyebrow", () => {
    render(<Group title="Players' hits">rows</Group>);
    const group = screen.getByRole("region", { name: "Players' hits" });
    expect(screen.getByText("Players' hits").classList.contains("nh-eyebrow")).toBe(true);
    expect(group.getAttribute("aria-labelledby")).toBe(screen.getByText("Players' hits").id);
  });

  it("puts the GM only tag after the title", () => {
    render(
      <Group title="Initiative" gmOnly>
        rows
      </Group>
    );
    expect(screen.getByText("GM only")).toBeTruthy();
  });

  it("finds its title as a heading when asked", () => {
    render(
      <Group title="Download backup" headingLevel={2}>
        rows
      </Group>
    );
    expect(screen.getByRole("heading", { level: 2, name: "Download backup" })).toBeTruthy();
  });

  it("draws no box for a group you only read", () => {
    render(
      <Group title="Links" kind="read">
        rows
      </Group>
    );
    const group = screen.getByRole("region", { name: "Links" });
    expect(group.classList.contains("nh-group--read")).toBe(true);
    expect(boxed(group)).toBe(false);
  });

  it("draws no box for a group inside another", () => {
    render(
      <Group title="Outer">
        <Group title="Inner">rows</Group>
      </Group>
    );
    expect(boxed(screen.getByRole("region", { name: "Outer" }))).toBe(true);
    expect(boxed(screen.getByRole("region", { name: "Inner" }))).toBe(false);
  });
});

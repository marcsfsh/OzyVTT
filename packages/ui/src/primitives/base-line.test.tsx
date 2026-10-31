import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown } from "../records/Dropdown";
import { Button } from "./Button";

// The theme spec (ADR-0048): a secondary control is its label on a Base line, with no edge and no fill, and an open
// control keeps the 2px cyan line, painted through the button's own layer so it shows above it.

const sheets = ["src/styles/design-tokens.css", "src/primitives/Button.css", "src/records/Dropdown.css"];
let styles: HTMLStyleElement[] = [];
beforeEach(() => {
  styles = sheets.map((path) => {
    const style = document.createElement("style");
    style.textContent = readFileSync(`${process.cwd()}/${path}`, "utf8");
    document.head.append(style);
    return style;
  });
});
afterEach(() => styles.forEach((style) => style.remove()));

const variable = (element: Element, name: string) => getComputedStyle(element).getPropertyValue(name).trim();

describe("the Base line", () => {
  it("draws a secondary button with no fill or edge, on a 1px line", () => {
    render(<Button>Edit</Button>);
    const button = screen.getByRole("button", { name: "Edit" });
    expect(variable(button, "--nh-fill")).toBe("transparent");
    expect(variable(button, "--nh-rim")).toBe("transparent");
    expect(variable(button, "--nh-sheen")).toBe("var(--base-line)");
    expect(variable(document.documentElement, "--base-line")).toMatch(/^inset 0 ?-1px 0 var\(--line-raised\)$/);
  });

  it("draws a danger action in --danger-text on the grey Base line", () => {
    render(<Button variant="destructive">Revoke</Button>);
    const button = screen.getByRole("button", { name: "Revoke" });
    expect(variable(button, "--nh-sheen")).toBe("var(--base-line)");
    expect(getComputedStyle(button).color).not.toBe("");
  });

  it("keeps the Dropdown's open state on the 2px cyan line", async () => {
    render(<Dropdown label="State">{() => <span>Panel</span>}</Dropdown>);
    const trigger = screen.getByRole("button", { name: /State/ });
    await userEvent.setup().click(trigger);
    expect(trigger.classList.contains("is-on")).toBe(true);
    expect(variable(trigger, "--nh-sheen")).toBe("var(--base-line-on)");
  });
});

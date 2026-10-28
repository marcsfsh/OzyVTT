import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { composite, contrastRatio, parseColour } from "../theme/colour";
import { THEME_NAMES, THEMES } from "../theme/theme";
import { Button } from "./Button";

// The primary paints its own plate on a backing layer that no page rule reaches, so its words take their ink from the
// primitive too. A page rule that colours every button in a container once put dark ink on that dark plate.

const sheets = ["src/styles/design-tokens.css", "src/primitives/Button.css"];
const HOSTILE = ".card button { color: var(--text-on-neon); background: var(--primary); }";

let styles: HTMLStyleElement[] = [];
beforeEach(() => {
  styles = [...sheets.map((path) => readFileSync(`${process.cwd()}/${path}`, "utf8")), HOSTILE].map((text) => {
    const style = document.createElement("style");
    style.textContent = text;
    document.head.append(style);
    return style;
  });
});
afterEach(() => {
  styles.forEach((style) => style.remove());
  document.documentElement.removeAttribute("data-theme");
});

/** jsdom runs the cascade and leaves `var()` as written; this follows it to a colour. */
function resolved(element: Element, value: string): string {
  let text = value.trim();
  for (let hop = 0; hop < 20 && text.includes("var("); hop++)
    text = text.replace(/var\(\s*(--[\w-]+)\s*\)/, (_, name: string) =>
      getComputedStyle(element).getPropertyValue(name).trim()
    );
  return text;
}

describe("the primary button's label", () => {
  for (const theme of THEMES) {
    it(`keeps the primary's own ink inside a container that colours buttons, in ${THEME_NAMES[theme]}`, () => {
      document.documentElement.setAttribute("data-theme", theme);
      render(
        <div className="card">
          <Button variant="primary">Enter table</Button>
          <Button variant="primary" disabled>
            Create
          </Button>
        </div>
      );
      const [enabled, disabled] = screen.getAllByRole("button", { hidden: true });
      const label = enabled.querySelector("nh-label")!;
      expect(resolved(label, getComputedStyle(label).color)).toBe(resolved(label, "var(--text)"));
      const ink = parseColour(resolved(label, getComputedStyle(label).color))!;
      // The Cup's plate, and the plate at the label's midline with the horizon's yellow end seen through the veil.
      const plate = parseColour(resolved(label, "var(--surface-2)"))!;
      expect(contrastRatio(ink, plate)).toBeGreaterThanOrEqual(4.5);
      const veil = parseFloat(resolved(label, "var(--primary-veil)")) / 100;
      const cast = composite([...plate, veil], parseColour(resolved(label, "var(--hz-5)"))!);
      expect(contrastRatio(ink, cast)).toBeGreaterThanOrEqual(4.5);

      // Disabled dims the words alone: the label is the muted ink and the button keeps full opacity.
      const off = disabled.querySelector("nh-label")!;
      expect(resolved(off, getComputedStyle(off).color)).toBe(resolved(off, "var(--text-muted)"));
      expect(getComputedStyle(disabled).opacity).toBe("1");
    });
  }

  it("lets a page recolour the label through the ink hook", () => {
    render(
      <Button variant="primary" style={{ ["--nh-ink" as string]: "#123456" }}>
        Go live
      </Button>
    );
    const label = screen.getByRole("button", { hidden: true }).querySelector("nh-label")!;
    expect(resolved(label, getComputedStyle(label).color)).toBe("#123456");
  });
});

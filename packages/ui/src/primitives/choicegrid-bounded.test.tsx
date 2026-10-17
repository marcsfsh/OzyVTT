/**
 * A capped option grid (`ChoiceGrid bounded`) scrolls its cards inside a fixed height. With `auto` rows, a list taller
 * than the cap shrinks every row to its cards' minimum height and clips their descriptions (a feat's summary, a class
 * card's reason). jsdom has no layout, so this checks the stylesheet sizes those rows to their content.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ChoiceGrid bounded", () => {
  it("sizes each row to its cards, however far the list runs past the cap", () => {
    const css = readFileSync(`${process.cwd()}/src/primitives/ChoiceGrid.css`, "utf8");
    const rule = /\.nh-choicegrid-items--bounded\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("max-height");
    expect(rule).toContain("grid-auto-rows: max-content");
  });
});

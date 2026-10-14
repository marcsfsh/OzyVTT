/**
 * A field keeps its own height in a row of fields. `.nh-field` is a grid with no `align-content`, so a
 * stretching parent grows a field with a help line and its siblings' inputs drop to match. jsdom can't
 * measure layout, so this checks the source wiring: the premise, the scoped CSS rule and its scope.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Vite rewrites `import.meta.url`, so read sources from the workspace root. */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const CODEX_CSS = read("src/codex/codex.css");
const FORMS_CSS = read("../../packages/ui/src/primitives/forms.css");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the premise: .nh-field does not align its own content", () => {
  it("leaves `.nh-field` a bare grid + gap, so its rows still stretch when a parent stretches it", () => {
    const rule = withoutComments(FORMS_CSS).match(/\.nh-field\s*\{([^}]*)\}/);
    expect(rule, "no `.nh-field` rule in forms.css").not.toBeNull();
    expect(rule![1]).toMatch(/display:\s*grid/);
    // If `.nh-field` ever gains `align-content`, the codex-scoped rule below can go.
    expect(rule![1]).not.toMatch(/align-content/);
  });
});

describe("the fix: the three composer containers, and only those", () => {
  const CONTAINERS = [".codex-composer-meta", ".codex-downtime-form", ".codex-downtime-edit"];

  it("scopes `align-content: start` to each container's own `.nh-field` children", () => {
    const css = withoutComments(CODEX_CSS);
    for (const container of CONTAINERS) {
      const selector = new RegExp(`\\${container} > \\.nh-field[^{]*\\{[^}]*align-content:\\s*start|\\${container} > \\.nh-field\\s*,`);
      expect(css, `${container} no longer keeps its fields' rows from stretching`).toMatch(selector);
    }
    // One `align-content: start` block for all three rows.
    const block = css.match(/([^{}]*)\{\s*align-content:\s*start;?\s*\}/);
    expect(block, "no `align-content: start` block in codex.css").not.toBeNull();
    for (const container of CONTAINERS) expect(block![1]).toContain(`${container} > .nh-field`);
  });

  it("never puts it on a bare `.nh-field`, which would break every field that wants the stretch", () => {
    // Must not apply to bare `.nh-field`: `CodexEditor fill` and textarea fields rely on stretching.
    const bare = withoutComments(CODEX_CSS)
      .split("}")
      .map((chunk) => chunk.split("{"))
      .filter(([selector, body]) => body !== undefined && /align-content/.test(body))
      .map(([selector]) => selector.split(",").map((part) => part.trim()))
      .flat()
      .filter((selector) => selector === ".nh-field");
    expect(bare, "`align-content` applied to a bare `.nh-field`").toEqual([]);
  });
});

describe("the copy half: the two help sentences that set the tall row are gone", () => {
  it("leaves 'Date played' and downtime's 'Who' with no help string", () => {
    // These two help strings were removed; the downtime edit row's help stays.
    expect(read("src/codex/SessionsView.tsx")).not.toContain("The real-world date. The Calendar holds in-world dates.");
    expect(read("src/codex/DowntimeView.tsx")).not.toContain("Pick a character page, or type a name.");
  });
});

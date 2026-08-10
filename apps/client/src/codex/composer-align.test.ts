/**
 * `5b` / `5e.1` / `5e.2` — a field keeps its own height in a row of fields.
 *
 * **What this file can and cannot prove**, on the split `forms-band.test.tsx` established: jsdom loads
 * no stylesheet and lays out no boxes, so it cannot measure that the tops line up. What it CAN hold is
 * the source wiring — the premise the fix rests on, the rule that answers it, and the scope that rule
 * must not escape. The geometry itself is measured in a real browser (the composer probe reported, at
 * 1280px before the fix: `.codex-composer-meta` top spread 23.5px, `.codex-downtime-form` 23.5px with
 * Activity's input standing 67.5px against its neighbours' 44px, `.codex-downtime-edit` 33.25px; 0px
 * everywhere after, at 390px and 1280px both).
 *
 * The mechanism, because the register had it backwards and the plan named the wrong display type:
 * `.nh-field` is a grid with a gap and NO `align-content`, so a parent that stretches it — flex AND
 * grid both do by default — grows its auto rows and takes the control down with them. Put one 3-row
 * field (label + control + help sentence) beside two 2-row ones and it is the SIBLINGS that move; the
 * helped field is the one that stays put.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** `import.meta.url` is rewritten by Vite, so sources are located from the workspace root (vocabulary.test.ts's note). */
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const CODEX_CSS = read("src/codex/codex.css");
const FORMS_CSS = read("../../packages/ui/src/primitives/forms.css");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the premise: .nh-field does not align its own content", () => {
  it("leaves `.nh-field` a bare grid + gap, so its rows still stretch when a parent stretches it", () => {
    const rule = withoutComments(FORMS_CSS).match(/\.nh-field\s*\{([^}]*)\}/);
    expect(rule, "no `.nh-field` rule in forms.css").not.toBeNull();
    expect(rule![1]).toMatch(/display:\s*grid/);
    // The day this gains its own `align-content`, the codex-scoped rules below are dead weight and
    // should go — which is a thing to notice here rather than to leave behind as a puzzle.
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
    // …and they really do land in one `align-content: start` block, not three lookalike selectors.
    const block = css.match(/([^{}]*)\{\s*align-content:\s*start;?\s*\}/);
    expect(block, "no `align-content: start` block in codex.css").not.toBeNull();
    for (const container of CONTAINERS) expect(block![1]).toContain(`${container} > .nh-field`);
  });

  it("never puts it on a bare `.nh-field`, which would break every field that wants the stretch", () => {
    // `CodexEditor fill` and the textarea fields rely on the row growing to the field's height. A
    // selector list is fine; a rule whose selector is only `.nh-field` is the regression.
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
    // Matched as whole sentences rather than by counting `help=`, because the point is these two
    // specific strings — the edit row's "Days cannot be changed after logging" deliberately stays,
    // and the CSS rule above is what keeps its neighbours aligned anyway.
    expect(read("src/codex/SessionsView.tsx")).not.toContain("The real-world date. The Calendar holds in-world dates.");
    expect(read("src/codex/DowntimeView.tsx")).not.toContain("Pick a character page, or type a name.");
  });
});

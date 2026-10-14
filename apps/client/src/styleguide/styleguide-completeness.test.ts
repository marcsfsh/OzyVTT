/**
 * "A new primitive isn't done until it appears in `/styleguide`", enforced. Parses
 * `packages/ui/src/index.ts` for exported value identifiers, keeps the capitalized ones (components),
 * drops SCREAMING_CASE constants, and requires each to appear as `<Name` in the styleguide.
 * This proves presence, not demo quality; that remains a review question.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONVENTION_SHAPE, UI_SRC, walk } from "../design-conventions-shape";

const STYLEGUIDE_DIR = `${process.cwd()}/src/styleguide`;

/**
 * Components exported from `@vtt/ui` that legitimately cannot be demoed, each with its reason. An
 * entry must be a real candidate export and genuinely absent from the styleguide (checked below), so
 * the list cannot be padded.
 */
const NON_VISUAL: ReadonlyArray<readonly [name: string, why: string]> = [];

/**
 * Value exports from the barrel's `export { … } from "…"` blocks; `type X` members are dropped.
 * `X as Y` yields Y, the name the app imports and the styleguide must render; taking the local name
 * would check an alias under an already-demoed name.
 */
function valueExports(barrel: string): string[] {
  const names = new Set<string>();
  for (const block of barrel.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
    for (const raw of block[1].split(",")) {
      const part = raw.trim().replace(/\/\/.*$/, "").trim();
      if (!part || part.startsWith("type ")) continue;
      const segments = part.split(/\s+as\s+/);
      const name = segments[segments.length - 1].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

describe("every primitive is demoed in /styleguide", () => {
  const barrel = readFileSync(`${UI_SRC}/index.ts`, "utf8");
  const values = valueExports(barrel);
  // Capitalized minus SCREAMING_CASE, mechanically, so new constants need no maintenance here.
  const candidates = values.filter((name) => /^[A-Z]/.test(name) && !/^[A-Z_0-9]+$/.test(name));

  // The styleguide's own files, pinned; if the demo splits across files, this list changes with it.
  const files = walk(STYLEGUIDE_DIR, (n) => !n.includes(".test."));
  const demoed = files.filter((n) => n.endsWith(".tsx")).map((n) => readFileSync(`${STYLEGUIDE_DIR}/${n}`, "utf8")).join("\n");

  it("reads the whole barrel and the whole styleguide", () => {
    expect(
      files,
      `the styleguide directory listing changed.\n  discovered: ${JSON.stringify(files)}\n  pinned:     ${JSON.stringify(CONVENTION_SHAPE.styleguideFiles)}\n` +
        `Fix: if the demo genuinely split across more files, update CONVENTION_SHAPE.styleguideFiles in design-conventions-shape.ts in the same commit — the check below reads every .tsx in this list.`
    ).toEqual([...CONVENTION_SHAPE.styleguideFiles]);
    expect(
      candidates.length,
      `${candidates.length} renderable components parsed out of packages/ui/src/index.ts; the floor is ${CONVENTION_SHAPE.styleguideComponentFloor}.\n` +
        `A parse that silently matched nothing would pass this file forever, so it fails here first.\n` +
        `Fix: restore the parse. If @vtt/ui genuinely shrank, lower CONVENTION_SHAPE.styleguideComponentFloor in the same commit.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.styleguideComponentFloor);
  });

  const excused = new Set(NON_VISUAL.map(([name]) => name));

  it("demos every component @vtt/ui exports", () => {
    const missing = candidates.filter((name) => !excused.has(name) && !new RegExp(`<${name}\\b`).test(demoed));
    expect(
      missing,
      `These are exported from @vtt/ui and appear nowhere in the styleguide, so nobody can see what they look like — and the next person hand-rolls one.\n` +
        `Fix: add a section (or a row in an existing section) to apps/client/src/styleguide/StyleGuide.tsx rendering each, with the states that matter.\n` +
        `(design-language.md:36-40: "A new primitive isn't done until it appears in /styleguide.")`
    ).toEqual([]);
  });

  it("has no NON_VISUAL entry that is dead or dishonest", () => {
    for (const [name, why] of NON_VISUAL) {
      expect(
        candidates,
        `NON_VISUAL names ${JSON.stringify(name)}, which is not a renderable export of @vtt/ui (capitalized, a value, not SCREAMING_CASE).\n` +
          `Fix: delete the entry. A name that is not a candidate excuses nothing and only makes the list look longer than the policy is.`
      ).toContain(name);
      expect(
        new RegExp(`<${name}\\b`).test(demoed),
        `NON_VISUAL excuses ${JSON.stringify(name)} as "${why}", but the styleguide demos it.\nFix: delete the entry — the exemption is describing something that is not true.`
      ).toBe(false);
    }
    expect(
      NON_VISUAL.length,
      `NON_VISUAL holds ${NON_VISUAL.length} entries; design-conventions-shape.ts pins ${CONVENTION_SHAPE.nonVisualCount}.\n` +
        `It started EMPTY, measured — every component @vtt/ui exported was already demoed. Every entry added is a component a reader cannot see.\n` +
        `Fix: demo it instead. If it truly cannot be demoed, add the entry WITH a reason and raise the pin in the same commit.`
    ).toBe(CONVENTION_SHAPE.nonVisualCount);
  });
});

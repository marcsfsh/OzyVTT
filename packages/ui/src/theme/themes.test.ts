import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colourDistance, contrastRatio, lab, luminance, parseColour, type Rgb } from "./colour";
import { THEME_NAMES, THEMES, type Theme } from "./theme";

// Every theme is checked the same way, from the stylesheet itself: each ink against each ground it sits on, and the
// accents that carry a meaning against one another.

const css = readFileSync(`${process.cwd()}/src/styles/design-tokens.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The top-level rules whose selector is exactly `:root` or one `[data-theme="..."]`, in source order. */
function themeBlocks(): ReadonlyArray<readonly [Theme | "root", string]> {
  const blocks: Array<readonly [Theme | "root", string]> = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = 0;
  let selector = "";
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === "{") {
      if (depth === 0) {
        selector = css.slice(selectorStart, index).trim();
        bodyStart = index + 1;
      }
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        const theme = /^\[data-theme="(\w+)"\]$/.exec(selector)?.[1];
        if (selector === ":root") blocks.push(["root", css.slice(bodyStart, index)]);
        else if (theme) blocks.push([theme as Theme, css.slice(bodyStart, index)]);
        selectorStart = index + 1;
      }
    }
  }
  return blocks;
}

function declarations(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found[match[1]] = match[2].trim();
  return found;
}

/** Each theme's tokens: the `:root` values with its own blocks laid over them. `dark` is `:root` alone. */
function tokensOf(theme: Theme): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [owner, body] of themeBlocks()) if (owner === "root") Object.assign(tokens, declarations(body));
  if (theme !== "dark")
    for (const [owner, body] of themeBlocks()) if (owner === theme) Object.assign(tokens, declarations(body));
  return tokens;
}

function colourOf(tokens: Record<string, string>, name: string): Rgb {
  let value = tokens[name];
  for (let hop = 0; hop < 10 && value?.startsWith("var("); hop++) value = tokens[value.slice(4, -1).trim()];
  const colour = value === undefined ? null : parseColour(value);
  if (!colour) throw new Error(`${name} is not a plain colour: ${value}`);
  return colour;
}

const TEXT_INKS = [
  "--text",
  "--text-dim",
  "--text-muted",
  "--heading-ink",
  "--magenta-text",
  "--indigo-text",
  "--danger-text",
  "--caution-hi",
  "--cyan-hi",
  "--violet-hi"
] as const;
const SURFACES = ["--void", "--bg", "--surface-1", "--surface-2", "--surface-3"] as const;
/** The accents that each mean one thing: the primary, selection, GM-only, caution and danger. */
const MEANINGS = ["--magenta", "--cyan", "--violet", "--caution", "--danger"] as const;

describe("the themes", () => {
  it("are Night, Dusk, Dawn and Day, each with a block in the stylesheet", () => {
    expect(THEMES.map((theme) => THEME_NAMES[theme])).toEqual(["Night", "Dusk", "Dawn", "Day"]);
    const styled = new Set(themeBlocks().map(([owner]) => owner));
    for (const theme of THEMES) expect(styled.has(theme === "dark" ? "root" : theme), theme).toBe(true);
  });

  for (const theme of THEMES) {
    describe(THEME_NAMES[theme], () => {
      const tokens = tokensOf(theme);

      it("prints every text ink at 4.5:1 or more on every surface", () => {
        for (const ink of TEXT_INKS)
          for (const surface of SURFACES) {
            const ratio = contrastRatio(colourOf(tokens, ink), colourOf(tokens, surface));
            expect(ratio, `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
      });

      it("prints the primary's label and the on-state's label at 4.5:1 on their own fills", () => {
        const primary = contrastRatio(colourOf(tokens, "--primary-ink"), colourOf(tokens, "--primary-base"));
        expect(primary, "--primary-ink on --primary-base").toBeGreaterThanOrEqual(4.5);
        const on = colourOf(tokens, "--state-on");
        expect(contrastRatio(colourOf(tokens, "--text-on-neon"), on), "label on --state-on").toBeGreaterThanOrEqual(
          4.5
        );
        for (const surface of SURFACES)
          expect(contrastRatio(on, colourOf(tokens, surface)), `--state-on on ${surface}`).toBeGreaterThanOrEqual(3);
      });

      it("keeps the words on the sky readable from top to horizon", () => {
        const stops = [...(tokens["--sky-wash"] ?? "").matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0]);
        expect(stops.length, "--sky-wash stops").toBeGreaterThan(2);
        for (const ink of ["--text", "--text-dim", "--text-muted"])
          for (const stop of stops)
            expect(
              contrastRatio(colourOf(tokens, ink), parseColour(stop)!),
              `${ink} on ${stop}`
            ).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps the primary, selection, GM-only, caution and danger hues apart", () => {
        for (const [index, first] of MEANINGS.entries())
          for (const second of MEANINGS.slice(index + 1))
            expect(
              colourDistance(colourOf(tokens, first), colourOf(tokens, second)),
              `${first} against ${second}`
            ).toBeGreaterThanOrEqual(30);
      });
    });
  }

  it("makes Dawn a light theme on a warm ground, apart from Day's cool one and Dusk's dark one", () => {
    const [dawn, day, dusk] = (["dawn", "light", "dusk"] as const).map(tokensOf);
    for (const surface of ["--bg", "--surface-1"]) {
      expect(luminance(colourOf(dawn, surface)), `Dawn ${surface}`).toBeGreaterThan(0.75);
      expect(luminance(colourOf(dusk, surface)), `Dusk ${surface}`).toBeLessThan(0.1);
      // b* above zero leans yellow (warm); below leans blue (cool).
      expect(lab(colourOf(dawn, surface))[2], `Dawn ${surface} warmth`).toBeGreaterThan(3);
      expect(lab(colourOf(day, surface))[2], `Day ${surface} warmth`).toBeLessThan(0);
    }
    expect(colourDistance(colourOf(dawn, "--text"), colourOf(day, "--text"))).toBeGreaterThan(5);
  });
});

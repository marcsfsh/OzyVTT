import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  colourDistance,
  composite,
  contrastRatio,
  luminance,
  parseColour,
  parseColourAlpha,
  type Rgb,
  type Rgba
} from "./colour";
import { THEME_NAMES, THEMES, type Theme } from "./theme";

// Every theme is checked the same way, from the stylesheet itself: each ink against each ground it sits on, glass
// composited over the sky it floats on, the essential edges, and the accents that carry a meaning against one another.

const css = readFileSync(`${process.cwd()}/src/styles/design-tokens.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const design = readFileSync(`${process.cwd()}/../../docs/DESIGN.md`, "utf8");

/** Every top-level rule, with its selector and body, in source order. At-rules keep their prelude as the selector. */
function topLevelRules(): ReadonlyArray<readonly [selector: string, body: string]> {
  const rules: Array<readonly [string, string]> = [];
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
        rules.push([selector, css.slice(bodyStart, index)]);
        selectorStart = index + 1;
      }
    }
  }
  return rules;
}

function declarations(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found[match[1]] = match[2].trim();
  return found;
}

const rootBody = () =>
  topLevelRules()
    .filter(([selector]) => selector === ":root")
    .map(([, body]) => body)
    .join("\n");
const themeBody = (theme: Theme) =>
  topLevelRules()
    .filter(([selector]) => selector === `[data-theme="${theme}"]`)
    .map(([, body]) => body)
    .join("\n");

/** Each theme's tokens: the `:root` values with its own block laid over them. Dusk is `:root` alone. */
function tokensOf(theme: Theme, ...overlays: string[]): Record<string, string> {
  const tokens = declarations(rootBody());
  if (theme !== "dusk") Object.assign(tokens, declarations(themeBody(theme)));
  for (const overlay of overlays) Object.assign(tokens, declarations(overlay));
  return tokens;
}

function resolved(tokens: Record<string, string>, name: string): string | undefined {
  let value = tokens[name];
  for (let hop = 0; hop < 10 && value?.startsWith("var("); hop++) value = tokens[value.slice(4, -1).trim()];
  return value;
}

function colourOf(tokens: Record<string, string>, name: string): Rgb {
  const value = resolved(tokens, name);
  const colour = value === undefined ? null : parseColour(value);
  if (!colour) throw new Error(`${name} is not a plain colour: ${value}`);
  return colour;
}

function rgbaOf(tokens: Record<string, string>, name: string): Rgba {
  const value = resolved(tokens, name);
  const colour = value === undefined ? null : parseColourAlpha(value);
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
  "--violet-hi",
  "--hp-text"
] as const;
const SURFACES = ["--void", "--bg", "--surface-1", "--surface-2", "--surface-3"] as const;
const GLASS = ["--glass-bg", "--glass-void", "--glass-surface-1", "--glass-surface-2", "--glass-surface-3"] as const;
/** The accents that each mean one thing: press this, selection, GM-only, caution and danger. */
const MEANINGS = ["--magenta", "--cyan", "--violet", "--caution", "--danger"] as const;

/**
 * The colours a glass plate can land on over the Dusk sky: each stop of its linear wash, and each stop under the
 * rose afterglow at its strongest. The afterglow fades out from there, so these bound every point of the sky.
 */
function skyGrounds(tokens: Record<string, string>): Rgb[] {
  const sky = tokens["--sky"];
  const glow = /radial-gradient\([^,]+,\s*(rgba\([^)]*\))/.exec(sky)?.[1];
  const wash = [...(/linear-gradient\((.*)\)\s*$/.exec(sky)?.[1] ?? "").matchAll(/#[0-9a-f]{6}/gi)].map((match) =>
    parseColour(match[0])!
  );
  expect(glow, "--sky afterglow").toBeDefined();
  expect(wash.length, "--sky wash stops").toBeGreaterThanOrEqual(2);
  return [...wash, ...wash.map((stop) => composite(parseColourAlpha(glow!)!, stop))];
}

describe("the themes", () => {
  it("are Dusk and Dawn: Dusk is :root, and Dawn is the only theme block", () => {
    expect(THEMES.map((theme) => THEME_NAMES[theme])).toEqual(["Dusk", "Dawn"]);
    const themed = topLevelRules()
      .map(([selector]) => selector)
      .filter((selector) => selector.includes("data-theme"));
    for (const selector of themed) expect(selector, "a theme selector").not.toMatch(/"(dark|light|night|day)"/);
    expect(themed.filter((selector) => /^\[data-theme="\w+"\]$/.test(selector))).toEqual(['[data-theme="dawn"]']);
    expect(themeBody("dusk"), "no Dusk block: its values are :root").toBe("");
  });

  it("match the colour table in DESIGN.md, solid and glass", () => {
    const cells = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1].replace(/\s/g, ""));
    const rows = design
      .split("\n")
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .filter((row) => row[2]?.startsWith("`--") && /^`(#|rgba)/.test(row[3] ?? ""));
    expect(rows.length, "colour table rows").toBeGreaterThan(25);
    const flat = (value: string | undefined) => value?.replace(/\s/g, "");
    const [dusk, dawn] = [tokensOf("dusk"), tokensOf("dawn")];
    for (const [, meaning, names, duskCell, dawnCell] of rows) {
      const tokenNames = [...names.matchAll(/`(--[\w-]+)`/g)].map((match) => match[1]);
      if (tokenNames.includes("--grad-sun")) {
        // The gradient's stops, in order; its last stop is the theme's magenta.
        const stops = cells(duskCell);
        expect(dusk["--grad-sun"], "--grad-sun").toContain(stops[0]);
        expect(dusk["--grad-sun"]).toContain(stops[1]);
        expect(resolved(dusk, "--magenta")).toBe(stops[2]);
        continue;
      }
      const [duskSolid, duskGlass] = cells(duskCell);
      const dawnValue = dawnCell === "the same" ? duskSolid : cells(dawnCell)[0];
      for (const name of tokenNames) {
        expect(flat(resolved(dusk, name)), `Dusk ${name} (${meaning})`).toBe(duskSolid);
        expect(flat(resolved(dawn, name)), `Dawn ${name} (${meaning})`).toBe(dawnValue);
        if (duskGlass) expect(flat(dusk[`--glass-${name.slice(2)}`]), `Dusk glass for ${name}`).toBe(duskGlass);
      }
    }
  });

  for (const theme of THEMES) {
    describe(THEME_NAMES[theme], () => {
      const tokens = tokensOf(theme);

      it("prints every text ink at 4.5:1 or more on every solid surface", () => {
        for (const ink of TEXT_INKS)
          for (const surface of SURFACES) {
            const ratio = contrastRatio(colourOf(tokens, ink), colourOf(tokens, surface));
            expect(ratio, `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
      });

      it("prints the primary's label and the on-state's label at 4.5:1 on their own fills", () => {
        const primary = contrastRatio(colourOf(tokens, "--primary-ink"), colourOf(tokens, "--primary-base"));
        expect(primary, "--primary-ink on --primary-base").toBeGreaterThanOrEqual(4.5);
        const on = contrastRatio(colourOf(tokens, "--state-on-ink"), colourOf(tokens, "--state-on"));
        expect(on, "--state-on-ink on --state-on").toBeGreaterThanOrEqual(4.5);
      });

      it("draws the essential edges at 3:1 or more against every surface", () => {
        for (const edge of ["--state-on-edge", "--focus-ring"])
          for (const surface of SURFACES)
            expect(
              contrastRatio(colourOf(tokens, edge), colourOf(tokens, surface)),
              `${edge} on ${surface}`
            ).toBeGreaterThanOrEqual(3);
        // The selected fill carries its own edge, so the edge has to stand apart from the fill too.
        expect(contrastRatio(colourOf(tokens, "--state-on-edge"), colourOf(tokens, "--state-on-ink"))).toBeGreaterThan(
          3
        );
      });

      it("keeps the meanings' hues apart", () => {
        for (const [index, first] of MEANINGS.entries())
          for (const second of MEANINGS.slice(index + 1))
            expect(
              colourDistance(colourOf(tokens, first), colourOf(tokens, second)),
              `${first} against ${second}`
            ).toBeGreaterThanOrEqual(30);
      });
    });
  }

  it("composites Dusk's glass over the sky to grounds every text ink still reads on", () => {
    const tokens = tokensOf("dusk");
    for (const ground of skyGrounds(tokens))
      for (const plate of GLASS) {
        const bottom = composite(rgbaOf(tokens, plate), ground);
        // A control or well sits on a panel or a bar: the second pane of glass over the first.
        const stacks: Array<readonly [string, Rgb]> = [
          [plate, bottom],
          ...(["--glass-void", "--glass-surface-2", "--glass-surface-3"] as const).map(
            (top) => [`${top} on ${plate}`, composite(rgbaOf(tokens, top), bottom)] as const
          )
        ];
        for (const [stack, surface] of stacks)
          for (const ink of TEXT_INKS)
            expect(
              contrastRatio(colourOf(tokens, ink), surface),
              `${ink} on ${stack} over ${ground.join(",")}`
            ).toBeGreaterThanOrEqual(4.5);
      }
  });

  it("makes Dawn's glass solid, and the same for reduced transparency and a browser without blur", () => {
    const reduced = topLevelRules().find(([selector]) => selector === ':root[data-transparency="reduced"]')?.[1];
    const noBlur = topLevelRules().find(([selector]) => selector.startsWith("@supports not"))?.[1];
    expect(reduced, "the reduced-transparency block").toBeDefined();
    expect(noBlur, "the no-backdrop-filter block").toBeDefined();
    const cases: Array<readonly [string, Record<string, string>]> = [
      ["Dawn", tokensOf("dawn")],
      ["Dusk reduced", tokensOf("dusk", reduced!)],
      ["Dawn reduced", tokensOf("dawn", reduced!)],
      ["Dusk without blur", tokensOf("dusk", noBlur!.replace(/^[^{]*\{/, ""))]
    ];
    for (const [name, tokens] of cases) {
      for (const plate of GLASS)
        expect(resolved(tokens, plate), `${name} ${plate}`).toBe(resolved(tokens, plate.replace("glass-", "")));
      expect(tokens["--glass-blur"], `${name} blur`).toBe("none");
    }
  });

  it("lays no scanlines over the app in any theme (ADR-0045)", () => {
    expect(css).not.toMatch(/scanline/i);
    expect(css).not.toMatch(/body::after/);
  });

  it("makes Dawn light paper with no pure white and no harsh black, and Dusk dark", () => {
    const [dusk, dawn] = [tokensOf("dusk"), tokensOf("dawn")];
    for (const surface of SURFACES) {
      expect(luminance(colourOf(dawn, surface)), `Dawn ${surface}`).toBeGreaterThan(0.7);
      expect(luminance(colourOf(dawn, surface)), `Dawn ${surface}`).toBeLessThan(1);
      expect(luminance(colourOf(dusk, surface)), `Dusk ${surface}`).toBeLessThan(0.05);
    }
    expect(luminance(colourOf(dawn, "--text")), "Dawn ink").toBeGreaterThan(0.01);
  });
});

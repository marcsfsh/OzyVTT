/**
 * Rules from docs/DESIGN.md, checked on the source:
 *   (a) icons are SVG, never a text glyph or an emoji
 *   (b) no raw search or number input where a primitive exists
 *   (c) one eyebrow, the `Eyebrow` primitive
 *   (d) colours come from design-tokens.css
 *   (e) feedback is a toast, and a component shows no inline message of its own
 *   (f) one breakpoint ladder
 *   (g) no viewport-fraction caps on in-flow content
 *   (h) scroll regions are declared with `.scroll-y`
 *
 * Where a rule has known offenders they are listed with a reason; a new offender fails, and so does a
 * row that excuses nothing, so a fixed offender loses its row. Source text only: inline styles and
 * runtime colours are left to review.
 */
import { describe, expect, it } from "vitest";
import {
  allTsx,
  appStylesheets,
  lineOf,
  playTsx,
  scannedTsx,
  stripBlockComments,
  stripComments,
  stylesheets,
  type Source
} from "./convention-sources";

/** One occurrence of something a rule polices: `key` is what an allowlist row names. */
interface Hit {
  key: string;
  at: string;
}

/** `file:line  detail`, so a failure is a jump target. */
const cite = (path: string, src: string, index: number, detail: string): string =>
  `${path}:${lineOf(src, index)}  ${detail}`;

/**
 * Every hit must be excused by a row (rows count with multiplicity) and every row must excuse a hit.
 * Returns the two failure lists so each rule can explain its own fix.
 */
function settle(hits: readonly Hit[], rows: readonly string[]) {
  const remaining = [...rows];
  const unexcused: string[] = [];
  for (const hit of hits) {
    const index = remaining.indexOf(hit.key);
    if (index >= 0) remaining.splice(index, 1);
    else unexcused.push(hit.at);
  }
  return { unexcused, dead: remaining };
}

function hitsOf(
  sources: readonly Source[],
  pattern: RegExp,
  strip: (src: string) => string,
  key: (match: RegExpMatchArray, path: string) => string
) {
  const hits: Hit[] = [];
  for (const source of sources) {
    const src = strip(source.read());
    for (const match of src.matchAll(pattern))
      hits.push({ key: key(match, source.path), at: cite(source.path, src, match.index!, match[0].trim()) });
  }
  return hits;
}

describe("the scans read the tree", () => {
  // A walk that silently stopped finding files would pass every rule below.
  it.each([
    ["play .tsx", playTsx, "apps/client/src/shell/App.tsx"],
    ["primitives", scannedTsx, "packages/ui/src/primitives/Button.tsx"],
    ["every source", allTsx, "apps/client/src/codex/CodexShell.tsx"],
    ["stylesheets", stylesheets, "packages/ui/src/styles/design-tokens.css"],
    ["app stylesheets", appStylesheets, "apps/client/src/styles.css"]
  ])("%s include %s", (_name, scan, anchor) => {
    expect(scan().map((source) => source.path)).toContain(anchor);
  });
});

// (a) Icons are SVG

/**
 * `\p{Extended_Pictographic}` alone misses most real offenders (⏻ ⇲ ✕ ▾ ✓ ← are not pictographic), so
 * the arrow, technical, geometric, dingbat and arrows-B blocks are added. Typography and maths
 * (the minus sign, the times sign, the middle dot, the ellipsis, the dashes and curly quotes) fall outside them and stay legal.
 */
const GLYPH = /[←-⇿⌀-⏿■-◿☀-➿⬀-⯿]|\p{Extended_Pictographic}/gu;

describe("(a) icons are SVG, never a text glyph", () => {
  it("renders no symbol or emoji character", () => {
    // Comments are stripped first; what survives is in a string or JSX text, so a person sees it.
    const hits = hitsOf(scannedTsx(), GLYPH, stripComments, (match) => match[0]);
    expect(
      hits.map((hit) => hit.at),
      "A glyph rendered as text is a different typeface at the wrong size, and on a phone it is an emoji in a hue " +
        "this palette does not own. Render an icon from @vtt/ui (packages/ui/src/primitives/icons.tsx), adding one " +
        "there if it is missing, or say it in words."
    ).toEqual([]);
  });
});

// (b) Raw form elements

/** A lowercase `<input` is never the primitive. `[^>]*` keeps the match inside one element, across lines. */
const rawInput = (type: string) => new RegExp(`<input\\b[^>]*type="${type}"`, "g");

/** Raw number inputs still to move to `NumberField`; each is a compact inline field the primitive's steppers would crowd. */
const RAW_NUMBER_ALLOW: readonly string[] = [
  "apps/client/src/encounter/GmInitiativeRow.tsx",
  // The X and Y of a point and the focus zoom.
  "apps/client/src/viewer/ViewerControls.tsx",
  "apps/client/src/viewer/ViewerControls.tsx",
  "apps/client/src/viewer/ViewerControls.tsx"
];

describe("(b) no raw input where a primitive exists", () => {
  it('uses <Input type="search">, never a raw search input', () => {
    const hits = hitsOf(playTsx(), rawInput("search"), stripComments, (_match, path) => path);
    expect(
      hits.map((hit) => hit.at),
      "The primitive carries the label wiring, the invalid state, the 44px target and the theme."
    ).toEqual([]);
  });

  it("uses NumberField for a number, outside the listed fields", () => {
    const { unexcused, dead } = settle(
      hitsOf(playTsx(), rawInput("number"), stripComments, (_match, path) => path),
      RAW_NUMBER_ALLOW
    );
    expect(unexcused, 'Use NumberField (or <Input type="number">) from @vtt/ui.').toEqual([]);
    expect(dead, "These RAW_NUMBER_ALLOW rows excuse nothing any more: delete them.").toEqual([]);
  });
});

// (c) One eyebrow

/** Every `className=` value, braces balanced so `className={cx("a", `b ${c}`)}` comes out whole. */
function classNameValues(src: string): { value: string; index: number }[] {
  const values: { value: string; index: number }[] = [];
  for (const match of src.matchAll(/className\s*=\s*/g)) {
    const start = match.index + match[0].length;
    if (src[start] === '"' || src[start] === "'") {
      const end = src.indexOf(src[start], start + 1);
      if (end > start) values.push({ value: src.slice(start + 1, end), index: start });
    } else if (src[start] === "{") {
      let depth = 0;
      for (let i = start; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) {
          values.push({ value: src.slice(start + 1, i), index: start });
          break;
        }
      }
    }
  }
  return values;
}

describe("(c) one eyebrow, the Eyebrow primitive", () => {
  it("renders no local eyebrow class", () => {
    const hits: Hit[] = [];
    for (const source of allTsx()) {
      const src = stripComments(source.read());
      // A class token: `\beyebrow\b` would match `viewer-eyebrow`.
      for (const { value, index } of classNameValues(src))
        if (value.split(/[^A-Za-z0-9_-]+/).includes("eyebrow"))
          hits.push({ key: source.path, at: cite(source.path, src, index, value.trim().slice(0, 60)) });
    }
    expect(
      hits.map((hit) => hit.at),
      "Render <Eyebrow> from @vtt/ui; it owns the tracking, size and colour."
    ).toEqual([]);
  });

  it("declares no local eyebrow class", () => {
    const hits = hitsOf(stylesheets(), /(?<![\w-])\.eyebrow(?![\w-])/g, stripBlockComments, (_match, path) => path);
    expect(hits.map((hit) => hit.at)).toEqual([]);
  });
});

// (d) Colours come from design-tokens.css

/**
 * `#rrggbb`, data-URI `%23rrggbb` and `rgb()`/`hsl()` literals, comments stripped. `color-mix()` over
 * vars is fine and not matched.
 */
const COLOR = /#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,6}|rgba?\(|hsla?\(/g;

/** Literal counts per file, each with the reason it cannot be a token. */
const COLOR_ALLOW: ReadonlyArray<readonly [file: string, count: number, why: string]> = [
  ["apps/client/src/actors/pdf-import.css", 5, "import-status hues (amber/red/violet) that never became tokens"],
  ["apps/client/src/maps/calibration.css", 11, "SVG paint: grid strokes and drop-shadows over image content"],
  ["apps/client/src/scene/annotation.css", 3, "SVG paint: annotation strokes over image content"],
  ["apps/client/src/scene/encounter-map.css", 8, "SVG paint, and the black/white pair a token ring needs on any map"],
  ["apps/client/src/styles.css", 2, "a two-stop black mask, read only for its alpha"],
  ["apps/client/src/viewer/viewer-controls.css", 1, "the white A/B measurement labels, over arbitrary map art"],
  ["apps/client/src/viewer/viewer.css", 6, "SVG paint and a scrim over the projected map"],
  ["packages/ui/src/primitives/Combobox.css", 1, "a shadow over an arbitrary backdrop"],
  ["packages/ui/src/primitives/Tabs.css", 10, "ten black-alpha stops in one shadow ladder"],
  ["packages/ui/src/primitives/forms.css", 1, "a data-URI SVG chevron, which cannot reference var()"]
];

describe("(d) colours come from design-tokens.css", () => {
  it("hand-types a colour only where listed", () => {
    const sources = stylesheets().filter((source) => !source.path.endsWith("/design-tokens.css"));
    const { unexcused, dead } = settle(
      hitsOf(sources, COLOR, stripBlockComments, (_match, path) => path),
      COLOR_ALLOW.flatMap(([file, count]) => Array<string>(count).fill(file))
    );
    expect(
      unexcused,
      "Add a token to packages/ui/src/styles/design-tokens.css and use var(--…): a literal cannot follow the theme. " +
        "If it truly cannot be a token (SVG paint over map art, a data-URI), add it to COLOR_ALLOW with the reason."
    ).toEqual([]);
    expect(dead, "COLOR_ALLOW excuses literals that are gone: lower or delete those rows.").toEqual([]);
  });
});

// (e) Feedback is a toast

/**
 * A component's own `message` state is a second notification channel, often off-screen on a phone.
 * A setter named `setMessage`/`setFeedback` that is not user feedback should be renamed.
 */
const FEEDBACK = /\bset(?:Message|Feedback)\s*\(/g;

/** Surfaces still to move to `useToast`, one row per call. */
const FEEDBACK_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/encounter/GmEncounterPanel.tsx", 6],
  ["apps/client/src/encounter/InitiativePrompt.tsx", 2],
  ["apps/client/src/encounter/MonsterBrowser.tsx", 1],
  ["apps/client/src/encounter/PlayerEncounterPanel.tsx", 1],
  ["apps/client/src/scene/TokenContextMenu.tsx", 4],
  ["apps/client/src/viewer/ScreenPairing.tsx", 4],
  ["apps/client/src/viewer/ViewerApp.tsx", 2]
];

describe("(e) feedback is a toast", () => {
  it("keeps inline feedback state only where listed", () => {
    const { unexcused, dead } = settle(
      hitsOf(scannedTsx(), FEEDBACK, stripComments, (_match, path) => path),
      FEEDBACK_ALLOW.flatMap(([file, count]) => Array<string>(count).fill(file))
    );
    expect(unexcused, "Call toast(...) from useToast() in @vtt/ui.").toEqual([]);
    expect(dead, "FEEDBACK_ALLOW excuses calls that are gone: lower or delete those rows.").toEqual([]);
  });
});

// (f) One breakpoint ladder

/**
 * max-width 760/650/560 and min-width 850/980/1280, plus each direction's complement of the other's
 * rungs, so `max-width: 849px` and `min-width: 850px` never both fire.
 */
const LADDER = { max: [560, 650, 760, 849, 979], min: [561, 651, 761, 850, 980, 1280] };

describe("(f) one breakpoint ladder", () => {
  it("declares every @media width on a rung", () => {
    const off: string[] = [];
    for (const source of stylesheets()) {
      const src = source.read();
      for (const media of src.matchAll(/@media[^{]*/g))
        for (const query of media[0].matchAll(/\((min|max)-width:\s*(\d+)px/g))
          if (!LADDER[query[1] as "min" | "max"].includes(Number(query[2])))
            off.push(cite(source.path, src, media.index, `${query[1]}-width: ${query[2]}px`));
    }
    expect(off, "Reuse a rung. If the ladder itself is wrong, change it here and in docs/DESIGN.md together.").toEqual(
      []
    );
  });
});

// (g) No viewport-fraction caps on in-flow content

/**
 * A viewport-fraction cap on in-flow content (`max-height: 64vh`) stands in for a frame. Allowed
 * without a row: `100dvh`/`100svh`, and `100vh` beside a `dvh` value on the same or next line (the
 * fallback pair) or under a `:fullscreen` selector.
 */
const VIEWPORT_UNIT = /\b\d+(?:\.\d+)?(?:d|s)?vh\b/g;

/** Values that are not caps on in-flow content, with the reason. */
const VIEWPORT_ALLOW: ReadonlyArray<readonly [file: string, values: readonly string[], why: string]> = [
  ["apps/client/src/encounter/pickers.css", ["52vh"], "the cap on a picker's list in its modal"],
  ["apps/client/src/encounter/fight-menu.css", ["85vh"], "the cap on the fixed fight menu"],
  ["apps/client/src/encounter/monster-browser.css", ["92vh"], "the cap on the monster browser modal"],
  ["apps/client/src/sheet/sheet.css", ["92dvh"], "the cap on the sheet's dialog"],
  ["apps/client/src/shell/landing.css", ["4vh", "3.5vh", "4.5vh"], "clamp() middle terms for the landing's spacing"],
  ["apps/client/src/viewer/viewer.css", ["32vh"], "the shared screen's portrait initiative band"]
];

describe("(g) no viewport-fraction caps on in-flow content", () => {
  it("uses a viewport unit only as a fallback pair or where listed", () => {
    const hits: Hit[] = [];
    for (const source of appStylesheets()) {
      const src = stripBlockComments(source.read());
      const lines = src.split("\n");
      for (const match of src.matchAll(VIEWPORT_UNIT)) {
        const value = match[0];
        if (value === "100dvh" || value === "100svh") continue;
        if (value === "100vh") {
          const line = lineOf(src, match.index);
          if (/\b\d+(?:\.\d+)?dvh\b/.test(`${lines[line - 1] ?? ""} ${lines[line] ?? ""}`)) continue;
          const open = src.lastIndexOf("{", match.index);
          const selectorStart = Math.max(src.lastIndexOf("}", open), src.lastIndexOf("{", open - 1));
          if (src.slice(selectorStart + 1, open).includes(":fullscreen")) continue;
        }
        hits.push({ key: `${source.path} ${value}`, at: cite(source.path, src, match.index, value) });
      }
    }
    const { unexcused, dead } = settle(
      hits,
      VIEWPORT_ALLOW.flatMap(([file, values]) => values.map((value) => `${file} ${value}`))
    );
    expect(
      unexcused,
      "Put the region in a frame column and let it flex (`.frame-col` / `.frame-fill`). A fixed overlay's cap " +
        "goes in VIEWPORT_ALLOW with the reason."
    ).toEqual([]);
    expect(dead, "VIEWPORT_ALLOW excuses values that are gone: delete them.").toEqual([]);
  });
});

// (h) Scroll regions are declared

describe("(h) scroll regions are declared with .scroll-y", () => {
  it("has no bare overflow(-y): auto|scroll in app CSS", () => {
    // `overflow-x` is not matched: wide tables need their own horizontal scroller.
    const hits = hitsOf(appStylesheets(), /overflow(?:-y)?\s*:\s*(?:auto|scroll)/g, stripBlockComments, (_m, p) => p);
    expect(
      hits.map((hit) => hit.at),
      "Mark the region with `.scroll-y` in the markup; the utility owns the scrollbar and the gutter."
    ).toEqual([]);
  });
});

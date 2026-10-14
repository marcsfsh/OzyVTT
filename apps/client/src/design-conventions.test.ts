/**
 * Design conventions enforced as tests:
 *   (a) primitives and play surfaces never render a glyph as text
 *   (b) no raw `<input type="search">` / `type="number">` where a primitive exists
 *   (c) one `.eyebrow`, and it lives in `packages/ui`
 *   (d) no hand-typed colours outside `design-tokens.css`
 *   (e) one feedback channel: `useToast`, not a per-component inline banner
 *   (f) one breakpoint ladder
 *   (g) no viewport-fraction caps on in-flow content in app CSS
 *   (h) every scroll region in app CSS is declared with `.scroll-y`
 *
 * Each check allowlists today's offenders and fails on a new one; a fixed offender fails too, as
 * a dead row to delete. Allowlist sizes are pinned in `design-conventions-shape.ts`.
 *
 * Source text only: an imported-but-unused icon passes (a), and `color-mix()` over vars, inline
 * styles or runtime colours are invisible to (d). Those are left to review and `/styleguide`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONVENTION_SHAPE,
  PLAY_EXCLUDED,
  appStylesheets,
  assertRoots,
  eyebrowScanned,
  ladderStylesheets,
  lineOf,
  playTsx,
  scannedTsx,
  stripBlockComments,
  stripComments,
  stylesheets,
  walk,
  type Source
} from "./design-conventions-shape";

assertRoots();

/** `file:line  detail`: the shape every failure prints, so it is a jump target. */
const cite = (path: string, line: number, detail: string): string => `${path}:${line}  ${detail}`;

// (a) text glyphs

/**
 * The banned glyphs. `\p{Extended_Pictographic}` alone misses most real offenders (⏻ ⇲ ✕ ▾ ✓ ←
 * are not pictographic), so these blocks are added:
 *   U+2190-21FF arrows        ← ↑ → ↓ ↻ ⇲
 *   U+2300-23FF technical     ⏻ ⏮ ⏸ ⏭
 *   U+25A0-25FF geometric     ▢ ▦ ▩ ▴ ▹ ▶ ▾ ● ◀ ◧ ◨ ◭ ◯ ◼
 *   U+2600-27BF misc/dingbats ☀ ⚠ ⛌ ⛶ ✎ ✏ ✓ ✕ ✦
 *   U+2B00-2BFF arrows-B      ⬆ ⬇ ⭐
 * Typography and maths (− × · … – — and curly quotes) fall outside these blocks and stay legal.
 */
const GLYPH = /[←-⇿⌀-⏿■-◿☀-➿⬀-⯿]|\p{Extended_Pictographic}/gu;

/**
 * Today's offenders, one row per file, one character per violation. Each row is a call site
 * waiting on its icon from `packages/ui/src/primitives/icons.tsx`.
 */
const GLYPH_ALLOW: ReadonlyArray<readonly [file: string, glyphs: string]> = [
  ["apps/client/src/encounter/ActionRunner.tsx", "→↻▴▾⚠✕✦"],
  ["apps/client/src/encounter/CharacterSheet.tsx", "↑→✕"],
  ["apps/client/src/encounter/EncounterPanel.tsx", "→▦▶◧◨✕⭐"],
  ["apps/client/src/encounter/InitiativeList.tsx", "▶"],
  ["apps/client/src/encounter/RollControls.tsx", "✕"],
  ["apps/client/src/integrations/ApiReference.tsx", "✓⬇"],
  ["apps/client/src/integrations/IntegrationsPanel.tsx", "🔌"],
  ["apps/client/src/maps/MapManager.tsx", "←↑→↓"],
  ["apps/client/src/scenes/SceneBuilder.tsx", "✎"],
  ["apps/client/src/scenes/SceneGallery.tsx", "←→●✎🗑🗺"],
  ["apps/client/src/viewer/ViewerPreviewPanel.tsx", "✕"],
  // packages/ui: primitives that break their own rule.
  ["packages/ui/src/primitives/Button.tsx", "→"],
  ["packages/ui/src/primitives/Chip.tsx", "✕"],
  ["packages/ui/src/primitives/Menu.tsx", "▾"],
  ["packages/ui/src/primitives/Toast.tsx", "✕"]
];

interface GlyphHit { path: string; line: number; glyph: string }

function glyphHits(sources: readonly Source[]): GlyphHit[] {
  const hits: GlyphHit[] = [];
  for (const source of sources) {
    // Strip comments first; what survives is in a string literal or JSX text, so a person sees it.
    const src = stripComments(source.read());
    for (const match of src.matchAll(GLYPH)) hits.push({ path: source.path, line: lineOf(src, match.index), glyph: match[0] });
  }
  return hits;
}

const codepoint = (glyph: string): string => `U+${glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

describe("(a) a glyph is never text — design-language.md:41-45", () => {
  const sources = scannedTsx();
  const hits = glyphHits(sources);
  const allowed = new Map(GLYPH_ALLOW.map(([file, glyphs]) => [file, new Set([...glyphs])]));

  it("reads enough of the tree to be worth trusting", () => {
    expect(
      sources.length,
      `the glyph scan found ${sources.length} .tsx files; the floor is ${CONVENTION_SHAPE.glyphSourceFloor}.\n` +
        `The walk has stopped finding the tree, so this check is measuring almost nothing.\n` +
        `Fix: restore the walk in design-conventions-shape.ts. If the client genuinely shrank, lower CONVENTION_SHAPE.glyphSourceFloor in the same commit.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.glyphSourceFloor);
  });

  it("renders no emoji or symbol character that is not already on the allowlist", () => {
    const offenders = hits
      .filter((hit) => !allowed.get(hit.path)?.has(hit.glyph))
      .map((hit) => cite(hit.path, hit.line, `${hit.glyph} ${codepoint(hit.glyph)}`));
    expect(
      [...new Set(offenders)],
      `A glyph rendered as text is a different typeface at the wrong size, and on iOS/Android it is an EMOJI — a hue this palette does not own.\n` +
        `Fix: import an icon from @vtt/ui (the set is packages/ui/src/primitives/icons.tsx) and render <IconX /> instead of the character.\n` +
        `If the glyph you need has no icon yet, add one there and demo it in the styleguide icons grid — that is the same commit, not a follow-up.\n` +
        `(design-language.md:41-45. Do NOT add a row to GLYPH_ALLOW: that list only shrinks.)`
    ).toEqual([]);
  });

  it("has no allowlist row that rescues nothing — a fixed violation must lose its row", () => {
    const live = new Set(hits.map((hit) => `${hit.path} ${hit.glyph}`));
    for (const [file, glyphs] of GLYPH_ALLOW) {
      for (const glyph of glyphs) {
        expect(
          live.has(`${file} ${glyph}`),
          `GLYPH_ALLOW excuses ${glyph} (${codepoint(glyph)}) in ${file}, which no longer renders it.\n` +
            `Fix: delete that character from the row (and the row, if it is now empty), and drop CONVENTION_SHAPE.glyphAllowPairs by one in the same commit. This is the ratchet working.`
        ).toBe(true);
      }
    }
  });

  it("keeps the allowlist the size design-conventions-shape.ts says it is", () => {
    const pairs = GLYPH_ALLOW.reduce((n, [, glyphs]) => n + [...glyphs].length, 0);
    expect(GLYPH_ALLOW.length, "GLYPH_ALLOW file count").toBe(CONVENTION_SHAPE.glyphAllowFiles);
    expect(
      pairs,
      `GLYPH_ALLOW holds ${pairs} (file, glyph) pairs; design-conventions-shape.ts pins ${CONVENTION_SHAPE.glyphAllowPairs}.\n` +
        `Fix: if a violation was FIXED, lower CONVENTION_SHAPE.glyphAllowPairs to match — that is the expected direction.\n` +
        `If it went UP, a new glyph was written into the rules: revert it and use an icon.`
    ).toBe(CONVENTION_SHAPE.glyphAllowPairs);
  });
});

// (b) raw form elements

/**
 * A lowercase `<input` is never the primitive (components are capitalized). `[^>]*` keeps the match
 * inside one element while tolerating attribute order and newlines, which a per-line grep misses.
 * `packages/ui` is out of scope: a raw `<input>` there is the primitive's own implementation.
 */
const rawInput = (type: string) => new RegExp(`<input\\b[^>]*type="${type}"`, "g");

/** Hand-rolled search fields; `<Input type="search">` is the replacement. */
const RAW_SEARCH_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/encounter/equipment.tsx", 1]
];

/**
 * Raw number inputs; `NumberField` is the replacement (see the styleguide's `#numberfield`
 * section). Capitalized `<Input type="number">` is the primitive and out of scope here.
 */
const RAW_NUMBER_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/encounter/CharacterSheet.tsx", 3],
  ["apps/client/src/encounter/EncounterPanel.tsx", 2],
  ["apps/client/src/scene/TokenContextMenu.tsx", 1],
  // Two on one line (the X and Y of a calibration point) plus the focus-zoom field.
  ["apps/client/src/viewer/ViewerControls.tsx", 3]
];

function countRaw(sources: readonly Source[], type: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const n = [...stripComments(source.read()).matchAll(rawInput(type))].length;
    if (n > 0) counts.set(source.path, n);
  }
  return counts;
}

function describeRawInput(type: string, primitive: string, allow: ReadonlyArray<readonly [string, number]>, pins: { files: number; sites: number }) {
  describe(`(b) no raw <input type="${type}"> — use ${primitive}`, () => {
    const sources = playTsx();
    const counts = countRaw(sources, type);
    const allowed = new Map(allow);

    it("reads enough of the play surfaces to be worth trusting", () => {
      expect(
        sources.length,
        `the raw-input scan found ${sources.length} play .tsx files; the floor is ${CONVENTION_SHAPE.rawInputSourceFloor}.\n` +
          `Fix: restore the walk in design-conventions-shape.ts, or lower CONVENTION_SHAPE.rawInputSourceFloor in the same commit as the deletion that justifies it.`
      ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.rawInputSourceFloor);
    });

    it("adds none, anywhere", () => {
      const offenders = [...counts]
        .filter(([file, n]) => n > (allowed.get(file) ?? 0))
        .map(([file, n]) => `${file}  ${n} raw <input type="${type}">, ${allowed.get(file) ?? 0} allowed`);
      expect(
        offenders,
        `Fix: import { ${primitive} } from "@vtt/ui" and use it. A raw element skips the label wiring, the invalid state, the 44px touch target and the theme — every one of which the primitive already has.\n` +
          `(design-language.md:36-40: "Build from these; do not hand-roll a control that already exists.")`
      ).toEqual([]);
    });

    it("has no allowlist row that rescues nothing", () => {
      for (const [file, count] of allow) {
        expect(
          counts.get(file) ?? 0,
          `the allowlist excuses ${count} raw <input type="${type}"> in ${file}, which now has ${counts.get(file) ?? 0}.\n` +
            `Fix: lower or delete the row, and drop the pin in design-conventions-shape.ts in the same commit.`
        ).toBe(count);
      }
    });

    it("keeps the allowlist the size design-conventions-shape.ts says it is", () => {
      expect(allow.length, `allowlist file count for type="${type}"`).toBe(pins.files);
      expect(
        allow.reduce((n, [, count]) => n + count, 0),
        `the type="${type}" allowlist totals a different number of sites than design-conventions-shape.ts pins (${pins.sites}).\n` +
          `Fix: lower the pin when a site is migrated. Raising it writes a new hand-rolled control into the rules.`
      ).toBe(pins.sites);
    });
  });
}

describeRawInput("search", "Input", RAW_SEARCH_ALLOW, {
  files: CONVENTION_SHAPE.rawSearchFiles,
  sites: CONVENTION_SHAPE.rawSearchSites
});
describeRawInput("number", "NumberField", RAW_NUMBER_ALLOW, {
  files: CONVENTION_SHAPE.rawNumberFiles,
  sites: CONVENTION_SHAPE.rawNumberSites
});

// (c) the second eyebrow

/**
 * `Eyebrow` is a primitive (`packages/ui/src/primitives/Wordmark.tsx`, class `nh-eyebrow`), and
 * `apps/client/src/styles.css` declares a second one. Matched as a class token, not `\beyebrow\b`
 * (which matches at a hyphen and sweeps in `viewer-eyebrow`); the token split still catches a
 * composite like `className="codex-sidebar-grouplabel eyebrow"`.
 */
const CLASS_TOKEN = /[^A-Za-z0-9_-]+/;

/** Every `className=` value in a source, braces balanced so `className={cx("a", `b ${c}`)}` comes out whole. */
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
        else if (src[i] === "}" && --depth === 0) { values.push({ value: src.slice(start + 1, i), index: start }); break; }
      }
    }
  }
  return values;
}

describe("(c) one Eyebrow, and it is the primitive", () => {
  const sources = eyebrowScanned();
  const uses: string[] = [];
  for (const source of sources) {
    const src = stripComments(source.read());
    for (const { value, index } of classNameValues(src)) {
      for (const token of value.split(CLASS_TOKEN)) if (token === "eyebrow") uses.push(cite(source.path, lineOf(src, index), value.trim().slice(0, 60)));
    }
  }

  it("reads enough of the tree to be worth trusting", () => {
    expect(
      sources.length,
      `the eyebrow scan found ${sources.length} sources; the floor is ${CONVENTION_SHAPE.eyebrowSourceFloor}.\n` +
        `Fix: restore the walk in design-conventions-shape.ts, or lower CONVENTION_SHAPE.eyebrowSourceFloor in the same commit.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.eyebrowSourceFloor);
  });

  it("grows no new use of the local class", () => {
    expect(
      uses.length,
      `${uses.length} className values carry the local \`eyebrow\` token; ${CONVENTION_SHAPE.eyebrowUses} are on record.\n` +
        `${uses.join("\n")}\n\n` +
        `Fix: import { Eyebrow } from "@vtt/ui" and render <Eyebrow>LABEL</Eyebrow>. The primitive owns the tracking, the size tier and the muted colour; the local class is a second copy of all three.\n` +
        `If this number went DOWN, that is the migration working — lower CONVENTION_SHAPE.eyebrowUses (and eyebrowFiles) in the same commit.`
    ).toBe(CONVENTION_SHAPE.eyebrowUses);
    expect(new Set(uses.map((use) => use.split(":")[0])).size, "files using the local eyebrow class").toBe(CONVENTION_SHAPE.eyebrowFiles);
  });

  it("does not let apps/client/src/styles.css grow another .eyebrow rule", () => {
    // The lookarounds keep `.viewer-eyebrow` and `var(--tracking-eyebrow)` out: only `.eyebrow` itself counts.
    const selectors = [...readFileSync(`${process.cwd()}/src/styles.css`, "utf8").matchAll(/(?<![\w-])\.eyebrow(?![\w-])/g)];
    expect(
      selectors.length,
      `apps/client/src/styles.css has ${selectors.length} \`.eyebrow\` selector(s); ${CONVENTION_SHAPE.eyebrowCssSelectors} are on record (the declaration at :18 and the second consumer at :250).\n` +
        `Fix: nothing new goes here. When the last call site moves to <Eyebrow>, delete both rules and set CONVENTION_SHAPE.eyebrowCssSelectors to 0 — this check then holds absence.`
    ).toBe(CONVENTION_SHAPE.eyebrowCssSelectors);
  });
});

// (d) hand-typed colours

/**
 * `#rrggbb`, data-URI `%23rrggbb` (an SVG in `url()` cannot use `var()`), and `rgb()`/`rgba()`/
 * `hsl()`/`hsla()` literals. `design-tokens.css` is exempt as the definition. Comments are
 * stripped first so editing a comment cannot move a count. Not scanned: `color-mix()`/`oklch()`
 * over vars (fine) and inline TSX styles.
 */
const COLOR = /#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,6}|rgba?\(|hsla?\(/g;

/** Per-file counts, each with the reason those literals are there. */
const COLOR_ALLOW: ReadonlyArray<readonly [file: string, count: number, why: string]> = [
  ["apps/client/src/actors/pdf-import.css", 5, "import-status hues (amber/red/violet) that never became tokens"],
  ["apps/client/src/codex/codex.css", 1, "graph node-icon fill over arbitrary map art"],
  ["apps/client/src/maps/map-manager.css", 11, "SVG-context paint: grid strokes and drop-shadows over image content"],
  ["apps/client/src/scene/annotation.css", 3, "SVG-context paint: annotation strokes over image content"],
  ["apps/client/src/scene/encounter-map.css", 8, "SVG-context paint + the black/white pair a token ring needs against any map"],
  ["apps/client/src/styles.css", 2, "a two-stop black scrim"],
  ["apps/client/src/viewer/viewer-controls.css", 1, "the white A/B measurement labels, over arbitrary map art"],
  ["apps/client/src/viewer/viewer.css", 6, "SVG-context paint + scrim over the projected map"],
  ["packages/ui/src/primitives/Combobox.css", 1, "shadow over an arbitrary backdrop"],
  ["packages/ui/src/primitives/Tabs.css", 10, "ten black-alpha stops in one shadow ladder"],
  ["packages/ui/src/primitives/forms.css", 1, "%237C77A0 — a data-URI SVG chevron, which cannot reference var()"]
];

describe("(d) colours come from design-tokens.css — design-language.md:46-47", () => {
  const sources = stylesheets();
  const counts = new Map<string, number>();
  for (const source of sources) {
    const n = [...stripBlockComments(source.read()).matchAll(COLOR)].length;
    if (n > 0) counts.set(source.path, n);
  }
  const allowed = new Map(COLOR_ALLOW.map(([file, count]) => [file, count]));

  it("reads enough stylesheets to be worth trusting", () => {
    expect(
      sources.length,
      `the colour scan found ${sources.length} stylesheets; the floor is ${CONVENTION_SHAPE.colorSourceFloor}.\n` +
        `Fix: restore the walk in design-conventions-shape.ts, or lower CONVENTION_SHAPE.colorSourceFloor in the same commit.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.colorSourceFloor);
  });

  it("adds no hand-typed colour to any stylesheet", () => {
    const offenders = [...counts]
      .filter(([file, n]) => n > (allowed.get(file) ?? 0))
      .map(([file, n]) => `${file}  ${n} colour literal(s), ${allowed.get(file) ?? 0} allowed`);
    expect(
      offenders,
      `Fix: add a token to packages/ui/src/styles/design-tokens.css first, then use var(--…). A literal is a colour that cannot follow the theme, and this product has two.\n` +
        `If the literal genuinely cannot be a token — SVG paint over arbitrary map art, a data-URI chevron — add its file to COLOR_ALLOW WITH the reason and raise the pin, and expect to defend it in review.`
    ).toEqual([]);
  });

  it("has no allowlist row that rescues nothing", () => {
    for (const [file, count] of COLOR_ALLOW) {
      expect(
        counts.get(file) ?? 0,
        `COLOR_ALLOW excuses ${count} literal(s) in ${file}, which now has ${counts.get(file) ?? 0}.\n` +
          `Fix: lower or delete the row and drop CONVENTION_SHAPE.colorAllowTotal to match, in the same commit.`
      ).toBe(count);
    }
  });

  it("keeps the allowlist the size design-conventions-shape.ts says it is, and every row says why", () => {
    expect(COLOR_ALLOW.length, "COLOR_ALLOW file count").toBe(CONVENTION_SHAPE.colorAllowFiles);
    // Rows here must carry a reason, and the reason is asserted.
    for (const [file, , why] of COLOR_ALLOW) {
      expect(why.trim().length, `COLOR_ALLOW row for ${file} has no reason attached.\nFix: say why these literals cannot be tokens, or take the row out and tokenize them.`).toBeGreaterThan(15);
    }
    expect(
      COLOR_ALLOW.reduce((n, [, count]) => n + count, 0),
      `COLOR_ALLOW's totals do not match CONVENTION_SHAPE.colorAllowTotal (${CONVENTION_SHAPE.colorAllowTotal}).\n` +
        `Fix: the pin follows the allowlist down. It does not follow it up without a commit message that explains the new literal.`
    ).toBe(CONVENTION_SHAPE.colorAllowTotal);
  });
});

// (e) one feedback channel

/**
 * `ToastProvider` + `useToast` is the one feedback channel; local `message` state renders a second
 * notification, often off-screen on a phone. Counts call sites rather than string arguments, since
 * most pass an expression. A non-feedback setter named `setMessage` will collide; rename it.
 * `setError`, `setNotice` and `toast` are the toast channel's own calls.
 */
const FEEDBACK = /\bset(?:Message|Feedback)\s*\(/g;

/** Surfaces still awaiting their move to `useToast`. */
const FEEDBACK_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/dice/DicePanel.tsx", 7],
  ["apps/client/src/encounter/CharacterSheet.tsx", 8],
  ["apps/client/src/encounter/EncounterPanel.tsx", 17],
  ["apps/client/src/encounter/MonsterBrowser.tsx", 1],
  ["apps/client/src/integrations/IntegrationsPanel.tsx", 9],
  ["apps/client/src/scene/EncounterMap.tsx", 14],
  ["apps/client/src/scene/TokenContextMenu.tsx", 6],
  ["apps/client/src/scenes/SceneBuilder.tsx", 6],
  ["apps/client/src/scenes/ScenePanel.tsx", 3],
  ["apps/client/src/tokens/TokenLibrary.tsx", 6],
  ["apps/client/src/viewer/ViewerApp.tsx", 4],
  ["apps/client/src/viewer/ViewerControls.tsx", 6]
];

describe("(e) one feedback channel — useToast, not a second inline banner", () => {
  const counts = new Map<string, number>();
  for (const source of scannedTsx()) {
    const n = [...stripComments(source.read()).matchAll(FEEDBACK)].length;
    if (n > 0) counts.set(source.path, n);
  }
  const allowed = new Map(FEEDBACK_ALLOW);

  it("opens no new inline feedback state", () => {
    const offenders = [...counts]
      .filter(([file, n]) => n > (allowed.get(file) ?? 0))
      .map(([file, n]) => `${file}  ${n} setMessage/setFeedback call(s), ${allowed.get(file) ?? 0} allowed`);
    expect(
      offenders,
      `Fix: const toast = useToast() and call toast(...). One channel means one place a person learns to look, one style, and one thing to make work on a phone.\n` +
        `If this setter is genuinely not user feedback, rename it — the name is the retired idiom, and the collision is on purpose.`
    ).toEqual([]);
  });

  it("has no allowlist row that rescues nothing", () => {
    for (const [file, count] of FEEDBACK_ALLOW) {
      expect(
        counts.get(file) ?? 0,
        `FEEDBACK_ALLOW excuses ${count} call(s) in ${file}, which now has ${counts.get(file) ?? 0}.\n` +
          `Fix: lower or delete the row and drop CONVENTION_SHAPE.feedbackAllowSites to match, in the same commit. A surface that moved to useToast should cost this list a line.`
      ).toBe(count);
    }
  });

  it("keeps the allowlist the size design-conventions-shape.ts says it is", () => {
    expect(FEEDBACK_ALLOW.length, "FEEDBACK_ALLOW file count").toBe(CONVENTION_SHAPE.feedbackAllowFiles);
    expect(
      FEEDBACK_ALLOW.reduce((n, [, count]) => n + count, 0),
      `FEEDBACK_ALLOW's totals do not match CONVENTION_SHAPE.feedbackAllowSites (${CONVENTION_SHAPE.feedbackAllowSites}).\n` +
        `Fix: the pin follows the list down as each surface lands on useToast. It reaching 0 is the point.`
    ).toBe(CONVENTION_SHAPE.feedbackAllowSites);
  });
});

// (f) the breakpoint ladder

/**
 * `@media` declarations only: property `max-width`s are not breakpoints. Direction matters:
 * `max-width: 850px` would fire alongside `min-width: 850px` at exactly 850px.
 */
// Empty: every client `@media` width is a rung. Do not add a row.
const LADDER_ALLOW: ReadonlyArray<readonly [file: string, kind: "min" | "max", width: number]> = [];

describe("(f) one breakpoint ladder — design-language.md:134-139", () => {
  // `ladderStylesheets()`, not `stylesheets()`: the design-tokens.css colour exemption does not
  // extend to breakpoints.
  const sources = ladderStylesheets();
  const conditions: { path: string; line: number; kind: string; width: number }[] = [];
  for (const source of sources) {
    const src = source.read();
    for (const media of src.matchAll(/@media[^{]*/g)) {
      for (const q of media[0].matchAll(/\((min|max)-width:\s*(\d+)px/g)) {
        conditions.push({ path: source.path, line: lineOf(src, media.index), kind: q[1], width: Number(q[2]) });
      }
    }
  }
  const onLadder = (kind: string, width: number) =>
    (kind === "max" ? CONVENTION_SHAPE.ladderMax : CONVENTION_SHAPE.ladderMin).includes(width);
  const off = conditions.filter((c) => !onLadder(c.kind, c.width));

  it("parses enough media queries to be worth trusting", () => {
    expect(
      conditions.length,
      `the ladder parse found ${conditions.length} @media width conditions; the floor is ${CONVENTION_SHAPE.ladderConditionFloor}.\n` +
        `Fix: restore the parse, or lower CONVENTION_SHAPE.ladderConditionFloor in the same commit as the stylesheets that went away.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.ladderConditionFloor);
  });

  it("declares no new off-ladder breakpoint", () => {
    // Matched by (file, kind, width) with multiplicity, so a second identical query fails.
    const remaining = LADDER_ALLOW.map(([file, kind, width]) => `${file} ${kind} ${width}`);
    const offenders: string[] = [];
    for (const c of off) {
      const key = `${c.path} ${c.kind} ${c.width}`;
      const at = remaining.indexOf(key);
      if (at < 0) offenders.push(cite(c.path, c.line, `${c.kind}-width: ${c.width}px is off the ladder`));
      else remaining.splice(at, 1);
    }
    expect(
      offenders,
      `The ladder is max-width 760/650/560 and min-width 850/980/1280, plus the exact complements 761/651/561 and 849/979 — nothing else.\n` +
        `Fix: reuse a rung. A new number means two components change shape at widths a few dozen pixels apart for no reason a user could name.\n` +
        `If the ladder itself is wrong, change it for everyone in design-language.md AND in CONVENTION_SHAPE.ladderMax/ladderMin, in one commit.`
    ).toEqual([]);
    expect(
      remaining,
      `LADDER_ALLOW excuses off-ladder queries that no longer exist.\nFix: delete those rows and lower CONVENTION_SHAPE.ladderOffRows to match. This is the ratchet working.`
    ).toEqual([]);
  });

  it("keeps the allowlist the size design-conventions-shape.ts says it is", () => {
    expect(
      LADDER_ALLOW.length,
      `LADDER_ALLOW holds ${LADDER_ALLOW.length} rows; design-conventions-shape.ts pins ${CONVENTION_SHAPE.ladderOffRows}.\n` +
        `Fix: the pin follows the list down as replay/homebrew/encounter-panel/tokens CSS are rebuilt onto the ladder.`
    ).toBe(CONVENTION_SHAPE.ladderOffRows);
  });
});

// (g) viewport units in app CSS

/**
 * A viewport-fraction cap on in-flow content (`max-height: 64vh`) stands in for a frame.
 * Allowed without rows: `100dvh`/`100svh`, and `100vh` when the same line also carries a `dvh`
 * value (fallback pair) or the selector contains `:fullscreen`. Anything else needs a row:
 * conforming with a reason, or legacy (shrink-only). Client CSS only; `packages/ui`'s dvh uses
 * are the lock machinery.
 */
const VIEWPORT_UNIT = /\b\d+(?:\.\d+)?(?:d|s)?vh\b/g;

/** Reasoned survivors: rows carry a why, and growth must be argued. */
const VIEWPORT_CONFORMING: ReadonlyArray<readonly [file: string, values: readonly string[], why: string]> = [
  ["apps/client/src/encounter/encounter-panel.css", ["85vh", "52vh", "94vh", "92vh"],
    "overlay caps bounding fixed/modal layers (⋯-menu, sheet modal + its capped picker, monster browser) — §8 reference implementations"],
  ["apps/client/src/styles.css", ["4vh", "3.5vh", "4.5vh"],
    "landing clamp() mid-terms — fluid spacing inside the locked hero, rem-bounded, cannot grow the page"],
  ["apps/client/src/viewer/viewer.css", ["32vh"],
    "the conforming shared-screen viewer's portrait initiative band"]
];

/**
 * Legacy cap occurrences, matched by (file, value) with multiplicity, so a second identical value
 * fails while the first stays excused.
 */
// Empty. Do not add a row.
const VIEWPORT_LEGACY: ReadonlyArray<readonly [file: string, value: string, phase: string]> = [];

interface ViewportHit { path: string; line: number; value: string }

function viewportHits(sources: readonly Source[]): ViewportHit[] {
  const hits: ViewportHit[] = [];
  for (const source of sources) {
    const src = stripBlockComments(source.read());
    const lines = src.split("\n");
    for (const match of src.matchAll(VIEWPORT_UNIT)) {
      const value = match[0];
      if (value === "100dvh" || value === "100svh") continue;
      const line = lineOf(src, match.index);
      if (value === "100vh") {
        // The fallback pair: `height: 100vh; height: 100dvh;` on one line.
        if (/\b\d+(?:\.\d+)?dvh\b/.test(lines[line - 1] ?? "")) continue;
        // The `:fullscreen` selector: walk back to this declaration block's selector text.
        const open = src.lastIndexOf("{", match.index);
        const boundary = Math.max(src.lastIndexOf("}", open), src.lastIndexOf("{", open - 1));
        if (src.slice(boundary + 1, open).includes(":fullscreen")) continue;
      }
      hits.push({ path: source.path, line, value });
    }
  }
  return hits;
}

describe("(g) no viewport-fraction caps on in-flow content — design-language.md §7 rule 2", () => {
  const sources = appStylesheets();
  const hits = viewportHits(sources);

  it("reads enough app stylesheets to be worth trusting", () => {
    expect(
      sources.length,
      `the viewport-unit scan found ${sources.length} client stylesheets; the floor is ${CONVENTION_SHAPE.appCssSourceFloor}.\n` +
        `Fix: restore appStylesheets() in design-conventions-shape.ts, or lower CONVENTION_SHAPE.appCssSourceFloor in the same commit as the deletion that justifies it.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.appCssSourceFloor);
  });

  it("adds no viewport-fraction value that no row answers for", () => {
    // Every hit spends a row; leftover hits are offenders, leftover rows are dead. Conforming rows are
    // consulted first.
    const remainingConforming = VIEWPORT_CONFORMING.flatMap(([file, values]) => values.map((value) => `${file} ${value}`));
    const remainingLegacy = VIEWPORT_LEGACY.map(([file, value]) => `${file} ${value}`);
    const offenders: string[] = [];
    for (const hit of hits) {
      const key = `${hit.path} ${hit.value}`;
      const conforming = remainingConforming.indexOf(key);
      if (conforming >= 0) { remainingConforming.splice(conforming, 1); continue; }
      const legacy = remainingLegacy.indexOf(key);
      if (legacy >= 0) { remainingLegacy.splice(legacy, 1); continue; }
      offenders.push(cite(hit.path, hit.line, `${hit.value} on in-flow content`));
    }
    expect(
      offenders,
      `A viewport-fraction cap on in-flow content is the pre-standard substitute for a frame (design-language.md §7 rule 2).\n` +
        `Fix: put the region in a real column and let it flex — \`flex: 1; min-height: 0\` (the .frame-col/.frame-fill utilities) — or,\n` +
        `if this is a fixed overlay's bound, say so in VIEWPORT_CONFORMING with the reason and raise the pins in the same commit.\n` +
        `Do NOT add a VIEWPORT_LEGACY row: that list only shrinks.`
    ).toEqual([]);
    expect(
      remainingConforming,
      `VIEWPORT_CONFORMING excuses values that no longer occur.\nFix: delete them (and the row, if empty) and drop CONVENTION_SHAPE.viewportConformingTotal/Files to match, in the same commit.`
    ).toEqual([]);
    expect(
      remainingLegacy,
      `VIEWPORT_LEGACY excuses caps that no longer exist.\nFix: delete those rows and lower CONVENTION_SHAPE.viewportLegacyTotal (and viewportLegacyFiles if a file emptied) in the same commit. This is the ratchet working.`
    ).toEqual([]);
  });

  it("keeps both allowlists the size design-conventions-shape.ts says they are, and every conforming row says why", () => {
    expect(VIEWPORT_CONFORMING.length, "VIEWPORT_CONFORMING file count").toBe(CONVENTION_SHAPE.viewportConformingFiles);
    expect(
      VIEWPORT_CONFORMING.reduce((n, [, values]) => n + values.length, 0),
      `VIEWPORT_CONFORMING totals a different occurrence count than CONVENTION_SHAPE.viewportConformingTotal (${CONVENTION_SHAPE.viewportConformingTotal}).\n` +
        `Fix: the pin follows the list down. It does not follow it up without a commit message that argues the new occurrence.`
    ).toBe(CONVENTION_SHAPE.viewportConformingTotal);
    for (const [file, , why] of VIEWPORT_CONFORMING) {
      expect(why.trim().length, `VIEWPORT_CONFORMING row for ${file} has no reason attached.\nFix: say why these caps are structural, or take the row out and convert them.`).toBeGreaterThan(15);
    }
    expect(VIEWPORT_LEGACY.length, `VIEWPORT_LEGACY holds ${VIEWPORT_LEGACY.length} rows; design-conventions-shape.ts pins ${CONVENTION_SHAPE.viewportLegacyTotal}.`).toBe(CONVENTION_SHAPE.viewportLegacyTotal);
    expect(
      new Set(VIEWPORT_LEGACY.map(([file]) => file)).size,
      "VIEWPORT_LEGACY distinct-file count vs CONVENTION_SHAPE.viewportLegacyFiles"
    ).toBe(CONVENTION_SHAPE.viewportLegacyFiles);
    for (const [file, , phase] of VIEWPORT_LEGACY) {
      expect(/^[ABC](\/[ABC])?$/.test(phase), `VIEWPORT_LEGACY row for ${file} carries no drain phase (A, B, C or a pair).`).toBe(true);
    }
  });
});

// (h) declared scroll regions

/**
 * A bare `overflow-y: auto` (or `overflow: auto|scroll`) in app CSS is an undeclared scroll region;
 * scroll regions carry `.scroll-y` in the markup. `overflow-x` is not matched: wide tables need it.
 * Reads CSS only, so an inline `style={{ overflowY: "auto" }}` is invisible here.
 */
const SCROLL_DECL = /overflow(?:-y)?\s*:\s*(?:auto|scroll)/g;

// Empty. Do not add a row: an undeclared scroller is a failure.
const SCROLL_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [];

describe("(h) every scroll region is declared — design-language.md §7", () => {
  const sources = appStylesheets();
  const counts = new Map<string, number>();
  for (const source of sources) {
    const n = [...stripBlockComments(source.read()).matchAll(SCROLL_DECL)].length;
    if (n > 0) counts.set(source.path, n);
  }
  const allowed = new Map(SCROLL_ALLOW);

  it("reads enough app stylesheets to be worth trusting", () => {
    expect(
      sources.length,
      `the scroll-region scan found ${sources.length} client stylesheets; the floor is ${CONVENTION_SHAPE.appCssSourceFloor}.\n` +
        `Fix: restore appStylesheets() in design-conventions-shape.ts, or lower CONVENTION_SHAPE.appCssSourceFloor in the same commit as the deletion that justifies it.`
    ).toBeGreaterThanOrEqual(CONVENTION_SHAPE.appCssSourceFloor);
  });

  it("declares no new undeclared scroller, anywhere", () => {
    const offenders = [...counts]
      .filter(([file, n]) => n > (allowed.get(file) ?? 0))
      .map(([file, n]) => `${file}  ${n} bare overflow(-y) scroller(s), ${allowed.get(file) ?? 0} allowed`);
    expect(
      offenders,
      `A bare \`overflow-y: auto\` in app CSS is an undeclared scroll region (design-language.md §7).\n` +
        `Fix: mark the region with .scroll-y in the markup — the utility in design-tokens.css owns the quiet scrollbar and the\n` +
        `stable gutter — and delete this declaration; if the box also needs overflow-x, declare only the x-axis here.\n` +
        `Do NOT add a row to SCROLL_ALLOW: that list only shrinks.`
    ).toEqual([]);
  });

  it("has no allowlist row that rescues nothing", () => {
    for (const [file, count] of SCROLL_ALLOW) {
      expect(
        counts.get(file) ?? 0,
        `SCROLL_ALLOW excuses ${count} scroller(s) in ${file}, which now has ${counts.get(file) ?? 0}.\n` +
          `Fix: lower or delete the row and drop CONVENTION_SHAPE.scrollAllowSites (and scrollAllowFiles if the row went) to match, in the same commit. This is the ratchet working.`
      ).toBe(count);
    }
  });

  it("keeps the allowlist the size design-conventions-shape.ts says it is", () => {
    expect(SCROLL_ALLOW.length, "SCROLL_ALLOW file count").toBe(CONVENTION_SHAPE.scrollAllowFiles);
    expect(
      SCROLL_ALLOW.reduce((n, [, count]) => n + count, 0),
      `SCROLL_ALLOW's totals do not match CONVENTION_SHAPE.scrollAllowSites (${CONVENTION_SHAPE.scrollAllowSites}).\n` +
        `Fix: the pin follows the list down as each region takes .scroll-y in markup. It reaching 0 is the refresh's exit condition.`
    ).toBe(CONVENTION_SHAPE.scrollAllowSites);
  });
});

// The checks themselves

describe("the design-convention checks themselves", () => {
  // A disabled check must not leave the suite green: vitest reports a `.skip`ped file as skipped and
  // exits 0, and the server-side detector (`apps/server/test/docs-*.test.ts`) cannot see these files.
  const DISABLED = new RegExp("\\.(?:skip|todo)\\s*\\(");

  it("are the files that import design-conventions-shape.ts, and none is skipped", () => {
    // Discovered, not merely listed: a check file that still imports the shape module cannot be
    // dropped from CONVENTION_SHAPE.checkFiles.
    const importers = walk(`${process.cwd()}/src`, (n) => /\.test\.tsx?$/.test(n))
      .map((rel) => `src/${rel}`)
      .filter((rel) => readFileSync(`${process.cwd()}/${rel}`, "utf8").includes("design-conventions-shape"));
    expect(
      importers,
      `the client tests importing design-conventions-shape.ts do not match CONVENTION_SHAPE.checkFiles.\n` +
        `  discovered: ${JSON.stringify(importers)}\n` +
        `  pinned:     ${JSON.stringify(CONVENTION_SHAPE.checkFiles)}\n` +
        `Fix: if a check file was added or renamed, update CONVENTION_SHAPE.checkFiles in design-conventions-shape.ts in the SAME commit.`
    ).toEqual([...CONVENTION_SHAPE.checkFiles]);
    for (const file of CONVENTION_SHAPE.checkFiles) {
      expect(
        DISABLED.test(readFileSync(`${process.cwd()}/${file}`, "utf8")),
        `apps/client/${file} contains a skipped or todo test. A convention check that is skipped is a check that is gone, and vitest reports it as "skipped" rather than as a failure — so CI stays green.\n` +
          `Fix: fix the violation the check named, or delete the check outright in a commit that says so. Do not skip it.`
      ).toBe(false);
    }
  });

  it("excludes only the two directories it says it excludes", () => {
    // An empty or over-broad prefix would silently empty every scan above.
    for (const [prefix, why] of PLAY_EXCLUDED) {
      expect(prefix.trim(), "an empty PLAY_EXCLUDED prefix excludes the whole tree").not.toBe("");
      expect(prefix.endsWith("/"), `PLAY_EXCLUDED entry ${JSON.stringify(prefix)} is not a directory prefix`).toBe(true);
      expect(why.length, `PLAY_EXCLUDED entry ${JSON.stringify(prefix)} has no reason attached`).toBeGreaterThan(20);
    }
    expect(
      PLAY_EXCLUDED.map(([prefix]) => prefix),
      `PLAY_EXCLUDED has changed. It is an EXCLUSION list on purpose — a new play directory must be born scanned — so every entry is a hole in every check above.\n` +
        `Fix: a new exclusion needs a reason a reviewer would accept. "It fails otherwise" is not one.`
    ).toEqual(["codex/", "styleguide/"]);
  });
});

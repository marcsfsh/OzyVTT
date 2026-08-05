/**
 * The design conventions of `docs/ai-context/design-language.md`, enforced as test failures
 * rather than as a page nobody re-reads before typing `<span>✕</span>`.
 *
 * Eight rules, each mechanically detectable, each violated on the tree today:
 *   (a) primitives and play surfaces never render a glyph as text (design-language.md:41-45)
 *   (b) no raw `<input type="search">` / `type="number">` where a primitive exists (:36-40)
 *   (c) one `.eyebrow`, and it lives in `packages/ui` (:36-40, the "do not hand-roll" rule)
 *   (d) no hand-typed colours outside `design-tokens.css` (:46-47)
 *   (e) one feedback channel — `useToast`, not a per-component inline banner
 *   (f) one breakpoint ladder, not per-file taste (§3)
 *   (g) no viewport-fraction caps on in-flow content in app CSS (§7 rule 2)
 *   (h) every scroll region in app CSS is declared — `.scroll-y`, not a bare overflow (§7)
 *
 * **Every one of these already has offenders, so every check ships with an allowlist of the
 * CURRENT population and fails on a NEW one.** That is the only shape that can land before the
 * migration it guards: a check that fails on day one gets skipped, and a skipped check is a
 * check that is gone. The allowlists are ratchets, not amnesties —
 *   · a new violation fails, with the replacement named;
 *   · a FIXED violation fails too, as a dead allowlist row that must be deleted;
 *   · and every allowlist's size is pinned in `design-conventions-shape.ts`, so both edits are
 *     a two-file diff a reviewer sees. The numbers there may only go down.
 *
 * **What this file deliberately does not attempt.** It reads source text, so it proves what is
 * typed, never what renders: an icon imported and never used still passes (a), and
 * `color-mix()` over a var, an inline `style={{ color: … }}`, or a colour computed at runtime
 * are all invisible to (d). Those stay with review — `docs/ai-context/design-language.md` and
 * the `/styleguide` route are where a human checks the half a regex cannot.
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

/** `file:line  detail` — the one shape every failure below prints, so a failure is a jump target. */
const cite = (path: string, line: number, detail: string): string => `${path}:${line}  ${detail}`;

// ───────────────────────────────── (a) text glyphs ─────────────────────────────────

/**
 * The banned class, built from the MEASURED population rather than trusted from a Unicode
 * property. `\p{Extended_Pictographic}` alone is not enough and it is not close: measured
 * 2026-08-03 over this tree, ⏻ ⇲ ✕ ▩ ▾ ▦ ✎ ✓ ← → and a dozen more of the real offenders are
 * `Extended_Pictographic = No`, so a property-only scan would have passed the entire map
 * toolbar. The five blocks below are where the offenders actually live:
 *   U+2190-21FF arrows        ← ↑ → ↓ ↻ ⇲
 *   U+2300-23FF technical     ⏻ ⏮ ⏸ ⏭
 *   U+25A0-25FF geometric     ▢ ▦ ▩ ▴ ▹ ▶ ▾ ● ◀ ◧ ◨ ◭ ◯ ◼
 *   U+2600-27BF misc/dingbats ☀ ⚠ ⛌ ⛶ ✎ ✏ ✓ ✕ ✦
 *   U+2B00-2BFF arrows-B      ⬆ ⬇ ⭐
 *
 * Geometric Shapes is IN, deliberately. Carving it out would read as generous and would gut
 * the rule — most of the map toolbar is in that block. If D12's turn pips end up as a textual
 * "●", that is two allowlist rows with a reason, not a block-wide hole. (Drawn pips: no rows.)
 *
 * Typography and dice maths stay legal because they are outside these blocks, not because they
 * are excused: − is U+2212 Mathematical Operators, and so the Stepper's own −/+ glyphs are
 * fine; × · … – — ‘ ’ “ ” likewise.
 */
const GLYPH = /[←-⇿⌀-⏿■-◿☀-➿⬀-⯿]|\p{Extended_Pictographic}/gu;

/**
 * The measured population, as (file, glyphs) rows — one row per file, one character per
 * violation. Measured 2026-08-03 by this file's own scan: 23 files, 84 pairs. **19 files / 52
 * pairs** now: the map toolbar (D4) took `scene/EncounterMap.tsx` (28 — the largest row this list
 * ever had) and `scene/TokenContextMenu.tsx` with it, and the shell rebuild (D15/D30) took the two
 * roster rows' 🎭 and `main.tsx`'s `→` (the landing's arrows are `IconArrow` now). That is the
 * whole point of a ratchet.
 *
 * Every remaining row is a call site waiting on its icon. The icons exist
 * (`packages/ui/src/primitives/icons.tsx` — `IconArrow`, `IconSelect`, `IconPing`,
 * `IconMeasure`, `IconDraw`, `IconFog`, `IconColor`, `IconCleanup`, `IconScene`, `IconStar`,
 * `IconDownload`, `IconChevronLeft/Right`, …); the call sites have not moved yet. Four of the
 * rows are `packages/ui` itself, which is the sharper embarrassment: design-language.md:41
 * says "**Primitives** never render a glyph as text" and four primitives do.
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
  // packages/ui — the four primitives that break their own rule.
  ["packages/ui/src/primitives/Button.tsx", "→"],
  ["packages/ui/src/primitives/Chip.tsx", "✕"],
  ["packages/ui/src/primitives/Menu.tsx", "▾"],
  ["packages/ui/src/primitives/Toast.tsx", "✕"]
];

interface GlyphHit { path: string; line: number; glyph: string }

function glyphHits(sources: readonly Source[]): GlyphHit[] {
  const hits: GlyphHit[] = [];
  for (const source of sources) {
    // Comments first. Post-strip, a glyph can only be in a string literal or JSX text — emoji
    // are not legal identifiers — so every surviving hit is something a person can see.
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

// ───────────────────────────── (b) raw form elements ─────────────────────────────

/**
 * A lowercase `<input` is by construction NOT the primitive — JSX components are capitalized,
 * so `<Input type="search">` (three legitimate sites) can never be confused with
 * `<input type="search">` (two hand-rolled ones).
 *
 * `[^>]*` between the tag name and the attribute is what makes this attribute-order- and
 * newline-tolerant: it cannot cross the `>` that closes the tag, so it stays inside one
 * element and still catches `<input className="…" type="number">` and the multi-line form.
 * A per-line grep misses both — measured 2026-08-03, the naive
 * `grep -rn '<input type="number"'` reports 8 where the real population is 10.
 *
 * `packages/ui` is out of scope here on purpose: a raw `<input>` inside `forms.tsx` is the
 * primitive's own implementation, which is the point of having one.
 */
const rawInput = (type: string) => new RegExp(`<input\\b[^>]*type="${type}"`, "g");

/**
 * Both hand-rolled search fields. `<Input type="search">` is the replacement and already ships
 * in three other places — so this is two files typing out what the tree next door imports.
 * The allowlist reaches 0 with them, which is a two-line change whenever someone picks it up.
 */
const RAW_SEARCH_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/encounter/equipment.tsx", 1]
];

/**
 * Raw number inputs. `NumberField` exists, and the styleguide blurb spells out why native
 * `type="number"` is the wrong control (`StyleGuide.tsx`, the `#numberfield` section): a
 * spinner nobody uses at 375px, an empty value reported on a stray letter, and a wheel that
 * changes the number when it rolls over a focused field.
 *
 * Capital-`<Input type="number">` sites are the primitive and out of scope for this rule —
 * whether they should be `NumberField` is a convention question for review, not a raw-element
 * violation.
 */
const RAW_NUMBER_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/encounter/CharacterSheet.tsx", 3],
  // 2, not 3, since the scene-prep rebuild: the setup list's per-combatant Initiative field is gone.
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

// ────────────────────────────── (c) the second eyebrow ──────────────────────────────

/**
 * `Eyebrow` is a primitive (`packages/ui/src/primitives/Wordmark.tsx`, class `nh-eyebrow`) and
 * the app declares a SECOND one in `apps/client/src/styles.css:18`. Twenty call sites use the
 * local class; none uses the primitive. That is one role rendered two ways, which is the exact
 * thing design-language.md:36-40 forbids.
 *
 * **The token, not `\beyebrow\b`.** Measured 2026-08-03: the word-boundary form reports 35
 * hits on this tree because `\b` matches at a hyphen, so it also sweeps in the DIFFERENT
 * classes `viewer-eyebrow` (x4, the public shared screen) and `viewer-tools-eyebrow` — the
 * latter retired 2026-08-05 when the shared-screen controls took `<Eyebrow>`. Those are the
 * viewer rebuild's convention problem, not this scan's, and a check that cannot tell them
 * apart is a check nobody will believe. Splitting a className value on non-class characters and comparing
 * for equality keeps `nh-eyebrow` and `viewer-eyebrow` out and cannot miss the composite
 * `className="codex-sidebar-grouplabel eyebrow"` (`codex/SidebarNav.tsx:48`).
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
    // `(?<![\w-])` and `(?![\w-])` are what keep `.viewer-eyebrow` and `var(--tracking-eyebrow)`
    // out: only a selector that IS `.eyebrow` counts, whether it declares the class or consumes it.
    const selectors = [...readFileSync(`${process.cwd()}/src/styles.css`, "utf8").matchAll(/(?<![\w-])\.eyebrow(?![\w-])/g)];
    expect(
      selectors.length,
      `apps/client/src/styles.css has ${selectors.length} \`.eyebrow\` selector(s); ${CONVENTION_SHAPE.eyebrowCssSelectors} are on record (the declaration at :18 and the second consumer at :250).\n` +
        `Fix: nothing new goes here. When the last call site moves to <Eyebrow>, delete both rules and set CONVENTION_SHAPE.eyebrowCssSelectors to 0 — this check then holds absence.`
    ).toBe(CONVENTION_SHAPE.eyebrowCssSelectors);
  });
});

// ─────────────────────────── (d) hand-typed colours ───────────────────────────

/**
 * `#rrggbb`, the data-URI-encoded `%23rrggbb` (an SVG in a `url()` cannot reference a `var()`,
 * so `forms.css`'s Select chevron writes the hex out), and `rgb()`/`rgba()`/`hsl()`/`hsla()`
 * literals. `design-tokens.css` is exempt — it is the definition.
 *
 * Comments are stripped first, and that is load-bearing rather than tidy: `ChoiceCard.css:30`
 * explains a contrast ratio with two literal `rgb()`s, and without the strip an edit to a
 * COMMENT moves this check's numbers.
 *
 * Honest limits, stated so nobody reads more into a green run than is there: `color-mix()` and
 * `oklch()` over vars are fine and unscanned; an inline `style={{ background: "#f0f" }}` in
 * TSX is out of scope v1 (this scan reads `.css`). Both are extendable; neither is claimed.
 */
const COLOR = /#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,6}|rgba?\(|hsla?\(/g;

/** Per-file counts, each with the reason those literals are there. Measured 2026-08-03: 51 across 11 files. */
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
    // This is the one allowlist whose rows are argued rather than merely counted — "SVG paint over
    // arbitrary map art" is a real defence and "" is not. An unreasoned row is a hole with a
    // comment's clothes on, so the reason is asserted, not trusted.
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

// ─────────────────────────── (e) one feedback channel ───────────────────────────

/**
 * One feedback channel. `ToastProvider` + `useToast` is it; a component that keeps its own
 * `message` state renders a second, differently-styled, differently-placed notification for
 * the same class of event — and on a phone the inline one is usually off-screen.
 *
 * **Source-level, not string-level, and that is the whole reason it works.** The copy scanner
 * extracts string-literal arguments, and most of these sites pass an expression:
 * `setFeedback(result.ok ? "…" : result.message ?? "…")` (`scene/TokenContextMenu.tsx:82`,
 * `encounter/CharacterSheet.tsx:232`). A call-string extractor never sees one. Counting CALL
 * SITES sees all of them, and when the migration is done the assertion becomes zero — the
 * state is gone, not merely quiet.
 *
 * False positives are deliberate friction: a future local setter genuinely named `setMessage`
 * that is not user feedback collides with the retired idiom. Rename it. `setError`,
 * `setNotice` and `toast` stay legitimate — they ARE the toast channel's calls.
 */
const FEEDBACK = /\bset(?:Message|Feedback)\s*\(/g;

/**
 * Measured 2026-08-03: 122 call sites across 15 files, every one a surface awaiting its rebuild
 * onto `useToast`. **103 across 13** since the shell rebuild (D15): `actors/ActorRoster.tsx` (18)
 * is gone entirely and the Roster tab's one call became a toast.
 */
const FEEDBACK_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  ["apps/client/src/dice/DicePanel.tsx", 7],
  ["apps/client/src/encounter/CharacterSheet.tsx", 8],
  ["apps/client/src/encounter/EncounterPanel.tsx", 17],
  ["apps/client/src/encounter/MonsterBrowser.tsx", 1],
  ["apps/client/src/integrations/IntegrationsPanel.tsx", 9],
  // `maps/MapManager.tsx` (15) left this list on 2026-08-05: the C2 redesign collapsed three
  // competing narration channels — two live `role="status"` regions and a third example line —
  // into one per-step instruction, and routed errors to `useToast`. The state went with them.
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

// ─────────────────────────── (f) the breakpoint ladder ───────────────────────────

/**
 * `@media` declarations ONLY — deliberately narrower than the self-audit grep the doc ships
 * (design-language.md:139), which also catches *property* `max-width`s that are not
 * breakpoints at all: `codex/codex.css:827`'s 820px content clamp and a `min-width: 320px`
 * both disappear here, and neither ever belonged in an allowlist.
 *
 * Direction matters. `max-width: 850px` is off-ladder even though 850 is a rung, and
 * `maps/map-manager.css:95` shows why that is not pedantry: it is a `max-width: 850px` sitting
 * on top of three `min-width: 850px` queries, so at exactly 850px both sides fire.
 */
// EMPTY, and it reached empty on 2026-08-05 (Phase C). Every client `@media` width is now a rung:
// 480->560 and 700->760 widened to the nearest rung, 681/680 became the exact 651/650 complement,
// and `maps/map-manager.css`'s `max-width: 850px` — the double-fire this docblock describes —
// became 849. **Do not add a row.** An off-ladder query is now a failure, not a debt.
const LADDER_ALLOW: ReadonlyArray<readonly [file: string, kind: "min" | "max", width: number]> = [];

describe("(f) one breakpoint ladder — design-language.md:134-139", () => {
  // `ladderStylesheets()`, not `stylesheets()`: (d)'s design-tokens.css exemption is about
  // COLOUR and does not transfer to breakpoints. See the helper's own note.
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
    // Matched by (file, kind, width) with multiplicity, so a SECOND max-width:900 in
    // homebrew.css fails while the first stays excused.
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

// ─────────────────────────── (g) viewport units in app CSS ───────────────────────────

/**
 * A viewport-fraction cap on in-flow content (`max-height: 64vh`, `min-height: 40vh`) is
 * the codebase's pre-standard substitute for a frame — design-language.md §7 rule 2
 * retires the idiom, and this check holds the line while the refresh drains it surface by
 * surface (the phase tag on each legacy row names the lane that owes the drain).
 *
 * STRUCTURAL ALLOWS, needing no rows: `100dvh`/`100svh` anywhere — the lock unit itself;
 * and `100vh` when the same line also carries a `dvh` value (the fallback-pair idiom, the
 * standalone sheet) or the declaring selector contains `:fullscreen` (the OS-fullscreen
 * map). Everything else — including a bare `100vh` — answers to a row: CONFORMING with a
 * reason (overlay caps, landing clamp() mid-terms), or LEGACY, which only shrinks.
 *
 * Scope is CLIENT CSS only (`appStylesheets()`): `packages/ui`'s dvh usages ARE the
 * blessed lock machinery, and permanent rows for them would be a floor the shape file's
 * down-only header cannot honor.
 */
const VIEWPORT_UNIT = /\b\d+(?:\.\d+)?(?:d|s)?vh\b/g;

/** Reasoned survivors — the (d) discipline: rows carry a why, growth must argue out loud. */
const VIEWPORT_CONFORMING: ReadonlyArray<readonly [file: string, values: readonly string[], why: string]> = [
  ["apps/client/src/encounter/encounter-panel.css", ["85vh", "52vh", "94vh", "92vh"],
    "overlay caps bounding fixed/modal layers (⋯-menu, sheet modal + its capped picker, monster browser) — §8 reference implementations"],
  ["apps/client/src/styles.css", ["4vh", "3.5vh", "4.5vh"],
    "landing clamp() mid-terms — fluid spacing inside the locked hero, rem-bounded, cannot grow the page"],
  ["apps/client/src/viewer/viewer.css", ["32vh"],
    "the conforming shared-screen viewer's portrait initiative band"]
];

/**
 * The cap idiom's measured population, one row per occurrence, matched by (file, value)
 * WITH multiplicity — the LADDER_ALLOW consumption pattern — so a SECOND 62vh in
 * codex.css fails while the first four stay excused. The phase column names the refresh
 * lane that drains the row (A = shell/trivials, B = recomposes, C = redesigns).
 */
// EMPTY as of 2026-08-05 (Phase C). Both survivors were drained by giving the box a real height
// contract instead of a viewport fraction: `.sheet-embedded`'s 78vh became `flex:1; min-height:0`
// inherited from its containing region, and `.map-empty-hero`'s `min(52vh,30rem)` became
// `flex:1; min-height:12rem`, banded to `flex:0 1 14rem` below the 979 rung so it mirrors the map
// stage it stands in for. **Do not add a row.**
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
    // Consumption with multiplicity: every hit spends a row; leftover hits are offenders,
    // leftover rows are dead. Conforming is consulted first — no (file, value) key appears
    // in both lists today, and a future collision should land on the reasoned side.
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

// ─────────────────────────── (h) declared scroll regions ───────────────────────────

/**
 * A bare `overflow-y: auto` (or `overflow: auto|scroll`) in app CSS is an undeclared
 * scroll region — design-language.md §7 makes `.scroll-y` in the MARKUP the one blessed
 * scroll treatment (quiet thin scrollbar, stable gutter), so the CSS declaration is the
 * tell of a region the standard has not reached. The seed is the measured population; it
 * only shrinks, and it reaching 0 is the refresh's phase-C exit condition.
 *
 * `overflow-x` is deliberately unmatched: the wide-content rule (§7) REQUIRES an
 * `overflow-x` container per wide table/strip. `hidden|clip|visible` are not scrolling.
 *
 * HONEST LIMIT (the (d) pattern): this reads CSS, so an inline
 * `style={{ overflowY: "auto" }}` or a future styled-component is invisible to it. The
 * runtime scroller probe planned for the no-scroll audit (phase B) is the other half.
 */
const SCROLL_DECL = /overflow(?:-y)?\s*:\s*(?:auto|scroll)/g;

/** The measured population, per file — the FEEDBACK_ALLOW shape. */
const SCROLL_ALLOW: ReadonlyArray<readonly [file: string, count: number]> = [
  // Phase C drained the other seven files (2026-08-05). What is left is the ONE case where the
  // declaration is still right: `.map-picker-grid`'s cap serves the EMBEDDED picker, which is not
  // a frame and has no height to inherit. The maps rail does not use it — the rail neutralises the
  // cap (`.map-rail .map-picker-grid { max-height: none }`) and scrolls a `.scroll-y` WRAPPER
  // around the `<ul>`, because a grid with a definite block size stops sizing its auto rows from
  // its cards. Draining this last row means giving the embedded picker a frame, not deleting a line.
  ["apps/client/src/maps/map-picker.css", 1]
];

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

// ─────────────────────────── the checks themselves ───────────────────────────

describe("the design-convention checks themselves", () => {
  // These checks hold the design language. Nothing holds them, so they hold themselves: a check
  // that is disabled must not be able to leave the suite green. Measured on this repo's vitest by
  // docs-tooling.test.ts:121-127 — emptying a check file is caught, but `.skip`ping its assertions
  // reports "Test Files 1 skipped" and EXITS 0. The server-side detector's glob is
  // `apps/server/test/docs-*.test.ts` (docs-tooling.test.ts:130) and cannot see these two.
  const DISABLED = new RegExp("\\.(?:skip|todo)\\s*\\(");

  it("are the files that import design-conventions-shape.ts, and none is skipped", () => {
    // DISCOVERED, not merely listed. Deleting a row from CONVENTION_SHAPE.checkFiles while the
    // file it named still imports this module fails here — which is the hole a pinned-only list
    // has, and the one docs-tooling.test.ts:131-142 closes the same way.
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
    // An exclusion list is the one place this suite can be silently emptied: a `""` entry, or a
    // bare `src/`, and every scan above reads nothing while the array still looks like a policy.
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

/**
 * WHAT THE DESIGN-CONVENTION CHECKS ARE SUPPOSED TO BE MEASURING, pinned away from the checks
 * that measure it — the client-side twin of `apps/server/test/docs-support.ts`'s `CHECK_SHAPE`.
 *
 * `design-conventions.test.ts` enforces the mechanically-detectable half of
 * `docs/ai-context/design-language.md`: no text glyphs where an icon belongs, no raw form
 * elements where a primitive exists, no second `.eyebrow`, no hand-typed colours, one
 * breakpoint ladder. Every one of those rules is violated today — the tree grew before the
 * rules did — so each check carries an allowlist of the CURRENT violations and fails on a NEW
 * one. That design has an obvious failure mode: the allowlist quietly becomes the rule.
 *
 * So the SIZES live here, in a module the checks import, and each check asserts its own
 * allowlist against these numbers. Weakening a check then costs two deliberate edits in two
 * files instead of one line in an array that reads like a policy list. It does not make
 * weakening impossible — nothing can — it makes it reviewable.
 *
 * **Every number below may only go DOWN.** A violation gets fixed, the allowlist row is
 * deleted (the dead-entry detector in each check demands it), and the count here drops in the
 * same commit. A number that goes UP is a new violation being written into the rules, and the
 * commit that does it has to say so out loud.
 *
 * Deliberately NOT a test file: vitest's client `include` is `src/**\/*.test.{ts,tsx}`
 * (`apps/client/vitest.config.ts:14`), so this module is imported rather than run — the
 * `docs-support.ts` arrangement.
 *
 * Every number carries the command that produced it and the date it was measured. Re-measure
 * before changing one; do not reason about it from memory.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";

/**
 * `import.meta.url` is rewritten by Vite to a root-relative URL, so it cannot locate the
 * sources on disk — the reason `codex/vocabulary.test.ts:36-40` uses the cwd instead. Vitest
 * runs per workspace, so the client's own root is the cwd. Asserted rather than assumed
 * (`assertRoots()` below), because a silently-empty scan is exactly the failure mode these
 * checks exist to prevent.
 */
export const CLIENT_SRC = `${process.cwd()}/src`;
export const UI_SRC = `${process.cwd()}/../../packages/ui/src`;

/**
 * The scan-exclusion list — an EXCLUSION list, never an include list, so a new play directory
 * (`feed/`, `prep/`, …) is born scanned. Each entry names the reason it is not drift.
 *
 * Paths are relative to `apps/client/src/`; a directory prefix ends in `/`.
 */
export const PLAY_EXCLUDED: ReadonlyArray<readonly [prefix: string, why: string]> = [
  ["codex/", "has its own lock with its own glossary — codex/vocabulary.test.ts"],
  ["styleguide/", "the developer reference has to be able to demo the thing it documents"]
];

export const CONVENTION_SHAPE = {
  // ─────────────────────────── (a) text glyphs ───────────────────────────
  /**
   * Floor on the `.tsx` files the glyph scan reads. Measured 2026-08-03: **92**
   * (52 play `.tsx` + 40 `packages/ui/src/primitives/*.tsx`). 80 leaves room for the file
   * churn the rebuild does while still failing loudly if the walk stops finding the tree.
   */
  glyphSourceFloor: 80,
  /**
   * Current offenders as (file, glyph) pairs: **19 files / 52 pairs**. Measured 2026-08-03 at
   * 23/84 by the scan in `design-conventions.test.ts` itself (walk the scanned set, strip
   * comments, report `codepoint -> file:line`); down 2 files / 29 pairs when the collapsible map
   * toolbar (D4) landed and `scene/EncounterMap.tsx` (28 — the largest row the list ever had)
   * and `scene/TokenContextMenu.tsx` (1) started rendering `@vtt/ui` icons instead of emoji, and
   * down another 2 files / 3 pairs when the shell rebuild (D15/D30) deleted the lobby roster,
   * gave the Roster tab an icon-free empty state, and put `IconArrow` on the landing's two doors.
   * −1 pair again (2026-08-04) when the scenes gallery's empty state became a scene moment: one
   * line and one door, so its decorative 🎬 has no call site left.
   * −1 file / −1 pair again (2026-08-05, B3): the shared-screen preview's point marker was a
   * white `●` drawn as SVG `<text>` on top of the `<circle>` that already marked the point — the
   * text now renders only for measure's A/B labels, so `viewer/ViewerControls.tsx` is clean.
   * Both must reach 0 — the icons exist (`packages/ui/src/primitives/icons.tsx`), the remaining
   * call sites have not migrated yet.
   */
  glyphAllowFiles: 15,
  glyphAllowPairs: 38,

  // ─────────────────────────── (b) raw form elements ───────────────────────────
  /**
   * Floor on the play `.tsx` files the raw-input scan reads — the same walk as (a) minus
   * `packages/ui`, which is where a raw `<input>` is the RIGHT answer. Measured 2026-08-03:
   * **52**.
   */
  rawInputSourceFloor: 45,
  /**
   * Raw `<input type="search">`: **2** sites in **2** files (2026-08-03). Command:
   * `grep -rn '<input[^>]*type="search"' apps/client/src --include=*.tsx`
   */
  rawSearchFiles: 1,
  rawSearchSites: 1,
  /**
   * Raw `<input type="number">`: **9** sites in **4** files. Was 10 (2026-08-03); the scene-prep
   * rebuild (D1/D2) deleted the encounter setup list's per-combatant Initiative field, so
   * `EncounterPanel.tsx` costs 2 rather than 3 — the staging tray asks for no scores and the server
   * rolls them. Note this is not the number a naive `grep '<input type="number"'` reports: it misses
   * the `EncounterPanel.tsx` site where `className` precedes `type`, and it counts
   * `ViewerControls.tsx:157` once when that line holds two.
   */
  rawNumberFiles: 4,
  rawNumberSites: 9,

  // ─────────────────────────── (c) the second eyebrow ───────────────────────────
  /**
   * Floor on the `.ts`/`.tsx` files the eyebrow scan reads (the scanned set PLUS `codex/`,
   * which has the composite at `codex/SidebarNav.tsx:48`). Measured 2026-08-03: **120**.
   */
  eyebrowSourceFloor: 100,
  /**
   * Local `eyebrow` class token in a `className`: **15** uses in **14** files. Measured
   * 2026-08-03 at 20/16; the shell rebuild (D15/D30) took five with it — the landing's eyebrow
   * (D30 removes the subtext outright), the deleted lobby roster's two, the Roster tab's, and
   * the player bar's, which renders `<Eyebrow>` now.
   * This is the TOKEN count, not `\beyebrow\b`, which measures 35 on the same tree because
   * `\b` matches at a hyphen and sweeps in the different class `viewer-eyebrow` (x4, the public
   * shared screen). Its sibling `viewer-tools-eyebrow` retired 2026-08-05 when the shared-screen
   * controls took `<Eyebrow>`. That one is the viewer rebuild's problem, not this scan's.
   */
  eyebrowUses: 13,
  eyebrowFiles: 12,
  /**
   * `.eyebrow` selectors still in `apps/client/src/styles.css`: **1** — the declaration alone.
   * The second, `.you-are-playing .eyebrow`, went when the player bar moved to `<Eyebrow>`. The
   * declaration goes when the last of the 15 call sites moves; the check then holds absence.
   */
  eyebrowCssSelectors: 1,

  // ─────────────────────────── (d) hand-typed colours ───────────────────────────
  /**
   * Floor on the stylesheets the colour scan reads (`apps/client/src` + `packages/ui/src`,
   * minus `design-tokens.css`, which is the definition and therefore the one exempt file).
   * Measured 2026-08-03: **63**.
   */
  colorSourceFloor: 55,
  /**
   * Hand-typed colour literals: **51** across **11** files, measured POST-comment-strip
   * 2026-08-03. The doc's own grep
   * (`grep -rnoE '#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(' apps/client/src packages/ui/src --include='*.css' | grep -v design-tokens.css`)
   * reports 51 too, but it is a different 51: it counts `ChoiceCard.css:30`'s two `rgb(`s,
   * which sit inside a comment explaining a contrast ratio and which the real scan strips,
   * and it misses `forms.css`'s data-URI `%237C77A0` and `codex.css:606`'s `rgba(`.
   * **−1 (2026-08-05, B3):** the shared-screen preview's point fill was `rgb(255 46 154 / 50%)`,
   * which is exactly `color-mix(in srgb, var(--magenta) 50%, transparent)`. Its file keeps one
   * row — the white A/B labels, which must read over arbitrary map art.
   */
  colorAllowFiles: 11,
  colorAllowTotal: 50,

  // ─────────────────────────── (e) one feedback channel ───────────────────────────
  /**
   * Inline `setMessage(…)` / `setFeedback(…)` feedback: **103** call sites in **13** files.
   * Measured 2026-08-03 at 122/15; the shell rebuild (D15) deleted `actors/ActorRoster.tsx` (18
   * of them) and moved the Roster tab's one onto `useToast`. Command:
   * `grep -rnoE '\bset(Message|Feedback)\s*\(' apps/client/src --include=*.tsx | wc -l`
   *
   * The `useState` destructurings do not count and need no subtraction — `setMessage]` is not
   * followed by `(`. When the surfaces land on `useToast`, the state itself goes and this
   * reaches 0, which is a structurally stronger assertion than any string match.
   */
  feedbackAllowFiles: 13,
  feedbackAllowSites: 102,

  // ─────────────────────────── (f) the breakpoint ladder ───────────────────────────
  /**
   * The ladder, by direction — `design-language.md` §3. `max` carries the three rungs
   * plus the exact max-complements of the 850/980 `min` rungs; `min` carries the rungs plus
   * the exact min-complements of the three `max` rungs. DIRECTION MATTERS: `max-width: 850px`
   * is off-ladder even though 850 is a rung, and that is not pedantry —
   * `maps/map-manager.css:95` is a `max-width: 850px` that double-fires with the three
   * `min-width: 850px` queries at exactly 850px.
   *
   * 1280 joined `min` 2026-08-04 (the refresh's laptop rung: two-column compositions —
   * settings, shared-screen controls — spend a 1080p width there). Its 1279 max-complement
   * is deliberately NOT pre-blessed: no query needs it yet, and an unused allowance is a
   * hole. Add it beside a real use, in one commit with the doc.
   */
  ladderMax: [560, 650, 760, 849, 979] as readonly number[],
  ladderMin: [561, 651, 761, 850, 980, 1280] as readonly number[],
  /**
   * Floor on the `@media` width conditions parsed. Measured 2026-08-04: **63** (54 on-ladder,
   * 9 off) — 62 before `design-tokens.css` joined (f)'s scope, see `ladderStylesheets()`. The
   * parse is media-query-only on purpose: the doc's self-audit grep also catches *property*
   * `max-width`s that are not breakpoints at all — `codex.css:827`'s 820px and a
   * `min-width: 320px` both vanish here, and neither belongs in an allowlist.
   */
  ladderConditionFloor: 50,
  /**
   * Off-ladder `@media` conditions: **9** rows (2026-08-04), **8** since B3 moved the replay
   * viewer's `max-width: 900px` onto the 849 rung, **7** since B2 deleted homebrew's — the block
   * held one rule, dressing a `[data-hover-reveal]` attribute that appears on no element in this
   * repo, so it was an off-ladder rung bought for a slice that never arrived.
   */
  ladderOffRows: 7,

  // ─────────────────────────── (g) viewport units in app CSS ───────────────────────────
  /**
   * Floor on the CLIENT stylesheets checks (g) and (h) read. Client only, deliberately:
   * `packages/ui` holds zero of the cap idiom, and its `dvh` usages ARE the lock machinery
   * (Modal's full-sheet, WizardShell's layer) — scanning them would force permanent
   * allowlist rows, a floor the down-only header above cannot honor. Measured 2026-08-04:
   * **25** (`find apps/client/src -name '*.css' | wc -l`); same ~10%-under discipline as
   * the other floors.
   */
  appCssSourceFloor: 22,
  /**
   * (g) CONFORMING viewport-unit occurrences — reasoned rows, the (d) discipline: every
   * row carries a why, and the pin does not follow the list up without a commit message
   * that argues the new occurrence. Measured 2026-08-04 by the check's own scan: **8
   * occurrences across 3 files** — three landing `clamp()` mid-terms (styles.css), four
   * overlay caps bounding fixed/modal layers (encounter-panel.css), one shared-screen
   * portrait band (viewer.css).
   */
  viewportConformingFiles: 3,
  viewportConformingTotal: 8,
  /**
   * (g) LEGACY viewport-fraction caps on in-flow content — the pre-standard substitute
   * for a frame that design-language.md §7 rule 2 retires. SHRINK-ONLY, target **0** by
   * the end of the refresh's phase C; every row is tagged with the phase whose recompose
   * drains it. Measured 2026-08-04 by the check's own scan: **28 occurrences across 8
   * files** (raw grep says 30 lines with 44 unit tokens; the scan excludes the structural
   * `100dvh`/paired/`:fullscreen` allows and counts occurrences, not lines) — then −1 file
   * the same day, when the styleguide's lone bare `100vh` took the lock unit instead.
   * **−4 occurrences / −2 files (B3):** the replay viewer's stage caps (`68vh`, and the narrow
   * arm's `50vh`) and the shared-screen controls' preview pair (`54vh` on the box, `50vh` on the
   * svg) all became a frame's leftover height, emptying `replay/replay.css` and
   * `viewer/viewer-controls.css`.
   * **−19 occurrences / −2 files (2026-08-05, B2):** the Codex's fifteen and Homebrew's four went
   * at once, because they were one idea repeated — "about two thirds of a screen", written by a
   * box that could not see the screen. Both shells are frames now: the two-pane workspaces fill
   * their region (`64vh` x2), the atlas and graph canvases take the leftover (`62vh` x3 GM,
   * `52vh` x3 player, `64vh` + `62vh` + `68vh` graph), the details column stopped being a sticky
   * window (`84vh`), the pin inspector became a region (`72vh`), five modal caps gave way to the
   * `Modal` body that was already the declared region beneath them (`50vh`, `46vh`, `50vh`,
   * `40vh`, `50dvh`), and the dead selectors deleted alongside took their `40vh`/`50vh` floors
   * with them. What remains is the encounter panel's overlay cap and the landing's clamp, neither
   * in a phase-B lane.
   */
  viewportLegacyFiles: 2,
  viewportLegacyTotal: 2,

  // ─────────────────────────── (h) declared scroll regions ───────────────────────────
  /**
   * (h) bare `overflow:`/`overflow-y:` `auto|scroll` sites in app CSS — undeclared scroll
   * regions. The end state is every scrolling region carrying `.scroll-y` in its MARKUP
   * (the utility in design-tokens.css owns the quiet scrollbar and the stable gutter) and
   * the CSS declaration deleted, so this is SHRINK-ONLY with target **0**. `overflow-x`
   * is deliberately not counted — the wide-content rule (§7) requires it. Measured
   * 2026-08-04: **33 sites across 13 files**, then −3 the same day as the A2 surfaces converted:
   * the sheet layer's pane took `.scroll-y` in the markup (encounter-panel.css 7 → 6), and the
   * wizard's step body became the scroller its layer used to be, which emptied both
   * `builder/character-builder.css` and the styleguide's bounded demo frame. Command:
   * `grep -roE 'overflow(-y)?: *(auto|scroll)' apps/client/src --include='*.css' | wc -l`
   * → one more than the count here; one hit is a codex.css comment the strip removes.
   * **−1 site / −1 file (2026-08-05, B3):** the shared-screen preview's `overflow: auto` retired
   * with the cap it bounded — a letterboxed svg has nothing left to scroll to.
   * **−11 sites / −2 files (2026-08-05, B2):** `codex.css` (8) and `homebrew.css` (3) are empty.
   * Six were real regions that took `.scroll-y` in the markup instead — the notebook/session/quest
   * rails, the details column, the pin inspector, the homebrew library and its detail pane — and
   * five were declarations that scrolled NOTHING: `.codex-campaign` and `.codex-audit` had no
   * height to overflow, and three sat on selectors with no `.tsx` consumer at all.
   */
  scrollAllowFiles: 8,
  scrollAllowSites: 17,

  // ─────────────────────────── (D28) the play vocabulary lock ───────────────────────────
  /**
   * Floor on the play `.ts`/`.tsx` files `play-vocabulary.test.ts` reads (the scanned set,
   * `.ts` included because copy lives in tables as well as in JSX, plus
   * `packages/ui/src/primitives`). Measured 2026-08-03: **128**. Same ~10%-under discipline as
   * `codex/vocabulary.test.ts:155-156`.
   */
  playSourceFloor: 115,
  /**
   * Floor on the user-facing strings that scan yields. Re-measured 2026-08-04: **1827**, up from
   * 1763, because the QA drive found two banned words the scan could not see — a display fallback
   * (`{actor?.name ?? "combatant"}`) and a success message trailing a callback
   * (`run(async () => {…}, "Encounter started…")`). `copy-scan.ts` now reads both shapes, so the
   * corpus grew and this floor grew with it: leaving it at 1580 would leave the tripwire slack
   * exactly where the scan was just proven blind. (The Codex corpus, for scale, is 919 over 47.)
   * Command: the test's own scan — `playCopySources()` through `scanCopy`, minus the artifacts.
   */
  playCorpusFloor: 1640,
  /**
   * (file, string) exemptions in `play-vocabulary.test.ts`: **2** — SRD's "creature type" in the
   * homebrew rider form, and the English verb "taken" in the feature editor's repeatability help.
   * SHRINK-ONLY. A third exemption is a word this product decided it could not say consistently,
   * and the commit that adds one has to say so out loud.
   */
  playExemptions: 2,

  // ─────────────────────────── (1.4) styleguide completeness ───────────────────────────
  /**
   * Floor on the renderable components parsed out of `packages/ui/src/index.ts`. Measured
   * 2026-08-03: **78** (91 value exports − 10 lowercase utilities − 3 SCREAMING_CASE consts).
   * 70 is the same ~10%-under discipline as `codex/vocabulary.test.ts:155-156`.
   */
  styleguideComponentFloor: 70,
  /**
   * Components exported but not demoed. **0** — measured 2026-08-03, and the reason
   * `NON_VISUAL` starts EMPTY: every one of the 78 already appears as JSX in `StyleGuide.tsx`.
   */
  nonVisualCount: 0,
  /** The styleguide's own non-test files. Pinned so "which files count as the styleguide" cannot drift silently. */
  styleguideFiles: ["StyleGuide.tsx", "styleguide.css"] as readonly string[],

  // ─────────────────────────── the checks themselves ───────────────────────────
  /**
   * The enforcement files, relative to `apps/client`. Pinned rather than globbed because the
   * two share no glob — but NOT merely pinned: the self-guard in `design-conventions.test.ts`
   * discovers every client test that imports THIS module and requires the two sets to be
   * equal, so deleting a row here fails while the file it named is still importing.
   *
   * `play-vocabulary.test.ts` is the D28 lock and reads the same scanned set through
   * `playCopySources()`.
   */
  checkFiles: [
    "src/design-conventions.test.ts",
    "src/play-vocabulary.test.ts",
    "src/styleguide/styleguide-completeness.test.ts"
  ] as readonly string[]
} as const;

// ─────────────────────────── the tree, as data ───────────────────────────

/** Every file under `dir` matching `keep`, one level of nesting or twenty, path relative to `dir`. */
export function walk(dir: string, keep: (name: string) => boolean, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${name}` : name;
    if (statSync(`${dir}/${name}`).isDirectory()) out.push(...walk(`${dir}/${name}`, keep, rel));
    else if (keep(name)) out.push(rel);
  }
  return out;
}

const excluded = (rel: string): boolean => PLAY_EXCLUDED.some(([prefix]) => rel.startsWith(prefix));

/** A repo-relative path, so a failure message can be pasted into an editor. */
export const clientPath = (rel: string): string => `apps/client/src/${rel}`;
export const uiPath = (rel: string): string => `packages/ui/src/${rel}`;

export interface Source { path: string; read: () => string }

const source = (root: string, rel: string, label: (rel: string) => string): Source => ({
  path: label(rel),
  read: () => readFileSync(`${root}/${rel}`, "utf8")
});

/**
 * The scanned set: every play `.tsx` (everything under `apps/client/src` MINUS `PLAY_EXCLUDED`
 * and test files) plus `packages/ui/src/primitives` — the primitives are held to the same
 * rules they define, and `design-language.md:41-45` names them first.
 */
export function scannedTsx(): Source[] {
  return [...playTsx(), ...uiPrimitiveTsx()];
}

export function playTsx(): Source[] {
  return walk(CLIENT_SRC, (n) => /\.tsx$/.test(n) && !n.includes(".test."))
    .filter((rel) => !excluded(rel))
    .map((rel) => source(CLIENT_SRC, rel, clientPath));
}

export function uiPrimitiveTsx(): Source[] {
  return walk(`${UI_SRC}/primitives`, (n) => /\.tsx$/.test(n) && !n.includes(".test.")).map((rel) =>
    source(`${UI_SRC}/primitives`, rel, (r) => uiPath(`primitives/${r}`))
  );
}

/**
 * What the D28 vocabulary lock reads: the scanned set with `.ts` included, plus the primitives.
 *
 * `.ts` and not only `.tsx`, because copy lives in tables as often as in JSX — `DIAL_COPY`,
 * `SETTINGS_GROUPS`, `CLAIM_WORD` and the feed's row labels are all plain modules. The glyph and
 * raw-input scans stay `.tsx`-only because a glyph in a `.ts` constant is still rendered through
 * a component that the `.tsx` scan already reads; a WORD is not, and a word rule that stopped at
 * the JSX boundary would miss the exact files where vocabulary is centralised.
 *
 * Comments are stripped: a comment is not user-facing, and a brief that names a retired word in
 * order to say it is retired must not fail the rule that retired it.
 */
export function playCopySources(): { file: string; read: () => string }[] {
  const keep = (n: string) => /\.tsx?$/.test(n) && !n.includes(".test.") && !n.endsWith(".d.ts");
  return [
    ...walk(CLIENT_SRC, keep)
      .filter((rel) => !excluded(rel))
      .map((rel) => ({ file: clientPath(rel), read: () => stripComments(readFileSync(`${CLIENT_SRC}/${rel}`, "utf8")) })),
    ...walk(`${UI_SRC}/primitives`, keep).map((rel) => ({
      file: uiPath(`primitives/${rel}`),
      read: () => stripComments(readFileSync(`${UI_SRC}/primitives/${rel}`, "utf8"))
    }))
  ];
}

/** The scanned set plus `codex/` — (c)'s scope, because the composite class lives there. */
export function eyebrowScanned(): Source[] {
  return [
    ...walk(CLIENT_SRC, (n) => /\.tsx?$/.test(n) && !n.includes(".test.") && !n.endsWith(".d.ts"))
      .filter((rel) => !rel.startsWith("styleguide/"))
      .map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...uiPrimitiveTsx()
  ];
}

/** Every stylesheet check (d) reads. `design-tokens.css` is the colour DEFINITION, so it is exempt. */
export function stylesheets(): Source[] {
  const css = (n: string) => /\.css$/.test(n);
  return [
    ...walk(CLIENT_SRC, css).map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...walk(UI_SRC, css).map((rel) => source(UI_SRC, rel, uiPath))
  ].filter((s) => !s.path.endsWith("design-tokens.css"));
}

/**
 * Check (f)'s scope: the same set PLUS `design-tokens.css`.
 *
 * (d)'s exemption is about COLOUR — that file is where the hexes are supposed to live — and it
 * does not transfer to breakpoints: the ladder is about which widths the app changes shape at,
 * and a rung typed there binds every consumer at once. The file was outside (d), outside (f)'s
 * `stylesheets()`, and outside (g)/(h)'s client-only walk, so an off-ladder `@media` landing in
 * it was unenforced anywhere. Found while it grew by 322 lines in one lane; nothing had actually
 * slipped (its one width query is `max-width: 760px`, a rung), which is the moment to close a
 * hole rather than after something falls through it.
 */
export function ladderStylesheets(): Source[] {
  const css = (n: string) => /\.css$/.test(n);
  return [
    ...walk(CLIENT_SRC, css).map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...walk(UI_SRC, css).map((rel) => source(UI_SRC, rel, uiPath))
  ];
}

/**
 * Client-only stylesheets — checks (g)/(h)'s scope, §10's "in app CSS". `packages/ui` is
 * deliberately out (see `appCssSourceFloor`): its `dvh` locks are the blessed machinery,
 * and `design-tokens.css` lives there, so `.scroll-y`'s own `overflow-y: auto` can never
 * trip check (h).
 */
export function appStylesheets(): Source[] {
  return walk(CLIENT_SRC, (n) => /\.css$/.test(n)).map((rel) => source(CLIENT_SRC, rel, clientPath));
}

/**
 * Comments blanked, line structure preserved.
 *
 * Not cosmetic: the map toolbar's own comments contain the glyphs the toolbar renders
 * (`scene/EncounterMap.tsx:595, :627`), and `ChoiceCard.css:30` explains a contrast ratio with
 * two literal `rgb()`s. A comment is not user-facing, and a doc edit must not move a count.
 */
export const stripBlockComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/**
 * TypeScript comments — block plus `//` to end of line.
 *
 * The `//` branch refuses to fire after `:`, a quote or a backtick, so a `https://…` or any
 * other `//` inside a string literal survives. Measured 2026-08-03: on this tree the guarded
 * and unguarded forms agree exactly, so the guard costs nothing today — it is there for the
 * string that arrives tomorrow.
 *
 * CSS gets `stripBlockComments` and NOT this: `//` is not a CSS comment, and a base64 or
 * percent-encoded `url()` can contain one.
 */
export function stripComments(src: string): string {
  return stripBlockComments(src)
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** 1-indexed line number of an offset — for failure messages that can be jumped to. */
export const lineOf = (src: string, index: number): number => src.slice(0, index).split("\n").length;

/**
 * The cwd assumption, asserted. If vitest is ever run from somewhere other than the client
 * workspace root, every scan below reads an empty tree and every check passes — the one
 * outcome none of them may have.
 */
export function assertRoots(): void {
  for (const path of [`${CLIENT_SRC}/main.tsx`, `${UI_SRC}/index.ts`]) {
    readFileSync(path, "utf8");
  }
}

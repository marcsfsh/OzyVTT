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
   * Current offenders as (file, glyph) pairs: **23 files / 84 pairs**, measured 2026-08-03 by
   * the scan in `design-conventions.test.ts` itself (walk the scanned set, strip comments,
   * report `codepoint -> file:line`). Both must reach 0 — the icons exist now
   * (`packages/ui/src/primitives/icons.tsx`), the call sites have not migrated yet.
   */
  glyphAllowFiles: 23,
  glyphAllowPairs: 84,

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
  rawSearchFiles: 2,
  rawSearchSites: 2,
  /**
   * Raw `<input type="number">`: **10** sites in **4** files (2026-08-03). Note this is not
   * the number a naive `grep '<input type="number"'` reports (8): it misses
   * `EncounterPanel.tsx:1036`, where `className` precedes `type`, and it counts
   * `ViewerControls.tsx:157` once when that line holds two.
   */
  rawNumberFiles: 4,
  rawNumberSites: 10,

  // ─────────────────────────── (c) the second eyebrow ───────────────────────────
  /**
   * Floor on the `.ts`/`.tsx` files the eyebrow scan reads (the scanned set PLUS `codex/`,
   * which has the composite at `codex/SidebarNav.tsx:48`). Measured 2026-08-03: **120**.
   */
  eyebrowSourceFloor: 100,
  /**
   * Local `eyebrow` class token in a `className`: **20** uses in **16** files (2026-08-03).
   * This is the TOKEN count, not `\beyebrow\b`, which measures 35 on the same tree because
   * `\b` matches at a hyphen and sweeps in the different classes `viewer-eyebrow` (x4) and
   * `viewer-tools-eyebrow` (x1). Those are the viewer rebuild's problem, not this scan's.
   */
  eyebrowUses: 20,
  eyebrowFiles: 16,
  /**
   * `.eyebrow` selectors still in `apps/client/src/styles.css`: **2** — the declaration at
   * `styles.css:18` and the second consumer at `styles.css:250`. Both go when the last use
   * moves to `<Eyebrow>`; the check then holds absence.
   */
  eyebrowCssSelectors: 2,

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
   */
  colorAllowFiles: 11,
  colorAllowTotal: 51,

  // ─────────────────────────── (e) one feedback channel ───────────────────────────
  /**
   * Inline `setMessage(…)` / `setFeedback(…)` feedback: **122** call sites in **15** files
   * (2026-08-03). Command:
   * `grep -rnoE '\bset(Message|Feedback)\s*\(' apps/client/src --include=*.tsx | wc -l`
   *
   * The `useState` destructurings do not count and need no subtraction — `setMessage]` is not
   * followed by `(`. When the surfaces land on `useToast`, the state itself goes and this
   * reaches 0, which is a structurally stronger assertion than any string match.
   */
  feedbackAllowFiles: 15,
  feedbackAllowSites: 122,

  // ─────────────────────────── (f) the breakpoint ladder ───────────────────────────
  /**
   * The ladder, by direction — `design-language.md:134-139`. `max` carries the three rungs
   * plus the exact max-complements of the two `min` rungs; `min` carries the two rungs plus
   * the exact min-complements of the three `max` rungs. DIRECTION MATTERS: `max-width: 850px`
   * is off-ladder even though 850 is a rung, and that is not pedantry —
   * `maps/map-manager.css:95` is a `max-width: 850px` that double-fires with the three
   * `min-width: 850px` queries at exactly 850px.
   */
  ladderMax: [560, 650, 760, 849, 979] as readonly number[],
  ladderMin: [561, 651, 761, 850, 980] as readonly number[],
  /**
   * Floor on the `@media` width conditions parsed. Measured 2026-08-03: **57** (47 on-ladder,
   * 10 off). The parse is media-query-only on purpose: the doc's self-audit grep also catches
   * *property* `max-width`s that are not breakpoints at all — `codex.css:827`'s 820px and a
   * `min-width: 320px` both vanish here, and neither belongs in an allowlist.
   */
  ladderConditionFloor: 50,
  /** Off-ladder `@media` conditions: **10** rows (2026-08-03). */
  ladderOffRows: 10,

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
   * §2.1's `play-vocabulary.test.ts` joins this list when that track lands.
   */
  checkFiles: [
    "src/design-conventions.test.ts",
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

/** The scanned set plus `codex/` — (c)'s scope, because the composite class lives there. */
export function eyebrowScanned(): Source[] {
  return [
    ...walk(CLIENT_SRC, (n) => /\.tsx?$/.test(n) && !n.includes(".test.") && !n.endsWith(".d.ts"))
      .filter((rel) => !rel.startsWith("styleguide/"))
      .map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...uiPrimitiveTsx()
  ];
}

/** Every stylesheet both checks (d) and (f) read. `design-tokens.css` is the definition, so it is exempt. */
export function stylesheets(): Source[] {
  const css = (n: string) => /\.css$/.test(n);
  return [
    ...walk(CLIENT_SRC, css).map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...walk(UI_SRC, css).map((rel) => source(UI_SRC, rel, uiPath))
  ].filter((s) => !s.path.endsWith("design-tokens.css"));
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

/**
 * The sizes the design-convention checks are pinned to (the client twin of `CHECK_SHAPE` in
 * `apps/server/test/docs-support.ts`). Each allowlist in `design-conventions.test.ts` is asserted
 * against a number here, and the numbers may only go down. Imported, not a test file.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";

/** Sources are located from the cwd (Vite rewrites `import.meta.url`); `assertRoots()` checks this. */
export const CLIENT_SRC = `${process.cwd()}/src`;
export const UI_SRC = `${process.cwd()}/../../packages/ui/src`;

/**
 * The scan-exclusion list. An exclusion list, never an include list, so a new play directory is
 * scanned from birth. Paths are relative to `apps/client/src/`; a directory prefix ends in `/`.
 */
export const PLAY_EXCLUDED: ReadonlyArray<readonly [prefix: string, why: string]> = [
  ["codex/", "has its own lock with its own glossary — codex/vocabulary.test.ts"],
  ["styleguide/", "the developer reference has to be able to demo the thing it documents"]
];

export const CONVENTION_SHAPE = {
  // (a) text glyphs
  /** Floor on the `.tsx` files the glyph scan reads (play `.tsx` plus `packages/ui` primitives). */
  glyphSourceFloor: 80,
  /** Current glyph offenders as (file, glyph) pairs; both reach 0 once call sites use icons.tsx. */
  glyphAllowFiles: 19,
  glyphAllowPairs: 40,

  // (b) raw form elements
  /** Floor on the play `.tsx` files the raw-input scan reads (`packages/ui` is excluded). */
  rawInputSourceFloor: 45,
  /** Raw `<input type="search">` sites. */
  rawSearchFiles: 1,
  rawSearchSites: 1,
  /** Raw `<input type="number">` sites (a naive grep misses a `className` before `type`). */
  rawNumberFiles: 4,
  rawNumberSites: 9,

  // (c) the second eyebrow
  /** Floor on the `.ts`/`.tsx` files the eyebrow scan reads (the scanned set plus `codex/`). */
  eyebrowSourceFloor: 100,
  /** Uses of the `eyebrow` class token (not `\beyebrow\b`, which would match `viewer-eyebrow`). */
  eyebrowUses: 8,
  eyebrowFiles: 8,
  /** `.eyebrow` selectors left in `apps/client/src/styles.css`: the declaration alone. */
  eyebrowCssSelectors: 1,

  // (d) hand-typed colours
  /** Floor on the stylesheets the colour scan reads (`design-tokens.css` is exempt). */
  colorSourceFloor: 55,
  /** Hand-typed colour literals, counted after stripping comments. */
  colorAllowFiles: 11,
  colorAllowTotal: 49,

  // (e) one feedback channel
  /** Inline `setMessage(…)` / `setFeedback(…)` call sites; reaches 0 once every surface uses `useToast`. */
  feedbackAllowFiles: 14,
  feedbackAllowSites: 87,

  // (f) the breakpoint ladder
  /**
   * Each direction holds the rungs plus the complements of the other direction's rungs, so
   * `max-width: 849px` and `min-width: 850px` never both fire. Add a complement only beside a real use.
   */
  ladderMax: [560, 650, 760, 849, 979] as readonly number[],
  ladderMin: [561, 651, 761, 850, 980, 1280] as readonly number[],
  /** Floor on the `@media` width conditions parsed (property `max-width`s are not breakpoints). */
  ladderConditionFloor: 50,
  /** Off-ladder `@media` conditions. */
  ladderOffRows: 0,

  // (g) viewport units in app CSS
  /** Floor on the client stylesheets (g) and (h) read; `packages/ui`'s `dvh` uses are the lock itself. */
  appCssSourceFloor: 22,
  /** (g) Conforming viewport-unit uses (landing clamps, overlay caps, the viewer's portrait band). */
  viewportConformingFiles: 3,
  viewportConformingTotal: 8,
  /** (g) Legacy viewport-fraction caps on in-flow content, which frames replace. Shrink-only. */
  viewportLegacyFiles: 0,
  viewportLegacyTotal: 0,

  // (h) declared scroll regions
  /** (h) Bare `overflow(-y): auto|scroll` in app CSS; a scroll region uses `.scroll-y`. Shrink-only. */
  scrollAllowFiles: 0,
  scrollAllowSites: 0,

  // The play vocabulary lock
  /** Floor on the `.ts`/`.tsx` files `play-vocabulary.test.ts` reads, plus `packages/ui/src/primitives`. */
  playSourceFloor: 115,
  /** Floor on the user-facing strings that scan yields (`playCopySources()` through `scanCopy`). */
  playCorpusFloor: 1640,
  /** (file, string) exemptions in `play-vocabulary.test.ts`. Shrink-only. */
  playExemptions: 2,

  // Styleguide completeness
  /** Floor on the renderable components parsed out of `packages/ui/src/index.ts`. */
  styleguideComponentFloor: 70,
  /** Components exported but not demoed in the styleguide. */
  nonVisualCount: 0,
  /** The styleguide's own non-test files, pinned so the set cannot drift silently. */
  styleguideFiles: ["StyleGuide.tsx", "styleguide.css"] as readonly string[],

  // The checks themselves
  /** The enforcement files, relative to `apps/client`; must match the client tests importing this module. */
  checkFiles: [
    "src/design-conventions.test.ts",
    "src/play-vocabulary.test.ts",
    "src/styleguide/styleguide-completeness.test.ts"
  ] as readonly string[]
} as const;

// The tree, as data

/** Every file under `dir` matching `keep`, at any depth, relative to `dir`. */
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

export interface Source {
  path: string;
  read: () => string;
}

const source = (root: string, rel: string, label: (rel: string) => string): Source => ({
  path: label(rel),
  read: () => readFileSync(`${root}/${rel}`, "utf8")
});

/** Every play `.tsx` (minus `PLAY_EXCLUDED` and tests) plus the `packages/ui` primitives. */
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

/** What the vocabulary lock reads: the scanned set including `.ts` copy tables, comments stripped. */
export function playCopySources(): { file: string; read: () => string }[] {
  const keep = (n: string) => /\.tsx?$/.test(n) && !n.includes(".test.") && !n.endsWith(".d.ts");
  return [
    ...walk(CLIENT_SRC, keep)
      .filter((rel) => !excluded(rel))
      .map((rel) => ({
        file: clientPath(rel),
        read: () => stripComments(readFileSync(`${CLIENT_SRC}/${rel}`, "utf8"))
      })),
    ...walk(`${UI_SRC}/primitives`, keep).map((rel) => ({
      file: uiPath(`primitives/${rel}`),
      read: () => stripComments(readFileSync(`${UI_SRC}/primitives/${rel}`, "utf8"))
    }))
  ];
}

/** The scanned set plus `codex/`: (c)'s scope, because the composite class lives there. */
export function eyebrowScanned(): Source[] {
  return [
    ...walk(CLIENT_SRC, (n) => /\.tsx?$/.test(n) && !n.includes(".test.") && !n.endsWith(".d.ts"))
      .filter((rel) => !rel.startsWith("styleguide/"))
      .map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...uiPrimitiveTsx()
  ];
}

/** Every stylesheet check (d) reads. `design-tokens.css` defines the colours, so it is exempt. */
export function stylesheets(): Source[] {
  const css = (n: string) => /\.css$/.test(n);
  return [
    ...walk(CLIENT_SRC, css).map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...walk(UI_SRC, css).map((rel) => source(UI_SRC, rel, uiPath))
  ].filter((s) => !s.path.endsWith("design-tokens.css"));
}

/** Check (f)'s scope: (d)'s set plus `design-tokens.css`, whose colour exemption does not cover breakpoints. */
export function ladderStylesheets(): Source[] {
  const css = (n: string) => /\.css$/.test(n);
  return [
    ...walk(CLIENT_SRC, css).map((rel) => source(CLIENT_SRC, rel, clientPath)),
    ...walk(UI_SRC, css).map((rel) => source(UI_SRC, rel, uiPath))
  ];
}

/** Client stylesheets only, for (g) and (h); this also keeps `.scroll-y`'s own `overflow-y` out of (h). */
export function appStylesheets(): Source[] {
  return walk(CLIENT_SRC, (n) => /\.css$/.test(n)).map((rel) => source(CLIENT_SRC, rel, clientPath));
}

/** Comments blanked with line structure kept, so editing a comment never moves a count. */
export const stripBlockComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/**
 * Strips block and `//` comments. The `//` branch skips matches after `:`, a quote or a backtick, so
 * URLs in strings survive. CSS uses `stripBlockComments`: `//` can appear in an encoded `url()`.
 */
export function stripComments(src: string): string {
  return stripBlockComments(src)
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** 1-indexed line number of an offset, for failure messages. */
export const lineOf = (src: string, index: number): number => src.slice(0, index).split("\n").length;

/** Fails unless run from the client workspace root, where every scan would read nothing and pass. */
export function assertRoots(): void {
  for (const path of [`${CLIENT_SRC}/main.tsx`, `${UI_SRC}/index.ts`]) {
    readFileSync(path, "utf8");
  }
}

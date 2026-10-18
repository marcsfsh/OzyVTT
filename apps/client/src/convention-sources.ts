/**
 * The source files the convention checks read (`design-conventions.test.ts`, `play-vocabulary.test.ts`).
 * Imported by tests; it is no test file itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";

/** Sources are located from the cwd (Vite rewrites `import.meta.url`). A wrong cwd makes the walks throw. */
const CLIENT_SRC = `${process.cwd()}/src`;
const UI_SRC = `${process.cwd()}/../../packages/ui/src`;

/**
 * The scan-exclusion list, an exclusion list so a new play directory is scanned from birth. Paths are
 * relative to `apps/client/src/`; a directory prefix ends in `/`.
 */
const PLAY_EXCLUDED: ReadonlyArray<readonly [prefix: string, why: string]> = [
  ["codex/", "has its own lock with its own glossary (codex/vocabulary.test.ts)"]
];

/** Every file under `dir` matching `keep`, at any depth, relative to `dir`. */
function walk(dir: string, keep: (name: string) => boolean, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${name}` : name;
    if (statSync(`${dir}/${name}`).isDirectory()) out.push(...walk(`${dir}/${name}`, keep, rel));
    else if (keep(name)) out.push(rel);
  }
  return out;
}

/** What the play vocabulary lock leaves out besides `PLAY_EXCLUDED`: record surfaces, which say who sees a record in
    the Codex's words. Their design is still checked with the rest of the play tree. */
const VOCABULARY_EXCLUDED: ReadonlyArray<readonly [prefix: string, why: string]> = [
  ...PLAY_EXCLUDED,
  [
    "compendium/",
    "a record surface: it says Hidden, Everyone or the characters' names through the Codex's WhoSeesIt, " +
      "and has its own lock (compendium/vocabulary.test.ts)"
  ]
];

const excluded = (rel: string): boolean => PLAY_EXCLUDED.some(([prefix]) => rel.startsWith(prefix));
const vocabularyExcluded = (rel: string): boolean => VOCABULARY_EXCLUDED.some(([prefix]) => rel.startsWith(prefix));
const isSource = (name: string) => /\.tsx?$/.test(name) && !name.includes(".test.") && !name.endsWith(".d.ts");
const isCss = (name: string) => name.endsWith(".css");

export interface Source {
  /** Repo-relative, so a failure message can be pasted into an editor. */
  path: string;
  read: () => string;
}

const sources = (root: string, label: string, rels: readonly string[]): Source[] =>
  rels.map((rel) => ({ path: `${label}/${rel}`, read: () => readFileSync(`${root}/${rel}`, "utf8") }));

const clientFiles = (keep: (name: string) => boolean, withCodex = false): Source[] =>
  sources(
    CLIENT_SRC,
    "apps/client/src",
    walk(CLIENT_SRC, keep).filter((rel) => withCodex || !excluded(rel))
  );
const uiFiles = (keep: (name: string) => boolean): Source[] => sources(UI_SRC, "packages/ui/src", walk(UI_SRC, keep));

/** Play `.tsx` (minus `PLAY_EXCLUDED` and tests). */
export const playTsx = (): Source[] => clientFiles((name) => isSource(name) && name.endsWith(".tsx"));
/** Play `.tsx` plus every `packages/ui` component. */
export const scannedTsx = (): Source[] => [...playTsx(), ...uiFiles((name) => isSource(name) && name.endsWith(".tsx"))];
/** Every client and `packages/ui` source, `codex/` included: where a local class can be used from. */
export const allTsx = (): Source[] => [...clientFiles(isSource, true), ...uiFiles(isSource)];
/** What the vocabulary lock reads: play `.ts`/`.tsx` plus the `packages/ui` primitives. */
export const playCopySources = (): { file: string; read: () => string }[] =>
  [
    ...sources(
      CLIENT_SRC,
      "apps/client/src",
      walk(CLIENT_SRC, isSource).filter((rel) => !vocabularyExcluded(rel))
    ),
    ...uiFiles((name) => isSource(name)).filter((s) => s.path.includes("/primitives/"))
  ].map((source) => ({ file: source.path, read: () => stripComments(source.read()) }));
/** Every stylesheet, client and `packages/ui`. */
export const stylesheets = (): Source[] => [...clientFiles(isCss, true), ...uiFiles(isCss)];
/** Client stylesheets only. */
export const appStylesheets = (): Source[] => clientFiles(isCss, true);

/** Comments blanked with line structure kept, so editing a comment never moves a line number. */
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

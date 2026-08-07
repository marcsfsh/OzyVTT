/**
 * Shared machinery for the documentation freshness checks (`docs-*.test.ts`).
 *
 * These checks turn "is this document still true?" into a test failure. They read the
 * repository as data — `git ls-files`, `package.json`, directory listings — and compare it
 * against what the tracked markdown says. Nothing here executes application code.
 *
 * Deliberately NOT a test file: vitest picks up `**\/*.test.ts`, so this module is imported
 * rather than run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, derived from this file's own location so it survives a workspace move. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const abs = (p: string): string => resolve(REPO_ROOT, p);
export const read = (p: string): string => readFileSync(abs(p), "utf8");
export const exists = (p: string): boolean => existsSync(abs(p));

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });

const memo = <T>(fn: () => T): (() => T) => {
  let value: T | undefined;
  let done = false;
  return () => {
    if (!done) { value = fn(); done = true; }
    return value as T;
  };
};

/**
 * `wc -l` counts NEWLINE CHARACTERS, and every file in this repo ends with one — so
 * `text.split("\n").length` is `wc -l` + 1 and a page trimmed to exactly its cap would fail.
 * A budget a human verifies with `wc -l` has to be counted the way `wc -l` counts.
 */
export function countLines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// ─────────────────────────── the repository, as data ───────────────────────────

export const tracked = memo((): string[] => git("ls-files").split("\n").filter(Boolean));
export const trackedSet = memo((): Set<string> => new Set(tracked()));
export const trackedBasenames = memo((): Set<string> => new Set(tracked().map((f) => basename(f))));
export const trackedMarkdown = memo((): string[] => git("ls-files", "*.md").split("\n").filter(Boolean));

export const trackedDirs = memo((): Set<string> => {
  const dirs = new Set<string>();
  for (const f of tracked()) {
    let d = dirname(f);
    while (d && d !== ".") { dirs.add(d); d = dirname(d); }
  }
  return dirs;
});

/**
 * Every basename this repository has EVER tracked. A reference to something that never
 * existed here is external (`index.mjs` belongs to playwright-core) or aspirational (a plan
 * naming a component nobody built) — a prose problem, not a path-resolution problem.
 *
 * This needs full history. A depth-1 clone makes it identical to the tracked set, which
 * silently disables the filter — `docs-paths.test.ts` ships a canary for exactly that.
 */
export const everTrackedBasenames = memo(
  (): Set<string> =>
    new Set(git("log", "--all", "--pretty=format:", "--name-only").split("\n").filter(Boolean).map((f) => basename(f)))
);

/** `["apps/client", "apps/server", "packages/api-contract", …]` — from `git ls-files`, not a list. */
export const workspacePaths = memo((): string[] =>
  tracked()
    .filter((p) => /^(apps|packages)\/[^/]+\/package\.json$/.test(p))
    .map((p) => dirname(p))
    .sort()
);

export const rootScripts = memo((): string[] => Object.keys(JSON.parse(read("package.json")).scripts ?? {}));

/** Every script name defined by any workspace, so a workspace-scoped command is recognisable. */
export const workspaceScriptNames = memo((): Set<string> => {
  const names = new Set<string>();
  for (const ws of workspacePaths()) for (const s of Object.keys(JSON.parse(read(`${ws}/package.json`)).scripts ?? {})) names.add(s);
  return names;
});

export const ls = (dir: string, keep: (name: string) => boolean): string[] =>
  (exists(dir) ? readdirSync(abs(dir)) : []).filter(keep).sort();

// ─────────────────────────── the shape of the checks themselves ───────────────────────────

/**
 * WHAT THE CHECKS ARE SUPPOSED TO BE MEASURING, pinned away from the checks that measure it.
 *
 * Every check here verifies that a document is true. Nothing verified that a CHECK was still
 * doing work — and it turns out that is the softer target. An adversarial pass ran eleven
 * attempts to neuter a check while leaving it present, unskipped and syntactically intact;
 * **seven left the whole suite green**. Appending `""` to `SCOPE_EXEMPT` is two characters in
 * an array that reads like a policy list, and it silently drops C1 from 92 live documents to
 * **zero**. `PINS.slice(0, 0)` disables all seven viewer-safety pins. Raising a cap from 100 to
 * 200 is one character, in the file whose own failure message says not to.
 *
 * So the sizes live HERE, in a module the checks import, and each check asserts its own inputs
 * against these numbers. That does not make weakening impossible — nothing can — it makes it
 * cost a second, deliberate edit in a second file, with a reviewer-facing message attached.
 *
 * **If you are changing one of these numbers, that is fine and expected — change it here, in
 * the same commit as the change that justifies it, and say why in the commit message.** A
 * diff line is the whole point. A silent one is the whole problem.
 */
export const CHECK_SHAPE = {
  /** C3. `CLAUDE.md`: target 100, ceiling 110 (10% slack so C2 and C3 are jointly satisfiable). */
  sessionStartBudget: [
    ["CLAUDE.md", 110],
    ["docs/ai-ledger/current-state.md", 150],
  ] as ReadonlyArray<readonly [path: string, maxLines: number]>,

  /** C1. Exactly one exempt prefix (`docs/archive/`). Growth here is coverage loss. */
  scopeExemptCount: 1,

  /**
   * C1. A floor on the live documents actually scanned. 92 today; 80 leaves room for the
   * archiving this repo does routinely while still failing loudly if the scope collapses.
   * Command: `git ls-files '*.md' | grep -vc '^docs/archive/'`
   */
  liveMarkdownFloor: 80,

  /** C6. Ten phrase pins and six symbols — and each must be SEEN to run, not merely declared. */
  pins: 10,
  symbols: 6,

  /**
   * C5. A floor, not an equality: `*-http.ts` / `*projections.ts` files are added often.
   * 8 today. A regex narrowed to one file passes `length > 0` but fails this.
   */
  chokePointFloor: 8,

  /** C5. The check files that must exist and must not be skipped. Pinned so the detector's own glob cannot be narrowed to exclude its siblings. */
  docsCheckFiles: [
    "docs-commands.test.ts",
    "docs-ledger.test.ts",
    "docs-paths.test.ts",
    "docs-tooling.test.ts",
    "docs-viewer-safety.test.ts",
  ] as readonly string[],
} as const;

/** Live tracked markdown: C1's real scope, as a number, for the floor assertion above. */
export const liveMarkdownCount = (scopeExempt: readonly string[]): number =>
  trackedMarkdown().filter((f) => !scopeExempt.some((p) => f.startsWith(p))).length;

export const isDir = (p: string): boolean => exists(p) && statSync(abs(p)).isDirectory();

/** A `paths:` frontmatter glob (`apps/server/src/viewer-*.ts`, `apps/client/src/viewer/**`) as a regexp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

// ─────────────────────────── reference extraction ───────────────────────────

export interface RepoReference {
  file: string;
  line: number;
  ref: string;
  kind: "rooted" | "bare";
}

const REPO_ROOTS = ["apps/", "packages/", "docs/", "scripts/", ".claude/", ".github/", "sources/"];
const ROOT_FILES = new Set([
  "CLAUDE.md", "README.md", "BUILD_PLAN.md", "package.json", "package-lock.json",
  ".gitignore", ".env.example", "tsconfig.json"
]);
const BARE_WITH_SOURCE_EXTENSION = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(ts|tsx|mjs|cjs|js|jsx|css|sql|yml|yaml)$/;
const GLOB_CHARS = /[*?<>|]/;

function expandBraces(token: string): string[] {
  const m = token.match(/^(.*)\{([^}]*)\}(.*)$/);
  if (!m) return [token];
  const [, pre, inner, post] = m;
  return inner.split(",").flatMap((part) => expandBraces(`${pre}${part.trim()}${post}`));
}

/**
 * Every repository path a markdown document names, outside fenced code blocks.
 *
 * Takes backticked tokens and markdown link targets; drops URLs, absolute paths, tokens with
 * whitespace and anything glob-shaped; brace-expands `packages/{a,b}`; strips a trailing
 * `:123` or `:12-34` line citation. A token is a repo reference when it starts with a known
 * top-level directory or is one of the eight root files (`rooted`), or when it is a bare
 * filename with a source extension (`bare`).
 *
 * FENCES ARE PARSED, NOT TOGGLED. The first version flipped a boolean on any line starting with
 * ```` ``` ````, which made an unbalanced fence a per-document OFF SWITCH for this check: a
 * four-backtick block containing a three-backtick example left `fenced` stuck on and suppressed
 * every reference in the rest of the file — an evasion that looks like documentation. CommonMark's
 * actual rule is followed instead: a fence opens with 3+ backticks or tildes, and closes only on a
 * fence of the SAME character that is at least as long and carries no info string. An unclosed
 * fence therefore ends at the end of the document, not at the next stray ```` ``` ````.
 *
 * Known limit: a 4-space indented code block is not detected (there are none in the tree today).
 */
export function* referencesIn(file: string): Generator<RepoReference> {
  const lines = read(file).split("\n");
  let fence: { char: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (m) {
      const [, marker, rest] = m;
      const char = marker[0];
      if (!fence) {
        // An opening fence may carry an info string (```ts). A backtick fence's info string may
        // not itself contain a backtick — that is what keeps `` `a` `` on a line from opening one.
        if (char === "`" && rest.includes("`")) { /* not a fence: inline code */ }
        else { fence = { char, length: marker.length }; continue; }
      } else if (char === fence.char && marker.length >= fence.length && rest.trim() === "") {
        fence = undefined;
        continue;
      } else {
        continue; // a shorter/other-character fence line INSIDE a block is content, not a close
      }
    }
    if (fence) continue;
    const raw = new Set<string>();
    for (const m of line.matchAll(/`([^`\n]+)`/g)) raw.add(m[1].trim());
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) raw.add(m[1].trim().replace(/#.*$/, ""));
    for (const token of raw) {
      const trimmed = token.replace(/[.,;:)]+$/, "").replace(/:\d+(?:-\d+)?$/, "");
      for (const cand of expandBraces(trimmed)) {
        if (!cand || /\s/.test(cand) || cand.length > 200) continue;
        if (/^https?:\/\//.test(cand) || cand.startsWith("/")) continue;
        if (GLOB_CHARS.test(cand)) continue;
        const rooted = ROOT_FILES.has(cand) || REPO_ROOTS.some((r) => cand.startsWith(r));
        if (rooted) yield { file, line: i + 1, ref: cand, kind: "rooted" };
        else if (!cand.includes("/") && BARE_WITH_SOURCE_EXTENSION.test(cand)) yield { file, line: i + 1, ref: cand, kind: "bare" };
      }
    }
  }
}

/** The rooted repository paths one document names, brace expansion applied. Used by C2. */
export function repoReferencesIn(file: string): Set<string> {
  const refs = new Set<string>();
  for (const r of referencesIn(file)) if (r.kind === "rooted") refs.add(r.ref.replace(/\/$/, ""));
  return refs;
}

function resolvesRooted(ref: string, fromFile: string): boolean {
  const clean = ref.replace(/\/$/, "");
  if (trackedSet().has(clean) || trackedDirs().has(clean)) return true;
  for (const ws of workspacePaths()) {
    const candidate = `${ws}/${clean}`;
    if (trackedSet().has(candidate) || trackedDirs().has(candidate)) return true;
  }
  return existsSync(resolve(REPO_ROOT, dirname(fromFile), clean));
}

/** Batched `git check-ignore`: a path that is *supposed* not to exist is not a dead reference. */
function gitIgnored(candidates: string[]): Set<string> {
  if (candidates.length === 0) return new Set();
  try {
    return new Set(
      execFileSync("git", ["check-ignore", "--stdin"], {
        cwd: REPO_ROOT, encoding: "utf8", input: candidates.join("\n"),
      }).split("\n").filter(Boolean)
    );
  } catch (e) {
    // `git check-ignore` exits 1 when nothing matched; its stdout is still the answer.
    return new Set(String((e as { stdout?: string }).stdout ?? "").split("\n").filter(Boolean));
  }
}

export interface DeadPathPolicy {
  scopeExempt: readonly string[];
  knownExternal: readonly string[];
  removedOnPurpose: ReadonlyArray<readonly [path: string, why: string]>;
}

/** Every reference in a live tracked document that names something this repo once had and no longer does. */
export function deadReferences(policy: DeadPathPolicy): RepoReference[] {
  // An empty or whitespace prefix is a catch-all: EVERY path `startsWith("")`, so one such entry
  // reduces this check's scope from every live document to none of them, silently, while the
  // array still reads as a short list of reviewed exemptions. Refuse it outright rather than
  // trusting review to notice two characters.
  for (const prefix of policy.scopeExempt) {
    if (prefix.trim() === "") {
      throw new Error(
        "docs-paths.test.ts: SCOPE_EXEMPT contains an empty prefix, which exempts EVERY document " +
          "and reduces this check to nothing. Remove it. An exemption must name a real directory, " +
          "and it must be a directory that is point-in-time by definition."
      );
    }
  }
  const scope = trackedMarkdown().filter((f) => !policy.scopeExempt.some((prefix) => f.startsWith(prefix)));
  const external = new Set(policy.knownExternal);
  const removed = new Set(policy.removedOnPurpose.map(([p]) => p));

  const all: RepoReference[] = [];
  for (const f of scope) for (const r of referencesIn(f)) all.push(r);

  const unresolved = all.filter((r) =>
    r.kind === "rooted" ? !resolvesRooted(r.ref, r.file) : !trackedBasenames().has(r.ref)
  );
  const ignored = gitIgnored([...new Set(unresolved.filter((r) => r.kind === "rooted").map((r) => r.ref))]);

  return unresolved.filter((r) => {
    if (external.has(r.ref) || removed.has(r.ref)) return false;
    if (r.kind === "rooted") return !ignored.has(r.ref);
    return everTrackedBasenames().has(r.ref); // a name this repo never had is not a path problem
  });
}

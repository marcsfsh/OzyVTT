/**
 * C1 — every file path named by a live tracked document resolves.
 *
 * The only check whose coverage grows by itself: its scope is `git ls-files '*.md'` minus the
 * archive, not an allowlist, so a new document is held from its first commit.
 */
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { deadReferences, everTrackedBasenames, trackedBasenames, type RepoReference } from "./docs-support.js";

/**
 * An archive is a record of a PAST state. Its paths are allowed to be dead — that is what makes
 * moving a document under `docs/archive/` a legitimate REMEDY for a dead path rather than a way
 * to hide one. Add a prefix here only for a directory that is point-in-time BY DEFINITION.
 */
const SCOPE_EXEMPT = ["docs/archive/"] as const;

/**
 * Deliberate, reviewed exceptions: a bare filename that names a file outside this repo.
 * Empty today, and it must stay short — every entry is a claim this check cannot verify.
 */
const KNOWN_EXTERNAL: readonly string[] = [];

/**
 * The one legitimate reason a LIVE document names a path that no longer resolves: a historical
 * record whose whole point is that the thing was removed. C1's three remedies are all wrong for
 * it — deleting destroys the evidence, there is no correct path, and an ADR closing record has
 * to stay live because the index points at it.
 *
 * Empty today. Format: the path, plus why it is gone and where the record lives. One line,
 * reviewed in the PR that adds it.
 */
const REMOVED_ON_PURPOSE: ReadonlyArray<readonly [path: string, why: string]> = [];

const format = (r: RepoReference): string => `${r.file}:${r.line} -> ${r.ref}`;

function remedy(dead: RepoReference[]): string {
  if (dead.length === 0) return "";
  const first = dead[0];
  const others = new Set(dead.slice(1).map((r) => r.file));
  const more = dead.length > 1 ? `\n${dead.length - 1} more dead reference(s), in ${others.size} other document(s) — all listed above.` : "";
  return (
    `${first.file}:${first.line} names \`${first.ref}\`, which does not exist.\n` +
    `It was tracked in this repository once and is not tracked now.${more}\n\n` +
    `Fix, in this order of preference:\n` +
    `  1. Delete the claim. Deletion is the default repair in this repo — a stale claim is worse than no claim.\n` +
    `  2. Correct the path.\n` +
    `  3. If the whole document describes a past state, move it under docs/archive/ with a dated\n` +
    `     header — archived documents are exempt from this check by design.\n\n` +
    `Find every other reference to the same thing:\n` +
    `  git grep -n ${JSON.stringify(basename(first.ref))} -- '*.md'`
  );
}

describe("documentation file paths", () => {
  it("every file path named by a live document resolves (fix the path, delete the claim, or archive the document)", () => {
    const dead = deadReferences({
      scopeExempt: SCOPE_EXEMPT,
      knownExternal: KNOWN_EXTERNAL,
      removedOnPurpose: REMOVED_ON_PURPOSE,
    });
    // Collect every failure before throwing: one run must show all of them, never just the first.
    expect(dead.map(format).join("\n"), remedy(dead)).toBe("");
  });

  it("the history filter is actually working - a shallow clone would silently disable half this check", () => {
    // Measured: with history invisible, every live dead reference is suppressed and this check
    // passes while doing nothing. Fail loudly instead of passing quietly.
    const CANARY = "CodexWorkspace.tsx"; // deleted from this repo; must be visible in full history
    expect(
      everTrackedBasenames().has(CANARY),
      "git history is unavailable (shallow clone?). Documentation checks need the full history: set `fetch-depth: 0` on actions/checkout in .github/workflows/ci.yml."
    ).toBe(true);
    expect(trackedBasenames().has(CANARY)).toBe(false);
  });
});

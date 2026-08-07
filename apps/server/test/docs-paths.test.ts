/**
 * C1 — every file path named by a live tracked document resolves.
 *
 * The only check whose coverage grows by itself: its scope is `git ls-files '*.md'` minus the
 * archive, not an allowlist, so a new document is held from its first commit.
 */
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_SHAPE, deadReferences, everTrackedBasenames, liveMarkdownCount, trackedBasenames, type RepoReference } from "./docs-support.js";

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
 * record whose whole point is that the thing was removed. C1's first three remedies are all wrong
 * for it — deleting destroys the evidence, there is no correct path, and an ADR or closing record
 * has to stay live because the index points at it. This is remedy 4.
 *
 * **The case this exists for**, so the next person does not have to design one: an ADR that
 * records a removal. "We removed `apps/client/src/codex/CodexWorkspace.tsx`" is the DECISION —
 * the dead path is the content, not a defect. Same for a closing record naming what it closed.
 *
 * Copy this shape; keep the reason to one line, and name where the real record lives:
 *
 *   ["apps/client/src/codex/CodexWorkspace.tsx",
 *    "deleted in 2781793 by the Codex overhaul; ADR-0027 records the removal itself"],
 *
 * Empty today, and short is the point: every entry is a claim this check can no longer verify.
 * Prefer archiving the whole document when the whole document describes a past state.
 */
const REMOVED_ON_PURPOSE: ReadonlyArray<readonly [path: string, why: string]> = [
  ["apps/client/src/scene/RendererProof.tsx",
   "deleted with the PixiJS dependency; ADR-0003 records that removal as its own consequence"],
];

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
    `     header — archived documents are exempt from this check by design. If a live document or a\n` +
    `     source comment cites it, banner it in place instead: moving it breaks the citation.\n` +
    `  4. If the document RECORDS THE REMOVAL — an ADR, a closing record — then the dead path is the\n` +
    `     point and remedies 1-3 are all wrong. Add it to REMOVED_ON_PURPOSE at the top of this file\n` +
    `     with a one-line reason; there is a worked example in the comment above that array.\n\n` +
    `Find every other reference to the same thing:\n` +
    `  git grep -n ${JSON.stringify(basename(first.ref))} -- '*.md'`
  );
}

describe("documentation file paths", () => {
  it("every file path named by a live document resolves (fix the path, delete the claim, or archive the document)", () => {
    // FIRST, this check's own scope. Its value IS its coverage: `SCOPE_EXEMPT` is the only thing
    // that narrows it, and an extra entry reads like an ordinary policy edit while removing
    // documents from the scan. Appending `""` drops it from 92 documents to 0, silently.
    expect(
      SCOPE_EXEMPT.length,
      `docs-paths.test.ts SCOPE_EXEMPT has ${SCOPE_EXEMPT.length} entries; ${CHECK_SHAPE.scopeExemptCount} is pinned in docs-support.ts (CHECK_SHAPE).\n` +
        `Every exemption removes documents from this check. If the new one is genuinely a directory that is point-in-time BY DEFINITION,\n` +
        `Fix: update CHECK_SHAPE.scopeExemptCount in apps/server/test/docs-support.ts in the SAME commit, and say why in the commit message.`
    ).toBe(CHECK_SHAPE.scopeExemptCount);

    const live = liveMarkdownCount(SCOPE_EXEMPT);
    expect(
      live,
      `this check is scanning ${live} live documents; the floor is ${CHECK_SHAPE.liveMarkdownFloor}.\n` +
        `Either a great many documents were archived at once, or the scope was narrowed. Measure it: git ls-files '*.md' | grep -vc '^docs/archive/'\n` +
        `Fix: if the drop is real and intended, lower CHECK_SHAPE.liveMarkdownFloor in apps/server/test/docs-support.ts in the same commit.`
    ).toBeGreaterThanOrEqual(CHECK_SHAPE.liveMarkdownFloor);

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

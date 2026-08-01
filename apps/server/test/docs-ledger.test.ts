/**
 * C3 — the session-start read set stays within its line budget.
 * C4 — a known-bug entry claiming a fix cites a regression test that exists.
 *
 * Both exist because a correct rule with nothing enforcing it produced this repo's worst drift:
 * the state page was told "it's a snapshot, not a changelog" and reached 1,952 lines, and the
 * bug list was told "remove entries you fixed" and carried 31 stale ones.
 */
import { describe, expect, it } from "vitest";
import { abs, countLines, exists, read, tracked } from "./docs-support.js";
import { readFileSync } from "node:fs";

/**
 * The documents every session reads before doing anything. `CLAUDE.md` at ~100 and the state
 * page at 150 are decisions, not suggestions: the page is a budget, and something has to leave
 * for something to arrive.
 *
 * Never delete a row to make this pass. Deleting a row silently removes the cap.
 */
const SESSION_START_BUDGET: ReadonlyArray<readonly [path: string, maxLines: number]> = [
  ["CLAUDE.md", 100],
  ["docs/ai-ledger/current-state.md", 150],
];

describe("session-start read budget", () => {
  it.each(SESSION_START_BUDGET)("%s stays within its session-start budget", (path, max) => {
    expect(
      exists(path),
      `${path} is in SESSION_START_BUDGET (apps/server/test/docs-ledger.test.ts) but does not exist.\n` +
        `Fix: update the path in that array to wherever the page moved. Never delete the row — deleting it silently removes the cap.`
    ).toBe(true);
    const n = countLines(readFileSync(abs(path), "utf8")); // counts what `wc -l` counts
    expect(
      n,
      `${path} is ${n} lines; the cap is ${max}. (Watch it come down: wc -l ${path})\n` +
        `Fix: delete what is no longer true, then move anything worth keeping to docs/archive/ under a dated header.\n` +
        `Do NOT raise the cap. The cap is the decision, not a suggestion — the page is a budget, and something has to leave for something to arrive.`
    ).toBeLessThanOrEqual(max);
  });
});

/**
 * An entry "claims a fix" when its OPENING BOLD HEADLINE carries an all-caps status marker
 * IN A STATUS POSITION — after a dash or an opening bracket. Case, position and the separator
 * all matter: this file uses all-caps for ordinary emphasis in headlines (ONE, WAY, DOOR,
 * BLANK, …), so a looser rule flags open bugs like "the sidebar width is FIXED at 320px".
 */
const CLAIMS_FIX = /(?:[—–-]{1,2}\s*|\[)(?:[A-Za-z ]{0,20})?\b(?:FIXED|RESOLVED)\b|\bclosed 20\d\d-/;

/**
 * The optional `:65-66` suffix is this repo's own citation style (`character-content.test.ts:65-66`)
 * and docs-paths.test.ts already strips exactly that suffix. A citation style one check accepts
 * and another cannot see is indefensible.
 */
const TEST_CITATION = /`([A-Za-z0-9_./-]+\.test\.(?:ts|tsx|mjs))(?::\d+(?:-\d+)?)?`/g;

const headlineOf = (entry: string): string =>
  (entry.match(/^-\s+(?:~~)?\*\*([\s\S]*?)\*\*/)?.[1] ?? entry.split("\n")[0]).replace(/\s+/g, " ");

interface Entry { line: number; text: string; }

function entriesOf(path: string): Entry[] {
  const lines = read(path).split("\n");
  const entries: Entry[] = [];
  let current: Entry | undefined;
  lines.forEach((line, i) => {
    if (/^- /.test(line)) { if (current) entries.push(current); current = { line: i + 1, text: line }; }
    else if (current) current.text += `\n${line}`;
  });
  if (current) entries.push(current);
  return entries;
}

describe("known bugs", () => {
  it("every known-bug entry claiming a fix cites a regression test that exists", () => {
    const path = "docs/ai-ledger/known-bugs.md";
    const trackedFiles = tracked();
    const resolvesToATrackedTest = (cited: string): boolean =>
      trackedFiles.some((f) => f === cited || f.endsWith(`/${cited}`));

    for (const entry of entriesOf(path)) {
      const headline = headlineOf(entry.text);
      if (!CLAIMS_FIX.test(headline)) continue;
      const cited = [...entry.text.matchAll(TEST_CITATION)].map((m) => m[1]);
      expect(
        cited.some(resolvesToATrackedTest),
        `${path}:${entry.line} claims a fix but cites no test file that exists.\n` +
          `  ${headline.slice(0, 100)}\n` +
          `Fix, in this order of preference:\n` +
          `  1. DELETE the entry. A fixed bug leaves the list — the file says so itself in its header.\n` +
          `     The history lives in docs/archive/.\n` +
          `  2. If you are keeping it as a standing gotcha, move it under "## Gotchas" and drop the\n` +
          `     FIXED/RESOLVED marker.\n` +
          `  3. If it must stay in the bug list, cite the regression test in backticks, e.g.\n` +
          "     `apps/server/test/fog.test.ts`.\n" +
          `  4. If the fix was verified by a browser pass or a script rather than a test, that is\n` +
          `     branch 1 or 2 — the evidence belongs in the archive entry or the gotcha, not here.`
      ).toBe(true);
    }
  });
});

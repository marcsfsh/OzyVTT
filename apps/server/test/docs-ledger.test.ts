/**
 * C3 — the session-start read set stays within its line budget.
 * C4 — a known-bug entry claiming a fix cites a regression test that exists.
 *
 * Both exist because a correct rule with nothing enforcing it produced this repo's worst drift:
 * the state page was told "it's a snapshot, not a changelog" and reached 1,952 lines, and the
 * bug list was told "remove entries you fixed" and carried 31 stale ones.
 */
import { describe, expect, it } from "vitest";
import { CHECK_SHAPE, abs, countLines, exists, read, tracked } from "./docs-support.js";
import { readFileSync } from "node:fs";

/**
 * The documents every session reads before doing anything. These are decisions, not suggestions:
 * the page is a budget, and something has to leave for something to arrive.
 *
 * A budget needs the difference between "over target" and "over limit". `CLAUDE.md`'s TARGET is
 * 100 lines; 110 is the enforcement CEILING. The 10 lines of slack exist because C2
 * (docs-commands.test.ts) *requires* a `CLAUDE.md` mention for every root npm script: at a
 * zero-headroom cap the two checks are jointly unsatisfiable for a new script, and the cheapest
 * way out is to raise the cap — which is the one thing this file must never make attractive.
 * If you are over 100, you are over target: pay for the line before you spend the slack.
 *
 * Never delete a row to make this pass. Deleting a row silently removes the cap.
 * The lengths of this array and of the other check inputs are pinned in docs-tooling.test.ts.
 */
const SESSION_START_BUDGET: ReadonlyArray<readonly [path: string, maxLines: number]> = [
  ["CLAUDE.md", 110], // target 100, ceiling 110 — see above
  ["docs/ai-ledger/current-state.md", 150],
];

describe("session-start read budget", () => {
  it.each(SESSION_START_BUDGET)("%s stays within its session-start budget", (path, max) => {
    // The ceiling is pinned in a SECOND file. Raising it here alone is one character and was
    // measured to leave the whole suite green — in the check whose own message says not to do
    // it. Now it costs a deliberate edit in docs-support.ts, which is a reviewable diff line.
    expect(
      CHECK_SHAPE.sessionStartBudget.map(([p, n]) => `${p}=${n}`),
      `the session-start budget was changed here but not in docs-support.ts (CHECK_SHAPE.sessionStartBudget).\n` +
        `This pair is deliberately split across two files so a cap cannot be raised silently.\n` +
        `Fix: if the new budget is intended, set it in BOTH files in the SAME commit and say why. If it is not, restore this row.`
    ).toContain(`${path}=${max}`);

    expect(
      exists(path),
      `${path} is in SESSION_START_BUDGET (apps/server/test/docs-ledger.test.ts) but does not exist.\n` +
        `Fix: update the path in that array to wherever the page moved. Never delete the row — deleting it silently removes the cap.`
    ).toBe(true);
    const n = countLines(readFileSync(abs(path), "utf8")); // counts what `wc -l` counts
    expect(
      n,
      `${path} is ${n} lines; the ceiling is ${max}. (Watch it come down: wc -l ${path})\n` +
        `Fix: delete what is no longer true, then move anything worth keeping to docs/archive/ under a dated header.\n` +
        `Do NOT raise the ceiling. The ceiling is the decision, not a suggestion — the page is a budget, and\n` +
        `something has to leave for something to arrive. The number is pinned in docs-tooling.test.ts, so\n` +
        `raising it here fails there too: that is deliberate, and the second failure is not the bug.`
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
 * SECOND TRIGGER: a struck-through headline. In this file `~~…~~` means resolved, and that is
 * a status marker as surely as the word FIXED is.
 *
 * It exists because the headline rule above was walked around without anyone intending to. An
 * entry read `- ~~**[docs] …**~~ **FIXED 2026-07-31** (…)`: the strike-through pushed the marker
 * OUTSIDE the bold headline the rule reads, so a self-declared-fixed entry sat under
 * "## Known gaps" — whose header promises every entry there is reproducible at HEAD — and
 * survived the sweep that archived eighteen entries on exactly that criterion.
 *
 * Measured on the file that contained it, so the widening is not paid for with false alarms:
 *   - the headline rule alone:          0 entries flagged (it missed the real one)
 *   - headline rule OR struck-through:  1 entry flagged — the real one, and nothing else
 *   - a naive /FIXED|RESOLVED/ anywhere: 14 flagged, of which 13 are false — 93% over-match
 *     ("fixed" as an adjective: "the sidebar width is FIXED at 320px", "a FIXED grid", …)
 * The strike-through trigger looks at typography rather than words, so it cannot pick up the
 * adjective at all. That is the whole reason it is the right widening.
 */
const STRUCK_OUT = /^-\s+~~/;

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
      if (!CLAIMS_FIX.test(headline) && !STRUCK_OUT.test(entry.text)) continue;
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

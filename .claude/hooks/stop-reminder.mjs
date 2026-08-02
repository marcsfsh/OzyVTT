#!/usr/bin/env node
/*
 * Stop reminder for the vtt repo — completion-hygiene nudge.
 *
 * Intentionally NON-BLOCKING: it surfaces a systemMessage to the user and never
 * uses decision:"block", so it can never loop or hijack the conversation. It
 * speaks up only when there are uncommitted changes to *code* (apps/ or
 * packages/), so docs-only or conversational turns stay silent. FAILS OPEN.
 *
 * It reports the ledger's NET GROWTH rather than whether it was touched: a
 * touched/untouched boolean rewards the largest edit, which is the incentive
 * that produced a 1,952-line "snapshot". Not updating the ledger is described
 * here as usually correct.
 *
 * To make it actively push Claude to continue instead of just reminding, switch
 * the output to { decision: "block", hookSpecificOutput: { hookEventName: "Stop",
 * additionalContext: msg } } and keep the stop_hook_active guard below.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const exit0 = () => process.exit(0);

let data = {};
try {
  data = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  exit0();
}
// Never re-fire within a stop-hook continuation.
if (data && data.stop_hook_active) exit0();

let porcelain = '';
try {
  porcelain = execSync('git status --porcelain', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  exit0(); // not a git repo / git unavailable -> stay silent
}

const paths = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const isCode = (f) => /^(apps|packages)\/.*\.(ts|tsx|js|jsx|css)$/.test(f);
const codeChanged = paths.filter(isCode);
if (!codeChanged.length) exit0();

// A boolean "did anything under docs/ai-ledger/ change?" cannot tell an append from a
// replacement, so the largest edit satisfies it best — which is how a snapshot page reached
// 1,952 lines. Measure the net delta instead, and treat GROWTH as the thing worth mentioning.
let ledgerAdded = 0;
let ledgerDeleted = 0;
let ledgerTouched = false;
try {
  const numstat = execSync('git diff --numstat HEAD -- docs/ai-ledger/', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const row of numstat.split('\n').filter(Boolean)) {
    const [added, deleted] = row.split('\t');
    ledgerTouched = true;
    ledgerAdded += Number(added) || 0;
    ledgerDeleted += Number(deleted) || 0;
  }
} catch {
  /* fail open, as the rest of this hook does */
}

const bits = [
  `${codeChanged.length} code file(s) changed and uncommitted.`,
  'Before wrapping up: verify for real (npm run check / npm test, plus a browser + narrow-viewport pass for UI — see vtt-test-pass).',
];
if (!ledgerTouched) {
  bits.push('The ledger has not been updated. If nothing written down stopped being true, that is the correct outcome — most sessions add nothing.');
} else if (ledgerAdded - ledgerDeleted > 40) {
  bits.push(`docs/ai-ledger/ grew by ${ledgerAdded - ledgerDeleted} net lines. The ledger is a snapshot, not a changelog: replace what stopped being true and put history in docs/archive/. current-state.md has a hard 150-line cap enforced by npm test.`);
}

// This hook has never said the word "regenerate", despite firing on the packages that feed the
// two generated documents.
const feedsGeneratedDocs = (f) =>
  /^packages\/api-contract\/src\//.test(f) || /^packages\/domain\/src\//.test(f) || f === 'apps/server/src/app-map.ts';
if (codeChanged.some(feedsGeneratedDocs)) {
  bits.push('This change feeds docs/app-map.md and docs/api-reference.md — run `npm run docs`, or app-map.test.ts and reference.test.ts will fail.');
}

process.stdout.write(
  JSON.stringify({ systemMessage: 'vtt stop-reminder — completion hygiene: ' + bits.join(' ') }),
);
exit0();

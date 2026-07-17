#!/usr/bin/env node
/*
 * Stop reminder for the vtt repo — completion-hygiene nudge.
 *
 * Intentionally NON-BLOCKING: it surfaces a systemMessage to the user and never
 * uses decision:"block", so it can never loop or hijack the conversation. It
 * speaks up only when there are uncommitted changes to *code* (apps/ or
 * packages/), so docs-only or conversational turns stay silent. FAILS OPEN.
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

const ledgerTouched = paths.some((f) => f.startsWith('docs/ai-ledger/'));
const bits = [
  `${codeChanged.length} code file(s) changed and uncommitted.`,
  'Before wrapping up: verify for real (npm run check / npm test, plus a browser + narrow-viewport pass for UI — see vtt-test-pass).',
];
if (!ledgerTouched) {
  bits.push('The ledger has not been updated this session — record what changed via vtt-ledger-update (docs/ai-ledger/).');
}

process.stdout.write(
  JSON.stringify({ systemMessage: 'vtt stop-reminder — completion hygiene: ' + bits.join(' ') }),
);
exit0();

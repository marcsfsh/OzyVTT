#!/usr/bin/env node
/*
 * PreToolUse (Bash) danger-guard for the vtt repo.
 *
 * Deterministic, dependency-free, and FAILS OPEN: any parse/logic error exits 0
 * (defer to the normal permission flow) so a bug here can never block real work.
 *
 * - Catastrophic, irreversible commands  -> permissionDecision "deny"
 * - Merely destructive commands          -> permissionDecision "ask" (user confirms)
 * - Everything else                      -> exit 0 (no decision)
 *
 * Reads the hook payload as JSON on stdin: { tool_input: { command } }.
 */
import { readFileSync } from 'node:fs';

const exit0 = () => process.exit(0);
const emit = (decision, reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision, // "deny" | "ask"
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
};

let cmd = '';
try {
  const data = JSON.parse(readFileSync(0, 'utf8') || '{}');
  cmd = data && data.tool_input && typeof data.tool_input.command === 'string'
    ? data.tool_input.command
    : '';
} catch {
  exit0();
}
if (!cmd.trim()) exit0();

// --- recursive rm analysis (token-based) ---
const CATASTROPHIC = new Set([
  '/', '/*', '~', '~/', '*', '.', '..', '$home', '${home}',
  '/bin', '/etc', '/usr', '/var', '/lib', '/home', '/users', '/system',
]);
const tokens = cmd.split(/\s+/);
for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  if (t === 'rm' || t.endsWith('/rm')) {
    const rest = tokens.slice(i + 1);
    const recursive = rest.some((a) => a.startsWith('-') && /r/i.test(a));
    if (!recursive) continue;
    const targets = rest.filter((a) => !a.startsWith('-'));
    const catastrophic = targets.some((a) => {
      const norm = a.toLowerCase().replace(/\/+$/, '') || '/';
      return CATASTROPHIC.has(norm) || CATASTROPHIC.has(a.toLowerCase());
    });
    if (catastrophic) {
      emit('deny', 'vtt danger-guard: refusing a recursive delete of a root / home / wildcard path. If this is genuinely intended, run it yourself outside Claude.');
    }
    emit('ask', 'vtt danger-guard: recursive rm. Confirm the exact target and your branch/scope (see vtt-branch-safety) before proceeding.');
  }
}

// --- other destructive patterns -> ask ---
const ASK_RULES = [
  [/:\(\)\s*\{[^}]*\}\s*;\s*:/, 'possible fork bomb'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard discards uncommitted work'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean -f deletes untracked files'],
  [/\bgit\s+push\b[^\n]*--force(?!-with-lease)/i, 'non-lease force push can overwrite remote history'],
  [/\bgit\s+push\b[^\n]*\s-f(\s|$)/i, 'force push (-f) can overwrite remote history'],
  [/\bgit\s+branch\s+-D\b/i, 'git branch -D force-deletes a branch'],
  [/\bgit\s+rebase\b/i, 'git rebase rewrites history — keep it to your own branch'],
  [/\bgit\s+checkout\s+--\s/i, 'git checkout -- discards tracked file changes'],
  [/\bgit\s+restore\s+(?!--staged\b)/i, 'git restore discards tracked file changes'],
  [/\brm\b[^\n]*(?:data\/|auth\.json)/i, 'deleting local campaign data / GM credentials (data/, auth.json)'],
  [/\bfind\b[^\n]*-delete\b/i, 'find -delete performs a bulk delete'],
  [/\bmkfs\b|\bdd\s+if=[^\n]*of=\/dev\/|>\s*\/dev\/sd/i, 'raw disk write'],
  [/\bchmod\s+-R\b/i, 'recursive chmod'],
];
for (const [re, why] of ASK_RULES) {
  if (re.test(cmd)) {
    emit('ask', `vtt danger-guard: ${why}. Confirm scope + branch before proceeding.`);
  }
}

exit0();

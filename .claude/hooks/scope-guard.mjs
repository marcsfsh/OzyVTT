#!/usr/bin/env node
/*
 * UserPromptSubmit scope-guard for the vtt repo.
 *
 * Non-blocking. When a prompt touches a sensitive subsystem, it points at the
 * governing .claude/rules/*.md file(s) as additionalContext so they're front-of-mind
 * before work starts (those rules also auto-load when Claude opens matching files).
 * The full invariant text lives once in .claude/rules/. Never blocks; FAILS OPEN.
 *
 * Reads the hook payload as JSON on stdin: { prompt }.
 */
import { readFileSync } from 'node:fs';

const exit0 = () => process.exit(0);

let prompt = '';
try {
  const data = JSON.parse(readFileSync(0, 'utf8') || '{}');
  prompt = data && typeof data.prompt === 'string' ? data.prompt : '';
} catch {
  exit0();
}
if (!prompt.trim()) exit0();

// word-boundary keyword test (avoids 'roadmap' -> 'map' false positives)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (...kw) => kw.some((k) => new RegExp(`\\b${esc(k)}\\b`, 'i').test(prompt));

const reminders = [];
if (has('viewer', 'second screen', 'second-screen', 'present', 'pairing', 'table viewer', 'projection'))
  reminders.push('viewer safety — nothing GM-only reaches the public viewer: .claude/rules/viewer-safety.md');
if (has('auth', 'login', 'password', 'claim', 'role', 'permission', 'session', 'bootstrap', 'gm-only'))
  reminders.push('roles & auth — act only on the claimed character; gate GM-only per command; trust the signed token: .claude/rules/roles-auth.md');
if (has('socket', 'realtime', 'real-time', 'broadcast', 'revision', 'idempotency', 'emit') || /state:updated/i.test(prompt))
  reminders.push('realtime & server authority — contract lives once in packages/domain; validate + authorize per command: .claude/rules/realtime.md');
if (has('grid', 'token', 'map', 'annotation', 'calibrate', 'calibration', 'snap', 'scene'))
  reminders.push('maps & grid geometry — server owns snapping; client math is preview-only in image-pixel space: .claude/rules/maps-grid.md');
if (has('codex', 'worldbuilding', 'atlas', 'journal', 'quest', 'session log', 'calendar', 'wiki', 'marker', 'reveal', 'lore', 'timeline'))
  reminders.push('codex two-layer safety — a player sees the player half of a REVEALED record and nothing else; project in codex-projections.ts, never filter in the store or the router: .claude/rules/viewer-safety.md');
if (has('mobile', 'responsive', 'touch', 'phone', 'css', 'layout', 'viewport', 'drag', 'gesture'))
  reminders.push('mobile parity — phone + laptop first-class; touch-action:none; verify a narrow viewport: .claude/rules/mobile.md');
if (has('api', 'integration', 'openapi', 'endpoint', 'rest') || /\/api\/v1/i.test(prompt))
  reminders.push('public API contract — reuse the UI command/authorization/projection path; keep openApiDocument byte-identical: .claude/rules/api-contract.md');

// meaningful multi-file work -> suggest the packet workflow
if (prompt.length > 60 && has('refactor', 'redesign', 'rewrite', 'migrate', 'migration', 'implement', 'overhaul', 'feature'))
  reminders.push('This looks like meaningful, multi-file work — consider starting with vtt-task-packet (brief -> implement -> qa-check -> ledger) and route reading via vtt-context-router.');

if (!reminders.length) exit0();

process.stdout.write(
  JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        'vtt scope-guard — this prompt touches sensitive subsystem(s); the governing rule(s) below also auto-load when you open matching files:\n- ' + reminders.join('\n- '),
    },
  }),
);
exit0();

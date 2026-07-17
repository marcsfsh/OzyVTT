#!/usr/bin/env node
/*
 * UserPromptSubmit scope-guard for the vtt repo.
 *
 * Non-blocking. When a prompt touches a sensitive subsystem, it injects the
 * relevant hard invariant(s) as additionalContext so they're front-of-mind
 * before work starts. It never blocks the prompt and FAILS OPEN.
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
  reminders.push('Viewer safety: nothing GM-only (hidden actors/tokens, private rolls, GM controls, management metadata) may reach the public viewer. Re-check any new field on a viewer projection. See docs/ai-context/viewer-mode.md.');
if (has('auth', 'login', 'password', 'claim', 'role', 'permission', 'session', 'bootstrap', 'gm-only'))
  reminders.push('Roles: a player acts only on their claimed character; GM-only commands stay gated per command; role derives from the signed token, not network position. See docs/ai-context/auth-roles.md.');
if (has('socket', 'realtime', 'real-time', 'broadcast', 'revision', 'idempotency', 'emit') || /state:updated/i.test(prompt))
  reminders.push('Realtime: the wire contract lives once in packages/domain; the server stays sole authority; validate + authorize per command; preserve idempotency/revision handling. See docs/ai-context/realtime.md.');
if (has('grid', 'token', 'map', 'annotation', 'calibrate', 'calibration', 'snap', 'scene'))
  reminders.push('Maps: the server owns all snapping/geometry; client math is preview-only and works in image-pixel space (imagePointFromClient). See docs/ai-context/map-grid.md.');
if (has('mobile', 'responsive', 'touch', 'phone', 'css', 'layout', 'viewport', 'drag', 'gesture'))
  reminders.push('Mobile parity: phone + laptop are first-class; new draggable/zoomable surfaces set touch-action:none; verify at a narrow viewport. See docs/ai-context/mobile-ux.md.');
if (has('api', 'integration', 'openapi', 'endpoint', 'rest') || /\/api\/v1/i.test(prompt))
  reminders.push('Public API must reuse the same command/authorization/projection path as the UI (never a fork) and keep the served openApiDocument byte-identical to packages/api-contract. See docs/ai-context/architecture.md.');

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
        'vtt scope-guard — invariants relevant to this request:\n- ' + reminders.join('\n- '),
    },
  }),
);
exit0();

# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

## 2026-07-17 — Hooks + scheduled-workflow scaffold

Completed the remaining active outline items on the same branch:

- **Lifecycle hooks** (`.claude/settings.json` + `.claude/hooks/`, Node, fail-open):
  `danger-guard` (PreToolUse/Bash — deny catastrophic, ask on destructive),
  `scope-guard` (UserPromptSubmit — inject sensitive-area invariants as context),
  `stop-reminder` (Stop — non-blocking completion-hygiene nudge when code is
  uncommitted). Tested each with sample payloads. `.claude/hooks/README.md` documents
  them; `.gitignore` now ignores `.claude/settings.local.json`.
- **GitHub Actions schedule scaffold** (`.github/workflows/scheduled-ledger-drift.yml`):
  intentionally inert — cron commented out, `workflow_dispatch` only, placeholder job —
  the "bones" to configure later.

- **Optional reviewer subagents** (`.claude/agents/`): `ux-reviewer`, `test-reviewer`,
  `architecture-reviewer` — read-only, separate-context reviewers for large/cross-cutting
  changes, complementing the inline `vtt-ux-review` / `vtt-test-pass` skills. The outline
  marks these optional/sparing; delete them if you prefer inline-only review.

Opened PR #33 to `main`. This completes every item in the tooling outline except
configuring the (intentionally inert) scheduled workflow. Still no application code touched.

## 2026-07-17 — Claude Code tooling upgrade (foundation + scheduled slice)

Stood up the Claude Code tooling layer described in `docs/claude-code-tooling-outline.md`
(a small skill system, not a meta-agent). This session shipped the **foundation + scheduled
slice**:

- `CLAUDE.md` constitutional index (identity, commands, hard rules, context map).
- `docs/ai-context/` — 9 subsystem briefs seeded from a real code survey: product-vision,
  ux-principles, architecture, map-grid, viewer-mode, mobile-ux, realtime, auth-roles,
  testing.
- `docs/ai-ledger/` — current-state, decision-log, known-bugs, this file.
- `.claude/loop.md` — committed default `/loop` operator cadence.
- `.claude/skills/` — the full 9-skill roster: `vtt-task-packet`, `vtt-context-router`,
  `vtt-implement`, `vtt-qa-check`, `vtt-ledger-update`, `vtt-ux-review`, `vtt-test-pass`,
  `vtt-branch-safety`, `vtt-schedule` (the new scheduled-prompts/workflows item). This
  makes the packet → implement → QA → ledger workflow fully live.
- Added the **Scheduled prompts & workflows** section to the outline (key finding:
  session `/loop`/cron are runtime-only; `.claude/loop.md` + GitHub Actions `schedule:` are
  the code-committable pieces).

No application code touched — this is a tooling-only change on
`claude/code-improvements-outline-eqvh9n`.

**Follow-up:** hooks and the GitHub Actions scaffold were completed later the same day
(see the entry above).

## Before 2026-07-17 (context)

Cycle 4 merged to `main`: `#28` (batch A), `#29` (batch B), `#30` (PR C — per-drawing
colors, GM/player layer toggle, encounter pings). Cycle 4 PRs D/E/F planned in
`NEXT-STEPS.md`.

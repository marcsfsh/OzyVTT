# Claude Code hooks

Deterministic, lightweight guards wired in `.claude/settings.json`. They enforce the
`CLAUDE.md` rules that are cheap to check automatically, so the model doesn't have to
remember them every time. All three are written in Node (the repo already requires Node ≥24),
are dependency-free, and **fail open** — any error exits 0 so a bug in a hook can never block
real work.

| Hook | Event | What it does | Blocking? |
| --- | --- | --- | --- |
| `danger-guard.mjs` | `PreToolUse` (Bash) | `deny`s catastrophic commands (recursive delete of `/`, `~`, `*`, fork bombs, raw disk writes); `ask`s for merely destructive ones (`rm -r`, `git reset --hard`, `git clean -f`, non-lease force push, `git rebase`, deleting `data/`/`auth.json`, …). | Yes — deny / ask |
| `scope-guard.mjs` | `UserPromptSubmit` | Injects the relevant hard invariant as context when a prompt touches a sensitive subsystem (viewer safety, roles, realtime, maps, mobile, public API); nudges toward `vtt-task-packet` for multi-file work. | No |
| `stop-reminder.mjs` | `Stop` | When code under `apps/`/`packages/` is changed-but-uncommitted, reminds to verify and update the ledger. Silent for docs-only or conversational turns. | No (see note) |

## Notes & tuning

- **Portability:** commands use `node "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.mjs"`. This
  works on macOS/Linux and Git Bash. On native Windows `cmd`/PowerShell, adjust the command
  form if needed.
- **`stop-reminder` is intentionally non-blocking** to avoid loops and hijacking normal turns.
  To make it actively push Claude to keep going, switch its output to
  `{ "decision": "block", "hookSpecificOutput": { "hookEventName": "Stop", "additionalContext": "…" } }`
  — the `stop_hook_active` guard already prevents infinite loops.
- **Tuning `danger-guard`:** edit the `CATASTROPHIC` set and `ASK_RULES` list. Prefer `ask`
  over `deny` for anything a human might legitimately want.
- **Tuning `scope-guard`:** edit the keyword groups. Keep reminders short — they go straight
  into context on every matching prompt.
- **Disable one temporarily:** remove its block from `.claude/settings.json` (or the whole
  `hooks` key). Personal-only overrides belong in `.claude/settings.local.json` (git-ignored).

See `docs/claude-code-tooling-outline.md` → *Lightweight QA + hooks system* for the design intent.

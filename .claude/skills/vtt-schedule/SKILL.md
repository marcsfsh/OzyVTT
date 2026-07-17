---
name: vtt-schedule
description: Use when setting up, choosing, or reasoning about scheduled or recurring prompts and automation for this repo — /loop, one-shot reminders, GitHub Actions cron schedules, or cloud/desktop Routines. Covers which mechanism fits, this project's ready-made loop prompts, and the footguns of session-scoped scheduling.
---

# vtt-schedule

Pick the right scheduling mechanism, set it up correctly, and avoid the footguns.
Most Claude Code scheduling is **session-scoped and created at runtime** — only two
pieces are code-committed in this repo: `.claude/loop.md` and GitHub Actions cron
workflows.

## Choose the mechanism

| Need | Use | Committed? | Notes |
| --- | --- | --- | --- |
| Poll something while I'm in this session (build, CI, PR) | `/loop` | No | Stops when the session ends; 7-day cap. |
| One-time nudge later this session | one-shot reminder (natural language) | No | "remind me at 3pm to push"; self-deletes after firing. |
| The standing maintenance cadence for a bare `/loop` | `.claude/loop.md` | **Yes** | Already committed; edit that file to change the cadence. |
| Runs reliably with no open session / no machine on | **GitHub Actions `schedule:`** | **Yes** | The durable, unattended home. Sits beside `.github/workflows/ci.yml`. |
| Durable schedule that doesn't belong in CI | Cloud Routine (min 1h) or Desktop task (min 1m) | No (configured out-of-repo) | Mention to the user; don't try to "code" it. |

Rule of thumb: **if it must run when nobody's watching, it belongs in GitHub Actions,
not in `/loop`.** `/loop` is for the current session only.

## Using `/loop` in this repo

- Fixed interval: `/loop 5m <prompt>` runs on a cron cadence. Units: `s m h d`.
  Odd intervals (`7m`, `90m`) get rounded to a clean cron step.
- Dynamic: `/loop <prompt>` (no interval) lets Claude pick the delay each iteration —
  short while a build/PR is active, longer when quiet. Good for "watch until done."
- Bare `/loop` runs the committed cadence in `.claude/loop.md`.
- Stop a waiting loop with `Esc`.

### Ready-made loop prompts for this project

```text
/loop watch this branch's PR: if CI is red pull the failing job log and push a minimal fix; if review comments arrived, address or ask
```

```text
/loop 3m check whether `npm run build` finished; when it does, run `npm run check` and `npm test` and report pass/fail
```

```text
/loop nightly-style ledger-drift: compare recent commits against docs/ai-ledger and flag anything shipped but not recorded
```

```text
in 45 minutes, check whether `npm test` still passes on this branch
```

## Committed durable automation (GitHub Actions)

For anything that must run without an open session, add a workflow with a `schedule:`
trigger next to `.github/workflows/ci.yml`. Cron is 5-field, **UTC** in Actions
(unlike `/loop`, which is local time). Keep scheduled CI jobs read-mostly; if they
open a PR or push, scope that tightly.

```yaml
on:
  schedule:
    - cron: '17 7 * * *'   # 07:17 UTC daily — off the hour on purpose (see jitter)
  workflow_dispatch: {}      # allow manual runs too
```

Good candidates here: a nightly ledger-drift / bug-hunt report, a dependency or
`npm audit` check, a scheduled `npm run check && npm test && npm run build` health run.

## Footguns (name these before scheduling anything)

- **Session-scoped loss.** `/loop` and one-shot tasks live in the conversation. Clearing
  the session drops them; `--resume`/`--continue` restores unexpired ones.
- **7-day expiry.** Recurring `/loop` tasks fire one last time ~7 days after creation,
  then delete themselves. For longer, use Actions or a Routine.
- **Jitter.** Fire times get a deterministic offset (recurring: up to +30m or half the
  interval; top/bottom-of-hour one-shots: up to 90s early). If timing matters, pick a
  minute that isn't `:00`/`:30`.
- **No catch-up.** A fire missed because Claude was busy runs once when idle, not once
  per missed interval.
- **Fires between turns.** A scheduled prompt must be idempotent and must not take
  irreversible actions unless the transcript already authorized them (see
  `vtt-branch-safety`). Never let a loop push to or edit another agent's `claude/*` branch.
- **Skill self-invocation.** A scheduled fire only auto-runs skills Claude may invoke on
  its own. Keep operator skills self-invocable (no `disable-model-invocation: true`).
- **Disable switch.** `CLAUDE_CODE_DISABLE_CRON=1` turns off the scheduler and `/loop`.

## Manage tasks

Ask in natural language ("what scheduled tasks do I have?", "cancel the deploy check"),
or use the underlying tools: `CronCreate`, `CronList`, `CronDelete` (8-char IDs, max 50
tasks/session).

Reference: <https://code.claude.com/docs/en/scheduled-tasks>

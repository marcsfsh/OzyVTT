# Default `/loop` operator cadence

This file is the prompt a bare `/loop` runs in this repo. It defines the standing
maintenance cadence — not a list of separate scheduled tasks. It is ignored the
moment you pass your own `/loop <prompt>`. Keep it read-mostly, idempotent, and
branch-safe: a scheduled fire runs between turns, so it must not take irreversible
actions unless the transcript already authorized them.

On each iteration, work through these in order and stop at the first that has real
work; if everything is clean, say so in one line and wait for the next tick.

1. **Continue unfinished work.** If the conversation left a task mid-flight,
   resume it within its original scope. Do not start new initiatives here.

2. **Tend the current branch's PR.** If this branch has an open PR:
   - New review comments → address each, or ask via `AskUserQuestion` if a comment
     is ambiguous or architecturally significant. Resolve threads you've handled.
   - CI red → pull the failing job log, diagnose, push a minimal fix. Re-check after
     CI re-runs rather than assuming green.
   - Merge conflict → rebase/resolve only if the resolution is mechanical; otherwise
     surface it.
   Never touch another agent's `claude/*` branch (see `vtt-branch-safety`).

3. **Ledger-drift check.** Compare recent real changes against `docs/ai-ledger/`.
   If a shipped change isn't reflected, update `current-state.md` / `known-bugs.md` /
   `decision-log.md` concisely (use `vtt-ledger-update` if available). Don't rewrite
   history; append what changed.

4. **QA the last material change.** If code changed since the last QA pass, review it
   against its acceptance criteria — acceptance met, viewer safety, GM/player role
   boundaries, mobile parity, obvious regressions, and whether verification was real
   (`npm run check` / `npm run test`, plus a browser/mobile check for UI). Use
   `vtt-qa-check` if available; otherwise review inline. Report pass / pass-with-notes
   / fix-required. Only apply a fix here if it's small and unambiguous.

5. **Quiet cleanup.** If nothing above is pending, optionally run one small bug-hunt
   or simplification pass on recently touched code. Keep it bounded; propose, don't
   sprawl.

Verification commands for this repo: `npm run check`, `npm run test`, `npm run build`.
Do not push, delete, or run destructive commands unless continuing something the
conversation already authorized.

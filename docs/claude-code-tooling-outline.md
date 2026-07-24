# Claude Code tooling upgrade — outline

> **Status (2026-07-24): historical design rationale — not the live roster.** This is the
> original design spec for the Claude tooling system, kept for the "why" behind the skills,
> hooks, and ledger model. For the **current** roster of skills/agents/hooks see
> [`.claude/README.md`](../.claude/README.md); for **current build state** see
> [`docs/ai-ledger/current-state.md`](ai-ledger/current-state.md). Some counts below predate
> later additions — the roster grew to 10 skills (e.g. `vtt-orientation`), and the three
> subagents and the hooks are now implemented, not optional.

> **This is a tooling upgrade, not an app build.** The goal is to make Claude
> Code cheaper, more predictable, and more disciplined when working on the VTT,
> using Claude Code's own primitives (project memory, skills, hooks, scheduled
> tasks) rather than a heavy meta-agent in front of every request.

For Claude Code, this is a **small skill system**, not a large agent system.
Claude Code already supports persistent project memory through `CLAUDE.md`,
custom skills through `SKILL.md`, and hooks at lifecycle points such as prompt
submission and stopping, so the efficient setup is to use those features
selectively rather than inserting a heavy meta-agent before every request.

## Skills to make

### `vtt-task-packet`

* Converts a rough request into a compact, reusable task brief before implementation begins.
* Asks clarification only when the missing detail would materially affect the build, scope, UX, or verification.
* Produces a standardized packet with goal, relevant context files, constraints, acceptance criteria, verification steps, and files/docs to update.
* Should be used for meaningful work only: new features, UX changes, architecture work, bug clusters, or anything likely to affect multiple files.

### `vtt-context-router`

* Chooses which context files Claude should read for a task instead of loading the whole project brain.
* Maps task types to context sources: grid work, viewer mode, mobile UX, auth/roles, realtime, JSON import, testing, etc.
* Keeps `CLAUDE.md` small by making it an index rather than a full encyclopedia.
* Reduces usage by telling Claude, "For this task, read only these 2-4 files unless evidence shows you need more."

### `vtt-implement`

* Takes a completed task packet and turns it into actual code changes.
* Forces Claude to inspect existing implementation before proposing new structure.
* Keeps the work bounded to the task packet unless it finds a genuine blocker.
* Ends with a concise implementation summary: changed files, behavior added, verification run, and remaining risks.

### `vtt-qa-check`

* Reviews completed work against the original task packet.
* Checks acceptance criteria, mobile parity, viewer safety, GM/player role boundaries, obvious regressions, and whether verification was real.
* Produces either "pass," "pass with notes," or "fix required."
* If fixes are needed, it outputs a short follow-up prompt instead of performing a long review loop automatically.

### `vtt-ledger-update`

* Updates the project memory after meaningful work is complete.
* Writes concise changes into `current-state.md`, `known-bugs.md`, `decision-log.md`, or `BUILD_PLAN.md`.
* Prevents future Claude sessions from rediscovering old decisions or re-solving closed problems.
* Should be run after implementation or QA, not during every minor edit.

### `vtt-ux-review`

* Reviews whether a feature actually feels simple, obvious, and GM-friendly.
* Focuses on the VTT philosophy: "combat-first," "just works," "everything needed, nothing unnecessary."
* Flags friction like hidden controls, unclear states, too many settings, weak mobile affordances, or viewer-mode confusion.
* Best used after UI-heavy work such as grid setup, map controls, initiative, character selection, viewer mode, and mobile layouts.

### `vtt-test-pass`

* Defines the minimum verification expected before Claude calls work done.
* Separates quick checks, manual browser checks, mobile/narrow-screen checks, and full regression checks.
* Keeps verification from becoming vague phrases like "should work now."
* Useful when Claude makes implementation changes and needs to prove the app still runs.

### `vtt-branch-safety`

* Protects branches, files, and work owned by another agent.
* Forces Claude to check current branch, changed files, and intended scope before major edits.
* Blocks accidental takeover of Claude/other-agent branches or unrelated refactors.
* Should be referenced by `CLAUDE.md` and optionally reinforced with a lightweight hook.

## Task-packet format

The task packet should be a **single compact object of intent**, not a giant
prompt. Its purpose is to preserve clarity while minimizing repeated context.

```text
TASK PACKET

Title:
Short name of the work.

User intent:
Plain-English description of what Garrett wants.

Problem:
What is broken, missing, confusing, or insufficient.

Desired outcome:
What should be true when the work is complete.

Relevant context:
Specific files Claude should read first.

Constraints:
Rules Claude must not violate.

Acceptance criteria:
Observable requirements that determine whether the task is done.

Verification:
Commands, browser checks, or manual checks Claude must perform.

Docs/memory updates:
Which project-memory files should be updated afterward.

Out of scope:
Things Claude should not expand into during this task.

Risk notes:
Likely regressions, blockers, or design concerns.
```

Use this as the canonical shape:

```text
Title:
Replace grid wizard with 3x3 drag calibration.

User intent:
The current grid wizard is unintuitive. The GM should be able to click and drag
over a 3x3 area to set grid scale.

Problem:
Grid setup feels like a tool configuration screen instead of an obvious map interaction.

Desired outcome:
The GM selects a 3x3 area directly on the battlemap, the app infers grid scale,
and the result is immediately visible.

Relevant context:
- docs/ai-context/map-grid.md
- docs/ai-context/ux-principles.md
- docs/ai-context/viewer-mode.md
- docs/ai-ledger/known-bugs.md

Constraints:
- Do not expose GM calibration controls in viewer mode.
- Preserve mobile usability.
- Do not redesign unrelated map tools.
- Do not touch another agent's branch.

Acceptance criteria:
- GM can click-drag over a 3x3 grid area.
- Grid scale is inferred from the selected area.
- The UI explains the action in one short sentence.
- Result appears immediately on the map.
- Manual numeric configuration is secondary or hidden.
- Viewer mode remains player-safe.

Verification:
- Run app locally.
- Test upload/map calibration.
- Test desktop and narrow viewport.
- Confirm viewer mode does not expose calibration controls.

Docs/memory updates:
- docs/ai-ledger/current-state.md
- docs/ai-ledger/known-bugs.md
- docs/ai-ledger/decision-log.md if a new UX decision is made.

Out of scope:
- Full map annotation redesign.
- Regional/world map scale system.
- 3D dice or character import.

Risk notes:
Likely risk is state synchronization between GM map controls and viewer display.
```

The reusable architecture should be:

* `vtt-task-packet` creates the packet.
* `vtt-context-router` decides which context files matter.
* `vtt-implement` executes from the packet.
* `vtt-qa-check` reviews against the same packet.
* `vtt-ledger-update` records what changed.

This prevents the workflow from becoming "prompt soup." Every meaningful work
unit gets a small structured brief, and every review refers back to that brief.

## Best methods for keeping context modular

### Keep `CLAUDE.md` short and constitutional

* Use `CLAUDE.md` for permanent rules only: product identity, commands, branch safety, verification expectations, and where context lives.
* Do not use it as a giant project dump; Claude Code loads project memory into sessions, so oversized standing context wastes tokens.
* Put "read these files when relevant" instructions in `CLAUDE.md` instead of importing every file by default.
* Keep it stable; frequent churn in `CLAUDE.md` makes the system less predictable.

### Split context by subsystem

* Use files like `map-grid.md`, `viewer-mode.md`, `mobile-ux.md`, `realtime.md`, `auth-roles.md`, and `design-language.md`.
* Each file should describe decisions, constraints, expected behavior, and known edge cases for that subsystem.
* Claude should read the subsystem file only when the task touches that subsystem.
* This makes context retrievable rather than permanently loaded.

### Separate product memory from implementation memory

* Product memory answers: "What should this app feel like?"
* Implementation memory answers: "How is the app currently built?"
* Do not mix UX philosophy, architecture notes, bug logs, and task history into one huge file.
* Recommended split: `product-vision.md`, `ux-principles.md`, `architecture.md`, `current-state.md`, `known-bugs.md`, `decision-log.md`.

### Use a ledger instead of long chat history

* Keep `current-state.md` as the short source of truth for what exists now.
* Keep `decision-log.md` for durable decisions Claude should not relitigate.
* Keep `known-bugs.md` for active defects and suspected causes.
* Keep `session-summary.md` for recent work summaries, then periodically compress it into `current-state.md`.

### Use skills for procedures, not memory

* A skill should answer: "How should Claude perform this recurring type of work?"
* A context file should answer: "What does Claude need to know about this part of the app?"
* A task packet should answer: "What are we doing right now?"
* Mixing those three categories is what causes bloated prompts and bad retention.

## Lightweight QA + hooks system

Use QA as a **checkpoint**, not a parallel bureaucracy. Hooks are useful because
Claude Code supports user-defined commands at lifecycle events, but hooks should
enforce small deterministic rules rather than run full reviews every time.

### Manual QA skill: `vtt-qa-check`

* Invoke manually after significant implementation work.
* Reviews the task packet, changed behavior, verification evidence, and memory updates.
* Produces a fix prompt only if something materially failed.
* Keeps QA token use low because it runs only at milestone boundaries.

### Stop hook: "verification/doc reminder"

* Runs when Claude is about to finish.
* Checks for simple completion hygiene: files changed, but no verification mentioned; feature changed, but ledger not updated; TODOs left unresolved.
* Should not perform a full review; it should only nudge Claude not to stop prematurely.
* This is the highest-value hook because it prevents half-finished sessions.

### UserPromptSubmit hook: "scope guard"

* Runs before Claude receives the prompt.
* If the prompt is vague and likely high-impact, it can remind you to use `vtt-task-packet`.
* If the prompt touches sensitive areas, it can inject reminders: branch safety, viewer safety, mobile parity, verification.
* Do not make it rewrite every prompt; that recreates the expensive gateway problem.

### PreToolUse hook: "danger guard"

* Runs before risky actions such as destructive shell commands, broad deletes, branch changes, or mass file edits.
* Should block or require confirmation for destructive actions.
* Should protect known off-limits branches and files.
* Keep this deterministic; do not make it a reasoning-heavy reviewer.

### Optional subagents: use sparingly

* Add `ux-reviewer`, `test-reviewer`, and `architecture-reviewer` only after the basic skill system is working. *(All three are now implemented — see `.claude/agents/`.)*
* Use subagents when their review would keep the main context cleaner, not for every change.
* Good trigger: large UI change, realtime/state change, auth/role change, or cross-cutting refactor.
* Bad trigger: simple copy tweak, small CSS fix, one-line bug fix.

## Scheduled prompts & workflows

Claude Code can run prompts on a schedule, but most of that scheduling is
**session-scoped and created at runtime**, not defined in committed config.
Knowing which pieces are code-committable is what determines how this fits the
tooling upgrade. (Reference: <https://code.claude.com/docs/en/scheduled-tasks>.)

### What is NOT code-defined (runtime only)

* `/loop <interval> <prompt>` — runs a prompt on a fixed cron cadence for the life of the session (e.g. `/loop 5m check if CI passed`).
* `/loop <prompt>` with no interval — Claude picks the delay dynamically each iteration (short while a build/PR is active, longer when quiet).
* One-shot reminders in natural language ("remind me at 3pm to push the release branch").
* Under the hood these use the `CronCreate` / `CronList` / `CronDelete` tools. They are **session-scoped**: they only fire while the session is open and idle, expire after 7 days, and are not stored in the repo. Good for polling during a session; not a place to encode durable project process.

### What IS code-committable (this is what the upgrade builds)

* **`.claude/loop.md`** — a project-level file that defines the default prompt a bare `/loop` runs. This is the one piece of scheduling that lives in the repo. Project-level `.claude/loop.md` takes precedence over user-level `~/.claude/loop.md`. For this project it should encode the operator cadence: continue unfinished work, tend the current branch's PR (review comments, failed CI, merge conflicts), run a ledger-drift check, and invoke `vtt-qa-check` when something material changed. Plain Markdown, no required structure, keep it under 25 KB.
* **GitHub Actions `schedule:` triggers** — the durable, unattended, code-defined option, and the right home for anything that must run reliably without an open session. A committed workflow (e.g. a nightly ledger-drift / bug-hunt job, or a scheduled dependency/health check) runs on cron in CI. This project already has `.github/workflows/ci.yml` to sit alongside.

### Durable alternatives configured outside the repo (mention, don't build)

* **Cloud Routines** — run on Anthropic-managed infrastructure, minimum 1h interval, survive with no machine or open session. Use when a schedule must outlive a session but doesn't belong in CI.
* **Desktop scheduled tasks** — run locally, minimum 1m interval, have local file/tool access.

### How it plugs into the skill system

* The committed `.claude/loop.md` becomes the "operator cadence" and should invoke the same skills (`vtt-qa-check`, `vtt-ledger-update`) so scheduled runs follow the same discipline as manual work.
* A scheduled fire only auto-invokes skills Claude is allowed to self-invoke, so the operator skills must stay self-invocable (no `disable-model-invocation: true`).
* Keep scheduled work read-mostly and idempotent: it fires between turns and must not perform irreversible actions unless the transcript already authorized them (this matches `vtt-branch-safety`).
* Footguns to design around: the 7-day expiry on recurring tasks, deterministic jitter on fire times, no catch-up for missed fires, and loss of session-scoped tasks when the conversation is cleared.

### Skill to add: `vtt-schedule`

* Codifies WHEN to reach for `/loop` vs. a one-shot reminder vs. a committed GitHub Actions schedule vs. a Routine.
* Provides ready-made loop prompts for this project: watch a PR's CI, poll a long `npm run build`/`npm run test`, nightly ledger-drift check.
* Names the footguns above so a scheduled loop is never set up blind.

## The minimal initial build

Start with these files and skills:

```text
CLAUDE.md

docs/ai-context/
  product-vision.md
  ux-principles.md
  architecture.md
  map-grid.md
  viewer-mode.md
  mobile-ux.md
  realtime.md
  auth-roles.md
  testing.md

docs/ai-ledger/
  current-state.md
  decision-log.md
  known-bugs.md
  session-summary.md

.claude/
  loop.md                     # default /loop operator cadence (committed)
  skills/
    vtt-task-packet/
    vtt-context-router/
    vtt-implement/
    vtt-qa-check/
    vtt-ledger-update/
    vtt-ux-review/
    vtt-test-pass/
    vtt-branch-safety/
    vtt-schedule/
    vtt-orientation/

.github/workflows/
  scheduled-ledger-drift.yml  # optional durable schedule (nightly), sits beside ci.yml
```

The operating rule should be:

```text
For meaningful work:
  vtt-task-packet -> vtt-implement -> vtt-qa-check if needed -> vtt-ledger-update

For small work:
  direct prompt -> implement -> verify -> brief summary

For risky work:
  task packet required -> QA required -> ledger update required
```

That gives the efficiency of agentic prompting without paying for a meta-agent
on every single interaction.

## References

* Skills — <https://code.claude.com/docs/en/skills>
* Memory (`CLAUDE.md`) — <https://code.claude.com/docs/en/memory>
* Hooks — <https://code.claude.com/docs/en/hooks>
* Scheduled tasks (`/loop`, cron) — <https://code.claude.com/docs/en/scheduled-tasks>

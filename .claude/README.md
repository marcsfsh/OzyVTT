# Claude Code setup for this repo — roster

The single source of truth for **what Claude tooling exists here**. This repo drives Claude Code
with project memory, path-scoped rules, skills, subagents, and hooks — deliberately light (design
rationale in `docs/claude-code-tooling-outline.md`). Update this file when you add or remove a
skill / agent / rule / hook.

- **Memory:** root `CLAUDE.md` (constitutional index) → `docs/ai-context/` (how it's built) +
  `docs/ai-ledger/` (living state). Keep `CLAUDE.md` short and stable.
- **Verification bar:** `npm run check` (typecheck, `tsc --noEmit`) · `npm run test` (Vitest) ·
  `npm run build`; CI order is `test → check → build`.

## Skills (`.claude/skills/`, model-invocable)

| Skill | Use it when |
| --- | --- |
| `vtt-task-packet` | Turn a rough feature/bug/UX request into a compact task packet before meaningful work. |
| `vtt-context-router` | Pick the 2–4 `docs/ai-context` files worth reading for a task. |
| `vtt-implement` | Execute a completed task packet as bounded code changes. |
| `vtt-qa-check` | Review finished work against its packet → pass / pass-with-notes / fix-required. |
| `vtt-ledger-update` | Record verified, landed work into `docs/ai-ledger`. |
| `vtt-ux-review` | Post-UI friction review against combat-first / "just works". |
| `vtt-test-pass` | Choose + run the minimum credible verification; report what actually ran. |
| `vtt-branch-safety` | Guard branch / scope / ownership before major or multi-file edits. |
| `vtt-schedule` | Choose `/loop` vs one-shot vs GitHub Actions cron vs Routine; names the footguns. |
| `vtt-orientation` | Get oriented fast — points at `docs/app-map.md`, the command pipeline, viewer rules. |

## Subagents (`.claude/agents/`, isolated context, project memory)

All are read-only for the codebase; each keeps persistent memory under
`.claude/agent-memory/<name>/` (committed). Consult-before / update-after is baked into each.

| Agent | Tools | Model | Use it for |
| --- | --- | --- | --- |
| `architecture-reviewer` | Read, Grep, Glob | sonnet | Cross-cutting / architecturally significant changes vs invariants + ADRs. |
| `ux-reviewer` | Read, Grep, Glob | sonnet | Large / cross-cutting UI changes — friction vs combat-first. |
| `test-reviewer` | Read, Grep, Glob, Bash | haiku | Run the check/test/build tiers and report pass/fail with evidence. |
| `code-reviewer` | Read, Grep, Glob | sonnet | General correctness/quality diff review (complements the `/code-review` skill). |
| `viewer-safety-auditor` | Read, Grep, Glob | sonnet | Audit projection/viewer changes for GM-only leakage (the hardest invariant). |

## Path-scoped rules (`.claude/rules/`)

Each carries `paths:` frontmatter and auto-loads only when Claude opens a matching source file;
the `scope-guard` hook also points at them at prompt time. They hold the hard invariants once.

| Rule | Loads for |
| --- | --- |
| `viewer-safety.md` | `projections.ts`, `viewer-*.ts`, `apps/client/src/viewer/**` |
| `roles-auth.md` | auth / authorization / claims / credentials / command handlers, `api-contract` |
| `realtime.md` | `packages/domain/**`, `server.ts`, `game-operations.ts`, `game-commands.ts` |
| `maps-grid.md` | `grid-*`, `map-*`, token placement / annotations / fog, client `maps`/`scene(s)` |
| `mobile.md` | client `*.tsx`/`*.css`, `packages/ui/**` |
| `api-contract.md` | `packages/api-contract/**`, `api-v1.ts`, `*-http.ts` |

## Hooks (`.claude/settings.json` → `.claude/hooks/`)

Deterministic, dependency-free, **fail open**. Detail + tuning in `.claude/hooks/README.md`.

- `danger-guard.mjs` (PreToolUse/Bash) — denies catastrophic commands; asks for destructive ones.
- `scope-guard.mjs` (UserPromptSubmit) — points at the matching `.claude/rules/*` when a prompt
  touches a sensitive subsystem; nudges toward `vtt-task-packet`.
- `stop-reminder.mjs` (Stop) — when `apps/`/`packages/` code is changed-but-uncommitted, nudges to
  verify + update the ledger.

`.claude/settings.json` also carries a `permissions.allow` list for routine check/test/build/git
commands and enables auto memory (required for the subagents' persistent memory).

## Scheduling

- `.claude/loop.md` — the default `/loop` operator cadence (committed).
- `.github/workflows/scheduled-ledger-drift.yml` — an intentional scaffold (cron commented out);
  the durable home for any future unattended ledger-drift / health job.

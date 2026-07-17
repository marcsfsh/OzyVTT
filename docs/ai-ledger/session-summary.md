# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

## 2026-07-17 — SRD 5.2.1 content pipeline (integration phase A, audited)

Reviewed 7 candidate content/tool repos with the owner; decision (ADR-0015): source SRD
content from **open5e `srd-2024` (CC BY 4.0)** — the only complete *structured* 2024
bestiary; 2014/OGL and third-party data excluded. Built the pipeline in
`packages/content-srd-5.2.1`: vendored fixtures, deterministic ETL/adapter (fail-closed
validation of every bundle), committed bundles, server-side loaders, 11 tests incl.
dice-grammar validation of every formula. `check`/`test` (189)/`build` green. Also merged
PR #32 (dock + declutter) after live verification.

A full audit pass then **cross-validated every statblock against an independent CC-BY copy
of the SRD text**: exact 330/330 coverage both ways, 0 AC/HP/CR mismatches. Curation that
came out of it (documented in the package README + ETL tables): excluded `giant-fly` (no
SRD statblock), restored 25 Tiny sizes open5e flattens to small, fixed octopus CON/CHA
(modifiers-as-scores) and greater-invisibility's empty description. Bundles now also carry
**spells (339, structured save/damage/upcast), weapons (38) + property/mastery texts (17),
armor (13, AC-derivation fields), skills (18), damage types (13), rules glossary (56)**.
Deliberately not bundled: classes/species/feats/backgrounds/magic items (char-builder/loot
scope). Attribution wording verified against the SRD's own Legal Information page.

**Follow-up:** phase B — GM browses bundle + `actor:add-from-definition` command
instantiates monsters into encounters (then C HP/damage → D conditions → E action economy →
F targeting/resolution → G sheet panel).

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

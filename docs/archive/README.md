# Archive

Superseded or historical documents kept for provenance. **Nothing here is current guidance.**
They were moved out of the active tree so the working docs stay trustworthy, and preserved
rather than deleted so the reasoning behind shipped work stays readable.

**The convention.** Every file below opens with a quoted header block giving *what it is*,
*current through* (with the last commit that kept it true), *what superseded it*, *what to read
it for*, *what not to*, and the standing warning that its paths, line numbers and counts are
frozen at that date. **That header is the authoritative description of the file — this index is
only a way in.** Nothing else in an archived document is maintained, and dead file paths inside
one are expected: the documentation freshness checks exempt `docs/archive/` for exactly that
reason (`apps/server/test/docs-paths.test.ts`). That exemption is what makes "move it to the
archive" a legitimate repair rather than a way to hide drift.

**Adding one.** Move the file, prepend the header block, add a line here. If a live document or
a source comment cites it, **banner it in place instead** — moving it breaks the citation.

## Contents

**Ledger history** — the accumulated history lifted out of `docs/ai-ledger/` on 2026-08-01.

- `ai-ledger/current-state-history-2026-08-01.md` — the dated release notes that had grown inside
  the state page. Superseded by `docs/ai-ledger/current-state.md`, rewritten as a capped snapshot.
- `ai-ledger/known-bugs-resolved-2026-08-01.md` — resolved, duplicated and refuted bug entries, in
  two passes. Superseded by `docs/ai-ledger/known-bugs.md`, where every remaining entry is
  reproducible at HEAD.
- `ai-ledger/session-history.md` — the rolling session log, moved from `session-summary.md`.
  **The one file in this archive that is still written to**; it is history by design, not a
  superseded document.

**Plans and specifications whose work shipped.**

- `BUILD_PLAN-backlog-2026-07-24.md` — the `BUILD_PLAN.md` backlog (§1.4, §1.7, §2.1-§2.5,
  §3-§28, §29.1, §29.3-§29.5, Appendices A and B), lifted whole with its numbering intact.
  `BUILD_PLAN.md` keeps the live roadmap, queue, risk register, non-goals and dashboard.
- `NEXT-STEPS.md` — the Cycle-4 execution plan (PRs D, E, F). All of it shipped.
- `claude-code-tooling-outline.md` — the original design spec for the `.claude/` tooling layer.
  The live roster is `.claude/README.md`.
- `task-packets/dndbeyond-pdf-importer.md` — task packet for the PDF importer. Shipped; see
  ADR-0018 and `packages/dndbeyond-pdf/`.
- `product/codex-suite-assessment.md` · `codex-suite-spec.md` · `codex-suite-design.md` ·
  `codex-suite-plan.md` · `codex-campaign-tracking.md` · `codex-phase4-handoff.md` — the four
  stages of the Codex worldbuilding suite plus its campaign-tracking programme and mid-flight
  handoff. M1–M12 all shipped in `706eab5` (#52). Live rules: `docs/ai-context/codex.md`.

**Design and review rounds that closed.**

- `product/character-sheet-v2-feedback.md`, `v3-feedback.md`, `v4-feedback.md`, `v5-feedback.md`,
  `v6-feedback.md` — the five GM playtest rounds on the character sheet and the decisions each
  produced (v6 is the final round). Superseded by the shipped sheet (ADR-0021).
- `product/character-sheet-styleguide-audit.md` — the completed design-system compliance audit
  and its remediation record. Live design system: `docs/ai-context/design-language.md`.

**Evaluations and superseded descriptions.**

- `ARCHITECTURE.md` — the pre-SQLite architecture overview. Superseded by
  `docs/ai-context/architecture.md` for the rules and the generated `docs/app-map.md` for the
  shape; the archived copy also called persistence "Local JSON", which it never was after
  `node:sqlite` landed.
- `reference-repos.md` — a 2026-07 license and usefulness evaluation of ten candidate reference
  repositories. The evaluation finished; nothing was ingested wholesale.

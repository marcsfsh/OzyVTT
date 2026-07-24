# Archive

Superseded or historical documents kept for provenance. Nothing here is current
guidance — do not treat these as the source of truth. They were moved out of the
active tree during the "Claude Cleanup & Setup" pass so the working docs stay
trustworthy, but preserved (not deleted) so the reasoning behind shipped work
remains readable. Git history has the full record.

## Contents

- `ARCHITECTURE.md` — early root architecture summary. Superseded by the maintained
  `docs/ai-context/architecture.md` (which is accurate and lists all workspaces) and
  the generated `docs/app-map.md`. The archived copy also carried stale facts (it
  described persistence as "Local JSON" when the app uses `node:sqlite`/WAL).
- `NEXT-STEPS.md` — a point-in-time "Cycle 4 remaining work" plan. Its PRs shipped
  (scene-centric IA, Open-API completion). Current roadmap lives in `BUILD_PLAN.md`;
  near-term state lives in `docs/ai-ledger/current-state.md`.
- `product/character-sheet-v2..v6-feedback.md` — the iterative design-review rounds
  for the player character sheet. Superseded by the shipped sheet (ADR-0021) and
  `docs/ai-context/design-language.md`.
- `product/character-sheet-styleguide-audit.md` — the completed design-system
  compliance audit + remediation record for the character sheet (2026-07-23). Kept
  as a historical record of that work.

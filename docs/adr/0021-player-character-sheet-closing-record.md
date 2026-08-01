# ADR-0021 closing record: the guided character builder shipped

## Status

Closed — 2026-08-01. Records what shipped. **ADR-0021 is unchanged** and is still correct
about the play sheet; this record closes its decision 1 only.

**Closes** ADR-0021 decision 1 — "Ship an interactive *play* sheet, not a guided builder —
yet … The full **builder** … is the **next roadmap update**"
(`docs/adr/0021-player-character-sheet.md`).

> **Skeleton — structure only.** Plan A owns this file's existence and its numbering.
> **This is the fourth closing record**, added by MASTER-PLAN §9 **O-1 (client default:
> option (a))**, which overrides Plan A §8 Q1's citation-deletion route: all four stale ADRs
> get records, because treating one differently is the inconsistency that produced the drift.
> D13 forbids editing the original, so this is a separate file whose name sorts immediately
> after it. Plan B §5.3 (Developer 2) writes the prose.

## What happened

_Awaiting Plan B §5.3 (Developer 2): the guided builder shipped on 2026-07-28 in `3144e58`
(#50) — `apps/client/src/builder/` (the wizard), `apps/server/src/character-build.ts`
(server-side assembly and re-validation), `GameState.builderPolicy`
(`packages/domain/src/index.ts`), and the `packages/content-srd-5.2.1` bundles it offers._

## What this changes elsewhere

_Awaiting Plan B §5.3 (Developer 2): the superseded "not a character builder" boundary is still
asserted in several documents. `packages/content-srd-5.2.1/README.md` currently holds the only
correct record of the scope change in the repo — that wording is the model to reuse._

## What is still open

_Awaiting Plan B §5.3 (Developer 2): Phase 3 of `docs/task-packets/character-builder.md`
(`characterDrafts`, resume-anywhere) is genuinely open, and `apps/client/src/builder/draft.ts`
says so in the same words._

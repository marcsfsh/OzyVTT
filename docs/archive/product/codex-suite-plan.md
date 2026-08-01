> ## ⚠ ARCHIVED — 2026-08-01
>
> **What this is:** Stage Three (plan half) implementation plan for the Codex worldbuilding suite: milestones M1-M12.
> **Current through:** 2026-07-28  (last commit that kept it true: `066f47a`)
> **Superseded by:** nothing; M1-M12 all shipped in `706eab5` (#52). Live rules: `docs/ai-context/codex.md`.
> **Read this for:** how the work was sequenced and why the milestones were cut where they were.
> **Do not read this for:** what remains to be built. Every milestone here is delivered, and its file references predate the overhaul.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

# Codex worldbuilding suite — implementation plan

Date: 2026-07-28 · Status: Stage Three (plan half) — **awaiting owner approval.** No product code
changed.

Requirements: `codex-suite-spec.md`. Design: `codex-suite-design.md`. Evidence: `codex-suite-assessment.md`.

Milestone order follows owner decision **D-1** (Completion → Foundation → Integration → Campaign
tracking). **Thirteen** milestones. **M1–M7 are the active programme**; M8–M12 are approved,
specified in `codex-campaign-tracking.md`, and deferred by owner decision U-1.

**Revised after Stage Four adversarial review** — four major findings accepted and fixed: CP-2 split
into M1b with server work (the original "no server work" claim was wrong); `packages/api-contract`
added to every route-adding milestone (`.claude/rules/api-contract.md` requires byte-identical
parity); viewer-safety tests added to M8/M11; acceptance criterion A-3 restated as verifiable.

---

## Ordering note — one call made inside the owner's decision

D-1 puts Completion before Foundation, accepting that completion work lands before the test harness
exists. **Within Foundation, this plan puts the harness (CF-5) first (M3), before the design-system
refactor (M4).** Reason: M4 swaps six primitives across 14 files — the single highest-regression-risk
change in the programme — and doing it unprotected would compound D-1's risk rather than start
retiring it. This respects D-1's ordering between phases; it only orders *within* Foundation.

**Consequence still outstanding:** M1 and M2 ship with manual verification only. Accepted per D-1,
restated here so it is not forgotten. M3 adds characterization tests covering M1/M2 behaviour
retroactively.

---

## Milestone format

Each milestone states: **Goal · Requirements · Excludes · Depends on · Owns (files) · Reuse · Risks ·
Verification · Docs · Escalate if**.

---

## Phase 1 — Completion (owner's first priority)

### M1 · Unreachable capabilities + urgent defect

- **Goal.** Give every built-but-unreachable capability a real entry point; fix the data-loss defect.
- **Requirements.** CP-1, CP-3, CP-4, CP-5, CP-6, CP-7, CD-1.
- **Requirements moved out.** **CP-2 (GM preview) is now M1b** — adversarial review established it
  needs server work; see below.
- **Excludes.** Combat bridge (M2). Any design-system refactor (M4). Any new record type.
- **Depends on.** Nothing. **Verified:** `PATCH /codex/maps/:id` and `POST /codex/maps/:id/parent`
  exist and are GM-gated (`codex-http.ts:318,323`); the client methods match those routes exactly.
- **Owns.** `codex/PlayerCodex.tsx` (CP-1 search input), `codex/AtlasView.tsx`,
  `codex/MarkerInspector.tsx`, `codex/JournalView.tsx` (CD-1). Server: none — routes exist.
- **Reuse.** Existing `RevealSwitch`. **Not `EntityPicker` for CP-7** — it is typed to the Codex
  `EntityType` vocabulary, not actors; CP-7 needs an actor selector, and per design R9 any new
  picker goes to `@vtt/ui`, not inline.
- **Risks.** CP-6 (root maps) touches tree-building logic the breadcrumb and drill chips depend on.
  CP-7's actor selector is the one place M1 could grow a component — keep it minimal or defer.
- **Verification.** API-method sweep shows the CP-1/3/4/5/7 methods now have callers (A-1). CD-1
  reproduction (compose a new entry → click Edit on another → draft survives) no longer fails.
  Narrow-viewport pass on every touched surface. `check`/`test`/`build` green.
- **Docs.** `current-state.md`; `known-bugs.md` (CD-1 resolved).
- **Escalate if.** CP-6 requires a migration, or CP-7's actor selector cannot be built without a new
  `@vtt/ui` primitive with non-trivial design.

### M1b · GM preview of the player Codex

- **Goal.** Let the GM see exactly what players see — truthfully.
- **Requirements.** CP-2.
- **Depends on.** M1.
- **Owns.** **Server:** `codex-http.ts` (preview principal or audited role downgrade),
  `codex-projections.ts` if the downgrade needs a seam, **`packages/api-contract`** (new/changed
  route must stay byte-identical), `apps/client/src/main.tsx`, `codex/PlayerCodex.tsx`.
- **Why this is not a client mount.** `ViewerPreviewPanel` mints a *separate principal* via
  `/api/v1/viewer/preview-session` and iframes `/viewer.html` (`ViewerPreviewPanel.tsx:24-46`). The
  Codex has neither. And `roleOf()` checks `authorizeGm` first (`codex-http.ts:146-151`), so
  `PlayerCodex` mounted with a GM token would receive **GM projections** — a preview showing
  unrevealed content while claiming to be the player view.
- **Risks.** **Highest-consequence viewer-safety work in Phase 1.** A false preview is worse than no
  preview: it would give the GM positive but wrong assurance about exposure.
- **Verification.** HTTP test proving the preview principal receives **byte-identical payloads to a
  real player session** — not merely "looks right" (A-8). `viewer-safety-auditor` review before merge.
- **Docs.** `api-reference.md`; `decision-log.md`.
- **Escalate if.** A genuine player principal cannot be minted without changes to the auth model.

### M2 · Combat bridge and replay integration

- **Goal.** Make the auto-logged battle findable, dated, and connected to its replay.
- **Requirements.** CP-8, **CP-9 (location half only)**, CD-8 (bridge tests).
- **Excludes.** Suite-wide search (M6). **CP-9's "past battles for a *session*" half — deferred to
  M9**, because session records do not exist until then and `codex-store.ts:1134` currently hardcodes
  `sessionNumber: null` on combat entries. Flagged by adversarial review; the original M2 scope was
  undeliverable as written.
- **Depends on.** M1 (marker journal readback is the surface CP-9 extends).
- **Owns.** `apps/server/src/server.ts` (bridge call site), `codex-store.ts` (`appendCombatEntry`),
  a new GM-only route joining an entry to its archive summary, **`packages/api-contract`** (the new
  route must appear in `CODEX_PATHS` and keep `openApiDocument` byte-identical — `.claude/rules/api-contract.md`).
  Client: `MarkerInspector`, `JournalView`.
- **Reuse.** Existing `calendar.currentDate`; existing archive endpoints consumed by `ReplayPanel`.
- **Risks.** **K2 — the hard one.** Encounter archives contain GM-only narration and are documented
  as unreachable by players. Surfacing them in a suite that has a player layer is the highest
  viewer-safety risk in the programme. Also: auto-dating writes to entries whose dates the calendar
  reflow recomputes (K3).
- **Verification.** **HTTP-boundary test proving a player session cannot reach any replay data**
  (A-8) — non-negotiable, not inspection. Combat entry lands in the correct in-world year. Bridge
  gains its first test coverage. `viewer-safety-auditor` review before merge.
- **Docs.** `decision-log.md` (D-5 auto-date/GM-only rationale); `current-state.md`.
- **Escalate if.** Replay data cannot be exposed in the Codex without a player-reachable path.

---

## Phase 2 — Foundation

### M3 · Client test harness

- **Goal.** Make Codex regressions detectable. Retro-cover M1/M2.
- **Requirements.** CF-5, CD-8 (migration v8/v9 coverage).
- **Excludes.** Any product behaviour change. If a test finds a bug, it is recorded, not fixed here.
- **Depends on.** M1, M2 (so their behaviour is characterized).
- **Owns.** `apps/client/package.json` (new `test` script), test config, `apps/client/src/codex/**`
  test files. Server: `codex-store.test.ts` (migration rows).
- **Reuse.** Vitest 4, already used by every workspace that has tests. **A DOM environment is a new
  dependency** and must be approved (see Escalate). `packages/ui` remains untested — out of scope here.
- **Risks.** Adding a client test script changes what `npm test` and CI run — a slow or flaky suite
  taxes every future change. Client tests need a DOM environment the repo has never configured.
- **Verification.** `npm test` runs client tests; CI passes on Node 24. Coverage of the three named
  areas: two-layer secrecy, save/conflict path, cross-mode navigation. Baseline counts unchanged
  elsewhere (A-10).
- **Docs.** `docs/ai-context/testing.md` — it currently states `@vtt/web` has no test script.
- **Escalate if.** A DOM environment cannot be added without a dependency the owner should approve.

### M4 · Design-system adoption

- **Goal.** Stop the Codex being a parallel component vocabulary.
- **Requirements.** CF-1, CF-2, CF-6, CD-4, CD-7.
- **Excludes.** Touch targets and responsive layout (M5). No visual redesign — swaps must be
  behaviour-preserving.
- **Depends on.** **M3.** This is why the harness moved first.
- **Owns.** All 14 files in `apps/client/src/codex/` including **`MapSurface.tsx` and
  `CodexImage.tsx`** (the two bespoke loading affordances `Skeleton` replaces), plus `codex.css`.
- **Reuse.** `SaveState`, `Chip`, `Menu`/`MenuItem`, `TagInput`, `Skeleton`, `Alert`/`useToast`.
- **Risks.** Highest regression risk in the programme — six swaps across every Codex file. `TagInput`
  vs the existing comma-split is a **data-shape** change, not just visual. Design-language §10.2
  forbids new inline components: if a swap needs a primitive that doesn't exist, it goes to `@vtt/ui`.
- **Verification.** No hand-rolled equivalent remains where a primitive exists (A-2). Primitive count
  comparable to Homebrew's. Existing tags round-trip through `TagInput` unchanged. Every mode shows a
  loading and an error state (CF-2). Theme cycle × 3 per design-language §10.3.
- **Docs.** `decision-log.md` — record the adoption rule so it does not regress.
- **Escalate if.** Any swap cannot preserve behaviour, or requires a new `@vtt/ui` primitive with
  non-trivial design.

### M5 · Mobile parity and remaining defects

- **Goal.** Meet the 44px floor everywhere; close the remaining confirmed defects.
- **Requirements.** CF-3, CF-4, CD-2, CD-3, CD-5, CD-6.
- **Excludes.** New capability.
- **Depends on.** M4.
- **Owns.** `codex.css`, `NotebookTree.tsx`, `RelationshipGraph.tsx`, `PageTimeline.tsx`,
  `MarkerInspector.tsx`, `AtlasView.tsx`, **`PageEditor.tsx`** (CD-3 conflict copy); server
  `codex-store.ts` (CD-2 field pruning).
- **Reuse.** `--tap-min`/`.tap-target`; the documented breakpoint ladder.
- **Risks.** CD-2 changes server write behaviour — must not drop fields a GM legitimately kept.
  CD-3 is a copy/doc fix under D-4, **not** a concurrency change; resist scope drift.
- **Verification.** Zero interactive controls below 44px (A-3), route stated per design-language
  §10.4. World/Journal/Graph verified at narrow width. CD-2 proven by an HTTP test: an
  `entityType`-only PATCH no longer strands foreign keys in the player payload.
- **Docs.** `known-bugs.md`; `decision-log.md` (D-4 single-writer policy made explicit).
- **Escalate if.** CD-2's server-side pruning would delete data a GM could not recover.

---

## Phase 3 — Integration

### M6 · Suite-wide search and tags

- **Goal.** One search, all record types. Tags everywhere.
- **Requirements.** CI-1, CI-2.
- **Excludes.** Return edges (M7).
- **Depends on.** M4 (search UI uses adopted primitives).
- **Owns.** `codex-store.ts` (FTS schema + migration), `codex-http.ts`, **`packages/api-contract`**,
  `codex/api.ts`, `CodexWorkspace.tsx`, `CommandPalette.tsx`, `PlayerCodex.tsx`,
  **`JournalView.tsx` + `MarkerInspector.tsx`** (CI-2 tag editing on entries and markers).
- **Reuse.** Existing FTS pattern and the dual-role search route; existing `TagInput` from M4.
- **Risks.** FTS schema change on a table with existing rows — **needs a migration with backfill**
  (K7). Player search must index only player-visible content: the existing page split is the model,
  and journal/marker indexes must follow it exactly or this becomes a leak.
- **Verification.** Search returns entries and markers from rail and palette (A-6). **HTTP test: a
  player search cannot surface GM-only entry text or a hidden marker label** (A-8). Existing page
  search unchanged.
- **Docs.** `api-reference.md` regenerated; `decision-log.md`.
- **Escalate if.** Indexing GM and player layers separately for three record types proves
  materially more complex than the page precedent.

### M7 · Return edges, the Campaign dashboard, Graph

- **Goal.** Kill the star topology; **rename `World` → `Campaign`** and make it a real dashboard; make Graph tell the truth.
- **Requirements.** CI-3, CI-4, CI-5, CI-6, CI-7, CI-8, CI-9.
- **Excludes.** Campaign records (Phase 4).
- **Depends on.** M6.
- **Owns.** `codex-http.ts` (new page→markers reverse route; whole-graph backlinks feed),
  **`packages/api-contract`** (two new routes), `codex-store.ts`, `codex-projections.ts`,
  `PageEditor.tsx` (Connections section), `WorldHome.tsx` (**renamed to the Campaign dashboard** — file rename plus the mode label in `CodexWorkspace.tsx` and `PlayerCodex.tsx`), `RelationshipGraph.tsx`,
  `CodexWorkspace.tsx`, **`JournalView.tsx` + `AtlasView.tsx`** (CI-6 entry→marker/replay edge).
- **Reuse.** `projectPlayerMarker` for the reverse lookup — it must project, not bypass.
- **Risks.** **The reverse marker lookup is a new player-reachable read** — it must go through
  `codex-projections.ts` or it leaks hidden pins. CI-8's backlink edges must respect the
  both-endpoints-revealed rule the typed-edge feed already enforces. CI-7 gives the dashboard data it never
  had — a new fetch path on the suite's most-loaded surface. **The rename touches both GM and player
  mode bars and the command palette's goto targets**; miss one and the vocabulary splits (P4).
- **Verification.** All four return edges reachable from an open page (A-5). **Viewer-safety audit of
  both new feeds** (A-8). Graph no longer excludes orphans from the frame; wiki-link edges visually
  distinct. World recency excludes housekeeping (CI-9).
- **Docs.** `api-reference.md`; `decision-log.md`; `current-state.md`.
- **Escalate if.** The backlink graph feed cannot be made viewer-safe without a new projection concept.

---

## Phase 4 — Campaign tracking (M8–M12) — DEFERRED, fully specified elsewhere

**Owner decision (U-1): run M1–M7 now. M8–M12 are approved and specified but not yet built.**

The full specification — data model with reasoning, five milestones in this document's format, hard
constraints, the legacy `session_number` transition problem, open questions, and a rejected-alternatives
register — lives in its own artifact so a future session can implement it without this conversation:

> **`docs/product/codex-campaign-tracking.md`**

**Architecture summary (decided after owner brainstorm; supersedes the earlier draft):**

- **No sixth mode.** `World` is renamed **`Campaign`** and becomes the dashboard (D-10).
- **Three new tables**, not five: `codex_sessions`, `codex_quests`, `codex_standing` (D-11).
- **Four new timeline kinds** on the existing `codex_journal` (`deadline`, `downtime`, `milestone`,
  `standing`) via its existing `kind` discriminator plus an additive `payload_json`.
- **Prep and recap are the two layers of one session record** (D-13) — so the recap *is* the player
  projection, and no new player-facing surface exists.
- Prep is reachable **two ways**: the session's full view, and a session-console drawer available from
  any Codex mode (DESIGN DECISION 3).

**M1–M7 remain a complete, coherent deliverable on their own.** Nothing in them depends on M8–M12.

---

## Requirement coverage matrix

| Requirement | Milestone | Verified by |
| --- | --- | --- |
| CP-1, CP-3…CP-7 | M1 | API sweep (A-1) |
| CP-2 | **M1b** | Preview payload byte-identical to a real player session (A-8) |
| CP-8, CP-9 (location) | M2 | HTTP viewer-safety test (A-8), timeline placement |
| CP-9 (session) | M9 *(deferred)* | see `codex-campaign-tracking.md` |
| CF-5 | M3 | CI runs client tests (A-4) |
| CF-1, CF-2, CF-6 | M4 | Primitive audit (A-2), per-mode states |
| CF-3, CF-4 | M5 | Tap-target audit (A-3), narrow viewport (A-9) |
| CD-1 | M1 | Reproduction no longer fails (A-7) |
| CD-4, CD-7 | M4 | A-7 |
| CD-2, CD-3, CD-5, CD-6 | M5 | HTTP test (CD-2), A-7 |
| CD-8 | M2, M3 | New test coverage |
| CI-1, CI-2 | M6 | A-6, player-search leak test |
| CI-3…CI-9 | M7 | A-5, viewer-safety audit |
| CT-11, CT-12 | M8 *(deferred)* | see `codex-campaign-tracking.md` |
| CT-1, CT-2, CT-3 | M9 *(deferred)* | see `codex-campaign-tracking.md` |
| CT-4 | M10 *(deferred)* | see `codex-campaign-tracking.md` |
| CT-5, CT-10 | M11 *(deferred)* | see `codex-campaign-tracking.md` |
| CT-6…CT-9 | M12 *(deferred)* | see `codex-campaign-tracking.md` |

**All 44 requirement IDs are covered (A-11).** Thirteen milestones after adversarial review split
M1b out of M1.

---

## Programme-level risks

| # | Risk | Mitigation |
| --- | --- | --- |
| PR-1 | M1/M2 ship without automated protection (D-1). | M3 adds characterization tests retroactively; manual verification recorded per milestone. |
| PR-2 | Viewer safety is touched in **M1b, M2, M6, M7, M8, M9, M10, M11, M12** — nine milestones. M8 and M11 were missing from this list until adversarial review caught that any record joining the chronicle is player-reachable via `PlayerCodex.tsx:42`. | Every one of those has an HTTP-boundary test as an acceptance criterion, plus `viewer-safety-auditor` review. Never inspection alone. |
| PR-3 | Five new record types (M9–M12) each need schema, migration, routes, projection, two UIs, mobile, tests. | This is the §9 scope concern. M8–M12 are a clean cut point. |
| PR-4 | K3 — calendar reflow interacts with M8 and M11. | Explicit transactional design in M11; raw dates stay source of truth. |
| PR-5 | M4 is a wide refactor. | Sequenced after the harness; behaviour-preserving swaps only. |
| PR-6 | Six tabs (DQ-1) may over-fill the mode bar. | Fallback: Campaign as a Journal sub-view. Decide before M9. |

---

## Decisions needed before implementation starts

| # | Blocks |
| --- | --- |
| ~~U-1~~ | **RESOLVED** — run M1–M7; M8–M12 specified in `codex-campaign-tracking.md` |
| ~~DQ-1~~ | **RESOLVED** — no sixth mode; `World` → `Campaign` dashboard (D-10) |
| ~~DQ-2~~ | **RESOLVED** — the recap is the session's player projection; no new player surface (D-13) |
| U-2 — Graph node/edge scale target (assumed 200) | M7 sizing only |
| U-3, U-5, DQ-4 | carried into `codex-campaign-tracking.md` §6 |

**Nothing blocks M1. M1–M7 can run start to finish with only U-2 outstanding, and that affects
sizing in M7 alone.**

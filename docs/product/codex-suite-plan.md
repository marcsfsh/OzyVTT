# Codex worldbuilding suite — implementation plan

Date: 2026-07-28 · Status: Stage Three (plan half) — **awaiting owner approval.** No product code
changed.

Requirements: `codex-suite-spec.md`. Design: `codex-suite-design.md`. Evidence: `codex-suite-assessment.md`.

Milestone order follows owner decision **D-1** (Completion → Foundation → Integration → Campaign
tracking). Twelve milestones, each independently reviewable and independently verifiable.

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
- **Requirements.** CP-1, CP-2, CP-3, CP-4, CP-5, CP-6, CP-7, CD-1.
- **Excludes.** Combat bridge (M2). Any design-system refactor (M4). Any new record type.
- **Depends on.** Nothing. Server routes already exist and are tested.
- **Owns.** `codex/PlayerCodex.tsx`, `codex/AtlasView.tsx`, `codex/MarkerInspector.tsx`,
  `codex/JournalView.tsx`, `main.tsx` (GM-preview mount). Server: none expected.
- **Reuse.** `ViewerPreviewPanel` pattern for CP-2; `EntityPicker` for CP-7; existing `RevealSwitch`.
- **Risks.** CP-2 mounts a player-role component in GM context — **viewer-safety-adjacent**: the
  preview must use the *player* projection, not GM data styled as player data. CP-6 (root maps)
  touches tree-building logic that the breadcrumb and drill chips depend on.
- **Verification.** API-method sweep shows CP-1/3/4/5/7 methods now have callers (A-1). CD-1
  reproduction (compose → click Edit → draft survives) no longer fails. GM preview shows exactly the
  player payload — verified against a real player session. Narrow-viewport pass on every touched
  surface. `check`/`test`/`build` green.
- **Docs.** `current-state.md`; `known-bugs.md` (CD-1 resolved).
- **Escalate if.** CP-2 cannot be built without server changes to the player projection, or CP-6
  requires a migration.

### M2 · Combat bridge and replay integration

- **Goal.** Make the auto-logged battle findable, dated, and connected to its replay.
- **Requirements.** CP-8, CP-9, CD-8 (bridge tests).
- **Excludes.** Suite-wide search (M6). Session records (M9).
- **Depends on.** M1 (marker journal readback is the surface CP-9 extends).
- **Owns.** `apps/server/src/server.ts` (bridge call site), `codex-store.ts` (`appendCombatEntry`),
  a new GM-only route joining an entry to its archive summary. Client: `MarkerInspector`, `JournalView`.
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
- **Reuse.** Vitest 4, already used in four workspaces. No new runner.
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
- **Owns.** All 14 files in `apps/client/src/codex/`, `codex.css`.
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
  `MarkerInspector.tsx`, `AtlasView.tsx`; server `codex-store.ts` (CD-2 field pruning).
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
- **Owns.** `codex-store.ts` (FTS schema + migration), `codex-http.ts`, `codex/api.ts`,
  `CodexWorkspace.tsx`, `CommandPalette.tsx`, `PlayerCodex.tsx`.
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

### M7 · Return edges, World home, Graph

- **Goal.** Kill the star topology; make World and Graph tell the truth.
- **Requirements.** CI-3, CI-4, CI-5, CI-6, CI-7, CI-8, CI-9.
- **Excludes.** Campaign records (Phase 4).
- **Depends on.** M6.
- **Owns.** `codex-http.ts` (new page→markers reverse route; whole-graph backlinks feed),
  `codex-store.ts`, `codex-projections.ts`, `PageEditor.tsx` (Connections section),
  `WorldHome.tsx`, `RelationshipGraph.tsx`, `CodexWorkspace.tsx`.
- **Reuse.** `projectPlayerMarker` for the reverse lookup — it must project, not bypass.
- **Risks.** **The reverse marker lookup is a new player-reachable read** — it must go through
  `codex-projections.ts` or it leaks hidden pins. CI-8's backlink edges must respect the
  both-endpoints-revealed rule the typed-edge feed already enforces. CI-7 gives World data it never
  had — a new fetch path on the suite's most-loaded surface.
- **Verification.** All four return edges reachable from an open page (A-5). **Viewer-safety audit of
  both new feeds** (A-8). Graph no longer excludes orphans from the frame; wiki-link edges visually
  distinct. World recency excludes housekeeping (CI-9).
- **Docs.** `api-reference.md`; `decision-log.md`; `current-state.md`.
- **Escalate if.** The backlink graph feed cannot be made viewer-safe without a new projection concept.

---

## Phase 4 — Campaign tracking (the clean cut point — see spec §9)

**Everything from M8 onward is separable.** If the owner accepts the spec's §9 recommendation, the
programme can stop after M7 with a coherent, shipped result. Nothing in M1–M7 depends on M8–M12.

### M8 · Chronicle unification

- **Goal.** One timeline. Events become dated records; two lenses.
- **Requirements.** CT-11, CT-12.
- **Excludes.** Sessions, quests, deadlines, downtime.
- **Depends on.** M7.
- **Owns.** `codex-store.ts` (event dating + migration), `codex-projections.ts`, `JournalView.tsx`,
  `entities.ts`.
- **Risks.** K3 — the calendar reflow recomputes every dated record; events joining that set must
  reflow correctly. The unified row shape (design R2) must not regress entry rendering.
- **Verification.** An `event` page appears on the timeline in the right year. Lens toggle reorders
  without data change. Calendar edit reflows events and entries together, non-destructively.
- **Escalate if.** Two record types on one timeline requires changing the entry sort key contract.

### M9 · Sessions, prep, recap

- **Goal.** The session becomes a record; prep and recap get a home. *Owner-flagged as key.*
- **Requirements.** CT-1, CT-2, CT-3.
- **Excludes.** Quests, factions, downtime.
- **Depends on.** M8. **Requires DQ-1 approved** (Campaign mode).
- **Owns.** New `codex_sessions` table + migration; routes; projection; new `Campaign` mode
  components; `PlayerCodex.tsx` (recap surfacing).
- **Risks.** New mode changes top-level IA. Prep is GM-only and recap is player-facing **on the same
  record** — the projection must split them, exactly like `fields`/`gmFields`. Existing
  `sessionNumber` integers on entries must reconcile with real session records (K7).
- **Verification.** HTTP test: a player session gets recap and **never** prep (A-8). Existing
  entries' session numbers still group correctly. Mobile pass on the new mode.
- **Escalate if.** Reconciling legacy `sessionNumber` values needs owner input on ambiguous data.

### M10 · Quests

- **Requirements.** CT-4. **Depends on.** M9. **Excludes.** Graph representation (DQ-4 default: no).
- **Risks.** Objectives are ordered mutable state — the first Codex record with a list-of-things
  shape. The checklist component goes to `@vtt/ui` per §10.2, not inline.
- **Verification.** Two-layer projection test; objectives persist order; search finds quests (DQ-4).

### M11 · Deadlines and downtime

- **Requirements.** CT-5, CT-10. **Depends on.** M8, M9.
- **Risks.** **K3 is sharpest here.** Downtime advances the in-world calendar, and `setCalendar`
  transactionally recomputes every dated record. Downtime that moves the date can therefore reflow
  the entire chronicle. This needs an explicit transactional design and the heaviest test coverage
  in Phase 4.
- **Verification.** Advancing the date via downtime does not corrupt any dated record; deadlines fire
  when passed; raw dates remain source of truth.
- **Escalate if.** Date advancement cannot be made safe without changing the reflow contract.

### M12 · Standing, party marker, progression, reveal audit

- **Requirements.** CT-6, CT-7, CT-8, CT-9. **Depends on.** M9, M11.
- **Reuse.** `Meter` for standing; ordinary marker + flag for the party pin (DQ-3).
- **Note.** CT-9 (reveal audit) is deliberately last because it must enumerate *every* record type;
  building it earlier would mean revisiting it after each new type.
- **Verification.** Reveal audit lists every revealed record across all areas and can unreveal;
  standing history lands on the chronicle; party marker projects to players as an ordinary marker.

---

## Requirement coverage matrix

| Requirement | Milestone | Verified by |
| --- | --- | --- |
| CP-1…CP-7 | M1 | API sweep (A-1), player-session check |
| CP-8, CP-9 | M2 | HTTP viewer-safety test (A-8), timeline placement |
| CF-5 | M3 | CI runs client tests (A-4) |
| CF-1, CF-2, CF-6 | M4 | Primitive audit (A-2), per-mode states |
| CF-3, CF-4 | M5 | Tap-target audit (A-3), narrow viewport (A-9) |
| CD-1 | M1 | Reproduction no longer fails (A-7) |
| CD-4, CD-7 | M4 | A-7 |
| CD-2, CD-3, CD-5, CD-6 | M5 | HTTP test (CD-2), A-7 |
| CD-8 | M2, M3 | New test coverage |
| CI-1, CI-2 | M6 | A-6, player-search leak test |
| CI-3…CI-9 | M7 | A-5, viewer-safety audit |
| CT-11, CT-12 | M8 | Timeline placement, reflow safety |
| CT-1, CT-2, CT-3 | M9 | Prep/recap projection split |
| CT-4 | M10 | Two-layer test |
| CT-5, CT-10 | M11 | Reflow safety |
| CT-6…CT-9 | M12 | Audit completeness |

**All 44 requirement IDs are covered (A-11).**

---

## Programme-level risks

| # | Risk | Mitigation |
| --- | --- | --- |
| PR-1 | M1/M2 ship without automated protection (D-1). | M3 adds characterization tests retroactively; manual verification recorded per milestone. |
| PR-2 | Viewer safety is touched in M1, M2, M6, M7, M9, M10, M12. | Every one of those has an HTTP-boundary test as an acceptance criterion, plus `viewer-safety-auditor` review. Never inspection alone. |
| PR-3 | Five new record types (M9–M12) each need schema, migration, routes, projection, two UIs, mobile, tests. | This is the §9 scope concern. M8–M12 are a clean cut point. |
| PR-4 | K3 — calendar reflow interacts with M8 and M11. | Explicit transactional design in M11; raw dates stay source of truth. |
| PR-5 | M4 is a wide refactor. | Sequenced after the harness; behaviour-preserving swaps only. |
| PR-6 | Six tabs (DQ-1) may over-fill the mode bar. | Fallback: Campaign as a Journal sub-view. Decide before M9. |

---

## Decisions needed before implementation starts

| # | Blocks |
| --- | --- |
| **U-1** (spec §9) — full scope, or stop after M7? | Whether M8–M12 are planned in detail |
| **DQ-1** — Campaign as a sixth mode? | M9 |
| **DQ-2** — does the player get a Campaign surface? | M9 |
| U-2 — Graph node/edge scale target (assumed 200) | M7 sizing |
| U-3 — sessions reachable from the combat pillar? | M9 |

M1–M7 can begin without any of these answered.

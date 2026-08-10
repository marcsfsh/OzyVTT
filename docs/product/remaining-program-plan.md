# The remaining program — high-level plan

**Written 2026-08-10 against HEAD `d58d60c` on `claude/feature-implementations-intake-c5eyu1`.**
This is the **governing document** for everything left of the feature-implementations program. It
supersedes the *ordering and sizing* of [`area-2-plan.md`](area-2-plan.md); that document remains the
reference for each unit's original argument, and [`vocabulary-parity-audit.md`](vocabulary-parity-audit.md)
remains the per-row evidence.

**Read this before planning or implementing anything.** It exists because a five-round, nineteen-agent
discovery pass measured the remaining work against the code and found the previous plan substantially
wrong: **58 stale citations**, and a premise that no longer holds.

---

## 1. What discovery changed

### The premise inverted

Waves 0–2 were "the engine reads it, the SRD authors it, the editor has no control." Of the 22 units
left, **only two match that shape.**

| what is missing | count | units |
| --- | --- | --- |
| all four parts present | 2 | U25, U33 |
| the editor control only | **2** | U19, U38 |
| the engine reader | 8 | U18, U21, U24, U27, U28, U34, U36, U37 |
| the SRD content | 7 | U23, U26, U29, U30, U31, U32, U35 |
| the whole stack | 5 | U17, U20, U22, and variants |

Sizes re-measured: **9 S · 5 M · 8 L · 2 XL** — heavier than the previous estimate. Twelve units need
content *authored*, with rules judgement in it. Eight need an engine reader written.

### The API is far ahead of the editor

An HTTP caller can author **~80 capabilities that move the engine and that a GM using the homebrew
editor cannot reach** (114 asymmetries total; 108 api-only; 80 engine-read). The editor is a pure thin
client over the same validated endpoints, so this is not an API deficiency — **it is an editor deficit
that nothing was measuring.** The sharpest single case: monster saving throws have 330 SRD authors and
a live reader, and no control — a homebrew boss saves like a commoner.

### Parallelism is available, but the ceiling is hardware

**Only 3 of 22 units have a real logical dependency** (`U30←U23`, `U33←U26,U27,U28,U29,U31,U32`,
`U38←U34..U37`). The rest are independent; the constraint was only ever file contention, and worktrees
are nearly free here (`cp -al` of `node_modules`, 0.4 s, ~0 disk).

**The measured ceiling is 4 concurrent agents**, set by the box (4 cores; one full verification is
66 s wall / 3 min user). One trap: **never symlink `node_modules` into a worktree** — POSIX resolves
the symlink first, so `<wt>/node_modules/@vtt/domain` lands on the *original* tree and every
cross-package unit produces a green run that proves nothing about its own worktree. Hard-link instead.

**And a worse sibling of that trap, measured 2026-08-10: a worktree starts with NO `node_modules` at
all**, because npm workspaces hoist to the repo root and `git worktree add` copies none of it. The
failure is not an error — `npx vitest run <file> --root apps/server` in a fresh worktree collects
**0 test files, prints no failure and exits 0 in 211 ms**. An agent that runs its suite before
linking gets a green run over nothing and reports success. `cp -al <repo>/node_modules <wt>/node_modules`
costs **0.3 s** and ~0 real disk (226 MB apparent, all hard links), after which tests run for real.
**Every worktree agent links first and quotes a non-zero test-file count in its evidence** — a run
that does not say how many files it collected is not evidence.

---

## 2. Decisions taken (client rulings, 2026-08-10)

Recorded in full in `docs/ai-ledger/decision-log.md`. Summary, because every one of these changes what
an implementing agent does:

1. **Split the branch.** PR #55 (Waves 0–2, 17 units, green) merges to `main`; the remaining program
   branches fresh from an updated `main`. One PR per measured batch thereafter.
2. **Fix the half-shipped issues first.** Issue `4b` and decision D7 shipped their **server halves
   only** and are currently counted as done. Their client halves land before any new unit.
3. **Interleave the review layer.** Every batch closes with a hostile adversarial review, a QA-fix
   pass and a polish pass; Areas 2–4 are back-filled. **The review hunts two specific failure modes:
   built-but-unwired mechanisms, and vacuous tests** — not general code review.
4. **Author the missing SRD content as its own program**, ahead of the units that need it — including
   **the full SRD magic-item list** (there is currently *no* magic-item content in the repo at all).
5. **The harness rule stands unchanged.** The content program supplies a real carrier for every
   zero-author unit, so the both-paths test 2 ("not a lone record") stays satisfiable everywhere.
6. **`vex` and `slow` become real units** alongside U34–U37, with the same four-part contract. They
   are 15 of 38 weapons and they gate U38; no unit's contract covered them.
7. **Bump `schemaVersion` and offer a GM-triggered rebuild** — a per-sheet notice when a character's
   stamp is stale, plus a bulk GM action. Nothing rebuilds silently.
8. **Fix the flake, then dedupe CI.** Seed the dice in `apps/server/test/typed-damage-feed.test.ts`;
   give the workflow one concurrency group so a commit gets one verdict.
9. **Close every API bucket with real SRD authors**, and fix all three API defects (see §4).
10. **Build the parity guard first**, as an HTTP **round-trip**: post a body over the API, assert the
    editor can reproduce it. Every later unit lands under it.
11. **Split U33.** Keep the relabelling; drop the two destructive parts (deleting `roll-mode:
    concentration` silently drops stored published records from every catalog; removing
    `featureRiders.tags` breaks a player-readable contract with 44 authors).
12. **Give `mastery` an ETL home before anything else** — measured, `npm run build-bundle` silently
    drops the column from all 38 weapon rows, and that column is Wave 6's entire data basis.
13. **Re-scope four units in this plan**, not per-agent: U21 (126 authors → 1 that can exercise the
    reader), U31 (its reader already ships), U23+U30 (share one SRD record, cannot land apart),
    monster action composition (one unit → two).
14. **Rule once on the hand-authored overlay collision** before any unit authors onto cleric, fighter
    or wizard. For those three the bundle is both the ETL's input and its output, so the overlay is
    additive-only and a *second* edit to a shipped rider fails the build.
15. **Fold unowned live bugs into the unit whose area they touch** — the `armorClassFromEquipment`
    bug (U28), Wizard's Spell Mastery (content program), the effect-side `roll-mode` collector that
    ignores the rider's own `when` (U22/U29's agent, first).
16. **Structure by measured batch, not by theme.** Wave labels survive only as tags.
17. **The done bar is unchanged and non-negotiable:** an engine-outcome far-end proof, a non-vacuity
    probe at *both* control level and value level, and a 375px touch pass for anything with UI.
18. **One decision scheme.** `decision-log.md` is the single home; the register's unlogged D1–D7 are
    migrated into it.
19. **Regenerate `vocabulary-parity-audit.md` from the parity guard** rather than hand-editing it —
    it is a serialization point for 10 units and its derived counters go stale on every one.
20. **U19 adds pool ids to a projection**, with a viewer-safety audit. **U25 fixes the inventory-row
    `extraDamage` leak.** `properties` joins the prerequisite batch.

---

## 3. Order of work

**Batch 0 — prerequisites (serial, small).** Nothing else starts until these land.
- Give `weapons.v1.json`'s `mastery` column an ETL home; add `properties` to the weapon schema.
- Fix the `typed-damage-feed` flake; dedupe the CI workflow.
- `packages/schemas/tsconfig.json` — include `test` and fix the 7 typecheck errors a promised commit
  never delivered (`d811c46`'s own message says so).
- Rule on the hand-authored overlay collision; record it.

**Batch 1 — the honesty batch (concurrent).**
- Issue `4b`'s client half; decision D7's client half.
- The mobile back-fill over everything Wave 2 added.

**Batch 2 — the parity guard.** HTTP round-trip. Everything after this lands under it.

**Batch 3 — the content program.** The full SRD magic-item list, plus the carriers the zero-author
units need, plus Wizard's Spell Mastery. Longest pole; starts as early as batch 0 allows.

**Batches 4–7 — the units**, four concurrent agents in separate worktrees, grouped so no two share a
file, ordered by the three real dependencies. The three invariant-touching units (U22, U36, U37) get a
dedicated agent each and a viewer-safety audit before merge.

**Closers.** U38 (after all eight mastery slugs), U33 (after its seven).

---

## 4. The API defects (all three in scope)

Distinct from the ~80 capability gaps, and each is a correctness or documentation defect:

- **(a) API-authored content publishes as `source: "srd"`** — badged as official in the character
  builder. Only the client stamps `"homebrew"`; the server never does. The API reference carries
  **eight** false *"Always \"homebrew\" once stored"* descriptions plus one different-and-true sentence
  on the summary shape — so the summary and the record body disagree inside a single response, and a
  caller who trusts either produces the bug. *(Count corrected 2026-08-10 by PLANNER-API; an earlier
  draft said ten.)*
- **(b) A monster cannot be published from the published contract.** The publish gate hard-requires
  `extensions["open5e.srd-2024"].challengeRating` and `.type`; the contract documents that field as
  free-form and says *"the engine reads nothing from it"*. The string `open5e` appears **zero times**
  in the contract and zero times in the API reference.
- **(c) The closed SRD vocabularies are neither published nor validated** — 13 damage types, 15
  conditions, 17 weapon properties, 7 rarities. A wrong slug publishes clean and is silently inert,
  which the codebase itself calls the hardest homebrew failure to diagnose.

---

## 5. Serialization points (things concurrent agents must NOT both touch)

Measured. Each is a merge conflict or a silent data loss waiting to happen:

- **`docs/api-reference.md` and `docs/app-map.md`** — generated; **regeneration IS the merge
  resolution** and can only run after the merge, by the parent.
- **`packages/content-srd-5.2.1/bundles/weapons.v1.json`** — do not regenerate until batch 0 lands.
- **`docs/ai-ledger/current-state.md`** — parent-only. It is exactly at its enforced 150-line ceiling,
  pinned in two places, so it has zero headroom.
- **`apps/client/src/homebrew/vocabularies.test.ts`** — carries exact counts and an ordered list.
- **`apps/client/src/homebrew/vocabulary-parity.mirror.test.ts`**'s census array — an exact ordered set.
- **`apps/server/src/equipment-derivation.ts`'s `IMPLEMENTED_MASTERIES`** — one Set literal, seven units.
- **Full-suite verification** — at most 2 concurrent on this box.

---

## 6. The verification bar

Unchanged from what produced Waves 0–2, and it is why they hold up:

1. **A far-end proof.** The test ends at a rolled number, a spent counter, a refusal, a rendered
   string. *"The value survived derivation" is not a test.*
2. **Two non-vacuity probes.** Disable the **control** → named failure → restore. Keep the control and
   change the **value** → the far-end assertion fails → restore. Report exact counts and messages.
3. **A 375px touch pass** for anything with UI. Chromium is pre-installed at `/opt/pw-browsers`;
   **never run `playwright install`**.

Operational traps that have each cost an agent real time: `npm run build` emits compiled output under
the server workspace, and `npm run test` then collects those compiled tests too (185 → 204 files, ~11
spurious failures) — build only the client workspace and it never appears; never run two full suites
concurrently, because the server suite binds a live port; and read `docs/ai-ledger/known-bugs.md`
before calling a red test a regression.

---

## 7. Opening prompt for the next session

Copy-paste this to start the successor session. It assumes nothing from any prior conversation —
the repo is the memory.

> Read, in this order: `CLAUDE.md`, `docs/ai-ledger/current-state.md`,
> `docs/product/remaining-program-plan.md` (the governing plan — twenty client rulings, batch
> order, serialization points, the done bar), and the decision-log entry dated 2026-08-10.
>
> Context: PR #55 (Waves 0–2 of the feature-implementations program, 17 units) is merged to
> `main`. You are executing the remaining program on a fresh branch off `main`, one PR per
> measured batch. Four program plans are committed with runnable workflow scripts beside them:
> `docs/product/plan-content-program.md`, `plan-api-program.md`, `plan-engine-program.md`,
> `plan-mastery-program.md`, each with its workflow in `docs/product/workflows/`. The scripts
> were written by planners and never executed — re-verify each plan's premises against HEAD
> before running anything; every prior plan in this repo accumulated stale citations, and the
> plans themselves tell you what to re-measure.
>
> Execution order (client-ruled): batch 0 prerequisites first and serial (the weapons ETL home —
> **do not regenerate bundles before it lands** — `properties`, the CI flake + dedupe, the
> `packages/schemas` test typecheck, the overlay `clears` ruling), then the honesty batch
> (issue `4b` and register D7's client halves, the Wave-2 mobile back-fill), then the parity
> guard, then the content program (longest pole), then the unit batches at up to 4 concurrent
> agents in worktrees (hard-link `node_modules`, never symlink), then the closers. Every batch
> ends with a hostile adversarial review hunting built-but-unwired mechanisms and vacuous tests,
> a QA-fix pass, and a polish pass. The done bar per unit: an engine-outcome far-end proof,
> non-vacuity probes at both control and value level, a 375px touch pass for UI. Commit after
> each unit; push with `git push -u origin <branch>`; never `git add -A`.
>
> Trust the committed plans over your instincts, and the code over the plans.

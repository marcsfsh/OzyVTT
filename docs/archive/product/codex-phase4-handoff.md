> ## ⚠ ARCHIVED — 2026-08-01
>
> **What this is:** Pre-implementation handoff written at the end of the session that delivered M1-M8.
> **Current through:** 2026-07-29  (last commit that kept it true: `7e6480d`)
> **Superseded by:** nothing; M9-M12 shipped in `706eab5` (#52). Live rules: `docs/ai-context/codex.md`.
> **Read this for:** the state of play at the M8/M9 boundary and the constraints the next phase was handed.
> **Do not read this for:** what to pick up next. Its opening line — "**Read this first** if you are picking up the Codex campaign-tracking programme" — and its "Remaining: M9, M10, M11, M12" list are both spent. All four shipped. Start from `docs/ai-ledger/current-state.md`.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

# Phase 4 handoff — M9–M12 (campaign tracking)

**Read this first if you are picking up the Codex campaign-tracking programme.**
Written 2026-07-28 at the end of the session that delivered M1–M8 on branch
`claude/codex-suite-overhaul-nyeqg0`.

---

## 1. Where things stand

**Done and pushed:** M1–M7 (the Codex suite overhaul — 44 requirement IDs, Stage Six's three
adversarial QA reviews, Stage Seven remediation) and **M8** (chronicle unification, the first Phase 4
milestone).

**Remaining:** **M9, M10, M11, M12** — specified in full in `docs/product/codex-campaign-tracking.md`.

Nothing about the remaining work is undecided. The data model is settled with reasoning (§2), each
milestone states Goal · Requirements · Excludes · Depends on · Owns · Reuse · Risks · Verification ·
Docs · Escalate if (§3), the hard constraints are listed (§4), and **§8 records alternatives already
rejected — do not re-propose them without new evidence.**

Read, in this order: `codex-campaign-tracking.md` §1–§5 and §8 → the M9 entry in §3 → the M8 entry in
`docs/ai-ledger/current-state.md` (what you are building on) → `known-bugs.md`.

## 2. The one thing to know about M9

The spec records that **the owner called M9 the key part.** It is not the biggest milestone; it is the
one the programme is for. Two constraints on it are explicit owner decisions, not implementation
latitude:

- **Prep must have two routes** (DESIGN DECISION 3). A destination — the session's full view, where
  all editing happens — *and* a session-console drawer reachable from any Codex mode. **The drawer must
  not be the only way in.** The drawer is a *view*, never a second store.
- **Prep is GM-only and recap is player-facing on the same record.** The projection must split them
  exactly as `fields`/`gmFields` already does on a page. The spec demands an HTTP test that a player
  session receives the recap and never the prep.

§5 documents a known transition problem: legacy `session_number` integers on existing journal entries
must reconcile with real session records. The spec's own escalation clause says to ask the owner if
the data is ambiguous. Take that seriously rather than guessing.

## 3. How this programme has been run, and why it is worth continuing

The method that produced M1–M8, in order of how much it mattered:

1. **Validate every agent claim against the code before acting on it.** This is the single highest-value
   habit here. Over eight milestones, independent review found: two false claims I had written into
   `current-state.md`; a SQL viewer-safety predicate that **787 tests passed without exercising**,
   because a projection re-check masked it; and a Definition-of-Done miss where M7 shipped with no
   ledger entry at all.
2. **Prove every test non-vacuous** — break the production code, watch that specific test fail, restore,
   watch it pass. This has twice caught *tests* that were vacuous rather than implementations that were
   wrong, and once found a dead branch that depended on SQLite's row order.
3. **Measure; never reason about CSS and call it a measurement.** Three separate agent reports in this
   programme described real mechanisms that did not reproduce as stated. Non-reproduction is itself a
   finding worth recording with both numbers.
4. **Use a populated database.** A sparse one hid 14 sub-floor tap targets for six milestones — no
   folders meant folder rows were never rendered, so never measured. `scripts/tap-audit.mjs` exists so
   this stays checkable; see §5 below.
5. **Split agents by layer, not by feature.** Server / client / packages have genuinely disjoint file
   sets; features do not. Two agents on one feature both edit `codex/api.ts`.
6. **Agents should not commit.** Let them leave the tree dirty and integrate yourself — that is what
   keeps the integration point honest.

## 4. Standing rules that bind Phase 4

- **Viewer safety is the hardest invariant.** Every new record type is player-reachable by default once
  `PlayerCodex` reads it. Copy the predicate from the corresponding player list endpoint; do not write
  a fresh one. Remember CD-6: a revealed marker on a *secret map* must not be visible OR findable.
- **If you build more than one gate, test the lower layer directly.** An HTTP-boundary test proves the
  pipeline works, never that a given layer does.
- **The 44px floor** (`design-language.md` §4) applies to every new control, and you must state which of
  the two routes you took, in a comment at the rule.
- **`packages/api-contract`** must stay byte-identical to the served `openApiDocument`; regenerate
  `docs/api-reference.md` with `npm run docs:generate -w @vtt/api-contract`.
- **Do not import Phase-4 scope into an earlier milestone or vice versa.** M8–M12 each list Excludes.

## 5. Practical environment notes that cost time to rediscover

- **`npx tsc --noEmit -p apps/client` is VACUOUS** — the root client tsconfig is a solution file with
  `"files": []`; it reports nothing while real type errors exist. Use `-p apps/client/tsconfig.app.json`.
  `-p apps/server` is real.
- **vitest does not typecheck.** A fixture in this repo invented fields the real type lacked and only
  `tsc` caught it.
- **`scripts/tap-audit.mjs`** is the committed A-3 audit. It needs a browser and a dev server and is
  deliberately outside `npm test`; `playwright-core` is intentionally not a repo dependency:
  `PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs CHROMIUM_PATH=/path/to/chrome node scripts/tap-audit.mjs 375`.
  Its "taps stolen" column is a heuristic that over-reports; confirm real theft by tapping.
- **`bm25()` counts UNINDEXED columns as weight slots.** `bm25(t, 10.0, 1.0)` on a 4-column FTS table
  does not error — it weights the two unindexed columns and silently changes nothing.
- **YOU START WITH AN EMPTY DATABASE, AND THAT IS A TRAP.** `data/` is gitignored, so none of the QA
  fixtures from the M1–M8 sessions reach you. This matters more than it sounds: a sparse database
  renders no folders, no nested maps, no dense graph — so those controls are never measured, and that
  is precisely how **14 sub-floor tap targets hid for six milestones** while every audit reported zero.
  **Before you trust any UI measurement, populate the database through the app**: at least 2 folders
  with pages in them, 2+ maps with one nested and a few markers, 8+ pages so the graph clusters, and
  several journal entries with tags. Then measure. An audit against an empty campaign proves nothing.
- **`playwright-core` is not installed** — it is deliberately not a repo dependency. Install it
  out-of-tree (`npm i --no-save playwright-core`, or anywhere and point `PLAYWRIGHT_CORE` at its
  `index.mjs`). A Chromium binary ships at `/opt/pw-browsers/chromium-*/chrome-linux/chrome` in this
  environment; set `CHROMIUM_PATH` if yours differs.

## 6. Decisions waiting on the owner — do not resolve these yourself

Recorded with measurements in `known-bugs.md` and `decision-log.md`:

- **`--text-muted` fails AA** on nearly every surface in every theme across **207 usages**; fixing it
  collapses the three-tier text ramp. Design decision plus a full-app visual pass.
- **`--magenta-hi` / `--danger-hi`** share the exact convention inversion the `--cyan-hi` fix corrected
  (3.09:1 and 3.24:1 in light); their base tokens already pass, so the same fix would work.
- **The campaign's current in-world date reaches players** and always has (`/codex/calendar` is
  unprojected for any role). If a GM should be able to run the clock ahead of the party while prepping,
  that needs a server-side gate.
- **Entity-type switch silently drops the old type's field values** (recoverable via page History).
- **CI-2's tag filter is Pages-only**; a cross-type tag filter was put to the owner and not answered.

## 7. Known-good baseline at handoff

`npm run check`, `npm run test`, `npm run build` all exit 0 at **1206 tests** (web 89, server 834,
api-contract 36, content-srd 80, rules-5e 108, schemas 19, domain 18, pdf 12 + 1 skipped). Branch: `claude/codex-suite-overhaul-nyeqg0`, all work pushed.

# Codex campaign tracking — deferred programme (M8–M12)

Date: 2026-07-28 · Status: **approved and fully specified; deliberately not yet built.**
Owner decision (U-1): *run M1–M7 now; document M8–M12 thoroughly so work can begin afterward.*

> **This document is written to be self-sufficient.** A future session should be able to implement
> M8–M12 from this file plus the four referenced artifacts, with no memory of the conversation that
> produced it. Everything decided is recorded here, including the reasoning behind reversals, so no
> decision has to be re-litigated.

**Required reading before starting any milestone here:**

| File | What it gives you |
| --- | --- |
| `docs/product/codex-suite-assessment.md` | Current-state evidence; the three root causes; eight confirmed defects |
| `docs/product/codex-suite-spec.md` | The 44 approved requirement IDs and all owner decisions D-1…D-13 |
| `docs/product/codex-suite-design.md` | Experience design; DESIGN DECISIONs 1–3; consistency rules R1–R9 |
| `docs/product/codex-suite-plan.md` | M1–M7 (the prerequisite programme) |

**Prerequisite:** M1–M7 must be complete. M8 depends technically on M4 (adopted `@vtt/ui`
primitives); everything here assumes the client test harness from M3 exists.

---

## 1. What this programme is

Campaign tracking turns the Codex from a place where the world is *written* into the place where the
campaign is *run*: sessions, prep, quests, deadlines, faction standing, party position, downtime.

**The architecture was deliberately minimised.** An earlier draft proposed a sixth "Campaign" tab and
five new tables. That was rejected. The approved shape:

- **No sixth mode.** `World` is **renamed `Campaign`** and becomes the dashboard (D-10).
- **Three new tables**, not five (D-11).
- **Four new timeline kinds** on the existing `codex_journal` table.
- **Prep and recap are the two layers of one session record** (D-13) — so the recap *is* the player
  projection, and no new player-facing surface exists at all.

---

## 2. The data model — decided, with reasoning

**Governing principle (D-11).** A **table** is for something with independent identity and lifecycle:
you create it, name it, browse it, and it outlives any single moment. A **timeline record** is for
something that is fundamentally *a thing that happened, or will happen, at a time*.

The owner delegated this decision with one binding constraint: **future growth must not be hampered.**

### 2.1 New tables

#### `codex_sessions`

| Column | Notes |
| --- | --- |
| `id` | id |
| `session_number` | integer; reconciles with the legacy `codex_journal.session_number` (see §5) |
| `real_date` | real-world date the session was played |
| `attendees_json` | array; free text or actor ids — free text is sufficient |
| `prep_body` | **GM layer.** Never projected to players. |
| `recap_body` | **Player layer.** Projected when revealed. |
| `revealed` | whether the recap is published |
| `status` | `planned` / `played` |
| `rev`, `created_at`, `updated_at` | follow the `codex_pages` pattern |

**Why a table:** prep exists days before the session and is edited over time — independent lifecycle.
**Why prep is not its own table (D-13):** it is the session's GM layer, exactly like `gmBody` on a
page. This buys the whole two-layer projection mechanism for free.

#### `codex_quests`

| Column | Notes |
| --- | --- |
| `id`, `title` | |
| `status` | `active` / `completed` / `failed` — **must be queryable** for the dashboard |
| `player_body` / `gm_body` | two-layer, as everywhere |
| `objectives_json` | ordered array of `{ text, done }` |
| `entity_ids_json` | linked entities, via the existing `EntityPicker` |
| `revealed`, `rev`, timestamps | |

**Why a table — this reverses an earlier lead proposal (D-12).** The original brainstorm suggested
quests be a 9th entity type with a new `checklist` field kind. Under the growth constraint that is
wrong: entity `fields` are a flat `Record<string,string>`, so objectives would be JSON stuffed into a
string, and status could not be queried for the dashboard. Quests also plausibly grow — assignees,
calendar-linked due dates, sub-quests, rewards. Once storage for a checklist field kind is needed
anyway, a table costs little more and leaves headroom. **Do not revert this without re-reading D-12.**

#### `codex_standing`

| Column | Notes |
| --- | --- |
| `id`, `faction_page_id` | FK to a `codex_pages` row with `entity_type = 'faction'` |
| `value` | numeric; rendered with the existing `@vtt/ui` `Meter` |
| `revealed` | players may or may not know where they stand |
| `updated_at` | |

History is **not** stored here — each change writes a timeline record (`kind='standing'`).

### 2.2 New timeline kinds — no new tables

`codex_journal` already carries a `kind` discriminator (it distinguishes combat entries today, see
`codex-store.ts` `appendCombatEntry`). Add these kinds plus **one additive `payload_json` column**,
following the established `page_ids_json` / `scene_ids_json` precedent from migration v8:

| Kind | `payload_json` contents |
| --- | --- |
| `deadline` | `{ what, targetDate, fired }` |
| `downtime` | `{ who, activity, timeCost, outcome }` |
| `milestone` | `{ level, reason }` |
| `standing` | `{ factionPageId, delta, reason }` |

Each inherits — for free — the two-layer body, `revealed`, in-world dating, calendar reflow, pinning,
and (once CI-1 from M6 has landed) search.

---

## 3. Milestones

Each states **Goal · Requirements · Excludes · Depends on · Owns · Reuse · Risks · Verification ·
Docs · Escalate if**, matching the format in `codex-suite-plan.md`.

### M8 · Chronicle unification

- **Goal.** One timeline. Dated `event` pages join it; two lenses.
- **Requirements.** CT-11, CT-12.
- **Excludes.** Sessions, quests, deadlines, downtime, standing.
- **Depends on.** M4 technically (adopted primitives). M7 is ordering only.
- **Owns.** `codex-store.ts` (event dating + migration), `codex-projections.ts`, `codex-http.ts`,
  **`packages/api-contract`**, `entities.ts`, `JournalView.tsx`.
- **Reuse.** The existing `calendarInstant` / raw-date contract: **raw date is the source of truth,
  the instant is a derived sort key**.
- **Risks.** **K3** — `setCalendar` transactionally recomputes every dated record; events joining
  that set must reflow correctly and non-destructively. The unified row shape (R2) must not regress
  existing entry rendering.
- **Verification.** An `event` page lands in the right in-world year. Lens toggle reorders without
  mutating data. A calendar edit reflows events and entries together. **HTTP-boundary test (A-8): a
  player timeline request returns no unrevealed event and no GM-only event content** — `PlayerCodex`
  reads the timeline, so every new kind is player-reachable by default.
- **Docs.** `decision-log.md`, `current-state.md`, `api-reference.md`.
- **Escalate if.** Two record types on one timeline would require changing the entry sort-key contract.

### M9 · Sessions, prep, recap — *the owner called this the key part*

- **Goal.** The session becomes a record; prep and recap get a home.
- **Requirements.** CT-1, CT-2, CT-3, **CP-9 (session half — deferred here from M2)**.
- **Excludes.** Quests, deadlines, downtime, standing.
- **Depends on.** M8.
- **Owns.** `codex-store.ts` (`codex_sessions` + migration), `codex-http.ts`,
  **`packages/api-contract`**, `codex-projections.ts`, `codex/api.ts`, the renamed `Campaign`
  dashboard components, the session full-view, the session-console drawer, `PlayerCodex.tsx`.
- **Reuse.** The `gmBody`/`playerBody` split — prep and recap are exactly that shape.
- **Prep must have two routes (DESIGN DECISION 3, owner was explicit).**
  1. **Destination** — the session's full view, from the dashboard's "Next session" card and from
     Journal's by-session lens. All editing happens here.
  2. **Session console** — a collapsible drawer toggled from the mode bar, showing the current
     session's prep from **any** Codex mode; open/closed state persists. It is a *view*, never a
     second store. **The drawer must not be the only way in.**
- **Risks.** Prep is GM-only and recap is player-facing **on the same record** — the projection must
  split them exactly as `fields`/`gmFields` does. Legacy `session_number` integers on existing
  journal entries must reconcile with real session records (§5).
- **Verification.** **HTTP test: a player session receives the recap and never the prep** (A-8).
  Existing entries still group correctly by session. Console drawer works at a narrow viewport.
  Combat entries are listed for their session (CP-9 session half).
- **Docs.** `api-reference.md`, `decision-log.md`, `current-state.md`.
- **Escalate if.** Reconciling legacy `session_number` values needs owner input on ambiguous data.

### M10 · Quests

- **Goal.** Track what is still open.
- **Requirements.** CT-4.
- **Excludes.** Graph representation (see §6, DQ-4 default: no).
- **Depends on.** M9.
- **Owns.** `codex-store.ts` (`codex_quests` + migration), `codex-http.ts`,
  **`packages/api-contract`**, `codex-projections.ts`, `codex/api.ts`, dashboard + quest full-view;
  **`@vtt/ui`** + `/styleguide` for the objective checklist.
- **Reuse.** `EntityPicker` for linked entities; `RevealSwitch`; `GmOnlyTag`.
- **Risks.** Objectives are ordered mutable state — the first Codex record with a list-of-things
  shape. **The checklist component goes to `@vtt/ui`, not inline** (R9, design-language §10.2).
  Violating this while fixing exactly this problem would be self-defeating.
- **Verification.** Two-layer projection test (A-8); objective order persists; quests appear in
  suite-wide search; narrow-viewport pass.
- **Docs.** `api-reference.md`, `current-state.md`, `decision-log.md` (record D-12's reasoning).
- **Escalate if.** Objectives need richer state than `{text, done}` — that is unapproved scope.

### M11 · Deadlines and downtime

- **Goal.** Things that happen whether or not the party acts; time that passes between sessions.
- **Requirements.** CT-5, CT-10.
- **Excludes.** Manual segment clocks (explicitly rejected — D-9).
- **Depends on.** M8 (the chronicle). M9 is ordering only.
- **Owns.** `codex-store.ts` (`payload_json` column + migration, two new kinds), `codex-http.ts`,
  **`packages/api-contract`**, `codex-projections.ts`, `JournalView.tsx`, dashboard cards.
- **Risks.** **K3 is sharpest here, and this is the highest-risk milestone in the programme.**
  Downtime advances the in-world calendar, and `setCalendar` transactionally recomputes every dated
  record — so downtime that moves the date can reflow the entire chronicle. This needs an explicit
  transactional design and the heaviest test coverage in the programme. Raw dates remain the source
  of truth; instants are always derived.
- **Verification.** Advancing the date via downtime corrupts no dated record. Deadlines fire when the
  campaign date passes them. **HTTP test (A-8): deadlines and downtime are GM-only until explicitly
  revealed and never appear in a player timeline request.**
- **Docs.** `decision-log.md` (the date-advancement contract), `current-state.md`.
- **Escalate if.** Date advancement cannot be made safe without changing the reflow contract.

### M12 · Standing, party marker, progression, reveal audit

- **Goal.** Close out campaign state; give the GM one view of what players can see.
- **Requirements.** CT-6, CT-7, CT-8, CT-9.
- **Depends on.** M9, M11.
- **Owns.** `codex-store.ts` (`codex_standing` + migration, `milestone`/`standing` kinds,
  party-marker flag), `codex-http.ts`, **`packages/api-contract`**, `codex-projections.ts`,
  `AtlasView.tsx`, `MarkerInspector.tsx`, dashboard cards, mode-bar ops cluster (CT-9 entry point).
- **Reuse.** `Meter` for standing (already in `@vtt/ui` — do not build one). An **ordinary marker
  with a flag** for the party pin, not a special marker type.
- **Note on ordering.** CT-9 (reveal audit) is deliberately last: it must enumerate *every* record
  type, so building it earlier means revisiting it after each new one.
- **Risks.** CT-9 is a **read-only aggregation of reveal state** and must not become a second source
  of truth. The party marker is player-visible and must project as an ordinary marker.
- **Verification.** The reveal audit lists every revealed record across all areas and can unreveal
  from there. Standing changes land on the chronicle. **HTTP test: the party marker leaks no GM-only
  fields** (A-8).
- **Docs.** `api-reference.md`, `current-state.md`, `known-bugs.md`.
- **Escalate if.** CT-9 cannot enumerate a record type without a server aggregation route that
  duplicates projection logic.

---

## 4. Hard constraints (do not violate)

| # | Constraint |
| --- | --- |
| **K1** | **Viewer safety is absolute.** Every new record type and every player-facing read goes through `codex-projections.ts`. Never a hand-rolled filter at the router. |
| **K3** | Downtime advancing the calendar interacts with `setCalendar`'s reflow of every dated record. Raw dates are the source of truth; instants are derived and recomputed. |
| **K4** | The Codex stays **off the `GameState` broadcast**. Writes emit the content-free `codex:changed` ping; clients refetch. |
| **K5** | **Single-writer** (D-4). Last-writer-wins is explicit policy; do not add optimistic concurrency to new record types. |
| **K7** | Existing user content must survive every migration. Additive migrations with backfill, following the established v1–v9 pattern. |
| **API** | `.claude/rules/api-contract.md` is path-scoped to `codex-http.ts` and requires the served `openApiDocument` to stay **byte-identical** to `packages/api-contract`. **Every milestone here adds routes** — the contract package is in every Owns list for that reason. Endpoint *grouping* is additionally duplicated in `reference.ts` and the in-app `ApiReference.tsx`; a new group is invisible in the docs until added to both. |
| **P2** | Two-layer by default. Secret by default. |
| **P6** | Mobile parity — `--tap-min: 44px`, narrow viewport verified. CLAUDE.md rule 5. |
| **R9** | No new component inline in the Codex. It goes to `@vtt/ui` with `nh-` CSS and into `/styleguide` (design-language §10.2). |

---

## 5. Known transition problem — legacy `session_number`

`codex_journal.session_number` is today a bare `number | null` on each entry, with no session record
behind it. When `codex_sessions` arrives in M9, those integers must reconcile with real records.

**Recommended approach** (not yet owner-approved — confirm before implementing): backfill a
`codex_sessions` row for each distinct non-null `session_number` found in `codex_journal`, with
`status='played'`, empty prep/recap, and no real date; then link entries by number. This preserves
every existing entry's grouping and loses nothing.

**Escalate** if the data contains ambiguities (e.g. the same number used across clearly different
sittings).

---

## 6. Open questions carried forward

| # | Question | Default if unanswered | Blocks |
| --- | --- | --- | --- |
| U-3 | Should sessions be reachable from the combat pillar (e.g. start a session from the table), or Codex-only? | Codex-only | M9 |
| U-5 | Does the reveal audit cover only Codex records, or also table-side exposure (tokens, maps on the shared viewer)? | Codex records only | M12 |
| DQ-4 | Do quests appear in the Graph alongside entities? | Search yes, Graph no | M10 |
| — | §5 backfill approach for legacy `session_number` | as recommended above | M9 |

---

## 7. Requirement coverage

| Requirement | Milestone |
| --- | --- |
| CT-11, CT-12 | M8 |
| CT-1, CT-2, CT-3 + CP-9 (session half) | M9 |
| CT-4 | M10 |
| CT-5, CT-10 | M11 |
| CT-6, CT-7, CT-8, CT-9 | M12 |

All 12 campaign-tracking requirements plus the deferred half of CP-9 are covered.

---

## 8. Rejected alternatives — do not re-propose without new evidence

| Rejected | Why |
| --- | --- |
| A sixth "Campaign" tab | Creates a second surface that knows about time, competing with the Journal unification (P3). Campaign material is state on existing surfaces, not a place. (D-10) |
| Folding campaign material into Journal | Re-creates the two-things-in-one-surface problem CT-12 exists to fix. |
| Quests as a 9th entity type | Flat string fields cannot hold ordered tickable objectives; status must be queryable; quests are expected to grow. (D-12) |
| Prep as its own table | It is the session's GM layer; making it separate discards the two-layer projection mechanism. (D-13) |
| A separate player Campaign surface | The recap **is** the player projection of the session record. (D-13, DQ-2) |
| Manual segment clocks alongside calendar deadlines | Two similar trackers — the exact "two ways to say one thing" problem this overhaul exists to fix. (D-9) |
| Party inventory / loot / funds | Owner declined; character sheets own gear. (D-7) |
| XP arithmetic | Owner chose milestone/level history only. (D-8) |
| Sharing the player and GM reader implementations | Owner declined. Accepted consequence: GM-side reader improvements must be hand-ported. (D-2) |

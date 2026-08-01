> ## ⚠ ARCHIVED — 2026-08-01
>
> **What this is:** Stage Two product specification for the Codex worldbuilding suite.
> **Current through:** 2026-07-28  (last commit that kept it true: `066f47a`)
> **Superseded by:** nothing; the spec was approved and shipped in `706eab5` (#52). Live rules: `docs/ai-context/codex.md`.
> **Read this for:** the requirements as agreed, and what was deliberately excluded.
> **Do not read this for:** current status. Its banner says "awaiting owner approval. No product code has been changed" — both clauses stopped being true when the overhaul shipped.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

# Codex worldbuilding suite — product specification

Date: 2026-07-28 · Baseline: `3144e58` (PR #50) · Status: Stage Two output of the Codex suite
overhaul — **awaiting owner approval.** No product code has been changed.

Companion to **`codex-suite-assessment.md`** (Stage One current-state evidence). That document is the
evidence base; this one is the approved intent. Read the assessment first for *why*; read this for
*what*.

**Provenance.** Every requirement below traces to a decision the owner made in Stage Two discovery
(24 answers across five question rounds) or to a defect confirmed by direct code read in Stage One.
Nothing here is inferred scope. Where the owner chose against the lead's recommendation, that is
recorded — the owner's choice governs.

---

## 1. Confirmed product vision

The Codex is the worldbuilding half of a two-pillar product (the other is the combat-first table),
for **one trusted GM and a small home group** on a LAN. Stage Two materially extended it:

> The Codex is not only a place to *write* a world. It is where the campaign is **tracked** — sessions
> run, prep done, quests open, deadlines approaching, factions turning, the party moving — with a
> two-layer boundary so the GM sees everything and players see only what has been shown to them.

The suite's spine is **the timeline**: a single in-world chronology onto which journal entries, events,
sessions, deadlines and downtime all resolve.

---

## 2. Problems this addresses (from the assessment)

Three evidenced root causes, in the assessment's terms:

1. **A parallel component vocabulary** — Codex imports 12 shared `@vtt/ui` primitives vs 24 in the
   comparable Homebrew surface, hand-rolling `SaveState`, `Chip`, `Menu`, `TagInput`, `Skeleton` and
   `Alert` locally. This is why it feels unlike the rest of the app.
2. **Built plumbing, missing entry points** — five capabilities fully wired server-to-client with zero
   UI callers, plus a write-only combat bridge. This is what "incomplete" actually means here.
3. **A shell but not a system** — navigation is a star into Pages with no return edges; tags, search,
   folders and revisions are pages-only. This is what "insufficiently integrated" means.

Plus eight confirmed defects (assessment §7) and a verification vacuum: `apps/client` and
`packages/ui` have **no test script**, and the repo has **no browser-test harness**.

---

## 3. Cross-suite principles (govern every requirement)

| # | Principle |
| --- | --- |
| P1 | **Adopt, don't re-invent.** Reach for a `@vtt/ui` primitive before writing a local equivalent. New local components need a stated reason. |
| P2 | **Two-layer by default.** Every new record type has a player-facing and a GM-only layer, and every player-facing read passes through `codex-projections.ts`. Secret by default. |
| P3 | **One timeline.** Anything dated resolves onto the same in-world chronology. No second timeline. |
| P4 | **One vocabulary.** One word per concept, reusing the established `RevealSwitch` / `GmOnlyTag` / "Relationships" language. |
| P5 | **Server authority.** The server owns validation, authorization and projection. The Codex stays off the `GameState` broadcast, using the `codex:changed` refetch pattern. |
| P6 | **Mobile parity.** Every new surface meets `--tap-min: 44px` and works at a narrow viewport. Non-negotiable (CLAUDE.md rule 5). |
| P7 | **Every area is a first-class citizen.** A capability that exists for Pages should have a stated reason not to exist elsewhere. |

---

## 4. Approved requirements

IDs are stable and used for traceability through planning, implementation and QA.

### 4.1 Completion — finish what is already built (`CP`)

*Owner-chosen first milestone. Mostly UI wiring onto proven, already-tested server paths.*

| ID | Requirement | Evidence |
| --- | --- | --- |
| CP-1 | Wire player search into the player Codex. | Route is dual-role and viewer-safe; `playerCodexApi.search` has 0 callers |
| CP-2 | Add GM preview of the player Codex. **Correction (post-review):** this cannot follow `ViewerPreviewPanel` as a client mount — that panel mints a *separate principal* and iframes `/viewer.html`, and `roleOf()` checks `authorizeGm` first, so a GM token yields GM projections. Requires server work. | `main.tsx:310`; `ViewerPreviewPanel.tsx:24-46`; `codex-http.ts:146-151` |
| CP-3 | Surface a marker's journal entries in `MarkerInspector` via `journalApi.forMarker`. | 0 callers today |
| CP-4 | Add UI to rename/retype a map (`atlasApi.updateMap`). | Name/kind frozen at creation, permanently |
| CP-5 | Add UI to re-parent a map (`atlasApi.setMapParent`). | 0 callers |
| CP-6 | Allow creating additional **root** maps (map forest). | `AtlasView.tsx:106,123`; model supports it and is tested |
| CP-7 | Surface the marker→actor link in `MarkerInspector`. | Fully wired, 0 client references |
| CP-8 | Auto-**date** combat journal entries to the calendar's current in-world date; keep them **GM-only**. | `codex-store.ts:1134` hardcodes nulls |
| CP-9 | Link a combat journal entry to its archived replay, and surface past battles for a location (M2) and for a session (M9 — sessions do not exist earlier). | `source_encounter_id` stored, read by nothing; `codex-store.ts:1134` hardcodes `sessionNumber: null` |

### 4.2 Foundation — coherence and verification (`CF`)

*Owner-chosen second milestone.*

| ID | Requirement |
| --- | --- |
| CF-1 | Replace hand-rolled equivalents with `@vtt/ui` primitives — `SaveState`, `Chip`, `Menu`/`MenuItem`, `TagInput`, `Skeleton`, `Alert`/`useToast` — each proven behaviour-preserving. |
| CF-2 | Every Codex surface has a loading state and a visible error state, not just the Pages rail. |
| CF-3 | Every interactive Codex control meets `--tap-min: 44px`; `.tap-target` usage goes from zero to complete. |
| CF-4 | Narrow-viewport layout for World, Journal and Graph (today only Pages/Lore adapt). |
| CF-5 | **Establish a client test harness** for `apps/client`, with Codex coverage of two-layer secrecy, the save/conflict path, and cross-mode navigation. |
| CF-6 | Codex breakpoints align to the documented ladder in `design-language.md`. |

### 4.3 Defects (`CD`)

| ID | Defect | Severity |
| --- | --- | --- |
| CD-1 | Journal draft data loss — composing a new entry then clicking Edit destroys it *and* its sessionStorage backup. | **High** |
| CD-2 | Server does not prune entity fields on type switch, so stale foreign keys ship to players and the GM cannot see or remove them. Enforce server-side. | Medium |
| CD-3 | Autosave 409 says "reload" but the next keystroke silently wins. **Resolved as documentation + copy fix** — see D-4. | Medium |
| CD-4 | Editor "Link" button emits markdown the renderer cannot render. Either render standard links or remove the button. | Low |
| CD-5 | `PageTimeline` derives "GM only" from empty player text rather than `revealedToPlayers`, so the normal case shows no indicator. | Medium |
| CD-6 | A shown marker on a hidden map is silently invisible to players with no GM warning. | Medium |
| CD-7 | Loading/error states — folded into CF-2. | Medium |
| CD-8 | Migration v8/v9 and the combat bridge have no test coverage. | Medium |

### 4.4 Integration (`CI`)

| ID | Requirement |
| --- | --- |
| CI-1 | **Suite-wide search** across pages, journal entries, markers and maps, from the rail and the command palette. |
| CI-2 | **Tags on all record types** (maps, markers, journal entries), not pages only. |
| CI-3 | Return edge: page → its journal entries (openable, not plain text). |
| CI-4 | Return edge: page → its markers on the Atlas (**needs a new reverse-lookup route**). |
| CI-5 | Return edge: page → its node in the Graph, focused on that entity. |
| CI-6 | Return edge: journal entry → its marker and its combat replay. |
| CI-7 | **`World` is renamed `Campaign` and becomes the dashboard** — entities by type, recent journal activity, atlas presence, the current in-world date, **plus campaign state** (next session, open quests, approaching deadlines, party position, faction standing). Both GM and players land here. |
| CI-8 | **Graph draws typed relationships + wiki-links**, visually distinguished; orphans are no longer excluded from the auto-fit frame. Needs a whole-graph backlinks endpoint. |
| CI-9 | Fix World's "Recently updated" so relationship edits count and housekeeping (reveal-toggle, folder move) does not. |

### 4.5 Campaign tracking (`CT`) — new capability

| ID | Requirement |
| --- | --- |
| CT-1 | **Sessions are first-class records** (`codex_sessions`): real-world date, number, attendees, status, with automatic links to the journal entries and encounters that occurred in them. |
| CT-2 | **Full GM prep surface per session** — planned scenes, NPCs to have ready, notes to hand. Prep is the session record's **GM layer**, not a separate record. Reachable two ways: the session's full view, **and** a session-console drawer available from any Codex mode. *Owner: "GM facing session notes and session prep are a key part."* |
| CT-3 | **Curated player-facing recap** per session — the session record's **player layer**. Headlines the player's `Campaign` dashboard, with a "new since you last looked" indicator on the Codex button. No separate player surface. |
| CT-4 | **Quests as first-class records**: status (active/completed/failed), ordered tickable objectives, links to involved entities. |
| CT-5 | **Calendar-tied deadlines** — a **timeline record** (`kind='deadline'`) that surfaces as it approaches and fires when the campaign date passes it. |
| CT-6 | **Party standing per faction** (`codex_standing`), adjustable, with history recorded as timeline records (`kind='standing'`). |
| CT-7 | **Party location marker** on the Atlas that the GM moves as the party travels. |
| CT-8 | **Milestone / level history** as timeline records (`kind='milestone'`). No XP arithmetic. |
| CT-9 | **Reveal audit view** — one surface listing everything currently revealed across all five areas, with unreveal from there. |
| CT-10 | **Full downtime activity tracking** — timeline records (`kind='downtime'`) with structured payload (who, activity, time cost, outcome), advancing the in-world calendar. |
| CT-11 | **`event` pages become dated timeline records**, appearing on the Journal timeline alongside entries. |
| CT-12 | **Journal is one timeline with two lenses** — toggle between "by session" and "by in-world date". |

---

## 5. Constraints (hard)

| # | Constraint |
| --- | --- |
| K1 | **Viewer safety is absolute.** Every new record type and every new player-facing read passes through `codex-projections.ts`. |
| K2 | **Replay-in-Codex is a viewer-safety hazard.** Encounter archives contain GM-only narration and are documented as unreachable by players or the shared viewer. CP-9 must expose replays **GM-only**, or project them through an audited strip. This must be explicitly verified. |
| K3 | **Downtime advancing the calendar interacts with existing reflow logic.** `setCalendar` transactionally recomputes every dated entry; CT-10 must not corrupt dated records. Raw dates remain the source of truth; instants are derived. |
| K4 | The Codex stays **off the `GameState` broadcast**. |
| K5 | **Single-writer.** Last-writer-wins is now explicit policy; no optimistic concurrency spreads to maps/markers/journal. |
| K6 | Node ≥24; CI runs `npm ci` → `test` → `check` → `build`. |
| K7 | Existing user content must survive every migration. Additive migrations with backfill, following the established v1–v9 pattern. |

---

## 6. Decisions and rationale

| # | Decision | Rationale |
| --- | --- | --- |
| D-1 | Milestone order is **Completion → Foundation → Integration → Campaign tracking**. | Owner's explicit choice, against the lead's recommendation of Foundation first. **Recorded risk:** completion work lands before the CF-5 harness exists to protect it, so its regression protection is manual until Foundation completes. |
| D-2 | The **player reader stays a separate implementation** from the GM reader. | Owner declined sharing it. **Accepted consequence:** GM-side reader improvements must be hand-ported, and drift between the two will recur. |
| D-3 | Players keep the word **"Lore"** where the GM says "Pages". | Owner declined renaming. Mild tension with P4 (one vocabulary); accepted as owner preference. |
| D-4 | The Codex is **single-writer**; last-writer-wins is documented, and the misleading "reload" copy is corrected. | Owner's decision. Converts CD-3 from a concurrency defect into a copy/documentation fix. |
| D-5 | Combat entries are **auto-dated but stay GM-only**. | Preserves secret-by-default; the GM reveals when ready. |
| D-6 | Quests are **first-class records**, not a 9th entity type. | Objectives need tickable state; entity fields are flat strings. |
| D-7 | **Party inventory is out of scope.** | Owner declined; character sheets own gear, avoiding two systems disagreeing. |
| D-8 | Progression is **milestone/level history only**, no XP. | Keeps the character-sheet boundary clean. |
| D-9 | Deadlines are **calendar-tied only**; no manual segment clocks. | Avoids two similar trackers — the exact "two ways to say one thing" problem this overhaul exists to fix. |
| D-10 | **No sixth mode.** `World` is renamed **`Campaign`** and absorbs the dashboard role. | Owner brainstorm. Campaign material is state belonging to existing surfaces, not a place. A sixth tab would create a rival timeline surface competing with the Journal unification (P3). |
| D-11 | **Three new tables** (`codex_sessions`, `codex_quests`, `codex_standing`); deadlines, downtime, milestones and standing-changes are **timeline records** on `codex_journal` via its existing `kind` discriminator plus an additive `payload_json`. | Owner delegated with the constraint *"future growth must not be hampered."* Principle: a table is for independent identity and lifecycle; a timeline record is for *a thing that happens at a time*. |
| D-12 | **Quests get a table** — reversing the lead's own "quest as a 9th entity type" proposal. | The growth constraint makes the entity route wrong: entity `fields` are a flat `Record<string,string>`, so objectives would be JSON-in-a-string and status would not be queryable for the dashboard. Quests plausibly grow (assignees, due dates, sub-quests, rewards). |
| D-13 | **Prep and recap are the two layers of one session record**, not separate records. The recap **is** the player projection. | Falls out of the existing two-layer model (`gmBody`/`playerBody`), so no new concept is needed — and it makes DQ-2 answer itself: no new player surface exists. |

---

## 7. Non-goals and deferred

- Party inventory / loot / funds (D-7).
- XP arithmetic (D-8).
- Manual segment clocks (D-9).
- Sharing the player and GM reader implementations (D-2).
- Multi-writer concurrency for maps/markers/journal (D-4).
- Revisions/history for maps, markers and journal entries — owner selected search and tags only.
- Folders beyond Pages — owner declined.
- Inter-faction relations as a distinct system — typed relationships already express this.
- Auto-drafted recaps — owner chose curated.
- Graph node types for markers and journal entries — CI-8 covers wiki-links only.
- Integration-API scopes for the Codex; orphan-asset GC; revision pruning (pre-existing accepted debt).

---

## 8. Acceptance criteria

Countable wherever possible, so "done" is demonstrable rather than asserted.

| # | Criterion |
| --- | --- |
| A-1 | **Zero unreachable client API methods** — the `api.ts` call-site sweep returns no method with 0 callers (or the method is deliberately removed). |
| A-2 | **Design-system adoption**: no hand-rolled equivalent remains where a `@vtt/ui` primitive exists; the Codex primitive count is comparable to Homebrew's. |
| A-3 | **`.tap-target` / `--tap-min` coverage is complete** across Codex interactive controls — verified at **source level** (every interactive control declares a tap route) plus a manual narrow-viewport pass. *Restated after adversarial review:* `design-language.md` §4's `elementFromPoint` measurement needs a browser runner the repo does not have, so the original "zero controls below 44px, measured" was unverifiable as written. If a browser runner is added later, restore the measured form. |
| A-4 | `apps/client` has a `test` script, it runs in CI, and it covers two-layer secrecy, the save/conflict path, and cross-mode navigation. |
| A-5 | From an open page, all four approved return edges are reachable (CI-3…CI-6). |
| A-6 | Suite-wide search returns journal entries and markers, from both the rail and the palette. |
| A-7 | Every confirmed defect CD-1…CD-8 no longer reproduces, each with recorded evidence. |
| A-8 | **Viewer safety**: a player session can reach no GM-only field of any new record type — verified at the HTTP boundary by test, including K2 (replays). |
| A-9 | Every new surface verified at a narrow viewport and with touch. |
| A-10 | `npm run check`, `npm test`, `npm run build` all green; no regression against the Stage One baseline (server 765, api-contract 80, rules-5e 108, schemas 19, domain 11). |
| A-11 | Every requirement ID in §4 maps to an implementing milestone and a verification method. |

---

## 9. Scope reality check — lead's assessment, owner's call

This specification approves **9 completion items, 6 foundation items, 8 defects, 9 integration items
and 12 campaign-tracking items — 44 requirements.** Campaign tracking alone introduces at least five
new persisted record types (session, prep, quest, deadline, downtime) plus faction standing, a party
marker and a reveal audit, each requiring schema, migration, routes, projection, GM UI, player UI,
mobile layout and tests.

**This is substantially larger than the overhaul described in the original brief**, which was about
making five existing areas cohere. It is a legitimate expansion — the owner asked for it explicitly —
but it should be entered with open eyes, not discovered halfway through.

**Lead's recommendation:** treat §4.5 (`CT`) as a **second programme** sequenced after CP/CF/CI, and
consider deferring CT-10 (full downtime) and CT-6 (faction standing) to a later cycle. The strongest
campaign-tracking value is concentrated in CT-1/CT-2/CT-3 (sessions, prep, recap) — which the owner
identified as key — plus CT-4 (quests) and CT-11/CT-12 (one timeline).

**This is a recommendation, not a decision.** If the owner confirms the full scope, it is planned in
full.

---

## 10. Unresolved questions

| # | Question | Blocks |
| --- | --- | --- |
| U-1 | Confirm or adjust the §9 scope recommendation. | Stage Three milestone count |
| U-2 | What node/edge scale should the Graph support? Verification has never exceeded 4 nodes; the layout is synchronous O(n²). Assumed **200 nodes** unless corrected. | CI-8 sizing |
| U-3 | Should sessions and prep be reachable from the combat pillar (e.g. starting a session from the table), or Codex-only? | CT-1/CT-2 placement |
| U-4 | Does a quest appear in the Graph and in search alongside entities, given it is not an entity type? | CT-4 |
| U-5 | Should the reveal audit cover only Codex records, or also table-side exposure (tokens, maps on the shared viewer)? | CT-9 boundary |

---

**Next stage:** on approval, Stage Three produces the experience design and the ordered milestone plan,
in a fresh session, using this specification and the assessment as the only required context.

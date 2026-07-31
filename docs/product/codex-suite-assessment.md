> ## ⚠ SUPERSEDED — 2026-07-31
>
> This is a **Stage One investigation**, kept for its evidence and its reasoning, not as a description
> of the product. The Codex overhaul it triggered has since shipped (D1–D26), and the surface it
> assesses no longer exists in the shape described here: the five-mode tab bar, the four unaddressed
> "destination" overlays, the separate Relationships and backlinks panels, the `RELATIONSHIP_TYPES`
> vocabulary, the marker/notebook wording and the modal-only player Codex are all gone.
>
> **Read this for:** why the overhaul happened, and the measured baseline it started from.
> **Do not read this for:** how the Codex works now. That is `docs/ai-ledger/current-state.md`, the
> `docs/adr/` decisions, and the code.

# Codex worldbuilding suite — current-state assessment

Date: 2026-07-28 · Baseline: `3144e58` (PR #50) · Status: Stage One output of the Codex suite
overhaul. Investigation only — **no redesign is proposed here and no product code was changed.**

The owner's brief states the Codex suite (World · Pages · Atlas · Journal · Graph) "was introduced
incrementally and currently feels uneven, incomplete, and insufficiently integrated." This document
establishes the evidence for that judgement so the subsequent discovery and design stages rest on
verified facts rather than impressions.

**Method.** Six bounded read-only intake investigations — two cross-cutting (the server/data spine;
the shell, design language and player Codex) and four area-scoped (Pages, Atlas, Journal+Calendar,
World+Graph) — scoped so no two agents analysed the same implementation. Every load-bearing finding
below was then **re-read in the repository by the lead before being admitted**; several agent claims
were corrected or re-scoped in that pass, and three findings originated from the lead's own
measurement rather than from any report. Claims are marked **CONFIRMED** (read directly),
**INFERRED** (deduced), or **OPEN** (needs a product decision).

> **Standing caution established during this stage.** `docs/ai-ledger/` is exceptionally detailed and
> was initially treated as confirmed context. It is now demonstrated to contain at least one
> "verified" claim the code does not support (§6.3). **Treat the ledger as evidence of intent and
> history, not of current verified state.** Every claim in this document rests on a direct code read.

---

## 1. Baseline — recorded before any change

All green; **zero pre-existing failures**. Anything red later is ours.

| Command | Result |
| --- | --- |
| `npm run check` | exit 0 |
| `npm run test` | exit 0 — server 765, api-contract 80, rules-5e 108, schemas 19, domain 11, dndbeyond-pdf 12 (+1 skipped) |
| `npm run build` | exit 0 |

Codex-specific server suites (`codex-store.test.ts`, `codex-http.test.ts`): **49 tests**.

Repository state: branch `claude/codex-suite-overhaul-nyeqg0` at `origin/main`, clean tree, no
stashes, **no uncommitted work to preserve**.

**Environment deviation (recorded so it is never misattributed):** this session ran Node **v22.22.2**;
`package.json` requires `>=24` and CI uses 24. All checks passed regardless.

### 1.1 The verification constraint that bounds the whole programme — CONFIRMED

- **`apps/client` and `packages/ui` have no `test` script at all.** ~3,485 LOC of Codex React has
  **zero automated coverage**; all 49 Codex tests are server-side.
- **No browser-test harness exists.** Neither Playwright nor Puppeteer appears in any workspace
  `package.json`. Prior "real Chromium smoke" verification recorded in the ledger was ad-hoc and is
  **not reproducible** by CI or by a later session.
- No linter; `check` is TypeScript-only (`docs/ai-context/testing.md`).

There is currently **no automated way to detect a regression in any Codex screen**. This is a
programme-level risk, not an area finding, and its resolution is a scope decision for Stage Two.
It also explains §6.3 structurally: with unreproducible verification, drift between the recorded and
actual state is expected rather than surprising.

---

## 2. What the suite is today

Five GM modes in one tab plus a separate read-only player modal. Server-owned, deliberately **off the
`GameState` broadcast**: writes emit a content-free `codex:changed` ping and clients refetch
(`decision-log.md:227-237`). Two-layer secrecy (`playerBody`/`gmBody`, `fields`/`gmFields`,
`revealedToPlayers`) is the signature concept, with `codex-projections.ts` as the choke point.

Effort is very unevenly distributed (LOC):

| | Shell/shared | Pages | Atlas | World+Graph | Journal | **Player (all 5 tabs)** |
| --- | --- | --- | --- | --- | --- | --- |
| Client | 1,595 | 699 | 473 | 309 | 232 | **177** |

Server: `codex-store.ts` 1,327 · `codex-http.ts` 476 · `codex-projections.ts` 144.

---

## 3. Strengths worth preserving

Deliberately listed first; the overhaul must not damage these.

- **The off-`GameState` satellite-store architecture is sound** and was independently re-confirmed.
  It should be extended, not replaced.
- **`codex-projections.ts` as a single viewer-safety choke point** works, and the server-side
  `SECRET_FIELD_KEYS` re-seal is genuinely defence-in-depth (`decision-log.md:304-317`).
- **Atlas → combat is the one fully-finished integration.** "▶ Go live here" is a real
  server-authoritative `scene:activate`, not a client fake (`main.tsx:381-383`, `AtlasView.tsx:149`).
  It is the only cross-pillar bridge in the suite and the model others should be judged against.
- **The World → Pages handoff is the best transition in the suite** — it sets the filter, clears the
  query, clears the selection and switches mode in one gesture (`CodexWorkspace.tsx:249-251`).
  No other cross-mode jump prepares its destination.
- **Pages ↔ Journal pinning is genuinely bidirectional** (`PageTimeline` in the editor ↔
  `journalApi.forPage`), and is the pattern the marker side conspicuously lacks.
- The **two-layer secret vocabulary is consistently applied** wherever it was applied at all
  (`RevealSwitch`/`GmOnlyTag`); the gaps are surfaces it never reached, not contradictions.
- Well-chosen data-integrity decisions: raw in-world dates as source of truth with derived sort keys,
  folders as first-class records, cycle-guarded map nesting.

---

## 4. Root cause 1 — the Codex is a parallel component vocabulary

**CONFIRMED by direct measurement (lead-originated).** Comparing `@vtt/ui` adoption against
`apps/client/src/homebrew/`, the closest comparable surface (a GM authoring tool with records,
autosave and a detail editor):

| | Shared primitives imported |
| --- | --- |
| **Codex** (14 files, 3,485 LOC) | **12** — Badge, Button, Field, IconButton, Input, Modal, Panel, SegmentedControl, Select, Switch, Tabs, Textarea |
| **Homebrew** | **24** — incl. Alert, Chip, ChoiceCard, FieldGrid, Menu/MenuItem, NumberField, RowEditor, **SaveState**, **Skeleton**, Stepper, **useToast** |

The Codex uses the *structural* primitives and almost none of the *stateful/feedback* ones. Every gap
is filled by a local re-implementation:

| Exists in `@vtt/ui`, unused by Codex | Codex's hand-rolled substitute |
| --- | --- |
| `SaveState` | `PageEditor.tsx:14` declares its own `SaveStatus` union; `:284` builds its own status label — for the **identical** autosave job `homebrew/RecordDetail.tsx` solves with the shared component |
| `Chip` | `.codex-filter-chip`, hand-built twice (`CodexWorkspace.tsx:290`, `PlayerCodex.tsx:99`) |
| `Menu`/`MenuItem` | `.codex-template-menu` + a `.codex-menu-scrim` click-catcher (`CodexWorkspace.tsx:266-267`) |
| `TagInput` | a comma-separated `<Input>` with `help="Comma-separated"` (`PageEditor.tsx:315`) |
| `Skeleton` | bare text (`MapSurface.tsx:135`) and a bespoke CSS shimmer (`CodexImage.tsx:25`) |
| `Alert`/`useToast` | a local `Notice` plus a raw `<p className="codex-rail-error">` (`CodexWorkspace.tsx:286`) |

**Consequence.** "Feels unlike the rest of the app" is substantially *not* a polish deficit — two
sibling GM authoring surfaces solve the same problems two different ways. This makes a large share of
the coherence work **adoption of existing primitives and deletion of local duplicates**, which is
cheaper and lower-risk than net-new design, and yields a countable criterion rather than a subjective
one.

**Caveat.** Each substitution must be proven behaviour-preserving (e.g. `TagInput` semantics vs the
current comma-split). Adoption is a direction, not an automatic drop-in, and must not become
opportunistic refactoring.

---

## 5. Root cause 2 — built plumbing, missing entry points

**CONFIRMED by exhaustive sweep (lead-measured).** Three agents each reported one instance; rather
than accept anecdotes, every client API method in `codex/api.ts` was swept for call sites across
`apps/client/src`:

| Capability | Built through | UI callers |
| --- | --- | --- |
| **Player search** (`playerCodexApi.search`) | typed client method (`api.ts:122`) + dual-role server route (`codex-http.ts:157,171-175`) + viewer-safe player index | **0** |
| **Journal entries for a marker** (`journalApi.forMarker`) | `api.ts:216`; the combat bridge stamps `attachMarkerId` on every scene-linked battle (`server.ts:259`) | **0** |
| **Rename/retype a map** (`atlasApi.updateMap`) | `api.ts:159` | **0** — a map's name and kind are frozen at creation, permanently |
| **Re-parent a map** (`atlasApi.setMapParent`) | `api.ts:160` | **0** |
| **Marker → actor link** (`actorId`) | client API, `codex-http.ts:69`, `codex-projections.ts:109-116`; deliberately retained per `decision-log.md:253-263` | **0 references in any client file** |

Every other API method has ≥1 caller, so this is a specific pattern, not general rot.

**The sixth instance — the combat-history bridge is effectively write-only.** Four separately-reported
journal findings compound into one conclusion none states alone. Per `server.ts:252-265` and
`codex-store.ts:1129-1137`, an auto-logged battle is:

| Property | Value | Consequence |
| --- | --- | --- |
| `revealedToPlayers` | **omitted at the call site** → evaluates false | Hidden from players |
| `playerText` | `"A battle was fought here."` | Player-shaped prose no player can see |
| `calendarInstant`, `inWorldDate`, `sessionNumber` | **hardcoded `null`** | Sorts into "Undated" below every dated entry, forever |
| `attachMarkerId` | written every time | Never read back (`forMarker` has 0 callers) |
| searchable | no — FTS is page-only (`codex-store.ts:278`) | Cannot be found |

The feature the ledger calls the Atlas↔combat *payoff* produces output that is hidden, undated,
unsearchable and unreachable from the pin it is attached to.

**Consequence.** "Incomplete" is precisely diagnosable: the suite is not missing *plumbing*, it is
missing *entry points* — much of the remaining work is UI wiring onto proven, already-tested server
paths. **OPEN:** "built" does not imply "should be exposed" (`actorId` may be intentionally dormant).
Whether each becomes an entry point or is deliberately removed is a Stage Two decision; today they are
neither, which is the worst of both.

---

## 6. Root cause 3 — the five areas share a shell but not a system

### 6.1 The suite is a star with Pages at the centre and no return edges — CONFIRMED

Every mode navigates *into* Pages (`CodexWorkspace.tsx:249-257`, `:321`). `PageEditor`'s only
outbound prop is `onNavigate` (`PageEditor.tsx:73`), and wiki-links, backlinks and relationships all
resolve to **another Page**. From an open character page there is no route to its pin on the Atlas,
its entries in the Journal, or its node in the Graph.

The near-miss: `PageTimeline` already embeds a page's pinned journal entries in the editor, but
renders them as plain `<span>`s (`PageTimeline.tsx:41`) with no way to open them in Journal — the
edge is one `onClick` away and absent.

### 6.2 There is no shared taxonomy — CONFIRMED

| Concept | Pages | Atlas | Journal | World | Graph |
| --- | --- | --- | --- | --- | --- |
| Tags | yes | no | no | reads pages' | no |
| Folders | yes | parent-tree instead | none | no | no |
| Full-text search | yes | no | **no** | n/a | n/a |
| Can be a graph node | yes | no | no | n/a | — |
| `expectedRev` concurrency | yes | no | no | n/a | n/a |
| Revisions | yes | no | no | n/a | n/a |

Three competing organizing schemes coexist (folders in Pages; type/tag filter in World↔Pages; the
Graph's own local type legend), and only the World↔Pages one is shared state
(`CodexWorkspace.tsx:39` vs `RelationshipGraph.tsx:87`). Journal entries — up to 20,000 chars each
(`codex-store.ts:513`) — are **not in any search index**, so the "campaign journal" pillar is
unsearchable from anywhere, including the command palette (`CommandPalette.tsx:37-42` indexes page
titles only).

### 6.3 Mobile parity is a hard invariant the Codex never adopted — CONFIRMED

`--tap-min: 44px` exists (`design-tokens.css:145`) and is applied throughout `packages/ui`.
**`.tap-target` appears zero times anywhere in `apps/client/src/codex/`.** `.codex-graph-legenditem`
computes to ≈20px (10px text, 4px vertical padding, no `min-height`) — roughly half the project's own
floor — while `current-state.md:265-267` records those chips as having "got real touch-size targets."
The Pages intake found the identical defect class in `NotebookTree`'s row actions. Only one real
breakpoint (`codex.css:296-301`) adapts layout, serving Pages/Lore; World, Journal and Graph have
none.

### 6.4 Missing joins the product implies — CONFIRMED

1. **The `event` entity type is disconnected from the timeline.** `entities.ts:39-41` gives `event`
   free-text `when`/`where` with no `calendarInstant` and no journal linkage. The product holds **two
   unrelated notions of "something that happened"** — an `event` page and a dated journal entry. The
   single largest missing join.
2. **No page → marker reverse lookup** exists (no such route in `codex-http.ts`); the link is
   marker→page only. A location page cannot show where it is on the atlas.
3. **Only pages can be graph nodes** (`codex-store.ts:829-831`). The Graph also ignores wiki-links,
   marker links and journal pins, so an entity connected only through prose `[[links]]` renders as a
   **disconnected orphan excluded from the auto-fit frame** — the Graph's picture of connectedness can
   be *more pessimistic than the truth*, in the one surface whose whole job is showing connections.
4. **World's data ceiling.** It renders from `pages` only and shows zero Atlas/Journal/Calendar
   signal, although `PlayerCodex.tsx:42` already fetches maps and timeline in the same `Promise.all`.
   Its "Recently updated" is also polluted: relationship edits don't bump `updatedAt`, but
   reveal-toggles and folder-moves do.

### 6.5 The player Codex is a degraded parallel implementation — CONFIRMED

177 LOC for all five tabs, with **no shared code** with the GM editor (`api.ts:1-6`; the player page
shape flattens both bodies into one `body` string). Improvements to the GM reader therefore do not
propagate. It has no search (§5), no folders, no sort, no command palette, and calls the same records
"Lore" where the GM calls them "Pages". **The GM cannot preview it at all** — it is gated on
`mode === "player"` (`main.tsx:310`) — even though the app already has that exact pattern
(`ViewerPreviewPanel`, `main.tsx:387`) and `ux-principles.md:29-31` names role clarity a first-class
property.

---

## 7. Confirmed defects (evidence-backed, severity is the lead's)

| # | Defect | Evidence | Severity |
| --- | --- | --- | --- |
| D1 | **Composing a new journal entry, then clicking Edit on an existing one, destroys the draft *and* its sessionStorage backup.** `editingId` turning truthy trips the very effect written to protect it. No warning, unrecoverable. | `JournalView.tsx:52-58`, `:76-84` | **High** — silent data loss |
| D2 | Entity-type switch is enforced **client-side only**: the server updates `entity_type` and `fields_json` independently, so an `entityType`-only PATCH strands the old type's keys, which `projectPlayerPage` then ships. No secret is exposed (those live in `gmFields`) — but the GM **cannot see or remove data players still receive**. | `codex-store.ts:634-640`, `PageEditor.tsx:311`, `codex-projections.ts:50` | Medium — contradicts this repo's own precedent (`decision-log.md:308-314`) |
| D3 | Autosave 409 resyncs the revision but **not the content**, so the next keystroke silently wins while the UI says "Changed elsewhere - reload". Message and behaviour disagree. Note: last-writer-wins is a *deliberate* recorded policy for the sibling case (`PageEditor.tsx:152-155`). | `PageEditor.tsx:128-133` | Medium, gated on **OPEN Q4** |
| D4 | The editor toolbar's **Link** button inserts `[text](https://)`, which the renderer provably cannot render — its supported subset has no markdown-link pattern. | `PageEditor.tsx:45` vs `CodexMarkdown.tsx:4-16` | Low, trivially fixable |
| D5 | `PageTimeline` marks entries "GM only" from `!playerText.trim()` rather than `revealedToPlayers`, so the normal case (hidden entry with player text) shows **no GM-only indicator**. | `PageTimeline.tsx:41`, `codex-store.ts:1122` | Medium — reveal-state misreporting |
| D6 | The Atlas is **practically single-root**: "New map" only creates a root when `currentMapId` is null, which never recurs after the first map. The data model supports a forest and is tested for it. | `AtlasView.tsx:106,123`; `codex-store.ts:229`, `codex-store.test.ts:187` | Medium |
| D7 | A **shown marker on a hidden map** is silently invisible to players with no GM warning; the inspector warns about a secret linked *page* but never about its own unrevealed *map*. | `codex-http.ts:349`, `MarkerInspector.tsx:97-99`, `AtlasView.tsx:113-118` | Medium |
| D8 | No mode has a loading state, and the shared error renders **only inside the Pages rail**, so a failed load is invisible in World and Graph. | `CodexWorkspace.tsx:286` | Medium |

**Untested high-risk paths — CONFIRMED:** only migration v7 has row-level coverage
(`codex-store.test.ts:316`); the v8 marker-array and v9 folder backfills never run against legacy
rows, and the combat bridge (`server.ts:252-265`) appears in **no test at all**. The Graph's O(n²)
synchronous layout has only ever been checked at 4 nodes (`current-state.md:209-211`).

---

## 8. Open product questions for Stage Two

Only questions the repository genuinely cannot answer. Grouped; each materially changes scope.

**A. Purpose and boundaries**
1. What is **World** for — dashboard, browser, or launcher? Should it surface Atlas/Journal/Calendar
   activity, or is entity-only intentional?
2. Should **Graph** represent wiki-links, marker links and journal pins as connections, or is it
   deliberately scoped to typed relationships only? (Today it silently under-reports connectedness.)
3. Should an **`event` page** be a first-class dated timeline record, or is the Journal the only
   timeline? (§6.4.1 — the largest missing join.)
4. Is the **Journal** one feature or two — a real-world session log and an in-world chronicle
   currently share one surface.

**B. Integration and taxonomy**
5. Should **tags, search and folders become suite-wide** concepts, or stay pages-only?
6. Should search cover journal entries and markers? (Journal is currently unsearchable anywhere.)
7. Which **return edges** from a page matter — to its marker, its entries, its graph node?

**C. The player experience**
8. Should the player Codex be a **modal** at all, is the player meant to **search**, and should the
   GM be able to **preview** it?
9. Should auto-logged combat entries default to **revealed**, and be **auto-dated** to the calendar's
   current date? (Today: hidden, undated, unfindable.)

**D. Architecture and quality**
10. **Is the Codex multi-writer?** Two agents reached this independently from different files. If
    yes, the missing `expectedRev` on maps/markers/journal is silent data loss; if no, last-writer-wins
    should be stated plainly and D3's misleading copy fixed.
11. What **scale** should the Graph be engineered for? Verification has never exceeded 4 nodes.
12. **Does this overhaul include establishing client-side verification?** (§1.1.) Without it there is
    no automated way to protect five reworked screens. This is a scope decision, not an assumption.
13. For each of the five unreachable capabilities (§5): **expose it, or deliberately remove it?**

---

## 9. What this stage did not cover

- No runtime/browser observation was performed — findings are from code and documentation only.
- Performance was reasoned about, not measured.
- Accessibility was assessed only against this repo's own tokens and conventions, not audited.
- Whether any UI path PATCHes `entityType` without `fields` (D2's live reachability) was not traced.
- The six full intake reports contain area detail deliberately not reproduced here.

**Next stage:** product discovery against §8, then a specification. No design or implementation work
should begin before those answers exist.

# Current state

**Read this at session start.** Short source of truth for what exists *now*. Update it
(concisely) after real work lands — don't let it drift. This is a snapshot, not history;
history goes in `session-summary.md`, durable decisions in `decision-log.md`.

_Last seeded: 2026-07-17 (initial ledger seed from README / NEXT-STEPS / code survey)._

## What works today

- **Character builder — the wizard screens (2026-07-27, branch
  `claude/dndbeyond-sheet-importer-0k6u2e`). A character can now be created through the UI for the
  first time.** A seven-step guided flow (Species · Background · Class & level · Class features ·
  Ability scores · Equipment · Name & review) launched from **"Create a character"** beside the
  roster's import buttons (GM only, phase 2). It is a **full page**, not a modal: `WizardShell` takes
  the viewport on a laptop and becomes a full-screen sheet on a phone (decision 4).
  - **Offers come from the content, not from code.** `apps/client/src/builder/build-payload.ts`
    rebuilds the same offer set `character-build.ts` validates against, resolving every `fromCatalog`
    slug through the shared `resolveCatalogChoice` — so the wizard and the server cannot disagree
    about what was offerable. Each offer renders with its pick count and gates Next until exactly
    filled, always with a reason ("Choose 3 for Weapon Mastery — 1 of 3 so far").
  - **Server authority holds.** The client sends CHOICES; the server assembles the sheet. Auto-rolls
    (ability scores, per-level HP) go through the existing `dice.roll`, so the numbers are
    server-thrown and land in roll history; manual entry carries the player's own physical dice into
    the payload. Nothing on the review screen is a computed game outcome — it shows the inputs, and a
    400 surfaces the server's own message inline.
  - **Ability scores** honour `builderPolicy.allowedAbilityMethods` (custom shown only with a
    configured formula) and wire `AbilityScoreAllocator` to the real `@vtt/rules-5e` math.
  - **Draft persistence is client-side for now** (`builder/draft.ts` → localStorage, keyed per
    session), surfaced through the shell's existing resume affordance. The stored record is the same
    shape a Phase-3 `GameState.characterDrafts[]` row would hold, so the swap is a change of
    transport, not of model.
  - **Ten catalogs** are read once per session through `apps/client/src/content/catalogs.ts` (module
    cache + in-flight dedupe + listener set; a failed or empty ack is never cached), and the
    persistent CC BY footer renders the catalogs' own `attribution` lines.
  - **Verified by driving it:** a Fighter 5 (human soldier, Champion) and a Wizard 3 (high-elf sage,
    Evoker) created end-to-end in Chromium at 1440px and again at 375px with touch — HP 52/AC 16 and
    HP 20/AC 12/DC 13/slots 4+2 on their sheets, matching `character-build.test.ts` exactly; zero
    horizontal overflow on all seven steps at 375px; 0 controls under the 44px floor.
  - **A readiness pass then reviewed it as a shipping product** (`479cb80`, `5c32df9`, `584be3a` —
    flow/IA, density/layout, design language + copy). What changed materially:
    - **One correctness bug, not a polish item:** a background silently grants skills, so re-picking
      one on the class step burned both picks and left the character permanently a proficiency short
      with no message. Held proficiencies now arrive greyed with their provenance. (The server guard
      is still per-offer — see `known-bugs.md`.)
    - **Step 4 is readable at high level.** Answered offers fold to title + count + chips; the
      capacity notice is stated once per grid instead of once per card. Level 5: 9,545px / 2,007
      elements → **782px / 92**. Level 20: 24,222px → **1,933px**. Every other step already sat
      between 1.0 and 2.1 screens at every level.
    - **The step rail tells the truth** — completeness derives from the same blocked-reason function
      the footer uses, so an answer invalidated five steps later loses its tick immediately instead
      of surfacing at review.
    - **The wizard stopped writing answers nobody gave** — "Raise ability scores" used to default all
      three improvements to +2 Strength (wrong for a Wizard, illegal at 20).
    - **A selected card had no keyboard focus ring at all**, and hover took the cyan edge *away* from
      the chosen card, so "the pointer is here" and "this is my answer" rendered identically. Both
      closed in the primitive (see decision-log rule 5).
    - Memoising the builder catalogs **exposed a latent bug** rather than fixing a slow one: the
      pruning effect's deps were incomplete and only worked because `catalogs` rebuilt every render.
      With the accident removed, picking Evoker stopped producing the Evocation Savant offer. Fixed
      by depending on `draft.picks`.
    - **A tenth reviewer certified the pass and found one defect the other nine missed** — a Wizard
      2+ could answer all seven steps and be **rejected at Create**. The expertise step (Wizard's
      Scholar, choose 1 of 6) offered all six enabled while the server accepts only the skills the
      character is actually proficient in, so a player picking without outside knowledge had roughly
      **4-in-6** odds of dead-ending at the last step. The flow chain's override was right — greying
      *held* skills would have made every Wizard 2+ uncreatable — it just stopped one step short. The
      fix is the **inverse** grey, in `withExpertiseReach`: options the character is *not* proficient
      in are greyed with a reason. It runs as a second pass because the server's test is a **union**
      over sources (`character-build.ts:643`), not an accumulation in step order — greying from the
      running total would have blocked a skill the player picks *later*. A safety valve never greys
      every option, so a build the client can't fully see falls back to today's behaviour rather than
      becoming uncreatable. Verified by A/B round-trip through the real server assembly: expertise in
      `investigation` is now blocked at step 4 ("not one of your proficiencies — pick a different
      skill") instead of at Create; `arcana` still builds and is accepted.
    - **Verification at the end of the pass:** `npm run check` clean, 767 tests, build green;
      Chromium walkthroughs at 1280×900 and 375×720/780 across Fighter L1/L3/L20, Wizard L5 and
      Cleric L5, in dark, dusk and light, each creating a character end to end — zero horizontal
      overflow on all seven steps in every run.

- **Homebrew content system (2026-07-27, branch `claude/dndbeyond-sheet-importer-0k6u2e`).** A GM
  can author, publish and play **nine content types** — class, subclass, species, background, feat,
  spell, equipment, monster, spell-list. 11 commits, ~15k lines.
  - **Storage is Codex-shaped, never `GameState`.** `homebrew-store.ts` owns its tables, migrations,
    revisions and `expectedRev`; `homebrew-http.ts` carries all 13 operations, GM-gated, **HTTP-only
    with a content-free `homebrew:changed` ping** and no socket handlers. That is not a preference:
    `GameCommandDescriptor.run` must return a revision from `store.execute` on `GameState`, and
    homebrew rows are not in it. Keeping out of `GameState` is also what leaves `projections.ts`
    untouched — `PlayerView` is a `Pick` allow-list.
  - **The audience filter is at the merge point**, not in projections. `ContentLibrary.forAudience()`
    takes a **required** argument so the compiler enumerates every call site. Draft reaches nobody;
    published + `visibleToPlayers` reaches both; published without it is GM-only.
  - **`monsterForInstance()` is deliberately status- and delete-blind** — monster actions and typed
    defences are late-bound per use, so a status-aware lookup would disarm live tokens mid-fight.
    That carve-out is what makes soft-delete safe.
  - **Editing is honest.** A patch that would fail the publish gate lands and **demotes the record in
    the same transaction** — refusing was wrong, because drafts may be invalid and the editor
    autosaves. Re-validation runs *after* the write, because validating first asks the question
    against the record's previous self.
  - **The editor is one schema renderer plus nine field schemas**, not nine forms — and it added no
    new field kind across two scope expansions. The class level table generates ~270 of its ~280
    cells (PB is arithmetic, features are a projection, nine slot columns derive from one
    caster-progression pick) with per-row override.
  - **Verified:** 923 tests; every operation × six credential types with zero getting through;
    zero horizontal overflow and zero undersized touch targets at 375px **and** the 320px floor in
    three themes; a homebrew Fighter clone builds a level-5 character matching the SRD exactly
    (48 HP, +3 PB, AC 17).

- **All twelve SRD classes (2026-07-27, phase 5, branch `claude/dndbeyond-sheet-importer-0k6u2e`).**
  The bundle went from **3 classes to 12** and 3 subclasses to 12 — Barbarian, Bard, Druid, Monk,
  Paladin, Ranger, Rogue, Sorcerer, Warlock, each with its one SRD subclass. **185 features, 46 of
  them choice-bearing, 42 authored choice options.**
  - **The content now has a source.** `sources/dnd-5e-srd-markdown/` vendors a CC BY 4.0 SRD 5.2.1
    transcription pinned to a commit, and `scripts/build-class-bundle.ts` generates from it. This
    closes a structural hole: the open5e fixtures ship **no** class/subclass/species/background/feat
    data at all, so those seven bundles were hand-authored with nothing to check them — which is
    exactly where both licensing violations landed. Re-run with
    `npm run build-class-bundle -w @vtt/content-srd-5.2.1`; it is idempotent.
  - **It adds, never regenerates.** Fighter/Wizard/Cleric carry typed riders the prose cannot
    express, so they are copied through untouched and used as the build's **oracle**: the generator
    re-parses them from the source and fails on any disagreement about hit die, saving throws, skill
    choices, proficiency bonus or spell slots. All three agree — that is what earns the source its
    (secondary) standing.
  - `statPriority` is **read from `@vtt/rules-5e`**, not hand-listed — it is not SRD text, the engine
    already owned all twelve, and the content/engine agreement test caught four drifts on the first run.
  - **Verified by creating one level-5 character of every class** through the real server assembly:
    12/12 clean; HP 50/44/38/32 by hit die (d12/d10/d8/d6 at CON 15); full casters 4/3/2, half
    casters 4/2, Warlock 2 slots at level 3.

- **Worldbuilding codex (2026-07-24, branch `claude/world-maps-geospatial-db-1kiqez`).** A GM
  worldbuilding suite + campaign journal + living atlas, on a new **Codex** GM tab (Pages | Atlas |
  Journal) plus a read-only **player Codex** (Lore | Atlas | Journal, behind a player "Codex" button).
  Freeform **two-layer markdown pages** (player-facing + GM-secret body, secret by default) with
  `[[wiki-links]]`, backlinks, tags, folders, FTS search, revisions/restore, autosave, banner + inline
  images. A nested **atlas** (world→region→local map tree, cycle-guarded) of an uploaded map asset,
  with polymorphic **markers** (link a page / sub-map / scene / actor) placed in image-pixel space on a
  pan/zoom/pinch/drag SVG surface (mirrors `EncounterMap` gestures, `touch-action:none`) + a curated
  recolorable icon set. A **journal** timeline (two-layer, session/in-world dating, per-page pinning)
  with an automatic **combat-history bridge** — a logged encounter posts a "battle fought here" entry
  pinned to the location marker (`onEncounterArchived` hook in `encounterEnd`, best-effort). Plus a
  **command palette** (Cmd/Ctrl-K), markdown import + JSON export. **Architecture:** a dedicated
  `CodexStore` (own tables in `data/vtt.sqlite`) + `codex-projections.ts` (viewer-safety boundary) +
  `/api/v1/codex` REST router + `codex-assets` media store, deliberately **off the GameState
  broadcast** (mirrors maps/tokens); every write emits a content-free `codex:changed` ping and clients
  refetch. Secret-by-default; `gmBody`/unrevealed content never reaches players (player FTS indexes
  only player bodies; player marker projection strips scene/actor links + unrevealed page/sub-map
  links; page media served to players only when used by a revealed page). Built in 7 slices, each
  `check` + `test` (466) + `build` green with live API + player-session smokes. Deferred by discovery.
- **Codex review + bring-to-life pass (2026-07-24, same branch).** After a four-lens audit
  (viewer-safety / correctness / architecture / UX, each in its own subagent), a round of fixes +
  features landed on top of the codex:
  - **Viewer-safety (audited):** fixed a real leak - `projectPlayerMap` returned `parentMapId` even
    when the parent map was unrevealed (a revealed child leaked a secret ancestor's id); the parent
    link now resolves reveal-state at the router like markers already did. Hardened the
    journal-by-attachment route to 404 a hidden marker/page for players. Added **`codex-http.test.ts`**
    (8 tests) exercising the real network boundary - the audit flagged its absence; it now regression-
    guards both leaks. Audit verdict otherwise clean; off-`GameState` design judged sound.
  - **Atlas ↔ combat (the payoff):** a marker can link a prepared **Scene** and **"▶ Go live here"**
    launches it from the pin (jumps to the table). This armed the previously-dead combat-history
    bridge (nothing set `marker.sceneId` before). One-tap **"＋ New page"** from a pin; **"reveal the
    page too"** nudge when a shown pin links a secret page. `markerForScene` now targets the current
    pin (one scene = one location, enforced on link).
  - **Notebook (user ask):** Pages became a Notion/Obsidian/OneNote-style space - **nested folder
    paths** (`NPCs/Villains`) rendered as a collapsible **tree** (`NotebookTree`), collapse state
    persisted, search overlays a flat list. Then a **three-pane notes layout** (2nd user ask): file
    explorer (tree, with a per-folder "＋ new note here") | editor (with a folder **breadcrumb**) |
    context pane (a live **Outline** of the note's headings + backlinks + pinned timeline); panes stack
    to master-detail on narrow/touch. Verified in-browser at 1360px and 460px.
  - **Editor:** `[[` **wiki-link autocomplete** (prevents canon forks), **drag/paste images**, an
    unmistakable **GM-secret pane** (violet border + "GM ONLY" tag), **New ▾ templates**
    (NPC/Location/Faction), inline **"Logged here"** page timeline (pins now read back).
  - **Correctness (from the code review):** MapSurface dropped a spurious marker on any pan in
    place-mode (compared vs last move sample, not gesture start) - fixed, + pointer-cancel discards;
    PageEditor autosave could 409 against itself and wedge - saves are serialized + resync on conflict;
    deletes release journal pins instead of dangling; stale marker-label on pin switch; player FTS no
    longer crowded by unrevealed drafts.
  - Verified: client+server typecheck, **31 codex server tests** (store+http), full build, and a **real
    Chromium smoke** (GM login → Codex → nested-folder notes render in the tree → `[[` autocomplete →
    zero console errors).
  - **Deferred (recorded, not built):** present-atlas-map→shared-TV (touches the viewer boundary -
    needs the `authorizeViewer` seam); map legend / marker-list panel; atlas reset/fit-view dock;
    `useConfirm` for the 4 codex delete flows (still raw `window.confirm`); tag-chip filtering;
    new-session prefill; `commandId` idempotency on codex creates; `DELETE /codex-assets/:id` + orphan
    GC; revision-snapshot coalescing; FTS5 boot-resilience; ETag on list reads; integration-API
    (`codex:read/write`) scopes. Still not built from the original vision: ~~mind-map graph~~ (built,
    pillar 4 below), ~~fantasy calendar~~ (built, pillar 2 below), page transclusion.
- **Worldbuilding platform — four pillars (2026-07-25, same branch).** The codex grew from a notebook
  into a World-Anvil-class worldbuilding tool, built + verified pillar by pillar on top of it:
  1. **Typed entities + relationships.** A page carries an **entity type** (character / location /
     faction / item / species / religion / event + plain note), each bringing a set of **structured
     fields** (autosaved), and **typed relationships** to other entities with a natural-language label
     per direction ("rules" ↔ "ruled by"). New `entity_type` / `fields` columns + a
     `codex_relationships` table (migration v3), dedupe + cascade-on-delete, and a
     `GET /codex/relationships` feed that is **viewer-safe** for players (both endpoints must be
     revealed). Client: a type selector + fields editor + a Relationships panel in the editor rail;
     entity icons in the tree; players read fields + revealed links.
  2. **Fantasy calendar + chronicle.** A GM-defined **calendar** (custom months w/ lengths, weekday
     names, era suffix; migration v4, sensible default). A **structured in-world date** on a journal
     entry computes an absolute `calendarInstant` (chronological sort, negative years OK) + a formatted
     label; the **timeline groups by in-world year** ("1492 DR"), earliest first. instant↔date
     round-trips for editing.
  3. **World home + tag browsing.** A **World** tab: entities grouped by type as counted cards, a **tag
     cloud** (counts, most-used first), and recently-updated; clicking a type or a tag **filters the
     notebook** (clearable chip). Tags are now first-class (were captured but led nowhere).
  4. **Relationship graph.** A **Graph** tab drawing the world as a web — entities as type-colored,
     iconed nodes, typed relationships as directed labeled edges — via a small deterministic
     force-layout (Fruchterman-Reingold + gravity) framed to fit; pan / zoom / hover, click a node to
     open it. Reuses the viewer-safe relationships feed (no new server code); `touch-action:none`.
  Verified per pillar: `check` + `test` (**562**, incl. new calendar + relationship suites) + `build`,
  each with a real Chromium smoke (fields stored + inverse relationship renders; timeline groups 1400 DR
  before 1492 DR; World cards/tags filter the notebook; a 4-node/4-edge graph framed + click-opens),
  zero console errors. Retires the two long-deferred "not built" items and supersedes the earlier
  UX-rejection of the graph (it now has a worldbuilding, not combat, payoff).
- **Worldbuilding hardening + polish pass (2026-07-25, same branch).** After a four-lens review of the
  pillars (viewer-safety / code / architecture / UX, each its own subagent), a round of fixes + polish +
  capability landed. Now at `check` + `test` (**566**) + `build` green, browser-verified.
  - **Viewer-safety (blocker fixed):** entity `fields` were single-layer, so a revealed villain's
    "Goals & motives" leaked to players on reveal. Fields flagged `secret` in the schema now ride a
    separate **`gmFields`** map (migration v5) that the player projection strips like `gmBody`; the
    editor shows them in a violet "GM ONLY - hidden from players" block. Regression-tested at the HTTP
    boundary. Switching a page's entity type now drops the old type's fields (they were surviving
    invisibly and rendering to players under raw slugs). The whole-graph edge feed now projects through
    the `codex-projections.ts` choke point (`projectPlayerRelationshipEdges`) instead of a hand-rolled
    router filter.
  - **Data integrity:** editing the calendar after dating journal entries silently corrupted them (only
    a derived instant was stored). Entries now persist the **raw {year,month,day}** (migration v6);
    `setCalendar` recomputes every dated entry's instant + label from the raw date (non-destructive
    reflow), and the edit form re-opens what the GM typed. `normalizeCalendar` guards NaN month lengths.
  - **Capability:** a world **"current date"** (the campaign's now) - a calendar field, a "◈ Now" readout
    + a "Today" marker in its year on the timeline. **Weekday names** are now wired into dated labels
    ("Sul, Hammer 15, 1492 DR"). The player Codex gained **World + Graph tabs** (viewer-safe: reuses the
    revealed-only page list + edge feed) + entity icons + type/tag filtering. A shared searchable
    **`EntityPicker`** (type-to-filter, chip, icons) replaced the flat entity `<select>` in
    relationships, journal pins, and marker links.
  - **Graph:** fixed a real drag-vs-click bug (a pan starting on a node opened it); added a type-filter
    legend, hover-to-focus a node's neighborhood, node size by connection count, and **+/- zoom buttons**
    (touch + keyboard couldn't zoom). **Design system:** entity colors were off-palette (green/amber/
    orange) + hardcoded; replaced with on-brand magenta->cyan spectrum **tokens** (`--codex-type-*`) from
    one source of truth (`ENTITY_DEFS`), used across tree / World / graph / badges.
  - **Editor trust:** autosave now flushes on unmount (navigating away within 800ms of an edit no longer
    drops it). The 5-way Codex switcher moved to `Tabs` (scrolls, no phone overflow). Symmetric
    relationships (ally/enemy/...) dedupe across direction; FTS indexes field values (public->player
    index, gm->GM index).
  - **Deferred (recorded, not built):** player timeline year-grouping (player projection intentionally
    omits `calendarInstant`); entity-ref field kind (typed link fields vs plain text); bulk
    reveal/tag/move; one-click "preview codex as a player"; hoist the entity-type + calendar-math vocab
    (and the `SECRET_FIELD_KEYS`/`secret:true` pair) into a shared package (client + server still
    duplicate it - accepted debt, flagged by the architecture + viewer-safety reviews).
- **Worldbuilding refinement pass (2026-07-25, same branch).** A self-review + two fresh audits
  (viewer-safety re-audit of the final state; a style-guide/design-language audit) closed the gaps the
  hardening pass left. Now `check` + `test` (**570**) + `build` green, browser-verified.
  - **Viewer-safety (a real gap I'd missed):** the `gmFields` migration only ADDED an empty column - it
    never moved a pre-existing `goals` value out of the public `fields` (a character created when
    `goals` was a plain field would still leak on reveal). Fixed defense-in-depth: the server now
    **seals** `SECRET_FIELD_KEYS` into `gmFields` on every write (create / update / revision-restore),
    so a secret can't rest in the player-facing map however it arrived; **migration v7** backfills
    existing rows. The re-audit otherwise found no leaks across all six surfaces. Also fixed
    **`exportBundle`** silently dropping `gmFields` (its SELECT omitted the column). Guarded by new tests
    (raw-write seal, player search can't surface a secret field value, and v7's SQL against a pre-seal row).
  - **Style guide (a live bug):** three CSS tokens I'd used don't exist (`--fs-lg`, `--fs-2xl`,
    `--shadow-lg`) - the journal year headers + World stat numbers were rendering at inherited size;
    fixed to real scale tokens (verified 26px/20px). Entity-type color tokens moved into the
    authoritative `design-tokens.css`; focus indicators that used magenta are now cyan (the reserved
    focus color); `font-size:10px` literals + dead hex fallbacks + raw-ms transitions tokenized.
  - **Mobile parity:** the calendar month/current-date rows reflow at ≤480px (verified no overflow at
    400px); EntityPicker clear/options + graph legend chips got real touch-size targets; the now-chip
    truncates; **two-finger pinch-zoom** added to the graph (mirrors `MapSurface`).
- **Codex design-language pass (2026-07-25, same branch).** A six-agent adversarial UX review (IA/nav,
  page editor, world+graph, journal/calendar/atlas, player, and cross-cutting coherence) plus a live
  screenshot walkthrough found the Codex worked but expressed the same ideas many different ways. Landed
  one coherent language; `check` + `test` (**570**) + `build` green, browser + 402px mobile verified.
  - **One "public vs GM-only" system, two axes.** A shared `RevealSwitch` (`SecretMarkers.tsx`) replaced
    four differently-worded reveal toggles with one **"Shown to players" / "GM only"** on pages, journal
    entries, maps, markers. A shared `GmOnlyTag` + `.codex-gm-block`/`.codex-gm-pill` give ONE violet
    "GM only" treatment to every GM-secret surface — secret fields, the GM body tab, **its Preview**
    (previously dropped the cue — a screen-share leak), the journal composer's GM field, posted GM text,
    pinned-timeline GM notes. Dropped the redundant "Visible to players when revealed" badge; de-conflicted
    violet (inert wiki-links are now muted, not violet).
  - **One vocabulary:** **Relationships** everywhere (was connections/links across panel, player reader,
    graph); "link" reserved for wiki-links; player reader heading matches the GM's.
  - **Adopted the design system the codex had skipped:** the app's themed confirm dialog + destructive
    action replace four raw `confirm()`s (page/entry/map/marker delete); the Atlas "new map" picker is a
    real `Modal` (was an off-screen bare div); player Codex dropped its redundant second "Close".
  - **Navigation + no-silent-failures:** the Codex mode bar is a bordered sub-toolbar (distinct from the
    GM tab bar above it); the command palette reaches all five modes; World's GM empty state has a real
    "New page" CTA; **Species + Event** got create templates (all 8 types now creatable); the journal
    composer persists an in-progress entry (sessionStorage) across tab switches; import confirms success;
    player combat journal entries carry a "Battle" badge (not colour alone); the graph frames on the
    connected web + takes a player-appropriate empty state.
  - **Notebook organizing (follow-up).** The Pages tree gained real Obsidian/OneNote-style organization:
    a persisted **sort** (Name A-Z / Z-A / Recently edited), **drag-and-drop** a page onto a folder or the
    top level (desktop) + a per-page **move-to-folder picker** (the touch/everywhere path — mobile parity),
    **New folder**, and **Rename folder** which re-paths the folder + its descendants via a new bulk server
    op `moveFolder(from,to)` (`POST /codex/folders/move`, one transaction, no per-page revision, guards
    self-nesting). Also fixed list/tree titles that were right-aligned (`.codex-list-title` is now `flex:1`).
    Verified drag + picker + rename + 402px touch, 571 tests.
  - **Deliberately NOT changed (reviewers split / reversible-risk):** kept the 8 per-type entity colors
    (the coherence lead flagged entity identity as the one already-consistent system; leave it — icon +
    label already disambiguate) rather than the world+graph reviewer's color-by-category redesign; kept
    the secret "Goals" field (unified its look) rather than folding it into the GM body; GM stays defaulted
    to Pages (first action is actionable) while the player lands on World. Recorded as options, not done.
  - **Emoji → SVG icon set + copy pass (follow-up, at the owner's request).** Replaced every codex emoji
    with a hand-drawn **fantasy-cartography SVG set** (`icons.tsx`, ~48 recolorable glyphs). It now backs
    BOTH the map-marker picker (expanded from 24 flat-modern glyphs and restyled — castles with turrets,
    hachured peaks, tree clusters, crossed swords, henge, ship, dragon…) AND the typed entities: each type
    maps to a glyph (`entityIconId`) drawn in its accent colour via `<EntityIcon>`, replacing the emoji at
    every site (tree, World cards, graph nodes, picker, reader, relationships, templates) plus the editor
    toolbar's link/image. This **supersedes the "kept the emoji" note above** — the owner found them cheap.
    Also professionalized the corny helper copy (empty states, journal prompts, "Logged here"→"Journal",
    etc.). The world+graph reviewer's color-by-category idea remains an option; colours are unchanged.
  - **Marker multi-linking (follow-up, at the owner's request).** A map pin can now link **many pages**
    and **many prepared scenes** (was one each) alongside its single drill-down sub-map. The
    `MarkerInspector` shows each linked page (open) and scene (**▶ Go live**) as its own removable row with
    an adder below; storage moved to JSON id-array columns (`page_ids_json` / `scene_ids_json`, **migration
    v8** backfills the old single `page_id`/`scene_id` into one-element arrays — those columns are now
    dormant), each validated, deduped, and capped at 24. Relaxed the old **"one marker per scene"** rule: a
    scene may sit on several pins, and the combat-history bridge (`markerForScene`) resolves to the most
    recently-touched one. Viewer-safety held — the player marker projection ships only the *revealed* subset
    of a pin's pages and still strips every scene/actor link (`codex-store` + `codex-http` unit tests, plus
    a live GM-link→player-read check). `check` + `test` (**573**) + `build` green; browser-verified linking
    2 pages + 2 scenes on one pin with the player seeing only the revealed page, 390px mobile clean.
  - **Page-editor header fix + notebook subfolders (follow-up, at the owner's request).** Two GM-reported
    issues in the Codex editor. (1) The title `<input>` was rendering **240px tall** — `.codex-title-input`
    kept `flex: 1 1 240px` from when it was a row child, but it now sits in the *column* `.codex-editor-
    titlewrap`, so that basis became 240px of HEIGHT (a huge empty band above the form). Fixed to
    `width: 100%` (one line, 39px). (2) The typed-entity fields didn't line up: Entity type/Folder/Tags was
    flexbox (3 cols) while When/Where/Participants below was an auto-fit grid that made **4** cols — nothing
    aligned. Both rows now share ONE grid (`repeat(auto-fit, minmax(min(220px,100%),1fr))`), so columns line
    up and collapse 3→2→1 as the panel narrows. (3) **Subfolders**: the notebook already stored/rendered
    nested folders, but a subfolder could only be made by typing a full `Parent/Child` path; each folder row
    now has a **New subfolder** action (a `folder-plus` glyph beside Rename + New note) that creates the
    child under that folder's path. `check` + `test` (573) + `build` green; verified at 1440px (columns
    align, `NPCs`→`Villains` nests one level deeper) and 390px (fields stack, no overflow, folder actions
    always shown for touch).
  - **Persistent folders + reliable note moves + richer markdown (follow-up, at the owner's request).**
    Folders used to live ONLY in each page's `folder` path, so a folder vanished the moment its last note
    left, and moving the OPEN note wedged the editor. Now **folders are first-class records** (`codex_folders`,
    migration v9): the tree unions records with page-derived paths, any folder a page is saved into
    auto-registers (with ancestors), and New folder / New subfolder create an empty one directly. Added
    `listFolders`/`createFolder`/`deleteFolder` store ops + GM routes; `moveFolder` (rename) carries records
    along; **Delete folder** re-homes every note under it to the top level (a note is never deleted) behind a
    themed confirm. Fixed the **open-page move revert**: `PageEditor` now adopts an external change to the
    same page (a tree move repaths folder + rev) when it holds no unsaved edits, so its Folder field updates
    and its next autosave no longer 409s. **Markdown** got real substance: `CodexMarkdown` now also renders
    `~~strike~~`, `` `code` ``, numbered lists (`<ol>`), blockquotes, and `---` dividers (bullets/numbers group
    into real `<ul>`/`<ol>`; still display-only + injection-safe), the toolbar gained Strikethrough / Inline
    code / Numbered list / Quote / Divider, and the easy-to-miss Preview switch became a clear **Edit | View**
    segmented toggle. `check` + `test` (**574**, +1 folder-record store test) + `build` green; live-verified at
    1440px (open-note move saves cleanly, empty subfolder persists, create+delete folder, every new markdown
    format renders, Edit/View round-trips) and 390px (4 folder actions + 12 toolbar buttons fit, no overflow).
  - **Atlas drill-down chips + notebook note/folder order (follow-up, at the owner's request).** Two more
    GM-reported gaps. (1) **The atlas could only navigate UP** — the breadcrumb walks the parent chain, so a
    regional map nested under a world map was unreachable once you left it (the sole way down was a marker's
    "Drills into map" → Enter). The atlas bar now renders the current map's children as **"Drill into" chips**
    (GM: a 🔒 flags a child not yet revealed); clicking one descends, the breadcrumb still climbs back. The
    New-map button reads **"Add sub-map"** on a map and the picker says the new map nests inside the current
    one, so creating a regional child is obvious. Mirrored in the **player** atlas — viewer-safe, since the
    chips filter the server's already-revealed-only map projection (no lock/GM state shown to players).
    (2) **Notebook order**: within any folder, notes now sort **above** subfolders at every level (was:
    subfolders above the folder's own notes). Live-verified on a seeded World→Region atlas (GM drill chip +
    descend + climb-back; player sees the same chip unlocked after reveal and can drill) and in the notebook
    (root note above the NPCs folder; NPCs' note above its Villains subfolder). check + test (574) + build green.
  - **Notes tab: three-card layout + draggable folders (follow-up, at the owner's request).** The Pages view
    is now three distinct cards like a real notes app — notebook tree (left), editor form/body (center), and
    the **relationships/journal/outline context as its own card** (right, was blended into the editor). Done
    by making `.codex-main` transparent and carding `.codex-editor-center` + `.codex-editor-context` (context
    236→288px); the app is a touch wider (`main` 1600→1720px, styles.css) so the row has room, and the cards
    stack below the three-pane breakpoint (no overflow at 390px). **Folders are now draggable like notes**:
    drag a folder onto another to nest it, or onto the top level to un-nest — every note + subfolder travels
    (server `moveFolder` re-paths the subtree); dropping onto self/descendant is rejected. `check` + `test`
    (**575**) + `build` green; live-verified at 1900px (three cards, app 1720px) + 390px (stacked), and a
    drag of "Places"→"NPCs" moved Tavern→NPCs/Places and Cellar→NPCs/Places/Basement (API-confirmed).
- **Scene-centric IA (2026-07-22).** The GM's prep is scene-first: a **Scenes** hub tab holds a gallery
  of prepared scenes (map thumbnail, combatant count, LIVE/staging badge) with per-card go-live, private
  staging, rename, **duplicate**, remove, and **drag-to-reorder** (`scene:duplicate` + `scene:reorder`,
  GM-only, through the shared operations layer + `/api/v1` twins). Going **live also presents the
  scene's map to the shared screen** (viewer bridge: a live scene projects its map + prepared fog
  pre-combat; combatant tokens still only once the fight runs — no new actor exposure). The standalone
  **Map Setup tab is retired** — the map library + 3×3 calibration fold into the hub ("Manage maps");
  the Encounter tab starts combat on the live scene's map (server requires the match). Gallery/cards use
  a new `@vtt/ui` `.nh-gallery`/`.nh-card` pattern (in `/styleguide`, all three themes; each card has
  explicit **Prepare** + **Go live** buttons). Design record: `docs/product/scene-centric-ia.md`. Built
  in 7 verified slices; `check`+`test` (462)+`build` green, a live Playwright smoke per slice. GM tabs
  are now Scenes · Encounter · Viewer · Replays · VTT Setup. **Encounter-tab quick-switch (review
  2026-07-23):** a compact **"Scenes" button** (labelled with the live scene) opens the gallery in a
  **picker popup** (square panels) — the always-on `SceneSwitcher` strip was retired as it overflowed
  with many scenes. The live card counts combatants from the top-level combat (its own slot is empty by
  invariant); Go live from the hub lands on the Encounter tab.
- **UI design system — OzyVTT (2026-07-21).** A tokenized retrowave design language
  lives in `packages/ui`: `design-tokens.css` (three themes — dark default, dusk, light — via
  `data-theme` on `<html>`), self-hosted `@fontsource` fonts (Bungee/Russo One/Manrope/Space
  Mono, no runtime CDN), and an `nh-`-namespaced primitive kit (Button, Field/Input/Select,
  Panel, Tabs, Menu, Tooltip, Modal, Chip, Wordmark, Toast, ThemeToggle). Consumed as source by
  the client's three Vite entries (`main`, `viewer`, `styleguide`) via `import "@vtt/ui/styles.css"`.
  All 16 client stylesheets migrated off the old parchment/amber palette to tokens (0 hardcoded
  legacy colors); native `window.confirm/prompt` retired for styled `useConfirm`/`usePrompt`
  dialogs; on-map HP/team/active-turn colors moved to the palette. Signature moments: the home
  hero (chrome wordmark + grid + bloom), empty-map atmosphere, faint app-shell CRT texture, and
  the `.combat-active` hue shift. Dev-only `/styleguide` route is the living reference. No
  server/domain/projection changes; viewer projection untouched. See
  `docs/ai-context/design-language.md`. The app + design system are named **OzyVTT**.
  - **Motion + audit follow-up (2026-07-21, same PR).** The shared motion vocabulary is now
    pervasive, not primitive-only: every raw `<button>` presses, `input`/`select`/`textarea`/
    `summary` transition instead of snapping, genuine click-target cards (map library, grid-type,
    token thumbs) hover-lift, forward CTAs (home choices, Enter table, Start encounter, Next turn)
    carry a nudge arrow, and each GM tab panel animates in (`view-in`, guarded so dense initiative/
    log/token rows stay press-only). Structural primitive adoption closed conformance gaps:
    `useConfirm`/`usePrompt` are rebuilt on the `Modal` primitive (native `<dialog>` focus-trap +
    return, scrim blur, scroll-lock, `dialog-in`); condition chips flow through `Chip` with the
    shared SRD glyphs as icons + tone (harmful/magical) so category survives a color-blind read;
    map health uses `hp-fill-*` band classes that resolve `--cyan`/`--magenta`/`--danger` so token
    health follows dark/dusk/light on table + viewer; drawing colors (player/annotation/crosshair/
    AoE) move onto the brand ramp, dropping the banned green/orange/yellow/amber.
  - **Consolidation wave 2 (2026-07-21, same PR).** Transient notifications collapse onto one
    surface: the app is wrapped in `ToastProvider`, battlemap `table:event`s and ephemeral GM
    acknowledgements route through `useToast`, and the bespoke `MapToastStack` + inline-success
    `Notice` path are retired (`Notice` stays for inline errors/pending). Effect chips join
    condition chips on the `Chip` primitive (dead pill CSS removed). Rich popovers stay bespoke
    (they hold controls, not menu items) but match the `Menu` primitive's behavior — the ⋯ options
    popover closes on Escape and both it and the token menu use the `anim-popover` entrance; the
    two `role="group"` segmented controls (viewer tool, API language) are correctly left as groups,
    not forced into tablists. `<code>`/timestamps use the branded mono face (tabular figures), and
    the replay/viewer/map focus rings unify onto the shared layered `--focus-ring-color`. All five
    bespoke feature modals — scene prep, character sheet, monster browser, spell card, token
    library — now render through the shared `Modal` primitive (native `<dialog>` focus-trap + return,
    scrim blur, scroll-lock, `dialog-in`), retiring the three hand-rolled backdrops and every
    per-modal head/close/box rule; the spell card keeps its violet identity via `accent="violet"`.
    The `/styleguide` gallery demos every primitive (Modal, Toast, Menu, Tooltip, Chip-with-icon,
    Tabs, motion) across all three themes — it is the complete living reference.
  - **Full component-primitive adoption (2026-07-21, same PR).** The generic raw controls across
    all ~16 client feature files now render as `Button`/`Input`/`Select` components (variants
    secondary/ghost/destructive/primary) instead of raw `<button>`/`<input>`/`<select>` — done as a
    visual-preserving swap (parallel agents + review). Genuinely-specialized controls stay
    intentional custom components (combat CTAs, economy-slot toggles, map-tool icon buttons,
    condition/scene chips, token/map cards, menu rows, HP/dice steppers, calibration swatches,
    `role="group"` segmented controls) — the design system's Button/Input are for generic controls,
    not these. Form submit buttons keep an explicit `type="submit"` (the primitive defaults to
    `type="button"`). No CSS/logic/projection changes. Only deferred item left: the ⌘K command
    palette (its motion already landed; the feature is a separate later pass).
  - **New primitives + template patterns + polish (2026-07-21, same PR).** Expanded `@vtt/ui` with
    four small forward-looking primitives for the app's next surfaces (character sheets/builder,
    homebrew, content importing): `Badge` (count/status/tag), `Avatar` (monogram or portrait + presence
    dot), `Meter` (labeled HP/resource bar; health tone auto-bands cyan/magenta/danger like token +
    map health), and `Alert` (in-flow info/success/warning/danger banner — the persistent counterpart
    to a Toast). Added `styles/patterns.css` with shared class templates `.nh-table` (content lists/
    imports), `.nh-statlist` (stat-block key-value grid), and `.nh-empty` (empty state). All
    on-palette (success = cyan, no green), theme-aware (AA in light), and demoed live in `/styleguide`
    with their own sections. Six more distinct primitives followed, each its own category:
    `Switch` (immediate on/off setting), `Stepper` (numeric −/+ spinner), `SegmentedControl` (inline
    pick-one for filters/modes, distinct from Tabs), `Steps` (multi-step wizard progress), `Skeleton`
    (reduced-motion-safe loading shimmer), and `Kbd` (key cap for shortcut hints / the coming ⌘K
    palette). Two fixes: the theme-toggle content is now optically centred (Manrope
    line-box nudge), and the GM setup view's empty map hero is sized like a real battlemap so the map
    panel and the `--setup-h`-matched encounter panel are comfortably tall instead of short stubs.
  - **Existing components conformed to the new primitives (2026-07-22, same PR).** After a
    component audit, the clear hand-rolled duplicates of the new primitives were migrated onto them
    (presentational only — no logic/projection/API changes): the three −/value/+ clusters (roster
    hit-dice, exhaustion level, dice modifier) now use `Stepper` — which gained an optional
    `format` prop for signed values (`±0`/`+3`), demoed in the styleguide; the three
    `role="group"` aria-pressed pickers (map-kind filter, viewer presentation tool, API example
    language) now use `SegmentedControl` (this **supersedes** the earlier "left as groups" note now
    that the primitive exists); the actor-card monogram + presence dot became `Avatar` (domain
    `reconnecting` maps to Avatar's `away`); the YOU / claim-status / token "Recent" pills became
    `Badge` (tone by state); the underwater-fight and "others can move this" immediate toggles became
    `Switch`; and the roster / integrations / token-library / replay section empties adopted the
    shared `.nh-empty` template. Dead per-feature CSS retired. Specialized controls stay bespoke on
    purpose (kind-colored initiative/tray avatars, save-die-mode, grid-mode cards, CharacterSheet
    stat grids, on-canvas health SVG + dense initiative HP bar). Verified `check`+`test` (456)+
    `build`, and Playwright dark/light/390px on every migrated surface.
- **Combat rules engine (ADR-0020, 2026-07-18).** Server-validated action resolution per encounter
  `rulesMode` (strict/assisted/freeform) with audited one-tap overrides; compound-action instances
  (Extra Attack pool, Multiattack components); persistent effects with durations, source links,
  linked conditions, escape DCs, onEnd grants, and endsWithTag cascades; typed damage with automatic
  resistance/immunity/vulnerability breakdowns; advantage/disadvantage aggregation with explainable
  sources (incl. 2024 prone distance rule + unconscious-adjacent auto-crit); PC dying state machine
  with death-save rolls; commands `effect.add/end`, `death-save.roll`, `encounter.set-rules-mode`,
  `actor.rest`, and (slice 2, same day) reaction prompts as first-class pending windows — a hit
  parks its damage on `pendingReactions`, `reaction.answer` applies half (Uncanny Dodge) or full,
  `reaction.dismiss` for manual bookkeeping — plus incapacitation gating
  (`condition.incapacitated`), a server-computed `available-actions` read (shared evaluation with
  enforcement), and archive v3 `postEncounterState` (47 commands total); SRD bundle enriched
  (126/178 structured Multiattacks, 47 on-hit riders, 146 typed-defense monsters); enriched
  replay-party fixtures + a regression suite derived from the two archived encounter runs.
- **Unified roll UX (2026-07-21, PR #38).** One recognizable preview→confirm roll experience on
  every surface via a shared `RollControls` widget (auto-roll-on-appear or manual entry; Adv/Disadv
  re-roll the d20; Confirm applies, Re-roll restarts). Death saves, single-target attacks, and
  opportunity attacks preview the d20 with nothing applied until Confirm — `action:resolve` gains
  `commit` (default true) + `attackNatural`, `death-save.roll` and `reaction.answer` gain
  `commit`/`rollMode`/`attackNatural` — and the damage Apply step is an editable total for
  hand-rolled numbers.
- **SRD combat-rules gap closure, tiers A–D (ADR-0020 second amendment, 2026-07-19, same PR #38).**
  Full SRD 5.2.1 cross-audit implemented in four tiers: every condition's modifiers (frightened,
  invisible, grappled-vs-grappler, charmed-charmer, paralyzed auto-crit, physical-save auto-fail,
  restrained Dex-save disadvantage, exhaustion −2×level with level-6 death, petrified defenses,
  condition immunities — GM-only, stripped from player views); the eleven 2024 generic actions +
  Unarmed Strike/Grapple/Shove/Escape as a frozen-id builtin catalog for any combatant (Dodge/Help/
  Hide/Ready with real effect mechanics); movement budgets (`speedFeet`, `movementUsedFeet`, Dash,
  exhaustion, prone stand cost, `actor.set-speed`, GM-only overrides) and opportunity attacks as
  `leaves-reach` prompts answered by a real off-turn melee attack (hidden movers prompt no one);
  range/reach/long-range/close-combat validation with normal/max range bands in the ETL;
  GM-adjudicated cover (±AC and Dex saves, total-cover block); concentration (one-at-a-time,
  damage-prompted CON saves, incapacitation/0-HP breaks); 2024 surprise (initiative disadvantage);
  short rests (per-short-rest pools only, no hit dice); underwater fights
  (`encounter.set-environment`); nonlethal knock-out; a falling-damage dice helper. 81-test
  regression suite with SRD citations. Deferred (documented in the amendment): two-weapon
  fighting, weapon mastery, mounted, jumping, burn/suffocation timers, breaking objects, hit
  dice, vision/LoS/auto-cover, difficult terrain. Roadmap:
  `docs/product/rules-engine-followup-assessment.md` §4.
- **Foundry/AboveVTT adoption pack (2026-07-19, same PR #38; ADR-0020 third amendment +
  ADR-0021).** Design-study adoption (no code copied; AGPL/convention): **recharge abilities**
  (structured `uses.per: "recharge"` pools from the ETL — 86 across the bundle incl. 13
  upstream-mislabeled die-range recharges — auto-rolled d6 at the owner's turn start with narrated
  dice, re-armed by encounter start and rests); **legendary actions + Legendary Resistance**
  (`combat.legendaryUsed` per-round pool refreshing at the creature's own turn start, economy
  blocks for own-turn/over-pool, GM `turn.use-legendary`, LR as a GM commit flag on `save.answer`
  that flips a previewed failure into the success outcome from an N/day `actionUses` pool; ⭐
  off-turn console switch in the tracker; pools stripped from player views); **hit dice**
  (`Actor.hitDice` seeded from hit-point formulas, `actor.spend-hit-dice` heals roll+Con min 1
  per die through `healActor` with the dice in the shared roll history, long rest refills, roster
  gains the missing Short/Long rest buttons + stepper, pool owner-only in projections);
  **condition glyphs** (original SVG icons for all 15 SRD conditions on map tokens, shared
  table/replay/viewer via `conditionIds`); **scene thumbnails** (cached one-fetch-per-asset map
  previews in the Scenes strip chips); **manual fog of war v1** (ADR-0022 — per-scene reveal/hide
  rect strokes, three GM-only commands with parked-scene `sceneId` prep, GM-dim/player-solid
  mask, timeline-neutral, presentation-not-security-boundary; the BUILD_PLAN Phase-2 gate item).
  Regression suite now 104 tests + 7 fog tests; hit dice moved OFF the unsupported list above.
- **Token health display + shared initiative + scene-setup picker (2026-07-21, PR #40, unmerged;
  includes the review-feedback refinements below).** (1) **Token health on the map:** a table-wide
  default `combat.healthDisplay {style: band|bar|ring|aura, audience: gm|all}` plus an optional
  per-token `Actor.healthDisplay` override, set from the token right-click menu (per-token, a `<select>`
  styled like Size + a "Show to" audience select) and the encounter options menu (table). `bar` (thin
  HP bar) / `ring` (green→red arc) / `aura` (soft green→red glow) render in place of the coarse band
  dot; the audience gate is resolved once, server-side (GM exact fill; a player's own PC exact; every
  other combatant band-fraction; viewer band-fraction), so exact HP never reaches a non-owner. Two
  GM-only commands `encounter.set-health-display` + `actor.set-health-display` mirror the roll-mode
  pattern (49 command routes now). (2) **Single-source initiative:** `projectPublicInitiative` carries
  public-only condition ids + labels, and one shared `InitiativeRow` (no HP bar — Bloodied/Down text +
  condition dots only) renders the player panel AND the viewer, so the two lists can't drift; the
  viewer reads as a player with no active turn (compact Round pill, no controls, active-on-top). Both
  the GM tracker and player panel put the active combatant on top with its acting console inline under
  that row. (3) **Scene-setup picker:** pinned PCs (pre-checked) → recent (server-tracked GM-only
  `Actor.lastUsedAt`) → searchable rest; undocked at desktop the setup panel is map-height with the
  combatant list scrolling internally. `bandFraction`/`hpFillFraction` (client, React-only, in
  `mapImage`) are the single fill source for the token bar/ring/aura and the viewer. **Deferred
  follow-up:** a "manage all scenes" browser modal (the `SceneSwitcher` strip stays the quick switcher).

- TypeScript monorepo: React/Vite client (`@vtt/web`) + authoritative Express + Socket.IO
  server (`@vtt/server`); packages `domain`, `rules-5e`, `schemas`, `api-contract`, `ui`,
  `content-srd-5.2.1`, `test-fixtures`.
- LAN-safe-by-design: no accounts/cloud. First-run GM password bootstrap is loopback-only;
  only a bcrypt hash + `tokenSecret` persist in `data/auth.json`.
- Server-owned session + character-claim model; separated GM/player projections; realtime
  state events with idempotency receipts and revision conflict handling.
- Embedded SQLite (WAL, versioned migrations); snapshots every 50 revisions.
- Authenticated map library with guided printed-grid (3×3 drag) / gridless setup and
  regional/world scales.
- Server-authoritative encounters: initiative, turns/rounds, token placement/movement with
  server snapping, per-drawing annotation colors, GM/player layer toggle, pings.
- Paired **table viewer** (second screen): pairing codes, "Present <map>", player-safe
  projection over SSE. Viewer bundle never receives full `GameState`.
- **Public integration API v1 (PR F) — FULL game coverage.** Every game capability is extracted
  into a transport-agnostic operations layer (`game-operations.ts` + shared schemas in
  `game-commands.ts`); Socket.IO handlers and the HTTP routes in `game-http.ts` are thin adapters
  over the same functions (ADR-0016, structural). Surface: `GET /api/v1/game` (GM-full or
  `?view=player` player-safe projection, weak-ETag polling), `GET /api/v1/game/log`, 40 typed
  command routes (encounter lifecycle, initiative incl. timeline next/previous with 409
  `needsConfirm`, turn economy, token move, HP/conditions, roster add/import/remove, dice,
  action resolve, saves, annotations, character claims incl. GM force-release, token
  image/size cosmetics, staged scenes create/rename/remove/activate/combatants), a generic
  `POST /api/v1/game/commands` tunnel + `GET` catalog (type → required scope, single-sourced as
  `GAME_COMMAND_SCOPES` in the contract), `POST /api/v1/sessions/player` (HTTP mirror of the
  socket's open join — pure-HTTP player clients), `/api/v1/content/*` reads, and
  `/api/v1/encounters` archives (list/get behind `combat:read`, delete behind `admin`; legacy
  `/api/gm/encounters` kept). Auth per route: GM session, player session (player-limited, same
  reducer checks as the table), or GM-minted integration credential checked against per-route
  scopes (`scene:write` now in real use); writes are idempotent by `commandId` with
  `expectedRevision` conflicts carrying `currentRevision`. CORS open on `/api/v1` only (login
  stays same-origin), JSON body limit 512kb, OpenAPI 3.1 fully documents the surface (served
  byte-identical from `@vtt/api-contract`; human reference GENERATED to `docs/api-reference.md`
  with a freshness test), capabilities advertise `gameApi`/`commandTunnel`/`encounterArchives`.
  No SSE/webhooks yet (deferred by design).
- **Time Machine v2 encounter archives.** Migration v5 `encounter_journal`: every accepted
  command while a fight is live is journaled in-transaction (type, payload, principal tag,
  revision, timestamp); `archiveSchemaVersion` 2 adds `journal[]` (start→end inclusive),
  `finalState`, complete `rolls[]`, full `definitions[]` (imported + bundled with CC-BY
  `attribution`) to the existing turns+log document. Shape documented in
  `apps/server/src/encounter-archive.ts`.
- **Movement narration in the Time Machine.** Every live `token.move` appends a `movement`
  combat-log line: distance moved plus old → new range to every placed combatant
  (Chebyshev cells × `distancePerCell` on calibrated grids, saved image scale on gridless,
  numberless otherwise; `apps/server/src/movement-narration.ts`). Viewer safety is structural:
  a public line covers public combatants only; hidden combatants' ranges go in a separate
  GM-only line (a hidden mover's whole narration is GM-only). Marking an action/bonus action
  used now broadcasts a table toast + log line like reactions always did.
- **GM-only Encounter Replay tool.** A "Replays" GM tab (`apps/client/src/replay/ReplayPanel.tsx`)
  lists archived encounters and steps through one turn by turn: the map with tokens exactly as
  they stood at each boundary (hidden combatants dashed + tagged), initiative with HP/conditions,
  and everything logged during that turn (GM-only lines tagged). Prev/Next/slider/auto-play +
  arrow keys; v2 archives get an "Aftermath" step from `finalState`. Data via the GM-gated
  `/api/v1/encounters` endpoints — players and the shared viewer can never reach it.

## Active work

- **Codex Phase 4 M9 — sessions, prep and recap (2026-07-29).** Delivers **CT-1, CT-2, CT-3** and
  **CP-9's session half** — the milestone the owner called the key part. M10–M12 remain.
  - **The session is a record.** Migration **v13** adds `codex_sessions` (two-layer: `prep_body` GM-only,
    `recap_body` player-facing behind `revealed`) plus `codex_meta.active_session_id`. The active pointer
    lives on the one-row meta table so "exactly one active session" is *structural* — a flag column on
    `codex_sessions` would have made it a convention every write has to remember.
  - **No backfill, by owner decision.** Legacy `codex_journal.session_number` integers keep grouping
    entries exactly as before; a numbered group gains a real record only when the GM creates one, at which
    point the existing entries join it with nothing rewritten. Proven on a genuine v12 database built from
    the shipped migration SQL and filled with legacy rows.
  - **Auto-linking delivers CT-1's "automatic".** With a session active, `createEntry` and
    `appendCombatEntry` default to its number; an explicit value always wins, including an explicit
    `null`; with nothing active the behaviour is byte-for-byte pre-M9. This is also CP-9's session half —
    combat entries hardcoded `sessionNumber: null` before, which is why that half was undeliverable until
    sessions existed.
  - **Viewer safety is structural on the client, not procedural.** `CampaignSession` — the type
    `CampaignHome` accepts — is exactly the player projection's four keys, with deliberately no `prep`
    field even as an optional. The dashboard is rendered by both audiences, so a type that *could* carry
    prep would put it one careless spread from the player. Verified live against a running server with a
    real player token: the player receives exactly `id,realDate,recap,sessionNumber`; prep, attendees, an
    unrevealed session and `activeSessionId` are all absent; a direct GET of an unrevealed session is 404.
  - **CT-3's badge cannot use `updatedAt`, and the spec's assumption that it could was wrong in both
    directions.** `setSessionRevealed` deliberately does not move `updated_at` (CI-9), so the one event the
    badge exists for would never fire it; and `updated_at` *does* move on prep edits, so it would announce
    GM activity a player must not infer. The badge counts revealed sessions this reader has not opened,
    keyed by id — already in the projection, nothing new exposed.
  - **A defect only the browser pass could find.** The dashboard card was headed "Next session" for both
    audiences, but a player only ever sees a *revealed* recap — by definition a session already played —
    so their card announced the last game as the next one. Every test passed, because they asserted the
    string they were written against. The player's copy now reads "Latest recap".
  - **Adversarial review found two more.** Sessions were absent from `exportBundle`, so a GM backup
    silently dropped every session — worse here than for any other record type, because `prepBody` exists
    nowhere else in the codex and the backup was its only copy. And a viewer-safety test asserted the
    absence of a prep string that was *unreachable* from the render it guarded; it would have passed with
    `{session.prepBody}` rendered verbatim. Both fixed and mutation-proven.
  - **New: a route↔contract mount test the Codex has never had** — and the homebrew one it was to be
    copied from is **vacuous**. That test treats the router's headers as proof a path is mounted; measured,
    `GET /completely/unrelated/path` returns 404 carrying both `x-request-id` and `cache-control: no-store`,
    because `router.use(...)` is declared with no path and the router mounts bare. The Codex version reads
    Express's real route table and checks methods as well as paths — PATCH→PUT fails only the method
    assertion, which is the case a path check structurally cannot catch.
  - **`Drawer` is a new `@vtt/ui` primitive** (R9), non-modal by construction: an `<aside>`, never
    `<dialog>.showModal()`, so the console is usable alongside the mode behind it, and Escape closes it
    only from inside. First consumer of the previously unused `--ease-drawer` token.
  - **Recorded scope stretch (2 areas outside the Owns list):** `@vtt/ui` + `/styleguide` for `Drawer`
    (R9 requires it; the Owns list omitted it), and `apps/client/src/main.tsx` for CT-3's badge, which sits
    on the player's "Open Codex" button outside the Codex entirely.
  - **Corrections to the M9 contract during integration:** the reveal field is `revealedToPlayers`,
    matching every other record type; `status` carries a `CHECK` like every comparable v1 enum; a duplicate
    `sessionNumber` is a 400, not a 409.
  - **Open, awaiting the owner:** auto-linking publishes the *active* session's number to players even when
    that session is unrevealed (see `known-bugs.md`).
  - **Verified.** `check` / `test` / `build` all exit 0; **1232 passed + 1 skipped** (baseline 1196 — see
    the correction below). Browser pass at 1440px and 375px against a **populated** database: 0 sub-floor
    controls across Pages (65 controls), the session full view (64) and the open console drawer, and no
    real horizontal scroll on any of them.

- **Corrections to earlier ledger claims (2026-07-29).**
  - **The M8 handoff and this file both say "1206 tests". The real number was 1196 passed + 1 skipped.**
    The handoff's own per-workspace breakdown (89/834/36/80/108/19/18/12) sums to 1196; every component
    figure is right and only the total is wrong.
  - **`scrollWidth` is not a valid horizontal-overflow test in this app.** A closed `Menu` panel is still
    laid out off-screen, so `document.documentElement.scrollWidth` reads 734 on a 375px viewport while
    `window.scrollTo(900, 0)` leaves `scrollX` at 0 — nothing is cut off and nothing scrolls. Any overflow
    figure measured by scrollWidth alone should be re-measured by whether `scrollX` can actually move.

- **Codex Phase 4 M8 — chronicle unification (2026-07-28).** Delivers **CT-11, CT-12**. First Phase 4
  milestone; M9–M12 remain, see `docs/product/codex-phase4-handoff.md`.
  - **One timeline.** Migration **v12** gives `codex_pages` the same five dating columns `codex_journal`
    carries, so a dated `event` page joins the chronicle. Additive, no backfill: existing rows are NULL =
    undated = today's behaviour. `GET /codex/timeline` returns entries, combats and events as one list.
  - **Dating reuses the existing contract rather than inventing a second.** `createPage`/`updatePage` call
    the same private `resolveDate` a journal entry goes through — raw date is the source of truth,
    `calendarInstant` is derived. The columns are named identically so `setCalendar` reflows both from one
    rule, keyed on `in_world_year IS NOT NULL` rather than `entity_type = 'event'`, so a page promoted to
    an event later arrives with a current instant.
  - **K3 (calendar reflow) proven non-destructive at three layers**: a store test, an HTTP test through
    `PUT /codex/calendar`, and a live round-trip on the populated dev DB — calendar swapped 12×30 → 2×100
    and back, raw dates byte-identical through both edits, derived values restored exactly. A month index
    clamped under the 2-month calendar and returned intact *because* the raw month was never rewritten.
  - **Viewer safety by delegation, not restatement.** `projectPlayerChronicleRecord` calls
    `projectPlayerJournalEntry` and `projectPlayerPage` rather than re-deriving their gates — the M7
    `projectPlayerPageMarker` precedent. A hand-rolled check passes the same tests today and drifts the
    moment either underlying projection tightens. **I re-verified this myself**: breaking the event arm
    fails 3 tests, at the HTTP boundary *and* at the projection layer directly.
  - **Mutation testing found a real gap again.** "The editor sends a date on every page type" initially
    killed **nothing** — 84 tests passed. Three `PageEditor` dating tests were added and it now fails. That
    mutation would have silently un-dated any event demoted to a note and then edited.
  - **`when` was relabelled, not removed** — "When, in prose". Dropping the key would delete every existing
    event's text on its next save, because the server prunes to the type's key set (K7).
  - **Recorded scope stretch (2 files outside the Owns list):** `hourglass` was the journal-entry glyph in
    `CampaignHome`/`SearchResults` *and* CT-11 makes it the event-page glyph, so one glyph meant two things
    on adjacent surfaces. Journal entries now use `scroll`. Revert if M8 should stay strictly inside its
    files.
  - **CT-12's lens toggle is GM-only.** Grouping by in-world year needs `calendarInstant`, which the player
    projection deliberately does not carry; widening a player projection to power a GM feature was the
    wrong trade. Players get the unified rows in the server's canonical order. **Open question for the
    owner if CT-12 was meant to reach the player reader.**
  - **Verified.** `check` / `test` / `build` all exit 0; **1206 tests** (web 89, server 834). Browser pass at
    1440px and 375px: correct year and session groupings, every row carrying glyph *and* word (R2), zero
    overflow, 0 controls under 44px on the Journal, player Codex showing exactly the 2 revealed records with
    0 leaks of 4 GM strings.
  - **Pre-existing, flagged not fixed:** `.codex-title-input` and `.codex-banner-add` are sub-floor in the
    page editor — outside what `scripts/tap-audit.mjs` walks, since it never opens an editor.

- **Codex suite overhaul — Stage Six final QA and Stage Seven remediation (2026-07-28).** Three
  independent adversarial reviewers over the whole delivered programme, then remediation. M1–M7 complete.
  - **Viewer safety: no confirmed leak.** The audit independently re-derived every gate and confirmed
    `projectPlayerSearchHit` re-derives reveal state from a *fresh* store read rather than the FTS row, so
    each layer is correct alone. It also verified the M6 masking trap was found and closed. Its one flagged
    item — the world calendar being readable by any authenticated role — is now an explicit decision
    (decision-log) rather than an implicit one.
  - **Requirements: all 32 in-scope IDs implemented**, nothing from M8–M12 leaked in (checked at the
    migration, route and UI layers). It found a real Definition-of-Done miss: **M7 had no `current-state.md`
    or `decision-log.md` entry**, though its own plan required both — so the two docs CLAUDE.md tells every
    session to read first said the programme stopped at M6. Both written.
  - **A-3's evidence was unverifiable by anyone but me**, because the audit ran from a throwaway scratchpad
    script. It is now `scripts/tap-audit.mjs`, outside `npm test` (it needs a browser and a dev server) with
    `playwright-core` kept out of the repo's dependencies.
  - **Committing that tool immediately paid for itself, and then indicted my own earlier numbers.** Against a
    *populated* database it found **14 controls below the floor where I had measured zero** — notebook
    folder rows and their four action buttons (M5 fixed page rows; the test DB had no folders), the atlas
    breadcrumb (no nested maps existed), and graph nodes. The QA pass found 3 more I had missed
    (`.codex-descend-chip`, which only renders with 2+ maps). **My measurements were never wrong; their
    coverage was.** That is the argument for committing the tool rather than the number.
  - **The reviewer then found two bugs in that tool.** It called `scrollIntoView()` inside a *synchronous*
    evaluate while `scroll-behavior: smooth` is set globally, so scrolled readings were stale; and its steal
    predicate was arithmetically incapable of being right, since a correct 44px control can only walk to 43.
    Fixed: Journal's phantom "20 taps stolen" → 2, Pages' 26 → 0. **A-3's actual number was never affected**
    by either bug — it comes from `max(rect, ::after)` with no scrolling.
  - **Fixed.** The New menu overflowed a phone by 97px (375 → 472); clamped in the primitive, now 375 → 375
    and 320 → 320 with desktop byte-identical. Light-theme `--cyan-hi` was failing AA everywhere it is used
    as text — a **convention inversion** (`-hi` is the lighter twin on dark, must be the deeper twin on
    light, as `--violet-hi` already does), so the "Shown" reveal badge read 2.48:1; now 5.41:1. Search now
    ranks the record *named* for the query first (`Strahd` was returning third, and the palette landed on the
    wrong page). Search debounced 6 requests → 1. Folder actions collapsed from four sub-floor buttons into
    one `Menu`. Mode bar gained a scroll affordance for its hidden fifth tab. An emoji UI glyph replaced.
  - **Result: 0 sub-floor controls in Pages, Campaign, Atlas and Journal**, verified independently after
    remediation. The Graph's 3 remain by design (see `known-bugs.md`).
  - **Held for the owner, with measurements rather than opinions:** `--text-muted` fails AA on nearly every
    surface in every theme across 207 usages, and fixing it collapses the three-tier text ramp;
    `--magenta-hi`/`--danger-hi` share the same inversion the cyan fix corrected. Both are design decisions,
    not remediation edits.
  - **Verified.** `check` / `test` / `build` all exit 0; **1169 tests** (web 79, server 817). Corrected audit
    re-run against a populated database.

- **Codex overhaul M7 — return edges, the Campaign dashboard, a Graph that tells the truth (2026-07-28).**
  Delivers **CI-3…CI-9**. This is the milestone that kills the star topology the assessment named as root
  cause 3 ("a shell but not a system": every jump led *into* Pages and nothing led back out).
  - **Three return edges, one mechanism.** From an open page: *In the journal* (CI-3, rows openable),
    *On the atlas* (CI-4, via the new reverse lookup), *Show in graph* (CI-5) — grouped as one
    **Connections** section in the editor's context rail rather than three scattered buttons. Every jump
    reuses the destination-side latch that already existed (`openEntryId`, `openTarget`, and a new
    `focusPageId` shaped like them). Three edges landing at once is exactly where parallel paths get
    introduced; none were.
  - **CI-4 `GET /codex/pages/:id/markers`** — a new *player-reachable* read, which the plan flagged as the
    milestone's main risk. Both gates are copied, not invented: the router 404s an unrevealed page before
    any pin is considered, and the projection applies CD-6's map gate before delegating to
    `projectPlayerMarker`.
  - **CI-8 `GET /codex/links`** — the whole-graph wiki-link feed. Two clauses, both required:
    player-layer only, AND both endpoints revealed. Layer alone leaks GM-body links between two revealed
    pages; both-revealed alone leaks a hidden page's existence through a dangling edge.
  - **Deliberate single-gate design, and it is the direct answer to M6's lesson.** The store reads stay
    ungated and the projection is the only gate, so no test can pass because a second layer masked a
    broken first one. Two store tests assert that ungatedness, so a later "hardening" cannot quietly
    reintroduce the blind spot.
  - **CI-7 `World` → `Campaign`.** The rename swept both mode bars, the palette's goto target, the mode
    unions, 20 CSS selectors, the filename and the `WorldEntity` type. Deliberately *not* renamed, each
    judged: the atlas map **kind** `"world"` (a map scale and a server contract value), the in-world
    calendar vocabulary (server field names), the graph's `worldX`/`worldY` SVG coordinates, and prose
    about the fiction. There is no persisted mode value, so no migration was needed — checked, not assumed.
    The dashboard covers only data that exists today; **no placeholder panels** were built for quests,
    deadlines, party position or faction standing, which are Phase 4.
  - **CI-9 recency.** Reveal-toggle and folder-move no longer move `updated_at`; relationship edits now
    touch both endpoints. `rev` is deliberately *not* bumped for a relationship edit — that would 409 a GM
    mid-sentence on a page whose body nobody touched. Conflict detection and history are untouched.
  - **CI-8 auto-fit.** The frame was computed over connected nodes only, so an orphan sat outside the
    viewBox with an effective hit area of **zero**. It now frames every node.
  - **Latent bug found by the non-vacuity discipline, not by a test failing.** One mutation initially
    failed *nothing*, because the branch it targeted was dead: the both-bodies layer collapse silently
    depended on the order SQLite happened to return rows in. Fixed with an explicit `ORDER BY layer`.
  - **A disclosed trade-off I re-measured rather than relayed.** The implementer reported that framing
    orphans compresses a dense layout enough for M5's tap cap to bind, measuring two nodes at 28.7px. I
    seeded 5 nodes (3 orphans) and measured at 375px: **all 5 framed, all 44.7px**. Real mechanism,
    narrower impact; a framed 28.7px node still beats an unreachable one. Both numbers in `known-bugs.md`.
  - **Verified.** `check` / `test` / `build` all exit 0; **1153 tests** (web 70, server 810). Browser pass
    at 1440px and 375px: Campaign on both mode bars with no "World" surviving, palette goto renamed, all
    three return edges landing on the right mode *with the right selection*, wiki-links distinguishable
    without colour, zero overflow, zero console errors. Tap audit across all five renamed modes:
    **0 of 112 controls below 44px**.

- **Codex overhaul M6 — one search, tags everywhere (2026-07-28).** Delivers **CI-1, CI-2**.
  - **CI-2, server.** Migration **v10** gives `codex_maps`, `codex_markers` and `codex_journal` the same
    `tags_json` column pages carry — `NOT NULL DEFAULT '[]'`, so pre-existing rows backfill to an empty
    list and no read path handles NULL (K7). All three round-trip tags through create, update and HTTP,
    reusing the page path's `tags()` validator and `TagsSchema` rather than a second copy, so the 24-tag
    cap and slug rule cannot drift. Found by the new tests: `createEntry` accepted tags but never
    forwarded them to `insertEntry`, so journal tags were silently dropped on create.
  - **CI-2, client.** `TagInput` on the journal composer (which is also the edit surface), the marker
    inspector, and the atlas Map settings modal — all `max={24}`, none overriding `normalize`, since its
    default slugify **is** the server contract. Timeline cards gained a read-only tag row; tags were
    otherwise invisible until you opened Edit. Also fixed: the atlas error `Alert` sat *behind* the modal
    overlay, so a failed write inside Map settings was silent.
  - **CI-1, server.** Migration **v11** replaces the pages-only FTS pair with ONE unified index per
    audience carrying every record kind (decision log §1). Player visibility mirrors each kind's player
    *list* predicate and fails closed; **a marker needs its own reveal flag AND its map's**, which is
    CD-6 carried into search. Seven HTTP viewer-safety tests, each proven non-vacuous by the implementer;
    **I re-verified the CD-6 one independently** — breaking only the map-revealed half fails exactly that
    one test, so it is not riding on the pin's own flag.
  - **Page tags are now indexed too** — a deliberate widening of existing page search (decision log §4).
    Leaving pages out meant one search box answering a tag query differently depending on which record
    carried the tag. The v11 backfill carries page tags as well, so an upgraded database indexes pages
    identically to a freshly written one.
  - **Two agent claims did not survive checking.** (1) `npx tsc --noEmit -p apps/client` is **vacuous** —
    the root tsconfig is a solution file with `"files": []`; it reports nothing while real type errors
    exist. Use `tsconfig.app.json`. (`-p apps/server` has `include: ["src"]` and is real.) (2) A reported
    34px tap target on `TagInput`'s wrapped chip ✕ **could not be reproduced** — see `known-bugs.md`;
    logged rather than fixed, because the fix is in a shared primitive and would change Homebrew too.
  - **CI-1, client.** One result surface (`SearchResults.tsx`) rendered identically by the Pages rail, the
    command palette and the player Codex, so the three cannot drift. The palette's private `listPages`
    copy and title-substring filter are gone — that was a second search mechanism. Row: glyph · title ·
    `KIND · #tags`; **kind is a text label, so deleting every colour leaves the list readable** (R2).
    Marker hits carry `mapId` + `id` and open the map then select the pin, via an `openTarget`/
    `onOpenedTarget` latch following `ReplayPanel`'s precedent — with one deliberate deviation: the latch
    clears when the target goes null, so the *same* pin can be opened again from a later search.
  - **The independent server review found a real coverage hole, and it was right.** Player visibility is
    gated twice (SQL predicate + projection re-check). That is sound design but it hid a blind spot:
    **weakening the SQL marker arm alone left all 787 tests passing**, because the projection silently
    caught it — so the primary layer's correctness for 3 of 4 kinds rested entirely on the secondary one.
    I reproduced that, then added three store-level tests that call `searchAll` *below* the projection,
    and confirmed the CD-6 one now fails against the SQL-only break. Lesson: an HTTP-boundary test tells
    you the pipeline works, never that a given layer does.
  - Also from that review: the page-tag backfill was the one arm missing the `json_valid()` guard the
    other three carry — a malformed `tags_json` would have thrown mid-migration and failed server boot
    for *every* page rather than degrading for one; the journal backfill joined with a space where the
    live path uses a newline (inert to FTS5, but the migration claims verbatim carry-forward); and the
    shared `tags()` validator still said "A page may carry at most 24 tags" to map and marker callers.
  - **The superseded `results` list is deleted.** It existed for exactly one commit so the client could
    migrate without a flag-day; every caller now reads `hits`. Two lists answering one query is the
    parallel-mechanism problem this overhaul exists to remove, and the Codex has no external consumer.
  - **Browser verification (the agent could not run any).** Real end-to-end at **1440px and 375px**: a
    brand-new journal entry is found through the actual v11 index, its row carries a text kind label,
    clicking it lands on Journal with the entry focused, a page hit reads `CHARACTER`, result rows
    measure **71.2px** against the 44px floor, zero overflow, zero console errors. Full tap audit
    re-run: **0 of 109 controls below 44px** across all five modes.
  - **Verified.** `check` / `test` / `build` all exit 0; 1109 tests (client 25 → 46, server 775 → 790).
    `docs/api-reference.md` regenerated; the byte-identical contract test passes.

- **Codex overhaul M5 — mobile parity and the remaining confirmed defects (2026-07-28).** Delivers
  **CF-3, CF-4, CD-2, CD-3, CD-5, CD-6**, plus the M4 follow-ups above.
  - **A-3 met, and measured rather than inferred.** The spec had downgraded A-3 to a source-level check
    because `elementFromPoint` measurement "needs a browser runner the repo does not have". The repo
    still has none — the runner is scratchpad-only and **not committed** — so this is a stronger
    verification of the same bar, not a new repo capability. Baseline: **13 controls below 44px** across
    Pages/World/Graph (Atlas and Journal were already clean). After: **88 controls, zero below the floor**
    at both 375px and 1440px. Routes taken, per design-language §4: `.codex-tree-page`,
    `.codex-world-recentitem` and `.codex-graph-legenditem` grow their paint (route 1 — mandatory for a
    stacked list); `.codex-tree-page-move` and `.codex-tag-chip` grow only the area (route 2) with the
    gap budget respected (`--space-4` beside the tree title; the documented 32px-paint/`--space-3`
    pressable-chip precedent for tags).
  - **The graph nodes needed a third route that did not exist.** See decision log §4 — a transparent hit
    circle sized to 44px on screen, capped at half the nearest-neighbour distance. Two bugs found and
    fixed while verifying it: the first cut measured against `view.k` alone and ignored the viewBox fit
    scale (~0.32 on a phone), so a "44px" circle measured 14px; and a ResizeObserver-sampled fit scale
    can lag layout by a fraction of a pixel, which measured 43.7 against a 44 floor.
  - **No tap theft, proven functionally.** The geometric heuristic is unreliable (it flags compliant
    `@vtt/ui` tabs, and reports a false `reach = 0` for anything below the fold — confirmed by
    re-measuring scrolled into view, where it went 0 → 45). So it was proven by tapping: a tree row opens
    its page, its ⋯ opens the move picker, and adjacent tag chips each filter by their own tag.
  - **CF-4.** World, Journal and Graph had **no** narrow-viewport rules at all — they survived by
    flex/grid default. Two real defects, both in the Graph: the canvas is `flex: 1 1 auto` inside a
    container the shell stretches, so it ignored its own 62vh floor and measured **532px tall inside a
    360px landscape viewport** (1.5× the screen); and `.codex-graph-legend`'s `margin-left: auto` stranded
    the legend mid-row once the bar wrapped. Clamped and left-aligned at ≤760px. A first attempt also
    lowered the min-height and shrank the *portrait* canvas 508 → 361px — a regression on the common
    phone shape — so only the clamp was kept.
  - **CD-2 could not be built as specified**; see decision log §1–2 for the shared-table decision and the
    viewer-safety duplication it closes. Proven by an HTTP test that was **verified to fail** against the
    unpruned store.
  - **CD-5.** The "GM only" cue keyed off empty player text, so the ordinary case — an entry *with*
    player-facing prose that simply is not revealed — showed no cue at all. Now keyed off
    `revealedToPlayers`. Verified live: a note added from a page shows the cue immediately.
  - **CD-6.** A shown pin on a secret map is invisible to players and nothing said so. The inspector now
    warns and offers to reveal the map. The atlas fixture had no map to click, so this is pinned by five
    component tests instead — including the three quiet cases, because a warning that fires when nothing
    is wrong is noise. Three proven to fail with the warning removed.
  - **M5 follow-ups from independent review.** The reviewer found that the graph hit-circle fix **did not
    actually hold**, and it was right. `RelationshipGraph` returns early (Skeleton while loading, empty
    state with no nodes), so the `<svg>` often does not exist on the render that mounts it — and the
    `fitScale` observer was attached from a `useEffect(..., [])`, which ran once against a null ref,
    bailed, and never retried. `fitScale` stayed at its `1` default and every node's "44px" circle came
    out at the painted radius. **Reproduced at 14.8px** by switching to Graph while the pages fetch was
    still in flight, then fixed with a ref *callback* (which fires exactly when the element appears) and
    re-verified at 44.7px under the same race. Lesson worth keeping: my original browser check only ever
    reached the Graph *after* data had loaded, so it could not have caught this — measuring the happy
    path is not the same as measuring the floor.
    Also from that review: `.codex-rail-error` was dead CSS after the `Alert` swap (removed); the
    `.codex-world-recentitem` comment read as a claim about the current state rather than the
    pre-fix measurement (reworded); and CD-5 plus `pruneCodexFields`/`CODEX_SECRET_FIELD_KEYS` had no
    direct tests (added — 10 tests, and the CD-5 pair was proven to fail against the old check).
  - **Precision note on CD-3.** The corrected server 409 string is real hygiene for any other API
    consumer, but it does **not** reach the GM: `PageEditor` branches on `error.status === 409` and never
    reads `error.message`, and `SaveState` renders its own fixed copy. The GM-facing half of CD-3 was
    already done by M4's `SaveState` swap. Don't cite the server string as a user-facing fix.
  - **Verified.** `check` / `test` / `build` all exit 0. Client tests 14 → 22. All three themes cycled
    (dark/dusk/light computed colours correct); zero console errors; zero horizontal overflow in all five
    modes at 375px.

- **Codex overhaul M4 — the Codex stops being a parallel component vocabulary (2026-07-28).** Delivers
  **CF-1, CF-2, CF-6, CD-4, CD-7** — the direct fix for the assessment's root cause 1.
  - **A-2 met.** Codex `@vtt/ui` adoption went **12 → 19** primitives (Homebrew, the comparable surface,
    is 25; the remainder is domain-specific — `ChoiceCard`, `RowEditor`, `Stepper`, `NumberField`…).
    Swapped: `.codex-filter-chip` (built twice) → `Chip`; `.codex-template-menu` + `.codex-menu-scrim` →
    `Menu`/`MenuItem`; the local `SaveStatus` union + `statusLabel` → `SaveState`; the comma-separated
    tags `<Input>` → `TagInput`; two bespoke loading affordances → `Skeleton`; the local `Notice` → the
    app-majority `useToast` (6 other surfaces use it, only 2 used `Notice`).
  - **CORRECTION (independent review, same day).** This entry originally claimed "every hand-rolled
    equivalent is gone, verified by grep", including `<p className="codex-rail-error">` → `Alert`.
    **That claim was false.** The verifying grep checked five class names and never included
    `.codex-rail-error` or `.codex-inspector-hint`, so it could not have caught them: **seven** raw
    `<p role="alert">` paragraphs survived M4 (AtlasView, JournalView, PageTimeline, CalendarEditor,
    CodexWorkspace's `previewError`, MarkerInspector, RelationshipsPanel). All seven were converted in
    the M4 follow-up commit. Only the top-level shell error had actually become an `Alert`.
  - **A defect found by real browser verification, not by tests.** The server has **always** required slug
    tags (`codex-store.ts:382`), but the old client field only lowercased — so "sword coast" produced a
    tag the server rejected with a generic save failure. `TagInput`'s **default slugify is the server's
    contract**, so adopting it fixes a real bug. My first attempt overrode `normalize` to "preserve
    behaviour" and would have preserved the defect; the browser pass caught it because it is the only
    check that reaches the server.
  - **CF-2 (partly — see the correction below):** the shared error moved out of the Pages rail to the
    workspace level as an `Alert`, so a failed load is now visible in **every** mode (it was invisible in
    World, Atlas, Journal and Graph); both shells gained `Skeleton` loading rows.
  - **CORRECTION (independent review).** The *loading* half reached only the Pages/Lore rail. WorldHome,
    RelationshipGraph, AtlasView and JournalView each render their empty branch off `length === 0`, which
    is also the pre-fetch state — so a GM with a full campaign was still told "No entries yet" / "No
    entities yet" / "Chart your world" for one round-trip. That is precisely the bar M4 set for itself
    ("every mode shows a loading and an error state"). Closed in the follow-up: Atlas and Journal own
    their fetches so they own a `loading` flag; World and Graph render from props so they take one.
    Covered by three tests, two proven to fail with the guards removed.
  - **CF-6:** breakpoints now sit on the documented ladder — three panes are **earned** at
    `min-width: 850px` rather than lost at an off-ladder 900, and the calendar reflow moved 480 → 560.
  - **CD-4:** the Link button was removed (see decision log — reversible; real link support needs a
    URL-safety decision).
  - **Verified.** `test` / `check` / `build` all exit 0; counts unchanged (client 14, server 771, others
    identical). **The M3 characterization tests did their job** — they failed the moment `SaveState`
    changed the save-status DOM, and again when `useToast` required a `ToastProvider` the bare test render
    lacked. Both were corrected as *test* fixes (the save test is now stronger: it asserts the in-flight
    transition, because `SaveState` renders "Saved" for idle *and* saved). Browser pass at **1440px and
    390px**, 10/10 including Menu open + **Escape-to-close, which unit tests cannot see**, plus all three
    **themes cycled** (dark/dusk/light computed colours correct, light properly inverted), zero console
    errors, no overflow.
- **Codex overhaul M3 — the client finally has a test harness (2026-07-28).** Delivers **CF-5** and the
  rest of **CD-8**. This retires the programme's biggest structural risk: ~3,485 LOC of Codex React had
  **zero** automated coverage, which is why M1/M1b/M2 shipped on manual verification alone.
  - **Stack (owner-approved, M3's stated escalation condition).** Vitest + **jsdom** + Testing Library as
    devDeps on `@vtt/web`; `apps/client/vitest.config.ts` + `apps/client/test/setup.ts`. jsdom was chosen
    over happy-dom for DOM completeness, because the app's `Modal` uses native `<dialog>`/`showModal()`
    and the Codex leans on SVG.
  - **jsdom gaps this app actually hits** — probed directly, not assumed: `showModal`/`close`,
    `setPointerCapture`, `scrollIntoView`, `scrollTo`, `ResizeObserver`, `matchMedia`,
    `SVGSVGElement.getScreenCTM`. All shimmed in **test setup only, never product code**. `scrollTo`
    (used by the scrolling `Tabs` bar) did **not** appear in the upfront probe and surfaced only once real
    components rendered — the list is empirical, not exhaustive.
  - **Honest limits, recorded in `testing.md`:** a test passing under a shim is evidence about this app's
    *logic*, not about a browser. Anything depending on real layout or pointer geometry —
    `MapSurface` panning, `RelationshipGraph` hit-testing, the 44px touch floor — **cannot** be verified
    here and still needs a real-browser pass. The harness does not replace running the app.
  - **Coverage of CF-5's three named areas (14 client tests):** *two-layer secrecy* — `splitEntityFields`,
    the client half of the three-layer secret-field enforcement, including a sweep asserting every entity
    type with a secret field keeps it out of the player-facing map; *save/conflict path* —
    characterization tests pinning autosave, `expectedRev`, the 409 resync and the no-op case, written
    deliberately **before M4 refactors `PageEditor`** so a behaviour-preserving refactor can be proven so;
    *cross-mode navigation* — the shell's mode contract and the World→Pages filter handoff, so M7's
    return-edge work has something to regress against.
  - **CD-8 completed:** migrations **v8** (legacy single `page_id`/`scene_id` → one-element arrays, incl.
    null → `[]` not `[null]`) and **v9** (page folder paths → folder records, dedup, ignoring null/empty)
    now have row-level tests against simulated legacy databases. Only v7 had them before.
  - **Verified.** Full CI-order parity — `npm test` → `check` → `build`, **all exit 0**. Accurate
    per-workspace counts: web **14**, server **771**, content-srd **80**, rules-5e **108**,
    api-contract **36**, schemas **19**, dndbeyond-pdf **12**, domain **11**. Only web (new) and server
    (+2) changed, so **A-10 holds**. Production bundle confirmed free of test code. **Not verified
    locally: Node 24** — this container runs Node 22, so the Node-24 run is unproven until CI executes.
  - **Independent review → follow-ups fixed.** Verdict **accepted with follow-ups**, and it earned it by
    **mutation-testing the tests** in a detached worktree: nine mutations (dropping `expectedRev`,
    collapsing the 409 branch, killing the debounce, neutralising the page filter, removing the
    `setMode("pages")` handoff, breaking `splitEntityFields`, two migration-SQL breaks) all **failed the
    suite**; the two survivors are genuine redundancy, not weak tests. It also proved **zero unmocked
    network calls**. Fixed from its findings:
    - **`@vtt/web` ran `vitest` without declaring it** — it resolved only by hoisting from another
      workspace. Now pinned as a devDep like every other test workspace.
    - **Three documentation inaccuracies of mine**, all corrected: `testing.md` claimed `setup.ts` shims
      `SVGSVGElement.getScreenCTM` (**it does not, deliberately** — faking a coordinate matrix would
      invent geometry rather than test it); it still said "No `vitest.config.*`"; and its workspace list
      omitted `@vtt/content-srd-5.2.1` (80 tests) — the same slip meant earlier reports attributed those
      80 tests to `api-contract`, which actually has 36.
    - **Two real limits were missing from the recorded list:** the `showModal` shim is `show()` semantics,
      so Modal focus-trap / Escape / click-outside are **unrepresentable** here; and no stylesheet loads,
      so anything CSS-dependent is invisible to these tests. Both now stated in `testing.md` and
      `setup.ts`.
- **Codex overhaul M2 — the combat bridge becomes findable (2026-07-28).** Delivers **CP-8**, **CP-9
  (location half)** and **CD-8**. The bridge was the assessment's sharpest evidence for "write-only":
  every auto-logged battle was hardcoded undated (`calendarInstant`/`inWorldDate` null) so it sank below
  every dated entry forever, and nothing ever read the `sourceEncounterId` it stored.
  - **CP-8:** `appendCombatEntry` now dates the fight at the calendar's **current in-world date**. With no
    current date set, `resolveDate(null, null)` preserves the old undated behaviour exactly. Entries stay
    **GM-only** per D-5.
  - **CP-9 (location half):** a combat entry offers **"Open replay"**, jumping to the Replays tab with that
    archive already open — in both the Journal timeline and the marker's journal readback built in M1.
  - **Plan deviations (both make M2 SMALLER than planned).** The plan called for "a new GM-only route
    joining an entry to its archive summary" plus `packages/api-contract` changes. **Neither was needed:**
    `projectGmJournalEntry` already returns the whole row including `sourceEncounterId`, and the archive
    endpoints `ReplayPanel` already consumes serve the replay. So **no new route, no contract change**.
    Instead `ReplayPanel` took one additive optional prop (`openArchiveId`) — a file outside the plan's
    Owns list — and `onOpenReplay` threads down the same chain `onActivateScene` already uses.
  - **Verified live, end to end — the bridge had never been exercised for real.** Started and ended a real
    encounter through the API: the bridge wrote `kind=combat`, `sourceEncounterId=1`, and
    **`inWorldLabel="Sul, Alturiak 15, 1492 DR"` with a real sort instant** where before it was null.
    **K2 proven live:** after *revealing* that entry, the player payload carries only
    `createdAt/id/inWorldLabel/kind/realDate/sessionNumber/text` — **no `sourceEncounterId`** — so a player
    who can see the battle still cannot reach the GM-only replay. Backed by 3 new tests (dating, undated
    fallback, and the revealed-entry leak guard). `check` + `test` (**769**) + `build` green; browser at
    1440px and 390px: battle dated under "1492 DR" beside the Today marker, "Open replay" opens that
    archive's viewer (asserted on the active tab + scrubber, after a first loose assertion false-passed).
  - **Independent review → follow-ups fixed (same day).** Verdict **accepted with follow-ups**. It
    independently confirmed CP-8's undated fallback is load-bearing (`DEFAULT_CALENDAR` omits
    `currentDate`), that **K3 holds** (the `setCalendar` reflow re-derives from the raw y/m/d using the
    *same* `calendarInstantOf`/`formatInWorldDate` used at insert, so a calendar edit cannot corrupt or
    mis-sort a combat entry), that **K2's guard is structural** (the player projection builds a fresh
    seven-field object with no slot for `sourceEncounterId`), and that skipping the contract change was
    correct (`api-contract/src/index.ts:1426` already declares the field). Fixed:
    - **The new K2 test was flaky (~15%)** — it searched the payload for the literal `"42"`, but the
      entry's own uuid contains "42" about 15% of the time (measured: **15.12%** over 200k uuids). A flaky
      test in the viewer-safety suite is worse than none. Replaced with a **deterministic and strictly
      stronger** assertion on the exact projected key set, which now also fails if any new field is ever
      added to the player journal projection. 25 subsequent runs clean.
    - **`PageTimeline` rendered the same auto-logged battles with no "Open replay"** while
      `MarkerInspector` had one — a real CP-9 gap, since the bridge sets `attachPageId` too. Now
      consistent across all three surfaces.
    - **A latent unclosable-viewer trap** in `ReplayPanel`: a caller passing `openArchiveId` without
      `onOpenedArchive` would re-open on every Back. Now latched locally as well as caller-cleared.
    - **Decision log updated** with the D-5 auto-date/GM-only rationale and the K2 structural-guard rule,
      which the plan required and the first commit omitted.
  - **Pre-existing defect found, not fixed:** the replay *viewer* overflows ~99px at 390px. Measured both
    paths — the existing "▶ Watch" button produces the identical overflow — so it is not ours. Recorded in
    `known-bugs.md`; `ReplayPanel` is a combat-pillar surface outside this overhaul's scope.
- **Codex overhaul M1b — truthful GM preview of the player Codex (2026-07-28).** Delivers **CP-2**,
  split out of M1 by the Stage Four review. **The defect it exists to prevent:** `roleOf()` checks
  `authorizeGm` FIRST (`codex-http.ts:146-151`), so mounting `PlayerCodex` with the GM's own token would
  have returned **GM projections while claiming to be the player view** — positive but false assurance on
  the repo's hardest invariant. Implemented by mirroring the viewer's proven approach
  (`viewer-http.ts:149`): the server **mints a real, short-lived PLAYER principal** rather than flagging a
  role on the GM's session, so every read walks the same authorization and projection path a genuine
  player gets. `auth.issuePreviewPlayerSession()` (12h TTL, vs the 30-day default) + GM-only
  `POST /api/v1/codex/preview-session` + a "Preview as player" control in the Codex ops cluster opening
  the real `PlayerCodex` in a modal. **Minting registers no presence** — `presence.connect` happens on
  socket join — so no phantom player appears at the table.
  - **Contract kept in sync** (`.claude/rules/api-contract.md`): `CODEX_PATHS.previewSession` +
    operation + response schema in `@vtt/api-contract`, `docs/api-reference.md` regenerated,
    `docs/app-map.md` 155→**156 HTTP paths**. The in-app reference panel groups by `/api/v1/codex` prefix,
    so no `GROUPS` entry was needed. One named entry added to the contract test's explicit
    secret-shaped-property allowlist (`CodexPreviewSessionData.token`) — the guard itself is unchanged.
  - **Verified.** `check` + `test` (**766**, +1) + `build` green. New HTTP-boundary test asserts the
    preview payload is **byte-identical** (`toEqual`) to a real player session's for both the page list and
    a single page, carries no `gmBody`, 404s an unrevealed page, and that the **GM token is NOT
    interchangeable** with it (`gmPage).not.toEqual(previewPage)`) — guarding the exact regression.
    Live: the minted token decodes to `role: "player"`, returns **zero** hits for GM-only words while the
    GM token sees the secret page. Browser at 1440px and 390px: modal opens, shows the real player tab set
    (**Lore**, not Pages), shows the revealed page, leaks neither the GM body nor the unrevealed page, no
    overflow, no console errors.
- **Codex overhaul M1 — unreachable capabilities + journal data loss (2026-07-28, branch
  `claude/codex-suite-overhaul-nyeqg0`).** First implementation milestone of the programme specified in
  `docs/product/codex-suite-plan.md`. **Requirements delivered: CP-1, CP-3, CP-4, CP-5, CP-6, CP-7, CD-1.**
  - **CD-1 (high — silent data loss) fixed.** Composing a new journal entry and then clicking Edit on an
    existing one destroyed the draft *and* deleted its sessionStorage backup (the guard `if (editingId ||
    isEmpty) removeItem(...)` fired the moment `editingId` went truthy). `JournalView` now **stashes** the
    in-progress new entry, keeps backing it up while the composer is borrowed, tells the GM it is kept, and
    restores it on Cancel or after the edit is saved.
  - **CP-1 player search wired.** `playerCodexApi.search` had 0 callers against a route that was already
    dual-role and viewer-safe; the player Lore rail now has a search box that overlays results.
  - **CP-3 marker journal readback.** `MarkerInspector` shows the pin's entries via `journalApi.forMarker`
    (0 callers before) — the marker-side counterpart of `PageTimeline`. Gives the combat-history bridge its
    first read path. Uses `revealedToPlayers` for the GM-only cue (deliberately **not** repeating CD-5's
    `!playerText.trim()` mistake, which is still open in `PageTimeline` and scheduled for M5).
  - **CP-4/CP-5 map rename, retype and re-parent**, via a new **Map settings** modal (`atlasApi.updateMap`
    and `setMapParent`, both 0 callers before). A map's name and kind were frozen at creation, permanently.
    The "sits inside" list excludes the map's own descendants so the choice can't propose a cycle.
  - **CP-6 multiple root maps.** The new-map picker gained a "Nest inside …" switch; turning it off creates a
    second root. The atlas was practically single-root even though the model supports a forest.
  - **CP-7 marker → actor link** surfaced as a `Select`, mirroring the existing scene-link pattern. Needed
    `actors` threaded `main.tsx` → `CodexWorkspace` → `AtlasView` → `MarkerInspector`, exactly as `scenes`
    already was — so **no new component was required** (the risk the plan flagged did not materialise).
  - **Verified for real.** `check` + `test` (**765** server tests, baseline unchanged) + `build` all green.
    Live Chromium pass against the running app at **1440px and 390px**: 14/14 assertions, zero console
    errors, no horizontal overflow. Rename round-tripped through the API and back into the breadcrumb.
    **Viewer safety proved at the HTTP boundary three ways** — a player search finds revealed player-facing
    text ("kindly" → hit), cannot find a GM-only body word on a *revealed* page ("ZZQQXX" → 0 hits, GM gets
    2), and cannot find an unrevealed page at all ("Strahd" → 0 hits).
  - **A-1 acceptance criterion met:** the `codex/api.ts` call-site sweep now reports **zero** client API
    methods with no callers (was five).
  - **Independent review + follow-up fixes (same day).** A fresh-context reviewer checked M1 against the
    spec, plan, acceptance criteria and the diff. Verdict: **accepted with follow-ups**; it independently
    re-confirmed CD-1 across all seven draft-loss paths, re-swept A-1 (48 methods, zero unreachable),
    and confirmed viewer safety and that no M4/M5 work was pulled forward. It found **one major defect the
    implementer's own browser pass had missed**: CP-6 created a second root map but nothing could *navigate
    back to it* — `loadMeta` defaults to `nextMaps[0]`, the breadcrumb only climbs one chain, drill chips
    only descend, and `CodexWorkspace` unmounts `AtlasView` on every mode change, so a second root vanished
    after one tab switch (same gap in the player atlas). The original verification asserted the *toggle
    existed*, not that the map it created was reachable — a shallow check. Fixed by a **"Top level" chip
    row** (shown when more than one root exists, reusing the drill-chip pattern; current root marked on the
    edge per design-language §5) in both `AtlasView` and `PlayerCodex`. Also fixed: a dangling `actorId`
    rendered as "— none —" while the id persisted (now offers to clear it, matching the scene-link
    behaviour), and a typed map rename was discarded when the settings modal was dismissed with Escape.
    Re-verified live at 1440px and 390px on a three-root atlas: every root listed, reachable, and **still
    reachable after leaving and re-entering the Atlas**; drill-down unaffected; no overflow; no console
    errors. `check` + `test` (765) + `build` green; A-1 still holds.
  - **Deviation from the milestone plan (recorded).** The plan's Owns list named 4 files and "server: none".
    Server: none held. Files were **7** — the four plus `CodexWorkspace.tsx` + `main.tsx` (the `actors` prop
    chain for CP-7) and `codex.css` (two layout classes). No server, contract or projection changes.

- **Codex suite overhaul — Stage One assessment complete (2026-07-28, branch
  `claude/codex-suite-overhaul-nyeqg0`).** A current-state assessment of the whole Codex suite
  (World · Pages · Atlas · Journal · Graph) is **`docs/product/codex-suite-assessment.md`** — the
  single source of truth for this programme; do not restate its contents here. Investigation only:
  **no product code changed**, baseline recorded green (`check`/`test`/`build` all exit 0, 49 Codex
  server tests). Three root causes evidenced: the Codex is a **parallel component vocabulary**
  (12 shared `@vtt/ui` primitives vs 24 in the comparable Homebrew surface, with `SaveState`/`Chip`/
  `Menu`/`TagInput`/`Skeleton`/`Alert` each hand-rolled); **five capabilities are fully built with
  zero UI callers** (player search, `journalApi.forMarker`, `atlasApi.updateMap`/`setMapParent`,
  marker `actorId`) plus a write-only combat-history bridge; and the five areas **share a shell but
  not a system** (navigation is a star into Pages with no return edges; tags/folders/search are
  pages-only). Eight confirmed defects are tabled there, the most serious being **journal draft data
  loss** (`JournalView.tsx:52-58,76-84`). **Two facts that constrain any Codex work:**
  `apps/client` and `packages/ui` have **no test script**, and there is **no browser-test harness in
  the repo** — so ~3,485 LOC of Codex React has no automated regression protection, and ledger
  claims of "browser-verified" are not reproducible. Consequently, **treat this ledger as evidence of
  intent and history, not of current verified state** — at least one recorded "verified" claim
  (graph legend touch targets, line 266) is not borne out by the code. Awaiting Stage Two product
  discovery; 13 open product questions are listed in §8 of the assessment.
- **Character builder — Phase 1 foundation (2026-07-26, branch `claude/dndbeyond-sheet-importer-0k6u2e`).**
  The approved plan (16 discovery decisions + architecture principles) is `docs/task-packets/character-builder.md`:
  a guided wizard for **GM and player**, levels **1-20 with multiclass**, creation + level-up + respec, a
  configurable random generator, full page on desktop / full-screen sheet on mobile, server-held drafts that
  double as the pending-approval record, GM-gated ability methods, per-species name bundles, CC BY footer, and
  a 44px touch floor. **Phase 1 builds the foundation only — no wizard screens exist yet and no character can
  be created through a UI.** What landed:
  - **Content model** (`packages/content-srd-5.2.1/src/character-content.ts` + six seed bundles): reference
    schemas for classes / subclasses / species / backgrounds / feats / name pools, all built on ONE shared
    `FeatureRecord` whose riders reuse the real actor-side shapes (`ActionSchema.omit({attack,save})`,
    `EffectGrantSchema`) rather than clones. Every record carries `source: "srd" | "homebrew"`; identity ids
    stay open slugs. `ClassReference` enforces a 20-row level table and feature-id resolution via `superRefine`.
    Seeds: Fighter + Wizard (full 20-row tables), Champion + Evoker, Human + Elf, Soldier + Sage, 4 feats,
    2 name pools — **transcription of the remaining 10 classes / 10 subclasses / 7 species / 2 backgrounds /
    ~16 feats is Phase 2 and 5 work.**
  - **Schema deltas** (additive-optional, `schemaVersion` unchanged, JSON mirror in lockstep with an Ajv
    back-compat proof): `character.choices[]` provenance ledger, per-class `hitDie`, per-class
    `spellcasting.classes[]`, armor/weapon/tool/language proficiencies, weapon `properties`. `Actor.hitDice`
    became a **normalising pool** — a Zod preprocess accepts the legacy single object, a bare array, or
    `entries[]`, keeping `die`/`maximum`/`remaining` as a derived summary recomputed on every parse, so
    existing single-object readers get the correct multiclass total with no client edit.
  - **Rules math** (`packages/rules-5e`): ability generation (standard array, point-buy costs, `4d6kh3`, GM
    custom formula), **class stat-priority tables as data**, HP per level incl. `max(roll, average)`, spell
    slots for single-class and multiclass caster level, ASI levels, multiclass prerequisites.
  - **UI primitives** (`@vtt/ui`, all demoed in `/styleguide`): `WizardShell`, `ChoiceCard`, `ChoiceGrid`,
    `AbilityScoreAllocator`, `DiceInputRow`, `NameField`, `FeatureList`, `ReviewSummary`, `Modal size="full"`,
    plus a documented **44px touch floor**.
  - **API**: the socket-only debt repaid (`character.submit-import`/`resolve-import` now on both transports)
    and six content catalogs shipped on both transports from day one, player-readable, each returning CC BY
    attribution. A new guard test scrapes every `socket.on(...)` in `apps/server/src/*.ts` and requires each
    event to resolve to a declared scope or a documented HTTP read — closing the structural hole that let the
    original debt through — plus an Ajv guard validating served content payloads against the OpenAPI document.
  - **Verified:** `check` clean across all workspaces, **689 tests passing** (server 523, rules-5e 85, content
    36, api-contract 17, schemas 15, pdf 13), client build green. Three adversarial QA passes (UI/style-guide,
    core-functionality, requirements-compliance) ran against it; six major correctness bugs and eight major
    UI/UX findings were fixed, each with a regression test proven to bite by reverting the fix first.
  - **Not yet built / gating Phase 2:** see `known-bugs.md` — the `fromCatalog` resolver, the GM ability-method
    setting, the dropped class/species/background wire fields, the bundle→rules adapter, the feature-rider
    interpreter, and `GameState.characterDrafts[]`.
- **D&D Beyond PDF importer — Phase 1.5 (2026-07-26, branch `claude/dndbeyond-sheet-importer-0k6u2e`).**
  A GM imports a D&D Beyond **PDF export** from the roster ("Import from D&D Beyond (PDF)", beside the JSON
  import). The DDB 2024 sheet is a **named AcroForm**, so extraction is a deterministic field-name → schema
  mapping in a new **`packages/dndbeyond-pdf`** (`pdfjs-dist`, Apache-2.0): widgets → a draft
  `actor-character` definition validated against the real `ActorDefinitionSchema`, then a **review modal**
  (editable name/AC/HP/speed + warnings) whose confirm reuses the existing `actor:import-definition` command
  (no new server surface; the server still re-validates). Extraction is **client-side/in-browser** — the PDF
  never leaves the device (amends ADR-0018's server-worker proposal; pdfjs worker bundled locally, no CDN).
  Recovers identity/classes, abilities, AC/HP/speed/init/PB, save+skill proficiencies (incl. expertise),
  spellcasting (ability/DC/slots/pact/spells with prepared+level), weapons→actions, and inventory;
  **flag-and-degrades** on ambiguity (>4-class multiclass caps to 4 + warns; non-caster → no spellcasting).
  **Verified:** `packages/dndbeyond-pdf` **11 vitest golden tests** over 6 sanitized widget fixtures (all
  validate against the real schema; source PDFs gitignored), monorepo `check` green, client `build` green
  (worker emits as a local asset). GM-initiated in v1. **Pending:** a live GM/mobile browser smoke (no e2e
  harness in-repo). Deferred: player-upload + GM approval, the 2014 layout, OCR, the DDB JSON on-ramp.
- **Player-driven combat + unified dice input (2026-07-24, branch
  `claude/character-sheet-combat-3uwp2t`).** Finishes the specced-but-lighter "Slice 2" of
  `docs/product/character-sheet-initiative.md`: players now run their own combat rolls, and the
  character sheet's manual/auto dice toggle is one consistent per-browser experience everywhere.
  **Server:** `action:resolve` is un-gated for a player's own claimed character via the existing
  `canInitiateForActor` seam (rolls attribute to the player; hidden/gm-only actors stay GM-only;
  area templates / cover / rules overrides remain GM-only). Damage stays server-authoritative under a
  **GM-controlled per-table policy** `combat.playerDamageMode` (`proposal` default | `direct`): a
  player hit parks a GM-only `combat.pendingDamage` proposal the GM applies with one tap
  (`damage:resolve`), or — when the GM opts in — auto-applies server-side (GM-scoped, so the player
  never mutates a non-owned creature; ADR-0021 #4 holds). Pure `player-damage.ts`
  (`settlePlayerHit`/`resolvePendingDamage`) carries the logic; both new commands walk the full
  pipeline (domain → zod → api-contract/OpenAPI → operation+registry → socket + HTTP). **Client:** the
  read-only `PlayerActionList` is replaced by an interactive `PlayerActionRunner` under the player's
  own initiative row on their turn — tap a weapon/save action, pick target(s), preview the d20
  (Adv/Disadv or a typed die), confirm; the hit shows "Handed to the GM" or "Applied" per policy. It
  reuses the shared `targeting.ts` store and the GM runner's styles, and sources actions from the
  player's own on-the-wire `definition` (no GM-only fetch). The GM sees `PendingDamagePrompt`s beside
  the save/reaction prompts plus a "Players' hits" GM-confirms/direct toggle. **Sheet attacks:** a
  player's stat-block attacks also resolve from their OPEN sheet on their turn via a per-browser
  `sheetAttackMode` — `inline` mounts the same `PlayerActionRunner` in the sheet's Actions section, or
  `jump` hops to the initiative view to pick/confirm and jumps back once the attack commits.
  **Player-rolled initiative:** an opt-in `encounter:start { playersRollInitiative }` parks claimed PCs
  on `combat.pendingInitiative` (seeded with a provisional auto-roll so order stays valid); each player
  rolls their own via `initiative:roll-self` (die+modifier or a typed natural), and a GM
  `combat.playerInitiativeMode` picks start-now vs wait-for-all (`initiative:roll-remaining` covers
  stragglers). **Dice unification:** a new per-browser `dice/roll-preference.ts` store (backed by the
  sheet's existing localStorage keys) drives auto-vs-manual on every surface — sheet, saves, death
  saves, reactions, attacks, the runner, and the GM's ActionRunner — with the toggle mirrored in the
  DicePanel; the table-wide GM roll-mode UI is retired (the `combat.rollMode` field/command are left
  inert). `check`+`build` green all workspaces; **server suite 447** (adds player-damage settlement, a
  pendingDamage projection-leak test, and player-rolled-initiative coverage); api-reference + app-map
  regenerated. **Deferred (documented follow-up):** a live browser/mobile smoke (no e2e harness in-repo).
  **Post-testing fixes (2026-07-24):** (1) the player-initiative prompt was buried on the player's own
  initiative row (invisible on the "My sheet" view or when scrolled off) — it's now a prominent
  view-independent banner at the top of the player panel; server seeding/projection were already correct.
  (2) attacks tapped from a sheet surface OUTSIDE the on-turn runner (an equipped-weapon chip, or casting
  an attack spell from the Spells tab) fired a bare die with no target — they now route through one shared
  `routeAttack()` seam to the same `action:resolve` (weapons matched to a stat-block action by name, attack
  spells by their linked `actionId` after the slot is spent); inventory-only weapons and save/AoE spells,
  which have no single server action to resolve, intentionally stay loose.
  **Follow-up round (2026-07-24):** (3) a client version-skew guard — a missing newly-added GM field
  (`pendingDamage`/`pendingInitiative`) no longer white-screens the whole table (`?? []` at the reads);
  the real fix is restarting a stale server, which the schema/spreads already keep correct. (4) structured
  attacks now resolve from ANY sheet surface (standalone tab, roster, map), deriving the combat context
  from the player's own view `state` and forcing the inline picker where there's no initiative view to jump
  to; the "Cast" button routes EVERY creature-targeting spell (attack/save/damage), not just attack spells.
  (5) a player's manual attack entry now honors the same auto/total bonus toggle as every roll surface, and
  "final total" mode adds a **Natural 20 checkbox** (a crit can't be inferred from a hand-computed total) —
  `action:resolve` gained `attackTotal` + `critical` (contract regen; server compares the total to AC and
  owns the crit doubling). `check`+`build`+`test` green; **server suite 448**.
- **Player character sheets — Phase 1 initiative (2026-07-23, PR #45, branch
  `claude/character-sheet-discovery-a14i7f`).** The player-facing half of the app: an interactive
  character sheet used at game night, architected **builder-ready** (the full guided builder is the
  next roadmap update). Approved roadmap + codebase orientation in
  `docs/product/character-sheet-initiative.md`; load-bearing decisions in `decision-log.md`
  (2026-07-23). **Slice 0 (foundations) landed & verified:** (1) the SRD ability/proficiency/spell
  math is centralized in `packages/rules-5e/src/character.ts` (`abilityModifier`, `characterLevel`,
  `proficiencyBonusForLevel`, `saveBonus`, `skillBonus`, `spellSaveDc`, `spellAttackBonus`) and the
  four hand-rolled `floor((score-10)/2)` copies delegate to it (server `action-resolution`/
  `saving-throws`/`rests`, client `CharacterSheet`; the client gains `@vtt/rules-5e`) — no behavior
  change; (2) a generated **app map** (`npm run map` → `docs/app-map.md`: GameState shape, command
  catalog with scopes, HTTP paths, curated file index) via pure `renderAppMap()` with a
  byte-identical freshness test (`apps/server/test/app-map.test.ts`, mirroring the API-reference
  pattern), plus a new **`vtt-orientation`** skill. **Slice 1 (data model + read-only sheet)**
  then landed: additive `ActorDefinition` fields (`character`/`proficiencies`/`spellcasting`/
  `startingInventory`/`startingCurrency`, the "no-rewrite" selection contract) and live `Actor`
  fields (`spellSlots`/`pactSlots`/`preparedSpellIds`/`inventory`/`currency`, seeded in
  `instantiate()`); the JSON-Schema mirror kept in lockstep; the owner-only projection extended
  with a leak test proving a second player and the viewer never see another PC's
  slots/inventory/currency; the three seed PCs migrated; and `CharacterSheet.tsx` now renders
  identity/proficiencies/spells/inventory **read-only** (guarded, so monsters/imports are
  unchanged). `check`+`build`+`test` green (server 404, schemas 8); a live browser/mobile visual
  check is still pending (no e2e harness in-repo). **Slices 2–5 then landed** (all
  `check`+`build`+`test` green; server now 418 tests): **Slice 2** — players tap an
  ability/save/skill/attack on the sheet to roll it via `dice.roll`, plus the centralized
  `canInitiateForActor` authorization seam (damage stays GM-applied; a future per-table
  "players may initiate attacks" toggle is a one-field add). **Slice 3** —
  `character.set-slot`/`set-prepared` + long-rest slot/prepared restore + sheet slot
  steppers and prepared toggles. **Slice 4** — `character.set-inventory`/`set-currency` +
  inventory/currency editors + attunement soft-cap. **Slice 5** —
  `character.set-identity`/`set-proficiencies` (edit the per-PC `import-<actorId>` definition,
  re-validated) + sheet identity/proficiency editors, and **ADR-0021** reframing the
  "not a character builder" boundary (CLAUDE.md scope line updated). Every new command is
  player-allowed, owner-scoped, and flows through the shared operations layer + versioned
  OpenAPI (docs/api-reference + docs/app-map regenerated, freshness-tested). The Phase-1
  **interactive play sheet is feature-complete**; the full guided builder (content +
  derivation + level-up) is the next roadmap update. **Still pending:** a live browser/mobile
  visual smoke (no Playwright/e2e harness in the repo yet).
  - **Sheet v2 iteration (2026-07-23, same PR)** from GM playtest feedback (tracked in
    `docs/archive/product/character-sheet-v2-feedback.md`). **Wave 1** (readability + interaction): spells
    grouped by level, all 18 skills listed with proficiency dots, the stale-definition edit bug
    fixed (owner definition rides the live prop and wins), spell slots restyled as clickable pips,
    and per-ability roll + "roll with proficiency" chips. **Equipment framework** (feedback #7,
    decision "full catalog + vendor SRD gear"): a unified `EquipmentReference` content model +
    a 132-entry hand-authored SRD gear bundle (ammunition / adventuring gear / tools / packs /
    focuses / consumables) folded with the weapon & armor tables into one **183-item catalog**
    (`loadEquipment`, sorted, uniform shape); served over a new **`content:equipment`** socket read
    (public SRD reference, like `content:spells`, with the CC-BY line); `InventoryItem` additively
    gains a homebrew-expressible `category` slug (JSON-Schema mirror in lockstep); and the sheet's
    Inventory gains a searchable, category-filtered **browse-and-add picker** (upsert-aware —
    picking an owned item increments its stack — mobile full-screen). `check`+`build`+`test` green
    (server 419, content 18, schemas 8); a runtime `ContentLibrary` smoke served the full 183-item
    catalog. The `wondrous` category is reserved for the homebrew update. **All nine v2 items then
    landed:** the **cast-at / upcasting picker** (#2 — per-spell slot-level dropdown that spends the
    chosen slot and auto-rolls the SRD upcast scaling; `ContentSpellSummary` gains
    `damageRoll`/`damageTypes`/`castingOptions`); **manual roll entry + auto/manual bonus mode** (#8 — a
    per-sheet Digital/Manual toggle that prompts for a physical die on every roll surface and encodes it
    into the `dice:roll` formula, no server change); and the **panel redesign** (#9 — the sheet became a
    two-subpanel workspace with the shared `DicePanel` log docked left/right, a **Pop out** to a
    moveable/resizable in-tab panel, a **New tab** button opening a standalone `/sheet.html` entry that
    rejoins with the persisted player token, and a mobile Sheet/Dice segmented control). Every wave is
    `check`+`build` clean (server 419 tests). **Still pending:** a live browser/mobile click-through of
    the workspace/popout/standalone-tab (no e2e harness in the repo).
  - **Sheet v3–v6 feedback + design-system compliance pass (2026-07-23, same PR).** Iterated the sheet
    over further GM playtest rounds (v3–v6 feedback docs), then ran a **full design-system compliance
    audit** of the sheet + its implementation and remediated it at *Pragmatic* scope: the clear-win
    controls now compose `@vtt/ui` primitives (`IconButton`/`Stepper`/`Button`/`SegmentedControl`, plus a
    `Meter tone="health"` HP bar and an attunement `Badge`), and the bespoke CSS is tokenized (both
    hardcoded colors removed — incl. the cast-`<select>` caret redrawn from `--text-dim` gradient halves;
    radii and the custom rem type scale snapped onto tokens, render-gated). The `ActorRoster` card buttons
    and the dice roll-card cluster were swept too. `SegmentedControl` gained backwards-compatible
    per-option `ariaLabel`/`title` for icon-only use (dock picker). The tuned matched-set cast cluster,
    prep tags, slot pips, dense roll chips, and cyan-active filter/toggle pills were **kept and
    tokenized** (screenshot-gated — the primitives would regress their tuned look). `check`+`build`+server
    `test` (422) green each phase, headless render-verified in light + dark. Record:
    `docs/archive/product/character-sheet-styleguide-audit.md`. **Still pending:** a live browser/mobile
    click-through (no e2e harness in the repo).
  - **Sheet open-consistency + Dice toggle (2026-07-24, same PR).** Three GM-reported follow-ups: (a)
    `IconButton`'s ✕ rode high — `.nh-iconbtn` now sets `line-height: 1` so the glyph centres (all icon
    buttons). (b) Opening a sheet from a **map token right-click** now has the shared dice log attached
    (`state` threaded through `EncounterMap`), so players can see rolls on the map. (c) The three entry
    points (top-row "View sheet", initiative "My sheet" toggle, map right-click) now render **identically**:
    the sheet always fills the panel at the normal lg modal width and the dice log **swaps in behind the
    header's Sheet/Dice toggle** (one pane at a time, every viewport) instead of docking beside the sheet.
    This **supersedes the v6 #9 side-by-side dock** above — the dock-picker (◧/◨), sheet/log drag-resize
    handles, and `--sheet-width`/`--log-width` machinery were removed (net −34 lines). `check`+`build`+
    server `test` (422) green; header + ✕ centring render-verified in light + dark.
- **Turn time-travel + persistent combat log (owner item #12)** — on branch
  `claude/pr34-work-6wg8n6`. The store keeps a turn-boundary snapshot at every advance in a
  new out-of-`GameState` `turn_snapshots` table (migration v3), written inside the command's
  transaction; `combat.historyCursor`/`historyDirty` (top-level combat only, never parked
  scenes) track the reviewed position and whether it changed. Previous rewinds the WHOLE table
  to the end state of the prior turn (combat + each actor's hp/conditions restored; rolls,
  claims, roster, scenes kept); Next steps forward undoing nothing until the return-point
  resumes live; a change made while rewound forces a GM confirm — Next rewrites history
  (truncating the undone future), Previous discards it in place. All navigation runs inside
  the store's serialized queue via `GameStore.executeTimeline`, so it can't race a command;
  `TimelineConfirmationRequired` bounces a command back with `needsConfirm` and burns no
  receipt. Lifecycle commands that would strand the timeline (`encounter:end`, `scene:activate`,
  `actor:remove`, player `turn:end`) reject while rewound; encounter start/end and scene
  switches truncate the timeline. A separate `CombatLogStore` (own SQLite table, capped ~1000)
  persists a role-filtered narrative feed (`log:entry`/`log:read`, GM-only lines never reach
  players); the GM view carries `turnHistory`, the player view a bare `rewound` flag (no
  labels). Client: GM Previous/Next confirm flow + review banner + contextual "Resume live
  play"; player "GM is reviewing" banner; a Combat log sidebar panel (module store, like the
  map toasts). Rolling turn-snapshot window is **250** boundaries. On `encounter:end` the fight
  auto-archives (turns + timestamped log) into a permanent, uncapped `encounter_archives` table
  (migration v4) atomically with the buffer truncation, exposed **GM-only** as machine-readable
  JSON (`GET/GET/DELETE /api/gm/encounters[/:id]`; shape in
  `apps/server/src/encounter-archive.ts`) for user-built integrations — the app never analyzes it.
  Also on this branch: three level-7 example PCs (full sheets in `state.definitions`), and an
  action-runner fix so a Multiattack/Extra Attack can be resolved repeatedly (list stays reachable
  + an "Again" button). `check`/`test` (270, incl. timeline + archive integration tests)/`build`
  green; production boot applies migrations 1–4; browser smokes render the combat-log panel and
  full PC sheets with no console errors.
- **Phase 2 testing-MVP vertical slice** is under active implementation; no phase exit gate
  claimed yet (see `README.md`, `BUILD_PLAN.md`).
- **SRD combat-content integration (phases A–G).** Phase A (content pipeline) done and
  audited: `packages/content-srd-5.2.1` carries vendored open5e `srd-2024` fixtures
  (CC BY 4.0) and cross-validated canonical bundles — 330 `ActorDefinition` monsters (423
  structured attacks), spells/weapons/armor/skills/damage-types/rules references,
  attribution (ADR-0015). Phase B done: GM browses the bestiary in encounter setup
  (`MonsterBrowser`), `actor:add-from-definition`/`actor:remove`/`content:monsters`
  commands instantiate/remove monsters with live HP and provenance (`Actor.definitionId`).
  Phase C done: server-authoritative HP tracking (damage/heal/temp/set commands, GM +
  own-character player scopes) with band-safe player projections (exact PC hp, monster
  bands). Phase D done: condition tracking (`Actor.conditions`, `actor:set-condition`,
  15 bundled SRD conditions with exhaustion levels, chips + pickers across GM/player
  surfaces — reference level per ADR-0008). Phase E done: turn economy (`combat.turn`
  action/bonus reset on turn change; per-combatant `reactionsUsed` refreshing at own turn
  start; `turn:use`/`turn:use-reaction`/`turn:end` — player End Turn gated to their own
  turn; hidden-turn economy stays opaque to players). Phase F done: `action:resolve` —
  the GM runs a stat-block combatant's actions from the Turn order (attack vs target AC
  with 2024 crit doubling, save-DC surfacing, typed damage), rolls recorded in the shared
  history (gm-only for hidden attackers), economy auto-marked, damage applied by explicit
  tap through the existing hp commands (Propose→Apply). Phase G done: `CharacterSheet`
  overlay — live HP/conditions over the full immutable stat block (abilities+saves, senses,
  languages, immunities, traits, actions, CC-BY line) via GM-gated `content:monster-sheet`;
  GM opens any combatant from the initiative, a player only their own (server-rejected
  otherwise; PC sheets stay thin until import). **All seven phases (A–G) of the SRD
  combat-content integration are complete on `claude/srd-content-pipeline`.** Plan reviewed with the owner 2026-07-17.
  Three follow-on slices then landed on the same branch: **token footprints** (large/huge/
  gargantuan tokens size to `Actor.sizeCells` and snap even/odd footprints on the correct
  cell/intersection — server owns the geometry, client preview mirrors it); **condition
  badges + viewer health/conditions** (bloodied/down dot and condition-initial badges on map
  tokens, plus coarse health band + condition labels in the viewer initiative/tokens — bands
  only, exact HP never leaves for the public screen); **PC sheet import** (GM imports a
  canonical `ActorDefinition` JSON as a claimable player-character; the stat block is stored
  in `GameState.definitions` and projected only to the owning player, `actor:import-definition`).
- **Cycle 4 remaining PRs** (the original plan is in the now-archived `docs/archive/NEXT-STEPS.md`):
  - **PR D** — configurable dock position + Initiative declutter **merged as PR #32**;
    gridless saveable/toggleable grid overlay (D-3) still open.
  - **PR E** — multi-scene staging **shipped 2026-07-22 as the scene-centric IA redesign**
    (prepare maps privately, switch the live scene non-destructively).
  - **PR F** — **done on `claude/open-api-core-m75t9d`** (see "Public integration API v1" above).
    Remaining non-core follow-ups: scenes/claims/token-cosmetics over the API, SSE event stream,
    webhooks.

## Recently merged (Cycle 4)

`#28` batch A (labels, cone/line snap, Delete key, tray-drop, grid-wizard zoom/redo,
viewer reset/pop-out, "VTT Setup" rename) · `#29` batch B (free-direction cone/line, live
token grid-snap) · `#30` PR C (per-drawing colors, GM/player layer toggle, encounter pings
with sender name).

## Verification bar (project convention)

Every change ships `npm run check` + `npm test` + `npm run build` green, and UI changes get
a **live Playwright smoke** (seed a map + calibration + encounter via the API, then drive
the map inside the full-viewport "Enlarge map" overlay). See `docs/ai-context/testing.md`.

## Magic items (2026-07-28)

Items, feats and features share ONE 21-variant rider vocabulary (`featureRiders`), authored through
the same `RiderEditor` at `scope: "item" | "feature"`. All fifteen of the GM's authoring criteria
work end to end: a +1/+1d4-lightning shortsword, wands/orbs/potions/amulets as real slots, a ring
that moves AC, an amulet that casts a spell on its own pool, initiative advantage, +1 Lay on Hands,
advantage on opportunity attacks, a bonus spell slot, +1d6 fire on a crit, a raised spell save DC,
a circlet granting proficiency or expertise, a save bonus, curses as negative riders, feats carrying
the same vocabulary, and items granting feats.

Two engines, deliberately disjoint: `effectiveActions` folds STANDING riders into the numbers the
resolver reads; moment riders (`on-critical-hit`, `on-attack-roll`, …) are collected at their moment.
`collectRiders(…, {moment: null})` excludes anything carrying a moment or filter, so nothing is
counted twice. A feat reaches the collector as a carrier with no `sourceItemId`; the 8 types the
builder bakes are excluded there by a compile-time partition.

The sheet's checks, saves and skills are the SERVER's numbers, delivered as a derived block on
`actor:available-actions` (role-gated request, not the broadcast projection — see decision log).
Verified by injection at every layer and driven in a browser: a circlet took Borin's Stealth from
`+1 / not proficient` to `+7 / E "Expertise (Circlet of Shadows)"`, and back on un-attune.

Known gaps, all recorded rather than papered over: `dice:roll` still takes a client-built formula
string, so the NUMBER is the server's but the transport is not id-based and `roll-mode` riders reach
no ability check; `spell-attack-bonus` and `damage-reduction` reach a derivation field nothing reads;
`on-death-save` and `versus-creature-type` parse and stay inert; `actor.initiative` is not reconciled
on inventory writes, so the derived block computes the live value while direct readers do not; and
out-of-combat weapon taps still roll a client-computed bonus.

## Claude Code tooling

This repo carries a Claude Code tooling layer. The **canonical roster** (skills, subagents,
path-scoped rules, hooks) lives in `.claude/README.md`; design rationale in
`docs/claude-code-tooling-outline.md`. In brief: `CLAUDE.md` index → `docs/ai-context/` briefs +
this ledger + `.claude/loop.md`; **10 skills** in `.claude/skills/`; **5 read-only reviewer
subagents** in `.claude/agents/` (`architecture-reviewer`, `ux-reviewer`, `test-reviewer`,
`code-reviewer`, `viewer-safety-auditor`), each with committed persistent memory under
`.claude/agent-memory/`; **6 path-scoped rules** in `.claude/rules/` that auto-load the hard
invariants when Claude opens a matching source file; three lifecycle hooks (`danger-guard`
PreToolUse, `scope-guard` UserPromptSubmit — now points at the matching rule, `stop-reminder`
Stop — see `.claude/hooks/README.md`). `.claude/settings.json` adds a routine-command
`permissions.allow` list and enables auto memory. A GitHub Actions schedule scaffold
(`.github/workflows/scheduled-ledger-drift.yml`) is present but **inert** (cron commented out). A
generated **app map** (`npm run map` → `docs/app-map.md`, freshness-tested in the server suite)
indexes the GameState shape, command catalog (with scopes), and HTTP surface; the
`vtt-orientation` skill routes there first.

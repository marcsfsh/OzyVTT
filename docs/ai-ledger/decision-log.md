# Decision log

**Read this when:** you're about to change something that feels architectural, or you're
tempted to re-open a settled question. These are durable decisions — don't relitigate them
without a clear new reason, and if you do change one, record it here with the date and why.

The **canonical architecture record is `docs/adr/`** (19 ADRs). This log captures the
load-bearing decisions in one place plus operating decisions that don't have an ADR.

## 2026-07-26 — Character builder: features-as-data, so homebrew is additive

The guided builder is being built with a **later homebrew update as a first-class design input** (the owner's
explicit ask: homebrew should eventually cover classes, subclasses, species, backgrounds, feats, **class
features**, spells, **all item types**, and monsters). Five rules make that additive rather than a rewrite, and
they bind all future character-builder work:

1. **Features-as-data.** A class/species/feat feature is a declarative `FeatureRecord` — prose plus optional
   structured riders drawn from the existing `ActionSchema` / `EffectGrant` / `EffectModifier` vocabulary. **No
   feature may be implemented as hardcoded client or server behavior.** Homebrew authors the same record type;
   the wizard and rules engine cannot tell SRD from homebrew apart.
2. **One merged catalog, one `source: "srd" | "homebrew"` discriminator**, merged once at
   `apps/server/src/content-library.ts`.
3. **No new closed enums in content.** Identity ids stay open slugs; ordering and labels come from data, never
   a hardcoded client list.
4. **The choice-provenance ledger (`character.choices[]`) is load-bearing** — level-up and respec cannot
   prefill prior choices without it, and retrofitting provenance onto existing characters is impossible.
5. **`definitionId` MUST be `import-<actorId>`** — three paths depend on the prefix; a differently-keyed PC is
   permanently un-editable *and* un-removable.

Also decided: creation submits **one atomic command**, never per-step commands (ten steps would mean ten
revisions, ten broadcasts, and a half-built character visible in `actors[]`); and edit paths **preserve fields
they don't know about** — one `carryForwardOmitted()` helper states the rule once ("undefined means not
supplied"), after a wholesale-replace bug silently wiped the choice ledger and, separately, armor/weapon/tool/
language training.

Scope approved: levels 1-20, multiclass, creation + level-up + respec. This supersedes the "not a character
builder" boundary that ADR-0021 had already begun reframing. Full plan and the 16 discovery decisions:
`docs/task-packets/character-builder.md`.

## 2026-07-26 — D&D Beyond PDF importer extracts client-side (ADR-0018 amended)

The DDB PDF export is a **named AcroForm** (every value is a widget with a field name), so the
importer extracts **in the browser** with `pdfjs-dist` as a deterministic field-name → schema
mapping (`packages/dndbeyond-pdf`), not the server-side MarkItDown worker ADR-0018 originally
proposed. The PDF never leaves the device; the reviewed draft reuses the existing
`actor:import-definition` command and the server re-validates it (authority unchanged). GM-initiated
for v1; ambiguity flag-and-degrades (a >4-class multiclass caps to 4 + warns). Verified by 11 golden
tests over 6 fixtures. Full rationale in ADR-0018's Amendment.

## Architecture (see `docs/adr/` for full rationale)

- **Authoritative LAN server owns `GameState`.** No game decision runs on the client. (ADR-0001)
- **Realtime protocol:** command → validate → authorize per command → transactional
  execute (receipt + event + projection) → broadcast role-specific projections. Contract
  lives once in `packages/domain`. (ADR-0005)
- **SQLite persistence** with idempotency receipts + revision conflicts; snapshots bound
  replay. Game state only — **auth is separate** (`data/auth.json`). (ADR-0006, ADR-0002)
- **Identity is accountless + LAN-trust.** GM bootstrap is loopback-only; players claim one
  character per browser session; no invitations or cloud accounts. (ADR-0002, ADR-0011)
- **Projection is the security boundary.** Player vs GM views are computed separately;
  players never receive GM-only actors/notes/private rolls/hidden turns. (ADR-0005, ADR-0011)
- **Public integration API reuses the same command/authorization/projection layer — never a
  parallel path** (RISK-004), and the served `openApiDocument` stays byte-identical to
  `packages/api-contract`. (ADR-0016)
- **Worldbuilding codex lives OUTSIDE `GameState` (2026-07-24).** The living atlas + two-layer wiki +
  campaign journal persist in a dedicated `CodexStore` (own tables in `data/vtt.sqlite`), fetched on
  demand over a `/api/v1/codex` REST router — NOT in the projected `GameState` blob (which
  re-serializes + rebroadcasts whole on every command). Mutations still walk
  validate→authorize(GM)→persist and emit a content-free `codex:changed` ping that clients refetch on;
  `codex-projections.ts` is a second, explicit security boundary for the two-layer (player-facing +
  GM-secret) model — because player-facing content DOES reach players, this is **not "safe by
  construction"**, so every player-facing read is an audited strip (player FTS = player body only;
  player marker projection drops scene/actor + unrevealed page/sub-map links; page media gated on a
  revealed reference). Mirrors the maps/tokens satellite-store pattern; the public OpenAPI
  game-command surface is untouched.
- **The Codex HTTP surface is now part of the documented OpenAPI contract (2026-07-25).** The codex
  worldbuilding routes (`/api/v1/codex/*` + `/api/v1/codex-assets/*`, ~38 operations) had always been real,
  UI-driving routes but were never in the served `openApiDocument` — the spec silently omitted the whole
  surface even though it explicitly aims to "match the real, running routes." They're now documented in
  `@vtt/api-contract` (CODEX_PATHS/CODEX_ASSET_PATHS + 67 component schemas + operations), rendered into
  `docs/api-reference.md`, and pinned by `contract.test.ts`. **Auth model documented from the handlers, and
  it differs from the game API:** codex routes are *session*-authorized (a GM **or** player session — players
  get the revealed-only projection), never integration-scope `bearerAuth`; every write is GM-only, and
  folders/revisions/export stay GM-only even for reads. No route/behavior change — the server still serves the
  same literal byte-identical (`app-map.md`: 94→132 HTTP paths). The codex is a first-party UI surface, so this
  is documentation completeness, not an invitation to drive it as an external integration. **Footgun for future
  edits:** the endpoint *grouping* is duplicated in THREE places that must stay in sync — `reference.ts`
  (`docs/api-reference.md`), the in-app `apps/client/src/integrations/ApiReference.tsx` panel (VTT Setup tab),
  and this narrative. A new path group (like codex was) is invisible in the docs/UI until a matching `GROUPS`
  entry is added to the first two, even though it's already in the served document.
- **A map marker links MANY pages + MANY scenes; a scene is no longer owned by one marker (2026-07-25).**
  Markers began as one-of-each polymorphic links (`pageId`/`subMapId`/`sceneId`/`actorId`). Pages and
  scenes became **arrays** (`pageIds`/`sceneIds`, JSON id-array columns, migration v8 backfills the old
  singular columns which are now dormant; sub-map + actor stay single). This **relaxes the earlier
  "a scene has one location, so linking it clears any other pin that claimed it" rule** (removed from
  `updateMarker`): a prepared scene may now sit on several pins, and `markerForScene` — the combat-history
  bridge's lookup — resolves to the most recently-touched marker (`ORDER BY updated_at DESC`). The reason:
  the owner wants flexible worldbuilding links (one battle staged in several places; a pin gathering many
  notes/encounters), and nothing depends on a scene mapping to exactly one marker. **Viewer-safety
  boundary unchanged in kind:** `projectPlayerMarker` still returns only the revealed subset of a pin's
  pages and strips scene/actor entirely — the array just moved the filter from one id to a set.
- **Notebook folders are first-class records, not just page paths (2026-07-25).** Folders originally lived
  ONLY inside each page's `folder` string, so a folder existed only while a page referenced it — moving the
  last note out silently erased the folder. Folders are now their own records (`codex_folders`, migration
  v9); the tree unions records with page-derived paths so an **empty folder persists**. Any folder a page is
  saved into auto-registers (path + ancestors) via `registerFolderPath`, `moveFolder` carries records with
  the pages, and `deleteFolder` re-homes every note under it to the top level (never deletes a note). This
  is GM-only organizational metadata — folder records are never projected to players (the player codex is a
  flat revealed-page list), so no viewer-safety surface changes. Pages still carry their own `folder` path;
  a record is just what keeps an empty folder on screen.
- **Codex satellite-store follow-ups deliberately deferred (2026-07-24).** A four-lens audit of the
  codex confirmed the off-`GameState` design is sound, and flagged gaps that are **known and accepted
  for now**, not oversights: (1) the codex has **no integration-API surface** - it wires only
  `authorizeGm`/`authorizePlayer`, no `credentials.verify()`, no `codex:read/write` `IntegrationScope`,
  no OpenAPI paths (the token-asset library already has this same gap). Revisit if/when a campaign tool
  needs scoped codex access; until then the LAN GM UI is the only consumer. (2) Codex **create** routes
  take no `commandId` - a retried create can duplicate a page/marker/entry, unlike the `expectedRev`
  path on updates. Accepted for a single-GM tool; add a dedupe window if it bites on flaky mobile.
  (3) No orphan-asset GC on `codexAssets` and no `DELETE /codex-assets/:id` (mirrors `map-http`'s
  existing gap); (4) `codex_page_revisions` snapshots every autosave with no prune. All low-severity at
  home-campaign scale; do not treat their absence as a bug to "fix" without a real trigger.
- **Worldbuilding is now a core pillar, not out-of-scope (2026-07-24, product-owner directive).** The
  original constitution listed "campaign wiki" as a do-not-drift boundary. The product owner
  (garrettpstrand) explicitly redefined the product as a D&D VTT **and** a full worldbuilding platform
  (World Anvil / Kanka / LegendKeeper class), scoped to a single home group. In flight / planned on top
  of the existing Codex: **typed entities** (a page has a type - character/location/faction/item/
  species/religion/event - with structured fields), **typed relationships** (directional, e.g.
  rules/member-of/enemy-of) + a relationship graph, a **fantasy calendar + timeline**, and a **world
  home** with tag browsing. Constraints unchanged: two-layer secrecy + viewer-safety on every new
  surface, server authority, mobile parity, and the codex stays off the `GameState` broadcast. Combat
  remains combat-first; the two pillars coexist. CLAUDE.md updated to match.
- **All four worldbuilding pillars shipped (2026-07-25).** The plan above is now built and verified on
  branch `claude/world-maps-geospatial-db-1kiqez`: (1) typed entities + structured fields + typed
  relationships (migration v3, viewer-safe `GET /codex/relationships`); (2) GM-defined fantasy calendar
  + chronological in-world-dated timeline grouped by year (migration v4); (3) a World home (entities by
  type, tag cloud, recent) with click-to-filter tag/type browsing; (4) an interactive relationship
  graph (deterministic force layout, viewer-safe feed, no new server code). Each pillar landed `check` +
  `test` (562) + `build` green with a real Chromium smoke. **This reverses the earlier graph rejection**
  (recorded in current-state as "mind-map graph — UX-rejected, no combat payoff"): under the
  worldbuilding pillar the graph's payoff is worldbuilding, not combat, so the objection no longer
  applies. Calendar dates flow through the journal's long-reserved `calendarInstant` column.
- **Entity `fields` are two-layer, like the page body (2026-07-25).** A four-lens review found the
  original single-layer `fields` leaked a revealed entity's secret attributes (e.g. a villain's "Goals &
  motives") to players on reveal. Decision: structured fields flagged `secret` in the client schema
  (`entities.ts`) are stored in a separate **`gmFields`** map (codex_pages migration v5) that
  `projectPlayerPage` strips exactly like `gmBody`. **Three layers of enforcement (a later refinement
  hardened this):** (1) the client routes secret-schema fields into `gmFields` on save
  (`splitEntityFields`); (2) the SERVER re-seals `SECRET_FIELD_KEYS` on every write - create, update,
  and revision-restore - so a secret key can never rest in the player-facing `fields` even from a raw
  API write or a restored pre-hardening revision; (3) migration v7 backfilled existing rows. The server
  is therefore NOT schema-agnostic about secrecy - `SECRET_FIELD_KEYS` (server) must stay in sync with
  the schema's `secret:true` flags (client), the higher-stakes half of the codex vocab-duplication debt.
  **Invariant for future work:** a new secret field needs THREE coordinated changes - client `secret:true`,
  server `SECRET_FIELD_KEYS`, and a v7-style backfill migration. Guarded by `codex-http.test.ts` +
  `codex-store.test.ts` (seal on write, no player-search leak, and v7's SQL against a pre-seal row).
- **Journal entries persist the raw in-world date, not just the derived instant (2026-07-25).** Storing
  only `calendar_instant` meant editing the calendar after dating entries silently corrupted their dates
  and ordering. Entries now also store the literal `{year,month,day}` (migration v6); `setCalendar`
  transactionally recomputes every dated entry's instant + label from the raw date (non-destructive
  reflow). Rule: the raw date is the source of truth; the instant is a derived sort key, recomputed.
- **Codex has ONE secret-language and ONE relationship vocabulary (2026-07-25).** A six-lens UX review
  found the "players see this / players don't" idea — the codex's signature concept — expressed ~5 ways.
  Durable rule, enforced by shared components in `apps/client/src/codex/SecretMarkers.tsx`: (1) *record
  reveal* is always `<RevealSwitch>` → "Shown to players" / "GM only" (never "Map shown/secret",
  "Shown/Secret", etc.); (2) *GM-only content* is always `<GmOnlyTag>` + the `.codex-gm-block` violet
  accent, identical on secret fields, the GM body tab AND its preview, the journal composer's GM field,
  posted GM text, and pinned-timeline GM notes. Violet means GM-only and nothing else (inert wiki-links
  are muted, not violet). Typed entity edges are **"Relationships"** everywhere; "link"/"Linked from" is
  reserved for the auto-derived wiki-link/backlink feature. **For future codex work:** reach for
  `RevealSwitch`/`GmOnlyTag` rather than a new toggle or tag, and don't reintroduce "connections"/"shown"
  synonyms. Deletes go through the app's `useConfirm()` (never `window.confirm`).
- **Codex vocab + calendar math still duplicated client/server - accepted debt (2026-07-25).** The
  architecture review flagged that entity-type/relationship vocab and the calendar instant<->date math
  live in both client (`entities.ts`, `api.ts`) and server (`codex-store.ts`), hand-synced. NOT hoisted
  this pass (nothing broken; copies agree). If the codex grows, hoist into `packages/domain` (imported by
  both sides already).
- **Player character sheets — interactive play sheet now, builder-ready (2026-07-23).** Reframes
  the CLAUDE.md/ADR-0018/0019 *"not a character builder"* boundary: Phase 1 ships an interactive
  **play** sheet (still not a builder); a guided **builder** is the explicit next roadmap update.
  A new ADR-0021 records this and the contract below (lands with the data-model slice).
  - **No-rewrite data-model contract.** Store the builder's *choice inputs* as the durable schema
    — proficiency/skill selections (`proficient|expertise`), spell-slot maxima + known list,
    class/level/race/background — with optional **override totals** for imports that only know
    final numbers. One resolver reads `override ?? selection-derived ?? ability-only`. The builder
    later *fills the same fields*; nothing downstream changes. (Storing only derived totals in the
    `extensions` bag, as today, would force the builder to replace them — the trap avoided.)
  - **Definition vs live split** mirrors `hitDice`/`actionUses`: identity/proficiency/spell
    *capability* on the immutable `ActorDefinition`; live `spellSlots`/`preparedSpellIds`/
    `inventory`/`currency` on `Actor`, seeded in `instantiate()`, projected owner-only.
  - **Players initiate their own rolls; the server still resolves/authorizes.** Damage to monsters
    stays a **GM-confirmed proposal** (players never mutate another creature's HP). Authorization
    centralizes into one `canInitiateForActor(principal, state, actorId, kind)` seam so a future
    per-table "players may initiate attacks" toggle is a one-field add, not a refactor.
  - **Player combat integration shipped (2026-07-24).** `action:resolve` is un-gated for a player's
    own claimed character (the `canInitiateForActor` seam; templates/cover/overrides stay GM-only).
    Damage policy is now a **GM-controlled per-table toggle** `combat.playerDamageMode`:
    `proposal` (default — a hit parks a GM-only `combat.pendingDamage` proposal the GM applies) OR
    `direct` (auto-apply, still server-side and GM-scoped). This realizes the "players may initiate
    attacks" toggle the seam anticipated **without ever letting the client mutate a non-owned actor's
    HP** — the direct path applies through the server inside `action:resolve`, never a player
    `actor:apply-damage`. The read-only player action list became an interactive runner mirroring the
    GM's.
  - **One per-browser dice-input preference (2026-07-24).** The character sheet's manual/auto + bonus
    toggle is now a shared per-browser store (`apps/client/src/dice/roll-preference.ts`) read by every
    roll surface, replacing the table-wide GM `combat.rollMode` (retired from the UI; field/command
    left inert). The preference is **per person, not per table** (product decision): each player
    controls how their own dice input works; the toggle lives on the sheet and in the DicePanel.
  - **Attacks from the sheet too (2026-07-24).** A player's stat-block attacks resolve from their OPEN
    sheet on their turn, not just the initiative list, via a per-browser `sheetAttackMode` in the same
    preference store: `inline` mounts the shared `PlayerActionRunner` in the sheet's Actions section;
    `jump` starts targeting on the shared store and hops to the initiative view to pick/confirm, then
    jumps BACK to the sheet once the attack commits (the user's explicit round-trip). Both modes drive
    the one server-authoritative `action:resolve` — the sheet is a second surface on the same store,
    not a second code path. Only server-resolvable definition actions route; client-derived
    equipped-weapon quick-rolls stay loose dice.
  - **Player-rolled initiative (2026-07-24).** Opt-in **per encounter** via
    `encounter:start { playersRollInitiative }`: claimed PCs are parked on `combat.pendingInitiative`
    (seeded with a provisional auto-roll so the order is always valid/non-blocking) and each player
    rolls their own with `initiative:roll-self` (server d20 + modifier, or a typed natural), authorized
    through the same `canInitiateForActor` seam. A GM `combat.playerInitiativeMode` chooses
    **start-now** (turns run on the provisional order, updating as players roll) vs **wait** (turns
    hold until everyone has rolled, then begin on the final order); `initiative:roll-remaining` lets
    the GM roll stragglers. All three new fields are additive-optional and GM-/viewer-safe by
    projection construction.
  - Roadmap + codebase orientation: `docs/product/character-sheet-initiative.md`.
- **UI design system: OzyVTT (2026-07-21).** A tokenized retrowave design language is the
  single source of look-and-feel, living in `packages/ui` (`design-tokens.css` + self-hosted
  `@fontsource` fonts + `nh-`-namespaced primitives), consumed as source by the client's Vite
  entries via `import "@vtt/ui/styles.css"`. Three themes (dark default, dusk, light) via
  `data-theme` on `<html>`; the only user-facing look switches are theme + OS accessibility.
  **Do not hardcode hex in components — add a token first, then `var(--…)`.** New UI is composed
  from `@vtt/ui` primitives and must appear in the dev-only `/styleguide`. Magenta leads / cyan
  supports; green is absent, so every semantic state pairs color with an icon/label. See
  `docs/ai-context/design-language.md`.
  - **Motion is a shared vocabulary, applied pervasively (2026-07-21).** One easing/keyframe set
    (`--ease-settle`, `view-in`/`dialog-in`/`sheet-up`, `--dur-*`) drives all motion. Press feedback
    belongs on every control (raw `<button>` included), hover-**lift** only on genuine click-target
    cards, forward **nudge arrows** on advance CTAs, and view **entrances** on switches — but
    **dense / frequently-re-rendered list items never lift or animate** (initiative rows, combat log,
    token list, chat): press-feedback only. Feature code adopts the shared primitives for structural
    pieces rather than re-hand-rolling them — dialogs via `Modal` (`useConfirm`/`usePrompt`), status
    pills via `Chip` (icon + tone, never color alone), toasts via `useToast`. Map health and drawing
    colors stay on the brand ramp and, where they're rendered (not wire-transmitted), resolve theme
    tokens so they follow dark/dusk/light. The ⌘K command palette is deferred (motion landed; feature
    is a later pass).
- **The server owns combat rules, not just combat records (ADR-0020, 2026-07-18).** Structured
  `action.resolve` validates action economy, compound-action instances, feature requirements, and
  limited uses against engine-owned state, per an encounter-level `rulesMode` (strict default /
  assisted / freeform); every rejection is machine-readable and overridable with an audited
  `override: {reason}`. Persistent `EffectInstance`s (Rage, grapples) with engine-owned lifecycle;
  typed damage with automatic RVI and per-part breakdowns; a PC dying state machine shared by every
  HP write. Supersedes the "tracked, never enforced" posture for structured resolution only — manual
  commands stay free escape hatches, prose-only mechanics degrade to warnings, and one command still
  equals one roll burst so journals/archives replay (under freeform). Mechanics vocabulary is
  additive on schemaVersion 1; ADR-0008's no-imported-code rules are unchanged.
- **Full phone+laptop functional parity**, one responsive client, no separate mobile build.
  (ADR-0014, ADR-0001)
- **SRD content source is open5e `srd-2024` (SRD 5.2.1, CC BY 4.0).** Fixtures are vendored
  unmodified into `packages/content-srd-5.2.1/sources/`; a deterministic ETL adapts them into
  committed canonical `ActorDefinition` bundles with attribution; upstream data bugs are fixed
  via a reviewed `CORRECTIONS` table in the ETL, never by editing sources. 2014/OGL data and
  third-party publishers are deliberately excluded. (ADR-0015, 2026-07-17)

## Feature-architecture decisions (no ADR)

- **2026-07-22 — Scene-centric IA: the scene is the primary object; going live drives the shared
  screen.** The GM's prep is a **Scenes** hub (a gallery of prepared scenes), not a map-library tab plus
  a separate encounter tab. `scene:activate` (go-live) also **presents the scene's map to the viewer**
  (a live scene projects its map + prepared fog even pre-combat; combatant tokens stay gated on
  `combat.active`, so no actor data leaks pre-combat). The standalone **Map Setup tab is retired** — its
  library + 3×3 calibration fold into the hub. Reorder/duplicate are real GM commands through the shared
  operations layer; a scene's **array order IS its order** (no `order` field). Reorder is drag
  (pointer + touch) with a keyboard menu fallback. Design record: `docs/product/scene-centric-ia.md`.
  Owner-approved (auto-present to TV; hub folding Map Setup in; duplicate + reorder; one PR).

- **2026-07-19 — Other VTTs are design studies, never code sources.** AboveVTT (AGPL-3.0) and
  Foundry's dnd5e (MIT) were researched for the adoption pack: read their *behavior and docs*,
  design original implementations in this repo's idioms, never port code. AGPL makes this a
  license requirement for AboveVTT; for everything else it's this repo's convention (ADR-0008's
  no-imported-code posture generalized). Rejected from that research as out of scope: D&D Beyond
  integration, voice/video, a generic Active-Effects engine (our `effects.ts` covers it — extend,
  never replace), full Foundry Activities generality, and dynamic lighting/vision fog.
- **2026-07-19 — "Per day" = per long rest.** The app has no calendar; every N/Day pool
  (ETL `PER_DAY`, Legendary Resistance) maps to the long-rest scope. Documented in the ADR-0020
  third amendment; revisit only if a real in-game clock ever ships.
- **2026-07-19 — Fog of war is presentation, never the security boundary** (ADR-0022). Players
  receive the mask verbatim; hiding a combatant's existence still requires `gm-only` visibility.
  Fog is also NOT combat state: excluded from the timeline's restorable slice, preserved across
  encounter start/end, carried per scene through park/resume.
- **2026-07-19 — Guard shared-view reads on field-presence, not role/mode.** Any GM-only
  `combat.*` field read in the shared table view must be guarded on field-presence — the first
  post-login state can arrive player-projected (no `combat.scenes` etc.), so an unguarded read
  boundary-crashes the shared view. (Mirrored in `viewer-safety-auditor` agent memory.)
- **2026-07-18 — Turn time-travel snapshots live OUTSIDE `GameState`.** Per-turn-boundary
  snapshots go in a dedicated `turn_snapshots` SQLite table, not embedded in `GameState`, so
  the player/viewer projections stay byte-compatible and persisted state doesn't bloat. Only a
  small cursor (`combat.historyCursor`/`historyDirty`, top-level combat only — parked scenes
  never carry them) lives in state. Timeline writes ride the triggering command's transaction
  (crash-consistent), and all navigation decisions run inside the store's single-writer queue
  via `GameStore.executeTimeline` (no TOCTOU). "Which mutations dirty the timeline" is an
  injected `timelineDirtied` comparator over a restorable slice (combat + actor hp/conditions),
  keeping the store ignorant of domain semantics; rolls/claims/pings/scene-prep never dirty.
  Restore is **merge, not replace** — combat + hp/conditions roll back; rolls, claims, roster,
  cosmetics, imported definitions, and scenes are kept. Scene switches and encounter start/end
  truncate the timeline (snapshots are per-live-fight). A history rewrite (confirmed Next while
  rewound) is the owner-approved exception to normal forward-only play.

- **2026-07-18 — Ended encounters auto-archive to a permanent, machine-readable record.** On
  `encounter:end` the full turn-by-turn snapshots + the fight's timestamped combat-log slice are
  written to an uncapped `encounter_archives` table (migration v4) inside the *same transaction* as
  the live-buffer truncation, so an ended fight's record can never be lost. It's exposed **GM-only**
  (`GET /api/gm/encounters`, `GET /api/gm/encounters/:id`, `DELETE`) as JSON — the document holds
  full state (hidden combatants) + GM-only log lines, so it never leaves GM auth. The app never
  analyzes it; the format (`encounter-archive.ts`, `archiveSchemaVersion` 1: `turns[].state` +
  `log[]`, joined on `revision`) is a stable substrate for user-built integrations. The rolling
  turn-snapshot window (250) is the safety net for a fight left un-ended. This is the pull/batch half
  of the integration story; real-time push (webhooks) is a separate future piece (pairs with PR F).

- **2026-07-18 — Game capabilities live in one transport-agnostic operations layer.** Every core
  combat capability (encounter lifecycle, initiative/timeline, turn economy, tokens, HP/conditions,
  roster add/import/remove, dice, action resolution, saves, annotations, content reads) is a function
  in `apps/server/src/game-operations.ts` that validates (shared zod schemas in `game-commands.ts`),
  role-checks, dispatches through the store, and runs the side effects (publish, log, toasts). The
  Socket.IO handlers in `server.ts` and the public HTTP routes in `game-http.ts` are both thin
  adapters over these exact functions — the ADR-0016 "adapters, never forks" rule is now structural,
  not a convention. New game capabilities get added to the operations layer first; adding a
  socket-only or HTTP-only capability is a regression. As of the same day's follow-up slice, claims,
  scenes, and token cosmetics are in the layer too — every game command has both adapters, and
  `POST /api/v1/sessions/player` mirrors the socket's open join so pure-HTTP player clients exist.
  Claims stay player-principal-only on both transports (GM/integration principals are refused);
  scenes use the `scene:write` scope.

- **2026-07-18 — Public game API v1 shape (PR F).** `GET /api/v1/game` returns the caller's
  projection: GM sessions and GM-minted integration credentials get the full GM view (an integration
  is the GM's own trusted automation), `?view=player` opts into the player-safe projection for
  overlay-style consumers, and player session tokens only ever get the player view. Typed
  command routes cover the core combat surface, plus a generic `POST /api/v1/game/commands` tunnel
  that dispatches any cataloged command type (`GET` lists them with required scopes) — so every
  present and future operation is reachable before it earns a typed route. Polling contract: weak
  ETag derived from the revision (no SSE/webhooks yet — deferred deliberately). Error contract:
  400 `validation_failed`, 401/403 auth, and **409 `conflict` for everything the game itself
  refuses** — domain rejections, stale `expectedRevision` (carries `currentRevision`), and timeline
  confirmations (carries `details.needsConfirm`). `commandId` is the idempotency key on every write
  (minted server-side when omitted, echoed back). CORS is wide open on `/api` (bearer-only auth;
  the viewer cookie is SameSite=Strict, so `*` grants nothing). Encounter archives moved under
  `/api/v1/encounters` behind `combat:read` (delete: `admin`), with the legacy `/api/gm/encounters`
  endpoints kept as-is.

- **2026-07-18 — Time Machine archives are v2: full per-command journal.** Migration v5 adds an
  `encounter_journal` table; while a fight is live (before-or-after `combat.active`), every accepted
  command is journaled *inside its own transaction* — type, validated payload, `gm:`/`player:`/
  `integration:` principal tag, revision, timestamp. `encounter.start` wipes the previous fight's
  journal but keeps itself as the new fight's first entry; `encounter.end` folds the journal into the
  archive document (appending the end command itself) and clears the table atomically.
  `archiveSchemaVersion` bumps to 2, strictly additive: `journal[]`, `finalState` (the last live
  state before the end cleared combat), `rolls[]` (union across all boundaries — survives the live
  200-roll cap), `definitions[]` (full imported + bundled stat blocks used), and `attribution`
  (CC BY line when bundled content is included). Consumers join `turns`/`log`/`journal` on
  `revision`.

## Operating decisions (no ADR)

- **Verification bar:** `check` + `test` + `build` green + live Playwright smoke for UI
  changes, before a PR goes up. (`NEXT-STEPS.md`)
- **Type-checking is the only static gate** — no ESLint/Prettier. Don't assume a linter
  catches style; keep changes idiomatic to surrounding code.
- **Commit/PR hygiene:** never put a raw model id in commits, PR text, or code comments.
- **Branch model:** parallel agents each on their own `claude/*` branch; never touch
  another agent's branch. (`.claude/skills/vtt-branch-safety`)
- **`data/` is local and git-ignored** — never commit campaign data.

## Tooling decisions

- **2026-07-17 — Adopt a small Claude Code skill system** (not a meta-agent) for this repo:
  constitutional `CLAUDE.md` index, modular `docs/ai-context/` briefs, a `docs/ai-ledger/`,
  committed `.claude/loop.md` cadence, and `.claude/skills/`. Rationale and full roadmap in
  `docs/claude-code-tooling-outline.md`. Scheduling that lives in code = `.claude/loop.md` +
  GitHub Actions `schedule:`; session `/loop` and cron tasks are runtime-only.
- **2026-07-17 — Model-usage policy: minimum necessary model.** Only the most core,
  high-stakes, or unsupervised functions use Opus 4.8 at high effort; everything else uses
  the smallest sufficient model. Reviewer subagents are pinned accordingly: `test-reviewer`
  = `haiku` (mechanical — runs commands, reports), `ux-reviewer` / `architecture-reviewer`
  = `sonnet` (bounded judgment, strong enough to catch real issues). Interactive core work:
  Opus 4.8 / high effort; trivial asks: downshift the model per session. Config keys:
  `model` + `effortLevel` in `settings.json`; per-subagent `model:` frontmatter. The nightly
  OpenAPI Routine runs on `sonnet` (bounded, PR-reviewed increments), set in its model
  selector in the claude.ai Routines UI.
- **2026-07-24 — Claude Cleanup & Setup: standardized the tooling to Anthropic best practices.**
  Consolidated the Claude-facing docs and adopted newer Claude Code features. Decisions:
  (1) **Archive, don't delete** superseded docs → `docs/archive/` (root `ARCHITECTURE.md`,
  `NEXT-STEPS.md`, the `character-sheet-v2..v6` feedback rounds + styleguide audit) — reversible,
  history-preserving. (2) **Persistent-memory subagents:** all five reviewers are read-only +
  `memory: project` (committed under `.claude/agent-memory/`); added `code-reviewer` (general
  correctness/quality) and `viewer-safety-auditor` (GM-only-leak audit) to the original three.
  (3) **Keep `CLAUDE.md` a lean prose-pointer index AND add path-scoped `.claude/rules/`** — the
  hard invariants live once in the rules (auto-load on matching-file edits); `scope-guard` now
  points at them instead of duplicating the text. (4) **Fixed app-doc drift** (`check` is
  typecheck-only, not lint; persistence is SQLite, not "Local JSON"; ADR index rebuilt).
  `.claude/README.md` is now the canonical tooling roster; `settings.json` gained a
  `permissions.allow` list + auto memory. **ADR-0021 collision resolved:** the player character
  sheet keeps 0021 (fewer referrers, already bound in `CLAUDE.md`), manual fog renumbered →
  **ADR-0022**. Verified `check` + `test` + `build` green.

# Decision log

**Read this when:** you're about to change something that feels architectural, or you're
tempted to re-open a settled question. These are durable decisions — don't relitigate them
without a clear new reason, and if you do change one, record it here with the date and why.

The **canonical architecture record is `docs/adr/`** (19 ADRs). This log captures the
load-bearing decisions in one place plus operating decisions that don't have an ADR.

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
- **2026-07-19 — Fog of war is presentation, never the security boundary** (ADR-0021). Players
  receive the mask verbatim; hiding a combatant's existence still requires `gm-only` visibility.
  Fog is also NOT combat state: excluded from the timeline's restorable slice, preserved across
  encounter start/end, carried per scene through park/resume.
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

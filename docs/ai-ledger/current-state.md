# Current state

**Read this at session start.** Short source of truth for what exists *now*. Update it
(concisely) after real work lands — don't let it drift. This is a snapshot, not history;
history goes in `session-summary.md`, durable decisions in `decision-log.md`.

_Last seeded: 2026-07-17 (initial ledger seed from README / NEXT-STEPS / code survey)._

## What works today

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

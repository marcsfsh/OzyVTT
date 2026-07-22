# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

## 2026-07-22 — Scene-centric IA redesign (the deferred flow rethink; 7-slice PR)

Turned the "Scenes hub" design (`docs/product/scene-centric-ia.md`) into shipping code, one verified
slice per commit:
1. **Backend** `scene:duplicate` + `scene:reorder` (shared operations layer, socket + `/api/v1`,
   api-contract byte-identical + reference regen).
2. **Viewer bridge** — `scene:activate` presents the scene's map to the shared screen; a live scene
   projects its map + prepared fog pre-combat (tokens still gated on `combat.active` — no new actor
   exposure). New `viewer-coordinator.presentMap`.
3. **`@vtt/ui`** `.nh-gallery`/`.nh-card` pattern + `/styleguide` (live = the one magenta glow; staging
   = cyan edge; a stretched card button so the ⋯ menu/actions layer above it).
4. **Scenes hub** gallery tab (cards, go-live, stage, rename, duplicate, remove, empty state; map-glyph
   thumbnail fallback for a missing/corrupt map).
5. **Map Setup folded in** — tab retired; "Manage maps" opens the library/calibration sub-view.
6. **Encounter start reconciled** — starts on the live scene's map (the server requires the match); the
   map row is read-only when a scene is live.
7. **Drag-to-reorder** the gallery (pointer + touch grip, `touch-action:none`; menu Move earlier/later
   stays the keyboard path).

Owner decisions: auto-present to the TV on go-live; new Scenes hub folding Map Setup in; duplicate +
reorder (no persisted thumbnails); one PR. Verified per slice: `check`+`test` (462)+`build` green;
Playwright smokes (gallery in 3 themes + 390px, ⋯ menu, thumbnail fallback, Manage-maps round trip,
scene-first start, drag-reorder DOM+server both update). Closes the known-bugs IA item. Follow-ups:
persisted server thumbnails; slim the Encounter quick-switch strip; a physical touch-device pass.

---

## 2026-07-21 — PR #40 review round 2 (seven items, same branch)

Second screenshot-review pass on `claude/vtt-combat-plan-clarify-wy9cji`. Verified green (check/test/
build, 393 server tests) + live browser smoke (41/41, zero console errors, screenshots per item).

- **Aura** now renders BEHIND the token (before `TokenGlyph`) so the body + active-turn ring stay
  crisp on top; ~35% thinner and hugging the token edge (own `TokenHealthAura`; the on-top
  `TokenHealthBar` handles bar/ring only). Hue is relative to the exact fraction where the audience
  holds it (GM, own PC); the shared screen stays band-derived (HP-privacy invariant).
- **Viewer initiative** column is drag-resizable (left-edge handle, persisted to
  `vtt.viewer-initiative-width`; content moved into a `.viewer-initiative-scroll` wrapper so the handle
  never scrolls away); room font + name min-width tuned so full names fit.
- **Right-click menu** Size/Health/Show-to selects share one width (fixed label grid column).
- **Encounter setup** panel is the EXACT height of the map/scene panel — measured live via a
  ResizeObserver on `.table` into `--setup-h` (main.tsx), combatant list scrolls inside; helper blurb
  removed.
- **End turn** restyled to match the Action/Bonus/Reaction pills (keeps its orange).
- **CSS-bleed fix (important):** Item C nested the acting console INSIDE the active `<li>`, so every
  `.initiative-list … li` descendant rule was leaking onto the console's own `<li>`s (bullets stacked,
  stray borders). Scoped all row rules to direct children (`> li`). Also `padding:0` on the `+`/`⋯`
  menu toggles so they match the ‹/Next-turn height.
- **Player actions (#5.2, read-only):** on a player's turn their row shows the same attack rows the GM
  console shows (name + to-hit/reach/range/damage), sourced from the player's already-projected stat
  block. Reference only — the GM still rolls/applies, so NO server-authority change. (The interactive
  option was scoped out by the owner.)

## 2026-07-21 — PR #40 review-feedback refinements (five items, same branch)

Owner reviewed the three-item PR from the smoke screenshots and asked for five refinements, applied as
new commits on `claude/vtt-combat-plan-clarify-wy9cji`. All verified green (check/test/build, 393 server
tests) plus a live browser smoke — 39/39 assertions, zero console errors, screenshots per item.

- **Aura health style (#2 feedback):** a fourth style beside band/bar/ring — a soft green→red glow
  around the token, colored by the creature's health fraction. Threaded through the enum everywhere
  (schemas / game-commands / api-contract / domain / viewer-presentation); it flows through the same
  audience gate as bar/ring (`audience==="all" && style!=="band"`), so no projection-logic change. The
  glow is a transparent-center radial gradient in `TokenHealthBar` (`mapImage`), shared by GM/player/
  viewer. Added to both the GM global health select and the per-token right-click control.
- **Initiative restructure (#3 feedback):** the active combatant now leads the list (rotated turn
  order, wrapping) and its acting console renders inline directly under that top row — for BOTH the GM
  tracker and the player panel — replacing the old fixed bottom console. A normal turn drops the
  redundant console name header (an off-turn legendary actor keeps it). The player's economy rides
  their own row, so off-turn reaction marking is preserved. Softer rounded active-row highlight;
  smaller topbar controls.
- **Right-click menu dropdowns (#4 feedback):** Health became a `<select>` styled/placed like Size
  (directly below it), with a "Show to" audience select; Conditions became a `<details>` disclosure
  under Health (kept as a disclosure, not a native select, since conditions stack + exhaustion has a
  level).
- **Viewer = player initiative (#5 feedback):** removed the thin band HP bar from the shared
  `InitiativeRow` (drops it from BOTH player and viewer); the viewer now uses the player's compact
  Round-pill header (not the big serif), active-on-top, no controls, kept room-scaled. Health still
  reads as Bloodied/Down text + condition dots + the token's ring/aura. Viewer-safety leak asserts
  re-confirmed with aura added.
- **Encounter-setup panel height (#1 feedback):** undocked at desktop the setup panel is capped to the
  map's height and the Party/Recent/Search combatant region scrolls internally; map picker + Add
  monsters + Start stay pinned. Scoped to the sidebar + ≥980px (docked/mobile unaffected).

## 2026-07-21 — Token health display · shared initiative · scene-setup picker (three-item PR after #38)

Three combat-UX items from the roadmap on one branch (`claude/vtt-combat-plan-clarify-wy9cji`), six
green slices. Owner decisions this session: health display is BOTH a global default and a per-token
override; recency is server-tracked; #10 goes to full parity incl. viewer condition dots; the scene
browser is deferred.

- **#11 Token health on the map:** `combat.healthDisplay {style, audience}` (table default) + optional
  `Actor.healthDisplay` override; controls in the token right-click menu (per-token) and the encounter
  options menu (table). A bar/ring renders instead of the coarse band dot. The audience gate is
  resolved ONCE server-side in the projections — GM exact, own-PC exact, everyone-else band-fraction,
  viewer band-fraction — so exact HP never reaches a non-owner (leak tests cover it). Two GM-only
  commands mirror roll-mode; `TokenStatusBadges` gains an optional bar/ring; `bandFraction`/
  `hpFillFraction` live in React-only `mapImage` so the viewer shares them without the socket.
- **#10 Shared initiative:** `projectPublicInitiative` now carries public-only condition ids + labels;
  a shared `InitiativeRow` (em-scaled, self-contained CSS) renders both the player panel and the
  viewer, so the two lists never drift and the viewer shows the same condition dots.
- **#2 Scene-setup picker:** flat list → pinned PCs (pre-checked) / recent (server `lastUsedAt`,
  GM-only) / searchable rest.

Verified: `npm run check` + `test` (392 server + 16 contract + others) + `build` green across all
workspaces; `docs/api-reference.md` regenerated (freshness test green). **Live browser smoke** (owner-
requested round before the PR): a scratchpad playwright-core script drove the real built app (fresh
`DATA_DIR`, preinstalled Chromium) through GM + player + viewer contexts — 18/18 checks, 0 console
errors, 11 screenshots (picker sections + search + 375px; GM ring/bar + right-click menu + per-token
override; player own-exact vs band-fraction; viewer parity dots; audience-gm fallback on player AND
viewer; wire-level leak asserts on the player/viewer JSON). The smoke caught two visual defects that
were then fixed: the viewer sidebar crushed long names to one letter (shared row now wraps, name keeps
≥8ch) and the right-click Health buttons wrapped awkwardly (label now on its own line, equal-width
buttons). The harness lives in the session scratchpad only — a committed Playwright harness is still a
follow-up, as is the deferred "manage all scenes" browser modal.

## 2026-07-21 — Uniform dice UX: one recognizable roll experience everywhere (owner-directed; same branch/PR #38)

Owner goal: after a roll or two, a player should intuitively know how to roll *anywhere* —
saving throw, death save, attack, damage, opportunity attack — via one recognizable pattern.
The saving-throw prompt was the proven reference (auto-roll-on-appear vs manual entry; Adv/Disadv
after the roll; preview → Confirm). Extracted it into a shared `RollControls` widget and brought
every other roll surface onto the same experience:

- **Shared widget** (`apps/client/src/encounter/RollControls.tsx`): auto mode rolls on appear;
  manual mode waits for a Roll click or typed total; once rolled, Adv/Disadv re-roll the d20
  (2d20kh1 / 2d20kl1), Confirm applies, Re-roll restarts. SavePrompt refactored onto it (no
  behavior change).
- **Death saves**: were a bare one-click "Roll death save" → now the full preview → confirm flow
  through the shared dice engine (raw d20; adv/disadv; auto-rolls on the dying creature's turn).
  Pure `rollDeathSave` core (`death-saves.ts`) mirrors `answerSave`; `death-save.roll` gains
  commit/rollMode/naturalRoll.
- **Attacks**: `action:resolve` gains `commit` (default true — legacy one-shot stays) + `attackNatural`.
  A single-target attack previews the d20 (nothing applied — no damage/riders/prompts/economy),
  the result card offers Adv/Disadv/typed-d20/Confirm, and Confirm resolves once reusing the shown
  roll. Preview returns early after the attack; the operation holds narration until commit.
- **Damage**: the Apply step is now an editable total (type a hand-rolled number → applied straight
  on the no-defense-math path; leave it → typed parts through the pipeline as before).
- **Opportunity attacks**: `reaction:answer` gains commit/rollMode/attackNatural; the swing previews
  (reaction unspent, nothing applied) → confirm spends + applies. Uncanny Dodge unchanged.

Verified: `npm run check` + `build` green; server suite **383** passing (new preview/commit tests for
death saves, attacks, and OAs); live Playwright smokes for the death-save widget, the save widget
(refactored), and the attack preview → confirm card (Adv/Disadv/typed-d20 → HIT nat 19 → editable
damage → Apply). Full new-command/additive-state checklists followed; `docs/api-reference.md`
regenerated. Backend was already ~unified on `resolveDice`; this closes the front-end gap.

## 2026-07-19 — Foundry/AboveVTT research → six-slice adoption pack (owner-directed; same branch/PR #38)

Owner: "thoroughly research github.com/cyruzzo/AboveVTT and github.com/foundryvtt/dnd5e — see what
can be learned from and implemented." Researched both (web-only; **AGPL = design study only, no
code read for reuse** — now a decision-log rule), planned six ranked slices, shipped all six as
independent green commits:

1. **Recharge abilities** — `uses.per: "recharge"` + d6 threshold; ETL emits 86 structured pools
   (and fixed 13 upstream `RECHARGE`+param rows that are really die-range recharges — basilisk/
   medusa gaze, blink dog Teleport…); auto-rolled at the owner's turn start via `nextInitiativeTurn`
   deps; rests/encounter-start re-arm.
2. **Legendary actions + Resistance** — per-round `legendaryUsed` pool (reactionsUsed pattern),
   economy blocks, `turn.use-legendary`, ⭐ off-turn console switch, LR commit flag on `save.answer`
   after a previewed failure (success outcome still applies — e.g. half damage). Pools are GM
   knowledge (stripped, leak-tested).
3. **Condition glyphs** — original 16×16 SVG icons for all 15 SRD conditions in the token badges;
   viewer gets parallel `conditionIds`. Catalog render + live smoke verified legibility.
4. **Scene thumbnails** — cached one-fetch-per-asset map previews in the Scenes strip chips.
5. **Hit dice** — pool seeded from HP formulas; `actor.spend-hit-dice` (pre-rolled faces, min 1/die,
   heals via `healActor`, shared roll record); long-rest refill; the roster's missing rest UI
   (GM Short/Long buttons + stepper; player's own card too).
6. **Manual fog of war v1 (ADR-0021; BUILD_PLAN Phase-2 gate item)** — per-scene reveal/hide rect
   strokes over "all hidden"; `fog.set-enabled/paint/reset` (GM, `sceneId` preps parked scenes);
   server snaps/clamps/compacts/caps; GM-dim-below-tokens vs player/viewer-solid-above-everything
   mask; timeline-neutral (never dirties, survives rewinds); fog ≠ security boundary (documented +
   pinned). Smoke: real drags — grid-snapped stroke, covered player map, re-hide, reveal-all
   compaction, 375 px tools.

Rejected as out of scope (decision log): D&D Beyond integration, voice/video, generic
Active-Effects engine, full Activities generality, dynamic lighting/vision fog. Suite: 104
regression + 7 fog tests; all gates from root; five live Playwright smokes with screenshots.

## 2026-07-19 — Foundry-style tracker + Scene IA strip (owner-directed; same branch/PR #38)

Owner's messages finally came through ("responses weren't going through" explains four identical
rejections): (1) make the initiative like Foundry, simplified; (2) next task = the scene IA.

- **Foundry-anatomy rows, GM + player**: `[avatar disc | name + condition dots + HP text | 3px HP
  bar underneath | initiative right]`. Avatars are kind-colored initials (PC blue / monster red /
  npc green; dashed ring = GM-only); player rows show band-filled bars (full/45%/sliver). GM rows
  49px (Foundry ≈48), player rows 34px. The per-row HP button is gone — the whole row opens the
  tools popover (HP input autofocuses on fine pointers only).
- **Scene IA — the owner's named next task**: new `SceneSwitcher` strip at the top of the
  Encounter tab: every prepared scene is a chip (name + combatant count; LIVE / staging badges);
  tap = private staging preview, ▶ = make live (one click; confirm only when a fight is running —
  the fight parks and its auto-created "Current encounter" chip resumes it), ✕ = remove,
  "+ New scene" opens the prep modal. ScenePanel removed from the Maps tab — Map Setup is purely
  library management now. Verified live end-to-end: create → stage → go live → map switched → LIVE
  badge → parked fight resumed with combat intact.
- **Crash caught by smoke**: the strip initially read `combat.scenes` unguarded and the first
  post-login state can be player-projected (no scenes) → boundary crash. Guard on the field, not
  the mode. (Pattern for future: any GM-only combat field used in the shared table view needs a
  field-presence guard.)
- Gates green from repo root; smokes: 9/9 foundry+scene checks, 6/6 player checks.

## 2026-07-19 — Player tracker parity + independent UX audit fixes (same branch/PR #38)

A fourth identical owner rejection prompted two moves instead of another blind CSS pass: an
independent ux-reviewer audit, and a blind-spot check that found the real miss — the PLAYER-side
initiative list was never overhauled (old fat rows, text chips, banners, standalone economy card).
If the owner tested from a phone as a player, every "fixed" round looked identical. Shipped:

- **Player tracker parity**: same dense language as the GM list — compact Round bar with a single
  status flag, 23-24 px one-line rows (score · name · YOU badge · condition dots · band-colored
  health text), the player's own details grouped under their row, economy in a quiet card below
  the list. 375 px: 229 px list, 400 px panel.
- **Audit fixes** (agent findings, ranked): permanent map tutorial caption removed and the token
  tray now renders only while it has tokens (or during a drag); the 12-icon map toolbar collapsed
  to Select/Ping/Measure + one ✏ Draw toggle holding shapes/color/visibility/layer/wrench; the
  duplicate DockPicker dropped from the ⋯ menu (the map's control remains); "+ Add monsters"
  promoted from the ⋯ menu to the topbar (reinforcements are a combat action, not a setting); the
  acting console's header merged into ONE line (name + economy pills + movement — no restated
  caret/"acting"/separate strip); `(pointer: coarse)` media query restores touch-size targets
  without changing desktop density; narrow viewports cap the docked panel at 62vw.
- **Deliberately kept** vs the audit: the row-popover reaction toggle stays (it is the only
  reaction control for NON-acting combatants — the "duplicate" exists only for the acting one).
- GM panel now 782 px / page 1230 px; all gates green from the repo root (an apps/client-cwd gate
  run earlier in the session was client-only — noted so future sessions run gates from root).

## 2026-07-19 — Tracker strip-down, third pass (same branch/PR #38)

Third owner rejection ("still bloated and cluttered") → removed every remaining block and per-row
ornament: no heading block during combat (Round pill rides the single control bar with ‹/Next/⋯);
the placement nudge is one unboxed line; rows lose all chrome (dim right-aligned initiative
number, plain band-colored HP text, condition dots instead of text chips, per-row R button moved
into the row-tools popover with only a dim struck-R marker when spent); Dice and Combat log
collapse behind one-line disclosures during combat. Measured: 30 px rows, 301 px list (10
combatants), 819 px whole panel (from 1822 two passes ago), 1279 px full page (from 1958).
Screenshots now CROPPED to the tracker column — full-page captures were making every iteration
look like a wall regardless of changes. Awaiting owner calibration: is this composition right, or
rebuild against a named reference (Foundry-style portraits/HP bars vs more minimal)?

## 2026-07-19 — Tracker COMPOSITION redesign (owner re-rejected density-only pass; same branch/PR #38)

Shrinking paddings wasn't the problem — the composition was. Fixes, following how real combat
trackers are structured:

- **The initiative order is now a pure list.** The acting creature's console (economy chips +
  action runner) moved OUT of the `<li>` into its own labeled card below the list
  (`.acting-console`, "▶ Name ACTING · Move x/y ft"). Tracker for 10 combatants: **339 px**;
  console: **~230 px**. No more action UI interleaved between initiative rows.
- **Flat visual language**: action rows are borderless one-liners ("Greataxe  +7 to hit, reach
  5 ft · 1d12 + 4 slashing", summary truncates) with hover/left-accent affordance — no more
  boxes-in-boxes.
- **Common actions curated**: 5 primary chips (Dodge/Dash/Disengage/Help/Hide) + "More ▾" for
  the other 11 builtins, one line instead of five.
- **Roster collapse**: the lobby ActorRoster (huge per-character cards) collapses to one
  "Characters & claims" line while combat is active — it duplicated the tracker at ~5× size.
- Verified live at 1440/375 px: 33 px rows, popover no-shift, Enter-damage, menu contents, page
  height accounting. Full check/tests/build green.

## 2026-07-19 — Tracker density overhaul (owner rejected the accordion pass; same branch/PR #38)

The accordion pass still produced a paint-roller of a panel (~1822 px for 10 combatants). The real
structural fixes, measured with Playwright bounding boxes:

- **Floating popovers, not inline expanders**: a row's tools (HP editor with Enter-to-damage,
  condition/effect editors, Open sheet) open OVER the list (`.row-tools-popover` + click-away
  backdrop) — other rows provably don't move.
- **Controls behind ⋯**: rules mode, underwater, dock position, add-combatant, and End encounter
  all moved into one topbar menu next to compact Prev/Next. Nothing occasional is inline anymore.
- **Dense one-line rows**: `[initiative | name + condition badges | R | HP]` at **33 px** (was ~3×).
- **The real bloat culprit — the builtin catalog**: milestone 3's 16 generic actions (Dodge, Dash,
  Unarmed Strike…) rendered as full rows on every active combatant (~900 px). They're now one
  wrapped chip cluster ("Common"); prose traits collapse behind "Traits & reference (n)".
- **Result**: tracker for 10 combatants incl. the active runner 1468 → ~700 px; whole panel
  1822 → ~1100 px; verified at 1440 and 375 px, Enter-damage + menu + popover all exercised live.

## 2026-07-19 — Round-2 live-testing fixes: footprint distance, tab-free encounter start, multiattack flow, collapsed tracker (same branch/PR #38)

Owner's first live-testing round reported five issues; four fixed fully, one partially (the
maps/scenes IA got its worst frictions removed; the full redesign is queued):

- **Footprint-aware distance (bugs 1+3, engine).** All rules-facing distances were center-to-center,
  so a Medium attacker adjacent to a Large/Huge creature read 7.5–10 ft ("out of reach") and a big
  mover's OA never triggered. New `creatureDistance`/`tokenCreatureDistance`
  (movement-narration.ts): edge-to-edge per the SRD (grid: Chebyshev cells minus each footprint's
  half-width; scaled gridless: minus token radius beyond its central cell). Wired through action
  resolve range checks + advantage sources, OA reach checks (`applyMovementRules` gains a
  `creatureDistance` input), and movement narration. 4 regression tests.
- **Encounter start needed a Maps-tab visit (bug 4a).** `selectedMap` only hydrated when MapManager
  mounted. The App now fetches the map library at GM login (and on returning to the Encounter tab),
  defaults to the newest battlemap, and encounter setup carries its own battlemap `<select>`.
- **Multiattack ergonomics (bug 5).** Tapping Multiattack mid-instance was a violation ("no attacks
  remaining" → override). Now it's a continue (reports the remaining plan); blocked component
  messages name what's left ("no Bite left — remaining: 1× Tail"); client instance notes/hints name
  components; the Multiattack row hints "In progress — pick the next attack". Regression test.
- **Combat tracker collapse-by-default (bug 2).** GM initiative rows are one line (name +
  inline condition badges + R/HP/score); an accordion expands one row's tools (HP editor,
  condition/effect editors, Open sheet). Enter in the HP amount applies damage. Save/reaction
  prompts and the dying tracker stay always-visible. Active row keeps economy + ActionRunner.
- **Scenes flow (bug 4b, partial).** ScenePanel gets its own battlemap picker (same library), so
  preparing a scene works from the Encounter tab's Scene-prep modal without tab bouncing. The
  fuller maps/upload/browse IA redesign is deliberately deferred (needs a design pass).
- **Verification**: check green; 347 server + 61 package tests; build green; live Playwright smoke
  13/14 checks + narration line "Torva entered the map — Giant Crocodile 5 ft" proving edge-to-edge
  (the one "failure" was a smoke regex expecting "moved" for a tray entry); desktop + 375 px shots.

## 2026-07-19 — SRD gap closure tiers A–D (ADR-0020 second amendment, same branch/PR #38)

Owner asked for a comprehensive review of the SRD 5e combat rules (an external SRD-mirror repo —
verified identical to the in-repo SRD 5.2.1, which served as the citation source) and full
implementation. A rule-by-rule inventory vs the engine produced four tiers, all approved
(all-tiers scope; GM-adjudicated inputs where vision/terrain/inventory subsystems are deliberately
absent; only the cheap niche trio):

- **Tier A — conditions**: frightened/invisible/grappled-vs-grappler/charmed-charmer modifiers,
  paralyzed auto-crit, physical-save auto-fail (manual total = GM escape hatch), restrained
  Dex-save disadvantage, exhaustion teeth (−2×level, level 6 = death, −5 ft/level), petrified
  resist-all + poison immunity, `conditionImmunities` skip-with-narration (stripped from players).
- **Tier B — builtins**: the eleven 2024 generic actions + Unarmed Strike/Grapple/Shove/Escape as
  a frozen-id catalog (`builtin-actions.ts`) usable by any combatant; Dodge/Disengage/Dash/Help/
  Ready grant typed effects (`voidWhileIncapacitated`); Hide → Stealth vs DC 15 → Invisible-linked
  reveal-on-attack; grapples as escapable source-linked effects (DC 8+Str+PB, one-size cap,
  incapacitated grappler releases).
- **Tier C — movement/OA/range**: `speedFeet` + `turn.movementUsedFeet` budgets (Dash ×2, speed-0
  conditions, prone stand cost, `actor.set-speed`, GM-only override), opportunity attacks as
  `leaves-reach` reaction prompts answered by a real off-turn melee resolve with auto-applied
  damage (hidden movers prompt no one — viewer safety), range/reach/long-range/close-combat
  checks, ETL normal/max range bands.
- **Tier D — cover/concentration/surprise/rests/niche**: GM-selected cover (+2/+5 AC and Dex
  saves, overridable `cover.total`), concentration (one-at-a-time, CON save DC
  min(30, max(10, ⌊dmg/2⌋)) on damage, incapacitation/0-HP breaks), surprise = min of two d20s,
  short rest re-arms per-short-rest pools only, underwater toggle (`encounter.set-environment`),
  nonlethal knock-out (KO button), falling-damage dice helper. Rest logic extracted to `rests.ts`.
- **Verification**: regression suite 35 → 81 tests (SRD-cited per block); suites 341 server / 16
  contract / 23 rules / 7 schema / 15 content; check + build green; api-reference regenerated.
  ADR-0020 second amendment (items 13–17 + new deferred list); assessment §3b/§4 refreshed;
  BUILD_PLAN MVP-022. Follow-up: Parry/damage-taken triggers, triggered features, difficult
  terrain, spell slots, import compatibility states.

## 2026-07-18 — Rules engine slice 2: reactions, incapacitation, availability API, archive v3 (same branch/PR #38)

Owner sent a follow-up milestone prompt written without baseline knowledge; per instruction it was
reviewed and corrected first — the assessment + remaining-work roadmap lives in
`docs/product/rules-engine-followup-assessment.md` (kept: strict-by-default modes and one-command-
one-roll instances; substituted: in-repo SRD sources for the external mirror). Then the largest
coherent remaining slice shipped on the same PR:

- **Reaction prompts (Uncanny Dodge).** `reaction {trigger, response}` vocabulary on ActionSchema;
  a qualifying hit parks its typed damage on `combat.pendingReactions` instead of the apply button;
  `reaction.answer` applies half (use — spends the reaction) or full (decline); `reaction.dismiss`
  (GM) drops without damage. Eligibility: reaction free, not incapacitated, not freeform. Prompts
  persist until answered (parked damage is never lost). Pip's fixture carries the declaration.
- **Incapacitation gating**: `condition.incapacitated` violations for action/bonus/reaction while
  Incapacitated/Paralyzed/Petrified/Stunned/Unconscious — same strict/assisted/override ladder.
- **Available-actions read** (`GET .../actors/{id}/available-actions` + socket): per-action
  availability from the *shared* `evaluateActionEconomy` (report can't drift from enforcement),
  with rule violations, uses remaining, instance counts. GM any; player own claimed only.
- **Archive v3**: additive `postEncounterState` (aftermath after encounter.end's sweeps — Frenzy's
  Exhaustion now recorded); finalState unchanged. 47 commands total now.
- **Client**: reaction prompt rows (GM all / player own) beside save prompts; ActionRunner replaces
  its apply button with a waiting note while a prompt is open (double-apply impossible).
- **Verification**: regression suite 25 → 35 tests (prompt lifecycle, gating, availability); +HTTP
  availability test; archive/projection/scope pins updated; api-reference regenerated; suites 288
  server / 16 contract / 23 rules+schemas green; full check + build green. ADR-0020 amended (items
  9–12).

## 2026-07-18 — Combat rules engine (ADR-0020) (`claude/vtt-combat-rules-validation-hkw7tn`)

Owner-directed from a forensic diff of two archived runs of one encounter (manual GM run vs
API-scripted recreation) plus a gap-analysis report: the engine recorded mechanics but didn't own
them. Direction: legal action = easiest path, clear explanations, explicit audited GM overrides.

- **Mechanics vocabulary (additive on schemaVersion 1).** ActionSchema: `attack.count`,
  `attack.criticalBonusDice`, `multiattack`, `onHit` riders (conditions + escape DC + size cap),
  `targetRules`, `grants` (effects with typed modifiers/durations/onEnd/endsWithTag),
  `requiresEffectTag`, `uses` (turn/encounter/long-rest + shared pools). ActorDefinition: typed
  `damageResistances/Immunities/Vulnerabilities/conditionImmunities`. JSON-schema twin regenerated
  (fixed its pre-existing missing-`save` drift) and now pinned against the enriched fixtures.
- **Validated resolution.** Per-encounter `rulesMode` (strict default/assisted/freeform);
  action.resolve validates economy + compound-action instances (generic attack pool so Extra Attack
  mixes weapons; actionId components for Multiattack) + requirements + uses on the actor's own turn;
  rejections carry `blocked {rule, overridable}` (socket ack + HTTP 409 details) and re-sending with
  `override:{reason}` bypasses with a loud `override` log line. Prose-only Multiattack degrades
  blocking to warnings. Manual `turn.use` stays free and clears the instance when un-marking.
- **Effects engine** (`effects.ts`): EffectInstances on actors with source links, durations
  (rounds/until-source-next-turn/encounter/manual), linked conditions, escape DCs, onEnd grants,
  endsWithTag cascades (Frenzy's Exhaustion fires exactly once however the Rage ends), grant
  refresh-not-stack, turn-boundary expiry, source-defeat release (0 HP or removal), encounter-end
  sweep scoped to the fight's combatants (parked scenes keep theirs).
- **Typed damage + dying.** `actor.apply-damage` accepts typed `parts` → immunity/resistance/
  vulnerability from definition + active effects with a per-part breakdown ("17 bludgeoning → 8,
  resistance: Rage") logged and returned; amount-only stays exact. All five HP entry points share
  the zero-HP machine: PCs drop dying (Unconscious+Prone+death saves; crit = 2 failures; overflow ≥
  max = instant death; stabilization resets counters), `death-save.roll` runs the d20 pipeline,
  heal/set-hp above 0 restores consciousness; non-PCs at 0 release sustained effects.
- **Advantage aggregation** with explainable sources (Reckless out/in, prone 2024 distance rule via
  token distance, restrained/poisoned/blinded/stunned/paralyzed/petrified/unconscious,
  unconscious-adjacent auto-crit); explicit `rollMode` wins; sources shown in result + archived.
- **Commands/API.** New `effect.add`, `effect.end`, `death-save.roll`, `encounter.set-rules-mode`,
  `actor.rest` through operations layer + both transports + OpenAPI (45 commands now); damage/
  resolve/encounter.start requests extended additively; capabilities gains `rulesEngine: true`;
  api-reference regenerated; `turn.use` contract wording updated (no longer "never enforced").
- **ETL enrichment** (confident patterns only, fail-open): 126/178 Multiattacks structured, 47
  on-hit riders (crocodile Bite = Grappled+Restrained, escape DC 15, Large cap), 146 monsters with
  typed defenses; giant-crocodile Tail `not-grappled-by-source` via reviewed ACTION_ENRICHMENTS.
- **Client.** Action rows show availability hints but stay tappable (server authority) with a
  blocked→override dialog; "N attacks remaining" instance notes; typed apply with breakdown
  feedback; effect chips (+end), dying tracker with death-save roll (GM + owning player), rules-mode
  select. Projections: PlayerEffect strips source ids/masks hidden names; actionUses own-only;
  hidden-turn instance masked; viewer untouched.
- **Verification.** New 25-test replay-derived regression suite + rules-5e combat unit tests;
  timeline restore now covers effects/deathSaves/actionUses; suites: 277 server / 16 contract /
  23 rules / 7 schema / 15 content green; full check + build green. Playwright smoke still pending
  this session (documented below).
- **Unsupported (deliberate, listed in ADR-0020):** reaction prompts (Uncanny Dodge), triggered
  features (Relentless Endurance, Dark One's Blessing, Sneak Attack *eligibility*), concentration/
  Hex, movement legality, rolled grapple escapes, player action.resolve, monster death policies,
  ruleset declarations, structured recharge/legendary.

## 2026-07-18 — Public Open API v1 core (PR F) + Time Machine v2 (`claude/open-api-core-m75t9d`)

Owner-directed: RESTful API foundation with core endpoints working, maximum integration openness;
webhooks explicitly deferred; archive should save as much fight data as possible in the current format.

- **Operations extraction.** All core combat capabilities moved out of the Socket.IO handlers into
  `game-operations.ts` (shared zod schemas in `game-commands.ts`); sockets + new `game-http.ts` REST
  routes are now thin adapters over identical functions — "same path, never a fork" is structural.
  Socket behavior/messages preserved exactly (whole suite passes unchanged).
- **API surface.** `GET /game` (GM-full / `?view=player`, weak-ETag polling), `GET /game/log`, ~30
  typed command routes, generic `POST /game/commands` tunnel + discoverable catalog, `/content/*`
  reads, `/encounters` archives under integration scopes. Principals: GM session, player session
  (player-limited), scoped integration credentials (GM authority). 409-conflict error contract with
  `currentRevision` + `needsConfirm`; idempotent `commandId` writes; CORS open on `/api`.
- **Time Machine v2.** Migration v5 journal table: every command while a fight is live journaled
  in-transaction with payload + principal; archive v2 adds `journal`, `finalState`, complete `rolls`,
  `definitions` (+`attribution`), strictly additive.
- **Contract.** OpenAPI 3.1 documents the entire surface (61 paths), served byte-identical;
  capabilities advertise `gameApi`/`commandTunnel`/`encounterArchives`; contract tests pin scopes.
- **Architecture review (subagent) — no blockers; fixes landed:** CORS wildcard scoped down to
  `/api/v1` only (wildcard on `/api/gm/login` would have let any web page relay password guesses
  through a LAN browser — negative tests added); per-command scopes single-sourced as
  `GAME_COMMAND_SCOPES` in `@vtt/api-contract` (registry + typed routes + doc all derive/pinned by
  test); `playerAuth` security scheme documented on exactly the player-usable operations;
  idempotency contract stated in the API description; per-verification credential audit writes
  throttled to one "used" row / 60s (polling would otherwise bloat the audit table). Dead credential
  `gameId` plumbing recorded in known-bugs (pre-existing).
- **API reference:** `docs/api-reference.md` is GENERATED from the contract
  (`packages/api-contract/src/reference.ts`, `npm run docs:generate -w @vtt/api-contract`); a
  freshness test fails whenever the contract changes without regenerating, so the reference cannot
  drift. Linked from README.
- **Verified:** `check`/`test` (284 total: 243 server incl. 8-test HTTP integration suite + journal
  unit tests + CORS/scope-drift tests, 16 contract incl. reference freshness)/`build` green; live
  smoke against the running service passed 17/17 external-integration steps (credential → discovery
  → map upload → snapshot views → REST encounter → ETag 304 → tunnel → idempotent retry → archive v2
  journal → revocation cutoff).
- **Follow-up slice landed the same session — full coverage:** claims (player-principal-only, GM
  force-release), token image/size cosmetics, and staged scenes (create/rename/remove/activate/
  combatants, `scene:write` scope) moved into the operations layer with typed routes + tunnel
  entries; `POST /api/v1/sessions/player` mirrors the socket's open join so pure-HTTP player
  clients exist. Every game command now has both adapters; the socket-only list is empty. 10 new
  commands in the catalog (40 total), contract + generated reference updated, 2 new end-to-end
  test blocks (claim lifecycle over HTTP incl. contested claim + force-release; scene staging incl.
  active-scene-removal rejection). 286 tests green across all workspaces.
- **Remaining follow-ups:** SSE stream, webhooks, rate limiting, credential `gameId` plumbing
  (known-bugs).

## 2026-07-18 — API reference polish: expandable specs, multi-language samples, spec export

Owner asks (readme.io-style reference, à la CompanyCam/AcculLynx): endpoints expand to full spec;
request examples in more languages (Python, PowerShell); export the complete spec.

- **Expandable endpoints** (`ApiReference.tsx`): clicking any endpoint reveals authorized
  principals, parameters, request-body fields (one nested level flattened), a runnable example
  request, and every response code with its data-payload field table — all resolved client-side
  from the fetched OpenAPI document's component schemas, lazy-rendered per endpoint.
- **Multi-language samples:** global Language selector (cURL / Python / PowerShell / JavaScript);
  each endpoint's example regenerates in the chosen language (curl, `requests`, `Invoke-RestMethod`
  here-string body, `fetch`) with a Copy button. Synthesized from the same schema/example-body data
  (Python dicts via a True/False/None literal formatter).
- **Export complete spec:** "⬇ Export OpenAPI spec" downloads the full OpenAPI 3.1 document
  (`vtt-openapi-v1.json`) for Postman / openapi-generator / etc.
- **Verified:** check/test/build green; live Playwright smoke extended — expands apply-damage and
  asserts fields + example + response codes; switches to Python (asserts `import requests` + dict
  payload) and PowerShell (asserts `Invoke-RestMethod -Method Post`); captures the spec download
  and validates it (openapi 3.1.0, 72 paths, components + /game/claims present). 0 console errors.

## 2026-07-18 — Encounter Replay + movement tracking + bonus-action toasts (same branch)

Owner asks: a GM-only "encounter replay" study tool; bonus actions missing from toasts; movement
absent from the Time Machine (wanted distance moved + old/new range to each creature).

- **Movement narration** (`movement-narration.ts` + `tokenMove` op): every live move logs a
  `movement` combat-log line — "Borin moved 20 ft — Mirena 5 ft → 15 ft." — measured like the
  ruler (Chebyshev × distancePerCell; gridless uses the saved scale; neither → numberless).
  Entering/leaving the map narrate too. Hidden combatants' ranges split into a GM-only line;
  a hidden mover is entirely GM-only. Lands in live log + archives. New log kind `movement`.
- **Toast fix:** `turn.use` with `used=true` now broadcasts "X used an action / a bonus action."
  (mirrors reactions; unmarking stays silent; hidden actor → GM-only). Verified over a live socket.
- **Encounter Replay:** new GM "Replays" tab; step/scrub/auto-play through an archive's turns —
  map + tokens per boundary (hidden dashed + HIDDEN tag), initiative with HP/conditions, per-turn
  log slice with GM-only tags; v2 archives add an Aftermath step. GM-gated endpoints only.
- **Verified:** check/test/build green (293 tests: +5 narration unit, +1 movement-log HTTP
  integration, +1 socket toast); live Playwright smoke drove the real built client end-to-end
  (seed fight via API → Replays tab → watch → step → mobile viewport), 0 console errors,
  screenshots captured. TokenMapGeometry gained optional `scale` so gridless distances work.
- **Same-day follow-ups (owner):** replay **Export JSON** buttons (viewer header + per list row)
  download the full archive document verbatim; smoke captures the download and re-parses it
  (schema 2, turns + journal intact). VTT Setup gains a **collapsible API reference** rendered
  live from the server's own `/api/v1/openapi.json` + command catalog (77 ops / 72 paths — can't
  go stale), and the credential form drops the dead `gameId` field (known-bugs mitigation).
  Smoke asserts the new endpoints (claims/sessions/scene commands) render on the page.

---

## 2026-07-17 — UX bug sweep, batch 2 (owner retest)

Second round from the owner's retest, same branch:

- **Ping expiry — real root cause.** Batch 1's re-arm was necessary but insufficient: `projectGmView`
  spread state verbatim and **never filtered expired annotations**, so a ping only vanished from the
  GM's own screen on the next add, not on the scheduled expiry re-broadcast (only the player/viewer
  projections filtered). `projectGmView` now takes `now` and filters expired annotations like the
  others. Regression test added.
- **#12 regression fix.** The batch-1 "dice fills the sidebar" change let the roll history grow
  unbounded and `align-items: stretch` stretched the whole row → huge dead space under the map.
  Reverted the fill; desktop grid is now `align-items: start` so a short column no longer forces
  dead space.
- **Markdown in reference text.** SRD descriptions carry `**bold**`, newlines, and `- ` bullets that
  showed raw in the CharacterSheet traits/actions and the tap-to-read reference rows. New inline-safe
  `RichText` (bold/br/bullets only) renders them.
- **Actions on the creature's row.** The current combatant's economy + `ActionRunner` moved from a
  detached block at the panel bottom to inline under that combatant's initiative row; dropped the
  redundant economy-strip name (which was being truncated by the Action/Bonus/Reaction buttons).
- **Above-map clutter.** "Preview what players see" moved below the map.

Verified: check / test (224, +2 GM-expiry regression) / build green. Browser pass is the owner's.

## 2026-07-17 — UX bug sweep (owner test pass, batch 1 of the UX/UI PR)

Six fixes from the owner's testing pass, on `claude/srd-content-pipeline` (kept on the same
branch per the owner):

- **#3 wheel scroll** — the map's `wheel` listener zoomed even when the pointer was over a
  docked panel; added the same `.closest()` guard the pointer-down handler already uses
  (`.encounter-map-dock/-overlay/-menu/-shape-editor`), so a docked initiative tracker scrolls
  on wheel instead of zooming the map.
- **#9 ping expiry** — `scheduleAnnotationExpiry` (and the viewer's `schedulePingExpiry`) armed
  only the *soonest* expiry and never re-armed, so a second staggered ping lingered until
  unrelated activity re-broadcast. Now it keeps one timer, clears stale ones, and re-arms from
  the callback → every ping/measurement drops at its own expiry.
- **#19 statblock z-index** — a docked panel's `.encounter-map-dock` (z-index 2) is a stacking
  context that trapped the sheet's fixed `.confirm-overlay` (z-50) beneath the map controls
  (z 3–6); `CharacterSheet` now `createPortal`s to `<body>` so it covers everything.
- **#10 turn nav** — Previous/Next moved above the initiative order (reachable without
  scrolling past the list).
- **#6 reference actions** — dashed reference-only action rows (no structured attack/save/
  damage) were dead on click; they're now buttons that expand the SRD reference text (touch-
  friendly, no hover-only tooltip) — reference level per ADR-0008.
- **#12 dice column** — on desktop the dice section now fills the sidebar beneath the panel and
  bottom-aligns with the map column (roll history grows instead of a fixed 19rem). *Needs an
  eyeball for exact top-of-map alignment.*

Verified: check / test (222) / build green. Browser pass is the owner's (their test loop).

**Queued (same 20-item list, later batches):** B — tracker docking (dock from enlarged map;
left/right-only + drag-resize). C — combat interaction (clickable targeting, AOE auto-apply,
right-click token menu, per-target saving-throw prompts, event toasts, off-turn reactions,
occupied-cell move cost). D — scenes/GM prep (#7). E — assets (token upload #13, map
save/organize #14). Parked: #17 (manual economy already ships), #11 (reference repos to
evaluate). Full triage in the session scratchpad backlog.

## 2026-07-17 — Post-A–G polish: token footprints, condition/health badges, PC sheet import

Three deferred slices, on `claude/srd-content-pipeline` atop phases A–G:

- **Token footprints.** `Actor.sizeCells` (1–4, derived from the definition's token
  footprint) drives multi-cell tokens: large 2×2, huge 3×3, gargantuan 4×4. The server owns
  the geometry — `encounterTokenAppearance`/`snappedPosition` size the token to the footprint
  and snap odd footprints centered on a cell (offset 0.5) vs even footprints on a grid
  intersection (offset 0); the client drag preview mirrors the same offset so placement is
  WYSIWYG. `EncounterTokenSchema` and start-encounter/roster wiring carry `sizeCells`.
- **Condition + health badges.** Map tokens gain a bloodied/down status dot and up to three
  condition-initial badges (+N overflow); the same coarse health band + condition labels now
  show in the **viewer** initiative and on viewer tokens. Viewer safety held: only bands and
  condition labels are projected — exact HP never reaches the public screen, and hidden
  actors are excluded (test-asserted no-leak).
- **PC sheet import.** GM imports a canonical `ActorDefinition` JSON from the roster
  (`actor:import-definition`, GM-only, 256 KB cap, schema-validated) as a claimable
  player-character. The stat block is stored in `GameState.definitions` and projected **only
  to the owning player**; `CharacterSheet` prefers the owned definition over a fetch so a
  player sees their full imported sheet while strangers see nothing. `removeActor` refuses a
  claimed PC and garbage-collects an orphaned imported definition.

Verified: check / test (222: +2 footprint, +3 import, viewer-safety + no-leak assertions
updated) / build all green. Browser pass deferred to the owner's manual test (their stated
plan) — the server-boot smoke was declined this session; viewer-safety and projection
invariants are covered by the automated suite.

**Follow-up:** owner tests these three, then merges `claude/srd-content-pipeline`. Next PR is
API + UX/UI (public API parity per PR F, plus UX polish).

## 2026-07-17 — Phase G: character sheet (track, never build) — plan complete

`CharacterSheet` overlay: live actor state (HP with in-sheet Dmg/Heal/Temp[/Set], the
shared ConditionEditor) over the immutable stat block — six abilities with modifiers and
save bonuses, AC + armor detail, speeds, senses/passive Perception, languages,
vulnerabilities/resistances/immunities, proficiency, traits and actions as full rules text,
CC-BY attribution line. Data via GM-gated `content:monster-sheet` (full ActorDefinition;
inert content). GM opens any combatant by tapping its initiative name; a player opens only
their own sheet from the you-are-playing card — a player token calling the stat-block fetch
directly is rejected (smoke-probed live). PC sheets show live data + a "no imported sheet
yet" note until character import (ADR-018 path) lands. Sheet typeline verified against 2024
rules quirks (goblins are Small fey, CR shown as 1/4).

Verified: check/test (216)/build green; live Playwright — goblin sheet renders all
sections, in-sheet heal 5 → 8/10 then damage 2 → 6/10 with the initiative chip tracking,
PC sheet note shown, player own-sheet works, player stat-block probe rejected ("Only the
GM can read stat blocks."); zero page errors.

**This completes phases A–G of the SRD combat-content integration** — offline bundle →
instantiate → HP → conditions → economy/End Turn → action resolution → sheets. Known
deferred items: token footprints/condition badges on tokens, viewer HP/condition display,
PC imports (ADR-018), API parity (PR F), movement enforcement.

## 2026-07-17 — Phase F: targeting + stat-block action resolution

The convergence phase: content + dice + HP + economy meet. Server
(`action-resolution.ts`, `action:resolve`, GM-only): resolves a definition action — d20 +
bonus vs the target's AC (nat 20 = crit with dice-only doubling via parsed-term transform,
nat 1 = fumble, AC-less targets report "unknown" but still propose damage), save actions
surface DC+ability across up to 20 targets with one damage roll, typed damage parts rolled
with the authoritative grammar. Every roll lands in the shared history attributed to the
attacker (visibility gm-only when the attacker is hidden). Economy auto-marks
(action/bonus on own turn, reactions any time). Damage is PROPOSED, never auto-applied —
application is an explicit `actor:apply-damage` tap (BUILD_PLAN Propose→Apply ladder), so
temp-HP absorption etc. ride the existing pipeline. `content:monster-actions` read feeds
the client. Client: `ActionRunner` under the GM economy strip — stat-block action list
(structured summary chips; unstructured actions shown as reference rows), radio/checkbox
target picker with ACs, result card (outcome, damage breakdown, Apply / per-target
Full-Half-None for saves).

Verified: check/test (216: +6 resolution tests — hit/miss/crit/fumble/unknown-AC, save
multi-target, hidden-attacker visibility, economy marking, validation)/build green; live
Playwright — the (GM-only) Goblin Boss's Scimitar hit Borin 19 vs AC 18, damage 3 applied
through temp HP first (24/28+8 → 24/28+5), rolls in history as "Goblin Boss · Just me
(GM)"; zero page errors.

**Follow-up:** Phase G (character-sheet panel). PCs still lack definitions, so the runner
is monster-only until sheet import lands (later phases per ADR-0018).

## 2026-07-17 — Phase E: turn economy + player End Turn

Action economy becomes tracked state (never enforced — ADR-0008). `CombatState` gains
`turn: {actionUsed, bonusActionUsed}` (current turn's actor, reset on any turn change) and
`reactionsUsed: actorId[]` (reactions are off-turn resources; an actor's id clears when
their own turn starts — 5e refresh timing, wired into next/previous/start/end reducers).
Server: `turn-economy.ts` — `setTurnSlot` (player only on their character's turn),
`setReactionUsed` (player only their own character, any time), `endTurn` (player End Turn =
the GM's Next gated to their own turn). Projection: a hidden combatant's turn stays opaque
(economy flags read idle; reactionsUsed filtered to public actors — test-asserted with a
no-leak JSON check). Client: GM Turn order gains an economy strip for the current actor
(Action/Bonus/Reaction, pressed = spent, strikethrough); players get their own strip —
Action/Bonus + End turn on their turn, Reaction always.

Verified: check/test (210: +4 turn-economy tests)/build green; live Playwright — GM toggles
action, Next resets it; player claims a PC, spends reaction OFF-turn, sees it refresh when
their turn starts, spends action, hits End turn and the GM's strip advances to the next
combatant; zero page errors. (Smoke infra: stale claims from prior runs now force-released
first.)

**Follow-up:** Phase F (targeting + action resolution through the dice engine) — the
convergence phase. Movement tracking/enforcement stays deferred per BUILD_PLAN.

## 2026-07-17 — Phase D: condition tracking (reference level)

Conditions become trackable state. `Actor.conditions` (additive: `{id, level?}` entries,
level = exhaustion 1-6). Server: `actor-conditions.ts` `setCondition` reducer (sorted,
idempotent, level rules) reusing the hp `ActorScope` (renamed from HpScope — GM anyone,
player own character); handler validates the id against the bundled 15 via ContentLibrary;
`content:conditions` read (any joined session — reference text is public). Per ADR-0008
this is reference level: displayed with SRD text, never auto-applied to rolls. Client:
shared `conditions.tsx` — `ConditionChips` (tooltips carry rules text) + `ConditionEditor`
(chips + 15-condition picker, exhaustion level stepper), used in GM initiative rows, player
initiative (client-side join from actors), roster cards, and the you-are-playing card
(player self-marking). The smoke exposed a cache-poisoning bug (a transient failed fetch
bricked condition names for the session) — replaced with a never-cache-failure pub-sub that
retries on picker open.

Verified: check/test (206: +3 condition tests — set/clear/sort/idempotence, exhaustion
levels + level rejection on others, player scoping + public projection)/build green; live
Playwright — GM sets/unsets conditions from the row picker, steps Exhaustion to 3 on a PC;
player sees the chips and self-marks Poisoned; tooltips loaded; narrow-viewport picker; zero
page errors.

**Follow-up:** Phase E (action economy + End Turn). Token condition badges + viewer
condition display deferred to a polish pass.

## 2026-07-17 — Phase C: hit-point tracking with band-safe projections

Server: `hit-points.ts` reducers — `applyDamage` (temp HP absorbs first, floor 0),
`healActor` (cap at max, never restores temp), `setTemporaryHp` (replace, not stack),
`setCurrentHp` (GM-only correction, clamped) — all scoped: GM adjusts anyone, a player only
their own claimed character. Four socket commands (`actor:apply-damage`/`heal`/
`set-temp-hp`/`set-hp`). **Projection change (viewer-safety relevant):** players now
receive exact hp only for player-characters; monsters/NPCs project as a `HealthBand`
("healthy" / "bloodied" ≤ half per 2024 rules / "down") — previously exact monster hp
reached players. `PlayerInitiativeEntry` gains `health`; the viewer picks fields explicitly
and a test asserts no health/hp key leaks there. Client: GM initiative rows get exact HP
chips (green/amber/red) expanding an inline Dmg/Heal/Temp/Set editor, down rows strike
through; player initiative shows Bloodied/Down chips; the you-are-playing card gains an
own-HP tracker (Damage/Heal/Temp).

Verified: check/test (203: +7 hit-point tests incl. band thresholds, ownership rejections,
viewer no-leak; 2 existing projection tests updated for the `health` field)/build green;
live Playwright — GM damages goblin 10/10→4/10 (bloodied) → temp 5 → heal 3 (7/10 +5) →
50 dmg → 0/10 struck-through Down; player claims PC, self-damages 28→24, sets temp +8;
player view shows only the band chip for the goblin with no exact "/10" anywhere in the
DOM; narrow-viewport HP editor pass; zero page errors.

**Follow-up:** Phase D (conditions). Dice→damage wiring is Phase F.

## 2026-07-17 — Phase B: SRD monsters instantiate into encounters

First consumer of the content bundle. Server: `ContentLibrary` (loads the monster bundle +
attribution once), reducers in `actor-roster.ts` (`addActorFromDefinition` — live HP=max,
AC, initiative bonus, name dedup "Goblin Warrior 2", `definitionId` provenance;
`removeActor` — refuses player-characters and active combatants, cleans stale inactive
initiative/token refs), three socket commands (`content:monsters` read, GM-gated;
`actor:add-from-definition` — commandId doubles as actorId for duplicate-safe acks, like
annotations; `actor:remove`). `Actor` schema gains optional `definitionId` (additive).
Client: `MonsterBrowser` overlay (search 330 monsters, CR/type/AC/HP rows, GM-only toggle,
CC-BY attribution footer) opened from encounter setup; per-row ✕ remove for non-PCs;
newly added actors auto-check into the combatant selection (found via live smoke — they
previously arrived unchecked and got left out of the fight).

Verified: check/test (196: +5 actor-roster incl. gm-only projection safety)/build green;
live Playwright end-to-end — browse→search→add×2 (dedup)→add hidden→remove→start
encounter→goblins in initiative; player context sees the public goblin, never the GM-only
boss; narrow-viewport pass; zero page errors.

**Follow-up:** Phase C (HP/damage/heal commands + sheet surface). Token footprints still
1×1 (definition retains the data). Content reads ride sockets; PR F owns API parity.

## 2026-07-17 — SRD 5.2.1 content pipeline (integration phase A, audited)

Reviewed 7 candidate content/tool repos with the owner; decision (ADR-0015): source SRD
content from **open5e `srd-2024` (CC BY 4.0)** — the only complete *structured* 2024
bestiary; 2014/OGL and third-party data excluded. Built the pipeline in
`packages/content-srd-5.2.1`: vendored fixtures, deterministic ETL/adapter (fail-closed
validation of every bundle), committed bundles, server-side loaders, 11 tests incl.
dice-grammar validation of every formula. `check`/`test` (189)/`build` green. Also merged
PR #32 (dock + declutter) after live verification.

Two audit passes then **cross-validated every statblock against an independent CC-BY copy
of the SRD text** — round 1: names/size/AC/HP/CR; round 2: all six ability scores, saving
throws, initiative, attack bonuses (both directions), all 339 spell headers, all 38 weapon
damage rows. Final result: **zero mismatches on every checked dimension**. Curation that
came out (documented in the package README + ETL tables): excluded `giant-fly` (no SRD
statblock), restored 25 Tiny sizes open5e flattens to small, fixed octopus CON/CHA +
mastiff/swarm-of-rats/octopus save values, restored greater-invisibility's empty
description, and added a **deterministic prose-attack parser** recovering 33 structured
attacks (mostly animals) that have no upstream attack rows. Bundles also carry **spells
(339, structured save/damage/upcast), weapons (38) + property/mastery texts (17), armor
(13, AC-derivation fields), skills (18), damage types (13), rules glossary (56)**.
Deliberately not bundled: classes/species/feats/backgrounds/magic items (char-builder/loot
scope). Attribution wording verified against the SRD's own Legal Information page. Runtime
proofs: package imports cleanly from the server source tree; live Playwright GM smoke green
with zero page errors; `npm ls` consistent; ETL hash-deterministic.

**Follow-up:** phase B — GM browses bundle + `actor:add-from-definition` command
instantiates monsters into encounters (then C HP/damage → D conditions → E action economy →
F targeting/resolution → G sheet panel).

## 2026-07-17 — Hooks + scheduled-workflow scaffold

Completed the remaining active outline items on the same branch:

- **Lifecycle hooks** (`.claude/settings.json` + `.claude/hooks/`, Node, fail-open):
  `danger-guard` (PreToolUse/Bash — deny catastrophic, ask on destructive),
  `scope-guard` (UserPromptSubmit — inject sensitive-area invariants as context),
  `stop-reminder` (Stop — non-blocking completion-hygiene nudge when code is
  uncommitted). Tested each with sample payloads. `.claude/hooks/README.md` documents
  them; `.gitignore` now ignores `.claude/settings.local.json`.
- **GitHub Actions schedule scaffold** (`.github/workflows/scheduled-ledger-drift.yml`):
  intentionally inert — cron commented out, `workflow_dispatch` only, placeholder job —
  the "bones" to configure later.

- **Optional reviewer subagents** (`.claude/agents/`): `ux-reviewer`, `test-reviewer`,
  `architecture-reviewer` — read-only, separate-context reviewers for large/cross-cutting
  changes, complementing the inline `vtt-ux-review` / `vtt-test-pass` skills. The outline
  marks these optional/sparing; delete them if you prefer inline-only review.

Opened PR #33 to `main`. This completes every item in the tooling outline except
configuring the (intentionally inert) scheduled workflow. Still no application code touched.

## 2026-07-17 — Claude Code tooling upgrade (foundation + scheduled slice)

Stood up the Claude Code tooling layer described in `docs/claude-code-tooling-outline.md`
(a small skill system, not a meta-agent). This session shipped the **foundation + scheduled
slice**:

- `CLAUDE.md` constitutional index (identity, commands, hard rules, context map).
- `docs/ai-context/` — 9 subsystem briefs seeded from a real code survey: product-vision,
  ux-principles, architecture, map-grid, viewer-mode, mobile-ux, realtime, auth-roles,
  testing.
- `docs/ai-ledger/` — current-state, decision-log, known-bugs, this file.
- `.claude/loop.md` — committed default `/loop` operator cadence.
- `.claude/skills/` — the full 9-skill roster: `vtt-task-packet`, `vtt-context-router`,
  `vtt-implement`, `vtt-qa-check`, `vtt-ledger-update`, `vtt-ux-review`, `vtt-test-pass`,
  `vtt-branch-safety`, `vtt-schedule` (the new scheduled-prompts/workflows item). This
  makes the packet → implement → QA → ledger workflow fully live.
- Added the **Scheduled prompts & workflows** section to the outline (key finding:
  session `/loop`/cron are runtime-only; `.claude/loop.md` + GitHub Actions `schedule:` are
  the code-committable pieces).

No application code touched — this is a tooling-only change on
`claude/code-improvements-outline-eqvh9n`.

**Follow-up:** hooks and the GitHub Actions scaffold were completed later the same day
(see the entry above).

## Before 2026-07-17 (context)

Cycle 4 merged to `main`: `#28` (batch A), `#29` (batch B), `#30` (PR C — per-drawing
colors, GM/player layer toggle, encounter pings). Cycle 4 PRs D/E/F planned in
`NEXT-STEPS.md`.

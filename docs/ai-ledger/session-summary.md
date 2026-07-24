# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

## 2026-07-24 — Sheet open-consistency + Dice toggle (`claude/character-sheet-discovery-a14i7f`, PR #45)

Three GM-reported follow-ups on how the player sheet opens. (1) The `IconButton` ✕ rode high/off-centre —
`.nh-iconbtn` relied on `place-items: center` but inherited a ~1.5 line-height, so the glyph's line box
overflowed; added `line-height: 1` (matches `.nh-modal-close`), centring the × in every icon button.
(2) Opening a sheet from a **map token right-click** now attaches the shared dice log — threaded the full
view (`state`) through `EncounterMap` to the sheet so its Sheet/Dice toggle works on the map (where no
other dice UI shows). (3) The three entry points (top-row "View sheet", initiative "My sheet" toggle, map
right-click) rendered inconsistently — "View sheet" docked the dice log beside the sheet in a wide two-pane
modal (the busier look the GM flagged), the others showed the sheet alone. Confirmed direction with the GM
(chose "clean sheet + Dice toggle") and unified all opens: the sheet always fills the panel at the normal
lg modal width; the dice log swaps in behind the header's **Sheet/Dice toggle** (one pane at a time, every
viewport) instead of docking beside it. Retired the desktop side-by-side dock — removed the dock-picker
(◧/◨), the sheet/log drag-resize handles, the `--sheet-width`/`--log-width` machinery, and the redundant
phone media query (net −34 lines). Diagnosis was render-driven: a headless before/after showed the sheet
content is identical at both widths, so the "worse" look was purely the docked log's presence, not a
layout bug. `check`+`build`+server `test` (422) green; header + ✕ centring render-verified light + dark.

**Follow-on (same day):** closed the toggle model's feedback gap (you had to open the Dice tab to see a roll
you just made). Two additions — a **pinned last-roll line** under the rolls bar (undocked): the most recent
roll from this character (label · dice · formula = total, from `state.rolls`), shown inline so tap-to-roll
gives immediate feedback, tap to jump to the full log; and an **opt-in dice dock** (header "Dock dice" /
"Undock dice", remembered per browser, desktop only) that pins the shared log beside the sheet as a fixed
22rem side panel (modal capped at 68rem — not the old sprawl). Default stays the clean single pane; the
pinned line hides when docked or on the Dice pane. `check`+`build`+`test` (422) green, both states
render-verified.

---

## 2026-07-23 — Character sheet design-system compliance pass (`claude/character-sheet-discovery-a14i7f`, PR #45)

Full audit of the player character sheet + its implementation against the design system, then a
*Pragmatic*-scope remediation (GM-confirmed): migrate the clear-win controls to `@vtt/ui` primitives and
tokenize the CSS, but **keep the elements tuned over six rounds** (re-styled onto tokens), migrating a tuned
element only where the primitive reproduces the look cleanly. Phases: **0** new tokens (`--fs-2xs`,
`--line-hover`) + fixed 2 phantom tokens; **1** IconButton (✕), Stepper (inventory qty), Button
(HP/rest/identity/coins/tools + all `ActorRoster` card buttons), SegmentedControl (roll-input, bonus-mode,
dock-picker, phone tabs, dice Table/Mine) — each deleted its bespoke CSS; **2** `Meter tone="health"` in the
HP tile (design language §6) + attunement `Badge`; **3** CSS sweep — both hardcoded colors removed (pip sheen
`white`→`--cyan-hi`; cast-`<select>` caret redrawn from `--text-dim` gradient halves since a data-URI can't
hold a `var()`), `50%`→`--radius-pill`, `2px`→`--radius-sm`, and the custom rem type scale snapped onto
`--fs-2xs/xs/sm/body` (render-gated, ≤1px shifts, no reflow); **4** same type sweep on the dice roll-card
cluster in `styles.css`, `/styleguide` updated. `SegmentedControl` gained backwards-compatible per-option
`ariaLabel`/`title` (+ optional `label`) so the icon-only dock picker announces a real name. Kept bespoke &
tokenized (evidence-based, screenshot-gated): the cast cluster, prep tags, slot pips, roll chips, item-category
tag, and the cyan-tinted filter/toggle pills (the `Chip` primitive's monochrome pressable state reads muddier).
Every phase: `check` + `build` + server `test` (422) green + headless render diff (light + dark). Durable
record: `docs/archive/product/character-sheet-styleguide-audit.md`. Follow-up (future, out of scope): a `Chip`
"selected accent" + mono variant would let the remaining pills/roll-chips migrate.

---

## 2026-07-23 — Scene IA PR review round (Encounter quick-switcher → button + popup)

Screenshot-review pass on the scene-centric IA PR (`claude/scene-prep-gm-notes-c1gcur`, draft #44).
The always-on Encounter-tab `SceneSwitcher` strip overflowed the map once a table had many scenes, so
it was retired: the Encounter tab now shows a compact **"Scenes" button** (labelled with the live
scene) that opens the gallery in a **picker popup**, and `SceneSwitcher.tsx`/`.css` were deleted.
Cards gained explicit **Prepare** + **Go live** buttons in opposite corners (shared `.nh-card-actions`
now flexes them so they never overflow a narrow card), a **command bar** with New scene sits above the
hub gallery, and the in-grid new-scene tile fills its cell. Popup cards render as **square panels** in
a widened dialog. Two correctness fixes: the **live card now counts combatants from the top-level
combat** (the active scene's own slot is empty by invariant — it was showing "0 combatants"), and
**Go live from the hub now lands on the Encounter tab** (live-play). Plus an a11y label on the Scenes
button and the `/styleguide` gallery demo refreshed to the action-button design. Verified: `check` +
`build` green, changed rules confirmed in the shipped CSS bundle. Design record + this note updated.

Follow-on batch (same round): **square scene cards on the Scenes tab too** (promoted the popup's 1:1
rule to the whole `.scene-gallery-hub`); **optional scene name** — an unnamed scene takes its map's
name (its image filename by default), and the map-upload name field is labelled optional (it already
defaulted to the filename); **auto-staging** — creating a scene now opens it for private staging via a
race-proof `pendingStageSceneId` that fires once the scene lands in state. Added a **roadmap note** for
a future **VTT Settings** tab (rename of VTT Setup) with a Global/Personal settings card — where an
"auto-staging on/off" personal setting will eventually gate the always-on behaviour shipped here
(`docs/ai-ledger/known-bugs.md`). `check` + `build` green.

Verified with a **full Playwright smoke** (GM, seeded map + 4-combatant live scene + 6 scenes):
**29/29 checks passed** at desktop-dark, mobile 390px, and light theme — strip→button+popup, square
cards (tab + popup), Prepare/Go-live with no overflow, the live card's real combatant count, command
bar + matching new-scene tile, duplicate, menu-reorder, Go-live→Encounter-tab, and unnamed-scene
auto-stage taking the map's name.

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

## Earlier sessions (2026-07-17 → 07-21, condensed)

Compressed history — the durable outcomes below are all reflected in `current-state.md`.
Newest first.

**2026-07-21 (PR #40, unmerged; PR #38).** Token health on the map (`combat.healthDisplay`
{band|bar|ring|aura, gm|all} + per-token override, audience gate resolved server-side so exact
HP never leaks) + single-source shared `InitiativeRow` (player panel = viewer, active-on-top) +
scene-setup picker (pinned PCs / server-tracked recent / search); two review rounds refined the
aura, the right-click Health/Show-to selects, the active-on-top restructure, and the map-height
setup panel. On PR #38, the **unified roll UX** — a shared `RollControls` widget put death saves,
attacks, and opportunity attacks on one preview→confirm flow (`commit`/`attackNatural`), editable
damage Apply.

**2026-07-19 (PR #38; ADR-0020 second amendment; ADR-0022).** Foundry/AboveVTT design-study
adoption pack (recharge abilities, legendary actions + Legendary Resistance, hit dice, condition
glyphs, scene thumbnails, manual fog of war v1 = ADR-0022) + SRD combat-rules gap closure tiers
A–D (81-test SRD-cited suite: conditions, the 2024 builtin-action catalog, movement/OA/range,
cover/concentration/surprise/rests) + a multi-pass initiative-tracker redesign landing
Foundry-anatomy rows with GM/player parity (and the later-retired Scene IA strip). Live testing
added footprint-aware **edge-to-edge** creature distance for reach/range/OA.

**2026-07-18 (PR #38; PR F).** Combat rules engine (ADR-0020: validated resolution per `rulesMode`,
effects engine, typed damage, advantage aggregation, PC dying state machine) + slice 2 (reaction
prompts, incapacitation gating, available-actions read, archive v3) + Public Open API v1 core (PR F:
transport-agnostic operations layer, ~40 typed command routes + command tunnel, OpenAPI 3.1,
generated `docs/api-reference.md`) + Time Machine v2 (migration v5 command journal, archive schema 2)
+ Encounter Replay tool + movement narration + bonus-action toasts, plus API-reference polish
(expandable endpoints, multi-language samples, spec export).

**2026-07-17 (branch `srd-content-pipeline`; PR #32, PR #33).** SRD 5.2.1 content pipeline phases
A–G (ADR-0015: open5e `srd-2024`, CC BY 4.0; 330 monsters + spells/weapons/armor/skills;
instantiate → HP → conditions → turn economy → action resolution → character sheet) + post-A–G
polish (token footprints, token/viewer condition & health badges, PC sheet import = ADR-0018) + two
owner UX bug-sweep batches; and the **Claude Code tooling foundation** — `CLAUDE.md` index,
`docs/ai-context/` briefs, this ledger, the `.claude/skills/` roster, three lifecycle hooks, optional
reviewer subagents, and an inert GitHub Actions schedule scaffold (merged as PR #32 dock/declutter +
PR #33 tooling).

**Before 2026-07-17.** Cycle 4 merged to `main`: `#28` (batch A), `#29` (batch B), `#30` (PR C —
per-drawing colors, GM/player layer toggle, encounter pings); Cycle 4 PRs D/E/F were planned in the
now-archived `NEXT-STEPS.md`.

For the maintained snapshot of what all of this shipped, read `current-state.md`; for full
per-session detail, see git history.

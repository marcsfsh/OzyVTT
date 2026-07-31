# Session summary

**Read this when:** you want recent context — what the last few sessions did — without
replaying full chat history. Add a short entry after meaningful work; periodically compress
old entries into `current-state.md` and trim this file.

Newest first. Keep each entry to a few lines: what changed, why, and any follow-up.

---

## 2026-07-31 — Codex overhaul, Lane A: API truth (`claude/ozyvtt-codex-ux-4pl7ib`)

The API lane of the Codex overhaul. Two commits: the published contract (`c7fc8aa`) and the router that
now honours it (`5f78d87`). 1499 tests, up from 1474.

The Codex became credential-reachable (`codex:read` / `codex:write`, GM grade, `preview-session`
excepted); 401 was narrowed to "no parseable credential" and everything presented-and-refused became
403; the ten player response shapes were published as `*Player` components joined to their GM twin by a
`*Projected` `oneOf`, guarded by a disjointness contract test **and** an Ajv cross-check over real GM and
player bodies for the whole read surface. Router plumbing: request-id echo (now reaching the error body),
`details.issues`, `error.currentRevision` on stale-`expectedRev` 409s, weak ETags + 304 on all 21 codex
GETs, sanitized 500s. Docs: the reference generator's request-only seed was the ~84-ghost-component bug —
fixed, 91 → 241 rendered shared shapes; `archiveSchemaVersion` interpolated; `info.description` and the
Conventions section stopped promising an API-wide `commandId`; **ADR-0016 accepted** with its normative
v1 conventions statement, pinned against the generated reference by a five-phrase agreement test.

Two latent contract bugs surfaced while making `oneOf` sound: `CodexChronicleRecord` was a merged
GM/player shape (a player body matched both branches), and `CodexCalendar` left two keys optional that
the GM projection always emits.

**Follow-up (handed to the back-end lane, in writing):** every NEW codex route — import/restore,
pin-by-id, party location, the connections family — plus the `commandId` receipts machinery. A contract
entry for an unmounted route fails route-table parity immediately, so each must land with its route.

## 2026-07-29 — Codex Phase 4 M9–M11 (`claude/codex-phase-4-m9-54sebz`)

Sessions/prep/recap (M9), quests (M10), and deadlines/downtime with a private prep clock (M11).
1331 tests, up from 1196 at the start. Built by layer-split agents (store / server boundary / client)
against a frozen contract per milestone, then integrated and verified by the Director.

**Seven owner decisions were settled**, four in M9 and three in M11: no backfill of legacy session
numbers; an active session; players can read a quest; a session's number is hidden until it is
revealed; the GM gets a **private prep clock** (players keep the old date until it is published);
deadlines and downtime are hidden-but-revealable like anything else; and downtime **proposes** a date
the GM confirms rather than moving the clock itself.

**The spec was wrong in two load-bearing places, and only checking found it.** M11 is described as
"one additive column"; the journal table has rejected every kind but `note` and `combat` since
migration v1, and SQLite cannot widen a CHECK in place — so M11 rebuilds the table. The same section
calls the calendar reflow the programme's sharpest risk; the reflow reads only the calendar's *shape*,
so moving the date rewrites every dated record with identical values. Both established by running SQL,
not by reading it.

**What testing missed, and why.** The client suite mocks the server and the server suite writes its
own request bodies, so a request the app sends and the server rejects passes both — that seam hid a
downtime state reachable in one click that failed with a raw 400. The API-contract test compares the
served document to the package copy, so **both** can drift from the code they describe; one such drift
shipped and was caught only by reading the schema beside it. And the M11 implementation contract itself
mandated a viewer-safety leak (a player-facing "fired" flag derived from the GM's private clock) while
forbidding it two sections later — both server agents caught that independently.

**Adversarial review earned its place again.** It found a HIGH defect nothing else had: editing a
deadline could clear its date, leaving a record that reads "Approaching" forever and can never fire —
two clicks from the Journal, past a create-path guard that had always been there. Plus a silent
regression where a *new* campaign's first date never reached players. Both reproduced through the real
routes before fixing, and both fixed with the leak direction mutation-proven.

Follow-ups in `known-bugs.md`: the client's date arithmetic can drift a day from the server's in one
edge case (harmless today, still drives the timeline's Today marker); `apps/client/test/setup.ts` sits
outside the tsconfig and is never typechecked; migration v15's failure mode is total rather than
partial; a calendar reshape can flip a revealed deadline back to "Approaching". M12 and a three-lens
final QA remain.

## 2026-07-27 — Homebrew content system (`claude/dndbeyond-sheet-importer-0k6u2e`)

Eleven commits, ~15k lines. A GM can author, publish and play nine content types. Built by a staged
team: 6 research intakes → 3 implementation plans → 3 rounds of 3 implementers → 3 adversarial QA
passes → remediation. 923 tests.

Sixteen product decisions were settled up front (own SQLite tables Codex-style; GM-only; all nine
types; full typed riders; structured forms; duplicate AND blank slate; invalid drafts, valid publish;
auto-namespaced ids; soft-delete; a creation-time visibility toggle; export/import; own GM tab; no
balance guardrails). The durable engineering rules that came out of it are in `decision-log.md`.

**QA is what made this work.** Five HIGH defects survived nine commits, four planning documents and
six research intakes — and not one was found by reading. A homebrew class could not be published in
either order (each rule waited on the other). The editor's default "add a feature" produced an
uncreatable character. Editing a published record bypassed the publish gate entirely, silently, via
autosave. A monster's name reached players through an imported pack id. And **no feat had ever been
publishable** — two independent causes pointing at the same wrong key, in a type that had shipped
three rounds earlier.

Two of those lived in the seam between engineers who had each verified their own slice honestly,
which is the argument for adversarial QA as its own stage rather than more careful implementation.

Also worth remembering: a test written in round 2 and praised at the time turned out to be
self-referential — its obligation set came from the renderer it was testing, so it could not fail.
A different engineer found it in round 3 while working on something else, and fixing it exposed a
pre-existing documentation hole unrelated to this project.

Open items, including the largest remaining piece of approved scope (magic-item riders are not yet
authorable — the equipment schema is `.strict()` and would reject them), are in `known-bugs.md`.

## 2026-07-27 — Phase 5: all twelve SRD classes (`claude/dndbeyond-sheet-importer-0k6u2e`)

The bundle had 3 of 12 classes. It now has 12, with one subclass each. The interesting part was not
the content but discovering **why** it was missing: the open5e fixtures this package vendors ship no
class, subclass, species, background or feat data at all, so the seven bundles that drive character
creation were hand-authored against nothing — which is exactly where both licensing violations
landed. Backgrounds, incidentally, were never a gap: SRD 5.2.1 licenses exactly four.

Fixed by vendoring a commit-pinned CC BY 4.0 SRD 5.2.1 markdown transcription and generating from it
(`scripts/build-class-bundle.ts`). Edition was checked before licence — a 2014-SRD transcription
would have reintroduced the same violation class. The source is **secondary** by construction and
earned that standing by reproducing the three hand-authored classes exactly; the generator uses them
as its oracle and fails the build on disagreement rather than regenerating them, because they carry
typed riders prose cannot express.

Numbers were checked against the SRD, not assumed: Warlock pact slots 1@1 → 2@2 → 2@3 → 3@5 → 4@5,
full casters 4/3/3/3/3/2/2/1/1, half casters 4/3/3/3/2, Barbarian rages 2–6, Rogue sneak attack
1d6–10d6, Monk martial arts 1d6–1d12. Rogue's ASI levels came out [4,8,10,12,16] — the extra one at
10 is Rogue-specific and the parser found it unprompted.

**One real bug the new content exposed:** the assembly read `spellSlots` only, so a Warlock — whose
slots are all of one level and rise by replacing it — came out with a caster block and no slots. The
branch was unreachable until a class with pact magic existed. Fixed and pinned by a test.

Two tests were pinning the incomplete state (Barbarian having no subclasses; Barbarian as the
example of an un-authored class) and now assert the real invariant instead.

`check` clean, **778 tests** (was 767), build green. Verified by creating one level-5 character of
every class through the real server assembly: 12/12, HP correct per hit die, slots correct per
caster type. Champion feature-level discrepancy and the prose-only-features caveat are in
`known-bugs.md`.

## 2026-07-27 — Character-builder readiness pass (`claude/dndbeyond-sheet-importer-0k6u2e`)

A dedicated shipping-readiness review of the seven-step wizard, bounded to small/medium lift (deep
system reworks explicitly out of scope). Three chains — flow/IA, density/layout, design language +
copy — each reviewing adversarially, then implementing. Landed as `479cb80`, `5c32df9`, `584be3a`.

Highest-value outcomes: one real **correctness** bug (a background silently grants skills, so
re-picking one burned both picks and left the character a proficiency short, silently — now greyed
with provenance); **step 4 made readable at high level** (L5: 9,545px/2,007 elements → 782px/92;
L20: 24,222px → 1,933px) by folding answered offers to chips and stating the capacity notice once
per grid rather than 409 times; the **step rail now means "done" rather than "visited"**; the wizard
**stopped defaulting all three ASI improvements to +2 Strength**; and a selected choice card
**had no keyboard focus ring at all** (a (0,4,0) glow-suppressor out-specified both the primitive's
ring and the global `:where()` one, which also sets `outline:none`).

Three times an implementer overrode its own handed plan and was right to — all recorded in the commit
messages: refusing to disable `expertise` (would have made every Wizard L2+ uncreatable), a 3-line
rather than 2-line clamp (2 re-cut "and 8 GP"), and a third CSS rule the plan didn't anticipate (the
app's bare `button:hover` beat the selected state independently). Memoising the catalogs **exposed** a
latent effect-deps bug rather than fixing a slow one.

A tenth reviewer then certified the pass rather than summarising it, and **found a defect the other
nine missed**: a Wizard 2+ could complete all seven steps and be rejected at Create, because the
expertise step offered six skills while the server accepts only the ones the character is proficient
in (~4-in-6 odds of dead-ending). Fixed with the **inverse** grey in `withExpertiseReach` — a second
pass, because the server's test is a union over sources rather than a step-order accumulation — plus
a safety valve that never greys every option. Verified by A/B through the real server assembly.

The same reviewer corrected two figures on the record: step-4 arrival is **class-dependent** (Fighter
L20 = 62 cards, Wizard L20 = **467**, not the "~306" filed), and the `.nh-step--done` 1.97:1 failure
is the *glyph*, not the state — the marker's ring measures a passing 3.85:1 and the applicable rule
is 1.4.11, not 1.4.3.

`check` clean, 767 tests, build green. Deferred items are itemised in `known-bugs.md`; the five rules
that came out of the pass are in `decision-log.md`. **Top follow-up:** `apps/client` and
`packages/ui` have no tests at all, so the 767 cover none of the changed code — and `build-payload.ts`
is pure and trivially testable.

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

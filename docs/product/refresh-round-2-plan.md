# Refresh round 2 — the client's feedback, categorized, and the plan to work it

**Status:** waves 1-5 landed 2026-08-06; phase 3 QA in progress. Category A and B are shipped; C, D and E are shipped except where a ruling below is marked open.
**Read this when:** picking up the round-2 work, or after a context compaction lost the thread.

This document exists because the work below spans many sessions and the plan must outlive any one
of them. It is the source of truth for scope and sequencing until the six phases are done.

Round 1 was the "screen is the page" refresh (phases A, B, C — see `docs/ai-ledger/current-state.md`).
Round 2 is a client feedback pass taken while logged in as a **GM**, laptop width, on the running app.

---

## The rule that governs this document

Feedback arrives as symptoms. The categories below separate **what is broken** (fix it) from **what
is unsatisfying** (design it), because those need different processes and different amounts of the
client's time. An item's category is a claim that can be wrong — recon may move an item, and moving
one is a finding, not a failure.

---

## Category A — pure bugs

Something does not work. The fix restores intended behaviour; no new design is required.
**Process:** a 1-agent full intake produces a detailed fix plan, then implementation.

| # | Issue | Where |
|---|---|---|
| A1 | **Fullscreen map is broken.** The map tools bar blows up to an enormous size covering the whole map. | `apps/client/src/scene/MapToolbar.tsx`, `apps/client/src/scene/encounter-map.css` |
| A2 | **The health ring is broken.** With health display set to the ring, the entire token becomes a solid colour instead of just the ring. GM and player both. | `apps/client/src/scene/EncounterMap.tsx` |
| A4 | **The Codex sidebar's collapse control is off-centre** (towards the right) while the sidebar is collapsed. | `apps/client/src/codex/CodexShell.tsx`, `apps/client/src/codex/codex.css` |
| A5 | **Adding a monster gives no feedback.** The screen jumps slightly and reads as a glitch, so a GM may add the same monster several times before noticing the first one worked. | `apps/client/src/encounter/MonsterBrowser.tsx` |
| A6 | **The full API reference should open in a new browser tab.** At half width it is very hard to read. | `apps/client/src/integrations/ApiReference.tsx` |

**Recon outcome (2026-08-05).** All items confirmed in category except **A3, which moved A → D**:
the character-creation door does not exist, nothing is broken. `/builder` works perfectly when typed
into the address bar, both gates are open, and the only `navigate("/builder")` in the client is
GM-gated. It is a placement decision — see D12.

**A1 and two of C5's three symptoms are one bug.** Two descendant selectors in
`apps/client/src/scene/encounter-map.css` (`:34`, `:89`) match every `<svg>` in the stage, not just
the map's own. Scoping them to the direct child fixes the fullscreen blow-up, the 2.5× toolbar icon
mismatch, and the "mis-coloured border" (which is not a border — it is an opaque `--void` tile behind
each glyph). **Fix as one change, not two lanes.**

**A2 is four call sites, not one.** The ring defect (`.hp-fill-*` beating `fill: none` at equal
specificity, declared later) is duplicated in `apps/client/src/viewer/viewer.css`, and the **bar**
has the identical mirror defect with `stroke`. One change, four sites.

**A-deferred:** fullscreen does nothing at all on mobile. The client said to hold off if fixing it is
significant work — treat as out of scope for round 2 unless A1's diagnosis makes it nearly free.

---

## Category B — copy and label trims

Text that costs vertical space or reads badly. Mechanical, no design decisions, rides with A.

| # | Issue |
|---|---|
| B1 | Scenes tab helper text: contains an em-dash, wraps to two lines. Shorten **and** move it left of the word "Scenes" — that alone takes the gallery from two-and-a-squished-third rows to three at 1080p. |
| B2 | Remove "GM Prep" from the Scenes tab — prep is not necessarily done there and the label does not help. |
| B3 | Roster tab helper text: em-dash again; should be a very brief description of the tab's function, if it is needed at all. |
| B4 | Replays: remove the "every finished fight, kept" helper text. |
| B5 | The dice panel's "DICE / Roll dice" is two lines; "Roll dice" alone is sufficient. |
| B6 | Remove the "On this map" label in the scenes popup — its meaning is unclear and it costs a row. |

**Standing copy rule for this round:** no em-dashes in helper text, and helper text earns its
vertical space or it goes.

---

## Category C — component and design-system redesign

The component is not broken; it is wrong for the identity. **Needs discovery before implementation.**

| # | Issue |
|---|---|
| C1 | **Rounded "bubble" pills are out of place** in the redesign. Examples: Action/Bonus/Reaction under the creature panel, dice-roll labels ("INITIATIVE") in the roll tray. They recur throughout the Codex and Homebrew tabs. |
| C2 | **Segmented toggles are hard to read** (Digital/Manual, Auto-add bonus/Final total). The on-state is a lighter/darker shade of the same colour; it needs a **secondary colour** to carry the state. |
| C3 | **Switch toggles** ("Shown to players") share C1's bubble problem. Keep the magenta — that colour is right — and carry it into the new design. |
| C4 | C2 and C3 must end up feeling like siblings, **but must not merge into one control.** They mean different things. |
| C5 | **Map tools are mismatched.** The cursor, ping and ruler buttons are far too big relative to Draw / Fog / View. Every button and label has a mis-coloured border, and the toolbar's background differs slightly from the icon/label backgrounds. |
| C6 | **Codex control sizes are mismatched.** The search field is too tall next to "+ New page"; the "Name" and kind dropdowns likewise. The "Shown to players" pill is oversized and its label is not optically centred against the eye icon — the label is probably unnecessary; an indicator is enough. |

---

## Category D — layout and information architecture

Real estate and structure. **Needs discovery.**

| # | Issue |
|---|---|
| D1 | **Two Scenes buttons.** Remove the top-left "Scene" button (at least while a scene is live or being prepped) to give the map back its vertical space. The bottom-right "Scenes" popup gains a "view all scenes" action to replace it. |
| D2 | **The Scenes popup has nested borders** producing significant dead space. |
| D3 | **The collapsed recent-monsters list does not look collapsed.** It reads as something you scroll, but it must be clicked. Keep the click-to-expand behaviour; add an affordance that says so. |
| D4 | **"Preview what players see" eats too much room** below the map. Move and reshape it so it stops taking the map's vertical space. |
| D5 | **The dice tray and combat log are laid out badly against the map.** The combat log is hard to notice at all; the dice area is so large the roll log shows just under four rolls at 1080p and scrolls horizontally. Specific levers the client named: compact the falling-damage entry; shorten the modifier stepper (much dead space in the buttons and field); make Advantage/Disadvantage more prominent using the **clipped-corner style of the "New Homebrew" button**, smaller; adjust the "Who sees it?" dropdown; remove the gaps between the dice / combat-log / encounter areas. **And the big one: the combat log becomes a small popup list.** |
| D6 | **Scenes gallery cards are mostly text.** The thumbnail often gets only 35–40% of the card. Drop the map filename; move the character and monster counts into badges in the thumbnail's top-left, opposite the drag/overflow controls. |
| D7 | **The Codex reads as stitched-together panels**, largely from varying panel heights and the top-left label area beside the search bar. Contributors: the "Shown to players" toggle, History, Delete, and the saved checkmark. A GM can end up with three separately-scrolling panels on one page. |
| D8 | **Shared screen: a revoked session should move to a revoked-displays list.** The paired-displays list should show only active pairings. |
| D9 | **Players need a "My character" tab** — the first tab, before Table. It holds their sheet, shows the other (non-archived) party members, and lets them open **read-only** versions of other players' sheets. A GM setting disables that visibility; **default is that players can see them.** |
| D10 | **Two buttons say "My sheet"** on the player's table — one inside an Initiative/My sheet toggle, one on the character bar. Remove the toggle; leave a single "My sheet" button in the initiative area that opens the sheet the way the character bar's button does today. |
| D12 | **Where does a player's create-a-character door live?** (was A3.) The wizard works and both gates are open; there is simply no link. `apps/client/src/actors/ClaimCharacter.tsx:72` already puts one self-serve path — the D&D Beyond PDF import — on the exact screen where this belongs. Same question applies to levelling (`apps/client/src/builder/LevelFlow.tsx:67` gates on the same policy). |
| D11 | **The player's character bar over the map eats a lot of real estate** (and its teal bubble border is a C1 instance). D9 is the preferred fix rather than merely restyling the bar. |

---

## Category E — identity and motion

The largest and least specified category. **Needs the most discovery.**

| # | Issue |
|---|---|
| E1 | **The app feels too square and basic next to its own landing page.** The landing's "Join as Player" / "Enter as GM" buttons are the target quality; only a nerfed, simplified version of that style appears inside the app, and infrequently. There is a strong disconnect between the landing experience and the app, and **the landing is much closer to what the client wants.** |
| E2 | The button is a **microcosm, not the issue**: panels have no design, and there is no retrowave flair in any shape or layout beyond a few buttons. The rest is square panels. |
| E3 | **The landing→app transition is close but wrong in feel**: slightly too fast, a little glitchy/jumpy. The grid/sun movement should be slower and more dramatic — **total 2–2.5s, hard ceiling 3s.** |
| E4 | **In-app tab and page transitions do not feel retrowave.** Too smooth, too basic — part of the same disconnect. |
| E5 | **The tab bar stays out of the way, which is right, but leans too far into it.** It could be more prominent *without resizing*, and is a good opportunity for retrowave character — though explicitly not the only one. |

---

## Sequencing

### Intake (before implementation)
1. **2-agent recon** — minimal, read-only. Confirm each item's category, find the responsible files,
   and flag any item that is mis-categorized. Recon may move items between A/B/C/D/E.
2. **1-agent full intake on A + B** → a detailed fix plan for the pure bugs and copy trims.
3. **2-agent intake on C + D + E** → the context needed to ask good questions, then a
   **10-round discovery process with the client** to settle the design work.

### Implementation — six phases
| Phase | Who | What |
|---|---|---|
| 0 | 1 agent | Any remaining intake, only if needed |
| 1 | director | A detailed implementation plan for a 3-agent team |
| 2 | 3 agents | Implementation |
| 3 | 3 agents | **Adversarial QA, review-only** |
| 4 | 1 agent | Intake the QA findings, plan the fixes |
| 5 | 2 agents | Implement the QA fixes |
| 6 | director | Final polish pass, personally |

### Rules carried from round 1 (these were learned the hard way)
- **One file, one owner.** Parallel agents share one working tree with no merge step; two writers
  means one agent's work is destroyed silently.
- **No agent edits the ratchet files** (`apps/client/src/design-conventions.test.ts`,
  `apps/client/src/design-conventions-shape.ts`). They report deltas; the director reconciles from a
  measured scan, because several lanes move the same counters and deltas do not simply add.
- **Verify in the states you did not design for.** Round 1's build lanes each verified portrait at
  the widths in their brief and shipped three critical failures in landscape, at 320px and out of
  combat. Landscape and short panes are not edge cases.
- **A measurement beats an instruction.** Three round-1 lanes were told to do something that
  measurement showed was wrong, and were right to override it. Say so in the report when it happens.

---

## Known-open items inherited from round 1

Not part of this feedback, still owed, listed so they are not lost:

- The route audit (`scripts/no-scroll-audit.mjs`) is **red on 14 cells across five surfaces** —
  `/scenes`, `/scenes/maps`, `/roster`, `/homebrew`, `/replays/:id`. Always broken, never measured
  until the audit grew from 3 viewports to 9. Needs owners. **Do not delete a viewport to go green.**
- Landscape phone table is *usable, not good* — it scrolls. The real answer is a map-beside-sheet
  composition, which needs a height axis the breakpoint ladder does not have.
- `.pane-stage` retirement is done, but the class's last references live in prose only.
- The active initiative row is 759–808px, so no viewport ever shows all four rows fully.
- `packages/ui/src/primitives/Steps.tsx` needs a fourth `available` state; a jumpable step currently
  looks identical to a locked one on touch, because its only affordance is `:hover`.
- `apps/server/test/` is not typechecked — 46 errors across 10 of 91 files, all test-side drift.
- `Borin Stoneguard` never appears in the player's claim picker.

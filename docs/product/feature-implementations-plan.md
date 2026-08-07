# Feature implementations — the client's issue register and the plan to work it

**Status:** issues logged 2026-08-07; **D1, D2 and D3 decided 2026-08-07**. Intake not started. No
plan written yet. Nothing implemented.
**Read this when:** picking up this work, or after a context compaction lost the thread.

This document exists because the work below spans many sessions and must outlive any one of them.
It is the source of truth for **scope** until every issue here is closed or explicitly withdrawn.

The issues were reported by the client from the running app, playing as both GM and player. They are
recorded here **before** any intake, so that no issue can be lost to a context roll, and so that
"we addressed everything" is a checkable claim rather than a memory.

---

## The rules that govern this document

1. **Every issue below gets addressed in this branch.** An issue may be re-scoped, split, or
   deferred with a stated reason — it may not be silently dropped.
2. **The client's numbering is the canonical ID.** `2e` means `2e` forever. Do not renumber; a
   shared vocabulary between the client, this document and the PR is worth more than a tidy scheme.
3. **Observed / Expected is the client's report. "Recon note" is our inference.** Recon notes come
   from the 2026-08-07 three-agent intake and may be wrong. Where a recon note and the code
   disagree, the code wins and the note is a defect — fix it in place.
4. **An issue's size is a claim that can be wrong.** Intake may find a one-line fix is a subsystem,
   or the reverse. Discovering that is a finding, not a failure.

---

## Process

Four areas, executed **strictly one at a time** in the execution phase:

| Phase | Shape |
|---|---|
| 1. Register | This document + the PR. **Done.** |
| 2. Intake | 4 agents, one per area, in parallel. Deeper than the 2026-08-07 recon. |
| 3. Plans | 4 detailed plans, one per area, logged into this document and the PR. |
| 4. Implementation | Per area, sequentially: **2 agents** implement the plan. |
| 5. Adversarial QA | Per area: **1 hostile reviewer**, which produces a fix plan rather than a verdict. |
| 6. QA fixes | Per area: **1 agent** implements that fix plan. |
| 7. Polish | Per area: **1 agent** final pass. |

24 agents total: 4 intake + (5 × 4 areas) execution.

---

## Area 1 — Character builder  (issues 1, 2a–2e)

### `1` — Exhausted option lists hide their unselected options instead of disabling them

**Observed.** In a limited-choice picker — e.g. an Elf's Keen Senses skill grant — once the maximum
number of options has been selected, every unselected option disappears from the list entirely.

**Expected.** Unselected options remain visible and become visibly disabled (greyed) once the
maximum is reached. A selected option can be clicked again to deselect it, which immediately
re-enables every other option. The user should always be able to see what they did *not* choose.

**Recon note.** `unavailableOf` in `apps/client/src/builder/build-payload.ts:268` already computes an
unavailable set; the greying behaviour may be a render-side change in `CharacterBuilder.tsx` rather
than a logic change. Confirm before designing.

---

### `2a` — Some classes present no feature content at all

**Observed.** Building a Warlock and reaching the class-features step shows only the fallback text
*"See the warlock class description in SRD 5.2.1."* Other classes, such as Cleric, show real
content.

**Expected.** Every class presents its actual features at the level being built. No class falls back
to a pointer at an external document.

**Recon note.** This is the visible surface of a content gap, not a rendering bug. The 2026-08-07
intake measured **9 of 12 classes carrying zero mechanical class features**, and 130 of 185 class
features being prose-only. Warlock in particular has 28 Eldritch Invocation options, **none** of
which carry any mechanical rider. Scope is settled by **D1**: all 12 classes, all levels.

---

### `2b` — Choosing a subclass populates nothing

**Observed.** The Cleric class step shows *"Pick a cleric subclass to read about it here."*
Selecting a subclass does not populate that panel — it stays empty or unchanged.

**Expected.** Selecting a subclass immediately renders that subclass's description and its features
at the level being built, in the panel that invited the click.

---

### `2c` — Spell rules are unreadable while choosing spells

**Observed.** During spell selection there is no way to read what a spell actually does. The user
must choose from names alone.

**Expected.** Each spell in a selection list carries a link that opens its full description and
rules — casting time, range, components, duration, damage/save, at-higher-levels — in a popup
overlay, leaving the selection state untouched behind it. A popup is specified rather than inline
expansion because these lists are multi-select and inline expansion would push the remaining
options off-screen.

**Recon note.** 211 of 339 bundled spells carry no `attackRoll`/`damage`/`save` — they are prose
only. The description text exists to display; the mechanical fields often do not.

---

### `2d` — No random character generator

**Observed.** There is no way to generate a character automatically.

**Expected.** A generator that produces a complete, playable, **single-class** character at a
specified level. It distributes the standard array optimally for the chosen class, and picks every
remaining option (species, background, subclass, skills, feats, spells, equipment) at random.
Available to the GM. A GM-controlled setting additionally permits players to generate a random
character for themselves — the same shape as the existing `builderPolicy.playerBuilder` gate.

**Sequencing.** This depends on `2a`/`2b`/`2e`: a randomly generated Warlock is only as playable as
Warlock's mechanical content. Generator work should follow the class-content work, not run beside it.

---

### `2e` — A finished character is missing most of its combat options

**Observed.** A Cleric was created and added to an encounter. On that Cleric's turn, logged in as the
player holding its claim, the only usable action was the one granted by its **Magic Initiate** feat.
Everything a Cleric should be able to do was absent.

**Expected.** Every action a character's class, subclass, species, background, feats and equipment
grant is present and usable on that character's turn, for the player who claims it.

**Recon note.** Same root cause as `2a`, and the same root as `3c`. Feats work because
roll-time riders reach the table through `character.feats` carriers in `deriveEquipment` — a **class
feature is not recorded by id on the definition**, so 13 of 21 rider variants are dropped for class,
species and background features (`apps/server/src/character-build.ts:716-722`). Closing that is a
schema change. Independently, the content itself is largely prose. Both halves must land for a
Cleric to have a turn. See decision **D1**.

---

## Area 2 — Homebrew  (issues 3a–3d)

### `3a` — Item rarity is free-form

**Observed.** Rarity on a homebrew item is not a constrained field.

**Expected.** A dropdown of the 5e rarities: Common, Uncommon, Rare, Very Rare, Legendary, Artifact
(plus Varies where the system needs it). No free text.

---

### `3b` — Limited-use configuration does not persist, and the shared pool is untyped

**Observed.** Two defects in the same control group:
- The **"Uses are"** dropdown will not hold a value. Whatever is selected, the field returns to
  *"Not set."*
- The **shared pool** field is free-form text, so it cannot refer to anything real.

**Expected.** The "Uses are" selection persists as chosen. The shared pool becomes a selection bound
to actual pools available on the character — choosing *Lay on Hands* means using this item spends a
Lay on Hands use, and the remaining uses are read from and written to that pool.

**Recon note.** The pool half depends on `classResources` becoming real: today
`ClassLevelRow.classResources` has **zero server readers** and is documented as display-only in both
`effective-actions.ts:73` and `character-content.ts:217`. There is currently no pool to bind to.
This connects directly to area 1's decision **D1**.

---

### `3c` — Homebrew items do not appear as combat options

**Observed.** A homebrew mace was created for the Cleric — 1 use per short rest, dealing an extra
1d6 lightning damage. In combat the item only ever prompts for its base slashing damage; the extra
lightning damage and the limited use never appear.

**Expected.** A homebrew item equipped by a character surfaces in that character's combat options
with every mechanical field the editor offered — extra damage and its type, limited uses, the
recharge basis — and consumes its uses when used.

**Recon note.** Equipment is the only fully-wired homebrew kind, so the derivation path exists.
Suspect the gap is between what the editor writes and what derivation reads. Related: the ledger's
D21 claim that *"every field the item editor offers reaches the fight"* was tested during recon and
is **false as written** — the covering test is equipment-only and leaves `armor.*` entirely,
weapon range bands, `cursed`, `rarity`, `grantsFeatIds`, top-level `modifiers`, top-level `uses`,
`tags` and four `grants.*` arrays uncovered.

---

### `3d` — Damage types are free-form everywhere

**Observed.** Damage type is an unconstrained field on items, on spells, and on
resistance/immunity/vulnerability entries.

**Expected.** Every damage-type field, everywhere it appears, is a dropdown of the 13 5e damage
types. This is the authoring half of `4a`; a typed value is worthless until the engine applies it,
and the engine cannot apply a value that was typed by hand.

---

## Area 3 — Combat encounters  (issues 4a–4i)

### `4a` — Damage types are not implemented

**Observed.** An attack that deals fire damage does not deal *fire* damage in any way the system
acts on. A creature or character with an active effect granting immunity, resistance or
vulnerability to a damage type has that effect ignored when damage of that type arrives.

**Expected.** Damage carries its type end to end. On receipt, active immunity / resistance /
vulnerability for that type is applied to the amount, and the applied adjustment is visible in the
feed so the table can see why the number changed.

**Recon note.** This is the deepest item on the register. The `damage-reduction` rider is explicitly
unread, with the reason recorded in `apps/server/src/character-build.ts:217-218`: *"no incoming-damage
path collects riders at all yet."* This is not a half-built feature — the incoming-damage path does
not exist. Expect new server surface, and expect `apps/server/test/` (see **H1**) to bite.

---

### `4b` — Save-for-damage results cannot be edited

**Observed.** Using an option that makes targets roll a saving throw and take damage — including the
common half-on-success case — auto-rolls the damage with no way to enter or amend the number. This
happens as GM and regardless of the dice-roll setting.

**Expected.** The damage amount is enterable. The dice-roll setting is honoured: where the table is
set to roll physically, the system asks for the number instead of inventing one, and the GM can
amend an auto-rolled value before it is applied.

---

### `4c` — The docked initiative panel ignores the scroll wheel

**Observed.** With the initiative panel docked inside the map, a mouse scroll wheel does not scroll
the initiative list. The only way to move through it is to drag.

**Expected.** The wheel scrolls the docked initiative list, without the event falling through to the
map's own zoom/pan handling.

---

### `4c.1` — Docked panel borders bleed into the panel edge

**Observed.** When docked, cyan borders on UI elements run into and past the edge of the panel.

**Expected.** Docked chrome respects the panel's bounds; no border crosses the frame.

---

### `4d` — Advantage / disadvantage buttons are too tall

**Observed.** In the dice-rolling panel, the advantage and disadvantage buttons are noticeably
taller than the modifier stepper beside them.

**Expected.** They match the modifier number-stepper's height exactly, and are aligned so their
bottom edges sit flush with the bottom of the stepper.

---

### `4e` — "Recent rolls" scrolls the wrong axis

**Observed.** At the default panel width, the recent-rolls list requires horizontal scrolling to
read a row.

**Expected.** Recent rolls scroll vertically only. Row content wraps or truncates to the available
width; the list never introduces a horizontal scrollbar at default width.

---

### `4f` — No pinch-to-zoom on the map on mobile  *(conditional)*

**Observed.** The map cannot be pinch-zoomed on a touch device.

**Expected.** Two-finger pinch zooms the map, alongside the existing pan.

**Explicitly conditional.** The client has asked us to **hold this item if it is a significant
lift.** Intake must return a sized estimate, and the decision to build or defer is the client's, not
ours. Do not start it without that decision.

---

### `4g` — The "Add to the fight" list overruns its panel, and its contents are unusable

**Observed.** Two defects, shown in the client's screenshot:
- The list grows past the bottom of its container and **paints over the content beneath it** —
  action buttons (Dodge / Dash / Disengage / Help / Hide / More) and spell text are visibly
  overlapped by list rows. This is a clipping/overflow failure, not merely a long list.
- The roster is every creature ever used in a fight, unbounded and unsorted — *Giant Crocodile 1–4*,
  *Hobgoblin Warrior 1–6*, *Hobgoblin Captain 1–4* and several dragons, all flat in one list.

**Expected.** The list is bounded by its container and scrolls within it, never painting outside its
frame. Its contents default to a **pre-collapsed list of the 10 most recent creatures**, matching
the pattern already used by the scene prep tool, with the remainder reachable behind an expand.

---

### `4h` — The map jumps when a token move finishes  *(regression)*

**Observed.** Moving a token shows the staging tray. On mouse release, the tray disappears and the
whole map jumps position.

**Expected.** Finishing a move does not move the map. The tray appearing and disappearing must not
change the map's layout or viewport.

**Recon note.** The client reports this was **fixed once before and has since returned**. Treat it
as a regression: find the original fix, determine what displaced it, and add the test that would
have caught the return. A fix without that test is not a fix.

---

### `4i` — "Launch from here" is blocked and clones characters unnecessarily

**Observed.** Two defects in replay launch:
- It refuses with a demand to unpark a prepared scene, and the UI offers **no visible way to unpark
  one**. The action is unreachable.
- When it does run, it recreates characters as *"Character Name (Replay)"* rather than using the
  existing characters.

**Expected.** Launching a replay is reachable from the replays tab without a dead-end prerequisite —
if a parked scene genuinely blocks it, the UI must offer the unpark, and if it does not genuinely
block it, the check is wrong. Launch reuses tonight's existing characters rather than minting
suffixed duplicates.

**Settled by D3.** The cloning is deliberate — `replay-launch.ts` clones everyone under new ids so a
historical replay can never rewrite tonight's characters — and it **stays**. What changes is that
the clones become invisible: scoped to the replay session, absent from the roster, no `"(Replay)"`
suffix, cleaned up when the replay ends. The unpark half is a straight bug and is fixed regardless.

**Recon note.** Related and separate: players cannot see a shared replay's map at all
(`apps/server/src/server.ts:438` refuses archived replay maps), which is worth fixing while we are here.

---

## Area 4 — Codex  (issues 5a–5f)

### `5a` — "Who played" is free-form

**Observed.** The session entry's *Who played* field is not bound to the characters that exist.

**Expected.** A selection field listing **active (unarchived) characters**. Archived characters
remain selectable but sit in a **pre-collapsed list** below the active ones, so a finished character
can still be recorded on a past session without cluttering the common case.

---

### `5a.1` — The player-visible / GM-only toggle is named differently everywhere

**Observed.** The two-layer notes toggle appears with a different label in each place it is used.
The session entry uses one pair of labels; each of the four journal kinds — Entry, Deadline,
Downtime, Milestone — uses its own similar-but-different pair.

**Expected.** One control, one pair of labels, everywhere the two-layer split is offered:
**"Player-visible notes"** and **"GM-only notes."** This is the canonical wording that `5c` also
adopts. Prefer a single shared component over synchronised copies.

**Recon note.** The repo already enforces vocabulary mechanically —
`apps/client/src/copy-scan.ts` drives `codex/vocabulary.test.ts` and `play-vocabulary.test.ts`.
The right fix registers the retired labels there so the inconsistency cannot come back.

---

### `5b` — Helper text under "Date played" shifts the field

**Observed.** The *Date played* field carries helper text beneath it, which pushes the whole field
upward and misaligns it against its neighbours.

**Expected.** The helper text is removed. The field aligns with the fields beside it.

---

### `5c` — Quest note labels use non-standard wording

**Observed.** Creating a quest offers a toggle labelled *"What the party was told"* and
*"GM notes."*

**Expected.** **"Player-visible notes"** and **"GM-only notes"** — the same canonical pair as `5a.1`.

---

### `5d` — Quest status options are too few

**Observed.** The available quest statuses do not cover the ordinary lifecycle of a quest.

**Expected.** The status set is expanded to include at least **"Not started"** and **"Canceled"**
alongside the existing values, and the default for a newly created quest is reconsidered in light of
"Not started" now existing.

---

### `5e.1` — Helper text under the downtime "Who" field shifts the field

**Observed.** Same defect as `5b`, on the downtime page's *Who* field.

**Expected.** Helper text removed; the field aligns with its neighbours.

---

### `5e.2` — The downtime "Activity" field height is mismatched

**Observed.** The *Activity* field is a different height from the *Who* and *Days* fields on the
same row.

**Expected.** All three fields share a height and sit on a common baseline.

---

### `5e.3` — The downtime "Who" field is free-form

**Observed.** Same defect as `5a`, on the downtime page.

**Expected.** The same character picker specified in `5a` — active characters listed, archived
characters in a pre-collapsed list below. This and `5a` should be one shared control, not two.

---

### `5e.4` — Confirming a pending downtime entry does nothing

**Observed.** Pressing **Confirm** on a pending downtime confirmation has no effect. The entry
remains pending.

**Expected.** Confirming applies the downtime and moves the entry out of the pending state, with the
result visible without a reload.

---

### `5f` — The calendar's two dates are opaque, coupled, and missing an era

**Observed.** Three distinct problems on the calendar tab:
- *Your date* and *Players' date* give no indication of how to set them when they are unset.
- Setting a date sets **both** at once.
- There is no way to advance or modify one without moving the other.
- There is no era field.

**Expected.** The two dates are independently settable and independently advanceable, with the
relationship between them stated in the UI rather than inferred — the GM's date may run ahead of the
players' date, and publishing the players' date is a deliberate act. Setting a date from the unset
state is discoverable. The date model gains an **era** component, so a date reads
**era · year · month · day**.

**Recon note.** Publishing the players' date is already its own route
(`apps/server/src/codex-http.ts:1743`), so the independence may exist server-side and be collapsed by
the client. Adding an era is a **stored-data change** — expect a migration and check
`chronicle.ts` / `dashboard.ts`, which hold real date-reading rules.

---

## Decisions taken  (2026-08-07)

### D1 — Class content: **all 12 classes, all levels**

Both halves are in scope:

1. **Plumbing.** Class, species and background features must be recorded by id on the definition so
   their riders reach the table. Today 13 of 21 rider variants are dropped for these carriers
   (`apps/server/src/character-build.ts:716-722`) because only `character.feats` carriers survive
   into `deriveEquipment`. This is a schema change and it gates everything else.
2. **Content.** Author the missing mechanical content for the 9 hollow classes **and** bring cleric,
   fighter and wizard to full parity — levels 1 through 20, subclasses included. Metamagic (10
   options), Eldritch Invocations (28 options) and the three inert fighting styles are all in scope.

This is the largest single body of work in the PR. `2a`, `2b`, `2e`, `2d` and `3b` are all
downstream of it.

**Reference material — the client has approved `foundryvtt/dnd5e` as an aid.**
Verified 2026-08-07: that repository is **MIT licensed** (Copyright 2021 Andrew Clayton). Commercial
use, modification and redistribution are permitted; the copyright notice and licence text must
travel with any substantial portion used. Its `LICENSE.txt` carries no separate content terms.

**How to use it, and how not to.** The rules *text* for every missing feature is **already vendored
here** — `bundles/attribution.json` records `dnd-5e-srd-markdown` as covering *"classes, subclasses,
class spell lists, species, backgrounds, feats."* The gap has never been missing text; it is that
the text was never translated into mechanical riders. So:

- **Use Foundry as a modelling reference** — how to represent Rage, Sneak Attack, Ki or an
  Invocation *as data*: which fields, what shape, where the edges are. That is where it is genuinely
  valuable and it keeps the licensing surface small.
- **Take rules text from our own SRD bundle**, not from Foundry. It is the source we already
  attribute under CC-BY-4.0 and it keeps the content internally consistent.
- **If any substantial structure is lifted**, add Foundry to `additionalSources` in
  `packages/content-srd-5.2.1/bundles/attribution.json` and carry the MIT notice. The mechanism
  already exists; use it rather than inventing a second one.

### D2 — Pinch-to-zoom (`4f`): **the client's original rule stands**

Intake returns a real estimate. If it is a contained change to the map's existing input handling, it
ships with Area 3. If it needs a rework of the gesture or viewport model, **stop and bring the
client the number before spending anything.** Do not start this item on an agent's own judgement.

### D3 — Replay characters (`4i`): **keep the clone, hide the clone**

The safeguard stays — a historical replay must never rewrite tonight's characters. What changes is
its visibility: clones are scoped to the replay session, never appear in the roster, never render a
`"(Replay)"` suffix, and are cleaned up when the replay ends.

The **other half of `4i` is unaffected and is a straight bug**: launch is blocked behind a demand to
unpark a prepared scene that the UI offers no way to satisfy. Fix that regardless — either the UI
offers the unpark, or the check is wrong.

## Standing hazards

| # | Hazard |
|---|---|
| **H1** | `apps/server/test/` is not typechecked (`"include": ["src"]`), hiding 41–46 latent errors across ~91 files. `4a` and `2e` both change server signatures and will surface them. Decide early whether to turn it on or wall it off. |
| **H2** | There is **no `docs/ai-context/` brief for the builder and none for homebrew** — the two worst-shape subsystems. The de-facto design documents are the file headers in `character-build.ts`, `character-content.ts`, `equipment-derivation.ts` and `effective-actions.ts`. |
| **H3** | Grepping for `TODO`/`FIXME`/`HACK` in this repo finds nothing and proves nothing. A whole-repo sweep during recon found ~1 marker. Gaps are encoded in prose, in file headers, and in typed partitions such as `CARRIER_RIDER_DISPOSITION`. |
| **H4** | The regression bar to copy is `apps/server/test/homebrew-inert-fields.test.ts`: it proves a link **at the far end** — a rolled number — never that a value merely survived derivation. |

---

## Plans

Not yet written. Phase 3 logs one section per area here, and mirrors it into the pull request.

- [ ] Area 1 — Character builder
- [ ] Area 2 — Homebrew
- [ ] Area 3 — Combat encounters
- [ ] Area 4 — Codex

# Feature implementations — the client's issue register and the plan to work it

**Status:** issues logged 2026-08-07; **D1–D7 decided**; **4-agent intake complete**; **plans written**.
**Area 1 in progress** — see below. Areas 2, 3 and 4 not started.

**Area 1 landed so far** (verified, not asserted): Stage 0 (`6205a01`) — `apps/server/tsconfig.json` is
`"include": ["src", "test"]` and the drift it hid is fixed. Stage 1 / `2a` (`78cc194`) — **149 class-feature
stubs → 0**, counted. Issues `1`, `2b`, `2c` (`d1f01cf`) — complete with 8 tests incl. negative controls.
Stage 2 / `2e` (`e60656d`) — **code written, NOT verified**: `feature-riders.test.ts` does not exist, so
nothing proves a class feature's rider reaches a roll. Read that commit's message before trusting it.
**Still open in Area 1:** Stage 2's far-end tests · Stage 3 (all four gaps absent) · Stage 4 content ·
Stage 5 weapon mastery · Stage 6 generator · **the `HAND_AUTHORED`-vs-overlay question, which blocks Stage 4.**

Tiers at `e60656d`: `npm run check` exit 0 · `npm run test` 162 files / **2,231 tests** / 0 failures
(baseline was 161 / 2,215).
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

> **Correction, 2026-08-07 (intake).** The original recon note here claimed *"the incoming-damage
> path does not exist."* **That was wrong.** The quoted comment at `character-build.ts:217-218` is
> about **riders**, not about damage. Verified at HEAD: `apps/server/src/hit-points.ts:65`
> `applyDamageDetailed` exists, collects defenses from four sources — definition RVI (`:50`), active
> effects (`effects.ts:235`), item grants (`deriveEquipment`), and Petrified/Underwater (`:88-90`) —
> and runs them through `packages/rules-5e/src/combat.ts:29 adjustDamageParts` (`hit-points.ts:91`).
> Three of six call sites already narrate the adjustment.
>
> **So the Observed above is false for definition RVI, active-effect resistance and item-granted
> resistance — those work.** It is true for exactly four things, and those are the real scope:
>
> 1. **Flat `damage-reduction` is unread.** The rider reaches `collectRiders` and nothing consumes it.
> 2. **Vulnerability has exactly one channel.** `damageVulnerabilities` is read only at
>    `hit-points.ts:54` and written only onto an `ActorDefinition`. `InterpretedFeatures`
>    (`character-build.ts:161-163`) carries resistances and immunities but **no** vulnerabilities;
>    `effectDamageDefenses` returns resistances only. **A player character can never be vulnerable,
>    and no effect or item can grant vulnerability to anything.**
> 3. **The adjustment is invisible on 3 of 6 paths.** `save.answer` and both reaction paths narrate
>    only the total — and `saving-throws.ts:306` discards `outcome.application.parts` into a bare
>    `appliedDamage`, so the client could not render it even if it wanted to.
> 4. **The untyped `amount` path** (`hit-points.ts:117-120`) deliberately skips all defense maths.
>    That is correct behaviour, but it is the GM's most-used entry point — which is very likely why
>    the table experiences "fire damage isn't fire damage."
>
> **Size drops from XL to L**, and the shape changes: this extends an existing pipeline rather than
> building one. Do not plan a new incoming-damage path — `applyDamageDetailed` is the single entry
> point and every call site already routes through it.

**Stacking rules** (SRD 5.2.1, as `combat.ts:29-42` already implements them and as they must stay):
immunity wins outright → 0; resistance halves rounding down; vulnerability doubles; **resistance and
vulnerability on the same type cancel to normal** rather than compounding; multiple sources of the
same resistance halve once. Flat reduction applies **after** all of that, per total, floored at 0.

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

> **Correction, 2026-08-07 (intake).** This section originally claimed *"the gap has never been
> missing text; it is that the text was never translated into mechanical riders."* **That was wrong**,
> and the error came from the 2026-08-07 recon. Measured at HEAD: **149 of 185 class features carry
> the literal stub string** `"See the <Class> class description in SRD 5.2.1."` — Monk 23/23,
> Barbarian 20/20, Rogue 19/19, Ranger 18/18, Paladin 18/18, Druid 14/14, Warlock 13/13, Bard 13/13,
> Sorcerer 11/11. Cleric, Fighter and Wizard are exempt because they are `HAND_AUTHORED` and skipped
> by the ETL.
>
> The prose is **not** missing — it is dropped by a slug mismatch in the bundle build.
> `featureProse` (`packages/content-srd-5.2.1/scripts/build-class-bundle.ts:133-146`) slugs the whole
> markdown heading, so `#### Level 1: Rage` becomes `level-1-rage`; the lookup asks for the level
> table's feature id, `rage`, misses, and falls through to the stub at `:557`. The subclass parser
> already gets this right by stripping `Level N:` first (`LEVEL_HEADING`, `:621`).
>
> **Consequence for the plan: `2a` splits in two.** Half of it is a **bug fix, size S** — key each
> heading under both slugs, regenerate `classes.v1.json`, and add a build assertion that no emitted
> description matches `/^See the .* in SRD 5\.2\.1\.$/` so the stub can never ship again. That alone
> closes `2a`'s observed symptom for all 149 features. The other half is the mechanical authoring
> below, which remains XL. Ship the prose fix first: it is the cheapest visible win in the PR and it
> makes the authoring reviewable, because an author can read the SRD text beside the record.

**Reference material — the client has approved `foundryvtt/dnd5e` as an aid.**
Verified 2026-08-07: that repository is **MIT licensed** (Copyright 2021 Andrew Clayton). Commercial
use, modification and redistribution are permitted; the copyright notice and licence text must
travel with any substantial portion used. Its `LICENSE.txt` carries no separate content terms.

**How to use it, and how not to.** The rules *text* for every missing feature is **already vendored
here** — `bundles/attribution.json` records `dnd-5e-srd-markdown` as covering *"classes, subclasses,
class spell lists, species, backgrounds, feats,"* and `sources/dnd-5e-srd-markdown/classes.md` is
298 KB of real prose. So:

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

### D4 — H1 typechecking: **turn it on first, in its own commit, before Area 1**

Two intake agents disagreed; the client took INTAKE-1's position. Sequence: (a) re-measure the error
count — the ledger's own figures disagree (41 in `known-bugs.md`, 46 across 10 of 91 in
`current-state.md`) and neither was verifiable before `npm install` ran; (b) fix the fixture and
signature drift; (c) flip `apps/server/tsconfig.json` to `"include": ["src", "test"]`; (d) update
`docs-tooling.test.ts` and delete the `known-bugs.md` entry. **Only then** does Area 1 start.

The reason: `2e` adds a field to `ActorDefinition.character` and ~91 server test files construct
definition literals. Left off, those breakages are invisible to `npm run check` and surface as Zod
errors at runtime during the largest content change in the repo.

### D5 — D1 schema gaps: **close both**

1. **Invocation vocabulary.** `extra-damage` gains the ability to name *an ability modifier* as its
   amount, and a `spell-id-is` trigger so a rider can attach to one specific spell. Without this,
   Agonizing Blast — the invocation nearly every Warlock takes — cannot be expressed, and the class
   reads as broken no matter how much prose lands.
2. **Weapon mastery, in full.** A `mastery` slug on all 38 weapon records, plus the nine named
   behaviours: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex. **Push, Topple and Slow touch
   movement and conditions, so this is new engine surface, not content authoring** — size it and
   stage it as engine work. INTAKE-1 recommended deferring this; the client chose to close it.

### D6 — Calendar K7 (`5f`): **keep auto-publish for seeding only, and make Publish visible**

Auto-publish survives only when a brand-new codex is being seeded. Otherwise it goes, and both
clocks always render with a Publish button always visible. Today Publish is hidden unless the dates
have diverged (`CalendarView.tsx:86,132`), so from the unset state there is no visible publish act at
all — that absence is the real reason the two dates felt welded together. `codex-store.ts:4185-4199`
is a dated decision and `codex-http.test.ts:1562` pins it: update both in the same change, and date
the reversal in `decision-log.md`.

### D7 — Manual damage (`4a`): **the GM's damage entry gains an optional type**

Defaulting to untyped, so today's fast path is unchanged. Choose a type and
resistance / immunity / vulnerability apply and the feed shows the adjustment. Without this, `4a` can
be fully implemented and the table would still watch untyped damage ignore resistance — because the
untyped `amount` path (`hit-points.ts:117-120`) is the most-used entry point and deliberately skips
the maths. Not required: the override remains available by leaving the type unset.

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

## Baseline

Measured at `0f96194`, after the first `npm install` this container has ever run:

| Tier | Result |
|---|---|
| `npm run check` | **exit 0** — 10 workspaces, 0 TypeScript errors |
| `npm run test` | **exit 0** — 8 workspaces, 161 test files, **2,215 tests**, 0 failures |

Hold every area against this. Red from here is ours, not inherited. **Expect Area 1 Stage 0 to turn
it red on purpose** — that is D4 working, not a regression.

---

# Plans

Written 2026-08-07 from the 4-agent intake. Four areas, executed **strictly one at a time**.

**Rules that bind every implementing agent:**

1. **Do not undo a deliberate decision to "fix" an issue.** Each plan names the ones in its path.
   If closing an issue genuinely requires reversing one, stop and say so — do not reverse it quietly.
2. **The far-end bar (H4).** A test proves a rolled number, a spent counter, a refusal, or rendered
   text. "The value survived derivation" is not a test.
3. **`npm run docs` is mandatory** after any command, HTTP, state or OpenAPI change. A test fails
   otherwise.
4. **Sizes are claims that can be wrong.** Discovering that is a finding; report it, don't absorb it.

---

## Area 1 — Character builder

**Issues:** `1`, `2a`, `2b`, `2c`, `2d`, `2e`. **Governed by D1, D4, D5.**
The largest area. Two lanes run in parallel after Stage 0: a **client lane** (cheap, visible) and a
**server/content lane** (deep, sequential).

### Stage 0 — H1 typechecking  *(D4; blocks the server/content lane)*

1. Re-measure. The ledger's figures disagree (41 in `known-bugs.md`, 46 across 10 of 91 in
   `current-state.md`) and neither was verifiable before `npm install`. **Produce the real count.**
2. Fix the fixture and signature drift. All of it is test-side; none is a product defect.
3. Flip `apps/server/tsconfig.json` to `"include": ["src", "test"]`.
4. Update `docs-tooling.test.ts`; delete the `known-bugs.md` entry rather than softening it.

**Acceptance:** `npm run check` exit 0 with server tests inside the program; the baseline's 2,215
tests still pass.

### Client lane — `1`, `2b`, `2c`  *(one agent; `1` and `2b` collide in the same file)*

**`1` — collapse threshold. Size S.**
Root cause is **not** `unavailableOf`, and `ChoiceGrid` **already implements the requested behaviour**
(`packages/ui/src/primitives/ChoiceGrid.tsx:129-134`, `:224-249` — greyed unchosen cards, chosen ones
still tappable). It is dead code. `OfferPicker` computes `collapsed = complete && !expanded`
(`apps/client/src/builder/CharacterBuilder.tsx:141`, with `collapsed` at `:149`) and the collapsed branch (`:206-212`)
**unmounts the whole grid**.
→ Add `COLLAPSE_THRESHOLD = 8` (the constant already gating `searchable` at `:218`) and use
`collapsed = foldable && complete && !expanded`. Separately, replace the feat *filter* at
`build-payload.ts:335-337` with an `unavailable` entry ("already on this character").
**Do not delete the collapse** — it is load-bearing: Wizard L20's answered step is 1,933px with it
and **24,222px** without.
*Tests:* Elf → Keen Senses → pick Perception → Insight and Survival still in the DOM and disabled;
re-click Perception → all three enabled. Negative control: a 203-option spell offer still folds.

**`2b` — conditional placeholder. Size S.**
The wiring is sound; the *invitation* is unconditional. `DETAIL_PLACEHOLDER.features`
(`CharacterBuilder.tsx:1032-1039`) always says "Pick a cleric subclass to read about it here", but
every SRD class has `subclassLevel: 3` and the draft defaults to level 1 — so at level 1–2 there is
**no subclass offer on the step at all**.
→ When `draft.level < classRecord.subclassLevel`, say so ("Clerics choose a Divine Domain at
level 3."). Below 761px the pane is master-detail and `onOpenDetail` is gated on `realDetail`
(`:1117`), so the placeholder is invisible on a phone — fix both.
**Reproduce at level 3+ in a browser before coding.** If the pane genuinely fails to populate there,
the fault is the reconcile effect's dependency list (`:399-404`) and that is a different fix.

**`2c` — spell popup. Size M.**
Both halves already exist: `SpellCard` (`apps/client/src/encounter/spells.tsx:118-133`) is exactly the
specified modal, and `catalogs.choice.spells` is already client-side. **No server or wire change.**
`ChoiceCard` **is** a `<button role="radio|checkbox">` (`ChoiceCard.tsx:56-81`), so nothing
interactive can nest inside it.
→ Add `action?: ReactNode` to `ChoiceCard`, rendered as a **sibling** of the button inside a new
`.nh-choice-wrap`; add `onInspect?` + `inspectLabel` to `ChoiceGridProps`. Use `Modal`, **not
`Drawer`** — `Drawer` has no scrim, focus trap or scroll lock (`Drawer.tsx:24-34`), and a stray tap
while reading a spell must not change a 203-card selection.
*Tests:* open Cure Wounds' info control → modal shows Casting Time/Range/description, `picks`
unchanged, Escape closes, still unchanged. **`node scripts/tap-audit.mjs 375`** — this adds 203
controls on the Wizard L20 step; each must clear 44px without overlapping the card's tap area at
320px, where cards are narrowest.

### Server/content lane

**Stage 1 — `2a` prose fix. Size S. Ship this first; it is the cheapest visible win in the PR.**
`featureProse` (`packages/content-srd-5.2.1/scripts/build-class-bundle.ts:133-146`) slugs the whole
heading, so `#### Level 1: Rage` → `level-1-rage`; the lookup asks for `rage` (`:555-557`), misses,
and falls through to the stub at `:557`. The subclass parser already strips `Level N:` first
(`LEVEL_HEADING`, `:621`).
→ Key each heading under **both** its raw slug and its `Level N:`-stripped slug. Regenerate
`classes.v1.json`. **Add a build-time assertion that no emitted description matches
`/^See the .* in SRD 5\.2\.1\.$/`** so the stub can never ship again.
*Tests:* for every class, every feature, `description` is not a stub and is longer than 60 chars.
Then a builder test that a Warlock 5 definition carries real Pact Magic text.

**Stage 2 — `2e` plumbing. Size L. Blocks all authoring.**
`interpretFeature` folds 8 of 21 rider variants; the other 13 reach the table only as
`RiderCarrier`s, and `deriveEquipment` builds carriers from `definition.character.feats` **alone**
(`equipment-derivation.ts:328-341`, `:391-396`). A class/subclass/species/background feature is not
recorded by id, so its riders stop at `character-build.ts:716-722`. `CARRIER_RIDER_DISPOSITION`
(`:206-220`) is the accurate map.
→ Mirror the feat solution exactly — it is proven and tested.
1. `ActorDefinitionSchema.character` gains additive
   `features: Array<{id, kind: "class"|"subclass"|"species"|"lineage"|"background"|"option", sourceId}>`
   (max ~80), written at `character-build.ts:969-983` from the `granted` array it already holds.
2. `EquipmentCatalog` gains `featureRecord?: (id) => FeatureRecordLike | undefined`; `content-library.ts`
   indexes every class/subclass/species/lineage/background feature and inline option by id.
3. New `characterFeatureCarriers(definition, catalog)` — a near-copy of `characterFeatCarriers`,
   same `ridesOnTheBearer` filter, no `sourceItemId`, appended at `:391-396`.
**Recompute; never persist the riders** — the reasoning at `:308-323` (no third copy, no projection
review, respec-safe) holds. **Old definitions with no `features` array must fail open (`?? []`).**
*Viewer safety:* a new field on `ActorDefinition` is a rule-3 change. It is derived from public SRD
content and carries no secret, but `docs-viewer-safety.test.ts` must be satisfied.
*Tests:* copy `apps/server/test/feat-riders.test.ts` wholesale to `feature-riders.test.ts` — 19 tests
that already prove riders at the far end. Author one homebrew class carrying one rider of each of the
13 carrier variants; build, fight, resolve, assert the number. Negative control per criterion.

**Stage 3 — schema gaps.** *(D5 + intake)*
- **Invocation vocabulary (D5).** `extra-damage` learns to name *an ability modifier* as its amount;
  add a `spell-id-is` trigger. Without both, Agonizing Blast cannot be expressed.
- **Ability cap (`maximum`).** All 7 epic boons are `choice{kind:"ability-score"}`; the offer consumer
  hard-clamps `Math.min(20, …)` at `character-build.ts:705` while the *modifier* path already honours
  `maximum` at `:733`. Give `FeatureChoiceSchema` a `maximum` and thread it through.
- **`scaling: {type: "class-resource", id}`** resolved through `grantedClassFeatures`'s
  `levelRow.classResources` in `resolvedUseLimit` (`character-build.ts:236-243`). One number, one
  place — the Rage column stops being authored twice.
- **Pools projection.** Add `pools: Array<{id, name, limit, per}>` to the character projection,
  derived from the definition's actions. **This is what Area 2's `3b` binds to.**

**Pools — do not build a new system.** The machinery exists and is live: `actor.actionUses[key]`
where `key = uses.pool ?? action.id`, spent and gated by `useLimitFor`
(`action-resolution.ts:174-182`), topped up by `usesBonus` (`effective-actions.ts:76-80`), re-armed by
`rests.ts:69` and `encounter.ts:32,290`. Cleric's Channel Divinity already uses it. **`classResources`
is a printed column, not a namespace** — bind them by convention and enforce with a content test: every
`classResources.id` either matches a `uses.pool` on that class, or is annotated `display: true`.

**Stage 4 — content authoring.** 242 records, 226 remaining (16 currently mechanical).
**SRD 5.2.1 ships exactly one subclass per class — 12 records, not 40.**

| Sub-stage | Body | Count |
|---|---|---|
| S1 | Levels 1–5, all 12 classes | 74 — *53% of the work, 100% of what a table plays first* |
| S2 | Option records (28 Invocations, 10 Metamagic, 3 fighting styles) | 41 |
| S3 | Subclass features 1–5 | 24 |
| S4 | Levels 6–10 (+19 subclass) | 25 |
| S5 | Levels 11–20 (+18 subclass) | 41 |
| S6 | Feats to parity — **only `defense` authors a modifier today**; `alert` grants no initiative | 11 |

Heaviest: Monk 19, Barbarian 16, Rogue 15, Paladin 14, Ranger 14. Cheapest: Wizard 7, Sorcerer 7.
**Each sub-stage is independently shippable.** Author against `sources/dnd-5e-srd-markdown/classes.md`;
use `foundryvtt/dnd5e` only for *shape*, per D1.

**Expressible today** (confirmed): Rage (effect grant + damage-bonus + damage-resistance + by-level
uses), Sneak Attack (`damageByLevel` + `pool` + `attack-kind-is`/`weapon-property-is`), Ki / Sorcery
Points / Channel Divinity (`uses.pool`).
**Not expressible and not to be attempted:** Wild Shape — author as prose plus a use pool.
Sneak Attack's "advantage OR an ally within 5 ft" stays prose-adjudicated, correct under ADR-0008.

**Stage 5 — weapon mastery.** *(D5; taken against intake advice — size it as engine work)*
A `mastery` slug on all 38 weapon records, plus nine behaviours: Cleave, Graze, Nick, Push, Sap, Slow,
Topple, Vex. **Push, Topple and Slow move creatures and apply conditions — that is new engine surface,
not content.** Stage the data and the six inert behaviours first; the three engine ones after, and
size them separately. Sequence behind Area 3's `4a` where they touch incoming damage.

**Stage 6 — `2d` random generator. Size L. Last.**
**Server-side, as a new command `character.generate`.** Rule 2 and D14 force this — `builderRollAbilities`
(`game-operations.ts:875-905`) already moved the builder's dice server-side and is called out as
"the oldest rule-2 violation in the ledger". The wizard's name shuffler (`CharacterBuilder.tsx:669-684`,
`Math.random`) is the pattern **not** to copy.
→ Extract `buildCharacterDefinition`'s offer-building block (`character-build.ts:520-683`) into an
exported `computeServerOffers(input, library)`; the generator answers **real offers** with
`context.random` draws, assigns `STANDARD_ARRAY` by `statPriorityFor(classId)`
(`packages/rules-5e/src/class-data.ts:61-72` — every class already has a `statPriority`), then falls
through to the existing build + import path. **Reuse, never fork** — a divergence between the
generator's picks and the validator's offers is the same bug class as `computeOffers` vs
`character-build.ts`.
*Role gate:* `builderPolicy.playerRandom: "open" | "gm-only"`, **defaulting `"gm-only"`** (deny by
default, unlike `playerBuilder` — a generator is a roster-filling vector). Project it beside
`playerBuilder`; gate it in the handler mirroring `game-operations.ts:801-806`; surface it in
Settings → Players.
*Tests:* generate 12 characters × levels 1/5/11/20; each parses through `ActorDefinitionSchema`, **and
re-submitting its `choices` ledger through `buildCharacterDefinition` produces an identical
definition** — that is the real proof. Determinism via injected `random`. Player generate with
`gm-only` → 403; `open` → 200 and auto-claimed.

### Area 1 acceptance
Every class produces a character with usable class actions at level 1–5; a Warlock has Agonizing
Blast working; no feature description is a stub; the generator's output is indistinguishable from a
hand-built character of the same choices; `1`/`2b`/`2c` verified at 375px with a tap audit.

---

## Area 2 — Homebrew

**Issues:** `3a`, `3b`, `3c`, `3d`. **Two register premises were wrong — read the corrections.**

> **Correction.** `3a` and `3d` are **not free-form**. Both are `<input list>` + `<datalist>`,
> constrained to the right values but with no visible affordance (and rendering as *nothing* on iOS
> Safari). `vocabularies.test.ts:47-57` already asserts all 13 damage types are offered at all 9 sites,
> and `vocabularies.test.ts:93-105` **deliberately pins** rarity to `kind: "text"` because a closed
> select over an open slug is its own defect (`content-srd-5.2.1/src/schemas.ts:231`).
> **The client's intent is read as "make it look and behave like a dropdown," not "close the enum."**
> A GM must still be able to type "unique" or a homebrew damage type.
>
> **Correction.** `3b`'s Expected — "pools available on the character" — is not buildable: a homebrew
> item is authored once and carried by anyone, so the editor has no character in hand. The buildable
> form is **"every pool the merged catalog declares,"** with an unmatched pool degrading to a private
> counter at runtime, which is already the behaviour. Functionally identical for Lay on Hands.

**Order: `3a` → `3d` → `3b`(a) → `3c` → `3b`(b).**

**1. `3a` — rarity picker. Size S. First, because it unblocks `3d` and `3b`.**
Add `pick?: boolean` to `FieldDef` — **a renderer flag, not a new `FieldKind`** (`schema.ts:10-26`
states that rule; `damagePartsField()` and `searchable` are the precedents). In `FieldRenderer.tsx`'s
`text` branch, when `pick && suggestions.length > 0`, render `Combobox` with `allowFreeText: true`
instead of `Input`+`datalist`. Set `pick: true` at `schemas.ts:649`; add a display-name map
(`"very-rare"` → "Very Rare"); add `varies` to `RARITY_IDS`.
*Rejected:* `kind: "select"` — closes the slug and breaks `vocabularies.test.ts:100`.
*Tests:* type "unique" → body carries `rarity: "unique"`; pick "Very Rare" → `"very-rare"`. Census:
every `pick` field declares `suggestions`.

**2. `3d` — damage-type pickers. Size S. Must land BEFORE Area 3's `4a`,** or the engine gets built
against hand-typed data and there is no clean joint test.
Apply `pick` to the three `text` sites; give `TagInput` a visible pick affordance for the six tag
sites. The nine sites: `schemas.ts:491` (spell damage types), `:743` (weapon damageType), `:813-815`
(monster RVI ×3), `schema.ts:316` (`damagePartsField().type`), `RiderEditor.tsx:227`
(`damage-type-is`), `:383` (`extra-damage`), `:592`/`:705` (grant kinds).
**Canonical source — already exists, already pinned, do not create a second:**
`packages/content-srd-5.2.1/src/enums.ts:26 DAMAGE_TYPE_IDS`, 13 frozen slugs, held honest by
`test/enums.test.ts:28`. Deliberately a constant, not a loader, so a browser form can import it.
**The server reads it nowhere today** — Area 3 must import the same specifier. Add a shared
`normalizeDamageType()` beside it (trim + lowercase) used by both the editor's write path and the
engine's lookup, so `"Fire"` and `"fire"` cannot become two types. **Keep `DamageTypeIdSchema` open.**
*Pin it:* assert no file under `apps/server/src` or `apps/client/src` declares a literal array holding
three or more of the 13 slugs.

**3. `3b` half (a) — the "Uses are" readback. Size S. A five-line fix.**
`RiderEditor.tsx:424-448` defines the `mode` select with a `write` and **no `read`**. The comment at
`:428-429` says "`mode` is NOT stored — it is read back out of the shape"; **it never is.** So
`FieldRenderer.tsx:73` falls through to `getAt(value, "mode")`, a key the write path deliberately
never persists (`:446`), and the value is `""` every render — selecting
`<option value="">Not set</option>` (`FieldRenderer.tsx:188`).
Not a controlled-input bug, not `defaults.ts`, not `useAutosave.ts`. The chosen shape **was** saving
correctly all along. Affects features too (`FeatureEditor.tsx:557,592`).
```ts
read: (scope_) => {
  const uses = scope_.uses as { limit?: unknown; scaling?: { type?: string } } | undefined;
  if (!uses) return undefined;
  return uses.scaling?.type ?? "flat";
}
```
The three `scaling.type` literals are byte-identical to the option values at `:427` and to
`FeatureUsesSchema` — no mapping table.
*Tests:* the exact broken loop — render from a body, assert the select reads correctly; change it;
assert the body; re-render from that body; assert the select survived.

**4. `3c` — the mace. Size L. Two independent bugs.**

*Bug 1 — the use limit is structurally unreachable.* `equipment-derivation.ts:71` declares `uses` on
`RiderBlockLike` and `usesOf()` (`:613`) exists, but its only two call sites are an *action's* own
uses (`:668`) and a *cast's* own uses (`:702`). The **item-level** block is never consulted in
`deriveEquipment`'s loop (`:445-471`), and `weaponAction` (`:742-767`) builds its `ActorAction` with
**no `uses` key at all**.
→ Change `weaponAction` to take an optional `uses` and spread `usesOf(record.uses)`; pass
`catalog.equipmentRecord(entry.item.id)?.uses` from the equipped loop. For non-weapons, synthesise an
`activation: "other"` action mirroring `character-build.ts:299-307`, so items and features behave
alike. *Rejected:* a separate "Use *Item*" action beside the swing — the GM authored one charge on one
mace and would get two rows.
*Watch:* `rests.ts:68` and `encounter.ts:31,289` iterate `effectiveActions`, so the new `uses` is
re-armed for free — but a `per: "recharge"` value now newly reaches the recharge roll.

*Bug 2 — the extra damage is applied but never shown, and sometimes never rolled.* The engine **does**
handle it: `action-resolution.ts:920-940` collects `extra-damage` at the damage moment and pushes it as
its own typed entry, proven with rolled numbers at `item-riders.test.ts:81-107` and `:455-479`. Three
hops fail:
1. **Display.** `effective-actions.ts:44-67` folds only four rider kinds; `extra-damage` is
   `at-its-moment` and correctly excluded — so `srv.damage` is base-only and `CharacterSheet.tsx:792`
   prints only `1d8 slashing`. **This is the reported symptom.**
2. **The loose-roll path.** `CharacterSheet.tsx:803` calls `rollFlat(part.formula)` — a bare roll with
   no riders — and `structuredAttacks` (`:228`) is `false` unless a fight is live **and it is that
   player's turn**. Off turn, the rider genuinely never fires.
3. **Gating.** `addFromCatalog` (`:544-560`) sends neither `magic` nor `equipped: true`, so a freshly
   added item is unequipped and contributes nothing (`itemIsActive`, `equipment-derivation.ts:267-271`).
→ Expose `extraDamage: readonly {formula, type, when}[]` through the derivation and render it beside
the base part, marked conditional. **Do not fold it into `action.damage`** — that double-rolls at
`action-resolution.ts:932`. And **take the ruling already written at `equipment-derivation.ts:731-738`**
("the client's copy should be deleted in favour of it"): when `srv` exists, route the damage chip
through the server. That is the rule-2 half of this issue.
*Tests (H4):* new rows in `homebrew-inert-fields.test.ts` — the client's exact mace. Resolve once →
`damage` contains **both** bludgeoning and `{1d6, lightning, total}`; `actionUses["item-<id>"] === 1`.
Resolve again → refusal `feature.no-uses-remaining` naming `1/short rest`. `shortRest` → resolves
again. Four far ends: a rolled number, a spent counter, a refusal, a re-arm.

**5. `3b` half (b) — pool binding. Size M. Gated on Area 1 Stage 3.**
Give `uses.pool` `pick: true` + `suggestions: (ctx) => ctx.pools` + `slugValidate`; **apply the same
to `resource-bonus.poolId` (`RiderEditor.tsx:389`), which has the identical defect** — leaving it is a
guaranteed re-open. Add `pools` to `SchemaContext`, populated from a new `poolSummaries()` on
`ContentView` served over one new `CONTENT_PATHS` route beside `feats`. **Names, not slugs, in the UI**
("Lay on Hands", with its owning record). **Scope the route through `catalogFor(principal)`** or a
player learns the GM's unpublished homebrew pool names.
**Binding to a pool the holder lacks must degrade, never fail** — it already becomes a private counter,
and a GM handing a paladin item to a fighter is a normal table event. Do not add a refusal.
`homebrew-validate.ts:44-49` explains why an advisory cannot ship today (`.strict()`, no `warnings`
array); either widen the contract or stay silent — **do not emit it as a blocking issue**.

**Ride-alongs — approved, cheap, adjacent to code already being edited:**

| Item | Why | Size |
|---|---|---|
| **Effect `modifiers` unauthorable** (`RiderEditor.tsx:552-558`; `EffectGrantSchema.modifiers` defaults `[]`) | **Every effect a GM authors is mechanically empty.** The reader exists and starves — `equipment-derivation.ts:426-443` routes `damage-resistance` into grants. It is also the only way a GM authors a damage resistance, which `3d`/`4a` make newly meaningful. | M |
| **Recharge unauthorable** (`RiderEditor.tsx:489`) | The client's `3c` Expected names the recharge basis. Engine implements it fully. **Item/action-scoped only** — `FeatureUsesSchema.per` has no `"recharge"` member; do not add it to the feature `usesField` without widening that schema. | S |
| **`maxRows: 1` on item effects** (`RiderEditor.tsx:547`) | The cap cites an engine limit that is real for *features* (`character-build.ts:305` takes `effects[0]`) and false for *items* (`equipment-derivation.ts:429` iterates all). Make it scope-dependent; fix the copy. | S |

**Deferred, filed as findings in `known-bugs.md` rather than left unknown:** monster attack bonus /
save DC unauthorable; `legendary.cost`; homebrew spell `castingOptions` (belongs with Area 1's spell
work); `token.disposition`; `armor.stealthDisadvantage` / `strengthRequired`.
`attunement.restrictedTo` is **deliberate and documented** (`schemas.ts:662`) — not a defect, leave it.

### Area 2 acceptance
The client's mace: 1/short rest, +1d6 lightning, and the sheet shows both damage lines before the
roll. Every damage-type and rarity control is a visible dropdown that still accepts a custom value.
"Uses are" holds its value across a reload. `/homebrew` tap-audit count does not rise.

---

## Area 3 — Combat encounters

**Issues:** `4a`, `4b`, `4c`, `4c.1`, `4d`, `4e`, `4f`, `4g`, `4h`, `4i`. **Governed by D2, D3, D7.**

> **Four of these are undiscovered round-2 regressions.** `4c`, `4c.1`, `4g` and `4h` appear nowhere in
> `refresh-round-2-plan.md`, `-decisions.md` or `-fixes.md` — they were introduced by that work and
> never measured. The client knew only about `4h`.

**Order:** `4a` starts first and runs in parallel (longest pole, blocks nothing here). UI items in the
order below, because they share files.

**1. `4h` — the map jump. Size S + a real test. Do this first; it is the most immediately visible.**
*Archaeology, complete.* The original fixes are `22f04ed` and `868ac16` (both 2026-07-22), which floated
`.encounter-token-tray` and `.encounter-map-saving` in enlarged mode, for the stated reason that *"a
'Saving move…' line mounting in-flow on token release would steal height from the flex:1 stage and
bounce the map."* Both were scoped `.encounter-map-interaction.enlarged` because the default arm was
then a plain block.
*What displaced them:* the refresh's table-frame lane (`765e232`/`be5c51c`) rewrote
`.encounter-map-interaction` to a `flex: 1` column (`encounter-map.css:4`) and made
`.encounter-map-stage` `flex: 1` (`:180`) — its header even says *"`.enlarged` has always worked this
way — this is that shape, made the normal one."* **The shape was made normal; the two floats that made
it safe were not.** `.encounter-map-saving` (`:388`) is in-flow with no reserved height and mounts on
`busyActorId`, stealing ~1.35rem from the stage on release. The tray is fine (still floated at `:7`).
Below 979px the bug is absent because that arm states the stage's height (`:777`).
→ Drop `.enlarged` from `:395` so the float is unconditional. (Or reserve height via `min-height` as
`.encounter-map-feedback` does at `:389` — prefer the float; it is the fix that already existed.)
*The test that closes it — without this it is not a fix:* Playwright at ≥980, recording
`.encounter-map-stage.getBoundingClientRect()` before pointer-down, during drag, and after pointerup
while `.encounter-map-saving` is mounted; assert `top` and `height` unchanged **to the pixel** across
all three. Docked, undocked, and `.enlarged`. **A DOM-only unit test cannot catch this — it is a
layout fact.**

**2. `4c` + `4c.1` together. Size S each. Same file, one browser pass.**
*`4c` is **not** the map's wheel handler* — the guard at `EncounterMap.tsx:206` is correct, predates
round 2, and returns early for `.encounter-map-dock`. Anyone "fixing the map swallowing the wheel"
will change working code. The trap is that `.encounter-region` carries `.scroll-y`
(`EncounterPanel.tsx:691`) plus `overscroll-behavior: contain` (`encounter-panel.css:222`); in the dock
arm `.encounter-map-dock .encounter-panel` (`encounter-map.css:346`) leaves the panel a plain block, so
`.encounter-region` has `flex: 1` with nothing to flex against, sizes to content, and becomes **a
scroll port with zero scrollable extent** — and `contain` then blocks the wheel from chaining out to
the element that actually overflows. Dragging the scrollbar still works: the exact symptom.
→ Make the dock's panel a bounded flex column so exactly **one** scroller exists:
`.encounter-map-dock { display: flex }` + `> .encounter-panel { display: flex; flex-direction: column;
flex: 1; min-height: 0 }`, and drop `scroll-y` from `EncounterMap.tsx:726`.
*Rejected:* overriding `overscroll-behavior: auto` — leaves two nested ports.
*Ratchet (h):* `.scroll-y` must stay in markup on whichever element keeps the scroll.
*`4c.1`:* `.encounter-panel::before` (`encounter-panel.css:1499-1526`) still paints `inset: -1px`, a
`--rim-w` border in role-hued `--rim-color` (cyan for a player) plus a bezel outline — a full second
frame, 1px outside its own border box, against the dock's `border-image` edge. The 2019-era override at
`:346` only zeroes properties the pseudo no longer uses.
→ `.encounter-map-dock .encounter-panel::before { display: none }` — the dock **is** the frame.
Confirm the scanline plate is not wanted there first.

**3. `4d` + `4e` together. Size S each. Both in the `styles.css` dice block, one ratchet run.**
*`4d`:* `.dice-adv-row { align-items: stretch }` (`styles.css:853`) against `.nh-stepper--labeled`,
which is a two-track grid (label band + controls) — so the buttons stretch to both tracks while the
stepper's *control* is `--tap-min`.
→ `align-items: end` + `min-height/height: var(--tap-min)` on the buttons, `padding-block: 0`.
**Measure in a browser before committing the rule. Do not drop the visible label (D23a).** Re-check
`.log-pane .dice-adv-row` (`encounter-panel.css:1068`) and `.dock-tabs-body > .dice-proof` (`:107-115`),
which re-pad the same buttons. Ratchet (b) + the 44px floor: buttons must not shrink below `--tap-min`.
*`4e`:* `.roll-list` is `display: grid` (`styles.css:871`) with `.scroll-y` in markup
(`DicePanel.tsx:150`), and `.scroll-y` sets **only** `overflow-y: auto` (`design-tokens.css:1182`) — so
the x-axis computes to `auto` and any overflow yields a horizontal bar. Grid items default to
`min-width: auto` and `.roll-card` never sets `min-width: 0`.
→ `overflow-x: clip` on `.roll-list` (ratchet (h) explicitly permits declaring the x-axis when `-y` is
in markup) + `min-width: 0` on `.roll-card` + `overflow-wrap: anywhere` on `.roll-formula`.
**Measure which child overflows first — do not skip that.**
*Tests:* 1280×900 docked and 390×844, 30 rolls including a 20d6 row: `scrollWidth <= clientWidth`.

**4. `4g` — the screenshot. Size M. After `4c` (same scroll-model family).**
*Overflow.* `.encounter-menu` is `.scroll-y` with an inline `max-height` (`EncounterPanel.tsx:1065`)
**and** takes its fill from `.encounter-menu::before { position: absolute; inset: -1px; z-index: -1 }`
(`encounter-panel.css:1499-1526`). **An absolutely-positioned pseudo inside a scroll container is sized
to the scrollport and scrolls away with the content** — so every row past the first scrollport-height
renders with no plate, no rim, no chamfer, directly over the sheet's Dodge/Dash/Disengage buttons.
That is exactly the screenshot. Round-2 material-pass regression.
→ Split into a non-scrolling frame carrying the plate and an inner `.encounter-menu-body.scroll-y`.
**Check `.row-tools-popover`, which shares the rule, for the same trap.**
*Unbounded list.* `EncounterPanel.tsx:1110` — every non-archived actor not already in the fight, flat.
→ Reuse the scene-prep pattern **verbatim**: `ScenePrepPanel.tsx:28 RECENT_COUNT = 10`, `:85-88` (sort
by server-stamped `Actor.lastUsedAt`), `:139-143` (`<details><summary>Recent (n)</summary>` +
`.scroll-y` picklist). `GmActor` already carries `lastUsedAt` — **no server change**.
*Tests:* 1280×900 and 390×844 with 25 roster actors — `elementFromPoint` at the menu's bottom-inner
edge returns a menu descendant; visible add-rows ≤ 10. Note the tap audit does not measure closed
disclosures.

**5. `4a` — typed damage. Size L (not XL). Start first, run in parallel.**
**Extend the pipeline that exists; do not build one.** `hit-points.ts:65 applyDamageDetailed` is the
single entry point and **every call site already routes through it**:

| Site | Command | Narrates? |
|---|---|---|
| `game-operations.ts:974` | `actor.apply-damage` | yes (`:978-986`) |
| `player-damage.ts:64` | player hit, direct | yes (`:1211`) |
| `player-damage.ts:86` | `damage.resolve` | yes (`:1725`) |
| `saving-throws.ts:305` | `save.answer` | **no** |
| `reactions.ts:115` | opportunity attack | **no** |
| `reactions.ts:130` | Uncanny-Dodge-class reaction | **no** |

Four real gaps, and only four:
1. **Flat `damage-reduction`** — add a `damageReduction` collection to `DamageDeps`, applied **after**
   RVI, per total, floored at 0. The maths belongs in `packages/rules-5e/src/combat.ts` (it is pure).
   Source it from `deriveEquipment` carriers as item resistances already are. Drop
   `"damage-reduction": "unread"` from `CARRIER_RIDER_DISPOSITION` (`character-build.ts:206`).
2. **Vulnerability has one channel.** `damageVulnerabilities` is read only at `hit-points.ts:54` and
   written only onto an `ActorDefinition`; `InterpretedFeatures` (`character-build.ts:161-163`) carries
   resistances and immunities and no vulnerabilities; `effectDamageDefenses` returns resistances only.
   **A PC can never be vulnerable and nothing can grant it.** → widen `EffectModifierSchema` with
   `damage-vulnerability` and `InterpretedFeatures.damageVulnerabilities`, threading both into
   `definitionDefenses` and `effectDamageDefenses`.
3. **Three call sites discard the detail.** `answerSave` (`saving-throws.ts:306`) drops
   `outcome.application.parts` into a bare `appliedDamage`. → widen `SaveOutcome` and `ReactionOutcome`
   with `parts`, and **lift the detail formatter out of `game-operations.ts` into one exported helper**
   — it is copy-pasted three times.
4. **D7 — the untyped manual path.** `hit-points.ts:117-120` deliberately skips defence maths, and it
   is the GM's most-used entry point. → the GM's damage entry gains an **optional** type, defaulting to
   untyped so today's fast path is unchanged. Naming a type routes through the full adjustment.

**Stacking (SRD 5.2.1, as `combat.ts:29-42` already implements it — do not reinvent):** immunity wins
outright → 0; resistance halves rounding down; vulnerability doubles; **resistance and vulnerability on
the same type cancel to normal**, they do not compound; multiple sources of the same resistance halve
once; `resistAll` (Petrified) is a resistance, not an immunity. Flat reduction applies last.
*Tests (H4):* drive `save.answer` end to end against a fire-resistant target and assert the **feed row
text** contains `→` and `resistance`. One per call site × per adjustment kind, plus reduction stacking.

**6. `4b` — editable save damage. Size M. After `4a`'s narration refactor**, or `saving-throws.ts` gets
touched twice. If they must overlap, one agent owns both files.
Damage rolls unconditionally at `action-resolution.ts:886-905`; only the attack d20 has a manual door
(`attackTotal`, `:821`). The total freezes into `pendingSaves[].proposedDamage` (`:1097-1098`) and
`answerSave` (`saving-throws.ts:285-291,305`) applies it with no override. **The governing setting is
not `rulesPolicy`** — it is the per-browser `dice/roll-preference.ts` (`vtt.sheet.rollInput`), which
reaches attacks, saves and death saves and has **no consumer on the damage roll at all**.
→ Two doors, mirroring `attackTotal`: `action:resolve` gains `damageTotals?` / `skipDamageRoll`, and
`save:answer` gains `damageOverride?` applied **before** `outcomeParts` is derived. The amend precedent
already exists — `damage:resolve` takes an optional `amount` (`player-damage.ts:77,83`).
*Role boundary:* a player may amend only their own character's save damage; only the GM may amend
another's. State it in the payload's authorization.
*Tests:* `save.answer` with `damageOverride: 3` against a proposal of 17 → **HP moves by 3** and the
feed says 3. Manual-mode `action.resolve` records **no** damage roll in `state.rolls`.

**7. `4f` — pinch-to-zoom. Size M. Ships, per D2.**
`EncounterMap.tsx` already runs a single-pointer gesture machine with `setPointerCapture`, 7 gesture
kinds, a 500ms long-press and a camera of `{center, zoom}` with a working `zoomAt(clientX, clientY,
factor)` (`:215-226`); `.encounter-map-stage` already has `touch-action: none`.
**A reference implementation ships in this repo, on the same conventions and the same camera model:
`apps/client/src/codex/MapSurface.tsx:31, 118-158`.** Follow it.
→ Add a `pointers` ref keyed by `pointerId`; a `{kind: "pinch", startDist, startZoom, startCenter}`
member; second-pointer entry in `beginGesture` that **aborts** the in-flight gesture (release capture,
clear the long-press timer, discard the token/fog/measure/annotation preview **without committing**); a
pinch branch feeding `zoomAt` at the two-pointer midpoint; and `finishGesture`/`cancelGesture` refusing
to commit a move when the gesture was a pinch.
**The abort semantics across 7 gesture kinds are where this breaks.** Mobile parity means it must be
driven on a narrow viewport, not reasoned about.

**8. `4i` — replay launch. Size L. Independent. Governed by D3 — the clone stays.**
*Root cause of the block:* the refusal is `scenes.ts:206-208` / `replay-launch.ts:110-112` ("Remove a
prepared scene first"), firing only at 19–20 of `MAX_SCENES = 20`. **`launchReplay` mints a permanent
scene per launch and never removes it (`:172`), and clones actors per launch (`:153-165`) that likewise
persist.** Repeated launches fill the list. The Replays tab then offers no route to the scenes gallery.
**So the leak is the bug; the missing UI route is the smaller half.** (`activateNewScene:204` also
refuses while `historyCursor !== null`, with a different message.)
→ Add `Scene.replayOf?: {archiveId, actorIds}` and `Actor.replaySceneId?`; drop `withReplaySuffix`
(`replay-launch.ts:27-32`); filter replay-scoped actors out of the roster projections while keeping
them in `combat.initiative`; on `scene.activate` away from — or `scene.remove` of — a replay scene,
delete its clones and the scene. Surface both refusals in `ReplayPanel.tsx:233-236` with a link to
`/scenes`.
*Ride-along (approved, ~3 lines):* `server.ts:437-441 authorizePlayer` returns true only for the live
combat map or a codex-revealed atlas map, so a shared replay's archived map 403s and the player sees
`.replay-stage-missing`. Add: the asset is the `mapAssetId` of a **shared** archive.
**This is a viewer-safety change — gate on the archive's shared flag, never on "any archived map".**
*Tests:* launch → roster projection omits clones, no name ends `"(replay)"`; activate away → clones and
scene gone, `scenes.length` back to baseline; **launch 25× in a loop → never refuses**. Player asset
auth: shared archive map 200, unshared 403.

### Area 3 acceptance
Fire damage is halved against a fire-resistant target and the feed says why, on all six paths. A GM can
enter save damage. The docked panel scrolls with a wheel and paints inside its frame. The map does not
move on token release, and a test would catch it if it did. Pinch works on a phone. 25 replay launches
in a row never refuse.

---

## Area 4 — Codex

**Issues:** `5a`, `5a.1`, `5b`, `5c`, `5d`, `5e.1`–`5e.4`, `5f`. **Governed by D6.**
Mostly polish over a **complete** subsystem — but two register premises were wrong and one issue
dissolves.

> **Correction.** `5e.4` is **not an independent bug.** The client handler, route and store write are
> all correct and `codex-http.test.ts:1549-1567` proves the round trip. It breaks at
> `codex-store.ts:4498`: `proposedDateFor` returns null when the campaign has no current date, so
> `applyDowntime` throws a 400 — *"Set the campaign's current date before passing time."* The 400 **is**
> caught, but `setFormError` renders at `DowntimeView.tsx:138`, above a ~450px form, off-screen from the
> Pending section. The bare "Confirm" label is the same null falling through `:127-128`.
> **It is `5f`(i) wearing a disguise.**
>
> **Correction.** `5f` says there is no era field. **There is** — `CodexCalendar.yearName`, UI-labelled
> "Era suffix" (`CalendarEditor.tsx:41`), rendered as a year suffix. The real defects are that it is
> *singular*, buried as the fourth field in a structure modal, and a suffix rather than a leading
> component.
>
> **Correction.** `5e.3`'s "Who" field is **already** a `Combobox` over character pages with free text
> (`DowntimeView.tsx:146-148`). The gap is the archived grouping and parity with `5a`.
>
> **Correction.** `5a.1`'s session entry is **not a toggle** — `SessionsView.tsx:250,256` are two
> stacked `Field`s ("Prep", "Recap"). Leave it alone or convert it deliberately. And there is a
> **fourth** label pair the register missed, in `PageEditor`.

**Order: layout → shared components → `5d` → `5f`(ii)/(i) → `5e.4` → `5f`(iii).**

**1. `5b` + `5e.1` + `5e.2` — layout. Size S. Land first; zero coupling.**
The mechanism is not the help string alone. `.nh-field { display: grid; gap }`
(`packages/ui/src/primitives/forms.css:12`) has no `align-content`, inside flex parents with default
`align-items: stretch`. The 3-row helped field sets the row height; its 2-row siblings stretch their
auto rows, so **their** inputs grow and drop. *(The register has this backwards — the helped field is
the one that stays put.)* `5e.2` is visible because **Activity is a bare `<input class="nh-input">`**
(`DowntimeView.tsx:150`), a direct grid item that stretches, while `Who` (`Combobox`) and `Days`
(`NumberField`) have wrappers that absorb it.
→ Delete `help` at `SessionsView.tsx:214` and `DowntimeView.tsx:144`; add `align-content: start`
**scoped** to `.codex-composer-meta > .nh-field`, `.codex-downtime-form > .nh-field` and
`.codex-downtime-edit > .nh-field`. **Do not put it on bare `.nh-field`** — `CodexEditor fill` and
textarea fields rely on stretch.

**2. `TwoLayerBodyTabs` + copy-scan → `5a.1`, `5c`. Size M.**
Every occurrence today:

| Surface | player label | GM label |
|---|---|---|
| `JournalView.tsx:481` — entry | "Player-facing summary" | "GM-only notes" |
| — deadline | "What will happen" | "GM-only notes" |
| — downtime | "What the party knows" | "GM-only notes" |
| — milestone | "What the party knows" | "GM-only notes" |
| `QuestsView.tsx:243` | "What the party was told" | "GM notes" |
| `PageEditor.tsx:254` | "Player-facing" | "GM only" |

→ Canonical **"Player-visible notes" / "GM-only notes."** One shared component wrapping
`SegmentedControl`. Also update the matching `ariaLabel`/`placeholder` at `JournalView.tsx:488,492`,
`QuestsView.tsx:250,253,215`, `PageEditor.tsx:262-264`.
→ **Register the retired labels in `codex/vocabulary.test.ts:65-83`** so it cannot come back — that is
the difference between a rename and a fix.
**Trap:** `PageEditor`'s "Player-facing"/"GM only" are also the *reveal-axis* words pinned at
`vocabulary.test.ts:171-183`. **Retiring "GM only" wholesale breaks that pin.** Scope the new rules to
whole strings and leave `GmOnlyTag` alone. Re-measure the corpus floor (`:129`) in the same commit.
*Invariant:* pure copy. The gate is `revealedToPlayers` via `RevealSwitch`, untouched. **Verify no PATCH
body field name changes** — `playerBody`/`gmBody`, `playerText`/`gmText` stay.

**3. `CharacterPicker` → `5a`, `5e.3`. Size M. One component, three call sites.**
Nothing like it exists — `Combobox` has flat options, no groups, `limit = 8`.
**Source-of-truth fork, settled:** `archived` exists only on `GameState.Actor`
(`packages/domain/src/index.ts:974`), **not** on Codex `character` pages, and `main.tsx:828` maps actors
to `{id, name}` only. → **Source from Codex `character` pages** (keeps `characterPageId` working, keeps
the Codex free of a GameState dependency) and widen `main.tsx:828` to `{id, name, kind, archived}` so
archived PCs can be grouped.
→ Active options first; archived under a `<details>` — mirror `PartyRosterTab.tsx:172-175`, the existing
precedent. Call sites: `SessionsView.tsx:237` (multi), `DowntimeView.tsx:146` (single) and `:216` (edit
row). **Keep the wire shape `string[]`** for attendees — the picker writes the character's *name*; do
not migrate to page ids. **Preserve `whoPageId`/`characterPageId`** — downtime totals group on
`characterPageId` (`:81`), and breaking it breaks D12.
*Invariant:* `attendees` stays GM-only (`codex-projections.ts:429`). Binding it to characters must not
add it to `PlayerCodexSession`.

**4. `5d` — quest statuses. Size M. Needs a migration.**
`"active" | "completed" | "failed"` in five places, **including a SQL `CHECK (status IN (...))`** at
`codex-store.ts:1051` — SQLite cannot alter a CHECK, so this is a table rebuild in the v13/v19 style
(`:1373-1383`), or drop the CHECK and rely on `questStatus()`.
→ Add `"not-started"` and `"canceled"`. Change the default at `codex-store.ts:2325` from `"active"` to
`"not-started"`. **`openQuests()` (`quests.ts:42`) must decide** — recommend open = `active` **or**
`not-started`, and update its docblock, which currently asserts "open is `active`, and nothing else".
Two new tones for `questStatusTone`; the `codex_quests_status` index and chronicle rows follow. Both
`api-contract` enum sites + `npm run docs`.
*Tests:* migration round-trip on an old DB with `active` rows; new options and new default; `.strict()`
enum at the route.

**5. `5f`(ii) publish decoupling → `5f`(i) affordance → `5e.4`. Size M.** *(D6)*
*(ii) The coupling is **server-side**, at `codex-store.ts:4199`:* `if (calendar.currentDate &&
getPublishedDate() === null) writePublishedDate(...)` — deliberate (docblock `:4185-4198`, **K7**) and
**tested** at `codex-http.test.ts:1562`. The routes are already independent; this one line collapses
them on first set.
→ Per **D6**: keep auto-publish **only** when seeding a codex with zero records; otherwise drop it.
Always render both clocks plus a **visible Publish button** — today `CalendarView.tsx:132` hides Publish
unless `diverged` (`:86`), so from the unset state there is no visible publish act at all. **That
absence is the real reason the clocks felt welded.** Update `codex-http.test.ts:1562` and `codex.md:66`
in the same change, and **date the reversal in `decision-log.md`.**
*Invariant:* the fix must **not** make the players' clock directly settable — `publishCampaignDate()`
copying GM→published is the D11-H invariant. Any "set the players' date" control goes through publish.
*(i)* `CalendarView.tsx:123,128` render "Not set" / "Not shared yet" as plain `<strong>`; the only door
is a ghost "Edit calendar" button opening a modal where the date is the *fourth* field. → make each
clock's value a button ("Set your date") opening a small dedicated date editor. **Client-only.**
*Then `5e.4`* becomes: disable Confirm with the reason stated **inline beside the row** (or via
`useToast`) when `record.proposedDate === null`. *Test gap to close:* no server test covers
apply-downtime with `currentDate` unset — add one asserting 400 and that nothing moved.

**6. `5f`(iii) — eras. Size L. Last; it re-renders every label the earlier steps touched.**
**Recommended design — era as a calendar-level list, derived per date. No per-record migration, no
stored-date change.**
→ Extend `CodexCalendar` with `eras: readonly {name: string; startYear: number}[]` (default `[]`; when
empty, `yearName` behaves exactly as today). A date's era is
`eras.findLast(e => date.year >= e.startYear)`. The migration is **a single additive JSON key inside
`calendar_json`** — `normalizeCalendar` (`codex-store.ts:1874-1878`) reads `eras ?? []`, so an existing
blob upgrades by being read. **No ALTER, no backfill, no risk to `in_world_year/month/day` on
`codex_journal` or `codex_pages`, no risk to `codex_meta.published_*`.** Existing dates are never
rewritten, only re-labelled. That is what makes it safe.
*Rejected — this is the mangling risk:* an `era` field on `CodexInWorldDate` needs `in_world_era`
columns on two tables plus three `published_*` siblings, a backfill that must **invent** a value,
changes to `resolveDate` (`:4311`), `dateForInstant` (`:4292`), `calendarInstantOf`, `pageDateOf`
(`:1698`), the contract schema (`api-contract/src/index.ts:1673`, `additionalProperties: false`) and
every write schema — and it makes `calendar_instant` ambiguous.
*Read sites:* `formatInWorldDate` (`codex-store.ts:1920-1931`), `formatWorldDate`/`formatWorldYear`
(`api.ts:713-721`), `chronicle.ts`, `dashboard.ts`, `CalendarView.tsx:139,185,265`,
`PlayerCalendarView`, `CalendarEditor.tsx:41`.
*Projection — the only `codex-projections.ts` edit in this area:* `eras` goes on **both**
`GmCodexCalendar` and `PlayerCodexCalendar` (`:1006-1047`) and both project functions. The player
already receives `yearName`, `months` and `weekdays`, so era names are **structure, not secrets**.
**Projected, never filtered.** Viewer-safety review required.
*Safety tests:* (1) open a DB migrated to v25 with dated journal rows and pages, run `migrate()`, assert
every row's `in_world_year/month/day`, `calendar_instant` and `in_world_label` are **byte-identical**;
(2) `getPublishedDate()` and `getCalendar().currentDate` unchanged; (3) `exportBundle`/`importBundle`
round-trip with and without `eras`; (4) an old bundle without `eras` imports to `[]`; (5) `writeCalendar`'s
label recompute (`:4180-4184`) still runs once per dated row after eras change.

**7. Ledger drift — fix in place while here.**
- `known-bugs.md:76-78` ("dashboard cards do not show reveal state") — **STALE, delete.**
  `CampaignHome.tsx:178,184,198,230,258,278,301,327,370,388` all render `VisibilityBadge`.
- `known-bugs.md:83-85` ("Faction standing card unbounded") — **STALE, delete.**
  `CampaignHome.tsx:126-135` bounds it via `useStandingLimit`, default 5, See-all at `:314-316`.
- `known-bugs.md:392-400` (replay map) — **mis-filed under `## Unverified`; move to `## Known gaps`.**
  Its own text records a runtime repro at every viewport.
- `known-bugs.md:99-106` — self-contradictory: heading says four search arms untested, `:105-106` says
  the journal arm is covered. **Correct the heading to three** (page, map, marker), or delete the
  parenthetical. Re-measure either way.

### Area 4 acceptance
One character picker, one notes toggle, both used everywhere. A quest can be Not started or Canceled.
The GM's date and the players' date move independently with a visible Publish. Downtime Confirm either
works or says why, in view. An era reads before the year, and a v25 database's dates come through
byte-identical.

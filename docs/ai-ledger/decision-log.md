# Decision log

**Read this when:** you're about to change something that feels architectural, or you're
tempted to re-open a settled question. These are durable decisions — don't relitigate them
without a clear new reason, and if you do change one, record it here with the date and why.

The **canonical architecture record is `docs/adr/`**; its index is `docs/adr/README.md`. This
log captures the load-bearing decisions in one place plus operating decisions that don't have
an ADR.

**When a decision here is overtaken, mark it in place.** Keep its text and its date, and add a
`> **SUPERSEDED**` line naming what replaced it and where. Do not delete it and do not append a
newer entry beside it without marking the older one — an unmarked superseded decision is the
worst artifact this file can produce, because it reads as current.

## 2026-08-13 — a harvested absence is authored to the check the ENGINE rolls, or it stays an absence

**Context.** Two vocabulary gaps closed the same day: `roll-mode {roll: "check"}` gained a consumer
(`apps/server/src/ability-checks.ts`) and `FeatureGrantsSchema` gained an optional `when`. The
magic-item lanes had recorded, item by item, which absences were waiting on each. This entry is the
ruling the harvest of those records needed, because "the limit closed, so author them all" is the
over-grant the named-absence contract exists to prevent.

**0. There are exactly FIVE checks the server throws**, and that list is what an author reaches for:
Hide, Influence, Search, Study (`BUILTIN_CHECKS`) and Escape a Grapple. A clause naming any other
check — climbing a rope, controlling a Sphere, examining something an inch away — has nothing to
attach to however good the vocabulary gets.

**1. Author to the narrow the engine actually passes, never to the printed skill.** `BUILTIN_CHECKS`
(`action-resolution.ts`) carries a `skill` on **Hide alone** — `{dex, stealth}`. Influence, Search and
Study are bare `{cha}` / `{wis}` / `{int}`, and Escape a Grapple narrows to whichever of
`{str, athletics}` / `{dex, acrobatics}` won the modifier comparison. `ability-is` and `skill-is` both
fail CLOSED against a narrow missing their key, so a rider gated `skill-is: ["perception"]` parses,
ships and fires **nowhere** — the same silence the absence recorded, wearing a rider's clothes. So
"Advantage on Wisdom (Perception) checks" is authored `ability-is: ["wis"]` and reaches Search.

**2. The approximation that buys is disclosed, and it is the limit of what gets authored.** The
engine's Search does not separate Perception from the Insight, Medicine and Survival the SRD's Search
action also admits. `sentinel-shield` and `rod-of-alertness` print that clause with **no qualifier**
and are authored. `robe-of-eyes` and `eyes-of-the-eagle` print *"that rely on sight"* — a narrowing no
trigger expresses — and stay absences; the Robe's own Drawbacks give the wearer the **Blinded**
condition, so authoring it unqualified would hand a blinded wearer advantage on sight-based
Perception. Same rule refused `belt-of-dwarvenkind` (Persuasion *"to interact with dwarves and
duergar"*), `eyes-of-minute-seeing` (*"within that range"*, one foot), `talisman-of-the-sphere`
(controlling a Sphere the engine does not hold) and `quarterstaff-of-the-acrobat` (two of the
weapon's three forms). Alternatives and their costs are in the modules at each entry.

**3. An absence whose stated reason has been fixed is a false record even when it stays unauthored.**
Nineteen records cited one of the two closed limits. **Seven became riders** — `boots-of-elvenkind`,
`cloak-of-elvenkind`, `cloak-of-the-bat` (new entries), `sentinel-shield`, `rod-of-alertness`,
`champion.remarkable-athlete` (a second modifier beside an initiative rider each already carried) and
`mindless-rage`. **Twelve were rewritten** to name the reason that actually survives, including three
that had MIS-cited the limit: `energy-bow`'s escape DC is an item-action gap, not a roll-mode one,
and `hat-of-many-spells` and `sphere-of-annihilation` want a check's OUTCOME as a gate, which
reaching a check's die never was. Over the 268 magic-item rows the counts moved 87 → **90 authored** and 181 →
**178 absences** (C7c 18 → 21; C7a and C7b each gained a second modifier on a row already authored,
so their counts held; C7d gained nothing). The two class records are outside that population.

**4. `grants.when` has no magic-item carrier at all, and one carrier in the whole SRD.** Measured
across all 268 rows: 25 print a Resistance or Immunity and every one is either already authored
ungated, or blocked by something the gate does not touch. The corpus's only gated grant is a class
feature — Path of the Berserker's `mindless-rage`, *"Immunity to the Charmed and Frightened conditions
while your Rage is active"*, gated `while-effect-tag: ["raging"]` on the tag Rage's own effect already
writes. Authored there. **Consequence for the far end:** no shipped record prints a gated
*resistance*, so the gate's shipped proof ends at a refused condition rather than a halved total; the
halving stays proved on a parsed record in `apps/server/test/grant-gates.test.ts`.

## 2026-08-12 — the content program's own guards: an absence is a test, and a cast rule belongs to the program

> **COUNTS MOVED 2026-08-13** — see the entry above. The three decisions below stand unchanged; the
> population they were measured over is now 90 authored / 178 prose-only.

**Context.** C8 closes the content program (C7a–C7d, 268 magic-item rows, 87 authored entries, 181
prose-only records) with an adversarial pass hunting two failure modes and nothing else: a rider
built whose reader never fires, and a both-paths test whose far end is a surviving field rather than
an engine outcome. **Neither was found.** Every rider family the four lanes author — `armor-class`,
`save-bonus`, `check-bonus`, `roll-mode`, `attack-bonus`, `grants.{damageResistances,
damageImmunities, conditionImmunities, weapons}`, `actions`, `casts`, `cursed` — reaches a live
reader: a sweep of all 87 carriers against a bare control found 82 move an observable derivation from
a picker-minted row alone, and the other five (`ammunition-1/2/3`, `bracers-of-archery`,
`shield-of-missile-attraction`) are momentary or write-path riders that were each driven to a number.
Each lane's far end was probed by stripping its lane from `scripts/item-mechanics/index.ts`,
regenerating the bundle and re-running: all four fail at an engine outcome (a damage total that stays
12 instead of halving to 6, a `casts` list that comes back `[]` where Fireball was, an AC of 12
instead of 13, a charge counter that never leaves 0), and the bundle was restored by checksum.

**What the pass DID find is that three true claims were guarded by nothing**, which is the shape a
claim rots in. Three decisions follow.

**1. An absence is a test, not a promise.** All four modules' headers promise *"every one named below
with its reason"*; each lane's test pins its own AUTHORED count and nothing checks the other side of
the subtraction. A lane could drop a row from its absence list, or the ETL could add a row nobody has
looked at, and every existing test stays green. Measured before the guard existed: **0 unrecorded
across all four lanes.** `apps/server/test/item-mechanics-program.test.ts` now holds it — every row is
authored or named in backticks in its lane's module, the four scopes partition all 268 rows exactly
once (60 + 57 + 56 + 95), and the failure NAMES the rows. Probed by renaming one absence record:
`unrecorded: ["universal-solvent"]`.

**2. The two cast rules are the PROGRAM's, not C7b's.** C7b's salvage removed seven casts over one
measured fact — `castAction` reads `spell.damage.roll` as a cast's damage and
`spell.damage.types[0] ?? "force"` as its type, and emits an `attack` block from `spell.attackRoll`,
none of which the spell records reliably mean — then guarded it with `authoredCasts()` filtered to
`lane === "C7b"`. **The reader is lane-blind and the guard was not:** it covered 28 of the program's
43 authored casts. Probed by planting `cure-wounds` and `faerie-fire` on a C7c item:
`item-mechanics-c7b.test.ts` stayed **green** while the widened sweep named both
(*"C7c/hat-of-disguise casts cure-wounds … castAction types an untyped roll as \"force\""*). Widened
to every lane, with the population (43 casts, 29 items, per-lane split) pinned so it cannot go vacuous.

**3. A rider family proved only by a bundle assertion is not proved.** `item-mechanics-c7a.test.ts`
asserted ammunition's `attack-bonus`, the initiative `roll-mode` and `cursed` as fields surviving the
merge; the lane's measurements of what they DO live in comments. All three are now driven: the +3
arrow makes a shot 14 where the control is 11 and leaves a mace swing at 9, all three initiative
carriers report `advantage` and `normal` when unequipped, and both cursed items refuse a player's
doff by name and yield to the GM's.

**Also corrected in place.** `scripts/item-mechanics/weapons-armour.ts` still told its 19 limit-(0)
absences *"Unit for all 19: NONE YET … §5 has no row for it"* while its own header ruled *"EVERY
`limit (0)` ABSENCE BELOW IS C9's"* and the plan carries C9 in its unit table, its own section and the
phrase *"19 absences citing C9"*. An unblocker quarter that says NONE YET when a unit owns the work is
what turns a recorded decision back into a silent skip.

**Rejected, with why.** *Empty `shield-of-missile-attraction`* — it authors `cursed: true` and nothing
else, so attuning it locks a slot and grants no mechanic, which is the exact inversion of the
`armor-of-vulnerability` case this lane's salvage removed for being strictly better than plain. Both
its printed halves are legitimately unsayable and recorded as named absences, so the row is a faithful
subset rather than a defect; which way that asymmetry should fall is a client ruling and the client is
away. Written up in `docs/ai-ledger/known-bugs.md` instead. *Widen C7b's "landed every authored rider
on the COMMITTED bundle" check* — redundant: `packages/content-srd-5.2.1/test/item-mechanics.test.ts`
already re-runs the real ETL and compares the emitted bundle to the committed one byte for byte, which
catches a module edited without regenerating for every lane at once.

## 2026-08-11 — a magic weapon applies to a base weapon the player picks, and a rider must produce the PRINTED effect

**Context.** Batch 3's C7a lane (weapons and armour) authored 42 of its 60 magic-item rows and its
headline far end was green: *"a `+1` weapon's to-hit and damage both move by one."* A review pass
found the number came from the test's own fixture. **A magic weapon in the SRD carries no stats of its
own** — the printed type line names which *base* weapon the item applies to (`Weapon (Warhammer)`,
`Weapon (Any Simple or Martial)`) — and the ETL is faithful to it: **measured over the committed
`packages/content-srd-5.2.1/bundles/magic-items.v1.json`, 0 of the 33 `weapon`-category rows carry a
`weapon` block.** So `weaponAction` returns null, the row derives no swing, and an authored `+3` is
not an overstatement but a number that appears nowhere. Driven end to end on a picker-minted
`Dwarven Thrower`: `carriers` 1, `weaponActionIds` `[]`, `effectiveActions` `[]`. C7b hit the same
class of defect from the other side — seven `casts` whose reader fires and produces the wrong thing,
including a Staff of Healing that hit a wounded ally for 2d8.

**The first ruling: the player picks the base weapon the template applies to.** The chosen base
supplies the swing — its die, its damage type, its range band, its properties — and the magic row's
riders scope to that swing. It is an **item-applies-to-item** mechanism and it does not exist in this
repo. **It is a unit, not content work**, written up as **C9** in
`docs/product/plan-content-program.md` §2. The measurement that forces the ruling is the qualifier
histogram: of the 33 rows, **11 name exactly one base weapon and 22 offer a choice** (nine of them
`Any Simple or Martial`). Any answer that serves only the 11 leaves two thirds of the list inert.

**Rejected, with why.** *Inherit the single named base for the 11* — cheapest, no control, no pick;
leaves the other 22 inert and ships a browse list where some magic weapons swing and some do nothing
with nothing on screen to say which. Kept as C9's own first slice, not as the answer. *`scope:
"bearer"`* — parses today, needs no unit, and is wrong in a way a table feels: it raises every attack
the bearer makes with any weapon, and two magic weapons stack. *Invent default stats* — `Sword of
Sharpness` applies to a Glaive, Greatsword, Longsword or Scimitar, whose dice are 1d10/2d6/1d8/1d6, so
any single default is wrong for at least three of the four; it also invents content the SRD does not
print and nothing downstream could ever tell the invented die from a parsed one.

**The second ruling, and it is the general lesson: the admission rule gains a clause.** It was *"a
rider is authored only when its reader ships."* It is now **"only when its reader ships AND produces
the printed effect."** A rider that reaches a reader and produces the WRONG effect is **worse than an
unauthored one**, because prose is visibly prose and a wrong number is invisible until the round it
lands at a table. Both salvages are instances: a `+N` with no swing, and a `casts` that reads a
spell's `damage` column as if it described one cast.

**What it costs, stated plainly.** **18 authored rows came out of C7a and 5 out of C7b, plus 4 riders
stripped from entries that survive** — C7a stands at 24 of 60 and C7b at 27 of 57, and the removed
rows are **named absences**: the item, the SRD sentence, the vocabulary it needs, and the unit or bug
that unblocks it, in a comment beside where the entry was. That is "we decided it", not "we skipped
it". **U20 moves behind C9** rather than behind C7a — `Sun Blade` and `Energy Bow` are reserved
carriers with no swing to override — and U23's `Vicious Weapon` is in the same position. **C9 does not
unblock the `+N` ladder on its own**: `FeatureModifierSchema` has no flat `damage-bonus` (measured:
`{formula: "1"}` and `{formula: "1d1"}` are both refused), so a `+1` weapon after C9 would author its
to-hit and understate its damage by one — half-right and invisible, which is the very failure this
ruling exists to stop. The two must land together.

**Consequences.** C9's full contract, its far end and its one open design question (copy the base's
block onto the inventory row, or store a `baseWeaponId` and resolve at derivation) are in
`docs/product/plan-content-program.md`; the lane-level findings and every absence are in
`packages/content-srd-5.2.1/scripts/item-mechanics/weapons-armour.ts` and
`packages/content-srd-5.2.1/scripts/item-mechanics/wands-rods-rings.ts`; the spell-model half is two
`[content/spells]` entries in `docs/ai-ledger/known-bugs.md`. **The armour half of C7a is NOT affected
and the reason is the SRD's own wording** — `Shield, +2` prints its bonus *"in addition to the
Shield's normal bonus to AC"*, and AC is additive by construction — so nobody should "fix" armour rows
by inventing an `armor` block for them either. And a bar for every future far end in this program:
**drive it from the shipped bundle**; where a test must build a row by hand, build it the way the
picker does and no better.

## 2026-08-11 — two of the parent decisions the unit programs were waiting on

**Context.** `docs/product/plan-engine-program.md` §7 (D-ENGINE-2) and the U35a scope question were
both left open by the 2026-08-10 re-verification pass, and both gate work that cannot start without
them. Put to the client 2026-08-11; both answered.

**D-ENGINE-2 — `RiderEditor.tsx` is NOT split. Ruled: leave it, and serialise the work instead.**
Eight engine units (U18, U19, U20, U21a, U22, U23+U30, U28, U33) plus four from the API program's
lane β all need a control in that one 1365-line file. The plan offered a prep unit `R2` to split it
first and recommended taking it; the client declined. **The consequence is a scheduling one and it is
now binding: no two units that touch `RiderEditor.tsx` may run in the same batch.** Twelve units
therefore queue through it one at a time rather than fanning out, and any plan text that assumes
four concurrent agents across those units is wrong until this is re-opened. The upside the client
bought: no refactor of a file that eight shipped units already depend on, and no window where a
half-split file is the merge base for concurrent work.

> The split remains available. If the queue becomes the critical path, re-open this with the
> measurement — how much wall-clock the serialisation actually cost — rather than the argument.

**U35a — the Light-property extra attack is its OWN unit, not a mastery.** Size L. It is a core 2024
rule available to every character who wields a light weapon, so it does not belong inside the
weapon-mastery system, which exists for the per-weapon special cases. This unblocks U35b, which in
turn is one of the eight slugs U38 is gated on.

**Still open**, and named so the next session does not think this closed them: the engine U18/U22 →
mastery-program sequencing (the vex/slow agents stop-and-report if it is got wrong), the C6 wondrous
split, Horn of Valhalla's rarity, the multiattack census row, and who owns
`equipment.weapon.properties`.

## 2026-08-10 — the remaining program: twenty client rulings, and one home for decisions

**Context.** The feature-implementations branch (PR #55) closed 17 vocabulary-parity units across
Waves 0–2, then a five-round discovery pass (19 agents) re-measured the remaining 22 units and found
the plan's premise inverted — only two are "add a control" work — plus ~80 API-authorable
capabilities the editor cannot reach. The client answered nine rounds of structured questions on
2026-08-10. The full rulings, the measured findings and the four program plans live in
`docs/product/remaining-program-plan.md` and `docs/product/plan-{content,api,engine,mastery}-program.md`;
this entry records what is *durable* so it cannot be relitigated from memory.

**The rulings that bind future work:**

- **The branch splits.** Waves 0–2 merge to `main` as PR #55; the remaining programs run on a fresh
  branch with **one PR per measured batch**. No more 34k-line unreviewed landings.
- **The done bar is fixed:** an engine-outcome far-end proof, non-vacuity probes at **both** control
  and value level, and a 375px touch pass for anything with UI. Every late bug this program caught
  was caught by one of the three.
- **Review is interleaved**, not terminal: every batch closes with a hostile adversarial review
  hunting **built-but-unwired mechanisms and vacuous tests** specifically, plus a QA-fix and polish
  pass; Areas 2–4's missing reviews are back-filled.
- **A control with no SRD author is a defect, not a deliverable** (reaffirmed). The content program
  authors the **full SRD magic-item list** (258 items, generated bundle + four overlay lanes), which
  supplies real carriers to every zero-author unit — the harness's "not a lone record" rule stands
  unchanged rather than gaining exemptions.
- **The API parity guard is an HTTP round-trip** — the real router, the real store, the real publish
  gate, and a deep-equal between the API-stored body and the editor-reproduced one. It lands
  **before** the capability units so they land under it. `docs/product/vocabulary-parity-audit.md`
  stops being hand-edited and is regenerated from the guard.
- **`vex` and `slow` are real mastery units** with the same four-part contract as U34–U37; U38 stays
  gated on all eight slugs reaching. "Unblocked by another unit" is not "implemented".
- **U33 keeps its relabels and drops both destructive halves** — deleting an enum member that stored
  records still carry (silent parse loss from every catalog), and removing a wire field with 44
  authors. Breaking removals need migrations and their own decision, never a sweep.
- **Baked characters get a versioned rebuild**: `schemaVersion` bumps, a per-sheet stale notice, and
  a bulk GM action. Nothing rebuilds silently mid-campaign.
- **Risky units run alone**: U22 (an `EffectInstanceSchema` field reaches every player by default),
  U36 (cleave's second target must route through `canPlayerTarget` — client-supplied, never
  server-chosen), U37 (push writes token position through `moveEncounterToken` only, with no client
  input), and U19/U25's projection changes — each a dedicated agent plus a viewer-safety audit
  before merge.
- **The hand-authored overlay collision is ruled once**: adopt the content planner's `clears` verb
  on `FeatureMechanics` (idempotent; a build error unless the same feature re-authors the key)
  rather than hand-editing bundles or special-casing `choice`.
- **U17's freeze is lifted**: the Stage-4 CONFIG freeze was documentation-only and Stage 4 is done.
  Delete the stale `magical-secrets` row from `CONFIG.bard.choices` and author `widensPicks` through
  the overlay — the engine plan costs the alternatives and cites why each loses.
- **CI gets one verdict per commit**: seed the dice in `typed-damage-feed.test.ts`, then dedupe the
  workflow's two concurrency groups. Six of thirty sampled commits disagreed with themselves.

**The numbering migration.** This log is the **single home for decisions**; a D-number that does not
resolve here does not exist. `docs/product/feature-implementations-plan.md` carries a file-local
D1–D8 (2026-08-07) that collides with two older schemes quoted elsewhere; those numbers are now read
as **"register D1"…"register D8"**, the register carries a pointer to this entry, and the five of
them that never reached this log are hereby logged by reference: register D1 (all twelve classes
ship), D2 (pinch-to-zoom), D4 (H1 — packages typecheck their own tests; **the packages/schemas half
was never delivered** and is batch-0 work), D5 (schema gaps close by addition, not exemption), D7
(the GM's damage entry gains an optional type — **server half only; the client half is owed** and
runs before any new unit, with issue `4b`'s client half beside it). Future decisions: dated entries
here, no parallel numbering anywhere.

## 2026-08-10 — the overlay gets a `clears` verb, and the delete it authorises is one-way

**Context.** Ruled by the client on 2026-08-10 as ruling 14 of the entry above, and **implemented in
that same form** as batch 0's last prerequisite. It is recorded in full here because the summary line
above cannot carry the hazard, and the hazard is the reason the mitigations are not optional.

For `cleric`, `fighter` and `wizard` the class record in `packages/content-srd-5.2.1/bundles/classes.v1.json`
is both the ETL's **input and its output** — those three are hand-authored and carried through
verbatim, so the mechanics overlay may only **add**. `applyMechanics` refuses to overwrite a key the
record already carries and fails the build naming both homes. A *second* edit to a shipped rider was
therefore unauthorable from the class module, and the only home left was a hand edit to a
10,418-line bundle. Measured across the whole remaining program, that bites in **exactly one case**:
Wizard's Spell Mastery, printed as "choose a level 1 **and** a level 2 spell" and shipped as one pick
of two capped at level 2. (Re-verified at implementation: `evoker.empowered-evocation` and
`fighter.studied-attacks` carry no riders at all, so the units that land on them are clean adds.)

**The ruling: a `clears?: readonly RiderKey[]` on `FeatureMechanics`.** The named keys are deleted
from the record before the merge, so a module can say *"this feature's `choice` is superseded — the
list beside it replaces it."* It is the general form of the problem, it keeps one home per rider for
all twelve classes, and it makes the collision message's own advice ("remove it from one of the two
homes") expressible in the module. The decisive argument was not code cost — at N = 1 a hand edit is
cheaper — it is that this program's shape is four concurrent agents in four worktrees, and a hand
edit is paid in the one currency the program is short of: a shared 10,418-line file.

**The hazard, stated because it does not go away.** On a hand-authored record the ETL writes the
merged record back over its own input, so a `clears` is a **one-way, irreversible** edit to committed
JSON. Deleting the `clears` line later does not bring the old value back. Three mitigations, all
part of the ruling:

1. **`clears` is idempotent.** Clearing an absent key is a no-op, never an error — so the second and
   later builds are clean and the module stays truthful instead of becoming a build error the moment
   it works.
2. **Every key a `clears` names must be replaced by the same entry, or the build fails.** The verb
   can never be a silent delete-only tool. An invalid entry deletes *nothing*: it contributes none
   of itself rather than the irreversible half. *Corrected 2026-08-10, same day:* this first shipped
   as the weaker "unless the same feature also authors **a** rider", which is a per-entry test — so
   `{ clears: ["choice"], tags: [...] }` satisfied it, deleted a whole `choice`, replaced nothing and
   returned clean. That is the irreversible unreplaced delete the mitigation exists to fence, so the
   code was tightened to the promise rather than the promise weakened to the code. "Replaced" means
   the key itself or the other form of it for `choice`/`choices`, which cannot coexist on a record
   (`oneChoiceForm`) and so must supersede each other — the one-becomes-several case the verb was
   built for, and the reason the test is not simply "the identical key comes back".
3. **The review bar is the `git diff` of `classes.v1.json` in the same commit.** Stated here because
   the collision guard's whole argument was that an unannounced overwrite would be *"unreviewable and
   un-revertable"*. `clears` makes the overwrite authorable, so the review is what has to make it
   reviewable again.

**Rejected, with why.** *Hand-edit the three bundles* — cheapest at N = 1, but it reinstates the
shared-file workflow the overlay was extended to end, and splits the authoring surface so an author
reading `wizard.ts` sees nothing of what Wizard actually authors. *Teach the guard that `choices`
supersedes `choice`* — five lines, but a special case for whichever pair happens to be first; the
next case (a `uses` that must change) needs a second one. *Move the three onto the generated path* —
freezes 242 records' worth of prose into a hand-maintained copy the cross-check deliberately does not
compare, to gain somewhere to hang three lines of riders. The full costing is
`docs/product/plan-content-program.md` §4.

**Consequences.** The verb and both code-enforced mitigations live in
`packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts`; `HAND_AUTHORED` moved there from
`packages/content-srd-5.2.1/scripts/build-class-bundle.ts` because it is a property of the merge, not
of the parse, and one home is what lets a test hold the merge to the same three classes. The proof is
in `packages/content-srd-5.2.1/test/mechanics-overlay.test.ts`: a build over a copy of the real
bundle, run **twice**, ending at the picks the twice-built record offers. Because the hand-edit option
was *not* taken, `classes.v1.json` does **not** become a serialization point for concurrent agents —
a `clears` is a module edit, and modules are one file per class by design.

## 2026-08-09 — the calendar's two clocks are independent, and an era is derived from the year

Client report (`5f`): *"Your date and Players' date give no indication of how to set them, setting a date
sets **both** at once, and there is no era field."* Three rulings, one of which **reverses a dated decision
in this log** and is recorded here rather than edited quietly into the code it contradicts.

- **REVERSED: K7's auto-publish now covers seeding ONLY.** `writeCalendar` published the first campaign date
  a codex was ever given. K7's reasoning — v15 backfills `published_*` for pre-M11 campaigns, so a post-M11
  one would otherwise set a date and leave every player blank — was sound, and its scope was too wide. A GM
  who has run a campaign for months, never published a date, and finally sets one **while prepping** had it
  broadcast to the table by a write that says nothing about publishing. That is what the client reported as
  "setting a date sets both at once", and no arrangement of the UI could have decoupled it, because the
  coupling was one line in the store. Auto-publish now requires `isUnusedCodex()` — no pages, journal, maps,
  markers, quests, sessions, standing, connections or folders — which is the case K7 was actually protecting:
  a codex being **set up** rather than run. `importBundle` is unaffected; it wipes every table and then
  writes the bundle's own published date over the result. (`apps/server/src/codex-store.ts`, `writeCalendar`.)
- **Publish is always visible, disabled when there is nothing to publish.** It used to render only while the
  clocks had diverged (`CalendarView.tsx`). Combined with the auto-publish above, that meant that **from the
  unset state there was no visible publish act at all** — the GM set a date, the server published it, the
  clocks agreed, and no control ever appeared. Two clocks with no visible act between them read as one clock
  with two readouts, and that absence, not the server line alone, is why they felt welded. A disabled button
  with the reason beside it protects against a no-op click without concealing that the act exists.
- **The GM's clock is a door; the players' is not.** "Not set" was plain text, and the only way in was a
  ghost "Edit calendar" button opening the world's structure, where the date is the *fourth* field. It is now
  a button opening a dedicated date editor (`CampaignDateEditor`). The players' clock deliberately gains no
  such affordance: **D11-H stands** — the published date is a COPY made by `publishCampaignDate()` and by
  nothing else, so a "set the players' date" control is one that cannot exist. Its one door is Publish.
- **An era is DERIVED from the year, never stored on a date.** `CodexCalendar.eras` is a list of
  `{name, startYear}` inside `calendar_json`; a date's era is the last era whose start its year has reached.
  So the whole migration is `normalizeCalendar` reading `eras ?? []` — no `ALTER`, no backfill, no stored
  date rewritten, and an existing calendar upgrades by being read. The rejected alternative (an `era` field on
  `CodexInWorldDate`) needs `in_world_era` on two tables plus three `published_*` siblings, a backfill that
  must **invent** a value for every date already written, and it makes `calendar_instant` ambiguous. Eras are
  **projected to both audiences, never filtered** — structure on the footing of `months` and `weekdays`, which
  a player has always received. `yearName` ("Era suffix") is kept and unchanged: with no eras defined, every
  label is byte-identical to what it was. Where an era applies it **leads** the year — "Third Age 1492" —
  which is the "suffix rather than a leading component" defect the report named.

## 2026-08-09 — a quest has five statuses, "open" means not finished, and a new quest is Not started

Client report (`5d`): *"Quests need to expand their status options, it at least needs 'Not started'
and 'Canceled'."* `CodexQuestStatus` is now
`"not-started" | "active" | "completed" | "failed" | "canceled"`, in lifecycle order. Two rulings
came with it, and both **reverse a position this repo had written down**, so they are dated here
rather than quietly edited into the code they contradict.

- **`canceled` is not a synonym for `failed`, and does not wear `danger`.** A lead the party never
  took up did not fail. Recording it as a failure both misreports the campaign and puts a red badge
  on something nobody lost, so the tone silently contradicting the word beside it is the specific
  defect this avoids. `not-started` and `canceled` share `neutral` — the two states that want no
  attention (`apps/client/src/codex/quests.ts`, `questStatusTone`).
- **REVERSED: the default for a new quest is `not-started`, not `active`.** A quest record is created
  the moment a lead is NAMED — `CodexQuestCreateRequest` requires nothing but a title, precisely so a
  rumour can be written down mid-session — and a rumour nobody has acted on is not an active quest.
  With three statuses `active` was the least wrong of them; now that "not started" exists, keeping it
  would mean the honest state is the one a GM must select by hand. Nothing is lost from the dashboard
  because of the next ruling. (`apps/server/src/codex-store.ts`, `questStatus`.)
- **REVERSED: "open" is NOT FINISHED — `not-started` or `active`.** `openQuests`' docblock asserted
  "open is `active`, and nothing else"; that reading is retired and the docblock now says so
  (`apps/client/src/codex/quests.ts`). The card is headed "Open quests", not "In progress", and a
  lead is open. The decisive consequence: with the new default, the old reading would have meant a GM
  writes down a quest and watches it never appear on Home. The three TERMINAL states — `completed`,
  `failed`, `canceled` — are what leaves the card.
- **Existing campaigns are unaffected, by construction.** Migration **v26** rewrites no stored status,
  so no quest that was closed yesterday is open today. It is the SECOND table rebuild in
  `codex-store.ts` and it follows the 2026-07-29 entry below (*"M11: rebuild the journal table rather
  than drop its CHECK"*) rather than re-deciding it: SQLite cannot widen a `CHECK` in place, and
  dropping it would leave `questStatus()` guarding the process but not the file. The copying `SELECT`
  is column-for-column with no `CASE` and no default, and `codex_quests_status` is recreated with the
  table.
- **The chronicle verbs are player-facing copy, not internal labels.** `QUEST_EVENT_VERB`
  (`apps/client/src/codex/chronicle.ts`) completes the sentence `<Quest title> ___` on the party's own
  timeline, so the two additions were chosen on how that sentence reads: **"has not started"** (true
  at creation AND when a GM pushes a quest back, which "was noted" would not be) and **"was
  canceled"** — the passive is not optional, because "The Amber Bargain canceled" reads as the quest
  doing the cancelling. Same discipline the file already states for "reopened": say the payload, never
  guess the sequence.

## 2026-08-03 — One Language: the play glossary, and where it is kept honest

The play-facing unification (D1–D33; the full decision record is the engagement's master plan,
off-repo — what the repo must remember is here). The product had grown three vocabularies and no
mechanism to keep them apart, so these are the words plus the thing that fails when they drift.

- **The glossary, by concept (D28).** The playable thing is a **character**, a **monster** or an
  **NPC** — never an "actor", a "combatant", or "creature" used as a generic. The list they act in
  is **Turn order**; **Initiative** stays the score. The event is a **fight**; the place is the
  **Table**. Visibility is **Shown to players / Hidden from players / GM only** — one pair of words
  everywhere, which retired the five phrasings one `<select>` had for one roll audience. Claim states
  are **Available / Claimed / Your character**, and the verbs are **Claim / Release**. A finished
  fight's record is a **Replay**. Wire names are NOT copy and keep their spelling: `encounter.*`,
  `strict|assisted|freeform`, `gm-only`, `battlemap`. The rejected alternative was a style guide —
  the Codex had already proved that a paragraph nobody re-reads loses to a hurried label.
- **The verb triad, and each verb's promise. Delete** is permanent, always confirmed, and the
  confirm says "This cannot be undone." **Archive** is reversible and its copy offers the way back.
  **Remove** takes something out of one list and the thing survives. A dialog whose verb and whose
  consequence disagree is the defect this rule exists to name.
- **Vocabulary is enforced as a test, over an EXCLUSION list.** `apps/client/src/copy-scan.ts` is the
  one scanner (extracted from the Codex's, which now imports it — two copies would be the exact drift
  the locks exist to catch). `play-vocabulary.test.ts` reads **everything under `apps/client/src`
  minus a pinned exclusion list**, plus `packages/ui/src/primitives`. An include list was rejected:
  this engagement alone added `settings/`, `builder/` and `replay/`, and every one of them would have
  been born unlocked. Exemptions are **(file, string) pairs**, not global strings — SRD's "creature
  type" is right in the homebrew monster form and was drift in the token picker — and an exemption
  that stops rescuing anything fails until it is deleted.
- **What the lock deliberately cannot do, so nobody mistakes green for proof.** It reads copy, not
  code: a literal inside a JSX expression (`{claimed ? "Claimed" : "Available"}`) is invisible,
  because widening the scan to every string literal would flag every wire value in the tree. The
  classes that matter are pinned at their DEFINITION instead (`CLAIM_WORD`, `ROLL_VISIBILITY_WORD`,
  `SETTINGS_GROUPS`, `DIAL_COPY`), which is stronger than pinning a rendering of them. And a regex
  matches tokens, not senses — so the terms D28 keeps (fog Reveal/Hide, Initiative the score, Save
  the throw, Claim/Release, the shared screen's Present) are asserted PRESENT, not merely un-ruled.
- **The GM's roll picker lost its third option.** For a GM roller `self-only` and `gm-only` reach the
  same eyes (`apps/server/src/combat-log.ts` gates a `self-only` row on the roller's session, and the
  roller is the GM), so two of the five phrasings were two names for one audience. The wire value is
  untouched and still labelled where a GM READS a player's roll; only the GM's own picker collapsed.

## 2026-08-01 — Codex final polish: five durable rules

Settled while closing the decision-fidelity gaps and the client-reported sidebar bug. Each is a
choice between two defensible options; recorded so the loser is not re-proposed.

- **A control that changes a state must not be gated on the state it changes.** The sidebar's collapse
  toggle was rendered only when not collapsed, so it hid itself the moment it was used, and the
  persisted preference made that permanent. The gate belongs on the reason the control is *meaningless*
  (`railBand` — the forced 761–849px track, where there is nothing to expand into), never on the state
  it produces. Generalised as a verification rule too: **a toggle is half-verified until the return
  trip is verified**, which is why `sidebar-rail.test.tsx` and the browser pass now drive toggles both
  ways. Every check this repo owned tested reachability, and a human found the door in minutes.

- **Selection that can lose work is a NAVIGATION, not local state.** The pin inspector holds a draft
  with autosave off, so selecting another pin has to travel the one guarded path (`navigate` →
  `mayLeave`). Choosing `?pin=` as the source of truth rather than adding a second guard call site also
  bought refresh-proofing and Back — the reason D3 put the pin in the address in the first place.
  Rejected: registering the guard inside `AtlasView` and keeping local state, which would have made two
  implementations of "may I leave?" and left the selection unaddressable.

- **A create verb creates; a door to a form is named as a door.** The palette's "New session" and "New
  quest" now run the same `creates.ts` the rails run and land on the new record. The two "Log …" rows
  still navigate, because a journal entry and a downtime record need a form — so they are named for the
  door they are. Rejected: removing the false verbs (D7's point is one create habit everywhere), and
  naming the form-based rows "New …" for symmetry (which is the original lie, relabelled).

- **When behaviour and a normative ADR clause disagree, change the behaviour if the clause states a
  property most of the surface already keeps.** ADR-0016 §2's request-id rule was true of five routers;
  the viewer and token routers were laxer. Both now enforce UUID v4. Changing the ADR instead would
  have written a carve-out for a log-forgery vector into the standard, and nothing in the app sends the
  header, so no caller loses a correlation id. The reverse call would be right if the clause were
  aspirational or if callers depended on the looser behaviour.

- **The player gets an affordance unless it is a GM tool.** D1 says the sidebar is collapsible and the
  player's mirrors the GM's "minus GM tools"; a collapse control is not one, so the player has it now,
  on its own storage key and never inside the GM's embedded preview (a modal is not a viewport, and the
  preference written there would be the GM's). The same reading is why the player's lists got the GM's
  filters rather than a reduced set.

## 2026-07-31 — Codex server QA pass: five durable rules

Settled while fixing the adversarial QA findings on `apps/server` and `packages/api-contract`. Each was
a choice between two defensible options; recorded so the loser is not re-proposed.

- **A record's PROJECTION decides whether it may be a connection endpoint, never its reveal flag.**
  `revealedSourceIds` and `projectPlayerPageConnections` both resolve through the record's own player
  projection, and `CodexPageConnectionRow.otherRevealed` is documented as a GM-facing fact that is NOT the
  player gate. A flag test is only equal to a projection until the projection grows a second condition —
  which `projectPlayerJournalEntry` had already done twice (standing→faction, quest event→quest) before
  anyone noticed the connection surfaces had not followed.

- **What may be forwarded to an API caller is an ALLOW-LIST.** `CodexValidationError` exists so the store's
  58 GM-readable refusals can be forwarded by TYPE rather than by default. A denylist of driver errors
  would need extending for every new error class; this way the default for anything unrecognised is the
  sanitized 500. `CodexStore has not been initialized.` is deliberately left a bare `Error` so it lands
  there.

- **"No records in this FILE" and "no records in this CAMPAIGN" are different answers, and the wire already
  distinguishes them.** `exportBundle` writes every section unconditionally, so an empty campaign carries
  `"pages": []` and a truncated file carries nothing recognised. A restore refuses the second and performs
  the first. Rejected: "refuse any bundle that produces zero records", which would break the legitimate
  empty campaign, and "trust `bundleVersion`", which the caller may strip.

- **A journal row's provenance is read from the KEY's presence, not from `bundleVersion`.** D9 writes
  `sessionId` on every exported journal row even when null, so its absence dates the row to a pre-D9
  export — which is what tells a lost join apart from director ruling R2's bare display label. Rejected:
  the bundle-level `bundleVersion`, which is optional on the wire and documented as absent-means-pre-
  versioning, so a modern backup POSTed with the key stripped would corrupt exactly those labels. The flag
  rides on a separate `CodexImportBundle` type so it can never reach `exportBundle`'s output.

- **An idempotency key identifies ONE request, and the receipt remembers which.** Migration v24 binds a
  receipt to `method + path`; a mismatched reuse is a 400 rather than a replay. Bound to the route and NOT
  to the body on purpose: a client retrying after fixing a typo is finishing one request, and a body hash
  would make the key useless to it. Pre-v24 receipts (NULL fingerprint) still replay, because refusing
  retries in flight across an upgrade is the worse trade and receipts age out in seven days.

## 2026-07-31 — the Codex client: one sidebar, real addresses, one vocabulary

Codex overhaul, Lane C. Durable decisions, plus three OWNER DECISIONS this lane supersedes.

- **A hand-rolled history layer, not react-router.** `apps/client` had zero router dependencies; the app
  is four separate Vite HTML entries of which only `index.html` needs addresses; the address space is
  small and fully enumerable; and react-router's data-router idioms (loaders, actions) fight this app's
  socket-push + ping-and-refetch model. ~230 lines instead of a dependency. Revisit only if the address
  space stops being enumerable.
- **The GM's Viewer tab is addressed `/viewer-controls`.** `GET /viewer` is reserved by the server as a
  307 to the standalone TV viewer in BOTH prod and dev, so the SPA can never receive it — a tab
  addressed `/viewer` would be a link out of the app. "Viewer controls" is also what the tab is.
- **An unknown address and a GM-only address render the SAME view.** `NotFoundView` for both, because an
  address that answered differently would confirm the surface exists. Same family as the 404-not-403
  rule the record routes keep, one axis up.
- **The command palette is Codex-scoped, deliberately not global (D20).** Mounted only by `CodexShell`
  and the player shell, so ⌘K means nothing on the Encounter tab. A test locks it, because "make it
  global" is the obvious next step and is a separate decision.
- **Inverse relationship wording is an ACCEPTED LOSS.** `RELATIONSHIP_TYPES` could say "rules" from one
  end and "ruled by" from the other. A free-text label cannot; a reader now gets direction ("This page
  points to" / "Points at this page") plus the label. Recorded so it is not rediscovered as a bug.
- **`discardTransient` exists because `popTransient` cannot serve a caller that is about to navigate.**
  `history.back()` is a task and `navigate` pushes on a microtask, so close-then-navigate pushed the
  destination and immediately went back off it. See known-bugs for the bug it caused.

**Superseded owner decisions.** Each was right when made and is wrong now; recorded rather than deleted.

- **D-3 (the Codex is a tab with modes)** → superseded by D1/D3. Modes were unaddressable, so four
  surfaces had no URL and the tab bar lit "Campaign" over whichever one was open.
- **D-10 (the player Codex is a modal over the table)** → superseded by D4/D14. A modal cannot be deep
  linked, cannot be refreshed, and gave players a second, thinner vocabulary.
- **D-2 (the app always opens on the Encounter tab)** → superseded by D2. It still does when there is
  nothing to resume; a deep link now always wins, and a bare `/` resumes the last location per role.

## 2026-07-31 — one connection system, quest history, and a restore that honours old backups

Codex overhaul, Lane B (Phases 2-4). Five durable decisions.

- **Typed relationships and `[[wiki-links]]` are ONE concept, over TWO storages (D8/D13, v22).** The
  Codex had two ways to say two records are related, and a GM had to remember which one they had used.
  They unify into a CONNECTION with an optional label and an `origin`. The storages stay: a declared
  edge is id-keyed and CRUD-able, a mention is title-keyed and rebuilt from body text on every save, and
  materializing mentions as rows would need a sync protocol ("what does deleting a connection whose
  source is a sentence mean?"). D8 permits this in its own words. Nothing moves, so the unification is
  lossless in both directions. The twelve legacy slugs become the labels a reader sees, which retires
  the client display mapping - and costs the inverse wording ("ruled by"), which a free-text label
  cannot express; a reader renders direction plus label instead.
- **The connection gate is one predicate with three conditions, for BOTH origins.** Target page
  revealed, source record revealed by its own kind's rule, and `layer === 'player'`. That is stronger
  than what it replaces: a GM-layer DECLARED edge between two revealed pages no longer travels, and a
  connection out of a hidden session's prep body cannot be a way around that session's own gate.
- **Quest history is written on CREATE and on status change (D11, ruling R5), and hidden WHOLE.** A
  quest record carries empty player text, so it cannot stand on its own prose - the standing CORRECTION's
  exact false premise - and nulling `questId` alone would ship "Quest - completed" for a quest the party
  has never heard of. The whole row is gated on the quest's reveal, on `projectPlayerJournalEntry` so all
  four player journal surfaces inherit it. Migration v19 widened the CHECK for this in Phase 2, so D11
  needed no second table rebuild.
- **Import is REPLACE-only, and `bundleVersion` is OPTIONAL (D16, ruling R1).** Merge is undefinable for
  the singleton, invariant-bearing state a bundle carries; every merge rule would be a reconciliation
  policy with its own silent-corruption mode. A bundle with no version is a pre-versioning backup and
  restores, because honoring the backups a GM already has is the entire point - a required key would keep
  the promise only for files made after the upgrade. Rows are written RAW: a restore reproduces a state,
  it does not perform a hundred authoring events, so it fabricates no quest history and no snapshots.
- **`commandId` idempotency is checked INSIDE the write guard, not before it (D19, v23).** As a plain
  router middleware the replay ran before authorization, which made a receipt into a bearer token - a
  player who knew a GM's key got the GM's 201. A replay is a cache of a response, and a cache must never
  be reachable by a caller who could not have produced the response. The receipt is recorded after the
  commit, and the one-retry crash window that leaves is documented rather than hidden: a receipt written
  first can report success for a write that never landed, which is the worse failure.

## 2026-07-31 — journal entries join their session by identity, and the Codex learns to autosave

Codex overhaul, Lane B (Phases 1-2). Five durable decisions; one of them consciously supersedes a
recorded owner decision, which is the reason this entry exists at all.

- **Journal entries link to a session by ID, not by number (D9, migration v19).** `session_number` on a
  journal row was a copy, so renumbering a session made every one of its entries lie
  (`known-bugs.md`, OPEN since 2026-07-29). The number is now a DISPLAY value resolved live from the
  linked record: renumbering relabels every entry with no journal write, and the by-session lens can
  never lose a group. Writes accept `sessionId` only; a bare `sessionNumber` in a write body is a 400
  with the key named in `details.issues`, because a client asserting a display value would be asserting
  something the server owns. Omitted on a create auto-files under the ACTIVE session — which now works
  for an *unnumbered* active session, where the old number-stamping could not link at all.
- **v13's "sessions arrive with NO backfill" is consciously superseded (client decision D9).** v13
  refused to synthesize session records for the numbers legacy entries carried, on the stated grounds
  that inventing prep, recap and attendance would fabricate facts. That objection is honoured rather
  than overridden: migration v19 synthesizes exactly one record per orphan NUMBER, with **empty** prep,
  recap and attendees, `status: played` and `revealed: 0`. Nothing is invented, nothing becomes visible
  to a player, and the only screen that changes is the GM's session list — where a number that already
  existed now has a record behind it. The alternative was orphaning those numbers, which is data loss.
  The v13 comment in `codex-store.ts` stands as the history; this is the decision that supersedes it.
- **Session delete stamps the number back CONDITIONALLY (director ruling R2).** A revealed session's
  number is written onto its entries as a bare label when the record goes — behaviour-preserving, since
  the players were already reading it. A hidden session's entries get nothing: a bare label has no
  record left to gate on, so it would pass through to players and announce that a session they were
  never shown existed. Secret-by-default wins over label continuity.
- **Autosave is a stored preference, in SECONDS, defaulting to `{enabled: true, intervalSeconds: 1}`
  (D6, ruling R4, migration v18).** One unit from the wire to the column, so nothing converts at a
  boundary and nothing can convert twice. The default is what the shipping editors already did (an
  800 ms debounce) expressed on that scale, so an upgraded codex saves exactly as often as it used to.
  The server stores a preference only — there is no server-side draft, so enforcement is editor
  behaviour.
- **The `codex:changed` ping is content-free (D22).** It carried a `scope` word to every socket,
  players included, which told the table which part of the codex the GM was working in. No listener
  ever read it, and the homebrew notifier eight lines away already refused the same thing on principle.
  Two notifiers, one rule.
- **A type-changing page save forces its revision snapshot (D7, ruling R7).** The pruning such a save
  performs is exactly the content the coalescing window would otherwise swallow, and the client's
  confirm dialog promises it is recoverable from History. The switch still wins: `enabled: false`
  writes nothing, and a type change is not an exception to it.

## 2026-07-31 — the Codex joins the public API, and the API stops overstating itself

Codex overhaul, Lane A (`c7fc8aa`, `5f78d87`). Six durable decisions, three of which consciously
supersede something already on the record.

- **The Codex is credential-reachable, at GM grade.** `codex:read` / `codex:write` sit beside the
  sessions on every codex operation. **This supersedes the pin at `contract.test.ts:139-145`** ("no codex
  op carries `bearerAuth`") and the README sentence that said so in prose. The pin was not wrong when it
  was written — it recorded a real decision — but its consequence was that an external tool had to borrow
  the GM's *session token* to read one page, which is the widest possible credential for the narrowest
  need. The test is rewritten rather than deleted, and the interesting claim survives in it: exactly one
  codex operation still refuses a credential, and it is the one that mints a session
  (`POST /codex/preview-session`). A credential acts at GM grade because that is already the game
  surface's model; a player-grade bot is expressible today with `POST /api/v1/sessions/player`, so a third
  scope would be a second way to say the same thing. `codex:write` does not imply `codex:read` — scopes
  are independent everywhere else, and a write-only automation that could also read the GM's secrets
  would be a scope that means nothing.
- **401 means "no credential"; 403 means "you presented one and were refused."** The codex answered 401
  to an authenticated player, which tells a caller who is signed in to sign in — advice that cannot work,
  and which a retrying client acts on. Any presented-but-failing token (player on a GM surface, junk,
  revoked, underscoped) is now 403. This is game-http's split, not homebrew's junk-token-401, and it is
  the API's own published convention finally being true. **Behaviour break, deliberate**; eight tests
  asserted the old status and most now assert both arms. The *other* status rule is untouched and must
  stay: a record a player may not see is **404, never 403** — that is a different axis (existence, not
  authorization), and conflating the two would turn every id into an existence oracle.
- **Response schemas are role-truthful: named `*Player` components joined by a `*Projected` `oneOf`.**
  The alternative — keep GM components and describe the deltas in prose — leaves the machine contract
  false, and a player response failing validation against its own published schema is the worst kind of
  documentation bug: checkable and silently wrong. What makes `oneOf` sound is a **one-sided** rule (the
  GM branch requires ≥1 key the player branch does not declare), asserted mechanically. It is one-sided
  because six player shapes are strict key-subsets of their GM twin, so the symmetric rule is
  unsatisfiable for them — and an unsatisfiable assertion is one that gets deleted. The contract now
  *mirrors* `codex-projections.ts`, which stays the implementation source of truth; an Ajv cross-check
  over real GM and player bodies is what stops the mirror drifting. **If the two ever disagree, the
  projection is the fact and the contract is the bug** — never widen a component to make a test pass.
- **Idempotency is stated per surface, because it was never API-wide.** `info.description` promised that
  "every write accepts an optional `commandId`"; only the game surface implements it, and a codex or
  homebrew caller who believed it got a 400 from a `.strict()` body. Withdrawn in favour of the honest
  three-surface statement. (Codex `commandId` is planned; it will be documented when it exists, not
  before.)
- **Every codex GET carries a weak ETag, tagged per grade.** Correctness rests on the store's existing
  discipline that every write bumps the coarse revision inside its own transaction — reveals and clock
  moves included, since those change what a reader sees without changing any record's `rev`. **That rule
  is now load-bearing: a new write that skips the bump serves stale reads.** The tag includes the grade
  so one cached answer can never be served to the other role, and the conditional check runs at
  serialization, after every auth and existence gate, so a probe cannot turn a 404 into a 304.
- **ADR-0016 is Accepted, with the normative conventions statement it always promised**, including a
  compatibility clause scoped honestly: v1 is stable by intent, but this instance ships client and server
  in lockstep with no known external consumers, so coherence-buying breaks are permitted inside v1 while
  the product is pre-1.0 — each recorded here. A public or multi-tenant posture would require a major
  version. That clause is the single place to revisit if the owner ever wants stronger guarantees.

## 2026-07-30 — version history: a checkpoint is of the state you are about to LOSE

Throttling `codex_page_revisions` is only safe because the snapshot direction changed with it. `updatePage`
used to record the state it had just written; it now records the state it is about to overwrite. With
new-state snapshots, a save at t=0 is checkpointed, saves through t=80 are skipped, the GM stops, and a save
that ruins the page at t=3000 checkpoints the **ruined** state — the good work was never captured. Prior-state
means the ruinous save first preserves what it is destroying, which is the only reading under which "at most
90 minutes of work could be lost" survives an idle gap.

Everything else follows from that one idea:

- **Age is `authored_at`, and no new column was needed.** Under prior-state semantics that column means "when
  the checkpointed content was last authored", which is exactly the quantity the guarantee measures. A
  capture-time clock breaks it: a checkpoint *written* at t=95 holds content authored at t=80, so at t=180 it
  reads an age of 85 and skips while the work actually at risk is 100 minutes old.
- **A restore always checkpoints.** Every save checkpointed before the throttle existed, so a restore was
  always undoable; leaving it throttled would make "I restored the wrong version" unrecoverable inside the
  window. This is *preserving* behaviour, not adding policy — which is why the exception exists at all.
- **The window has an exception; the switch does not.** The restore's bypass was first ordered above the
  `enabled` check, which let a restore write history into a codex whose history the GM had switched off. The
  window is a policy about frequency, the switch is a policy about whether to keep history at all, and only
  one of those is negotiable.
- **`0` is not `off`.** Zero minutes means "keep every save" — the pre-decision behaviour, which a GM may ask
  for by name. Conflating the two would take it away and silently restore the unbounded table.
- **Off means off, creation included.** `createPage` is never throttled by the window (a page with no history
  has nothing to fall back to) but it does honour the switch: "globally disable-able" that still leaves one
  row per page is not that.
- **Deleting is bounded by arithmetic, not by a special case.** `olderThanDays: 0` removes everything because
  nothing is younger than zero days old. The day field nonetheless floors at 1 and delete-all has its own
  button and confirm: they are different decisions, and one is unrecoverable. And **if history ever needs
  bounding further, bound the TABLE** — an export carrying part of the history would be a backup that lies.

## 2026-07-30 — four owner decisions on the final-QA findings

The final QA pass deliberately left seven UX findings and the prep-clock date leak as **owner decisions**
rather than fixing them unilaterally. The owner ruled on four.

**The prep clock keeps its dating; the reveal warns; the warning is switchable.** Records go on carrying the
GM's own clock — that is genuinely when the thing happened, and dating them at the *published* clock would
make the timeline lie about its own order. Instead, revealing a record dated **strictly after** the published
date asks first. Two silences are part of the decision, not omissions: an **undated** record discloses
nothing, and a campaign that has **never published** has no "what players have been shown" for a record to be
ahead of, so it does not warn — a dialog that fires on every dated reveal is one the GM learns to dismiss
unread, which costs the real case its only defence. Hiding never warns; a confirm on the way back to safety
teaches a GM to stop hiding things. The switch is per-device `localStorage` rather than server state: it
changes nothing a player can observe and nothing the server authorises, so a migration, a route and a
contract change to store a preference about a dialog would be the wrong trade. It is set only from the
affirmative button — a GM who flicks it and then cancels has abandoned the interaction, and disabling a
warning on the way out of a dialog they backed out of is how a safety net vanishes with nobody deciding it
should — and there is a **way back on**, because there is no settings screen in this app to undo it in.

**The export bundle is complete, and left unbounded.** `calendar`, `folders` and `revisions` join it; each
existed nowhere else, which is the same reason every earlier key was added. The measured cost is real and
recorded rather than discovered later: 200 pages × 15 revisions takes the bundle from 1.24 MB to 20.8 MB
(~17×), and revision history is unbounded because nothing prunes `codex_page_revisions`. **If that ever needs
bounding, bound the table, not the export** — a bundle carrying only part of the history would be a backup
that lies about being one.

**A clock move states its cost before the button that causes it.** "…— this passes 2 deadlines." Silent at
zero, because a warning present on every downtime in a campaign with no deadlines is noise that spends the
GM's attention on nothing.

**One record, one row per screen — and only the kinds that genuinely duplicate.** The dashboard feed drops
`event`, `deadline` and `standing`, which have cards of their own. The QA finding also named downtime and
milestones; **it was wrong**, and following it would have been a deletion rather than a de-duplication —
`CampaignHome` has no card for either, so the feed is their only home. The general lesson, which is why this
is here: a review finding names a symptom, and the fix still has to be checked against what the code actually
does. `standing` was the genuine judgment call and the crowding argument settled it: its card is unsliced and
lists every faction, while five standing adjustments (which carry no player prose by design) used to fill all
five feed slots and push every real entry out.

## 2026-07-30 — a projection change is not automatically a docs change

`CodexRevealAuditRow` gained a field, which is a contract change, so both generated docs were regenerated per
ADR-0016 — and **neither changed**, correctly. `reference.ts` seeds its referenced-schema set from **request
bodies only**; a response schema is labelled, never expanded, so `CodexRevealAuditRow` appears nowhere in
`docs/api-reference.md`. `renderAppMap()` reads `GameStateSchema.shape`, `GAME_COMMAND_SCOPES` and
`openApiDocument.paths` + methods, so a components-only change is invisible to it.

Worth recording because the M11 lesson pointed the other way (contracts must not forbid regenerating the
docs) and the naive correction is to expect a diff every time. **Regenerate always; expect a diff only when
the change touches a path, a method, a request body, or the game state.** No diff after regenerating is
evidence the docs are current, not evidence the generators were skipped.

## 2026-07-29 — M12: three decisions closing the campaign-tracking programme

**M12-A — the reveal audit covers Codex records only**, not tokens, fog, or the shared table viewer.
This is the spec's own recorded default for open question **U-5**, and the owner confirmed it. The table
side has its own visibility system with different rules; folding it in would make CT-9 the second place
that decides what a player can see, which is precisely what its "read-only aggregation" risk warns against.

**M12-B — standing is signed −100…+100 on seven tiers, always read as a word.**
`Hunted · Hostile · Unfriendly · Uninvested · Friendly · Allied · Exalted`. The owner specified the middle
five verbatim — notably **`Uninvested` rather than `Neutral`**, because a faction that has taken no
position is not the same as one that has weighed the party and landed at zero — and delegated the outer
two. `Hunted` is below Hostile (the faction is not merely against the party, it is coming for them);
`Exalted` is above Allied (not merely allies but honoured within it). Bands are symmetric with
`Uninvested` centred, so neutral is genuinely neutral.

**The tier table is a reading rule, not stored state.** It lives in `chronicle.ts` beside
`CHRONICLE_KIND_META`; the server stores only the integer. Tiers can be renamed or rebanded later with no
migration and no record rewritten. `Meter` is reused unmodified (it is shared with token health) and the
signed value is mapped onto its unsigned range at the call site.

**M12-C — one party marker for the whole atlas**, not one per map. "The party is in exactly one place"
needs no reconciliation rule; one-per-map would leave "which pin is real?" unanswerable and require the GM
to keep several in step by hand. Enforced by a partial unique index as well as in code.

## 2026-07-29 — M12: the reveal audit reports VISIBILITY, not flags

The Director's contract told the implementer to build CT-9's membership from the existing **GM**
projections. That was wrong twice over, and the server-boundary agent caught it rather than complying.

Every GM projection is an identity passthrough, so membership would have had to come from re-reading each
record's own `revealed` column — the exact `revealed = 1` predicate the same paragraph forbids two
sentences later. Worse, for two of the seven kinds the flag is simply not the answer: **a marker revealed
on a hidden map** (CD-6: a player 404s on the map before a single pin is projected) and **a standing
revealed for an unrevealed faction** are both flagged revealed and neither is player-visible.

An audit built on flags therefore tells the GM their players can see things they cannot — on the one
screen whose entire purpose is answering that question. Membership now runs the **player** projections
directly: the audit asks the same code that serves the party. It is structurally incapable of becoming a
second source of truth, because it holds no predicate of its own.

Proven directly rather than argued: with a pin revealed on a secret map and a standing revealed for a
secret faction, the audit reports zero visible for both and its counts match what a real player token
receives; a flag-based audit would have reported both.

## 2026-07-29 — M12 (operating): a stale dev server silently serves old code

While verifying M12 the Director recorded a defect that did not exist — the faction-only guard on standing
appeared to accept a character page over HTTP while refusing it at the store. The cause was a **stale
`tsx` server still holding port 3199**: a kill loop matched the npm/sh wrappers but left the node child
alive, the replacement logged "server ready" without binding, and every probe went to the old process.

**Before trusting any HTTP probe: kill by PID, then confirm the port actually returns nothing.** A server
that answers is not evidence that it is running the code you just wrote. This cost a false finding that
was only caught by testing the same guard directly at the store layer and getting the opposite answer.

## 2026-07-29 — M11 (operating): implementation contracts must not forbid regenerating the docs

The M11 agent contract forbade running `npm run docs:generate` and `npm run map`, reserving both for the
Director. That is unimplementable: `apps/server/test/app-map.test.ts` and
`packages/api-contract/test/reference.test.ts` each require their committed doc to equal the generator's
output byte-for-byte, and **every milestone in this programme adds routes**. The agents therefore had to
hand back a red suite and say why. They did, and the Director regenerated — but the contract's own rule
was "STOP and report the contradiction", and it went unreported until the adversarial review found it.

**For M12: either let the agent regenerate both docs, or state in the contract that two named tests are
expected red on handoff.** The first is simpler and is what the rule should have said.

## 2026-07-29 — M11: the first campaign date a codex is ever given publishes itself

> **SUPERSEDED (2026-08-09, D6 — "the calendar's two clocks are independent", top of this file).** The
> reasoning below stands; its **scope** was too wide. Auto-publish now fires only for a codex holding **no
> records at all** — the seeding case this entry was actually protecting — because on a campaign that
> already exists, the first date is set while *prepping*, and prep is private. The narrowing is
> `isUnusedCodex()` in `apps/server/src/codex-store.ts`.

O-1 makes the GM's clock private, and migration v15 backfills the published date so an existing campaign
sees no change. A campaign created *after* M11 has nothing to backfill — so the GM would set "Current
date — the world's now" and every player's date would stay blank, with the only explanation living on a
different screen. That is a silent regression against what every pre-M11 campaign did, and nobody approved
removing it.

So the transition from "no published date" to "a published date" happens automatically; every later move
of the GM's clock stays private until published. This cannot leak: the prep clock exists to run **ahead**
of the party, and there is no ahead of a date they have never been given. Found by adversarial review,
reproduced through the real HTTP routes, and fixed with the leak direction ("publish every move") proven
by mutation to fail five tests.

## 2026-07-29 — M11: a deadline's date cannot be edited away

`createDeadline` enforced "a deadline IS its date" from the start; `updateEntry` did not — and it is the
door a GM uses more often. Clearing the date left `kind = 'deadline'` on a row with no instant to compare,
so it read "Deadline · Approaching" forever on the GM journal, the dashboard card and every player's
timeline, and could never fire however far the clock ran. Two clicks from the Journal, with no test
covering it.

Now refused at the store (loudly, rather than silently keeping the old date — a PATCH must not answer with
something other than what it asked for) and disarmed in the composer, which says why. Moving a deadline's
date is still ordinary editing; only removing it is refused, and every other kind may still be undated.

## 2026-07-29 — M11: three owner decisions on deadlines and downtime

Put to the owner in plain language before implementation, because each changes behaviour and the spec
either had no default or contradicted itself.

**O-1 — a private prep clock.** The GM's clock and the players' clock are now two stored values. The GM
advances time while prepping and players keep seeing the old date until the GM publishes it. This makes a
supported workflow out of the open question `known-bugs.md` recorded after M7: `GET /codex/calendar`
returned `store.getCalendar()` **unprojected to any authenticated role**, so `currentDate` had always
reached players and there was no server-side gate to run the clock ahead of them. There is one now.
The player's field keeps the name `currentDate` and only its source changes, so the existing player
"Now:" chip needed no change at all.

**O-2 — deadlines and downtime are hidden, revealable like anything else.** The spec's verification clause
contradicted itself here ("GM-only until explicitly revealed"). The owner chose the default: created
hidden, published by the ordinary reveal switch, no kind-based visibility filter anywhere. Writing
`if (kind === 'deadline') return null` in a projection is now explicitly wrong, not merely redundant.

**O-3 — downtime proposes, the GM confirms.** Creating downtime never moves the campaign clock. It answers
with the date the clock *would* move to, the GM sees that date on the row, and a separate explicit action
applies it. The reflow-adjacent write is therefore always deliberate, never a side effect of writing a
note about the week off.

## 2026-07-29 — M11: rebuild the journal table rather than drop its CHECK

`codex_journal.kind` has carried `CHECK (kind IN ('note', 'combat'))` since migration v1. SQLite cannot
widen a CHECK in place — no `MODIFY`, no `DROP CONSTRAINT` — so adding `deadline`/`downtime` needs a full
table rebuild: create, `INSERT … SELECT` with explicit column lists, drop, rename, recreate all three
indexes. Verified by probe before deciding, not inferred: inserting a `deadline` row on a v14 file failed
with `CHECK constraint failed`, and `ALTER TABLE … MODIFY` was a syntax error.

**Dropping the CHECK would have been one line and it is the wrong line**, for the reason v13 and v14 each
record: a TypeScript gate protects this *process*, not this *file*. A repair script or a manual `sqlite3`
session could then write `kind = 'quest'`, which the parser coerces to `"note"` — a bad row reading back
as a plausible one instead of failing loudly.

**Widened to all six kinds now** (`milestone` and `standing` are M12's), because the cost of this
migration is the rebuild and paying it twice for one word each would be silly. The DB being more
permissive than `CodexJournalKind` is the direction that already exists and the safe one.

## 2026-07-29 — M11: a deadline stores no payload, and `fired` is derived

The spec's §2.2 gives `deadline` a payload of `{ what, targetDate, fired }`. All three dissolve:

- `what` is the entry's own `playerText`. A deadline *is* its text.
- `targetDate` is the entry's own in-world date. A deadline is "a thing that will happen at a time" — the
  spec's own definition of a timeline record. A second date inside a JSON blob would sit **outside**
  `setCalendar`'s reflow, which is precisely the corruption K3 exists to prevent.
- **`fired` is derived on every read, never stored.** K3 makes raw dates the source of truth and instants
  derived; a stored `fired` is a second derived cache reflow would have to maintain. Deriving satisfies
  CT-5 exactly. The only behavioural difference is that rewinding the clock un-fires a deadline, which is
  correct.

Likewise **downtime's `outcome` is not a payload field** — it is prose, and prose already has two layers
on this record. A third prose channel inside a JSON blob would sit outside the reveal split.

## 2026-07-29 — M11: `fired` must be measured against the audience's own clock

The Director's implementation contract mandated `fired` on the player chronicle row *and* forbade the GM
clock reaching a player payload by any path. Those are contradictory once O-1 exists: a `fired` derived
from the GM's private clock is one bit of that clock on a player surface — a player watching the flag flip
learns the prep clock has passed a date they have never been shown.

Both server agents found this independently and it was not in the contract as issued. Resolved by making
the instant an **argument** — `deadlineFired(entry, at)` — with two accessors, `campaignInstant()` for GM
readers and `publishedInstant()` for player readers, so no caller can be audience-agnostic by accident.
There is exactly one `<=` comparison in the codebase and every caller must name whose clock it means.

## 2026-07-29 — M11: the server owns where its own clock lands

The client can compute a downtime's proposed new date, and for the composer's live preview it must —
the record does not exist yet for the server to answer about. But once the row exists, the **server's**
`proposedDate` is what the Confirm affordance names, because the server decides where the clock actually
goes and the affordance promises that date out loud. Two implementations of one answer is the
"two ways to say one thing" shape this overhaul exists to remove; they agreed only because the client
helper hand-clamps a case its shared `dateToInstant` does not.

## 2026-07-29 — M9: four owner decisions on sessions, prep and recap

Put to the owner before implementation, because each materially changes behaviour and none had a safe
default in the spec.

**No backfill of legacy `session_number`.** The spec recommended minting a `codex_sessions` row per
distinct non-null number found in `codex_journal`; the owner declined. Existing numbered entries therefore
keep grouping exactly as they did, under a number with no record behind it, and a group becomes openable
only once the GM creates that session for real — at which point the entries join it with nothing rewritten.
This is strictly safer than the recommendation: it invents no prep, recap or attendance nobody wrote, and
guesses at no numbers. The by-session lens degrades gracefully rather than lying.

**An active session exists, and new records attach to it.** CT-1 asks for "automatic links to the journal
entries and encounters"; nothing was automatic, and `appendCombatEntry` hardcoded `sessionNumber: null` —
which is precisely why CP-9's session half was undeliverable before M9. The pointer lives on `codex_meta`,
so "exactly one active session" is structural rather than a rule every write must remember.

**CT-3's recap badge ships, and it is keyed on session id, not a timestamp.** The requirement names a "new
since you last looked" indicator on the Codex button — which lives in `main.tsx`, outside the Codex and
outside M9's Owns list. Included anyway, because partial delivery of an approved requirement is the worse
outcome; the out-of-Owns file is recorded as a stated stretch. The spec assumed the badge compares
`updatedAt`; it cannot. Reveal deliberately does not move `updated_at` (CI-9), so the one event the badge
exists for would never fire it, and prep edits *do* move it, so it would broadcast GM activity a player
must not infer.

**Sessions are Codex-only (U-3 default), and do not join `/codex/timeline`.** A session has no
`calendarInstant`, and `compareChronicle` sorts every undated record below every dated one, so sessions
would clump beneath their own entries. M8 had already set the precedent of adding a route rather than
widening one.

## 2026-07-29 — Two measurement methods this repo should stop trusting

Both found while verifying M9, both contradicting something previously written down.

**`scrollWidth` does not measure horizontal overflow here.** A closed `Menu` panel is still laid out
off-screen, so `documentElement.scrollWidth` read 734 against a 375px viewport while the page did not
scroll at all — `window.scrollTo(900, 0)` left `scrollX` at 0. The honest test is whether `scrollX` can
move. Any prior overflow figure obtained by subtracting `clientWidth` from `scrollWidth` is suspect.

**A router-header probe cannot prove a route is mounted.** `homebrew-http.test.ts` requests each declared
path and treats the presence of `x-request-id` / `cache-control` as proof of mounting. Because
`router.use(...)` carries no path and the router is mounted bare, those headers come back for any path
whatsoever — `/completely/unrelated/path` returns 404 with both. M9's Codex equivalent enumerates Express's
real route table instead, and checks methods as well as paths.

## 2026-07-28 — Stage Six: the world calendar is player-readable by design (accepted, not overlooked)

The final viewer-safety audit found exactly one un-gated GM-authored value in the whole Codex, and asked
for an explicit decision rather than an implicit one. This is that decision.

**The fact.** `GET /api/v1/codex/calendar` (`codex-http.ts:522`) returns `store.getCalendar()` verbatim to
any *authenticated* role — including `currentDate`, the "Now" the Campaign dashboard renders. It is the
only role-shared read in the router that is not branched through a `project*`/reveal check; an exhaustive
sweep of every `envelope(response, …)` call confirmed that. It predates M7 — the dashboard surfaces it,
it did not introduce it.

**Accepted as intentional.** CI-7's own text says both GM and players land on the dashboard and see "the
current in-world date". A reveal gate here would contradict the requirement as written. P2 ("secret by
default") governs *records* — pages, maps, markers, entries — each of which does have its own
`revealedToPlayers`. The world clock is not a record; it is the frame those records are dated in, and
players already receive in-world dates on every revealed journal entry via `inWorldLabel`. Gating the
clock while shipping the labels would be incoherent.

**The cost, stated plainly rather than buried.** A GM who sets the date forward while prepping — or who
is simply exploring the calendar editor — telegraphs elapsed in-world time to any player with the Codex
open, immediately, with no `RevealSwitch` and no warning in the editor. That is a real workflow the
current design does not support.

**What would change this.** If prep-ahead becomes a wanted workflow, the fix is a `currentDateRevealed`
flag (or a separate GM-only planning date), not a blanket gate on the calendar — months and weekday names
must stay readable or every player-facing date label breaks. Recorded in `known-bugs.md` as the trigger.

**Not a leak of GM-only content as the system is specified.** The auditor's own verdict: no GM-only page,
map, marker, journal entry, relationship, wiki-link, search-index text or replay linkage survived any
traced path.

## 2026-07-28 — Codex overhaul M7: return edges, the Campaign rename, and what "recent" means

1. **Every return edge reuses the destination's existing latch; none introduced its own.** CI-3/CI-5/CI-6
   land through `openEntryId`, `focusPageId` and `openTarget` — the same latches search and the dashboard
   already use. Three edges arriving in one milestone is precisely where a second navigation mechanism
   gets introduced, which is the root cause (#1, parallel vocabulary) this programme exists to remove.

2. **CI-4 and CI-8 are single-gated on purpose.** M6 shipped a double gate (SQL predicate + projection
   re-check) and it hid a blind spot: weakening the SQL marker arm alone left **all 787 tests passing**,
   because the projection masked it. So the M7 feeds keep the store reads ungated and make the projection
   the only gate — one layer, fully tested, nothing to mask. Two store tests assert the ungatedness so a
   later "hardening" cannot silently reintroduce the problem. Both feeds' predicates are *copied* from the
   corresponding player list endpoint rather than written fresh.

3. **`World` → `Campaign`, and what deliberately kept the old word.** The atlas map **kind** `"world"` is a
   map *scale* and a server contract value; the in-world calendar vocabulary (`inWorldDate`,
   `formatWorldDate`) is server field naming; the graph's `worldX`/`worldY` are SVG world-space
   coordinates; and prose about the fiction ("Chart your world", "worldbuilding") is about the setting,
   not the mode. Renaming any of those would have split a different vocabulary while healing this one.

4. **The Campaign dashboard shows only records that exist.** CI-7's spec text lists next session, open
   quests, approaching deadlines, party position and faction standing — but those records are Phase 4
   (M8–M12) and the M7 plan entry excludes them. Building placeholder panels would have been scope the
   plan explicitly rules out, and would have made the dashboard look broken rather than incomplete.

5. **CI-9: what counts as "recently updated".** Relationship edits move `updated_at` on **both** endpoints;
   reveal-toggle and folder-move do not. `rev` is deliberately left alone for relationship edits — `rev` is
   the conflict token, and bumping it would 409 a GM mid-sentence on a page whose body nobody touched.
   `deleteFolder` is treated as a folder move because it re-paths pages identically; the spec names only
   "folder move", so that one is a judgement call rather than a reading.

6. **Wiki-link edges are distinguished without colour** (R2): dashed vs solid, thinner, **no arrowhead**
   (a mention claims no direction), the label "mentions", a permanent solid-vs-dashed key, and a split
   count. Lit colour is shared on purpose — delete every colour and the graph still reads.

## 2026-07-28 — Codex overhaul M6: one search index, and tags that match uniformly

1. **One unified FTS index, and the pages-only tables are dropped.** Migration v11 creates
   `codex_search_player` / `codex_search_gm` — `fts5(kind UNINDEXED, record_id UNINDEXED, title, body)` —
   backfills the existing page rows, adds maps, markers and journal entries, then **drops
   `codex_fts_player` / `codex_fts_gm`**. Keeping the old pair alongside the new one would have meant two
   sync paths to hold in step on every page edit, which is the parallel-mechanism root cause this whole
   overhaul exists to remove (assessment root cause 1), and design rule **R8** is explicit: *"One search
   box, one result list, all record types."* `searchPages` survives as a kind-filtered read of the same
   index, so page search behaviour is preserved by construction rather than by a second mechanism.

2. **Reveal state is deliberately NOT indexed.** It is resolved against the live row at read time, so
   toggling a reveal — including on the *map a marker sits on* — needs no reindex and cannot leave the
   index disagreeing with the record. Index writes happen only where indexed *text* changes.

3. **The player index mirrors each kind's player LIST predicate, and fails closed.** A player-visible
   index is a player-facing projection (`.claude/rules/viewer-safety.md`), so a weaker predicate here
   would make search the leak. Pages/journal/maps gate on their own reveal flag; **a marker requires its
   own flag AND its map's**, which is CD-6's lesson carried into search — a shown pin on a secret map is
   invisible to players, so it must not be findable either. Applied twice on purpose: in SQL (with
   `ELSE 0`, so an unknown kind is invisible rather than public) to stop hidden records crowding the
   result cap, and again in `projectPlayerSearchHit` as the audited gate. A marker hit carries no parent
   link at all, so the hidden-parent-map rule holds by construction.

4. **Page tags are indexed too — a deliberate widening of existing page search.** Maps, markers and
   journal entries index their tags, and leaving pages out meant one search box answered a tag query
   differently depending on which record happened to carry the tag. That reads as a broken search, not as
   a boundary. **R8 and CI-2 ("tags on all record types") only hold together if a tag matches uniformly.**
   The cost is real and is accepted: a page tagged `villain` now matches a "villain" search, which it did
   not before. Reversible by dropping `tagText` from `indexPage`. The v11 backfill carries page tags as
   well, so an upgraded database indexes pages identically to a freshly written one.

5. **CI-2 shipped as store + edit + search, not as a cross-type filter.** Clicking a tag still filters
   Pages exactly as before. A tag click that returns every record type needs a cross-type result surface
   that overlaps M7's navigation work, so it was recorded rather than built. Put to the owner and not
   answered; the literal reading of CI-2 was taken and is easy to widen later.

## 2026-07-28 — Codex overhaul M5: the entity field table becomes shared, and the touch floor reaches a canvas

1. **The Codex entity field table moves to `@vtt/domain`; presentation stays on the client.**
   CD-2 asked for server-side field pruning on an entity-type switch, but the server had no per-entity
   schema at all — `entities.ts` states outright that it "stores types + fields + relationship slugs
   opaquely", and `entityFields()` validates only key *shape*. Worse, the server already carried
   `SECRET_FIELD_KEYS = new Set(["goals"])`, a hand-synced copy of the client's `secret: true` markers,
   with a comment asking the next author to keep the two in step. **That duplication was a live
   viewer-safety hazard**: a field marked secret client-side but absent from the server's set is never
   sealed and ships to players on reveal. So the key list and the secret flags now live once in
   `@vtt/domain` (`CODEX_ENTITY_FIELD_KEYS`), which both sides read; labels, placeholders, icons and
   colors stay client-side because only the client needs them. The global (not per-type) secret set is
   *derived* as the union, which preserves the server's existing behaviour exactly while removing the
   hand-sync. Alternatives rejected: pruning client-side only (contradicts "enforce server-side" and
   leaves the duplication), and deferring CD-2 (leaves the viewer-safety hazard open).

2. **Pruning is allowed to delete field values because the revision history makes it recoverable.**
   The plan's escalation clause was "escalate if CD-2's pruning would delete data a GM could not
   recover". Checked before implementing: every save snapshots `fields_json`/`gm_fields_json` into
   `codex_page_revisions`, and **nothing trims that table**, so `restoreRevision` brings back the old
   type together with its values. The clause does not fire. Pruning runs on create, on a fields write,
   and on a bare type-only PATCH — the last being the case that used to strand values.

3. **D-4 made explicit: the Codex is single-writer, last-writer-wins.** CD-3's misleading copy was
   already half-fixed by M4's `SaveState` swap ("Changed elsewhere", no Reload button). The server's
   409 text still promised "Reload to keep editing", a recovery step that does nothing under D-4, and
   is now "This page was changed somewhere else after you opened it." `onReload` stays deliberately
   unwired. `onRetry` *was* wired — an error is a genuine dead end, which is a different question from
   the concurrency one D-4 settled.

4. **The 44px floor on a zoomable canvas: hit geometry, capped by neighbour distance.** SVG graph nodes
   can satisfy neither design-language §4 route — `::after` does not reach SVG geometry, and a node's
   on-screen size is a function of the zoom transform, not CSS. There was **no repo precedent**: every
   existing 44px precedent is a DOM control. Chosen (owner-approved): a transparent hit `<circle>` sized
   to 44px on screen, **capped at half the distance to the nearest node**. The cap is §4's gap budget
   applied to a canvas — uncapped, zooming out would overlap neighbours, and SVG awards the hit to the
   topmost element, so the last-painted node would silently swallow its neighbours' taps. Where the cap
   binds, the target degrades to the painted radius rather than stealing.

5. **A-3 is verified by measurement again, not at source level.** The spec had downgraded A-3 to a
   source-level check with the note that `elementFromPoint` measurement "needs a browser runner the repo
   does not have". The repo still does not have one — the runner lives in the scratchpad and is not
   committed — so this is a stronger verification of the same bar, not a new repo capability. Measured
   88 controls across all five modes at 375px and 1440px: **zero below the floor**. The geometric
   "tap theft" heuristic proved unreliable (it flags compliant `@vtt/ui` tabs), so no-theft was instead
   proven functionally: tapping a tree row opens the page, tapping its ⋯ opens the move picker, and
   adjacent tag chips each filter by their own tag.

## 2026-07-28 — Magic items: where derived numbers live, and who is allowed to compute them

1. **A derived per-actor block rides a ROLE-GATED REQUEST, never the broadcast projection.**
   `actor:available-actions` authorizes its caller for one named actor before deriving anything, so
   the block needs one gate that already exists and is already tested. Putting it on `PlayerView`
   would need the strip to be right in BOTH `projections.ts` and `PlayerActor`'s `Omit`, on every
   tick, forever — and a field reaching one list but not the other is the shape every leak in this
   codebase has had. A test asserts the block's field names never appear in either broadcast; add it
   to a projection "just for the owner" and that test goes red.

2. **The client does not compute game numbers — not even ones it "obviously" knows.** The sheet
   recomputed its own checks, saves and skills from `abilityScores` + `proficiencyBonus`. That was
   fine until items could carry riders, at which point it silently became a rule-2 violation by
   omission: a +2-saves amulet gave +5 on a GM-forced save and +3 on the player's own chip. The fix
   is never to teach the client the rule; it is to stop the client computing and send the number.

3. **A rider vocabulary needs a compile-time owner for every variant.** `interpretFeature`'s switch
   handled 8 of 21 types with no `default`, so 13 riders parsed, stored, published and vanished. The
   fix that matters is not the 13 wirings — it is `Exclude` + an exhaustive `Record`, so a 22nd
   variant cannot be added until someone declares who reads it. Same partition rules out
   double-counting: what the builder bakes is filtered out of carriers at construction.

4. **"Computed correctly" is not "delivered".** `effectiveSkillTier` had a passing test and ZERO
   production callers for the whole feature's life. A criterion is met when a player can see and
   roll it, and the only evidence for that is driving the UI. Two defects here were reachable no
   other way: `rowId` made every authored modifier unpublishable against a `.strict()` schema, and
   the publish blocker demanded prose from an item whose whole content was `+1 armour class`.

5. **Uncommitted work is work you are choosing to lose.** This container rolled its filesystem back
   twice in one session, destroying a finished, verified slice both times — the second because an
   engineer was told to leave the tree for review. Commit at every checkpoint and push; the reflog
   does not survive, but the remote does.

## 2026-07-27 — Homebrew: six rules that bind anything authoring content

1. **The audience filter lives at the MERGE POINT, not in projections.** Ten content operations took
   a principal and ignored it; nine of eleven content read paths accept player auth. A viewer-safety
   audit that only reads `projections.ts` will miss this entire class of leak. Corollary: homebrew
   never enters `GameState`, which is *why* `PlayerView` being a `Pick` allow-list keeps working.
2. **A capability that knows about drafts must not be reachable from the player path.** The
   draft-aware authorship index sits on the store and deliberately not on `HomebrewContentSource`.
   Same instinct as keeping homebrew out of `GameState`: put the dangerous capability where the
   dangerous path cannot reach it.
3. **Re-validate AFTER the write, never before.** Validating a proposed body first asks the question
   against the record's *previous* self — an emptied spell list still resolved through the overlay
   its old body had stamped, and reported itself valid.
4. **When a patch would fail the gate, land it and demote — do not refuse.** Drafts may legitimately
   be invalid and the editor autosaves mid-keystroke, so refusing makes published records
   uneditable. The record demotes in the same transaction and the response carries the truth; a GM
   must never be told something is live when it is not, and a `console.warn` is not where that truth
   belongs.
5. **Make the invalid state unauthorable, not merely reported.** A choice-bearing feature that no
   level row grants produces a class whose wizard offers a pick the server will not build — an
   uncreatable character. The fix is that a new feature arrives *already on the table* in the same
   edit, and the last level cannot be cleared. Publish still refuses the shape, as a backstop for the
   paths the editor does not own.
6. **A required argument beats a safe default when you want an audit.** `forAudience(audience)` and
   `isMintedHomebrewId(id, type)` both take required arguments so `tsc` names every call site. Known
   limit: `apps/server`'s tsconfig includes only `src`, so the property stops at the test boundary —
   a stale test call compiles and fails at runtime instead. **Reversed 2026-08-07** (plan decision
   D4): `apps/server/tsconfig.json` is `"include": ["src", "test"]`, the 50 latent errors this hid
   are fixed, and the property now holds across the whole workspace.

**On process, from the same pass.** Five HIGH defects survived nine commits, four planning documents
and six research intakes; not one was found by reading. Each came from running the flow — duplicate
Fighter and press publish (deadlocked both ways), open a feat and watch the network tab (an
unsolicited PATCH that made it permanently unpublishable). Two of the five lived in the *seam*
between engineers who had each verified their own slice honestly. **Verify by injection**: break the
guard, confirm the failure, revert. It repeatedly found guards that did not fire, one that did not
exist at all, and one test whose obligation set came from the renderer it was testing — so it could
not fail.

## 2026-07-27 — Phase 5 content: how the character bundles are sourced from now on

The other nine SRD classes landed. Four rules came out of it that bind any future content work.

1. **Character-builder content is generated, not typed.** The open5e fixtures carry no class,
   subclass, species, background or feat data, so those seven bundles had no machine-checkable
   source — and that is precisely where the `tough` feat and the elf name pools got in. New content
   of those kinds comes from a vendored, commit-pinned source through a script that fails closed.
2. **A vendored transcription is SECONDARY.** A community CC BY transcription is a cross-check and a
   transcription source, never an authority that silently overrides a reviewed bundle; a
   disagreement is a reviewed correction decided against the SRD text. It earns that standing by
   reproducing what was already hand-transcribed — see rule 3. Check the **edition** before the
   licence: a 2014-SRD transcription would reintroduce the exact violation class this prevents.
3. **Hand-authored records are the generator's oracle, not its input.** Fighter, Wizard and Cleric
   carry typed riders prose cannot express, so regenerating them would downgrade the three best
   records in the bundle. They are copied through untouched and the build re-parses them from the
   source, failing on any mechanical disagreement. A generator that cannot reproduce what a human
   already verified has not earned the right to write the rest.
4. **One owner per field.** `statPriority` is not in the SRD — it is the product's ordering for the
   random generator, and `@vtt/rules-5e` already owned all twelve. The generator reads it rather
   than keeping a second copy. Where a value legitimately has two independent derivations (hit die,
   saves, ASI levels — both in the engine and in the printed table), keep both and let the agreement
   test enforce it; where it has one owner, read from the owner.

Corollary for tests: **don't pin the incomplete state.** Two tests asserted Barbarian had no
subclasses and used Barbarian as the example of an un-authored class for the progression fallback.
Both passed for the wrong reason and would have stopped covering anything the moment content caught
up. Assert the invariant (every class offers exactly one subclass; the fallback is exercised with a
deliberately partial list), not the current shortfall.

## 2026-07-27 — Readiness pass: five rules the polish pass settled

A dedicated readiness pass (flow/IA, density/layout, design language/copy) reviewed the wizard as a
shipping product rather than as a feature. Commits `479cb80`, `5c32df9`, `584be3a`. Five rules came
out of it that bind future builder work — and, where noted, the whole UI.

1. **Annotate options; never filter them.** A pick the character can't take renders greyed *with its
   reason* ("Already granted by Soldier"), never removed. Filtering is what produced the bug this
   fixed — a background silently grants skills, so picking Athletics on the class step burned both
   picks and the character ended a proficiency short with no message ever shown. The corollary is the
   **expertise exception**: held skills are accumulated but deliberately **not** disabled there,
   because the SRD's expertise offer reads "choose one of the following skills in which you have
   proficiency" — greying them would leave only picks the server refuses and make every Wizard level
   2+ uncreatable. Reasoning is recorded in the code; don't "fix" the inconsistency.
2. **Progress means "this is done", not "you walked past this."** Step completeness derives from the
   same `stepBlockedReason` the footer uses, so a step invalidated by a later choice loses its
   checkmark the moment it happens. The `i <= furthest` conjunct is load-bearing — without it a step
   with no offers reads as complete before its prerequisites exist.
3. **Collapse is derived, never stored.** An answered offer folds to title + count + chips from
   `picks.length === capacity`. Nothing to invalidate, and un-picking re-expands for free. The chips
   are display-only spans on purpose: a readout must never become a second place the pick can be made.
4. **State a constraint once per group, not once per option.** At level 20 the per-card capacity
   notice was 409 copies of one sentence — a third of step 4's DOM. It now renders once per grid,
   with `aria-describedby` preserving it for screen readers; genuinely per-option reasons (rule 1)
   still render per card.
5. **A primitive defends its own state against app globals.** `apps/client/src/styles.css` has a bare
   `button:hover:not(:disabled)` at specificity (0,2,1) that beats `.nh-choice.is-selected` at (0,2,0)
   — independently of anything the primitive does. The fix belongs in the primitive (exclude the state
   from the aggressive selector, with the numbers in a comment), **not** in the app global, because
   coupling `styles.css` to a primitive's class name inverts the dependency. Same technique closed a
   selected card having no keyboard focus ring at all.

Also settled: **one copy template** for "answer this control", replacing five sentence shapes — which
deletes at source the lowercasing that produced "fighter starting equipment" under a heading reading
"Fighter". And a status readout that overlays content is `pointer-events: none` and makes room for
itself; the connection banner took three attempts because an in-flow strip covered all seven rail
labels and a centred pill clipped the title at 375px.

## 2026-07-27 — Character builder wizard: three UI decisions worth not relitigating

Settled while building the phase-2 wizard screens; each was a fork with a defensible other answer.

1. **The ASI level offers "raise scores" or "take a feat" — and the catalog's own Ability Score
   Improvement feat is filtered out of that feat list.** The server accepts both routes (the `asi`
   shorthand with a `payload.increases` split, or the feat resolved from `general-feats`), and they
   produce identical scores. Offering both would be the same idea expressed twice in one picker. The
   wizard offers the shorthand and hides the duplicate feat. Level-up and respec should do the same.
2. **Each step owns the picks its SOURCE asks for**, not the picks that look thematically related.
   The Sage's Magic Initiate cantrips are chosen on the Background step (the background grants the
   feat), not on the spell step; the background's +2/+1 is spent on the Ability scores step, where
   the totals are visible. One rule, no per-offer judgement calls.
3. **A choose-N grid keeps the chosen edge and check but spends no glow.** §8.1 budgets one glowing
   element per region, and a "choose 6 spells" region has six answers by definition. Rather than
   invent a second chosen treatment, the multi-select grid drops the bloom only — cyan edge plus the
   check still carry the state without colour alone. Implemented in `ChoiceCard.css`, scoped to
   `.nh-choicegrid-items[role="group"]`.

Also settled: the wizard has **one exit** (Save & close). The draft is parked on every change, so a
second "leave without saving" button would be a lie *and* — at 375px — overhang the last card in the
step with its 44px tap area. Discarding lives on the resume banner ("Start fresh"), next to the draft
it throws away.

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

> **Undated section.** Everything below this heading predates the dated sections above and
> carries no date of its own, so a claim here can only be checked against the code, never
> against a timeline. Entries known to be overtaken are marked individually. If you are about
> to rely on one, verify it at HEAD first.

- **Authoritative LAN server owns `GameState`.** No game decision runs on the client. (ADR-0001)
  > **STILL TRUE, BUT NARROWER THAN IT READS.** `GameState` is the *game's* authoritative store.
  > It is not the whole of authoritative state: the Codex, the homebrew library and the viewer
  > presentation each own a separate store with its own revision counter. The authority rule is
  > unchanged; the container is not the boundary. See `docs/ai-context/architecture.md`.
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
- **Codex tags are slugs, and the client now enforces the same rule the server always did (2026-07-28).**
  `codex-store.ts` `tags()` has always rejected anything outside `/^[a-z0-9][a-z0-9-]*$/`, but the old
  comma-separated Tags field only lowercased and trimmed — so typing "sword coast" produced a tag the
  server refused, surfacing as a generic save failure with no explanation. Adopting `TagInput` with its
  **default `slugify`** aligns the client with the server contract ("Sword Coast" → `sword-coast`).
  **This is a deliberate behaviour change, not a preservation:** the previous client behaviour was a
  defect, and "behaviour-preserving" means preserving *useful* behaviour, not bugs. Found by real
  browser verification — no unit test caught it, because none of them reach the server.
- **The Codex editor's "Link" button was removed rather than made to work (2026-07-28, CD-4).** It emitted
  `[text](https://)`, which `CodexMarkdown` provably cannot render — its supported subset has no
  markdown-link pattern. The spec offered "render standard links **or** remove the button". Rendering
  them would add a **new capability** to a deliberately display-only, injection-safe renderer, with a
  URL-safety surface (`javascript:` and friends) to design; the brief forbids introducing unapproved
  features. The button was already broken, so removing it loses nothing real. **Reversible:** real link
  support is a clean follow-up if the owner wants it, and would need an explicit safety decision.
- **The three-pane editor is earned at `min-width: 850px`, not lost at `max-width: 900px` (2026-07-28,
  CF-6).** `design-language.md` §3 fixes the ladder at **760 / 650 / 560**, plus `min-width: 850/980`
  "where a layout earns a third column". The Codex used an off-ladder 900 and 480. The context pane now
  stacks by default and the three-pane row is a `min-width: 850px` enhancement — which is what the doc
  prescribes for this exact case — and the calendar reflow moved 480 → the ladder's 560 step.
- **An auto-logged battle is dated at the campaign's "now" but stays GM-only (2026-07-28, D-5).** The
  combat-history bridge previously hardcoded every entry undated, so each battle sank below every dated
  entry into "Undated" forever — the feature the ledger called the Atlas↔combat *payoff* wrote something
  almost nobody could find. `appendCombatEntry` now stamps the calendar's `currentDate`. **It deliberately
  does NOT auto-reveal:** auto-publishing a fight the moment combat ends would spoil the session with no
  review step, so the GM reveals when ready — consistent with the codex's secret-by-default posture. With
  no current date set the previous undated behaviour is preserved exactly rather than inventing a date.
- **Replays are surfaced in the Codex GM-only, and the archive id never enters the player projection
  (2026-07-28, constraint K2).** Encounter archives contain GM-only narration and are documented as
  unreachable by players. A combat journal entry therefore carries `sourceEncounterId` in the **GM**
  projection only; `projectPlayerJournalEntry` builds a fresh seven-field object with no slot for it, so
  the guard is **structural rather than a filter that could be forgotten**. Regression-tested at the HTTP
  boundary on a *revealed* entry — the case where a player can see the battle and still must not reach the
  replay. **For future codex work:** adding a field to the player journal projection is a viewer-safety
  change, not a display change.
- **Map name/kind/parent and Delete map live in one "Map settings" modal (2026-07-28).** M1 had to add
  three map controls (rename, retype, re-parent — CP-4/CP-5) to an atlas bar that already held a reveal
  switch, Add marker, Add sub-map and Delete map. Rather than grow the bar to seven controls (which reads
  badly at 390px and fights design-language §5's "one primary action per view"), the three new controls plus
  the **existing Delete map** moved into a single `Modal`. **Relocating Delete map traces to no requirement**
  and is recorded here as a deliberate, reversible UX decision, not silent scope: the destructive action is
  unchanged in behaviour (same `useConfirm` flow), it is simply no longer a bare button in the toolbar.
- **The atlas is a forest and needs a root switcher, not just a breadcrumb (2026-07-28).** The data model
  always allowed several root maps, but every navigation affordance was single-tree: the breadcrumb climbs
  one parent chain and drill chips only descend. Creating a second root (CP-6) therefore produced a map that
  became unreachable as soon as the Atlas remounted. Durable rule: **any surface that lets a forest be
  created must also let every root be reached.** Implemented as a "Top level" chip row shown when more than
  one root exists, mirrored in the player atlas (which reads the revealed-only projection, so it needs no
  extra viewer-safety handling).
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
  folders/revisions/export stay GM-only even for reads.
  > **SUPERSEDED (the auth clause only), 2026-08-01.** The Codex **is** credential-reachable now:
  > `codex:read` / `codex:write` are real `IntegrationScope` values (`packages/api-contract`), the
  > router wires `verifyIntegration` (`apps/server/src/server.ts`), and `principalFor` resolves
  > `integration` alongside gm / player (`apps/server/src/codex-http.ts`). The authoritative table
  > is `docs/api-reference.md` under "Authentication"; the rules are `docs/ai-context/codex.md`.
  > Everything else in this entry still holds. No route/behavior change — the server still serves the
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
  > **PARTLY SUPERSEDED, 2026-08-01.** Two of the four gaps are closed. **(1) is no longer true:**
  > the Codex has an integration-API surface — `codex:read` / `codex:write` scopes, a wired
  > `credentials.verify()`, and OpenAPI paths in the served document. **(4) is no longer true:**
  > `codex_page_revisions` is bounded by a global switch plus a coalescing window, with
  > `DELETE /codex/page-revisions` to trim history that already exists. **(2) and (3) still hold**
  > and remain accepted. See `docs/ai-context/codex.md`.
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
  Durable rule, enforced by shared components in `packages/ui/src/primitives/Reveal.tsx` (promoted out
  of the Codex when the same question started being asked on every surface): (1) *record
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
    roll surface, replacing the table-wide GM `combat.rollMode` (retired from the UI; the field and
    `encounter.set-roll-mode` were left inert, then **deleted outright on 2026-08-03** — the one
    approved breaking API change of the play-facing unification). The preference is
    **per person, not per table** (product decision): each player
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
  `docs/archive/claude-code-tooling-outline.md`. Scheduling that lives in code = `.claude/loop.md` +
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
- **2026-08-03 — Rules enforcement is a table policy with five families, not one table-wide switch.**
  `GameState.rulesPolicy` (dial + per-family exceptions) is the standing setting every fight inherits
  at `encounter.start`; `combat.rulesMode` + the additive `combat.ruleExceptions` are that fight's
  live copy. The five families are `movement`, `economy`, `resources`, `targeting`, `slots`
  (`rules-families.ts`), and `effectiveModeFor` is the single reader every rule site
  now uses in place of a raw `combat.rulesMode` read — so switching movement policing off no longer
  silences opportunity attacks' siblings in other families. Three consequences worth knowing:
  (1) **the wire enum keeps its names.** `strict|assisted|freeform` is unchanged; Enforce/Advise/Off
  is surface copy. Renaming would be a second breaking API change and only one was approved.
  (2) **`slots` defaults to `assisted`, not to the dial** — slot enforcement is new, and inheriting a
  default-strict dial would start hard-blocking casts that have always worked. The GM opts in.
  (3) **an override is one tap and its reason is optional** (schemas loosened, audit falls back to
  "GM override"), and it is remembered per FAMILY for the rest of that creature's turn
  (`turn.rulesOverriddenFamilies`, superseding the two-prefix `turn.rulesOverridden` boolean, which
  is kept so a mid-turn save written by an older build still parses and still behaves).
- **2026-08-03 — Archived means out of play on the server, not just out of the picker.** The only
  guard on archived characters was the player projection and some client `.filter()` calls, so any
  caller replaying a known `actorId` could claim one or stage one. `claimCharacter`, `buildSceneCombat`
  (scene create + set-combatants), `startEncounter` and `addCombatant` now refuse them outright rather
  than silently filtering — a silent filter makes the GM's own selection lie back to them. Two paired
  fixes make the state reachable again rather than a trap: archiving a claimed character releases the
  claim in the same mutation, and an archived-but-still-claimed character can be deleted (releasing
  the claim), which abandoned claims previously made impossible. A parked scene prepared before this
  can still contain archived combatants; activation warns the GM in the feed and does **not** refuse —
  refusing would strand the scene, and no stored prep is scrubbed.
- **2026-08-03 — The example party ships as ordinary characters.** Their sheets were keyed `example-*`,
  and two gates read the `import-` prefix as "this sheet belongs to one character and may be edited or
  removed" — so the starter party could never be levelled, respecced or deleted. Fresh installs are
  fixed at the source; existing saves are repaired once by the `example-party-normalization-v1` seed,
  which re-keys the definition (body copied verbatim) and drops the orphaned row. Net zero against the
  100-definition cap, idempotent, and it never touches a definition another actor still references.
- **2026-08-04 — The landing is a title screen, and the toggle re-skins it.** D30's "full
  statement" landed as a full-viewport scene: star field, slatted sun, a grid rolling toward the
  viewer, the wordmark as a blue-steel chrome sign, two chamfered doors, CRT vignette + scanlines.
  Midway the scene was declared theme-invariant ("an attract screen commits to its night"); the
  client reversed that the same day — the toggle re-skins the drive. Three skies now share one
  composition: night (dark), the sunset hour (dusk), daybreak (light), all via the `--landing-*`
  token block (`packages/ui/src/styles/design-tokens.css`), which is the only thing the themes
  override. The sign's final form came from client references: blue-steel chrome — a metal the
  scene never wears — with a 13-stop smooth ramp, a softened mirror meet, a 0.5px hairline, and one
  magenta halo. The doors live in the scene's language (deep-violet panels, white-hot labels,
  magenta player rim / violet GM rim) and stand out by luminance, not borrowed hues; daybreak swaps
  them to pale glass with deep-inked rims.
- **2026-08-04 — Dusk is the sunset hour, not a washed-out dark.** The dusk theme's surfaces read
  as dark-mode-lifted-and-drained; they deepened into a true twilight purple
  (`--bg #2E2856 → #251A4E` and the surface ladder with it). Every text pair GAINED contrast:
  caution 7.06/6.07/5.05 → 8.24/7.20/6.08, muted 6.55/5.63/4.68 → 7.64/6.68/5.64, re-measured and
  recorded beside the values in `design-tokens.css`.
- **2026-08-04 — THE SCREEN IS THE PAGE (adopted; implementation pending).** The landing's locked
  viewport is promoted to the app-wide layout standard: the page itself never scrolls — only
  designated regions inside a surface scroll. Targets: laptop 16:9 1080p using width AND height;
  phone using vertical space. Adopted from the client's direction after the title screen shipped;
  the standard, the layout system, the per-surface recomposition blueprints and the enforcement
  plan live in `docs/ai-context/design-language.md` (v2) and the `/styleguide` route's Layout
  sections, each marked **in force** or **adopted — lands with the refresh**. No app surface was
  reworked under this entry; the refresh is a separate, client-gated engagement. Reference
  implementations already conforming: the landing, the shared-screen viewer, the wizard layer,
  Modal/Drawer.
- **2026-08-04 — THE SQUARE STANDARD: surface radii are zero; pills survive; big choices wear the
  chamfer.** Part of the client-approved "screen is the page" refresh (phase A foundation).
  `--radius-sm/md/lg` flipped to 0 in `design-tokens.css` — the whole app squares off at once, which
  is the intended blast radius; the tokens survive so reversing is one edit. `--radius-pill` is
  deliberately untouched: gauges stay gauges (HP/progress bars, status pills, chips, token rings —
  all pill sites read the token). The landing doors' cut is generalized as the `.chamfer` utility
  (`--chamfer-cut` polygon + `--glow-drop-*` filter twins of the glow set, because box-shadow and
  the outer focus ring cannot follow a clip-path cut — chamfered controls glow by filter and focus
  by inset outline) and applied to the Button primitive's primary/destructive variants. One scoped
  exception, and the reason is a hard invariant: `sm` buttons keep the plain square because
  clip-path clips hit-testing and would destroy their `.tap-target` ::after hit area — the 44px
  floor outranks the cut.
- **2026-08-04 — Scene scope: where the sky may shine, and where only texture may.** Ruling for the
  refresh's look: content-light surfaces (settings, roster, scenes, replays list, and the codex
  everywhere — editors at higher glass opacity) get sky + scene-tier glass; the landing keeps its
  full drive; **the table gets texture only** (grid/noise per theme) — the sky never renders behind
  combat, though in-map docks may use scene-tier glass over the MAP, which is their canvas. The
  scene tier shipped as `.surface-glass` beside `.surface-frost` (two tiers of one glass treatment,
  never a third), with the reduced-transparency fallback going solid. Consumers arrive with the
  surface phases; the tier itself is foundation.
- **2026-08-04 — View-level motion, three flourishes, and nothing on scroll.** Motion for the
  refresh stays at the view level (tab swap = `anim-view`, layers = `sheet-up`/`dialog-in`, drawers
  = `--ease-drawer`) plus exactly three additions, all shipped as tokens/utilities riding the
  existing anim vocabulary so the global reduced-motion kill covers them unchanged: the view-swap
  **cascade** (`.anim-cascade`, capped stagger, containers never list items), the **theme-switch
  sky moment** (`.theme-switching` + `--dur-theme` 400ms cross-fade recipe, deliberately not
  !important so the reduced-motion kill always wins), and the one-shot **landing→app entry
  transition** (`entry-dip`/`entry-settle` keyframes; the shell wires them when it locks). Still
  ruled out, no reversals: scroll parallax and ambient loops.
- **2026-08-04 (later the same day) — REVERSAL: the app wears the REAL sky, and the table stays
  texture-only.** Phase A of the refresh built the scene tier as "one quiet vertical wash off the
  theme's own surface ramp plus a single brand bloom — **no sun, no horizon, no stars**", and wrote
  that into `design-language.md` §9. That was the director's own reading and it was wrong: the style
  guide's "three skies" are three theme cards each rendering a LITERAL sky — a sun disc, a horizon
  line, a receding perspective grid and stars — and its captions describe hours, not washes ("deep
  indigo void, magenta grid"; "ember horizon over deep twilight purple"; "dawn over the same grid…
  stars stand down"). **The client reversed the ruling: `.pane-scene` paints the drive.** Recorded
  here rather than edited away, per CLAUDE.md. The scope ruling above is NOT superseded — which
  surfaces stand on a sky is unchanged, and the codex sky it promises is still unbuilt behind B2.
  What changed is what a sky IS.
  - **The table gets no sky. This half has no backing in the style guide** — the guide never
    mentions a table — so it is a director ruling and must not be "fixed" later by an agent
    reconciling the two. A horizon behind a battle map competes with the map, and the map is the
    canvas. Its CHROME does take the linework instead, so it does not read as left out: the tab bar
    wears the chrome-tier scanline, and the dock's inner edge wears the horizon's own rule. *(The
    dock's half was invisible as first shipped — the resize grip painted over it; see the correction
    entry below.)*
    > **SUPERSEDED IN PART, 2026-08-06 (round 2, ruling 22)** — see the entry below. The table now
    > takes the horizon behind its CHROME; the ban survives, narrowed to the map stage. The
    > sentence above forbidding a later "fix" was aimed at an agent reconciling the guide, not at
    > the client — the client reversed it.
  - **The sky is generalized FROM the landing, never shared WITH it.** New `--sky-*` tokens and a
    `.pane-sky` layer; the `--landing-*` block and the landing's own rules are untouched (the entry
    animation is a concurrent lane). Three departures make it a work screen: the horizon is a fixed
    inset from the pane bottom rather than a percentage, so it cannot drift into content; the sun is
    a masked CREST rather than a disc, so the landing's clipping sky band and slat gradient are both
    unnecessary; and the floor rides a clipped decoration layer, because its perspective throws paint
    ~500px past each edge and would otherwise grow `document.scrollHeight` and fail the no-scroll
    audit on every scene route.
  - **Legibility is structural, not dialled.** Row-scanned over every pixel of the bare sky for a
    run of ≥4 consecutive failing pixels, the band failing AA for `--text-muted` is ≤157px at
    1920×1080 and ≤130px at 390×844 in all three hours, so the scroll regions RESERVE
    `--sky-horizon-inset + --sky-sun-crown` (176px / 144px) in their bottom padding. *(Numbers
    re-measured the same day when the sun became a hemisphere — see the correction entry below;
    the first cut measured 149/125 against 164/136.)* A surface that adds bare copy tomorrow
    inherits the guarantee, with one named caveat: the run rule sets POINT FEATURES aside, because
    a 1px star can land anywhere in the pane and no bottom reserve can bound it. The sunset hour's
    wash is truncated at `#6E1B66` rather than run to the landing's ember `#E88A4A`, which measures
    1.45:1 under `--text-dim` — dusk, not daybreak, was the real defect.
- **2026-08-04 — The last two landing lessons get built: role rims and the sign.** `--rim-player` /
  `--rim-gm` (+ `.rim-*`) and `--sign-chrome`/`--sign-stroke`/`--sign-glow` (+ `.sign`) were written
  into §9 as lessons and never implemented. Now real. **The rim attaches to the GM-SECRET
  TREATMENT, not to the hue:** "violet is GM-only" is not literally true — `--violet` is load-bearing
  for magical/concentration (§2), NPC token strokes, condition dots, legendary actions and presence
  across ~50 rules — so writing "violet = GM" as a colour rule would make the language a defect
  against its own semantic table. The rim is never the only signal: every site that wears one names
  its role in words a screen reader reaches. *(True as of the correction entry below — it shipped
  false at three of the four sites, and the words were added there.)* The sign stays barred from
  panel headers; one edit to `.nh-panel-title` would put the metal on every panel and it would stop
  meaning anything.
- **2026-08-04 — The sky's first cut is corrected: what the tokens promised and the pixels did not
  deliver.** Three independent audits of the reversal above found the same class of defect — a
  claim the code did not keep — and each was reproduced in the browser before it was touched.
  Recorded here, not edited away, because the corrections change numbers the entries above quote.
  - **The sun was a slab, not a disc.** `--sky-sun-d` and `--sky-sun-crown` shipped as independent
    numbers (24rem under 3.25rem), and at that ratio the mask's circular cap degenerates into a
    chord: the visible silhouette measured 394×54px, 7.3:1, 8.4% taper, hard vertical sides. The
    diameter is derived now — `calc(--sky-sun-crown * 2)`, a hemisphere — because two numbers that
    must hold a ratio should not both be typed. The reserve moved with the taller crown: worst
    unsafe band 157px / 130px against 176px / 144px (was 148/125 against 164/136).
  - **The reserve's guarantee has a caveat and it is now stated.** The band scan sets POINT
    FEATURES aside; per-pixel, a star fails AA anywhere in the pane, and no bottom reserve can
    bound a 1px dot. Read it as "no *band* of unsafe sky above the reserve".
  - **The GM's rim was invisible on a phone.** `Tabs`' edge-fade mask erased the inset shadow that
    is the rim on every route whose active tab sits past the fold. Frame row 2 is a
    `.frame-tabbar` wrapper now: **a rim must never live on a masked element.**
  - **Three of the four rim sites did not name their role in words**, which is exactly what the
    entry above promises they do. Fixed rather than narrowed — the player bar is "Player sections",
    and the settings `Group` appends "GM only" to its Eyebrow from the same flag that paints the
    edge, so the two cannot drift.
  - **The dock's beam was painted over** by the resize grip's flat `--line` bar, which sits at the
    same x one z-index higher — so the table-chrome half of the ruling above was invisible in every
    state. The grip is transparent at rest; the dock owns its edge and the grip owns its state.
  - **`--sky-wash`'s stops crossed in a short box**, banding the ramp; every stop is horizon-relative
    now, which is the rule the rest of the scene already followed.
  - **Not-found joined the sky** — the most content-light surface in the app was the only one of its
    kind on flat ground.
  - Two contrast limits were measured and written down rather than left to be discovered: `.sign`
    clears **AA-large only** in daybreak (valid at wordmark scale, nowhere smaller), and the light
    `--danger` destructive label is under AA with or without the scene (known-bugs, with the sky's
    −0.14 recorded so the token fix is sized against the composited value).
- **2026-08-06 — REVERSAL IN PART: the table takes the horizon behind its CHROME, and the map stage
  stays a clean dark plate.** Round 2, ruling 22, client's words: *"Sky behind the chrome, never the
  map."* This reverses the no-sky half of the 2026-08-04 entry above — which was flagged at the time
  as a director ruling an agent "must not 'fix' later", so it is reversed **by the client, on the
  record, with a date**, and that sub-bullet now carries a superseded marker pointing here. Anyone
  who reads only the old entry and starts stripping the sky is reverting a live ruling.
  - **The reason survives; only its scope changes.** "A horizon behind a battle map competes with
    the map, and the map is the canvas" was right and is still the rule — it is now a SCOPING rule
    rather than a ban. The dock, the sheet and the margins get the horizon. Nothing paints behind
    the map, and the mechanism is structural rather than a z-order convention: the stage is opaque
    `--void` (`apps/client/src/scene/encounter-map.css`) and the column around it was demoted from
    an opaque `--surface-1` panel to a margin, so there is no slab left to paint on.
  - **It is the horizon WITHOUT the floor mesh, and that was forced, not chosen.** The sky is
    painted as background layers on `.table-layout` (`apps/client/src/styles.css`) — wash, horizon
    beam, its glow, the bloom — because `.table-layout` has `position: fixed` descendants (the
    enlarged map, the viewer preview, the drawer) and therefore may never take `transform`,
    `filter`, `perspective`, `contain: paint` or `will-change`. The scene tier's receding grid floor
    is the one layer that needs a `perspective`, so the table cannot have it. Losing a perspective
    grid under a battle grid is a gain.
  - **`background-attachment` stays `scroll`, and the name is a lie.** The background is fixed to
    the element's own box and does not travel with its contents — which is what this needs, because
    below the rung where `.table-layout` really does scroll, the horizon has to stay at the bottom
    of the frame rather than sliding out of it.
  - Ruling 21 — chrome metal (`.sign`) on hero surfaces — is the other partial reversal round 2
    settled, and it needs **no** entry here: measured at the end of round 2, `.sign` has exactly one
    call site in the repo (the style guide) and was never applied to a hero surface. There is
    nothing to reverse. Its own wording is permissive ("hero surfaces **may** use it"), so leaving
    it unbuilt is not a violation. The bar barring it from panel headers stands unchanged.
  - Full round-2 ruling set: `docs/product/refresh-round-2-decisions.md`. That document is the
    primary source for round 2 and quotes the client directly; this entry exists so the two
    reversals are discoverable from the log an agent actually reads before changing something
    architectural.

# ADR-0026: Homebrew creation wizards over the editor's own record

## Status

Accepted, 2026-10-17.

## Context and decision drivers

The homebrew editor is a schema-driven form (`schemas.ts`, `FieldRenderer`, `SchemaForm`) with a control for nearly
every key the body schemas accept. That makes it complete and hard to start with: a first-time GM making a monster
meets the whole stat block, the stat-block bag and the action rows at once, and has to know that a CR sets the
Proficiency Bonus, that Hit Points come from dice of the size's die, and how the SRD words an attack.

The owner asked for a step-by-step wizard for every homebrew type. The drivers:

- **One record.** A wizard must make exactly the record the editor edits and save it the same way, so a GM can
  switch to the full editor at any step and back, and a duplicated record opens in the wizard filled.
- **One gate.** Validation as you go must be the editor's: `publishIssues` (the shared body schemas) and the
  server's verdict (`homebrew-validate.ts`). A wizard may not have looser or stricter rules of its own.
- **The engine reads what it reads.** Some answers live where the engine already looks: a spell's healing and area
  in its text (`healingOfText`, `areaOfProse`), its upcasting in `castingOptions`, a monster's saves, skills, senses
  and challenge rating in the `open5e.srd-2024` stat-block bag. A wizard has to write those places, in the shapes
  the SRD bundles use.
- **No invented tables.** Monster suggestions come only from the bundled SRD stat blocks.
- **Phones are first-class.** One step per screen at 390px, the preview one tap away.

## Considered options

- **A wizard model of its own, turned into a record at the end.** Rejected: a second shape drifts from the first,
  the editor could not open a half-made wizard record, and validation would have to be translated both ways.
- **The editor's form, filtered and reordered into steps.** Rejected on its own: it cannot keep derived values in
  step (CR to Proficiency Bonus and XP, Hit Point Dice to Hit Points, a spell's upcast rows and its At Higher
  Levels text), and the editor's labels are written for someone who already knows the record.
- **A wizard as data over the same draft (chosen).** Each question is either the editor's own `FieldDef`, borrowed
  with plainer words (`ask(type, key, words)`), or a small composer for an answer no single field holds.

## Decision

**Wizards are data** (`apps/client/src/homebrew/wizard/`). A `WizardDef` has steps and a preview. A step has a short
label, an optional intro, its questions, the record paths it answers (`owns`) and the editor sections it stands in
for (`sections`), and may hide itself for records it does not fit (an item's weapon step for armor). `WIZARDS` has
one for each of the nine types.

**Questions borrow the editor's fields.** `ask` looks the field up in the editor schema and changes only its words,
so its control, its write and its checks are the editor's. A wizard overrides a field's write only where it keeps
something else in step, and those overrides are pinned in a test: a spell's level and damage carry its upcast rows,
its attack-or-save answer is one control, and a monster's name, size, type and alignment move its generated texts,
token footprint, Hit Points and bestiary line.

**Composers write where the engine reads.** A spell's healing is the SRD's healing sentence in its text, its area is
named the SRD's way so the map can draw the template (the wizard says so when the text does not name it), and one
"dice per slot level" answer writes the `slot_level_N` rows and the At Higher Levels text in SRD 5.2.1 words
("above 3"). A monster's numbers follow the SRD arithmetic, checked against every bundled stat block: Proficiency
Bonus and XP from CR, Hit Points from dice of the size's die and Constitution, saves and skills printed as totals
with proficiency read back from them. Its actions are built by kind (attack, saving throw, Multiattack, reaction,
legendary) and their text is written in the SRD's words, which `areaOfProse` and `multiattackOfProse` read back.
Generated text follows the answers until the GM writes their own.

**One draft, two views.** `RecordDetail` keeps the draft, the autosave and the publish action, and renders either
the full editor or `WizardView`. A record made from the New dialog, blank or duplicated, opens in the wizard; one
picked from the list opens in the editor. "Full editor" and "Step by step" switch between them at any step and land
on the matching section.

**The review is the editor's checklist.** The publish requirements (`publishIssues`, then the server's verdict)
are placed on the step that owns their path, or the step that stands in for their section, and inside it on the
question that answers them. A step the GM has been through lists what it still needs; review lists everything,
with a way to each question, and holds Publish.

**Previews are the app's own.** The spell card (`SpellCardContent`), the equipment picker's line (`metaLine`), the
character builder's feature list and a stat block in SRD order show the record as the table will.

**Benchmarks come from the bundle.** `statblockNumbers` and `challengeBenchmarks` (`packages/rules-5e`) read AC, HP,
attack bonus, save DC and damage per round from each bundled stat block. The server serves the median, lowest and
highest for each CR as the GM-only read `content:monster-benchmarks`, and the monster wizard sets the monster's own
numbers beside them.

## Consequences and tradeoffs

- The wizard cannot write a key the editor cannot write, except through the pinned composers, and those write the
  shapes the bundles already use. Tests replay the wizard's borrowed answers through the editor's controls and
  compare the records.
- Building on the editor exposed two editor shape bugs (a feat's ability-score prerequisite and a class's multiclass
  minimums were written in keys the schema does not have). Both now share one minimums control, and the census
  counts the keys they cover.
- Healing and areas stay in prose because that is where the engine reads them. A GM who rewrites the text can lose
  them; the wizard shows a warning for the area, and the healing answer reads back from the text.
- Damage per round is a reading of the stat block (the best action, or the best Multiattack plan, plus the best
  Bonus Action); legendary actions and reactions are left out. The figure serves only to compare a monster with the
  SRD's own.
- A conflict reload takes the server's copy and keeps each top-level field changed in this editor since its last
  save; a field changed on both sides keeps this editor's value. Reopening a record waits for the save its closing
  editor sent, so the reopened editor starts from the saved copy.

## Mobile, security, and visibility impact

The wizards are GM-only, inside the Homebrew tab. On a phone a step fills the screen under a compact step bar, Back
and Next share the footer, and the preview replaces the step when opened. From 761px the step list stands in a
column beside the step, and from 980px the preview stands beside both. Every control meets the 44px floor.

No projection changes. `content:monster-benchmarks` is GM-only although it is derived from public SRD content, and
it carries numbers only. Published records reach players through the existing homebrew projections, unchanged.

## Migration / reversibility

No data changes: records are the same records, and the editor opens every one of them. Removing the wizards means
deleting `apps/client/src/homebrew/wizard/` and the mode switch in `RecordDetail` and `HomebrewPanel`.

## Validation evidence

- `wizard-records.test.ts`: a wizard per type; every step names its editor's sections; only the pinned questions
  have a write of their own; the borrowed answers land on the record the editor's controls make; one complete
  record per type passes the editor's publish checklist; a blank record's every requirement lands on a step.
- `wizard-records.mirror.test.ts`: the same nine records are POSTed, published through the server's gate and read
  back field for field.
- `wizard-composers.test.ts`: the composers against the engine's own readers (`healingOfText`, `areaOfProse`,
  `multiattackOfProse`) and the SRD arithmetic.
- `wizard-view.test.tsx`: the spell wizard answered through its controls makes the composers' record; review places
  issues and goes to the question; the monster, item, class, subclass and background steps; every wizard walks to
  review.
- `reopen-save.test.tsx`: a record reopened while its closing editor's save is held opens on the saved copy, and a
  conflict reload keeps the answers given in the editor since its last save.
- `monster-stats.test.ts` (rules and content packages): the CR, Hit Point and benchmark arithmetic against every
  bundled stat block.
- In Chromium at 390x844 with touch and at 1280x800, every wizard walked to review with no page scroll and no
  control under 44px. A monster, a spell, an item and a class made in the wizards were published and then found in
  the bestiary and a fight, in the builder's spell choices and on the built character's sheet, in the inventory
  picker and a sheet's inventory, and in the builder's classes.

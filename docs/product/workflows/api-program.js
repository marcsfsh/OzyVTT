/**
 * The API parity program, as a Workflow script.
 *
 * Plan of record: `docs/product/plan-api-program.md`.
 * Governing document: `docs/product/remaining-program-plan.md` — its twenty rulings, batch order,
 * serialization points and verification bar bind every agent below.
 *
 * SHAPE, and why it is this shape:
 *
 *   - Phase 1 is ONE agent and everything waits on it. Ruling 10: the parity guard lands first and
 *     every later unit lands under it.
 *   - Phase 2 is FOUR pipelines running in parallel — the measured ceiling (4 cores). A pipeline,
 *     not a barrier, because within a lane every unit edits the SAME file as its neighbours, so the
 *     ordering is a file lock rather than a logical dependency. `pipeline()` expresses that without
 *     making the other three lanes wait for a batch boundary.
 *   - Phase 3 is the close: reviews, the 375px audits, and the ONE regeneration of the generated
 *     API reference, which is the merge resolution and belongs to the parent alone.
 *
 * NO AGENT RUNS `npm run docs`. Four units change `openApiDocument`; a regenerated 6,000-line
 * Markdown file in four branches is four guaranteed conflicts with no semantic content. Each such
 * unit leaves `docs/api-reference.md` stale, names the one red test it expects
 * (`packages/api-contract/test/reference.test.ts` — "matches the committed docs/api-reference.md
 * exactly"), and the parent regenerates once, after the merge.
 */

export const meta = {
  name: "api-parity-program",
  description:
    "Build the HTTP round-trip parity guard, then close every API capability bucket that real SRD content authors, then fix the three API defects. 18 units over 4 concurrent worktree lanes.",
  phases: [
    "guard",
    "units",
    "close"
  ]
};

/* ------------------------------------------------------------------ shared preamble ---- */

/**
 * Prepended to every implementing agent. Everything here was measured rather than remembered, and
 * an agent that skips one of these lines will produce work the review layer sends back.
 */
const RULES = `
You are implementing ONE unit of the API parity program.

READ FIRST, in this order:
  1. CLAUDE.md and .claude/rules/api-contract.md
  2. docs/product/remaining-program-plan.md  (the governing document)
  3. docs/product/plan-api-program.md        (your plan; find YOUR unit and read only its section)
  4. docs/ai-ledger/known-bugs.md            (before you call any red test a regression)

THE FOUR-PART CONTRACT. Your unit is not done until all four exist and one test drives both paths:
an engine reader, SRD content that authors it, a homebrew editor control, and a both-paths test.
Your unit's section names all four with file:line. If a citation is stale, MEASURE and report the
correction — do not implement against a stale citation.

THE DONE BAR, non-negotiable:
  - A far-end proof: a rolled number, a spent counter, a refusal, or a rendered string.
    "The value survived derivation" is not a test.
  - TWO non-vacuity probes, restored after each, with EXACT counts and messages reported:
      (control) disable the control -> a named failure;
      (value)   keep the control, change the VALUE -> the far-end assertion fails.
  - A 375px touch pass for anything with UI: node scripts/tap-audit.mjs 375
    Chromium is pre-installed at /opt/pw-browsers. NEVER run \`playwright install\`.

VERIFICATION:
  - npm run check   (exit 0, from the repo root)
  - npm run test    (from the repo root; report file and test counts)
  - Build ONLY the client workspace. A root \`npm run build\` emits compiled output under the server
    workspace and \`npm run test\` then collects those compiled tests too (185 -> 204 files, ~11
    spurious failures).
  - At most TWO full suites on this box at once. That now includes the CLIENT suite: the parity
    guard makes it bind an ephemeral port and open a SQLite file.

FILE DISCIPLINE:
  - Your lane owns specific files. Do not edit a file another lane owns.
  - Do NOT touch apps/client/src/homebrew/vocabulary-parity.mirror.test.ts. Its census array is a
    serialization point for ten units in OTHER programs.
  - Do NOT edit docs/ai-ledger/current-state.md. It is parent-only and sits at its enforced
    150-line ceiling with zero headroom.
  - Do NOT run \`npm run docs\`. If your unit changes packages/api-contract/src/index.ts, leave
    docs/api-reference.md stale and say so in your commit message, naming the ONE red test.
  - Your both-paths test goes in its OWN new *.mirror.test.ts file, named for your unit.

SCOPE: implement the unit, verify it, stop. Do not expand into refactors your unit did not name.
`;

const unit = (id, title, body) => `${RULES}\nUNIT ${id} — ${title}\n\n${body}`;

/* --------------------------------------------------------------- phase 1: the guard ---- */

const GUARD = agent({
  id: "A1",
  title: "The HTTP round-trip parity guard",
  size: "XL",
  prompt: unit("A1", "The HTTP round-trip parity guard", `
Build the guard that fails the build when a schema field an API caller can author has no editor
control. Read §2 of docs/product/plan-api-program.md in full — it is the design, measured.

WHERE: a NEW file apps/client/src/homebrew/api-parity.mirror.test.ts, plus a sibling helper
apps/client/src/homebrew/api-parity-harness.ts (the authoring-harness.ts precedent: helpers live in
src/, free of vitest). The client's "node" vitest project already runs *.mirror.test.ts in a Node
environment and already imports server modules by relative path.

THE THREE TESTS:
  T1 the census — walk the nine HOMEBREW_BODY_SCHEMAS, canonicalise each address into an editor
     address, ask hasControl(), assert the uncovered set equals the exemption table EXACTLY in both
     directions. Every exemption row carries a reason and an owner.
  T2 the round trip — boot the REAL router (express + createHomebrewRouter + a real HomebrewStore on
     a temp dir, listen(0,"127.0.0.1"); lift apps/server/test/homebrew-http.test.ts:35-68 into the
     harness, ONE fixture per file in beforeAll). POST the record -> 201. POST publish -> 200 (this
     runs the real four-tier gate, which is what makes the round trip stronger than a Zod parse).
     GET it back. Rebuild the same record through authored()/authoredRow() and storedBody(). Assert
     the two bodies are DEEP-EQUAL after stripping the row-forced keys the server stamps (type, id,
     and a monster's source.externalId — see normalizeBody, apps/server/src/homebrew-store.ts:791).
  T3 the guard's own non-vacuity — two constructed failures proving T1 and T2 can fail.

THE HARD PART is address canonicalisation. Two numbers are schema-intrinsic and re-measured at HEAD:
a naive walk yields 162 distinct object schemas carrying 709 declared keys. The expansion into
addresses runs to thousands and almost all of it is noise, from three causes with three rules — see
§2.3. DO NOT chase the 3,806 / 3,341 / 1,108 / 223 figures an earlier draft pinned: they are
properties of the expansion and probe rules the guard itself defines, they were not reproducible on
re-measurement, and §2.3 now says so. Pin whatever YOUR canonicaliser produces, in the file, the day
you write it. Canonicalise by PROBING an ordered candidate list, not by a hardcoded table, and make
every rewrite VALIDATE: if a rewrite produces a container fieldsWithin cannot resolve, THROW. A stale
rule must be a red build, never a quiet pass.

KNOWN BLIND SPOT, state it in the file rather than leaving it to be found:
ActorDefinitionSchema.extensions is z.record(z.string(), z.unknown()), so the walker finds NO
addresses inside it — and that is exactly where the sharpest gap lives (all 330 SRD monsters carry
extensions["open5e.srd-2024"].savingThrows, read at apps/server/src/saving-throws.ts:127). Unit B0
supplies the hand-declared vocabulary; leave the seam for it and name B0 as its owner.

ONE EXEMPTION ROW HAS A DATED OWNER, and it must not be written as permanent. \`grants\` is the single
surviving entry on RIDER_EXEMPT (apps/client/src/homebrew/authoring-harness.ts:69), waved through
because GrantsEditor is bespoke JSX with no FieldDef — honest today, because nothing authors it.
The content program's C7 generates a 258-item magic-item bundle carrying the FIRST rider blocks
equipment.v1.json has ever held, and after it lands grants.saves / grants.damageResistances /
grants.armor / casts and item-level uses.scaling all have real SRD authors. Write that row as
  owner: "content-program C7, then a follow-on GrantsEditor conversion"
not as permanent, and say in the file that the measurement must be re-run the day C7 merges. Do NOT
open that follow-on now — its second part does not exist yet. See plan §4.1.

ALSO: declare express and @types/express in apps/client's devDependencies. Both are hoisted at the
root today so runtime already resolves, but tsc -b on apps/client needs @types/express visible.

FOLD IN ONE known bug and only one: docs/ai-ledger/known-bugs.md:167-171 records that
apps/server/test/homebrew-http.test.ts's per-path mount probe is vacuous — it asserts headers that
come back for ANY path. You are the unit about tests that prove nothing and you mount the real
router. Fix that probe, cite the ledger line in the commit, and touch nothing else in that file.

FAR END: a red \`npm run test\` when an authorable field has no control and no exemption, with the
exact message. Report both non-vacuity probes with their counts.
`)
});

/* -------------------------------------------------------------- phase 2: the four lanes ---- */

/* Lane α — apps/client/src/homebrew/schemas.ts, MONSTER_SCHEMA region (lines 813-884). */

const LANE_MONSTER = pipeline(
  agent({
    id: "B0",
    title: "Declare the statblock extension contract",
    size: "S",
    prompt: unit("B0", "Declare the statblock extension contract", `
statblockFacts (apps/server/src/content-library.ts:314-324) declares exactly two extension-bag keys,
challengeRating and type. Seventeen ship. Declare the full vocabulary once, beside
STATBLOCK_EXTENSION (content-library.ts:305), and hold it to the bundle with a test that RE-DERIVES
it from packages/content-srd-5.2.1/bundles/monsters.v1.json — the discipline
packages/content-srd-5.2.1/test/enums.test.ts already uses for the six enumerated lists.

Measured over all 330 rows (see §3 B0 for the full table): savingThrows 330, speeds 330,
alignment 330, passivePerception 330, senses 252, traits 204, languages 200, armorDetail 329.
DO NOT declare nonmagicalAttackImmunity, nonmagicalAttackResistance or experiencePoints: zero
authors and no reader anywhere.

This declaration is what closes the parity guard's structural blind spot at \`extensions\`. Wire it
into the guard's second, hand-declared input.

FAR END: the derivation test. Non-vacuity: drop one declared key -> the test fails naming it; change
one key's name by one character -> the same test fails with the near miss.
`)
  }),
  agent({
    id: "B1",
    title: "A monster's saving throws",
    size: "M",
    prompt: unit("B1", "A monster's saving throws — the sharpest single case in the program", `
330 of 330 SRD monsters author extensions["open5e.srd-2024"].savingThrows with at least one numeric
entry. The reader is saveModifierFor, apps/server/src/saving-throws.ts:115-131, RUNG 3. There is no
control. A homebrew boss saves like a commoner.

THE TRAP, and it is why this is M and not S. saveModifierFor reads the extension bag ONLY when
definition.proficiencies is absent (saving-throws.ts:117-124, in as many words). Writing the obvious
typed field proficiencies.saves would make a homebrew monster's saves resolve by a DIFFERENT RUNG
from every SRD monster — proficiency-bonus arithmetic instead of the printed total. The control MUST
write the bag. proficiencies on a monster has ZERO SRD authors and is out of scope.

CONTROL: six number inputs in the Defences section, through the extension-bag write at
apps/client/src/homebrew/schemas.ts:801-811 — which today writes ONE key and must learn to write a
nested object.

FAR END: a GM-forced save on a homebrew boss. Seed the die to 7. With savingThrows.int = 8 the total
is 15 and SUCCEEDS against DC 15; with the field stripped, INT 18 gives +4, the total is 11 and it
FAILS. Assert both outcomes, and run the identical assertion body over the SRD Aboleth (int 8).

Non-vacuity: (control) remove the field -> applyField throws 'No field "savingThrows" in the monster
form'; (value) 8 -> 0 and the far-end total moves 15 -> 7.

375px: yes, six new number inputs. Run node scripts/tap-audit.mjs 375 and name the record it opened.
`)
  }),
  agent({
    id: "B2",
    title: "A monster's printed header",
    size: "M",
    prompt: unit("B2", "A monster's printed header: senses, passive Perception, languages, alignment", `
Readers: apps/client/src/encounter/CharacterSheet.tsx:661-663 (senses + passive Perception,
languages) and :846 (alignment, in the identity line). Authors: senses 252/330, passivePerception
330/330, languages 200/330, alignment 330/330. No controls.

RULING ON THE FAR END. The bar allows a rendered string. To reach it from the node mirror project,
extract the sheet's two derivations — the senses line and the identity line — into ONE pure module
apps/client/src/encounter/statblock-header.ts that CharacterSheet.tsx then calls, and make the far
end that module's output driven from both paths. Add a single assertion to the existing
CharacterSheet DOM test proving the component still calls it. This is the same "one shared
computation, never two descriptions" discipline that moved HOMEBREW_BODY_SCHEMAS into the content
package — not an abstraction invented for a test.

FAR END, character for character: "Large aberration, lawful evil · CR 10" and
"darkvision 120 ft.; passive Perception 20", from both paths.

Non-vacuity: (control) remove alignment -> applyField throws; (value) author "chaotic good" -> the
pinned identity line fails.

375px: yes.
`)
  }),
  agent({
    id: "B3",
    title: "A monster's movement modes",
    size: "M",
    prompt: unit("B3", "A monster's movement modes", `
330 rows carry extensions["open5e.srd-2024"].speeds; 197 carry a non-walk mode (fly 107, swim 63,
climb 51, burrow 21, hover 16). The reader is CharacterSheet.tsx:443-445 feeding the Speed vital at
:630. No control.

THE TRAP: the reader is \`extension.speeds ? <derive from the bag> : <definition.speedFeet>\`. A
monster that authors speeds.fly and leaves speeds.walk empty renders ONLY the fly line — the walking
speed the GM typed into the existing speedFeet control silently disappears from the sheet. The
control must SEED THE WHOLE CONTAINER the first time any member is touched, the pattern
apps/client/src/homebrew/defaults.ts already uses for the weapon and armor blocks.

FAR END: "10 ft., swim 40 ft." (the Aboleth) and, for the hover case, "fly 60 ft. (hover)" — through
B2's shared formatter, from both paths.

Non-vacuity: (control) remove speeds.swim -> throws; (value) set speeds.walk to 0 -> the line loses
its first clause.

375px: yes — a five-number-plus-checkbox group.
`)
  }),
  agent({
    id: "B4",
    title: "A monster's traits",
    size: "M",
    prompt: unit("B4", "A monster's traits", `
204 of 330 SRD monsters carry a non-empty traits array in the extension bag. The reader is
CharacterSheet.tsx:756-757 — a Traits section rendered through RichText. No control.

CONTROL: a rows field (name + description) in a new Traits section on MONSTER_SCHEMA.

FAR END: the Aboleth's five traits and a homebrew monster's authored trait both render as
"<name>. <description>" through B2's shared formatter.

Non-vacuity: (control) remove the rows field -> authoredRow throws 'Field "traits" in the monster
form mints no rows.'; (value) blank the description -> the rendered entry loses its body.

VIEWER-SAFETY READ (one citation, not a full audit): traits are free prose on a stat block. A stat
block reaches a client only through content:monster-sheet, GM-gated at CharacterSheet.tsx:433
(\`if (role !== "gm" ...) return\`). Confirm that line still holds and say so. No projection changes.

375px: yes — a repeatable rows editor with a textarea, the densest new control in this lane. Run the
tap audit for this unit specifically; a rows editor at 375px is where the 44px floor actually breaks.
`)
  })
);

/* Lane β — apps/client/src/homebrew/RiderEditor.tsx, actionsField at :723. */

const LANE_ACTIONS = pipeline(
  agent({
    id: "C1",
    title: "A hit that lands a condition (onHit)",
    size: "M",
    prompt: unit("C1", "A hit that lands a condition (onHit)", `
47 SRD monster actions author onHit. The reader is apps/server/src/action-resolution.ts:1010-1013.
actionsField (RiderEditor.tsx:725) offers exactly name / activation / description / damage / attack /
save / uses — verified by probe — so there is no control.

CONTROL: a rows field on the action row: conditions (a pick-list over the 15 SRD condition ids),
escapeDc, maxTargetSize.

FAR END: the Aboleth's Tentacle hits and the target really carries \`grappled\` with escape DC 14;
the homebrew twin reaches the same condition on the same target through the same assertion body.

Non-vacuity: (control) remove the field -> authoredRow throws for ["actions","onHit"]; (value)
escapeDc 14 -> 20 and the far-end assertion on the applied condition fails.

375px: yes.
`)
  }),
  agent({
    id: "C2",
    title: "A legendary action's cost",
    size: "S",
    prompt: unit("C2", "A legendary action's cost", `
82 SRD monster actions across 30 rows author legendary.cost. Readers: action-resolution.ts:311-313
(spends from the per-round pool), tap-routing.ts:51 (exempt from the turn gate), and the client's
encounter/ActionRunner.tsx:41 and :52-55. The record already has a legendary.actionsPerRound control
(schemas.ts:879); the ACTION has none.

CONTROL: one number on the action row, at statblock scope, paired with the existing record control.

FAR END: with actionsPerRound 3, three cost-1 legendary actions resolve on other creatures' turns and
the FOURTH is refused, naming the empty pool.

Non-vacuity: (control) remove the field -> throws; (value) cost 1 -> 3 and the SECOND use is refused
instead of the fourth.

375px: yes (one number).
`)
  }),
  agent({
    id: "C3",
    title: "Damage that grows with level (damageByLevel)",
    size: "S",
    prompt: unit("C3", "Damage that grows with level (damageByLevel)", `
15 SRD actions author damageByLevel: cleric divine-spark and divine-strike, druid primal-strike,
rogue sneak-attack, the circle-of-the-land subclass's lands-aid, and the dragonborn breath weapon on
all ten lineages. The reader is apps/server/src/character-build.ts:339 and :362-365. No control.

CONTROL: a rows field (level, formula, type) on a FEATURE-CARRIER action row only — the same
\`scope !== "statblock"\` split toHitFields already makes at RiderEditor.tsx:624-627, because
ActionSchema on a stat block has no damageByLevel and Zod would strip one silently.

FAR END: the same authored line builds a rogue whose Sneak Attack rolls 1d6 at level 1 and 3d6 at
level 5, with NO content record changing between the two builds.

Non-vacuity: (control) remove the field -> throws; (value) delete the level-5 row -> the level-5
build falls back to 1d6.

375px: yes — a rows editor; run the tap audit for this unit.
`)
  }),
  agent({
    id: "C4",
    title: "An action that grants itself an effect",
    size: "M",
    prompt: unit("C4", "An action that grants itself an effect (action.grants)", `
Three SRD class actions on three different classes author action.grants: barbarian rage -> "Raging",
rogue steady-aim -> "Steady Aim", sorcerer innate-sorcery -> "Innate Sorcery". Not a lone record.
The reader grants the effect to the actor, and requiresEffectTag consumes it at
action-resolution.ts:230-231.

CONTROL: reuse effectsField's row schema at cardinality 1, mounted as a group on the action row.
An action's \`grants\` is a SINGLE EffectGrant, not a list — do not mount the list form.

FAR END: resolving Rage puts the "Raging" effect on the actor with its tag, and a
requiresEffectTag: "raging" action stops refusing. The refusal message at :231 is the before-state
and must be asserted as such.

Non-vacuity: (control) remove the group -> throws; (value) change the granted effect's tag -> the
gated action refuses again.

375px: yes.
`)
  })
);

/* Lane γ — schemas.ts SPECIES_SCHEMA (:302-370) and BACKGROUND_SCHEMA (:374-415), plus
   LevelTableEditor.tsx. Shares schemas.ts with lane α by design: the edit regions are 398 lines
   apart and share no symbol. Whichever lane merges SECOND rebases and re-runs its own verification
   in its own worktree first. Never a blind merge. */

const LANE_CHOICES = pipeline(
  agent({
    id: "D1",
    title: "A species' language choices",
    size: "M",
    prompt: unit("D1", "A species' language choices", `
All 9 SRD species author languageChoices: { choose: 2, fromCatalog: "standard-languages" }. The
reader is apps/server/src/character-build.ts:874 and :895 — the species-languages offer, the
"Common plus two languages" budget Character Creation owes every character. SPECIES_SCHEMA has a
languages tags field and NO languageChoices control.

CONTROL: a choice-list group beside the existing languages field.

FAR END: the builder OFFERS a two-pick language choice whose option list resolves to the
standard-languages catalog; a species with the field stripped offers NOTHING. Compare the two OPTION
LISTS, never a surviving field.

Non-vacuity: (control) remove languageChoices.choose -> throws; (value) choose 2 -> 1 and the offer's
capacity moves.

375px: yes.
`)
  }),
  agent({
    id: "D2",
    title: "A lineage's own traits",
    size: "L",
    prompt: unit("D2", "A lineage's own traits", `
18 lineage rows over 4 species (dragonborn 10, elf 3, gnome 2, tiefling 3) carry 36 trait objects.
content-library.ts flattens them into the species feature list and the riders then run: Wood Elf's
"Fleet of Foot" carries modifiers: [{ type: "speed", amount: 5 }]. The lineage row's editor fields
today are exactly name and description.

CONTROL: mount FeatureEditor inside the lineage row.

THE CONSTRAINT THAT MAKES THIS L. The publish gate REFUSES a choice on a lineage trait
(apps/server/src/homebrew-validate.ts:266-268: "Lineage traits cannot carry choices yet — move the
choice up to a species trait", because the flatten drops the lineage tag). The mounted editor must
NOT offer the choice panel at this depth, or the form authors a body its own gate refuses. Scoping
FeatureEditor is the work; mounting it is the small half.

FAR END: a Wood Elf character's speed is 35 and a High Elf's is 30, and the five feet come from a
lineage trait's rider. The homebrew twin reaches the same number by the same road.

Non-vacuity: (control) remove the traits field -> authoredRow throws for ["lineages","traits"];
(value) amount 5 -> 0 and the far-end speed drops back to 30.

GUARD INTERACTION: the choice panel must be UNAUTHORABLE at this depth, not merely refused. Assert
hasControl("species","choice",["lineages","traits"]) is false and record it in the parity guard's
exemption table as \`permanent:\` with the gate's own citation.

375px: yes — the densest new surface in the program. Run the tap audit for this unit.
`)
  }),
  agent({
    id: "D3",
    title: "A background's ability spreads (a repair)",
    size: "S",
    prompt: unit("D3", "A background's ability spreads — a live defect found by measurement", `
BACKGROUND_SCHEMA's abilityOptions.spreads is a rows field whose newRow mints { amounts: [2, 1] } and
whose ONLY row field is { key: "label" } (apps/client/src/homebrew/schemas.ts:389-399). The schema is
spreads: z.array(z.array(z.number().int().min(1).max(3)).min(1).max(3))
(packages/content-srd-5.2.1/src/character-content.ts:885) — an array of arrays of NUMBERS. The row
shape the form mints is refused by the record's own schema, and \`label\` is a key the schema has
nowhere to put. TAPPING "Add a spread" MAKES A BACKGROUND UNPUBLISHABLE.

All 4 SRD backgrounds author abilityOptions with spreads: [[2,1],[1,1,1]].

CONTROL: replace the row with a real amounts control that writes a number array.

FAR END: a character built on an authored background accepts a +2/+1 distribution and refuses +3/+0,
naming the bound.

Non-vacuity: (control) the pre-fix repro — mint a row through the CURRENT newRow and assert
publishVerdict(...).publishable is false; after the fix it is true. (value) author spreads: [[3]] and
the +2/+1 build is refused.

375px: yes.
`)
  }),
  agent({
    id: "E1",
    title: "A class resource's id and its display flag",
    size: "L",
    prompt: unit("E1", "A class resource's id and its display flag", `
375 class-resource entries over 235 level rows in all 12 classes, spanning 18 distinct ids
(action-surge, arcane-recovery, bardic-inspiration, channel-divinity, divine-intervention,
eldritch-invocations, favored-enemy, focus-points, indomitable, martial-arts, rage, rage-damage,
second-wind, sneak-attack, sorcery-points, unarmored-movement, weapon-mastery, wild-shape); 159 carry
display: true. Readers: character-build.ts:326-331 (scaling { type: "class-resource", id } reads
classResources.find(r => r.id === scaling.id).amount) and :503 (the literal id "martial-arts" for the
Monk's die).

WHY THIS IS L. The editor mints the id with newId() — a v4 UUID (apps/client/src/lib/ids.ts:13). A
UUID matches ContentIdSchema's /^[a-z0-9-]+$/, so it publishes clean and is then unreachable by any
class-resource scaling rule: a GM cannot make a homebrew Rage pool a feature's uses can read. Worse
for the guard: LevelTableEditor is a \`custom\` field, so its internals are INVISIBLE to fieldsOf —
the same hole as GrantsEditor (authoring-harness.ts:48-68). Closing this properly means giving the
resource rows real FieldDefs so the guard can see them, the same shape of refactor R1 performed for
FeatureEditor. That refactor is the unit's weight; the two new controls are the small half.

CONTROL: an id field and a display toggle beside the existing name/amount pair
(LevelTableEditor.tsx:428-464).

FAR END: a feature whose uses.scaling is { type: "class-resource", id: "rage" } on an
EDITOR-AUTHORED class table yields 2 uses at level 1 and 3 at level 3, with the authored line
unchanged — U7's proof shape, now reachable from the editor end.

Non-vacuity: (control) remove the id field -> throws; (value) rename the id to "rages" and the
scaling resolves to nothing, so the count drops to the fallback.

375px: yes — the level table is already the densest surface in /homebrew. Run the tap audit.
`)
  })
);

/* Lane δ — packages/api-contract/src/index.ts, homebrew-store.ts, homebrew-validate.ts, game-http.ts.
   All four contract-changing units live here, so they never conflict with each other. */

const LANE_DEFECTS = pipeline(
  agent({
    id: "F1",
    title: "API-authored content publishes as source: srd",
    size: "M",
    prompt: unit("F1", "Defect (a): API-authored content publishes as source: \"srd\"", `
ContentSourceSchema is z.enum(["srd","homebrew"]).default("srd")
(packages/content-srd-5.2.1/src/character-content.ts:38). normalizeBody
(apps/server/src/homebrew-store.ts:791-800) forces id and, for a monster, source.externalId — and
NEVER source. Only the client stamps it (apps/client/src/homebrew/defaults.ts:76). So a record
created over HTTP with no source key is badged as OFFICIAL SRD in the character builder.

The documentation makes it worse, countably. homebrewRecordBase.source
(packages/api-contract/src/index.ts:1119) describes the field as 'Always "homebrew" once stored', and
that string renders EIGHT times in docs/api-reference.md — lines 5034, 5093, 5320, 5380, 6072, 6105,
6123, 6245, once per record component that carries homebrewRecordBase.source (class, subclass,
species, background, feat and spell-list spread the whole base; spell and equipment pull the keys one
at a time, :2116 and :2142; a monster's source is the provenance object and is excluded). A NINTH
occurrence at line 5980 reads 'Always "homebrew" on this surface' on
HomebrewRecordSummary — and that one is TRUE, because homebrew-http.ts:220 hardcodes it. THE API
CONTRADICTS ITSELF INSIDE ONE RESPONSE: the summary says homebrew, the record body says srd.

(The governing plan says ten occurrences. Measured: eight false, one true, nine total. Report the
correction; do not silently adopt either number.)

FIX: stamp source: "homebrew" in normalizeBody for the eight non-monster types, and correct the eight
OpenAPI descriptions so a caller who trusts the document is right.

FAR END: POST a class body with NO source key over HTTP, publish it, and assert the character
builder's pick card badges "Homebrew" — the RENDERED BADGE, not the stored field.

Non-vacuity: (control) remove the stamp -> the badge reads SRD; (value) POST source: "srd" explicitly
and assert the server still stores "homebrew" — a caller cannot opt out of provenance.

VIEWER-SAFETY READ: this changes what a PLAYER sees on a builder pick card. One citation confirming
the badge's audience; not a full audit.

CONTRACT: you change openApiDocument. Leave docs/api-reference.md STALE, name the one red test
(packages/api-contract/test/reference.test.ts — "matches the committed docs/api-reference.md
exactly"), and do NOT run npm run docs. Keep openApiDocument byte-identical where unchanged
(.claude/rules/api-contract.md).
`)
  }),
  agent({
    id: "F2",
    title: "The monster publish contract hole",
    size: "M",
    prompt: unit("F2", "Defect (b): a monster cannot be published from the published contract", `
The publish gate HARD-REQUIRES extensions["open5e.srd-2024"].challengeRating and .type
(apps/server/src/homebrew-validate.ts:318-319, via statblockFacts). The contract documents extensions
as a free-form bag. VERIFIED BY COUNT: the string "open5e" appears ZERO times in
packages/api-contract/src/index.ts and ZERO times in docs/api-reference.md. So an API caller can
build a body satisfying every documented requirement and still get a 409 they cannot act on.

All 330 SRD monsters carry both keys. The editor already has both controls
(apps/client/src/homebrew/schemas.ts:823-824).

FIX: declare the two required bag keys in HomebrewMonsterRecord, building on B0's declared
vocabulary, and make the refusal quote the documented path.

FAR END: a monster body assembled from the OpenAPI document ALONE publishes (200), where today the
same body 409s. Assert both states.

Non-vacuity: (control) strip challengeRating from the posted body -> 409 with the documented message;
(value) post challengeRating: "10" (a string) -> refused, because statblockFacts NARROWS rather than
casts (content-library.ts:317-324).

CONTRACT: you change openApiDocument. Same stale-doc rule as F1.
`)
  }),
  agent({
    id: "F3",
    title: "Publish the closed SRD vocabularies",
    size: "M",
    prompt: unit("F3", "Defect (c), first half: publish the closed SRD vocabularies", `
homebrewDamageType is { type: "string", minLength: 1, maxLength: 40 }
(packages/api-contract/src/index.ts:1055) and homebrewConditionId a free slug (:1056). CONTENT_PATHS
(:268-283) serves conditions, skills and languages and has NO entry for damage types, weapon
properties, masteries or rarities. The vocabularies exist and are complete in
packages/content-srd-5.2.1/src/enums.ts: 13 damage types, 15 conditions, 9 BARE weapon properties,
8 masteries, 7 rarities, 8 schools, 14 creature types, 6 gear categories.

CORRECTION TO THE GOVERNING PLAN, verified: "17 weapon properties" is the BUNDLE ROW COUNT
(weapon-properties.v1.json has 17 rows because the two families share one id space — finesse-wp,
cleave-mastery). The vocabularies riders actually match are 9 bare properties and 8 masteries
(enums.ts:67-74). Publish TWO lists, not one of seventeen. Report this.

FIX: new CONTENT_PATHS entries serving the constants, through the SAME command / authorization /
projection path the UI uses (.claude/rules/api-contract.md) — never a parallel fork.

SERVE THE CONSTANTS, NOT THE LOADERS, and this is a deliberate divergence from
CONTENT_PATHS.conditions's loader-backed pattern. loadEquipment() is contended by the content
program's C3 and C6; enums.ts's frozen arrays are browser-safe and are already re-derived from the
bundles by packages/content-srd-5.2.1/test/enums.test.ts. Staying on the constants keeps this unit
off a loader two other lanes are editing. Do not "improve" it into a loader call.

FAR END: GET /api/v1/content/damage-types returns exactly the 13 ids, in bundle order, and the
editor's own suggestion list is the SAME constant — one source, two consumers.

Non-vacuity: (control) remove the route -> the request 404s; (value) add a fourteenth id to the
constant -> both the route's response and packages/content-srd-5.2.1/test/enums.test.ts's bundle
re-derivation fail, in that order.

VIEWER SAFETY — REQUIRED. A new read route is a new projection surface (CLAUDE.md rule 3). These are
printed rules and CONTENT_PATHS.conditions is already gameSecurityWithPlayer("game:read"), so the
audience is settled by precedent — but the viewer-safety-auditor MUST review this unit before merge.
Do not merge without it.

CONTRACT: you change openApiDocument and touch apps/server/src/game-http.ts / game-operations.ts.
Same stale-doc rule as F1.
`)
  }),
  agent({
    id: "F4",
    title: "Validate against the vocabularies (advisory warnings)",
    size: "L",
    prompt: unit("F4", "Defect (c), second half: validate against the vocabularies", `
THE BLOCKER, and it is why this is L. homebrew-validate.ts:44-48 states the position in writing:
advisories are "deliberately not here" because HomebrewValiditySchema is .strict() with exactly
{ valid, issues } (packages/api-contract/src/index.ts:664), so a warning HAS NOWHERE TO TRAVEL and
emitting one as an issue would BLOCK a publish that should succeed. And it must not block:
DamageTypeIdSchema is a max-40 open string on purpose (packages/schemas/src/index.ts:7), and
vocabulary-parity.mirror.test.ts:3396-3399 already pins that a homebrew "void" type reaches the wire
— "closing it would have been the inverse of the bug the client reported."

So this is a CONTRACT CHANGE: add \`warnings\` to HomebrewValiditySchema and its component, carry it
through documentOf (apps/server/src/homebrew-http.ts:213-218) and the client publish checklist, then
emit near-miss advisories for the closed vocabularies F3 published.

FAR END: a record authored with damageType: "flame" PUBLISHES (200) and the response carries a
warning naming "fire" as the near miss; the same record with "fire" publishes with no warning. Assert
both.

Non-vacuity: (control) remove the near-miss check -> the warning array is empty and the test names
the missing advisory; (value) "flame" -> "quux" (no near miss) -> the warning still fires but suggests
nothing, and the SHAPE of the message differs. Assert both branches.

MUST NOT BECOME A BLOCKER: pin a regression test that warnings.length > 0 never sets valid: false.

375px: yes — the publish checklist must render warnings visibly distinct from blockers.

CONTRACT: you change openApiDocument. Same stale-doc rule as F1.
`)
  })
);

/* --------------------------------------------------------------- phase 3: the close ---- */

const REVIEW = agent({
  id: "R1",
  title: "Hostile adversarial review across all four lanes",
  prompt: `
Review every unit of the API parity program (docs/product/plan-api-program.md §9 is the index).

THIS IS NOT GENERAL CODE REVIEW. Governing plan ruling 3: hunt exactly two failure modes.

  1. BUILT-BUT-UNWIRED. A control that writes a key nothing reads; a reader with no author; a value
     that survives derivation and changes no outcome. For each unit, follow the far end yourself and
     confirm it ends at a rolled number, a spent counter, a refusal or a rendered string — never at
     "the field is present in the struct".

  2. VACUOUS TESTS. For each unit, check that BOTH non-vacuity probes were really run and that the
     reported counts and messages are consistent with the code as merged. A probe reported without a
     message, or a "control" probe that only removes an assertion rather than the control, is a fail.

Then two program-specific checks:

  3. THE GUARD'S EXEMPTION TABLE. Every row must carry a reason and an owner. An owner that names a
     unit in ANOTHER program (U17, U21, U38) is legitimate; an owner that names nothing is a gap
     wearing an exemption's clothes. Confirm that multiattack's row points at U21 and that no unit
     in this program silently took it.

  4. THE PHASE'S OWN RULE, APPLIED BACKWARDS. §4 of the plan excludes fourteen fields for having zero
     or one SRD author. Verify no unit shipped a control for any of them — an editor-only row is its
     own defect, and this program's whole argument is that both directions matter.

Use code-reviewer and test-reviewer. Report findings; do not fix them.
`
});

const MOBILE = agent({
  id: "R2",
  title: "The 375px pass over everything this program added",
  prompt: `
Thirteen of the eighteen units add controls to /homebrew — every unit marked with a 375px tick in §9
of the plan. Run the repo's two audits, at 375px, over the surface as merged.

  node scripts/tap-audit.mjs 375        # the 44px floor
  node scripts/no-scroll-audit.mjs      # the page-never-scrolls law, 8 viewports

Neither is wired into npm test; both need a dev server and the pre-installed Chromium at
/opt/pw-browsers. NEVER run \`playwright install\`.

TWO THINGS THAT MAKE THE DIFFERENCE BETWEEN A PASS AND A VACUOUS PASS:

  1. tap-audit's play-homebrew-record entry opens the FIRST record in the rail, so it exercises ONE
     type's form. Its own docblock records that it was once "MEASURED against a database the seed had
     not built". SEED A PUBLISHED RECORD OF EVERY TYPE THIS PROGRAM TOUCHED — monster, species,
     background, class — and report which record each measurement opened. A number without the record
     it opened is not evidence.

  2. The five new REPEATING ROWS EDITORS are where the floor actually breaks: monster traits (B4),
     action onHit (C1), action damageByLevel (C3), lineage traits (D2), class resources (E1).
     Measure each with at least two rows present, expanded.

Report the control count and every control under 44px, with its label and its measured box.
`
});

const CLOSE = agent({
  id: "R3",
  title: "Merge resolution: regenerate the generated docs and verify green",
  prompt: `
PARENT-ONLY. Run this after all four lanes have merged, and not before.

  1. npm run docs        # regenerates docs/app-map.md AND docs/api-reference.md
  2. npm run check       # exit 0
  3. npm run test        # full suite, green, with file and test counts reported

Regeneration IS the merge resolution (governing plan §5). Four units (F1-F4) deliberately left
docs/api-reference.md stale with ONE expected red test —
packages/api-contract/test/reference.test.ts, "matches the committed docs/api-reference.md exactly".
That test must be green after step 1. Any OTHER red test is a regression, not a stale doc: read
docs/ai-ledger/known-bugs.md before calling it either.

Then the ledger, in place, parent-only:
  - docs/ai-ledger/decision-log.md — the schemas.ts shared-file deviation; the ruling that a monster's
    saves are authored in the extension BAG and not in proficiencies; the \`warnings\` contract
    addition.
  - docs/ai-ledger/known-bugs.md — REMOVE the vacuous mount probe entry at :167-171, which A1 fixed.
    The sheet's typed-vs-prose resistance split is ALREADY logged at :43-47 (a homebrew monster's
    typed resistances bite mechanically and render blank, because CharacterSheet.tsx:665-667 reads the
    extension prose) — leave it there and give it an owner only if a unit took it.
  - docs/ai-ledger/current-state.md — ONE edit in place. It sits at its enforced 150-line ceiling with
    zero headroom, so something must come out for anything to go in.
`
});

/* ------------------------------------------------------------------------ the program ---- */

log("API parity program — 18 units, 4 lanes, ceiling 4 concurrent agents.");
log("Plan of record: docs/product/plan-api-program.md. Governing: docs/product/remaining-program-plan.md.");

phase("guard", () => {
  log("Ruling 10: the parity guard lands FIRST and every later unit lands under it.");
  return GUARD;
});

phase("units", () => {
  log("Four worktree lanes, grouped by FILE rather than by theme — the contention this program has is file contention.");
  log("Lanes alpha and gamma share schemas.ts by design: their edit regions are 405 lines apart and share no symbol.");
  log("Whichever of the two merges SECOND rebases and re-runs its own verification in its own worktree first.");
  log("NEVER symlink node_modules into a worktree — hard-link it. POSIX resolves the symlink first and every");
  log("cross-package unit then produces a green run that proves nothing about its own worktree.");
  return parallel(
    LANE_MONSTER,   // alpha  — schemas.ts, MONSTER_SCHEMA region   : B0 B1 B2 B3 B4
    LANE_ACTIONS,   // beta   — RiderEditor.tsx                     : C1 C2 C3 C4
    LANE_CHOICES,   // gamma  — schemas.ts species/background + LevelTableEditor.tsx : D1 D2 D3 E1
    LANE_DEFECTS    // delta  — api-contract + homebrew server side : F1 F2 F3 F4
  );
});

phase("close", () => {
  log("F3 does not merge without viewer-safety-auditor. B4 and F1 need a one-citation viewer-safety read.");
  log("npm run docs is the merge resolution and belongs to the parent alone.");
  return pipeline(
    parallel(REVIEW, MOBILE),
    CLOSE
  );
});

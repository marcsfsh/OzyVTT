export const meta = {
  name: 'content-program',
  description: 'The OzyVTT content program: the weapons ETL home, the overlay ruling, the full SRD magic-item list, Wizard Spell Mastery, and the carriers the zero-author units need.',
  phases: [
    { title: 'Batch 0b', detail: 'two concurrent units — properties reaches the editor, Wizard Spell Mastery' },
    { title: 'ETL', detail: 'generate the 268-row magic-item bundle from the vendored source' },
    { title: 'Item mechanics', detail: 'four concurrent authoring lanes over the generated bundle' },
    { title: 'Close', detail: 'adversarial review, mobile back-fill, ledger' },
  ],
}

/*
 * WHAT CHANGED, 2026-08-11, and why this script is not what the planner wrote.
 *
 * 1. THE SERIAL SPINE NEVER RAN. Both `pipeline()` calls passed thunks as ITEMS with no stage
 *    functions — `pipeline([() => agent(C5), (c5) => agent(C6)])`. The signature is
 *    `pipeline(items, stage1, ...)`, so with zero stages the thunks pass through UNCALLED: C1, C2,
 *    C5 and C6 would never have run, and the four lanes would then have been handed
 *    `JSON.stringify(bundle)` = `[null,null]` and told the bundle had landed. The `parallel()`
 *    calls were always correct; only these two were wrong.
 * 2. BATCH 0 IS SPENT. C1 landed at 36b5a1f and C2 (the ruled `clears` verb) at 14fdb77. The phase
 *    is deleted rather than re-verified — a phase whose only job is to re-read a landed commit
 *    spends an agent to produce a paragraph.
 * 3. C5 LANDED. Vendored at 67d6796, cherry-picked to the program branch at dcd7797, and its owed
 *    source pin added at 19f0d2a (6 tests; both probes run and restored). The ETL phase is C6 alone
 *    and is one agent, so it is a plain `agent()` call and not a pipeline of one.
 */

/* --------------------------------------------------------------- shared ---- */

const REPO = '/home/user/OzyVTT'
const PLAN = 'docs/product/plan-content-program.md'

const CONTEXT = `You are implementing ONE unit of the OzyVTT content program, in ${REPO}.

READ FIRST, in this order:
  1. CLAUDE.md
  2. docs/product/remaining-program-plan.md  — the GOVERNING document. Your work obeys it.
  3. ${PLAN}  — this program's plan. Find YOUR unit's section and follow it exactly.

BRANCH AND BASE, and this is not boilerplate — it is the failure that already happened once here.
C5 was authored in a worktree whose base was 22 commits stale (3ecb4fb, carrying none of batch 0, 1
or 2), so it verified green against a tree that did not have C1's bundle guard, and its commit then
sat on its own branch because nothing owned the merge back. Recovering it cost a cherry-pick and a
full re-verification. Therefore:
  - START FROM THE PROGRAM BRANCH TIP. Confirm with \`git log --oneline -3\` before your first edit,
    and say in your report which SHA you based on.
  - YOUR COMMIT IS NOT THE DELIVERABLE UNTIL IT IS ON THAT BRANCH. If you are in a worktree you are
    on a \`worktree-agent-*\` branch; report your SHA and say plainly that it needs merging back. The
    parent owns that merge — but a SHA you do not report is a SHA nobody merges.

ALREADY LANDED — do not re-plan or re-do any of it:
  - C2, at 14fdb77: the ruled \`clears\` verb on \`FeatureMechanics\`, its handling in
    \`applyMechanics\`, its idempotency case, and the dated ruling in decision-log.md. C4 consumes it.
  - C5, at dcd7797 (cherry-picked) + 19f0d2a (its owed guard): magic-items.md is vendored at the
    pinned commit, PROVENANCE.json's false claim is split, attribution covers magic items, and
    test/magic-item-source.test.ts pins the source — sha256, 5,015 lines, the A–Z run at line 578,
    260 entries of which 258 are items, the nine-category histogram, 140 attuned. C6 reads that file
    and must not re-vendor it; if your parse disagrees with those pinned numbers, the pin is the
    measurement and your parse is the defect.

ALREADY LANDED, in commit 36b5a1f — do not re-plan or re-do any of it:
  - C1 in full. Both weapon columns now have an ETL home: build-bundle.ts joins \`mastery\` AND
    \`properties\` in from sources/dnd-5e-srd-markdown/equipment.md, fails closed in both directions,
    and cross-checks every slug against the 17 WeaponProperty fixtures. The regenerated bundle was
    143 insertions and ZERO deletions. bundle.test.ts:224 pins all 38 masteries and all 70 property
    assignments BY NAME. **NEVER run \`npm run build-bundle\`; never regenerate weapons.v1.json.**
  - C3's plumbing half. \`properties\` reaches WeaponReferenceSchema, the ETL emit,
    EquipmentWeaponStatsSchema + the loadEquipment() fold, and the catalog->inventory copy in
    character-build.ts. A Rapier rolls off Dexterity and a Glaive threatens at 10 feet TODAY.
    C3 retains its EDITOR CONTROL half only.
  - The overlay ruling is TAKEN: Option 2, the \`clears\` verb. C2 implements it; it is not an
    open question.

THE BAR, and it does not move:
  - A FAR-END PROOF. The test ends at a rolled number, a spent counter, a refusal or a rendered
    string. "The value survived derivation" is NOT a test.
  - TWO NON-VACUITY PROBES, each restored afterwards. (a) Disable the CONTROL -> a named failure.
    (b) Keep the control and change the VALUE -> the far-end assertion fails. Report the exact
    counts and the exact messages, not a summary.
  - A 375px TOUCH PASS for anything with UI. Chromium is at /opt/pw-browsers.
    NEVER run \`playwright install\`. Run \`node scripts/tap-audit.mjs 375\` where the plan says to;
    the count must not rise.

OPERATIONAL TRAPS that have each cost an agent real time:
  - \`npm run build\` emits compiled output under the server workspace and \`npm run test\` then
    collects those compiled tests too (185 -> 204 files, ~11 spurious failures). Build only the
    client workspace and it never appears.
  - Never run two full suites concurrently: the server suite binds a live port.
  - Read docs/ai-ledger/known-bugs.md before calling a red test a regression.
  - IF YOU ARE IN A WORKTREE, YOUR FIRST COMMAND IS:
        cp -al /home/user/OzyVTT/node_modules "\$PWD/node_modules"
    A worktree starts with NO node_modules — npm workspaces hoist to the repo root and
    \`git worktree add\` copies none of it. MEASURED: without this, \`npx vitest run <file> --root
    apps/server\` collects 0 test files, prints no failure and EXITS 0 IN 211ms. It looks exactly
    like a pass. With it (0.3s, ~0 real disk) the same command runs the tests for real.
    NEVER symlink instead: POSIX resolves a symlink first, so a symlinked worktree tests the
    ORIGINAL tree and every cross-package unit produces a green run that proves nothing about its
    own. Every unit here is cross-package.
    QUOTE THE TEST-FILE COUNT in your evidence. A run that does not say how many files it
    collected is not evidence that anything ran.

FILES THAT ARE PARENT-ONLY — do not touch them:
  docs/api-reference.md, docs/app-map.md (generated; regeneration IS the merge resolution),
  docs/ai-ledger/current-state.md (exactly at its enforced 150-line ceiling, zero headroom).

COMMIT DISCIPLINE: one unit, one commit, on the current branch. Write the commit message the way
this repo writes them — see \`git show d02e894\` and \`git show 96f2155\`. State what you ran and what
you observed; "should work now" is not verification.`

const UNIT_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['unit', 'landed', 'commit', 'farEnd', 'probes', 'measured', 'blocked'],
  properties: {
    unit: { type: 'string', description: 'The unit id, e.g. C1.' },
    landed: { type: 'boolean', description: 'true only if the unit is committed and the verification below actually ran.' },
    commit: { type: 'string', description: 'The commit SHA, or empty if nothing landed.' },
    farEnd: { type: 'string', description: 'The engine outcome the test ends at, and the observed value.' },
    probes: {
      type: 'array',
      description: 'Exactly two: the control probe and the value probe, each with the exact failure message observed and confirmation it was restored.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'message', 'restored'],
        properties: {
          level: { type: 'string', enum: ['control', 'value'] },
          message: { type: 'string' },
          restored: { type: 'boolean' },
        },
      },
    },
    measured: { type: 'array', items: { type: 'string' }, description: 'Counts and file:line facts you measured yourself, including any that CONTRADICT the plan.' },
    blocked: { type: 'string', description: 'What stopped you, if anything. Empty when the unit landed clean.' },
  },
}

const DECISION = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendation', 'options', 'recorded'],
  properties: {
    recommendation: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'cost', 'why'],
        properties: { name: { type: 'string' }, cost: { type: 'string' }, why: { type: 'string' } },
      },
    },
    recorded: { type: 'string', description: 'Where the ruling was written down, with the SHA.' },
  },
}

/* ------------------------------------------------------ phase: batch 0b ---- */

phase('Batch 0b')

const batch0b = await parallel([
  () => agent(`${CONTEXT}

YOUR UNIT: C3 — \`properties\` reaches the EDITOR. **This is the CONTROL HALF ONLY.** All four data
shapes landed in 36b5a1f; do not touch them.
Work in your own git worktree (isolation is set for you). YOUR FIRST COMMAND IS
\`cp -al /home/user/OzyVTT/node_modules "$PWD/node_modules"\` — see the standing rules above; without
it vitest collects 0 files and exits 0, which looks exactly like a pass.

WHAT IS ALREADY TRUE AT HEAD, so you do not go looking for it:
  1. A Rapier rolls off DEXTERITY. \`weaponAbilityModifier\` (apps/server/src/equipment-derivation.ts:984-991)
     reads \`finesse\` to take the better of Str and Dex, and it fires.
  2. Glaive, Halberd, Lance, Pike and Whip threaten at 10 FEET. \`weaponAction\`
     (equipment-derivation.ts:994-1016) reads \`reach\` at :1011.
  3. \`weapon-property-is\` fires on SRD weapons — \`weaponPropertiesOf\` (:1044) -> riders.ts:194.
  4. The catalog carries the column (EquipmentWeaponStatsSchema at
     packages/content-srd-5.2.1/src/schemas.ts:245-261, the loadEquipment() fold at src/index.ts:113-117)
     and the inventory row carries it (apps/server/src/character-build.ts:1591).

WHAT IS STILL BROKEN, and it is your whole unit: **a GM cannot give a homebrew weapon a property.**
The client's weapon block (apps/client/src/homebrew/schemas.ts:764-770) is still FIVE rows — category,
damage dice, damage type, range, long range. An SRD Rapier is Finesse; a GM's rapier can never be.
docs/ai-ledger/known-bugs.md carries this as a live bug and names you as its owner. Add the SIXTH row:
a tag/multiselect over WEAPON_PROPERTY_IDS. Keep it OPEN — a homebrew property must stay typable, like
every other SRD vocabulary control.

DO NOT reach for \`ctx.weaponProperties\` for the suggestions. Measured:
apps/client/src/homebrew/useSchemaContext.ts:33 builds WEAPON_SLUGS as
[...WEAPON_PROPERTY_IDS, ...WEAPON_MASTERY_IDS] and hands that UNION to the context as
\`weaponProperties\` (:138; same union at schema.ts:136). The union is right for the
\`weapon-property-is\` TRIGGER, which matches either family. It is wrong for the weapon block, where
offering \`topple\` as a property suggests a value the weapon column cannot mean. Suggest
WEAPON_PROPERTY_IDS.

FAR END: a GM-authored weapon carrying \`finesse\`, built through the REAL editor controls, published,
equipped on a DEX 15 / STR 12 character, SWINGS OFF DEXTERITY — a changed attack bonus and a changed
damage string on the sheet. The mirrored SRD assertion (a catalog Rapier) is the control group and is
already green at HEAD; the EDITOR row is the new claim. Not "the array survived the form".

PROBES: (control) delete the weapon.properties row from the weapon block -> the editor path throws
from the authoring harness. The message shape is
  No field "weapon.properties" in the equipment form — the test is addressing a field that does not exist.
(apps/client/src/homebrew/authoring-harness.ts:180-187 — the weapon block flattens to TOP-LEVEL keys,
so this is NOT the container-shaped \`Field "a → b"\` message). Report the exact string you observe.
(value) author \`heavy\` instead of \`finesse\` through the same control -> the bonus falls back to
Strength and the far end fails. Restore both.

WATCH: you add no schema key, so the z.infer expansion-budget hazard is not live for you — it was
spent at 36b5a1f and is now pinned by a COMPILE-TIME guard at
packages/content-srd-5.2.1/test/bundle.test.ts:19-31, which asserts SpellReference.attackRoll and
SpellReference.range (an object — NOT \`rangeFeet\`, which is the domain summary's own flattening).
Run \`npm run check\` at the ROOT all the same.

WATCH, second: a character built before 36b5a1f has no \`properties\` on its stored inventory rows.
That is what the governing plan's ruling 7 (schemaVersion bump + GM-triggered rebuild) is for. Do NOT
invent a second migration. Your tests build a fresh character.

375px: YES. \`node scripts/tap-audit.mjs 375\` on /homebrew — the count must not rise — and check the
new control with touch at a narrow viewport.`,
    { label: 'C3:properties-control', phase: 'Batch 0b', schema: UNIT_RESULT, isolation: 'worktree' }),

  () => agent(`${CONTEXT}

YOUR UNIT: C4 — Wizard's Spell Mastery becomes two picks. C2 has implemented the ruled \`clears\` verb;
read that ruling in docs/ai-ledger/decision-log.md and land through it.
Work in your own git worktree. YOUR FIRST COMMAND IS
\`cp -al /home/user/OzyVTT/node_modules "$PWD/node_modules"\` — see the standing rules above; without
it vitest collects 0 files and exits 0, which looks exactly like a pass.

THE DEFECT, re-measured at HEAD. bundles/classes.v1.json's Wizard record carries, on \`spell-mastery\`
(level 18):
  { "kind": "spell", "choose": 2, "fromCatalog": "wizard-spells", "maxSpellLevel": 2 }
against printed text reading "Choose a level 1 and a level 2 spell in your spellbook that have a
casting time of an action." Two level-1 spells is a legal build today; so is two level-2 spells. The
correct shape is \`choices\` — one block capped at level 1, one floored and capped at level 2.
\`choices\` has been exposed on FeatureMechanics since c63fa75 (class-mechanics/overlay.ts:78) and the
panel has edited a LIST of blocks since d02e894.

WHY IT IS NOT A ONE-LINE OVERLAY EDIT, and this is the whole reason C2 exists: wizard is one of the
three HAND_AUTHORED classes (build-class-bundle.ts:33), the record already carries \`choice\`, the
overlay is additive-only for those three (build-class-bundle.ts:836-838), and \`oneChoiceForm\`
(src/character-content.ts:525-529) refuses a record carrying both spellings — so writing \`choices\`
beside \`choice\` fails the build at ClassReferenceSchema.parse rather than merging.

RIDE-ALONG, SAME COMMIT: class-mechanics/wizard.ts:66-73 reports this as blocked and gives the WRONG
reason — it says overlay.ts's FeatureMechanics "exposes \`choice\` and not \`choices\`" and that
overlay.ts is "frozen for Stage 4". overlay.ts:78 exposes both, and Stage 4 is over. Verified still
present and still wrong at HEAD. The code is truth and the comment is the defect. Fix it in place.

FAR END: a level-18 Wizard's build offers TWO pick rows with DIFFERENT windows, and a build answering
both rows with level-1 spells is REFUSED BY NAME. The refusal is the far end — it is the whole bug.

PROBES: (control) collapse the two blocks back to one -> the "two windows" assertion fails and the
refusal stops happening. (value) set the second block's floor to 1 -> the refusal stops. Restore both.

375px: YES — the builder's pick step now renders two rows where it rendered one, at level 18.`,
    { label: 'C4:spell-mastery', phase: 'Batch 0b', schema: UNIT_RESULT, isolation: 'worktree' }),
])

const prereqBlocked = (batch0b || []).filter((r) => r && !r.landed)
log(`Batch 0b: ${(batch0b || []).filter((r) => r && r.landed).length}/2 landed${prereqBlocked.length ? `; blocked: ${prereqBlocked.map((r) => `${r.unit} ${r.blocked}`).join(' | ')}` : ''}`)

/* --------------------------------------------------------- phase: ETL ---- */

phase('ETL')

const bundle = await agent(`${CONTEXT}

YOUR UNIT: C6 — the magic-item ETL. The longest unit in this program, and it is deliberately ONE
agent because it is ONE parser over ONE file. The parallelism lives one layer up, in the overlay
lanes that come after you.

C5 has landed: the source is vendored and PINNED. Read
packages/content-srd-5.2.1/test/magic-item-source.test.ts before you write a line of parser — it
already measures, and holds, everything your parse must reproduce: the A–Z run opens at line 578,
it holds 260 \`####\` entries, 258 of them open with one of the nine category words, the two that do
not are Giant Fly and Avatar of Death, the histogram is Wondrous Item 127 / Weapon 33 / Potion 24 /
Ring 22 / Armor 19 / Wand 13 / Staff 12 / Rod 7 / Scroll 1, and 140 of 258 require attunement.
Four further \`####\` headings sit ABOVE line 578 and are rules subsections — a parser that scans the
whole file finds 264 and is wrong by exactly those four. If your parse disagrees with any of it, the
pin is the measurement and your parse is the defect.

Read ${PLAN} section 1.5 and the C6 section in full before writing anything. The rulings that matter:

A SEPARATE GENERATED BUNDLE, not 268 rows appended to equipment.v1.json. Appending would make a
hand-authored file both the ETL's input and its output — which is exactly the condition that produced
the overlay collision C2 just implemented \`clears\` for. A generated bundle is an output only. Fold it
into loadEquipment() (packages/content-srd-5.2.1/src/index.ts:98-124 — gear at :101, weapons at :113,
armor at :118) as a FOURTH source; everything downstream, including \`equipmentCatalogOf\`
(apps/server/src/equipment-derivation.ts:286), reads the folded catalog and needs no change.

THE EXPANSION RULE. 258 entries become 268 rows: expand the five "+1, +2, or +3" ladders into one row
per tier (Ammunition, Armor, Shield, Weapon, Wand of the War Mage — 5 entries, 15 rows, net +10,
because each tier has its own rarity and its own bonus amount and "Longsword, +1" is what a GM looks
for); leave the seven "Rarity Varies" entries as ONE row each with their table rendered into the
description (Belt of Giant Strength, Feather Token, Figurine of Wondrous Power, Ioun Stone, Potion of
Giant Strength, Potions of Healing, Spell Scroll) — expanding Armor of Resistance into ten
near-identical rows is a worse browse list than one row and a table.

THE ID GUARD IS NOT OPTIONAL, AND IT IS A PRECAUTION AGAINST THE BRANCH NOT TAKEN. Re-measured:
under the recommended rule the ids are CLEAN — 0 of 258 raw name slugs collide with equipment.v1.json
+ weapons.v1.json + armor.v1.json (183 ids), 0 of 268 after the +1/+2/+3 expansion, and 0 internal
duplicates. The guard earns its place on the alternative: "Potions of Healing" EXPANDED would mint
\`potion-of-healing\`, which equipment.v1.json ships and bundle.test.ts:305 asserts. FAIL CLOSED on any
minted id already present in the other three bundles, naming both homes — the same rule the overlay
applies to riders. Expect it to fire zero times; that is what a guard should do.

ONE RECONCILIATION TO DECIDE AND WRITE DOWN: keep the grouped "Potions of Healing" row and leave the
existing mundane potion-of-healing alone (cost: two similar rows in the browse list), OR expand the
four printed tiers and delete the hand-authored row (cost: one assertion moves at bundle.test.ts:305).
Both are defensible. The failure mode is taking neither.

MEASURED FOR YOU — assert these, do not re-derive them blind, and REPORT ANY THAT DISAGREE:
  categories: Wondrous Item 127, Weapon 33, Potion 24, Ring 22, Armor 19, Wand 13, Staff 12, Rod 7,
    Scroll 1  (= 258)   [re-measured, exact]
  rarity: Rare 82, Uncommon 73, Very Rare 55, Legendary 32, Varies 7, Common 2, Artifact 1  (= 252),
    plus 6 entries whose type line prints a LADDER of rarities: the five "+1, +2, or +3" rows and
    "Horn of Valhalla" ("Rare (Silver or Brass), Very Rare (Bronze), or Legendary (Iron)"), which the
    expansion rule leaves as ONE row and which therefore needs a rarity decision of its own. 252+6=258.
  attunement: 140 of 258   [re-measured, exact]
  the two embedded stat blocks are skipped BY NAME with a count assertion, never by a silent filter
  costGp is null on every row — the SRD prints a value BAND by rarity ("### Magic Item Values by
    Rarity", line 177 of the source, an H3 under "## Magic Item Rarity"), not a per-item price, and
    deriving a number from a band would be inventing content

SLOT is a closed enum the engine switches on (packages/schemas/src/index.ts:29-37). Derive it from the
type line and the item name, and ASSERT it in the bundle guard rather than trusting it. Two edge cases
that a naive category->slot map gets wrong: 2 of the 33 Weapon-category entries say
"Weapon (Any Ammunition)" (Ammunition +1/+2/+3; Ammunition of Slaying) and are \`ammunition\`; 7 of the
19 Armor-category entries say "Armor (Shield)" and are \`shield\`.

*** THE WONDROUS WORN/CARRIED SPLIT IS A READING, NOT A COUNT — DO NOT TAKE A TARGET NUMBER. ***
An earlier draft of this script said "62 worn (neck 19, shoulders 14, head 13, feet 7, hands 6,
belt 2, ioun 1) and 65 carried". That does not reproduce, and \`ioun\` is not even a member of
ItemSlotSchema. Re-measuring by the plan's own "by name" rule gives 57 worn / 70 carried —
neck 15, shoulders 14, head 13 (Ioun Stone included), feet 7, hands 6, belt 2 — and a scan for
worn-location PROSE gives a third answer, 52. THREE METHODS, THREE ANSWERS. Derive the slot by a rule
you write down, ASSERT whatever your parser produces, and REPORT THE NUMBER. C7c and C7d split on your
committed \`slot\` column, so their item counts are an OUTPUT of this unit, not an input to it.

Prose may contain the same HTML tables build-class-bundle.ts already renders with \`tableAsText\`.
Reuse that, do not write a second one.

VIEWER SAFETY — state it and then dismiss it with the reason, do not skip it. A magic item's mechanics
never reach a player through the inventory row: packages/schemas/src/index.ts documents that the
carried-item marker "carries NO riders, NO casts and NO cursed flag" and that mechanics resolve by
item.id against a catalog that never leaves the server. You add catalog rows only and put no new key
on the wire. Confirm that by reading, then say so.

FAR END: a GM browses and adds "Wand of the War Mage, +1" and it renders on a character's sheet with
its rarity and its attunement requirement. A rendered string, not a parsed record.

PROBES: (control) remove the fourth fold from loadEquipment() -> the catalog census fails naming a
count that drops by 268. (value) change one item's parsed slot -> the slot assertion names the item.

375px: YES, and it is a real risk rather than a formality — 268 rows land in the browse-and-add list
and several descriptions carry rendered tables. Check the list and the Armor of Resistance detail at
375px, and run \`node scripts/tap-audit.mjs 375\`.`,
    { label: 'C6:magic-item-etl', phase: 'ETL', schema: UNIT_RESULT })

log(`Bundle: ${bundle && bundle.landed ? `landed at ${bundle.commit}` : `NOT landed — ${bundle ? bundle.blocked : 'no result'}`}`)

/*
 * A BARRIER HERE IS CORRECT, and it is the one place in this script where that is true. The four
 * lanes below split on C6's COMMITTED `slot` column, and the plan is explicit that their item counts
 * are an OUTPUT of C6 rather than an input to it — three reading methods give three different
 * worn/carried answers (57/70, 62/65, 52). So the lanes genuinely cannot start, or even be prompted
 * honestly, until C6 has landed and reported. Everywhere else, prefer no barrier.
 */

/* ------------------------------------------------ phase: item mechanics ---- */

phase('Item mechanics')

const LANE_RULES = `THE LANE CONTRACT, identical for all four lanes.

STRUCTURE, mirroring scripts/class-mechanics/: one module per lane under a new
scripts/item-mechanics/ directory, composed by its own index.ts, keys validated against the generated
bundle, an unmatched key FAILING the build. class-mechanics/overlay.ts's header states the reason in
its own words: "A single object literal holding twelve classes is one file that every content author
has to edit ... The split is the difference between four agents working and four agents merging."

THE ADMISSION RULE, and it is \`masteryReaches\` restated for items: AUTHOR A RIDER ONLY WHEN ITS
READER SHIPS TODAY. A rider whose reader is a later unit's job is NOT authored — it is recorded as a
NAMED ABSENCE in the module: the item, the SRD sentence, the vocabulary it needs, and the unit that
unblocks it, in a comment beside the item's entry. That is exactly the shape
class-mechanics/wizard.ts:48-74 uses for its nine prose-only records, and it turns "we skipped it"
into "we decided it". Authoring an inert rider is the failure mode this whole phase exists to end.

READERS THAT SHIP, so you have real work: armor-class, save-bonus, check-bonus, damage-resistance,
damage-immunity, condition-immunity, proficiency grants, roll-mode on attacks and saves, \`casts\`
blocks and item \`uses\`. apps/server/test/homebrew-inert-fields.test.ts proves those fire, across 383
lines. equipment.v1.json carries ZERO rider blocks of any kind, so yours are the first SRD authors any
of them have ever had.

SEVEN ITEMS WHOSE CENTRAL MECHANIC THE VOCABULARY REFUSES, and it is a schema decision rather than an
oversight: ITEM_REFUSED_MODIFIER_TYPES is ["hit-points-per-level", "ability-score"]
(packages/content-srd-5.2.1/src/character-content.ts:262, message at :263, enforced at
src/schemas.ts:329-333). Re-measured — all seven present in the source, with the lane each falls in:
6 of 258 set an ability score — Amulet of Health (C7c), Belt of Giant Strength (C7c), Gauntlets of
Ogre Power (C7c), Headband of Intellect (C7c), Potion of Giant Strength (C7d), Thunderous Greatclub
(C7a) — and Berserker Axe (C7a) raises a Hit Point maximum. All seven ship as prose with the schema's
own refusal message quoted beside them. DO NOT work around this by inventing a modifier type; that is
a vocabulary decision and it belongs to a unit, not to you.

YOUR ITEM COUNT AND YOUR EXPRESSIBLE-MECHANIC COUNT ARE OUTPUTS, NOT TARGETS. The item and attunement
counts below are re-measured for C7a and C7b (pure category sums, exact) and DERIVED for C7c/C7d from
a worn/carried reading that three methods disagree about. Split on C6's committed \`slot\` column and
report what you actually find. No prior draft's "N with an expressible mechanic" number survives
re-measurement — that is a judgement, so produce yours and write it down beside your named absences.

PROBES for every lane: (control) strip your module from index.ts -> your both-paths test fails naming
its item. (value) change the authored amount -> the far-end number stops moving. Restore both.

VERIFICATION IS THE CONTENDED RESOURCE, NOT THE AUTHORING. All four of you author at once, but every
lane's far end is an ENGINE outcome, so every lane's proof runs server-side — and the plan caps this
box at 2 concurrent full-suite runs, never two server suites at once, because the server suite binds
a live port. So: run the NARROWEST vitest that proves your far end (your own test file, --root
apps/server), not the full suite. If you see a port-bind failure or an inexplicable red, assume
contention before you assume regression, wait, and re-run before reporting it. Report the test-file
count either way. The one full serial suite is C8's job and not yours.

375px for every lane: \`node scripts/tap-audit.mjs 375\` on /homebrew (the count must not rise) and one
item you authored, checked on a character sheet at 375px.

Work in your own git worktree. YOUR FIRST COMMAND IS
\`cp -al /home/user/OzyVTT/node_modules "$PWD/node_modules"\` — with no node_modules vitest collects 0
files and exits 0, and a symlink instead makes your run test
the ORIGINAL tree and prove nothing.`

const LANES = [
  {
    key: 'C7a',
    label: 'weapons and armour',
    detail: `52 items, 35 attuned (both re-measured exactly — this lane is a pure category sum).

FAR END: a +1 weapon's to-hit AND damage both move by one, and an Armor of Resistance halves a typed
damage total on the damage command. Note the SRD text: "You have Resistance to one type of damage
while you wear this armor. The GM chooses the type or determines it randomly" off a d10 table — the
item prints no fixed type, so author one and say which in the module.

RESERVE, do not author — record as named absences with the unit id:
  - U20 (weapon-swing override): Sun Blade ("deals Radiant damage instead of Slashing damage", and
    "functions as a Longsword with the Finesse property") and Energy Bow ("deals Force damage instead
    of Piercing"). Their third carrier is monk.martial-arts and is not yours.
  - U23 (extra-damage, same type as the trigger): Vicious Weapon — "This extra damage is of the same
    type as the weapon's normal damage", which is the exact shape U23 exists for. ExtraDamageVariantSchema
    REQUIRES damageType today, so it cannot be authored before U23 lands.
  - U29 (attack-kind-is: "spell"): Spellguard Shield. It is "Armor (Shield)" and therefore YOURS, not
    C7b's — an earlier draft filed it under the wand lane. Its text is "spell attack rolls have
    Disadvantage against you"; it grants NO spell-attack bonus, so it is U29's carrier and not U26's.

DO NOT REACH FOR THE LIGHT PROPERTY AS A CARRIER. Verified with the mastery program: there is NO
two-weapon / off-hand attack mechanism anywhere in the engine — weaponAction
(apps/server/src/equipment-derivation.ts:994-1016) hard-codes activation: "action" at :1007 — and the
SRD two-weapon-fighting fighting style at bundles/feats.v1.json:302 carries nothing but
tags: ["fighting-style"]. Light is real and C1 authored it on 8 weapons; what it DOES is U21's and
U35's mechanism to build. Any Light-based far end here would be vacuous.`,
  },
  {
    key: 'C7b',
    label: 'wands, staffs, rods, rings and the scroll',
    detail: `55 items, 44 attuned (both re-measured exactly — this lane is a pure category sum). The
charges-and-casts lane.

FAR END: a Wand of Fireballs ("This wand has 7 charges ... expend no more than 3 charges to cast
Fireball (save DC 15)") spends a charge, rolls real damage through the item's \`casts\` block, and
REFUSES when the charges are gone. The refusal is the strongest half — author \`uses\` blocks properly.

RESERVE, do not author — record as named absences with the unit id:
  - U26 (spell-attack-bonus): Wand of the War Mage +1/+2/+3, Staff of the Magi, Staff of the
    Woodlands, and STAFF OF POWER — which an earlier draft filed under U29 only. Its text is "you gain
    a +2 bonus to Armor Class, saving throws, and spell attack rolls", so it is a U26 carrier too.
    (The other two U26 carriers, Talisman of Pure Good and Talisman of Ultimate Evil, are C7c's.)
    The modifier is COLLECTED at equipment-derivation.ts:682 and APPLIED NOWHERE — the code says so
    itself at apps/server/src/character-build.ts:302, "spell-attack-bonus": "unread" — so authoring it
    now ships an item whose printed bonus does nothing.
  - U29 (attack-kind-is: "spell"): the same four, plus Spellguard Shield (C7a's) and the two talismans
    (C7c's) — 7 items in all whose text turns on a spell attack roll. Re-measured: exactly 7 of 258
    mention one, and 6 of the 7 grant a bonus.
  - U31 (on-taking-damage + damage-reduction): RING OF WARMTH — "If you take Cold damage while wearing
    this ring, the ring reduces the damage you take by 2d8." It is a Ring and therefore YOURS, not
    C7c's, which is where an earlier draft filed it.
  Note for whoever writes the test later: Wand of the War Mage expands to THREE rows under C6's ladder
  rule, so a "not a lone record" count should count records, not rows.`,
  },
  {
    key: 'C7c',
    label: 'wondrous items that are worn',
    detail: `~57 items, ~47 attuned by the "by name" reading — but YOUR lane boundary is C6's committed
\`slot\` column and your real counts are whatever it says. An earlier draft claimed 63/51; that does not
reproduce. Report what you find. The body-slot lane, and the heaviest on attunement.

FAR END: a Cloak of Protection ("You gain a +1 bonus to Armor Class and saving throws while you wear
this cloak") moves AC AND a saving throw the server rolls, and both come back off when the cloak does.
The on/off symmetry is the point — a bonus that survives unequipping is the bug.

THIS LANE OWNS \`cursed\`. Re-read the hiding rule at packages/content-srd-5.2.1/src/schemas.ts:296-302
before authoring one: hidden until attunement and NOTHING more, and the schema refuses a cursed item
that does not require attunement (schemas.ts:319-326, "A cursed item must require attunement —
attunement is both what springs the curse and what reveals it"). Do not invent a second hiding rule.

RESERVE, do not author — record as named absences with the unit id:
  - U31 (on-taking-damage + damage-reduction): Gloves of Missile Snaring ("take a Reaction to reduce
    the damage by 1d10 plus your Dexterity modifier"). Ring of Warmth is U31's OTHER carrier and it is
    C7b's, not yours — it is a Ring.
  - U32 (on-death-save + roll-mode: death-save): Periapt of Wound Closure ("Whenever you make a Death
    Saving Throw, you can change a roll of 9 or lower to a 10"). Mysterious Deck is U32's other
    carrier and it is C7d's, not yours — it is carried wondrous.
  - U26/U29 reach two items in your lane: Talisman of Pure Good and Talisman of Ultimate Evil (both
    "You gain a +2 bonus to spell attack rolls while you wear or hold it").
  - Four of the seven refused ability-score items are yours: Amulet of Health, Belt of Giant Strength,
    Gauntlets of Ogre Power, Headband of Intellect. Prose, with the refusal message quoted.`,
  },
  {
    key: 'C7d',
    label: 'potions and carried wondrous items',
    detail: `~94 items, ~14 attuned by the "by name" reading — but YOUR lane boundary is C6's committed
\`slot\` column and your real counts are whatever it says. An earlier draft claimed 88/10; that does not
reproduce. Report what you find. The most items and the least mechanics — that asymmetry is why this
lane is sized smaller, and why it carries the largest number of named absences to write down.

FAR END: a Potion of Resistance ("When you drink this potion, you have Resistance to one type of
damage for 1 hour") applies a typed resistance and expires. The type is rolled off a d10 table rather
than printed, so author one and say which.

MOST OF THE ~70 CARRIED WONDROUS ITEMS ARE GM-FIAT PROSE — Bag of Beans, Deck of Illusions, Portable
Hole, Sphere of Annihilation, Mirror of Life Trapping (all five verified present). Writing each absence
down with its reason IS the deliverable for those; a lane that quietly authors nothing for ~70 items is
indistinguishable from one that forgot.

EXACTLY ONE of the seven refused ability-score items is yours: Potion of Giant Strength. An earlier
draft of this script said "three of the seven"; re-measured, four are C7c's and two are C7a's.

RESERVE, do not author — record as a named absence with the unit id:
  - U32 (on-death-save + roll-mode: death-save): MYSTERIOUS DECK, whose Comet card reads "you have
    Advantage on Death Saving Throws". It is carried wondrous and therefore YOURS, not C7c's, which is
    where an earlier draft filed it. Re-measured: Mysterious Deck and Periapt of Wound Closure are the
    ONLY 2 of 258 items whose text names a Death Saving Throw.`,
  },
]

const mechanics = await parallel(LANES.map((lane) => () =>
  agent(`${CONTEXT}

YOUR UNIT: ${lane.key} — item mechanics, ${lane.label}.
C6 has landed the generated bundle: ${JSON.stringify(bundle)}

Read ${PLAN} sections 3, 5 and the C7 section in full. Section 3 explains why the split is by category
and not by rarity or by unit; section 5 is the carrier index and tells you exactly what to reserve.

${LANE_RULES}

YOUR LANE: ${lane.detail}`,
    { label: `${lane.key}:mechanics`, phase: 'Item mechanics', schema: UNIT_RESULT, isolation: 'worktree' })
))

const lanesLanded = (mechanics || []).filter((r) => r && r.landed)
log(`Item mechanics: ${lanesLanded.length}/4 lanes landed`)

/* -------------------------------------------------------- phase: close ---- */

phase('Close')

const CLOSE_RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'unwired', 'vacuous', 'mobile', 'ledger'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'pass with notes', 'fix required'] },
    unwired: { type: 'array', items: { type: 'string' }, description: 'Riders authored whose reader does not fire. Empty is the target.' },
    vacuous: { type: 'array', items: { type: 'string' }, description: 'Tests whose far end is a surviving field rather than an engine outcome.' },
    mobile: { type: 'string', description: 'The tap-audit count before and after, and what was checked at 375px.' },
    ledger: { type: 'string', description: 'What was written to known-bugs.md and decision-log.md, and the SHA.' },
  },
}

const close = await agent(`${CONTEXT}

YOUR UNIT: C8 — the content program's close. Every lane has merged. The governing plan folds the
quality layer into each program (ruling 3), so this program carries its own.

Results to audit (C1, C2 and C5 landed before this run and are not in these results — audit them
from the git history if you audit them at all: 36b5a1f, 14fdb77, dcd7797 + 19f0d2a):
  batch 0b: ${JSON.stringify(batch0b)}
  bundle:   ${JSON.stringify(bundle)}
  lanes:    ${JSON.stringify(mechanics)}

THREE THINGS, IN ORDER.

1. A HOSTILE ADVERSARIAL REVIEW of this program's own output, hunting the two failure modes the
   governing plan names and NOTHING ELSE. This is not general code review.
   (a) BUILT-BUT-UNWIRED: a rider authored whose reader does not fire. The lane admission rule is what
       you are auditing — walk every rider each lane authored and confirm a live reader consumes it.
       This repo has shipped this failure eight times in one session; assume it happened again.
   (b) VACUOUS TESTS: a both-paths test whose far end is a surviving field rather than a rolled
       number, a spent counter, a refusal or a rendered string. Re-run each unit's value probe
       yourself; a probe that does not fail is a test that does not test.
   Also check every NAMED ABSENCE claimed in ${PLAN} section 5 actually exists in the module it claims
   to live in, with its unit id. An absence that was never written down is a silent skip.

2. THE MOBILE BACK-FILL over everything this program rendered: the browse-and-add list at 268 new
   rows, one table-bearing item detail (Armor of Resistance), the sheet's magic-item row, and the new
   weapon-properties control. Run \`node scripts/tap-audit.mjs 375\` on /homebrew and report the count
   BEFORE and AFTER — it must not rise. Chromium is at /opt/pw-browsers; never run
   \`playwright install\`.

3. THE LEDGER. docs/ai-ledger/current-state.md is EXACTLY at its enforced 150-line ceiling (verified,
   wc -l = 150) and is PARENT-ONLY — do not edit it; report the replacement lines you would make
   instead. docs/ai-ledger/known-bugs.md and docs/ai-ledger/decision-log.md take this program's
   entries. Note what is ALREADY recorded and must not be double-entered: the three defects
   (Finesse rolling off Strength, Reach weapons at 5 feet, weapon-property-is inert) and the silently
   destructive weapons.v1.json rebuild were all fixed and logged at 36b5a1f. What is OPEN in
   known-bugs.md is the CONTROL-half entry — "A homebrew weapon cannot be given properties or a
   mastery" — and C3 NARROWS it rather than deleting it, because U38 still owns the \`mastery\` half.
   Re-run \`npm run docs\` ONLY if something touched state/command/HTTP/OpenAPI — nothing in this
   program should have, and if something did, that is a finding, not a doc chore.

Run the full suite ONCE, serially. Never two suites at the same time — the server suite binds a live
port. Build only the client workspace, or \`npm run test\` collects compiled server tests too
(185 -> 204 files, ~11 spurious failures).

Default to "fix required" if you find real doubt. Do not be agreeable; your job is to find where this
program is wrong.`,
  { label: 'C8:close', phase: 'Close', schema: CLOSE_RESULT })

log(`Close: ${close ? close.verdict : 'no verdict'}${close && close.unwired.length ? ` — ${close.unwired.length} unwired` : ''}${close && close.vacuous.length ? `, ${close.vacuous.length} vacuous` : ''}`)

return {
  prerequisites: batch0b,
  bundle,
  mechanics,
  close,
  landed: [].concat(batch0b || [], mechanics || [], bundle ? [bundle] : []).filter((r) => r && r.landed).length,
}

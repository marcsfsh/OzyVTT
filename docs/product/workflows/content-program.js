export const meta = {
  name: 'content-program',
  description: 'The OzyVTT content program: the weapons ETL home, the overlay ruling, the full SRD magic-item list, Wizard Spell Mastery, and the carriers the zero-author units need.',
  phases: [
    { title: 'Batch 0', detail: 'serial prerequisites — the weapons ETL home, then the hand-authored overlay ruling' },
    { title: 'Batch 0b', detail: 'two concurrent units — properties reaches the fight, Wizard Spell Mastery' },
    { title: 'Source and ETL', detail: 'vendor the magic-item source, then generate the 268-row bundle' },
    { title: 'Item mechanics', detail: 'four concurrent authoring lanes over the generated bundle' },
    { title: 'Close', detail: 'adversarial review, mobile back-fill, ledger' },
  ],
}

/* --------------------------------------------------------------- shared ---- */

const REPO = '/home/user/OzyVTT'
const PLAN = 'docs/product/plan-content-program.md'

const CONTEXT = `You are implementing ONE unit of the OzyVTT content program, in ${REPO}.

READ FIRST, in this order:
  1. CLAUDE.md
  2. docs/product/remaining-program-plan.md  — the GOVERNING document. Your work obeys it.
  3. ${PLAN}  — this program's plan. Find YOUR unit's section and follow it exactly.

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
  - If you are in a worktree, node_modules must be HARD-LINKED (\`cp -al\`), never symlinked.
    POSIX resolves a symlink first, so a symlinked worktree tests the ORIGINAL tree and every
    cross-package unit produces a green run that proves nothing. Every unit here is cross-package.

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

/* ------------------------------------------------------- phase: batch 0 ---- */

phase('Batch 0')

const batch0 = await pipeline([
  () => agent(`${CONTEXT}

YOUR UNIT: C1 — the weapons ETL home. It is SERIAL and it blocks the entire remaining program.
Nothing else runs while you hold it, because regenerating bundles is what destroys the mastery column.

THE DEFECT, measured: packages/content-srd-5.2.1/bundles/weapons.v1.json carries a \`mastery\` column
on all 38 rows, and \`weaponRecords\` at packages/content-srd-5.2.1/scripts/build-bundle.ts:549-559
never emits it. \`WeaponReferenceSchema.mastery\` is \`.optional()\`, so \`validateBundle\` passes and the
write drops all 38 values in silence. Nothing catches it: bundle.test.ts:174 spot-checks Battleaxe's
category and damage and never its mastery.

THE SOURCE, and it is already vendored: sources/dnd-5e-srd-markdown/equipment.md carries the SRD
Weapons table with the columns Name / Damage / Properties / Mastery / Weight / Cost — 38 data rows,
in the same HTML-table shape build-class-bundle.ts already parses. Joining it to the bundle on the
name slug was MEASURED: 38 of 38 matched, 0 unmatched either way, 0 mastery mismatches, and the
Properties column yields 70 assignments over the 9 slugs in WEAPON_PROPERTY_IDS.

WHAT TO BUILD: parse that table once into a map, look each weapon up in \`weaponRecords\`, and THROW
naming the weapon when a row is missing — the SKILL_ABILITY precedent at build-bundle.ts:582-601.
Emit BOTH columns; they are one parse, one join and one guard, and writing the join twice is how the
two halves drift. Add \`properties\` to WeaponReferenceSchema. Strip the parenthetical from a property
cell — the table prints "Thrown (Range 20/60)" and "Versatile (1d10)" and riders match the bare slug.
Record Versatile's two-handed die as a NAMED ABSENCE in the parser's comment: EquipmentWeaponStatsSchema
has nowhere to put a second die and inventing one here would be a vocabulary addition with no reader.

FAR END: regenerate and show the diff. The mastery column must be BYTE-IDENTICAL on all 38 rows —
vex 8, slow 7, sap 6, topple 5, nick 4, push 4, graze 2, cleave 2 — and the only additions are the
\`properties\` arrays. Pin both in bundle.test.ts so a future rebuild fails instead of shipping.

PROBES: (control) delete the join -> the guard fails naming both columns and a count.
(value) flip Battleaxe's table cell from Topple to Vex -> the mastery guard fails naming \`battleaxe\`.
Restore after each and report the exact messages.

NO 375px pass: this unit has no UI.`,
    { label: 'C1:weapons-etl', phase: 'Batch 0', schema: UNIT_RESULT }),

  (c1) => agent(`${CONTEXT}

YOUR UNIT: C2 — rule ONCE on the hand-authored overlay collision, and record it.
C1 reported: ${JSON.stringify(c1)}

THE PROBLEM, measured. For cleric, fighter and wizard (build-class-bundle.ts:33) the class record in
classes.v1.json is both the ETL's input AND its output, so the overlay may only ADD: \`applyMechanics\`
refuses to overwrite a key the record already carries and fails the build naming both homes
(class-mechanics/overlay.ts:139-141, pinned by test/mechanics-overlay.test.ts:76). Writing a
DIFFERENT key beside it does not dodge the problem either: \`oneChoiceForm\`
(src/character-content.ts:525-527) refuses a record carrying both \`choice\` and \`choices\`, so the
build fails at ClassReferenceSchema.parse instead. classes.v1.json is 10,418 lines.

Read ${PLAN} section 4 in full. It costs four options and recommends Option 2 — a \`clears\` verb on
FeatureMechanics naming keys to delete before the merge, with three mitigations: clearing an absent
key is a no-op (idempotent across rebuilds), a \`clears\` entry is a build error unless the same
feature also authors a rider, and the review bar is the git diff of classes.v1.json in the same
commit. Option 1 (hand-edit the JSON) is cheaper at N=1 and reintroduces the shared-file workflow the
overlay was extended to end.

YOUR JOB: confirm or refute that analysis against the code, take the ruling, IMPLEMENT it if it needs
code, and record it as a dated entry in docs/ai-ledger/decision-log.md in that file's own house style.
If you implement \`clears\`, add one case beside the collision test at mechanics-overlay.test.ts:76
proving the replacement lands AND that a second build is a clean no-op — for a hand-authored class the
ETL writes back over its own input, so idempotency is the property that matters.

Do not route around this per unit. The point of the unit is that the ruling is taken once.
NO 375px pass.`,
    { label: 'C2:overlay-ruling', phase: 'Batch 0', schema: DECISION })
    .then((ruling) => ({ weaponsEtl: c1, overlayRuling: ruling })),
])

const ruling = batch0 && batch0.overlayRuling
log(`Batch 0 closed. Overlay ruling: ${ruling && ruling.recommendation ? ruling.recommendation : 'not reported'}`)

/* ------------------------------------------------------ phase: batch 0b ---- */

phase('Batch 0b')

const batch0b = await parallel([
  () => agent(`${CONTEXT}

YOUR UNIT: C3 — \`properties\` reaches the fight. C1 has landed; the bundle now carries the column.
Work in your own git worktree (isolation is set for you). HARD-LINK node_modules with \`cp -al\`.

THIS IS NOT A SCHEMA LINE. Measured: the live-play half is already fully plumbed and the content half
is empty, so every weapon in the game currently swings with \`properties: []\`, and three defects are
live on shipped sheets right now:
  1. A Rapier rolls off STRENGTH. \`weaponAbilityModifier\` (apps/server/src/equipment-derivation.ts:984-991)
     reads \`finesse\` to take the better of Str and Dex, and that branch never fires.
  2. A Glaive, Halberd, Lance, Pike and Whip all have 5-FOOT reach. \`weaponAction\`
     (equipment-derivation.ts:993-1012) reads \`reach\` for 10 feet, and that branch never fires.
  3. \`weapon-property-is\` is inert on every weapon — \`weaponPropertiesOf\` (:1044) always returns [].

C1 closed shapes 1 and 2 of four (WeaponReferenceSchema, the ETL emit). YOU close shapes 3 and 4:
  3. EquipmentWeaponStatsSchema (packages/content-srd-5.2.1/src/schemas.ts:226-234) and the
     loadEquipment() weapon fold (packages/content-srd-5.2.1/src/index.ts:113-117).
  4. The catalog->inventory copy at apps/server/src/character-build.ts:1586, which lists five weapon
     keys and omits \`properties\`.
Plus the CONTROL: a sixth row in the client's weapon block (apps/client/src/homebrew/schemas.ts:764-770,
five rows today). Use WEAPON_PROPERTY_IDS, which apps/client/src/homebrew/useSchemaContext.ts already
imports. Keep it OPEN — a homebrew property must stay typable, like every other SRD vocabulary control.
Shipping the four shapes without the control manufactures a fresh SRD-only row, which is the exact
mirror defect this phase exists to end.

WATCH — this hazard is documented at schemas.ts:218-225 and it has bitten before: adding a key to
EquipmentWeaponStatsSchema is what pushed \`z.infer\` past TypeScript's expansion budget and silently
truncated packages/domain/src/catalog-choice.ts's view of SpellReference, with no error at the edit
site. Run \`npm run check\` at the ROOT, and assert explicitly that catalog-choice.ts still sees
SpellReference.attackRoll and .rangeFeet.

WATCH, second: a character built before this unit has no \`properties\` on its stored inventory rows.
That is what the governing plan's ruling 7 (schemaVersion bump + GM-triggered rebuild) is for. Do NOT
invent a second migration. Your tests build a fresh character.

FAR END, three of them, two being live defects: a DEX 15 / STR 12 character's Rapier attack bonus and
damage move to Dexterity; a Glaive's reach becomes 10 ft and a Mace's stays 5; a
\`weapon-property-is: ["finesse"]\` rider fires on the Rapier and not the Mace. Both paths — the SRD
path out of the catalog, the editor path through the real controls, one assertion body over both.

PROBES: (control) filter weapon.properties out of the form's fields -> the mirror test names the
missing field. (value) author \`heavy\` instead of \`finesse\` on the Rapier -> its bonus falls back to
Strength and far end 1 fails. Restore both.

375px: YES. \`node scripts/tap-audit.mjs 375\` on /homebrew — the count must not rise — and check the
new control with touch at a narrow viewport.`,
    { label: 'C3:properties', phase: 'Batch 0b', schema: UNIT_RESULT, isolation: 'worktree' }),

  () => agent(`${CONTEXT}

YOUR UNIT: C4 — Wizard's Spell Mastery becomes two picks. C2 has ruled on the overlay collision;
read that ruling in docs/ai-ledger/decision-log.md and land through the home it names.
Work in your own git worktree. HARD-LINK node_modules with \`cp -al\`.

THE DEFECT, measured. bundles/classes.v1.json's Wizard record carries, on \`spell-mastery\`:
  { "kind": "spell", "choose": 2, "fromCatalog": "wizard-spells", "maxSpellLevel": 2 }
against printed text reading "Choose a level 1 AND a level 2 spell." Two level-1 spells is a legal
build today; so is two level-2 spells. The correct shape is \`choices\` — one block capped at level 1,
one floored and capped at level 2. \`choices\` has been exposed on FeatureMechanics since ef54720
(class-mechanics/overlay.ts:78) and the panel has edited a LIST of blocks since d02e894.

WHY IT IS NOT A ONE-LINE OVERLAY EDIT, and this is the whole reason C2 exists: wizard is one of the
three HAND_AUTHORED classes (build-class-bundle.ts:33), the record already carries \`choice\`, the
overlay is additive-only for those three, and \`oneChoiceForm\` (src/character-content.ts:525-527)
refuses a record carrying both spellings — so writing \`choices\` beside \`choice\` fails the build at
ClassReferenceSchema.parse rather than merging.

RIDE-ALONG, SAME COMMIT: class-mechanics/wizard.ts:66-73 reports this as blocked and gives the WRONG
reason — it says overlay.ts exposes \`choice\` and not \`choices\`, and overlay.ts:78 now exposes both.
The code is truth and the comment is the defect. Fix it in place.

FAR END: a level-18 Wizard's build offers TWO pick rows with DIFFERENT windows, and a build answering
both rows with level-1 spells is REFUSED BY NAME. The refusal is the far end — it is the whole bug.

PROBES: (control) collapse the two blocks back to one -> the "two windows" assertion fails and the
refusal stops happening. (value) set the second block's floor to 1 -> the refusal stops. Restore both.

375px: YES — the builder's pick step now renders two rows where it rendered one, at level 18.`,
    { label: 'C4:spell-mastery', phase: 'Batch 0b', schema: UNIT_RESULT, isolation: 'worktree' }),
])

const prereqBlocked = (batch0b || []).filter((r) => r && !r.landed)
log(`Batch 0b: ${(batch0b || []).filter((r) => r && r.landed).length}/2 landed${prereqBlocked.length ? `; blocked: ${prereqBlocked.map((r) => `${r.unit} ${r.blocked}`).join(' | ')}` : ''}`)

/* ----------------------------------------------- phase: source and ETL ---- */

phase('Source and ETL')

const bundle = await pipeline([
  () => agent(`${CONTEXT}

YOUR UNIT: C5 — vendor the SRD magic-item source and repair two false claims. SERIAL; C6 needs you.

MEASURED, AND IT IS THIS PROGRAM'S HEADLINE FINDING: there is no magic-item source in this repository
at all. The open5e fixtures ship 15 models and none of them is a magic item. equipment.md's own
"## Magic Items" section (line 2137) is the RULES about magic items — identifying, attunement,
wearing — and contains zero item entries; it says so itself: "Hundreds of magic items are detailed in
'Magic Items' later in this document." Every heading after 2137 is a rule.

sources/dnd-5e-srd-markdown/PROVENANCE.json's \`notVendored\` field names magic-items.md among eight
files left out, with the reason "the corresponding bundles already come from the open5e fixtures and
are cross-validated." THAT REASON IS FALSE for this one file. There is no magic-item bundle and no
magic-item fixture. It is a defect; repair it, do not soften it.

WHAT TO DO: vendor magic-items.md from downfallx/dnd-5e-srd-markdown at commit
1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4 — the exact commit PROVENANCE.json already pins for the
other four files. VERIFIED REACHABLE: HTTP 200, 244,314 bytes, 5,015 lines. Do not hand-transcribe;
PROVENANCE.json records that hand-authoring is "where both licensing violations landed."

Then repair BOTH claims in the same commit:
  - PROVENANCE.json: add the file to \`files\`, and correct \`notVendored\` so it no longer carries a
    reason that is untrue.
  - attribution.additionalSources[0].covers currently reads "classes, subclasses, class spell lists,
    species, backgrounds, feats" and becomes untrue the moment this source is used. CC BY attribution
    is not a place to leave a stale claim. It is emitted from build-bundle.ts, so edit there and
    regenerate bundles/attribution.json.

TEST: pin the vendored file's line count and its "## Magic Items A-Z" entry count, so a re-vendor at a
different commit fails loudly instead of silently shifting 258 rows. MEASURED for you: line 578 opens
the A-Z section and carries 260 \`####\` entries, of which 2 (Giant Fly, Avatar of Death) are embedded
creature stat blocks — their second line is a creature line, not an italic type line — leaving 258
items, 258 of 258 with a parseable italic type line, 140 requiring attunement.

FAR END: the pinned counts match the vendored file. NO 375px pass.`,
    { label: 'C5:vendor-source', phase: 'Source and ETL', schema: UNIT_RESULT }),

  (c5) => agent(`${CONTEXT}

YOUR UNIT: C6 — the magic-item ETL. The longest unit in this program, and it is deliberately ONE
agent because it is ONE parser over ONE file. The parallelism lives one layer up, in the overlay
lanes that come after you.
C5 reported: ${JSON.stringify(c5)}

Read ${PLAN} section 1.5 and the C6 section in full before writing anything. The rulings that matter:

A SEPARATE GENERATED BUNDLE, not 268 rows appended to equipment.v1.json. Appending would make a
hand-authored file both the ETL's input and its output — which is exactly the condition that produces
the overlay collision C2 just had to rule on. A generated bundle is an output only. Fold it into
loadEquipment() (packages/content-srd-5.2.1/src/index.ts:98-125) as a FOURTH source beside gear,
weapons and armor; everything downstream reads the folded catalog and needs no change.

THE EXPANSION RULE. 258 entries become 268 rows: expand the five "+1, +2, or +3" ladders into one row
per tier (Ammunition, Armor, Shield, Weapon, Wand of the War Mage — 5 entries, 15 rows, net +10,
because each tier has its own rarity and its own bonus amount and "Longsword, +1" is what a GM looks
for); leave the seven "Rarity Varies" entries as ONE row each with their table rendered into the
description (Belt of Giant Strength, Feather Token, Figurine of Wondrous Power, Ioun Stone, Potion of
Giant Strength, Potions of Healing, Spell Scroll) — expanding Armor of Resistance into ten
near-identical rows is a worse browse list than one row and a table.

THE ID GUARD IS NOT OPTIONAL. Raw name slugs collide with equipment.v1.json + weapons.v1.json +
armor.v1.json on 0 of 258 (measured) — but expansion mints ids the hand-authored catalog already owns:
"Potions of Healing" expanded would mint \`potion-of-healing\`, which equipment.v1.json ships and
bundle.test.ts:212 asserts. FAIL CLOSED on any minted id already present in the other three bundles,
naming both homes — the same rule the overlay applies to riders.

ONE RECONCILIATION TO DECIDE AND WRITE DOWN: keep the grouped "Potions of Healing" row and leave the
existing mundane potion-of-healing alone (cost: two similar rows in the browse list), OR expand the
four printed tiers and delete the hand-authored row (cost: one assertion moves at bundle.test.ts:212).
Both are defensible. The failure mode is taking neither.

MEASURED FOR YOU — assert these, do not re-derive them blind, and REPORT ANY THAT DISAGREE:
  categories: Wondrous Item 127, Weapon 33, Potion 24, Ring 22, Armor 19, Wand 13, Staff 12, Rod 7,
    Scroll 1  (= 258)
  rarity: Rare 82, Uncommon 73, Very Rare 55, Legendary 32, Varies 7, Common 2, Artifact 1,
    plus 6 entries whose type line carries a ladder
  attunement: 140 of 258
  the two embedded stat blocks are skipped BY NAME with a count assertion, never by a silent filter
  costGp is null on every row — the SRD prints a value BAND by rarity, not a per-item price, and
    deriving a number from a band would be inventing content

SLOT is a closed enum the engine switches on (packages/schemas/src/index.ts:29-37). Derive it from the
type line and the item name, and ASSERT it in the bundle guard rather than trusting it. Measured
distribution for Wondrous Item: 62 worn (neck 19, shoulders 14, head 13, feet 7, hands 6, belt 2,
ioun 1) and 65 carried.

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
    { label: 'C6:magic-item-etl', phase: 'Source and ETL', schema: UNIT_RESULT }),
])

log(`Bundle: ${bundle && bundle.landed ? `landed at ${bundle.commit}` : `NOT landed — ${bundle ? bundle.blocked : 'no result'}`}`)

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
(packages/content-srd-5.2.1/src/character-content.ts:262). Measured, 6 of 258 items set an ability
score — Amulet of Health, Belt of Giant Strength, Gauntlets of Ogre Power, Headband of Intellect,
Potion of Giant Strength, Thunderous Greatclub — and Berserker Axe raises a Hit Point maximum. All
seven ship as prose with the schema's own refusal message quoted beside them. DO NOT work around this
by inventing a modifier type; that is a vocabulary decision and it belongs to a unit, not to you.

PROBES for every lane: (control) strip your module from index.ts -> your both-paths test fails naming
its item. (value) change the authored amount -> the far-end number stops moving. Restore both.

375px for every lane: \`node scripts/tap-audit.mjs 375\` on /homebrew (the count must not rise) and one
item you authored, checked on a character sheet at 375px.

Work in your own git worktree. HARD-LINK node_modules with \`cp -al\` — a symlink makes your run test
the ORIGINAL tree and prove nothing.`

const LANES = [
  {
    key: 'C7a',
    label: 'weapons and armour',
    detail: `52 items, 47 with an expressible mechanic, 35 attuned.

FAR END: a +1 weapon's to-hit AND damage both move by one, and an Armor of Resistance halves a typed
damage total on the damage command.

RESERVE, do not author — record as named absences with the unit id:
  - U20 (weapon-swing override): Sun Blade ("deals Radiant damage instead of Slashing", and "functions
    as a Longsword with the Finesse property") and Energy Bow ("deals Force damage instead of
    Piercing"). Their third carrier is monk.martial-arts and is not yours.
  - U23 (extra-damage, same type as the trigger): Vicious Weapon — "This extra damage is of the same
    type as the weapon's normal damage", which is the exact shape U23 exists for. ExtraDamageVariantSchema
    REQUIRES damageType today, so it cannot be authored before U23 lands.

DO NOT REACH FOR THE LIGHT PROPERTY AS A CARRIER. Verified with the mastery program: there is NO
two-weapon / off-hand attack mechanism anywhere in the engine — weaponAction
(apps/server/src/equipment-derivation.ts:993-1012) hard-codes activation: "action" — and the SRD
two-weapon-fighting fighting style at bundles/feats.v1.json:302 carries nothing but
tags: ["fighting-style"]. Light is real and C1 authors it on 8 weapons; what it DOES is U21's and
U35's mechanism to build. Any Light-based far end here would be vacuous.`,
  },
  {
    key: 'C7b',
    label: 'wands, staffs, rods, rings and the scroll',
    detail: `55 items, 41 with an expressible mechanic, 44 attuned. The charges-and-casts lane.

FAR END: a Wand of Fireballs spends a charge, rolls real damage through the item's \`casts\` block, and
REFUSES when the charges are gone. The refusal is the strongest half — author \`uses\` blocks properly.

RESERVE, do not author — record as named absences with the unit id:
  - U26 (spell-attack-bonus): Wand of the War Mage +1/+2/+3, Staff of the Magi, Staff of the Woodlands.
    The modifier is COLLECTED at equipment-derivation.ts:682 and APPLIED NOWHERE, so authoring it now
    ships an item whose printed bonus does nothing.
  - U29 (attack-kind-is: "spell"): the same items plus Spellguard Shield and Staff of Power — 7 items
    whose text turns on a spell attack roll.
  Note for whoever writes the test later: Wand of the War Mage expands to THREE rows under C6's ladder
  rule, so a "not a lone record" count should count records, not rows.`,
  },
  {
    key: 'C7c',
    label: 'wondrous items that are worn',
    detail: `63 items, 49 with an expressible mechanic, 51 attuned. The body-slot lane, and the heaviest
on attunement.

FAR END: a Cloak of Protection moves AC AND a saving throw the server rolls, and both come back off
when the cloak does. The on/off symmetry is the point — a bonus that survives unequipping is the bug.

THIS LANE OWNS \`cursed\`. Re-read the hiding rule at packages/content-srd-5.2.1/src/schemas.ts:269-275
before authoring one: hidden until attunement and NOTHING more, and the schema refuses a cursed item
that does not require attunement (schemas.ts:291-299). Do not invent a second hiding rule.

RESERVE, do not author — record as named absences with the unit id:
  - U31 (on-taking-damage + damage-reduction): Gloves of Missile Snaring ("take a Reaction to reduce
    the damage by 1d10 plus your Dexterity modifier") and Ring of Warmth.
  - U32 (on-death-save + roll-mode: death-save): Periapt of Wound Closure ("Whenever you make a Death
    Saving Throw, you can change a roll of 9 or lower to a 10") and Mysterious Deck.
  - U26/U29 also reach two items in your lane: Talisman of Pure Good and Talisman of Ultimate Evil.`,
  },
  {
    key: 'C7d',
    label: 'potions and carried wondrous items',
    detail: `88 items, 30 with an expressible mechanic, 10 attuned. The most items and the least
mechanics — that asymmetry is why this lane is sized smaller, and why it carries the largest number of
named absences to write down.

FAR END: a Potion of Resistance applies a typed resistance for its duration and expires.

MOST OF THE 65 CARRIED WONDROUS ITEMS ARE GM-FIAT PROSE — Bag of Beans, Deck of Illusions, Portable
Hole, Sphere of Annihilation, Mirror of Life Trapping. Writing each absence down with its reason IS
the deliverable for those; a lane that quietly authors nothing for 65 items is indistinguishable from
one that forgot. Three of the seven refused ability-score items are yours (Potion of Giant Strength).`,
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

Results to audit:
  batch 0:  ${JSON.stringify(batch0)}
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

3. THE LEDGER. docs/ai-ledger/current-state.md is EXACTLY at its enforced 150-line ceiling and is
   PARENT-ONLY — do not edit it; report the replacement lines you would make instead.
   docs/ai-ledger/known-bugs.md and docs/ai-ledger/decision-log.md take this program's entries: the
   three live defects C3 fixed (Finesse rolling off Strength, Reach weapons at 5 feet,
   weapon-property-is inert), and the fact that regenerating weapons.v1.json used to be silently
   destructive. Re-run \`npm run docs\` ONLY if something touched state/command/HTTP/OpenAPI — nothing
   in this program should have, and if something did, that is a finding, not a doc chore.

Run the full suite ONCE, serially. Never two suites at the same time — the server suite binds a live
port. Build only the client workspace, or \`npm run test\` collects compiled server tests too
(185 -> 204 files, ~11 spurious failures).

Default to "fix required" if you find real doubt. Do not be agreeable; your job is to find where this
program is wrong.`,
  { label: 'C8:close', phase: 'Close', schema: CLOSE_RESULT })

log(`Close: ${close ? close.verdict : 'no verdict'}${close && close.unwired.length ? ` — ${close.unwired.length} unwired` : ''}${close && close.vacuous.length ? `, ${close.vacuous.length} vacuous` : ''}`)

return {
  batch0,
  prerequisites: batch0b,
  bundle,
  mechanics,
  close,
  landed: [].concat(batch0b || [], mechanics || [], bundle ? [bundle] : []).filter((r) => r && r.landed).length,
}

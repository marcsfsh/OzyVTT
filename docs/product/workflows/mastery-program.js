export const meta = {
  name: 'mastery-program',
  description: 'Weapon mastery: verify the batch-0 gate, land the dispatch seam, then take six inert mastery slugs to a far-end engine outcome and open the eighth to homebrew.',
  phases: [
    { title: 'Gate', detail: 'prove batch 0 actually landed the mastery ETL and the properties column before anything starts' },
    { title: 'Seam', detail: 'M0 — move graze and sap behind one dispatch registry, serial, no behaviour change' },
    { title: 'Behaviour', detail: 'topple, cleave, push and the Light extra attack, four concurrent, each implement then adversarial review' },
    { title: 'Blocked', detail: 'nick, vex and slow — each opens only when its blocker has merged' },
    { title: 'Closer', detail: 'U38 opens weapon.mastery to homebrew, gated on all eight slugs reaching' },
  ],
}

const REPO = `OzyVTT at /home/user/OzyVTT, branch claude/feature-implementations-intake-c5eyu1.

READ FIRST, in this order:
  1. CLAUDE.md (constitutional; rules 2, 4, 5 and 6 all bite here)
  2. docs/product/plan-mastery-program.md — THE plan for this program. Your unit is specified there
     with its four parts, its far-end proof, both non-vacuity probes and its 375px obligation.
     Do not re-derive scope; do not exceed it.
  3. docs/product/remaining-program-plan.md — the governing document (batch order, serialization
     points, the verification bar).
  4. apps/server/src/equipment-derivation.ts (the IMPLEMENTED_MASTERIES docblock at :225-247),
     apps/server/src/action-resolution.ts, apps/server/test/weapon-mastery.test.ts.

STANDING RULES FOR THIS PROGRAM:
  - NEVER run \`npm run build-bundle\`, and never regenerate
    packages/content-srd-5.2.1/bundles/weapons.v1.json. It is batch 0's, and a rebuild silently
    drops the mastery column from all 38 rows.
  - Generated and parent-only, never yours: docs/api-reference.md, docs/app-map.md,
    docs/ai-ledger/current-state.md (it sits exactly at its 150-line ceiling).
  - Build only the client workspace. \`npm run build\` emits compiled output under the server
    workspace and \`npm run test\` then collects those compiled tests too (185 -> 204 files,
    ~11 spurious failures).
  - At most two full suites at once on this box; the server suite binds a live port.
  - If you work in a worktree, HARD-LINK node_modules (\`cp -al\`). NEVER symlink it: POSIX
    resolves the symlink first and you will test the ORIGINAL tree and get a green run that
    proves nothing.
  - Read docs/ai-ledger/known-bugs.md before calling a red test a regression.`

const DONE_BAR = `THE DONE BAR — all three, and none is optional:

  1. A FAR-END PROOF, DRIVEN FROM A WEAPON RECORD. The test ends at a rolled number, an applied
     condition, a moved token, a spent-or-unspent counter. "The value survived derivation" and
     "the handler was called" are NOT tests. The model to copy is
     apps/server/test/weapon-mastery.test.ts:244-246 — Sap is proved on the die the FOE rolls
     later, not on the effect that was applied.
  2. TWO NON-VACUITY PROBES, restored after each, with exact counts and messages reported:
       CONTROL probe  — disable the control (remove the slug's handler) -> a NAMED failure.
       VALUE probe    — keep the control, change the value -> the FAR-END assertion fails.
     Your plan entry names both probes for your unit specifically. Run those.
  3. A 375px TOUCH PASS for anything with UI: \`node scripts/tap-audit.mjs 375\`, quote its
     output (never a number from a document), and the count must NOT rise. Chromium is at
     /opt/pw-browsers — NEVER run \`playwright install\`.

THE HONESTY GATE. A slug joins the implemented set in the SAME commit that adds its behaviour and
its test — never before, never after. apps/server/test/weapon-mastery.test.ts:279-280 carries
\`built\` and \`notYet\` as two hand-written arrays; move exactly one slug from one to the other,
in alphabetical position. Re-check those two lines after any rebase, before your final run.

Say what you ran and what you saw. "Should work now" is not a result.`

const REPORT = {
  type: 'object',
  additionalProperties: false,
  required: ['done', 'summary', 'commands', 'farEndProof', 'probes', 'filesTouched', 'blockers'],
  properties: {
    done: { type: 'boolean', description: 'true only if the far-end proof and BOTH probes actually ran and passed.' },
    summary: { type: 'string', description: 'What landed, in 2-4 sentences.' },
    commands: { type: 'array', items: { type: 'string' }, description: 'Exact commands run, with the counts observed.' },
    farEndProof: { type: 'string', description: 'The engine outcome the test ends at, and the assertion that reads it.' },
    probes: {
      type: 'array',
      description: 'Both probes. Empty or one-entry means the unit is NOT done.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'whatWasBroken', 'failureObserved', 'restored'],
        properties: {
          kind: { type: 'string', enum: ['control', 'value'] },
          whatWasBroken: { type: 'string' },
          failureObserved: { type: 'string', description: 'The exact count and message.' },
          restored: { type: 'boolean' },
        },
      },
    },
    filesTouched: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' }, description: 'Anything that stopped the unit short. Empty if none.' },
  },
}

const REVIEW = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'unwired', 'vacuous', 'notes'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'pass-with-notes', 'fix-required'] },
    unwired: { type: 'array', items: { type: 'string' }, description: 'Mechanisms built but read by nothing. Cite file:line.' },
    vacuous: { type: 'array', items: { type: 'string' }, description: 'Assertions that would still pass with the feature deleted. Cite file:line.' },
    notes: { type: 'string' },
  },
}

const GATE = {
  type: 'object',
  additionalProperties: false,
  required: ['masteryEtl', 'propertiesColumn', 'evidence', 'safeToStart'],
  properties: {
    masteryEtl: { type: 'boolean', description: 'build-bundle.ts emits mastery on all 38 weapon rows.' },
    propertiesColumn: { type: 'boolean', description: 'weaponPropertiesOf returns "light" for a built character carrying a dagger.' },
    evidence: { type: 'array', items: { type: 'string' } },
    safeToStart: { type: 'boolean' },
  },
}

/** One unit's implement prompt. Everything the agent needs is in the string; nothing is threaded in. */
function implement(unit) {
  return `${REPO}

YOUR UNIT: ${unit.id} — ${unit.title}

${unit.brief}

${unit.invariants}

${DONE_BAR}

SCOPE DISCIPLINE. One vocabulary item, one commit. Do not touch another unit's slug, do not
refactor beyond your unit, do not edit the generated documents, do not regenerate the weapons
bundle. If your unit turns out to need something the plan did not name, STOP and report it as a
blocker rather than growing.`
}

/** The adversarial review that closes each unit. It hunts two failure modes and no others. */
function review(unit) {
  return `${REPO}

You are an ADVERSARIAL REVIEWER for unit ${unit.id} (${unit.title}). Read only; do not fix.

This is NOT general code review. You hunt exactly two failure modes, because they are the two this
repository has actually shipped:

  (A) BUILT BUT UNWIRED. A mechanism that typechecks, reviews as done, and changes nothing at the
      table. For this program the specific shape is: a slug in the implemented set whose handler is
      never reached, a handler whose effect nothing consumes, a field written that no reader reads.
      Trace the value from the weapon record all the way to the number a player sees. Name the
      first link that breaks.

  (B) VACUOUS TESTS. An assertion that would still pass with the feature deleted. Ask of every new
      assertion: what would it say if the handler returned nothing? If the answer is "still green",
      it is vacuous. Check that the reported probes were REAL — that the control probe produced a
      NAMED failure and the value probe failed at the FAR END rather than at the same place.

Also check, specifically:
  - apps/server/test/weapon-mastery.test.ts:279-282 — exactly one slug moved from \`notYet\` to
    \`built\`, and the third assertion (the union equals the bundle's eight) still holds.
  - The unit's test is driven from a WEAPON RECORD, not from a hand-built effect or a synthetic
    action. If the test would pass with no weapon in the inventory, it is not this unit's test.
  - CLAUDE.md rule 2 (the server owns every game decision) and rule 4 (a player acts only on their
    claimed character) — for any unit that writes game state or names a second actor.

Default to fix-required when you find real doubt. Cite file:line. Do not be agreeable.`
}

const UNITS = {
  m0: {
    id: 'M0',
    title: 'the dispatch seam — a refactor, NOT a unit',
    brief: `Move the Graze branch (apps/server/src/action-resolution.ts:948-951) and the Sap branch
(:1058-1079) into ONE new leaf module beside action-resolution.ts — basename weapon-mastery.ts —
exposing an on-miss hook and an on-hit hook plus one registry keyed by slug. action-resolution.ts
calls the two hooks where the branches were.

WHY THIS EXISTS: four later units (topple, push, vex, slow) are all "on a hit, do something to the
target", and today the only such shape is the Sap block. Four agents appending after line 1079 is
one ~20-line hunk touched four times — a genuine conflict, and the dangerous kind, because a
careless resolution drops a branch and leaves a slug claiming a behaviour it does not have.

MAKE IMPLEMENTED_MASTERIES DERIVED: \`new Set(Object.keys(MASTERY_HANDLERS))\`, replacing the hand
literal at apps/server/src/equipment-derivation.ts:247. That is what removes it as a merge point,
and it strengthens the honesty gate rather than weakening it — a slug cannot be in the set without
a handler.

THE CYCLE CONSTRAINT IS REAL. equipment-derivation.ts's own docblock at :215-217 records that it
imports no other server module ON PURPOSE, so character-build.ts can import it without a cycle. The
registry (slug keys) must stay a leaf; the handlers (which import effects.ts and saving-throws.ts)
must not be reachable from it. If a clean split proves awkward, LEAVE IMPLEMENTED_MASTERIES where it
is as a hand-written literal, say so, and stop — do NOT invent a cycle.`,
    invariants: `THE PROOF THAT THIS WAS A REFACTOR: apps/server/test/weapon-mastery.test.ts passes
UNCHANGED — all 12 tests, with ZERO edits to that file in this commit. Baseline measured at HEAD
6278e5a: \`npx vitest run test/weapon-mastery.test.ts --root apps/server\` -> 1 file, 12 passed,
1.82s. If one assertion has to move, this was not a refactor and you must stop and report.

You add no slug to the implemented set. The set stays {graze, sap}.`,
    ui: false,
  },
  u34: {
    id: 'U34',
    title: 'topple — a Constitution save the weapon triggers, then Prone (5 weapons)',
    brief: `Add a \`topple\` handler to M0's on-hit registry. On a hit, the target makes a
Constitution saving throw against DC 8 + the attacker's ability modifier + proficiency bonus, or has
the Prone condition.

Use createPendingSaves (apps/server/src/saving-throws.ts:164-192) with ability "con",
conditionId "prone", proposedDamage 0, halfOnSuccess false. The pattern already exists ~100 lines
away: the builtin shove at apps/server/src/action-resolution.ts:1163-1185 computes exactly this DC
shape at :1166 and passes conditionId "prone" at :1178.

The ability modifier is already in hand: masteryByActionId carries it
(apps/server/src/equipment-derivation.ts:654), and it is there precisely because the finesse /
ranged choice belongs to weaponAction rather than the resolver. Do NOT recompute it.

Authors: battleaxe, lance, maul, quarterstaff, trident. Nothing to author.
NO CONTROL, and that is correct — weapon.mastery is a closed 8-slug enum and implementing a slug
adds no authorable vocabulary. The control is U38's job and U38's alone.`,
    invariants: `FAR END: state.combat.pendingSaves carries the prompt at the right DC and ability,
and after an answer BELOW the dc the foe carries "prone" in actor.conditions. Not "the handler ran".`,
    ui: false,
  },
  u36: {
    id: 'U36',
    title: 'cleave — a second attack roll at a different creature (2 weapons)',
    brief: `On a hit with a melee attack, make an attack roll with the same weapon against a second
creature within 5 feet of the first and within reach. On a hit the second creature takes the
weapon's damage WITHOUT the ability modifier. Once per turn.

THE RULING YOU ARE IMPLEMENTING — do not redesign it:
  The second target is CLIENT-SUPPLIED in targetIds[1], not server-chosen. canPlayerTarget
  (apps/server/src/authorization.ts:35-38) has EXACTLY ONE production call site —
  apps/server/src/game-operations.ts:1238, a loop over resolvedTargetIds — so reading targetIds[1]
  routes the second target through the existing gate for free. The tempting alternative, a
  dedicated cleaveTargetId field, creates a second target path that loop does not iterate: that is
  the ungated hole, not the fix. REUSE THE GATE; DO NOT ADD ONE BESIDE IT.

THE ONE GUARD THAT MUST CHANGE: apps/server/src/action-resolution.ts:678 currently throws "An
attack roll resolves against exactly one target." Relax it to permit EXACTLY TWO, and ONLY when the
action's in-force mastery is cleave. Everything downstream keeps reading targets[0] — the on-hit
riders (:1011), Sap (:1059), the grant recipient (:1086), the reaction prompt (:1122) and the
builtin saves (:1165) all take index 0 and stay correct. Keep the relaxation as narrow as the rule.

STILL A SERVER DECISION (CLAUDE.md rule 2): whether the second target is LEGAL — within 5 feet of
the first, within reach — computed from deps.distanceFeet, never trusted from the client. An
illegal second target is a WARNING and a skipped cleave, never a rejected attack.
Once-per-turn rides the existing turn-scoped counter (action-resolution.ts:1233-1236,
plan.spendUse.per === "turn").

Authors: greataxe, halberd — both melee, which matches the SRD. Nothing to author. No control.`,
    invariants: `INVARIANT UNIT — CLAUDE.md rule 4 (role boundaries). You get a viewer-safety audit
BEFORE merge, not after, and you must answer two questions IN WRITING:
  (a) Does a player-initiated cleave naming a gm-only second target refuse at
      game-operations.ts:1238 BEFORE any name, AC or outcome is computed?
  (b) Does the refusal message differ between "no such actor" and "hidden actor"? If it does, it is
      an existence oracle and it is a defect.
Pair with apps/server/test/docs-viewer-safety.test.ts and add a case to
apps/server/test/authorization.test.ts.

FAR END: two damage totals in one ActionResolution, the second lower than the first by EXACTLY the
ability modifier, against a named second foe.`,
    ui: true,
  },
  u37: {
    id: 'U37',
    title: 'push — the target moves 10 feet straight away on a hit (4 weapons)',
    brief: `On a hit, push the target 10 feet straight away from the attacker.

THE RULING YOU ARE IMPLEMENTING — do not redesign it:
  Push takes NO CLIENT INPUT AT ALL — no destination, no direction, no distance — and moves ONLY
  targets[0], which canPlayerTarget already cleared at game-operations.ts:1238. The direction is
  derived server-side from the two token positions; the distance is the SRD's fixed 10 feet. There
  is nothing for the client to assert, which is server authority (CLAUDE.md rule 2) held correctly
  rather than re-checked.

THE SEAM: action-resolution.ts has no geometry and must NOT grow an import of token-placement.ts.
\`geometry\` is already fetched inside actionResolve at apps/server/src/game-operations.ts:1194, so
add an OPTIONAL DEPENDENCY to ResolveDependencies (action-resolution.ts:54-76) — a callback the
operation constructs, which calls moveEncounterToken (apps/server/src/token-placement.ts:155-166)
internally. That reuses the same snapping the GM's own drag uses (:77-97 via :161), which is what
docs/ai-context/map-grid.md requires: the server owns all snapping and there is exactly ONE
implementation of it.

THREE RULINGS, so you do not have to invent them:
  1. FORCED MOVEMENT DOES NOT ROUTE THROUGH applyMovementRules. Calling moveEncounterToken directly
     skips it and that is CORRECT: SRD forced movement provokes no opportunity attacks and spends
     none of the target's movement. applyMovementRules is called only from tokenMove
     (game-operations.ts:713), never from moveEncounterToken. SAY SO IN A COMMENT or the next
     reader will "fix" it.
  2. UNMEASURABLE DEGRADES TO A WARNING, NEVER A REJECTION. On a gridless or uncalibrated map
     mapDistance returns null (apps/server/src/movement-narration.ts:33-40), and a token with no
     position cannot be pushed. The precedent is one file away and exactly right: the builtin shove
     at action-resolution.ts:1183 pushes a warning. Copy that sentence shape. moveEncounterToken
     THROWS when the token is absent — guard before calling.
  3. THE FOG REQUIREMENT IN docs/product/area-2-plan.md IS STALE. Measured: apps/server/src/fog.ts
     contains ZERO token references and its only production importer is game-operations.ts:36
     (paintFog, resetFog, setFogEnabled — all GM paint commands). NOTHING recomputes fog from token
     positions. There is nothing to route through. DO NOT BUILD ONE.

Authors: greatclub, heavy-crossbow, pike, warhammer. Nothing to author. No control.`,
    invariants: `INVARIANT UNIT — CLAUDE.md rules 2, 4 and 5. You get a viewer-safety audit BEFORE
merge. Its honest scope is NARROWER than area-2-plan.md claims and you should say so: push
introduces NO NEW WIRE FIELD. Token positions already ship to players and the viewer, filtered to
public actors at apps/server/src/projections.ts:76. The real questions are:
  (a) Can a player cause a token they do not own to move? Yes — that is the rule — but ONLY
      targets[0] and only after canPlayerTarget. Prove the structure makes that true rather than
      checked.
  (b) Can a player cause a HIDDEN actor's token to move, which would be an existence oracle through
      the revision bump? Answer via game-operations.ts:1238, and prove it.

375px IS MANDATORY. A forced move can land a token off the visible viewport on a phone — a
mobile-parity failure the desktop never sees (CLAUDE.md rule 5, docs/ai-context/mobile-ux.md).
Verify at 375px that a pushed token stays findable, and run \`node scripts/tap-audit.mjs 375\`; the
count must not rise.

FAR END: the foe's state.combat.tokens[].position before and after, with the distance between them
measured through mapDistance equal to 10 feet, in the direction away from the attacker, SNAPPED.`,
    ui: true,
  },
  u35a: {
    id: 'U35a',
    title: 'the Light-property extra attack — a prerequisite, and NOT a mastery',
    brief: `READ THIS FIRST: this unit exists because the plan measured that nick has nothing to
move. Nick reads "when you make the extra attack of the Light property, you can make it as part of
the Attack action instead of as a Bonus Action" — and there is NO Light-property extra attack
anywhere in this codebase. Grepping two-weapon / offhand / off-hand / a light weapon branch across
apps/server/src, apps/client/src and packages/rules-5e/src returns nothing but armour weight
(packages/rules-5e/src/riders.ts:18,280). weaponAction hard-codes activation "action" at
apps/server/src/equipment-derivation.ts:1007.

CORROBORATION that this is work someone owes anyway: the SRD fighting style two-weapon-fighting
ships at packages/content-srd-5.2.1/bundles/feats.v1.json:302, a Fighter can pick it, its
description is "when you make an extra attack as a result of using a weapon that has the Light
property..." — and it has ZERO readers. Inert for exactly this missing mechanism.

BUILD: a bonus-action swing offered when the attacker made the Attack action with a Light weapon
and holds a second Light weapon; damage WITHOUT the ability modifier. The bonus-action economy
already exists at apps/server/src/action-resolution.ts:255-257 and is committed at :1211-1215.

The \`light\` property itself is BATCH 0's work, not yours (see the plan §2.2). If
weaponPropertiesOf("dagger", ...) does not return a list containing "light", STOP and report it as
a blocker — you are unblocked by batch 0, not by writing the column yourself.`,
    invariants: `THIS IS A SCOPE EXPANSION and the plan flags it as needing the parent's ruling. If
you were started without that ruling, say so in your report.

FAR END: a Fighter holding two Light weapons gets a bonus-action swing that ROLLS DAMAGE; a Fighter
holding one does not. Not "the action appears in a list".

375px IF you add a runner affordance for the bonus swing, which you almost certainly must:
\`node scripts/tap-audit.mjs 375\`, count must not rise, and the new control checked at a narrow
viewport with touch.`,
    ui: true,
  },
  u35b: {
    id: 'U35b',
    title: 'nick — moves the Light property’s extra attack out of the bonus action (4 weapons)',
    brief: `DEPENDS ON U35a. If the Light-property extra attack does not exist in the merged trunk,
STOP — there is nothing for nick to move and you must not build it here.

Add a \`nick\` handler: when the attacker's Light weapon has nick in force, U35a's bonus-action
swing folds into the Attack action — it resolves WITHOUT setting bonusActionUsed
(apps/server/src/action-resolution.ts:256, committed at :1212), once per turn.

Authors: dagger, light-hammer, scimitar, sickle — all four must also carry "light" after batch 0.
Nothing to author. No control.`,
    invariants: `FAR END: THE REFUSAL THAT DOES NOT HAPPEN. state.combat.turn.bonusActionUsed is
still FALSE after the extra swing, and then a bonus-action Dash SUCCEEDS. The same Fighter without
nick picked has bonusActionUsed true and the Dash is REFUSED with economy.bonus-action-used.
"The bonus action is still available" is only a real claim if something then consumes it.`,
    ui: false,
  },
  m1: {
    id: 'M1',
    title: 'vex — Advantage on your next attack AGAINST THAT CREATURE (8 weapons, the largest)',
    brief: `HARD-BLOCKED ON U22 (target-scoped effects). Before writing anything, confirm in the
merged trunk that (a) an effect can name the actor it applies against, (b) that field is consumed in
attackRollSources beside the onOwnTurn gate at apps/server/src/action-resolution.ts:546, and (c) it
is stripped in playerEffect (apps/server/src/projections.ts:138-139), which already strips
sourceActorId for exactly this reason. If any of the three is missing, STOP and report.

THERE IS NO DEGRADED FORM. A plain attack-advantage would grant advantage against EVERYONE — a
rules bug that looks exactly like the feature working. Do not ship it.

Add a \`vex\` handler to M0's on-hit registry: apply an effect to THE ATTACKER carrying an
attack-advantage modifier scoped to the target actor, ending before the end of the attacker's next
turn.

Authors: blowgun, dart, hand-crossbow, handaxe, pistol, rapier, shortbow, shortsword. Nothing to
author. No control.

WHY THIS IS A UNIT AND NOT A RIDER ON U22: U22's four parts are the advantage collector, an SRD
record, one row in the modifiersField nest, and a test ending at an advantage that applies against
one named foe. None of those is a mastery branch, none is vex joining the implemented set, and none
is a test driven from a weapon record. U22 UNBLOCKS vex; it does not implement it.`,
    invariants: `FAR END: the NEXT attack against foe A rolls 2d20 and keeps the HIGHER — read off
rollMode and attack.naturalRoll — while the next attack against foe B rolls ONE die. Copy the shape
at apps/server/test/weapon-mastery.test.ts:244-246: prove it on the die that gets rolled later, not
on the effect that was applied.

VIEWER SAFETY: you ride U22's field and U22 carries the audit. Your own obligation is to CONFIRM the
field you write is the one projections.ts:138-139 strips. That is a check, not a new decision.`,
    ui: false,
  },
  m2: {
    id: 'M2',
    title: 'slow — the target loses 10 feet of Speed until your next turn (7 weapons)',
    brief: `HARD-BLOCKED ON U18 (the runtime speed effect modifier). Before writing anything,
confirm in the merged trunk BOTH halves: (a) EffectModifierSchema
(packages/schemas/src/index.ts:232-255, 12 members at HEAD) has a speed member, AND (b)
effectiveSpeedFeet (apps/server/src/condition-rules.ts:44-51) actually READS effect modifiers. At
HEAD it reads actor.speedFeet, exhaustion, SPEED_ZERO_CONDITIONS and the dashing tag, and never
looks at actor.effects[].modifiers at all. If (b) is missing you have a field nothing consumes —
STOP and report.

DO NOT PAPER OVER IT by writing actor.speedFeet directly. That is destructive and unrecoverable.

Add a \`slow\` handler to M0's on-hit registry: apply an effect to THE TARGET carrying U18's speed
modifier at -10, with duration { type: "until-source-next-turn" } — the same duration Sap uses
(apps/server/src/action-resolution.ts:1068) and the same one Reckless Attack and Dodge use.

Key the effect \`\${commandId}:mastery:slow:\${targetId}\`, following Sap's key shape at :1061, so
two different attackers each apply their own. Whether two -10s stack is the SRD's problem, not this
unit's — DO NOT invent a cap.

Authors: club, javelin, light-crossbow, longbow, musket, sling, whip. Nothing to author. No control.

WHY THIS IS A UNIT AND NOT A RIDER ON U18: same argument as vex. U18's test ends at a movement
budget changed by an SRD EFFECT record, not by a WEAPON record, and none of its parts adds the slug.`,
    invariants: `FAR END: the MOVEMENT BUDGET, read where the engine enforces it —
apps/server/src/movement-rules.ts:68 calls effectiveSpeedFeet. End at a refused or narrated
over-budget move, NOT at "the effect has a -10 modifier".`,
    ui: false,
  },
  u38: {
    id: 'U38',
    title: 'weapon.mastery on a homebrew weapon — the closer, gated on all eight slugs',
    brief: `THE GATE COMES FIRST. Before anything else, read apps/server/test/weapon-mastery.test.ts
:279-280 in the merged trunk. \`notYet\` MUST be empty and \`built\` MUST hold all eight slugs. If it
does not, STOP — shipping this control early offers a GM choices that do nothing, which is exactly
the failure this whole program exists to close.

Only the CONTROL is missing. The reader already ships (masteryByActionId,
apps/server/src/equipment-derivation.ts:644-656, which already requires mastery AND unlocked AND
implemented), and all 38 SRD weapons already author it.

ADD ONE ROW to the weapon section of apps/client/src/homebrew/schemas.ts. Measured at HEAD the
section is :756-771 and its fields are :764-769 — five rows (weapon kind, damage, damage type,
range, long range) and no mastery.

TWO THINGS TO GET RIGHT:
  1. IT IS A \`select\`, NOT A \`pick\`. weapon.mastery is a CLOSED 8-slug enum
     (packages/content-srd-5.2.1/src/schemas.ts:233), so free entry would let a GM type a slug that
     publishes clean and is silently inert — the hardest homebrew failure to diagnose. Join the
     closed list at apps/client/src/homebrew/vocabularies.test.ts:169-171 beside equipment.slot,
     equipment.weapon.category and class.hitDie, with emptyValue "omit" (a homebrew weapon may
     legitimately have no mastery — the schema says so at
     packages/content-srd-5.2.1/src/schemas.ts:120-123).
  2. DO NOT USE ctx.weaponProperties. That list is properties AND masteries merged
     (apps/client/src/homebrew/schema.ts:136 — measured 9 + 8 = 17 slugs), assembled for the
     weapon-property-is trigger. Offering it here would let a GM set a weapon's mastery to
     "finesse". WEAPON_MASTERY_IDS (packages/content-srd-5.2.1/src/schemas.ts:129) is the right
     list and is ALREADY imported at apps/client/src/homebrew/useSchemaContext.ts:17.

DELETE THE CENSUS LINE IN THE SAME COMMIT.
apps/client/src/homebrew/vocabulary-parity.mirror.test.ts:3415 carries
["equipment", "weapon.mastery", [], "U38 — 38 SRD weapons, gated on all eight slugs reaching"] in
the \`owed\` array, and the assertion at :3419-3421 requires every owed key to still be
unreachable. Adding the control without deleting that line FAILS the test. That is the guard
working, not a regression. Baseline measured at HEAD:
\`npx vitest run src/homebrew/vocabulary-parity.mirror.test.ts --root apps/client --project node\`
-> 1 file, 51 passed, 3.62s.`,
    invariants: `FAR END: a GM authors a homebrew weapon with mastery "topple", a character unlocks
it, and a swing produces the Constitution save — through the editor's own applyField / storedBody
path, the way vocabulary-parity.mirror.test.ts proves every other control. NOT "the key
round-tripped".

375px IS MANDATORY — this is the one unit in the program with UI. A select in the equipment form at
a narrow viewport with touch, plus \`node scripts/tap-audit.mjs 375\`. Quote its output; the count
must not rise.`,
    ui: true,
  },
}

/** implement -> adversarial review, as one chain per unit so nobody waits at a barrier. */
function unitPipeline(unit, phaseName) {
  return pipeline([
    () => agent(implement(unit), { label: `build:${unit.id}`, phase: phaseName, schema: REPORT }),
    (built) => agent(
      `${review(unit)}\n\nTHE IMPLEMENTER REPORTED:\n${JSON.stringify(built, null, 2)}`,
      { label: `review:${unit.id}`, phase: phaseName, schema: REVIEW }
    ).then((verdict) => ({ unit: unit.id, built, verdict })),
  ])
}

// ---------------------------------------------------------------------------------------------

phase('Gate')

const gate = await agent(
  `${REPO}

You are the BATCH-0 GATE for the weapon-mastery program. Read and measure only; change nothing.

This program's entire data basis is the \`mastery\` column on the 38 weapon rows, and its
second-largest unit needs a \`properties\` column that does not exist. Both belong to batch 0. Your
job is to answer, with evidence, whether batch 0 actually landed them — not whether someone said it
did.

MEASURE, DO NOT TRUST:

1. THE MASTERY ETL. At HEAD 6278e5a, packages/content-srd-5.2.1/scripts/build-bundle.ts:549-559
   builds weaponRecords and never emits \`mastery\`. Because WeaponReferenceSchema.mastery is
   .optional() (packages/content-srd-5.2.1/src/schemas.ts:125), validateBundle passes with the
   column gone — the loss is SILENT. Read the current build-bundle.ts and state whether the emit
   now carries mastery. Do NOT run \`npm run build-bundle\` to find out; read the code.

2. THE PROPERTIES COLUMN. At HEAD, 0 of 38 rows carry \`properties\`, and the column is absent from
   WeaponReferenceSchema (:105-126) and EquipmentWeaponStatsSchema (:226-234). It must land on FOUR
   shapes or it never reaches the reader: those two schemas, the ETL emit (:549-559), and the
   catalog-to-inventory copy at apps/server/src/character-build.ts:1586 which today copies five
   weapon fields.
   THE ACCEPTANCE TEST: does weaponPropertiesOf (apps/server/src/equipment-derivation.ts:1044-1047)
   return a list containing "light" for a built character carrying a dagger? Establish this by
   reading the chain, or by a throwaway read-only script — never by regenerating a bundle.

Report each as a boolean with file:line evidence, and set safeToStart only if BOTH are true.
A false here stops the whole program; say plainly which one is missing and what is still owed.`,
  { label: 'gate:batch-0', phase: 'Gate', schema: GATE }
)

log(`batch-0 gate: masteryEtl=${gate && gate.masteryEtl} propertiesColumn=${gate && gate.propertiesColumn} safeToStart=${gate && gate.safeToStart}`)

if (!gate || !gate.safeToStart) {
  return {
    stopped: 'batch-0',
    reason: 'The mastery ETL and/or the properties column are not in place. The mastery program cannot start; its entire data basis is unowned.',
    gate,
  }
}

// ---------------------------------------------------------------------------------------------

phase('Seam')

const seam = await unitPipeline(UNITS.m0, 'Seam')
log(`M0 seam: done=${seam && seam.built && seam.built.done} review=${seam && seam.verdict && seam.verdict.verdict}`)

if (!seam || !seam.built || !seam.built.done || (seam.verdict && seam.verdict.verdict === 'fix-required')) {
  return {
    stopped: 'M0',
    reason: 'The dispatch seam did not land clean. Without it four on-hit units collide in one ~20-line hunk, and the dangerous resolution silently drops a branch.',
    seam,
  }
}

// ---------------------------------------------------------------------------------------------

phase('Behaviour')

// Four concurrent — the measured ceiling on this box. U36 and U37 each get a dedicated agent by
// the client's ruling; U34 is the cheap one and U35a is the long pole, so it starts here.
const behaviour = await parallel([
  () => unitPipeline(UNITS.u34, 'Behaviour'),
  () => unitPipeline(UNITS.u36, 'Behaviour'),
  () => unitPipeline(UNITS.u37, 'Behaviour'),
  () => unitPipeline(UNITS.u35a, 'Behaviour'),
])

const behaviourLive = behaviour.filter(Boolean)
const behaviourDone = behaviourLive.filter((r) => r.built && r.built.done)
log(`Behaviour: ${behaviourDone.length}/4 units reached the far end; ${behaviourLive.filter((r) => r.verdict && r.verdict.verdict === 'fix-required').length} need fixes`)

const lightLanded = behaviourLive.some((r) => r.unit === 'U35a' && r.built && r.built.done)

// ---------------------------------------------------------------------------------------------

phase('Blocked')

// Three units, each gated on something outside this program. They run concurrently with each other
// because they share no site after M0 — each adds its own handler and its own function.
const blockedWork = [
  () => unitPipeline(UNITS.m1, 'Blocked'),
  () => unitPipeline(UNITS.m2, 'Blocked'),
]
if (lightLanded) blockedWork.push(() => unitPipeline(UNITS.u35b, 'Blocked'))
else log('U35b (nick) not started: the Light-property extra attack did not land, so there is nothing for nick to move.')

const blocked = await parallel(blockedWork)
const blockedLive = blocked.filter(Boolean)
log(`Blocked batch: ${blockedLive.filter((r) => r.built && r.built.done).length}/${blockedWork.length} reached the far end`)

// ---------------------------------------------------------------------------------------------

phase('Closer')

const reached = [...behaviourLive, ...blockedLive].filter((r) => r.built && r.built.done).map((r) => r.unit)
const eightReach = ['U34', 'U35b', 'U36', 'U37', 'M1', 'M2'].every((id) => reached.includes(id))

log(`slugs reaching: ${reached.join(', ') || 'none'} — U38 gate ${eightReach ? 'OPEN' : 'CLOSED'}`)

let closer = null
if (eightReach) {
  closer = await unitPipeline(UNITS.u38, 'Closer')
  log(`U38: done=${closer && closer.built && closer.built.done} review=${closer && closer.verdict && closer.verdict.verdict}`)
} else {
  closer = {
    unit: 'U38',
    skipped: 'Not all eight slugs reach. Shipping the control now would offer a GM choices that do nothing — the exact failure this program closes.',
  }
}

return {
  gate,
  seam,
  behaviour: behaviourLive,
  blocked: blockedLive,
  closer,
  slugsReaching: reached,
  eightReach,
}

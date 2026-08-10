/**
 * The engine-and-vocabulary program — U17 through U33, executable form.
 *
 * Written against HEAD `6278e5a`; re-verified against HEAD `36b5a1f` on
 * `claude/feature-impl-program-exec-ekmevw` (PR #55 merged, batch 0 landed). The old
 * `claude/feature-implementations-intake-c5eyu1` branch is gone — do not look for it.
 *
 * Companion to `docs/product/plan-engine-program.md`, which carries the measurements, the four
 * parts of every unit, the far-end proofs, the two non-vacuity probes and the decisions.
 * This file carries only the ORDER and the CONCURRENCY, and it is the plan's claim that no two
 * agents in one phase open the same file — every `agent()` below lists the file set it holds.
 *
 * Reading rules for whoever runs this:
 *   - `pipeline(...)` is ONE agent working serially. Inside a pipeline an agent may hold the same
 *     file across its own units; that is why U29 and U26 are chained rather than split.
 *   - `parallel(...)` is up to FOUR agents at once, one worktree each. The ceiling is the box.
 *   - Barriers are avoided on purpose: a phase ends when its pipelines end.
 *   - Worktrees hard-link `node_modules` (`cp -al`). NEVER symlink it — POSIX resolves the symlink
 *     first, so a cross-package unit gets a green run that proves nothing about its own worktree.
 *   - Generated files are the parent's: `docs/api-reference.md`, `docs/app-map.md`,
 *     `docs/ai-ledger/current-state.md`, and `docs/product/vocabulary-parity-audit.md`.
 *
 * THREE CROSS-PROGRAM LOCKS. These cannot be enforced from inside this file, because the other two
 * programs schedule independently. They are stated here so the execution phase can hold them.
 *
 *   1. `apps/client/src/homebrew/RiderEditor.tsx` - the API program's lane beta puts four units in
 *      it and this program puts eight. THE TWO MUST NEVER BE IN FLIGHT TOGETHER. That covers every
 *      phase below except `e1` lanes A/B/D. R2 is what dissolves the lock, which is why D-ENGINE-2
 *      is a cross-program prerequisite rather than this program's convenience.
 *      Re-measured at HEAD: still 1365 lines, still one file, factory boundaries unchanged.
 *   2. `apps/client/src/homebrew/schemas.ts` - U21a sits at :863-869 (the `actions` section runs
 *      :862-870 and its withheld-keys comment :865-868), inside the API program's lane alpha
 *      (:813-884, the whole MONSTER_SCHEMA - re-verified: MONSTER_SCHEMA opens at :813 and closes
 *      at :884). U33's three notes sit at :312/:326/:393, inside lane gamma (:302-408; SPECIES_SCHEMA
 *      opens at :302, BACKGROUND_SCHEMA at :374); its fourth, :237, is in CLASS_SCHEMA and outside
 *      both. All six line numbers re-opened at HEAD and still exact. Both of mine SEQUENCE after
 *      their lane; neither is worth splitting.
 *   3. `apps/server/src/action-resolution.ts` - the mastery program's M0 seam refactor lands before
 *      U22 (phase e3), and U29 (phase e1) lands before M0 relaxes the one-target guard at :678
 *      (re-verified: `if (action.attack && targets.length !== 1) throw ...` is still exactly there).
 */

export const meta = {
  name: "engine-program",
  description:
    "U17-U33: the engine readers, the SRD vocabulary they read, and the homebrew controls that " +
    "author it. 19 units across six unit phases (plus a rulings phase and R2's solo prep), four " +
    "agents wide, ordered by three real dependencies and grouped so no two concurrent agents " +
    "share a file.",
  phases: [
    "decisions",
    "prep-r2",
    "e1-cheap-readers",
    "e2-projection-and-sheet",
    "e3-invariant-units",
    "e4-effects-and-picks",
    "e5-spell-filters",
    "closer-labelling"
  ]
};

/* ------------------------------------------------------------------ the two rulings ------ */

phase("decisions", () => {
  log("D-ENGINE-1 is already RULED (decision-log.md:59-61). Only D-ENGINE-2 is still open.");

  pipeline(
    agent("decision-d-engine-1", {
      title: "D-ENGINE-1 is already ruled - confirm and move on, do not re-litigate",
      alreadyRuled:
        "docs/ai-ledger/decision-log.md:59-61, 2026-08-10: 'U17's freeze is lifted: the Stage-4 " +
        "CONFIG freeze was documentation-only and Stage 4 is done. Delete the stale " +
        "magical-secrets row from CONFIG.bard.choices and author widensPicks through the overlay.' " +
        "That is option 1 of the plan's four. This agent is now a VERIFICATION step, not a ruling.",
      reads: [
        "docs/ai-ledger/decision-log.md",
        "docs/product/plan-engine-program.md#7",
        "packages/content-srd-5.2.1/scripts/build-class-bundle.ts",
        "packages/content-srd-5.2.1/scripts/class-mechanics/bard.ts",
        "packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts"
      ],
      verify:
        "The row to delete is still at build-class-bundle.ts:344 ({kind:'spell', choose:2, " +
        "fromCatalog:'bard-spells'} in CONFIG.bard.choices) and bard.magical-secrets still carries " +
        "a `choice` in classes.v1.json. Both re-confirmed at HEAD 36b5a1f. If either has moved, " +
        "say so before U17 opens the file.",
      writes: [],
      blocks: []
    }),
    agent("decision-d-engine-2", {
      title: "Rule on splitting RiderEditor.tsx - STILL OPEN, and it is the only one left",
      stillOpen:
        "Grep of decision-log.md for 'RiderEditor' at HEAD: zero hits. The 2026-08-10 rulings did " +
        "not cover it, so it is this program's to take, before phase e3.",
      reads: ["docs/product/plan-engine-program.md#7", "apps/client/src/homebrew/RiderEditor.tsx"],
      recommendation:
        "Option A - R2. Eight of nineteen units need a control in one 1365-line file, and the API " +
        "program's lane beta adds four more, so the file is contended ACROSS programs and the two " +
        "cannot run together without it. The split turns an eight-way bottleneck into a four-way " +
        "one plus three small ones, costs S-M, and changes no behaviour. Declining it is " +
        "legitimate and costs three extra phases here plus serialising against the API program.",
      writes: ["docs/ai-ledger/decision-log.md"],
      blocks: ["prep-r2"]
    })
  );
});

/* ------------------------------------------------------------------------- prep ---------- */

phase("prep-r2", () => {
  log("Solo and serial: R2 rewrites RiderEditor.tsx whole, so nothing may run beside it.");
  log("Skip this phase entirely if D-ENGINE-2 chose option B; the unit tables below still hold.");

  pipeline(
    agent("r2-split-rider-editor", {
      title: "Split RiderEditor.tsx by rider family behind an unchanged barrel",
      unit: "R2",
      size: "S-M",
      vocabulary: "none - this is a refactor, and R1 (4f4815d) is the precedent",
      holds: [
        "apps/client/src/homebrew/RiderEditor.tsx",
        "apps/client/src/play-vocabulary.test.ts"
      ],
      note:
        "play-vocabulary.test.ts:103-109 (first entry of the ALLOWED array opened at :102) pins a " +
        "(file, string) exemption for 'Kinds of creature' to RiderEditor.tsx and that file has a " +
        "dead-exemption check. Move the exemption with whenField in the same commit or the suite " +
        "goes red for a reason that reads like drift.",
      unchanged: [
        "riderFieldsForTest", "RIDER_FIELDS_FOR_TEST", "ITEM_RIDERS", "ALL_RIDERS",
        "modifierLabel", "triggerKindOf", "slugValidate", "grantRowsOf", "grantsFromRows",
        "attackReadout", "riderSummary"
      ],
      verify:
        "Behaviour-free: the whole existing suite passes untouched. No new test, no new " +
        "vocabulary, and the census is not edited."
    })
  );
});

/* --------------------------------------------------------------------- phase E1 ---------- */

phase("e1-cheap-readers", () => {
  log("Four lanes. Lane A opens with E0 because it makes U29's and U27's content non-vacuous.");

  parallel(
    pipeline(
      agent("e0-effect-rider-gate", {
        unit: "E0",
        size: "S",
        title: "The effect-side roll-mode collector must evaluate the rider's own `when`",
        holds: ["apps/server/src/action-resolution.ts"],
        theSite:
          "attackRollSources at :533; the two effect walks at :545-:559 run toRollModes and never " +
          "look at modifier.when, three lines under a comment (:542) claiming the general roll-mode " +
          "variant carries its own when. toRollModes has exactly two call sites in apps/server/src " +
          "(:547, :555), both here - so this is the whole blast radius.",
        alreadyDocumented:
          "class-mechanics/sorcerer.ts:61-73 names this bug in writing and declines to author " +
          "Innate Sorcery's advantage because of it. That comment moves with the fix.",
        farEnd: "A gated effect rider fires on the attack it names and not on the one it does not.",
        probes: {
          control: "n/a - a bug fix. Substitute: remove the authored `when` and both attacks gain it.",
          value: "Keep the gate and name the other attack kind; the far-end die does not change."
        }
      }),
      agent("u29-attack-kind-spell", {
        unit: "U29",
        size: "M",
        title: "`attack-kind-is: \"spell\"` - an action with a spellId is a spell attack",
        holds: [
          "apps/server/src/action-resolution.ts",
          "packages/content-srd-5.2.1/scripts/class-mechanics/sorcerer.ts"
        ],
        needsContent:
          "NOT a new record. Innate Sorcery already ships at sorcerer.ts:75-88 - a bonus action, " +
          "2/long-rest uses, a ten-round `grants` effect tagged innate-sorcery - with NO modifiers " +
          "array, because :61-73 declines to author one and names E0 and U29 as the two reasons. " +
          "U29 adds the rider to that shipped entry and deletes the two bullets that stop being " +
          "true. Sorcerer is generated, so the overlay add is clean. It does not wait on C7.",
        decideInUnit:
          "Whether attackKinds moves out of the single-target branch (:811-:822; the outer " +
          "riderFilters at :810 carries sourceItemId, damageTypes and spellId only) the way U4 " +
          "moved damageTypes. Answer it in writing and pin it; cleave will inherit the answer.",
        farEnd: "A rider gated on ['spell'] fires on a cantrip attack and not on a weapon swing.",
        probes: {
          control: "Remove Spell from the kinds options; the mirror file fails at the option list.",
          value: "Author ['melee'] instead; the cantrip loses the advantage. Assert on the die."
        }
      }),
      agent("u26-spell-attack-bonus", {
        unit: "U26",
        size: "M",
        title: "`spell-attack-bonus` reaches a spell attack roll",
        holds: ["apps/server/src/effective-actions.ts"],
        why: "It needs U29's 'is this a spell attack' predicate, so it follows in the same lane.",
        farEnd: "A spell attack roll that moved.",
        probes: {
          control: "Filter spell-attack-bonus out of MODIFIER_TYPES; hasControl fails.",
          value: "Set classId to a class the sheet does not hold; the to-hit does not move."
        }
      })
    ),

    pipeline(
      agent("u24-item-uses", {
        unit: "U24",
        size: "M",
        title: "The item's own `uses` block is read by something",
        holds: ["apps/server/src/equipment-derivation.ts"],
        farEnd:
          "Four ends: a rolled number, a spent counter, a refusal naming '1/short rest', and a " +
          "re-arm on a short rest.",
        probes: {
          control: "n/a - it ships. Substitute: remove `uses` from the mace; no counter appears.",
          value: "Set limit 99; the refusal never fires. Assert on the message."
        },
        watch:
          "rests.ts:76 and encounter.ts:30/:288 iterate effectiveActions, so the new uses re-arms " +
          "for free - but a `per: \"recharge\"` value now newly reaches the recharge roll."
      })
    ),

    pipeline(
      agent("u28-unarmored-shield", {
        unit: "U28",
        size: "L",
        title: "`unarmored-defense.allowShield`, and the shipped armorClassFromEquipment bug",
        holds: [
          "packages/rules-5e/src/character.ts",
          "apps/server/src/character-build.ts",
          "the modifiers region of apps/client/src/homebrew/RiderEditor.tsx"
        ],
        absorbs:
          "The live bug now logged at known-bugs.md:24-28 with U28 as its owner: " +
          "armorClassFromEquipment (packages/rules-5e/src/character.ts:76-84) returns non-null for " +
          "a shield alone (:80, :82-83), so character-build.ts:1624's " +
          "`equipmentAc ?? unarmoredAc ?? 10 + dex` short-circuits unarmoured defence. Reproduced " +
          "at HEAD, Barbarian CON 16 / DEX 14: AC 15 bare-handed, AC 14 holding a shield. Picking " +
          "up a shield makes the character WORSE.",
        alsoDeletes:
          "the `note: \"Not read yet.\"` on the allowShield row (RiderEditor.tsx:419), same commit",
        farEnd:
          "Four numbers in one test: Barbarian without shield, Barbarian with shield (+2 on top " +
          "of CON), Monk without shield, Monk with shield (unarmoured defence correctly lost).",
        probes: {
          control: "n/a. Substitute: flip Barbarian's allowShield to false; its shielded AC drops.",
          value: "Make the reader ignore allowShield; the Monk's shielded AC gains CON-equivalent."
        }
      })
    ),

    pipeline(
      agent("u32-death-save-riders", {
        unit: "U32",
        size: "S",
        title: "`on-death-save` + `roll-mode: death-save` reach the death-save roll",
        holds: ["apps/server/src/death-saves.ts"],
        needsContent: "a magic item that helps a dying character - the content program supplies it",
        farEnd: "A death save rolled 2d20kh1.",
        probes: {
          control: "Remove death-save from ROLL_MODE_ROLLS; the mirror file fails at the options.",
          value: "Author mode disadvantage; the formula is 2d20kl1. Assert on the formula."
        }
      })
    )
  );
});

/* --------------------------------------------------------------------- phase E2 ---------- */

phase("e2-projection-and-sheet", () => {
  log("The mastery program's M0 seam refactor must land by the end of this phase - see plan §10.");

  parallel(
    pipeline(
      agent("u27-roll-mode-check", {
        unit: "U27",
        size: "L",
        title: "`roll-mode: check` - an ability check rolled with advantage",
        holds: ["apps/server/src/action-resolution.ts"],
        dependsOn: ["E0"],
        why:
          "Re-baselined from M. There is no advantage machinery on the check path at all, and the " +
          "one SRD author is Barbarian's Rage, carried on an effect - so it needs E0's gate fix " +
          "AND effect-side roll-mode to be read for `check`, which today it is not anywhere.",
        farEnd:
          "A raging Barbarian's Strength check rolls 2d20kh1 and its Dexterity check rolls 1d20, " +
          "in the same test.",
        probes: {
          control: "Remove check from ROLL_MODE_ROLLS; the mirror file fails at the option list.",
          value: "Change the authored ability-is to dex; the Strength check rolls 1d20."
        }
      })
    ),

    pipeline(
      agent("u25-extra-damage-renders", {
        unit: "U25",
        size: "L",
        dedicated: true,
        viewerSafetyAudit: "blocking, before merge",
        title: "The extra damage resolves, renders, and does NOT land on the inventory row",
        holds: [
          "apps/server/src/equipment-derivation.ts",
          "apps/server/src/effective-actions.ts",
          "packages/schemas/src/index.ts",
          "apps/client/src/encounter/CharacterSheet.tsx"
        ],
        theLeak:
          "InventoryItemSchema's own `magic` field says 'NEVER the riders', and projections.ts " +
          "ships `inventory.map(item => ({...item}))` - a whole-row shallow spread under " +
          "resourcesVisible. extraDamage must ride the DERIVED action, never the stored row.",
        farEnd:
          "One resolution produces two typed entries with two totals, and the sheet prints two " +
          "lines BEFORE the roll for a freshly added, not-yet-equipped item.",
        probes: {
          control: "n/a. Substitute: remove the extra-damage rider; one line, one entry.",
          value: "Keep the rider and break its formula; the second entry's total is wrong."
        },
        audit:
          "Serialize a player projection for a character carrying a rider-bearing homebrew item; " +
          "assert the payload contains no rider text and no extraDamage key on any inventory row.",
        handToParent:
          "NOTHING. An earlier draft owed the parent a fix for current-state.md:54 ('Every field " +
          "the item editor offers reaches the fight'). That sentence was deleted by 1263e34 and " +
          "grep finds it nowhere in the file at HEAD. Do not re-add it to hand it back."
      })
    ),

    pipeline(
      agent("u19-pool-binding", {
        unit: "U19",
        size: "L",
        viewerSafetyAudit: "blocking, before merge",
        title: "The pool binding - a GM picks a pool instead of typing one from memory",
        holds: [
          "packages/domain/src/index.ts",
          "apps/server/src/content-library.ts",
          "apps/client/src/homebrew/useSchemaContext.ts",
          "apps/client/src/homebrew/schema.ts",
          "the uses and modifiers regions of apps/client/src/homebrew/RiderEditor.tsx",
          "apps/client/src/homebrew/vocabularies.test.ts"
        ],
        theProjection:
          "Pool ids do not cross the wire in the content catalog at all - ContentFeatureSummary " +
          "carries tags/choice/choices and no uses. Prefer `pool?: string` on the feature summary: " +
          "contentClasses/Subclasses/Species are already scoped through catalogFor(principal) -> " +
          "forAudience -> publishedFor(audience), so it inherits the gate rather than needing one.",
        doNot: "Add a refusal. An unmatched pool degrades to a private counter, which is already " +
          "the runtime behaviour, and a paladin's item on a fighter is a normal table event.",
        farEnd:
          "Two actions sharing channel-divinity, both authored through the picker: spend one and " +
          "the other action's remaining count drops.",
        probes: {
          control: "Remove pick/suggestions from uses.pool; the mirror file fails at the list.",
          value: "Write the pool id one character wrong; the second counter does not move."
        },
        serialization:
          "vocabularies.test.ts pins picks.length === 11 at HEAD. Measure the new number before " +
          "writing it - it depends on whether the two uses.pool sites are one factory."
      })
    ),

    pipeline(
      agent("u31-damage-reduction", {
        unit: "U31",
        size: "S",
        title: "`on-taking-damage` + `damage-reduction` - content and a stale-claim sweep",
        holds: ["the class-mechanics carrier the content program authored"],
        reScoped:
          "The governing plan's premise is false at HEAD. hit-points.ts damageReductionFor runs " +
          "both a standing and an on-taking-damage pass and sums damage-reduction; the " +
          "disposition table already names the function. Reader and control both ship.",
        alsoFixes:
          "vocabulary-parity-audit.md's two rows saying no incoming-damage path collects riders - " +
          "hand the correction to the API program, which regenerates that file.",
        farEnd:
          "The damage narration appends 'then -N, reduction' after the resistance step, per " +
          "total, floored at 0. Assert on that string and on the resulting HP.",
        probes: {
          control: "Remove damage-reduction from MODIFIER_TYPES; hasControl fails.",
          value: "Gate the rider on a damage type the hit does not deal; the HP is unchanged."
        }
      })
    )
  );
});

/* --------------------------------------------------------------------- phase E3 ---------- */

phase("e3-invariant-units", () => {
  log("U22 is the sharpest viewer-safety change in this program: it leaks by default, twice over.");

  parallel(
    pipeline(
      agent("u22-target-scoped-effects", {
        unit: "U22",
        size: "L",
        dedicated: true,
        viewerSafetyAudit: "blocking, before merge",
        dependsOn: ["E0", "mastery-program:M0"],
        title: "Target-scoped effects - advantage against ONE named foe",
        holds: [
          "apps/server/src/action-resolution.ts",
          "apps/server/src/projections.ts",
          "apps/server/src/effects.ts",
          "packages/schemas/src/index.ts",
          "packages/domain/src/index.ts",
          "the effects region of apps/client/src/homebrew/RiderEditor.tsx"
        ],
        twoLeakMechanisms: [
          "TYPE: PlayerEffect = Omit<EffectInstance, 'sourceActorId' | 'sourceActionId'>. A new " +
            "field joins the player type automatically and tsc says nothing.",
          "RUNTIME: playerEffect() destructures two keys and spreads the rest. A new field rides it."
        ],
        theRule:
          "sourceName is already masked to 'A hidden threat' for a non-public source. An id " +
          "cannot be masked - masking still confirms the secret exists - so the target id must be " +
          "OMITTED from the player projection and named in PlayerEffect's Omit list.",
        farEnd:
          "Two foes, one effect: the attack against the named foe rolls 2d20kh1 and the attack " +
          "against the other rolls 1d20, in the same test.",
        probes: {
          control: "Filter the row out of effectModifiersField; hasControl fails.",
          value: "Write the other foe's id; the advantage lands on the wrong attack."
        },
        audit:
          "A player projection for a table holding a gm-only monster must contain that monster's " +
          "id ZERO times. Assert on the serialized payload, not on a field name."
      })
    ),

    pipeline(
      agent("u20-weapon-swing-override", {
        unit: "U20",
        size: "XL",
        title: "The weapon-swing override - a Monk's quarterstaff rolls the Monk die off Dexterity",
        holds: [
          "apps/server/src/equipment-derivation.ts",
          "packages/content-srd-5.2.1/src/character-content.ts",
          "packages/content-srd-5.2.1/scripts/class-mechanics/monk.ts",
          "the modifiers region of apps/client/src/homebrew/RiderEditor.tsx"
        ],
        binding:
          "known-bugs.md says it in writing: the die goes on the definition or the class row " +
          "reachable from the derivation, NEVER a hard-coded 'if monk' in weaponAbilityModifier.",
        farEnd:
          "The rolled damage on the sheet's quarterstaff row moves from 1d6+1 to 1d8+2 for the " +
          "same character, and the to-hit moves with it.",
        probes: {
          control: "Remove the variant from MODIFIER_TYPES; hasControl fails.",
          value: "Author die 1d6 (the weapon's own); the printed formula is unchanged."
        },
        retires: "the [character-builder] Martial Arts clause in known-bugs.md"
      })
    ),

    pipeline(
      agent("u21a-multiattack-control", {
        unit: "U21a",
        size: "M",
        title: "The `multiattack` control - 126 SRD authors, a live reader, no way to author one",
        holds: [
          "apps/client/src/homebrew/schemas.ts",
          "the actions region of apps/client/src/homebrew/RiderEditor.tsx",
          "the census array in apps/client/src/homebrew/vocabulary-parity.mirror.test.ts"
        ],
        why:
          "The control's absence is deliberate and schemas.ts says why: a form without a composer " +
          "constrained to sibling action ids would author references that resolve to nothing. " +
          "This unit builds that composer.",
        farEnd:
          "Resolve two of three declared claws, then a fourth: the refusal reads 'has no Claw " +
          "left in this action - remaining: 1x Bite.' The template is at action-resolution.ts:295 " +
          "and that dash is a PLAIN HYPHEN; an assertion written with an em dash fails wrongly.",
        probes: {
          control: "Filter the composer out; hasControl('monster','multiattack',['actions']) fails.",
          value: "Point a component at a sibling id that does not exist; the refusal text is wrong."
        },
        census:
          "deletes its own row (vocabulary-parity.mirror.test.ts:3416); U17 deletes the adjacent " +
          "one at :3417 a phase later, never together",
        crossProgram:
          "schemas.ts:863-869 is inside the API program's lane alpha (:813-884, the whole " +
          "MONSTER_SCHEMA). Sequence after alpha; a single insert is cheaper to wait than to merge."
      })
    ),

    pipeline(
      agent("e3-mobile-and-qa", {
        title: "Mobile parity and QA back-fill over E1 and E2",
        holds: ["CSS and verification only - opens no source file another lane holds"],
        scope: [
          "375px touch pass over U19's pool pickers and U28's changed AC readout",
          "the hostile adversarial review the governing plan requires per batch: hunt " +
            "built-but-unwired mechanisms and vacuous tests, not general code style",
          "confirm each landed unit's two probes were actually run and reported with counts"
        ]
      })
    )
  );
});

/* --------------------------------------------------------------------- phase E4 ---------- */

phase("e4-effects-and-picks", () => {
  log("U18 is on the mastery program's critical path for `slow`. It must not slip past this phase.");

  parallel(
    pipeline(
      agent("u21b-bonus-action-pool", {
        unit: "U21b",
        size: "M",
        dependsOn: ["U21a"],
        title: "Bonus-action component pools - Flurry of Blows hands out two swings",
        holds: [
          "apps/server/src/action-resolution.ts",
          "packages/content-srd-5.2.1/scripts/class-mechanics/monk.ts"
        ],
        reBaselined:
          "Not 126 authors, and not 1. ZERO: all 126 multiattack authors are activation 'action', " +
          "and no SRD record anywhere authors a bonus action with a component pool. Flurry of " +
          "Blows is prose and must be AUTHORED by the content program.",
        invariant: "The onOwnTurn guard stays. Widening the economy must not widen who may act.",
        farEnd:
          "A Monk spends a Focus Point, resolves two Unarmed Strikes on the bonus action, and the " +
          "third is refused by name.",
        probes: {
          control: "n/a - U21a owns it. Substitute: remove the authored multiattack; one swing.",
          value: "Set the component count to 1; the second swing is refused."
        },
        retires: "the [rules-engine] Flurry of Blows clause in known-bugs.md"
      }),
      agent("u18-speed-effect-modifier", {
        unit: "U18",
        size: "M",
        title: "`speed` as an EFFECT modifier - and the read that makes it real",
        holds: [
          "apps/server/src/condition-rules.ts",
          "packages/schemas/src/index.ts",
          "the effects region of apps/client/src/homebrew/RiderEditor.tsx"
        ],
        threeParts:
          "The schema member AND the control AND the READ. effectiveSpeedFeet never touches " +
          "actor.effects[].modifiers, so shipping the first two alone produces exactly the " +
          "authored-and-inert row this program exists to close.",
        order:
          "base - 5x exhaustion, then + the summed effect modifiers, then floor at 0, then the " +
          "Speed-0 conditions, then x2 while Dashing. A Dashing slowed creature distinguishes it. " +
          "At HEAD effectiveSpeedFeet (condition-rules.ts:44-49) EARLY-RETURNS 0 on the Speed-0 " +
          "conditions at :46, ahead of the exhaustion maths at :47 - so this is a restructure, not " +
          "an inserted line.",
        constraint:
          "condition-rules.ts is a dependency-free leaf by its own header (:5-6). It may read " +
          "actor.effects; it must NOT import deriveEquipment.",
        alsoMeasured:
          "EquipmentDerivation.speed (equipment-derivation.ts:678) is computed and consumed by " +
          "NOTHING in production - the only two references are feat-riders.test.ts:408 and " +
          "feature-riders.test.ts:547, each asserting it is 0. Close the item path too, or label it.",
        farEnd:
          "movement-rules.ts:76 refuses with 'has N ft of movement left'. The number in that " +
          "message moves when the effect is applied and RETURNS when it ends.",
        probes: {
          control: "Filter speed out of EFFECT_MODIFIER_TYPES; hasControl on the effects nest fails.",
          value: "Author amount 0; the refusal quotes the unchanged budget."
        },
        unblocks: "mastery `slow` - 7 weapons, and it has no honest degraded form without this"
      })
    ),

    pipeline(
      agent("u17-widens-picks", {
        unit: "U17",
        size: "L",
        gatedOn: "decision-d-engine-1 - SATISFIED, ruled 2026-08-10 (decision-log.md:59-61)",
        title: "`widensPicks` - a budget whose SOURCE LIST grew, not whose capacity did",
        holds: [
          "apps/server/src/character-build.ts",
          "apps/client/src/homebrew/FeatureEditor.tsx",
          "packages/content-srd-5.2.1/scripts/build-class-bundle.ts",
          "packages/content-srd-5.2.1/scripts/class-mechanics/bard.ts",
          "packages/content-srd-5.2.1/scripts/class-mechanics/overlay.ts",
          "packages/content-srd-5.2.1/src/character-content.ts",
          "the census array in apps/client/src/homebrew/vocabulary-parity.mirror.test.ts",
          "apps/server/test/cleric-druid-bard-mechanics.test.ts"
        ],
        namespace:
          "widensPicks targets NAMED_PICK_BUDGET_KEYS - the SAME offer-key namespace extraPicks " +
          "and replaces use. Do not mint a second one; 83420fd already ruled against a narrower " +
          "second list for exactly this reason.",
        alsoWidens:
          "FeatureMechanics' Pick union in overlay.ts:78 - it is a Partial<Pick<FeatureInput, ...>> " +
          "over ten named keys and widensPicks is not one of them",
        theRuledShape:
          "Delete the row at build-class-bundle.ts:344 from CONFIG.bard.choices and author " +
          "widensPicks in bard.ts. Also move the pin at cleric-druid-bard-mechanics.test.ts:153-154, " +
          "which currently records two kind:'spell' picks under featureId:'magical-secrets'.",
        farEnd:
          "A prepared-spell budget whose SOURCE LIST grew - the same count of prepared spells, " +
          "drawn from Bard + Cleric + Druid + Wizard from level 10.",
        probes: {
          control: "Drop the widensPicks field from the choice panel; hasControl fails.",
          value: "Author addCatalogs []; the level-10 option list equals the level-9 one."
        }
      })
    ),

    pipeline(
      agent("e4-mobile-and-qa", {
        title: "Mobile parity and QA back-fill over E3",
        holds: ["CSS and verification only"],
        scope: [
          "375px touch pass over U20's new modifier variant and U21a's sibling-action composer",
          "re-run U22's viewer-safety audit against the merged tree, not the worktree",
          "the adversarial review: built-but-unwired mechanisms, and vacuous tests"
        ]
      })
    )
  );
});

/* --------------------------------------------------------------------- phase E5 ---------- */

phase("e5-spell-filters", () => {
  log("U23 and U30 share ONE SRD record (Empowered Evocation) and neither can land alone.");

  parallel(
    pipeline(
      agent("u23-u30-spell-filters", {
        unit: "U23+U30 (merged)",
        size: "L",
        title: "'Same type as the triggering damage', and the spell school/level filters",
        holds: [
          "apps/server/src/action-resolution.ts",
          "packages/schemas/src/index.ts",
          "apps/client/src/homebrew/validate.ts",
          "the modifiers region of apps/client/src/homebrew/RiderEditor.tsx",
          "apps/client/src/homebrew/vocabularies.test.ts"
        ],
        u23IsBiggerThanItLooks:
          "Logged at known-bugs.md:30-35 with this unit as owner. The reader's `?? damage[0].type` " +
          "fallback at action-resolution.ts:983 is UNREACHABLE: ExtraDamageVariantSchema.damageType " +
          "(packages/schemas/src/index.ts:205) is DamageTypeIdSchema - z.string().min(1).max(40) at " +
          ":7 - and required. Re-probed at HEAD: '' -> 'String must contain at least 1 " +
          "character(s)', absent -> 'Required'. Meanwhile RiderEditor.tsx:422-427 documents the " +
          "empty box as meaning 'inherit' and blankModifier (:320) seeds exactly that - so every " +
          "extra-damage row the editor mints is unpublishable, and validate.ts has no message for " +
          "it (only the spell one at :421 and the weapon one at :449-450 exist). Schema change, " +
          "control, message, content.",
        u30NeedsAReader:
          "RiderContext.spellSchool and .spellLevel (packages/rules-5e/src/riders.ts:142-143) are " +
          "evaluated by `passes` (:203, :205) and set by NOTHING. Both filters fail closed 100% of " +
          "the time. action-resolution.ts:800 already builds spellFilter from action.spellId and " +
          "both riderFilters branches (:810, :821) spread it; school and level are one catalog " +
          "lookup from there.",
        farEnd:
          "Empowered Evocation adds the Wizard's Intelligence modifier to an Evocation's damage, " +
          "typed as whatever that spell deals - Fire for Fireball, Lightning for Lightning Bolt - " +
          "and adds nothing to an Abjuration.",
        probes: {
          control: "Filter the 'same type' option out; the mirror file fails at the option list.",
          value: "Pin the type to 'fire'; Lightning Bolt's rider lands as Fire. Second pair for " +
            "U30: drop `schools` from the gate and the rider fires on the Abjuration too."
        }
      })
    ),

    pipeline(
      agent("e5-mobile-and-qa", {
        title: "Mobile parity and QA back-fill over E4",
        holds: ["CSS and verification only"],
        scope: [
          "375px touch pass over U18's effect-modifier row and U17's choice-panel row",
          "the adversarial review"
        ]
      })
    )
  );
});

/* ------------------------------------------------------------------- the closer ---------- */

phase("closer-labelling", () => {
  log("U33 runs alone and last: every one of its seven predecessors retires or keeps its own claim.");

  pipeline(
    agent("u33-labelling-sweep", {
      unit: "U33",
      size: "M",
      dependsOn: ["U26", "U27", "U28", "U29", "U30", "U31", "U32"],
      title: "The labelling sweep - and the mechanism it needs first",
      holds: [
        "apps/client/src/homebrew/schema.ts",
        "apps/client/src/homebrew/FieldRenderer.tsx",
        "every rider-field region"
      ],
      theMechanism:
        "SelectOption is {value, label, disabled?, group?} - no note - and FieldDef.note is a " +
        "plain string, not a function of the row. So there is NO way to say 'this OPTION parses " +
        "and does nothing' today. First commit: widen SelectOption with note?, render it beside " +
        "the option, then use it twice.",
      dropped: [
        "Deleting roll-mode: concentration from the enum. It is a closed z.enum, so removing a " +
          "member makes stored published homebrew stop PARSING in every catalog rather than " +
          "erroring loudly. Silent data loss.",
        "Removing featureRiders.tags from the wire. 44 SRD authors, measured, and it crosses as " +
          "ContentFeatureSummary.tags - a player-readable contract."
      ],
      kept: [
        "darkvision 'Display only' - true, there is no senses model",
        "sense 'Display only' - same reason; rendering it is a sheet feature with no vocabulary",
        "versus-creature-type 'Not checked yet' - closing it means promoting creature type to a " +
          "first-class ActorDefinition field",
        "two NEW option-level notes: roll-mode concentration, and the on-spell-cast moment"
      ],
      oneFalseClaimToFix:
        "effectsField says 'The sheet groups effects by these'. Measured, effect tags are a REAL " +
        "mechanical gate - while-effect-tag, requiresEffectTag, endsWithTag, dashing, disengaged, " +
        "grapple, hidden, readied. The copy UNDERSTATES a live mechanism.",
      oneThinClaimToFix:
        "tagsField's 'Grouping only - no mechanical effect' is correct for record-level tags. Say " +
        "the sheet does not group by them YET, and name the grouping as the sheet feature that " +
        "would make it true.",
      farEnd: "A rendered string - which the done bar explicitly admits for a labelling unit.",
      crossProgram:
        "Three of its four notes live in schemas.ts at :312/:326/:393, inside the API program's " +
        "lane gamma (:302-408). This is the closer, so waiting for gamma is nearly free. The " +
        "fourth note, :237, is in CLASS_SCHEMA and is outside both API lanes.",
      probes: {
        control: "Remove the note render from the select; the rendered-text assertion fails.",
        value: "Keep the render and blank the note string; the same assertion fails on the text."
      }
    })
  );

  log("Parent-only afterwards: npm run docs, the current-state.md entry, the decision-log entries.");
});

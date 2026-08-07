# Stage 4 — the work split, and the five design questions already answered

**Status:** the contract four parallel authoring lanes work to. Written by the Stage-4 enabling wave
(`9f31dd9`, `0983b60`, `15b5337`, `da3db21`). Every mechanical record and every row of
`docs/product/pre-stage-4-pick-promise-audit.md` belongs to exactly one lane. Read this, then your
lane's row, then the audit rows named there — nothing else.

---

## 1. Read this first: what changed under you

| Was | Is now |
|---|---|
| One overlay file holding all twelve classes | `scripts/class-mechanics/<class>.ts` — **one file per class**, composed by `index.ts` |
| The overlay reached the **nine generated** classes | It reaches **all twelve**; Cleric, Fighter and Wizard merge too |
| `FeatureMechanics` carried riders only | It also carries `choice`, `extraPicks`, and `options` (riders on an inline option) |
| `SUBCLASS_MECHANICS` was exported and never merged | The ETL merges it, fails the build on an unmatched key, and `parse`s every record |
| The subclass parser deleted `<table>` blocks | Tables are rendered into the description (7 features un-truncated) |
| `extraPicks.amount` was a flat 1–5 | `scaling: {type:"class-resource-growth", id}` reads a printed column |
| A record carried one `choice` | `choices` carries several; both read through `featurePicks` |
| `from` beat `fromCatalog` | Both together are a **union** (catalog **plus** one bespoke option) |

**Author in your own class file. Nothing else.** `build-class-bundle.ts`'s `CONFIG` is a shared file
and is now frozen for Stage 4: a new or changed `choice` goes in the overlay, which is where inline
`options` can be expressed at all. `applyMechanics` **refuses to overwrite** a value the record
already carries and fails the build naming both homes, so a double-authored `choice` cannot ship
silently.

### Which mechanism each of the twelve classes uses

| Class | Lane | Prose comes from | Riders/picks authored in | Notes |
|---|---|---|---|---|
| Barbarian | B1 | ETL, from `classes.md` | `class-mechanics/barbarian.ts` | Rage + Weapon Mastery growth already authored |
| Fighter | B1 | **`bundles/classes.v1.json`** (HAND_AUTHORED) | `class-mechanics/fighter.ts` | Weapon Mastery growth already authored |
| Monk | B1 | ETL | `class-mechanics/monk.ts` | empty |
| Rogue | B2 | ETL | `class-mechanics/rogue.ts` | empty |
| Ranger | B2 | ETL | `class-mechanics/ranger.ts` | Fighting Style (Druidic Warrior) already authored |
| Paladin | B2 | ETL | `class-mechanics/paladin.ts` | Fighting Style (Blessed Warrior) already authored |
| Cleric | B3 | **`bundles/classes.v1.json`** (HAND_AUTHORED) | `class-mechanics/cleric.ts` | Thaumaturge migrated out of the JSON |
| Druid | B3 | ETL | `class-mechanics/druid.ts` | empty |
| Bard | B3 | ETL | `class-mechanics/bard.ts` | empty |
| Warlock | B4 | ETL | `class-mechanics/warlock.ts` | Invocation growth already authored |
| Sorcerer | B4 | ETL | `class-mechanics/sorcerer.ts` | Draconic Resilience already authored |
| Wizard | B4 | **`bundles/classes.v1.json`** (HAND_AUTHORED) | `class-mechanics/wizard.ts` | empty |

**Subclasses follow their class.** Draconic Sorcery's riders live in `sorcerer.ts`, under
`subclasses: { "draconic-sorcery": { ... } }` — keyed on the SUBCLASS id, because that is the record
they land on.

> **One caveat, and it only bites the hand-authored three.** For Cleric, Fighter and Wizard the
> bundle is the ETL's own input *and* its output, so once an overlay entry has been written into
> `classes.v1.json` it stays there even if you delete the overlay entry. **Deleting a hand-authored
> rider means deleting it from `classes.v1.json` too, then re-running the build.** The nine generated
> classes are rebuilt from the markdown every run and have no such property.

**Feats, species, backgrounds have no ETL.** `bundles/feats.v1.json` is authored directly. Species
and lineages are a **confirmed zero** in the audit — 75 records nobody needs to touch.

---

## 2. The lanes

`npm run build-class-bundle -w @vtt/content-srd-5.2.1` after every edit; `npm run check` and
`npm run test` before calling anything done. Counts below are derived from the shipped bundle by
flattening every class feature, every inline option of a class feature, and every subclass feature.

| Lane | Classes | Records | Already mechanical | Remaining | Files this lane owns |
|---|---|---:|---:|---:|---|
| **B1** | Barbarian · Fighter · Monk | 70 | 9 | 61 | `class-mechanics/{barbarian,fighter,monk}.ts` |
| **B2** | Rogue · Ranger · Paladin | 69 | 0 | 69 | `class-mechanics/{rogue,ranger,paladin}.ts` |
| **B3** | Cleric · Druid · Bard | 57 | 10 | 47 | `class-mechanics/{cleric,druid,bard}.ts` |
| **B4** | Warlock · Sorcerer · Wizard | 85 | 4 | 81 | `class-mechanics/{warlock,sorcerer,wizard}.ts` |
| | **total** | **281** | **23** | **258** | |

"Already mechanical" counts a record carrying at least one of `actions`, `effects`, `modifiers`,
`grants`, `uses` or `extraPicks`. B2 reads zero even though Blessed Warrior and Druidic Warrior
landed this wave, because what those added is a `choice`, not a rider.

Per class: barbarian 23 · fighter 21 · monk 26 · rogue 23 · ranger 23 · paladin 23 · cleric 23 ·
druid 18 · bard 16 · warlock 45 · sorcerer 25 · wizard 15.

> **On the plan's "226".** `feature-implementations-plan.md` sizes Stage 4 at 242 records, 226
> remaining. That count predates this wave and is not re-derivable from the bundle; the 281/252 above
> is, by the method stated. The difference is inline options (the bundle carries 44, the plan's
> sub-stage table 41) and the records this wave made mechanical. **Scope is identical either way:**
> every class feature at levels 1–20, every inline option, every subclass feature. Use the scope, not
> the number.

**Each lane owns its classes' features at all levels 1–20, their inline options, their subclass, and
their rows in the audit.** No lane may edit another lane's class file, `CONFIG`, or the schema.

### Shared files — coordinate, do not race

`bundles/feats.v1.json` is one file and lane-neutral. **Feats are B3's**, as the lane with the
lightest class load; the other three lanes must not touch it. Exactly ONE feat row remains —
row 60, `skilled`'s "or tools" half, and it is `SPEC` (§5C). Rows 57–59 landed this wave (§4), and
row 24 is a Warlock class option, not a feat.

`src/character-content.ts`, `build-class-bundle.ts`, `class-mechanics/overlay.ts` and
`class-mechanics/index.ts` are **frozen for Stage 4**. A record that cannot be said in the current
vocabulary is a finding to report, not a schema edit to make in a content lane.

---

## 3. Every audit row, assigned

66 rows. `CLOSED` = done by this wave. `SPEC` = blocked on a design question specified in §5 and not
closable by authoring alone.

| Lane | Audit rows | Count |
|---|---|---:|
| **B1** | 2 `CLOSED`, 3 `CLOSED`, 20, and the Barbarian and Monk epic boons (2 of rows 6–14) | 5 |
| **B2** | 21, 22, 28, 30, 31, 32, 48 `CLOSED`, 49 `CLOSED`, 61 `SPEC`, 62 `SPEC`, and the Rogue, Ranger and Paladin epic boons (3 of rows 6–14) | 13 |
| **B3** | 4, 5, 19, 29 `SPEC`, 34, 35, 54 `SPEC`, 55 `SPEC`, 56 `SPEC`, 57–59 `CLOSED`, 60 `SPEC`, 63 `SPEC`, 64 `SPEC`, 65 `SPEC`, and the Bard and Druid epic boons (2 of rows 6–14) | 18 |
| **B4** | 1 `CLOSED`, 15–18, 23, 24, 25, 26, 27, 33, 36, 37–47 (11 invocations), 50 `SPEC`, 51–53 `SPEC`, 66 `SPEC`, and the Warlock and Sorcerer epic boons (2 of rows 6–14) | 30 |

Rows 6–14 are the nine missing Epic Boons, one per class, and each goes to that class's lane:
Barbarian and Monk to B1, Rogue, Ranger and Paladin to B2, Bard and Druid to B3, Warlock and
Sorcerer to B4. (Cleric, Fighter and Wizard already author theirs.)

Row-by-row, by class, so nothing is ambiguous:

- **Barbarian (B1):** 3 `CLOSED`, 6 (epic-boon), 20 (primal-knowledge → `extraPicks: [{offer:"class-skills", amount:1}]`).
- **Fighter (B1):** 2 `CLOSED`.
- **Monk (B1):** 6 (epic-boon).
- **Rogue (B2):** 6 (epic-boon), 62 `SPEC` (thieves-cant language pick).
- **Ranger (B2):** 6 (epic-boon), 21, 22 (Hunter subclass), 32 (favored-enemy), 49 `CLOSED`, 61 `SPEC` (deft-explorer languages).
- **Paladin (B2):** 6 (epic-boon), 28 (oath-of-devotion-spells), 30 (paladins-smite), 31 (faithful-steed), 48 `CLOSED`.
- **Cleric (B3):** 63 `SPEC` (improved-blessed-strikes).
- **Druid (B3):** 4 (primal-order), 5 (elemental-fury), 6 (epic-boon), 29 `SPEC` + 65 `SPEC` (Circle of the Land), 35 (druidic — the `grants.spells` half only; the language pick is `SPEC`), 54 `SPEC` (wild-shape), 64 `SPEC` (improved-elemental-fury).
- **Bard (B3):** 6 (epic-boon), 19 (college-of-lore bonus-proficiencies), 34 (words-of-creation), 55 `SPEC` (magical-secrets), 56 `SPEC` (magical-discoveries).
- **Feats (B3):** 57–59 `CLOSED`, 60 `SPEC` (skilled's tools half). Rows 6–14 are class features, not feats.
- **Warlock (B4):** 1 `CLOSED`, 6 (epic-boon), 15–18 (mystic arcanum — see §5H), 24, 25, 33, 36, 37–47, 27 (fiend-spells), 50 `SPEC`, 51–53 `SPEC`, 66 `SPEC`.
- **Sorcerer (B4):** 6 (epic-boon), 23 (elemental-affinity), 26 (draconic-spells).
- **Wizard (B4):** nothing — Wizard has no audit row.

**Closable by authoring alone: 51 of 66.** (43 the audit called cheap, plus the 8 this wave closed.)
**Not closable — blocked on a specified design question: 15** — rows 29, 50, 51, 52, 53, 54, 55, 56,
60, 61, 62, 63, 64, 65, 66.

---

## 4. What this wave already authored (do not redo)

| Row(s) | Record | What landed |
|---|---|---|
| 1 | `warlock` / `eldritch-invocations` | `extraPicks` with `class-resource-growth` — 1 → 10 |
| 2 | `fighter` / `weapon-mastery` | same — 3 → 6, on a HAND_AUTHORED class |
| 3 | `barbarian` / `weapon-mastery` | same — 2 → 4 |
| 48 | `paladin` / `fighting-style` | catalog **+** inline Blessed Warrior, with its two Cleric cantrips |
| 49 | `ranger` / `fighting-style` | same, Druidic Warrior |
| 57–59 | `magic-initiate-{cleric,druid,wizard}` | `choices` — the level-1 spell each one silently dropped |
| — | `draconic-sorcery` / `draconic-resilience` | `unarmored-defense` (CHA) — the subclass-overlay proof |
| — | `cleric` / `divine-order` → Thaumaturge | migrated from the bundle hand-edit into `cleric.ts` |

Also restored, not authored: the tables in `draconic-spells` (142 → 333 chars), `fiend-spells`
(206 → 427), `oath-of-devotion-spells` (226 → 509), `circle-of-the-land-spells` (273 → 816),
`natures-ward` (204 → 353), `druid.wild-shape` (2944 → 3111), `sorcerer.font-of-magic` (1161 → 1486).
**Rows 26–29 now have their spell lists in the prose** — the `grants.spells` half is still owed.

---

## 5. The five design questions, decided

The audit called the awkward 23 "five design questions wearing 23 costumes". Here is the ruling on
each. **Do not answer these a sixth way in a content lane.**

### A. Replacement — 33 clauses. **SPECIFIED, NOT BUILT. The largest thing here.**

*"On a level-up you can replace one of these cantrips"; "whenever you finish a Long Rest, change your
weapon masteries"; "choose one type of land ... whenever you finish a Long Rest".*

**Ruling: out of scope for Stage 4 content authoring. Author the base pick; leave the replacement
clause in the prose.** It is not a budget increase — it edits a row of `character.choices[]`, which
is the provenance ledger that level-up and respec are both built on, and it has three distinct
timings (build-time on level-up, long rest, short rest) with different persistence needs.

**The specification, for whoever builds it:**

1. **Vocabulary.** A new sibling of `extraPicks` on `FeatureRecord`/`FeatureOption`:
   `replaces: [{ offer: <PickBudgetKey>, when: "level-up" | "long-rest" | "short-rest", amount: 1 }]`.
   `offer` is the same offer key namespace, so there is no second vocabulary and the same loud
   "names no budget this build has" rejection applies.
2. **`when: "level-up"` is the only one that touches `character.create`.** It is a build-time
   permission: a ledger row for that offer may be stamped at a level above the one that first granted
   it, provided the count for that offer never exceeds its capacity. That is a relaxation of the
   existing `row.level > input.level` check plus a per-offer "at most `capacity` live rows" rule —
   the row that was replaced is **deleted from the ledger**, not tombstoned, because the ledger's job
   is to describe the character that exists.
3. **`when: "long-rest"` / `"short-rest"` are RUNTIME state, not build state.** They belong with
   `actor.actionUses` and the rest machinery (`rests.ts`), not with `character.choices[]`: a
   Barbarian re-choosing weapon masteries on a rest must not require a rebuild, and a GM must be able
   to see it happen mid-session. The right shape is a per-actor `choiceOverrides` map keyed by offer
   key, cleared on the matching rest, projected under the same gate as the sheet.
4. **Size.** (2) is small — one relaxation and one invariant, on a path that already exists. (3) is a
   new authoritative state field, a command, a projection field and a rest hook: **size it as its own
   area**, not as part of Stage 4.

**Consequence for the lanes:** every "you can replace…" sentence stays prose. That is correct under
ADR-0008 and it is the same call the shipped Rage record already makes for its 10-minute cap.

### B. Two picks on one record. **BUILT** (`15b5337`).

`choices: [...]` on `FeatureRecord` and `FeatureOption`, read through `featurePicks` by both
consumers. Author `choice` for one pick (the common case) and `choices` for several — never both.
Closes rows 57–59. **Available for row 50 (Pact of the Tome) and row 61 (Deft Explorer)**, both of
which still need something else as well (see D and C).

### C. Missing catalog families — `languages`, `tools`, creatures. **SPECIFIED, NOT BUILT.**

`packages/domain/src/catalog-choice.ts` resolves six families and none of these is one.

**The sharp one is languages, and the base case is worse than the two features that need it: no SRD
species or background declares `languageChoices`, so "Common plus two languages" — which Character
Creation owes every single character — is never offered to anyone.** That is a live content bug
independent of Stage 4 and it should be fixed first, in this order:

1. **Publish the language list as data.** The SRD's Standard and Rare language tables live only as
   prose inside `bundles/rules.v1.json`. They need a real `languages.v1.json` (id + name + which
   table) and a `loadLanguages()` beside `loadSkills()`.
2. **Add the `languages` family to `resolveCatalogChoice`**, exactly like `skills`.
3. **Give the base case its budget:** `languageChoices: { choose: 2, from: [] }` on the species or the
   background (the SRD puts it on the character, not either — decide once, write it down), which
   makes `species-languages` a real offer.
4. Only then are rows 61 (Deft Explorer) and 62 (Thieves' Cant) one `extraPicks` line each.

**Tools** (row 60, Skilled's "or tools" half) is the same three steps over a `tools.v1.json`.
**Creatures** (row 54, Wild Shape) needs more than a family: a CR ceiling and a "lacks a Fly Speed"
predicate, both of which are new filter vocabulary, and the count *and* the CR scale by level.
**Ruling for row 54: author Wild Shape's uses as a pool and leave the known-forms list prose**, which
is what `BUILD_PLAN`'s Stage 4 note already says ("Not expressible and not to be attempted").

### D. A catalog **plus** an inline option. **BUILT** (`da3db21`).

Both consumers union `from`/`options` with `fromCatalog` when both are authored. Closes rows 48 and
49. Note that a feat-kinded pick may now be answered with an inline option, which pass A interprets
through the same `optionAsFeature` path pass A2 uses.

**Row 50 (Pact of the Tome) is still blocked**, on two other things: there is no catalog slug meaning
"every class's spell list", and there is no way to filter on the Ritual tag. **Ruling: author the
three cantrips (`choices` + `fromCatalog: "warlock-spells"`) and leave the two ritual spells prose**,
with a comment naming this section. A cross-list slug is a `SpellListReference` overlay
(`basedOn: [...]`) which today is a homebrew-merge path an SRD bundle record cannot point at; making
it one is its own change.

### E. A pick over the character's own prior answers. **SPECIFIED, NOT BUILT. Rows 51–53.**

Agonizing Blast, Eldritch Spear, Repelling Blast: *"choose one of your known Warlock cantrips that
deals damage"*. The option list is the ledger itself, plus a predicate over the chosen spells.

**Specification:** a third source alongside `from`/`fromCatalog`:
`fromPicks: { offer: <PickBudgetKey>, where?: "deals-damage" | "attack-roll" | "ranged" }`. It
resolves at pick time against the answers already recorded for that offer, on both sides, and it must
resolve to a non-empty list or defer (the same treatment `unresolvable` already gets). The predicate
is a **closed slug list**, never an expression (ADR-0008). Ordering is the hard part: the offer it
reads must be settled before the offer it feeds, which is a fourth pass in `buildCharacterDefinition`
and a step-order constraint in the wizard.

**Ruling for the lanes: author the invocations' riders where they exist independently of the pick
(Agonizing Blast's `extra-damage` rider is already shipped and proven) and leave the "choose which
cantrip" half prose.**

### F. A rider conditioned on an earlier choice. **SPECIFIED, NOT BUILT. Rows 63, 64, 65.**

Improved Blessed Strikes, Improved Elemental Fury, Nature's Ward: *"the option you chose ... grows
more powerful"*.

**Specification, and it is cheap:** these are inline `options` on the later feature, gated on the
earlier answer — `choice.options[].requires: { offer: <PickBudgetKey>, id: <optionId> }`. The offer
machinery filters an option out when the gate is unmet, which makes a one-option choice
auto-resolving. **Not built because the "auto-resolve a choice with exactly one legal option" rule is
new UI behaviour**, and a player being shown a pick with one card is worse than the prose they have
today. Size: small on the server, a real decision on the client.

**Ruling for the lanes: leave 63/64/65 prose.**

### G. Level-scaled pick capacity. **BUILT** (`15b5337`).

`extraPicks[].scaling = {type: "class-resource-growth", id}` reads the printed column and yields its
growth above its first printed value, so `choose + growth` is the printed number at every level. Rows
1–3 closed. **This is the shape to reach for whenever a budget "grows as shown in the X column".**
It needs no carrier feature at the levels the column steps, which is why it works where repeat grants
cannot.

### H. Exact spell level, not a ceiling. **NOT BUILT — one line, and it is the lanes' call.**

`maxSpellLevel` has no `minSpellLevel` sibling, so Mystic Arcanum authored as-is would let a level-11
Warlock take a level-3 spell as their level-6 arcanum. **Ruling: author rows 15–18 anyway**, with
`maxSpellLevel` set to the arcanum's level, and open a one-line follow-up for `minSpellLevel`
(schema + the same two consumers that already read `maxSpellLevel`, `character-build.ts` `matchRow`
and `build-payload.ts` `featurePickOffer`). An arcanum a player can pick slightly wrong is strictly
better than an arcanum they cannot pick at all, and the follow-up is genuinely small.

---

## 6. The bar every lane is held to

- **A test proves a number, a spent counter, a refusal, or rendered text.** "It typechecks" is the
  failure mode this whole area exists to end — see the `2e` correction in the plan.
- **Prove new content non-vacuously.** Disable it, run the tests, report how many fail.
- **The census test (`2992ee2`) fails on any authored `extraPicks` key that resolves to nothing.**
  Keep it passing; extend it if you add vocabulary.
- **An unmatched overlay key fails the build**, and so does a key that would overwrite a value the
  record already carries. Both name the two homes; fix the authoring, never the guard.
- `npm run check` exit 0 · `npm run test` with no file lost · `git diff -- bundles/` reviewed, never
  hand-edited.

# The API parity program

**Written 2026-08-10 against HEAD `6278e5a` on `claude/feature-implementations-intake-c5eyu1`.**
Governed by [`remaining-program-plan.md`](remaining-program-plan.md) — that document's twenty client
rulings, batch order, serialization points and verification bar bind everything here. This plan owns
**batch 2 (the parity guard)** and **ruling 9 (close every API bucket; fix all three API defects)**.

**Every count and every `file:line` below was measured against this HEAD**, not carried forward.
Where a measurement contradicts the governing plan it is called out under
[§8](#8-what-i-measured-that-contradicts-the-governing-plan) rather than quietly corrected.

---

## 1. What this program is, in one paragraph

An HTTP caller can author capabilities that move the engine and that a GM using `/homebrew` cannot
reach. Nothing measures the asymmetry: there IS a Zod↔OpenAPI parity gate
(`packages/api-contract/test/contract-parity.test.ts`) so a key the *editor* writes must be
documented, but **the reverse is unguarded**. This program builds the guard first, then closes the
buckets that have real SRD authors, then fixes the three correctness/documentation defects in
`remaining-program-plan.md` §4.

Every unit is held to the same four-part contract as waves 0–2 — **an engine reader + SRD content
authoring it + a homebrew editor control + a test through BOTH paths** — and to the done bar: an
engine-outcome far end, non-vacuity probes at **both** control and value level, and a 375px touch
pass for anything with UI.

---

## 2. The parity guard (unit A1) — how it actually works

This is the crux, so it gets its own section. The client ruled the guard must be an **HTTP
round-trip**: post a body over the API, assert the editor can reproduce it.

### 2.1 Where it lives

**Two new files in `apps/client/src/homebrew/`:** the guard itself, `api-parity.mirror.test.ts`, and a
sibling helper `api-parity-harness.ts` (the `authoring-harness.ts` precedent: helpers live in `src/`,
free of `vitest`, so `src` can import them).

Three reasons, all verified:

- `apps/client/vitest.config.ts` declares a second **`node`** project whose `include` is
  `src/**/*.mirror.test.ts`, environment `node`, no setup file. Its own docblock states the purpose:
  *"these tests import the SERVER's own modules … the server's store reaches for `node:sqlite`, which
  vite refuses to bundle for a browser-shaped environment."* `HomebrewStore` imports exactly
  `node:sqlite` (`apps/server/src/homebrew-store.ts:3`), a Node builtin — no dependency needed.
- `apps/client/src/builder/server-offers.mirror.test.ts` is the precedent for importing server
  modules by relative path; `vocabulary-parity.mirror.test.ts:65-71` already imports eight of them.
- **It must NOT go inside `vocabulary-parity.mirror.test.ts`.** That file's `unauthorable` census
  array is a named serialization point for ten units (governing plan §5). A guard living there would
  collide with every one of them. This program therefore **never touches that file** — see §6.

### 2.2 The three tests

**T1 — the census (structural, exhaustive).** Walk the nine `HOMEBREW_BODY_SCHEMAS`
(`packages/content-srd-5.2.1/src/schemas.ts:399-409`) recursively into an address set, canonicalise
each address into an editor address, ask `hasControl(type, key, within)`, and assert the uncovered
set equals the exemption table **exactly, in both directions** — the discipline the existing census
already uses (`vocabulary-parity.mirror.test.ts:3402-3422`). Each exemption row carries a `reason`
and an `owner` (a unit id, or `permanent:` plus why).

**T2 — the round trip (behavioural).** For every covered address group:

1. **Boot the real router.** `express()` → `createHomebrewRouter({ store: new HomebrewStore(<tmpdir>),
   authorizeGm, authorizePlayer, notifyChanged, validate: createHomebrewValidator(…), catalogRecord })`
   → `server.listen(0, "127.0.0.1")`. This is `apps/server/test/homebrew-http.test.ts:34-67` lifted
   verbatim into `api-parity-harness.ts`. **One fixture per file, in `beforeAll`** — `ContentLibrary`
   loads the whole SRD bundle (`monsters.v1.json` 951 KB + `spells.v1.json` 565 KB) and per-test boot
   would dominate the run.
2. `POST /api/v1/homebrew/content` with `{ record: <the API body carrying the field> }` → **201**.
3. `POST …/{id}/publish` → **200**. This is what makes the round trip stronger than a Zod parse: it
   runs the real four-tier gate in `apps/server/src/homebrew-validate.ts`, identity and referential
   tiers included.
4. `GET …/{id}` → read `data.record.record`: the server's **stored, normalised** body.
5. Rebuild the same record through the editor — `authored(…)` / `authoredRow(…)` from
   `authoring-harness.ts`, which throws on any key with no control — then `storedBody(type, draft, id)`.
6. **Assert the two bodies are deep-equal**, after stripping the row-forced keys the server stamps
   (`type`, `id`, and a monster's `source.externalId`; `normalizeBody`,
   `apps/server/src/homebrew-store.ts:791-800`).

Step 6 is the whole point. The assertion is not *"a control exists"* but *"the editor produces the
record the API stored, field for field"*, and a failure names the differing path.

**Why the round trip is strictly stronger than the census, stated once:** the census sees KEYS; the
round trip sees VALUES. The standing warning at the head of `vocabulary-parity.mirror.test.ts` is the
worked example — `uses.scaling.type` always had a control while `class-resource` stayed unauthorable,
for want of an *option* on that control. No key census could have seen it; a value round trip does.

**T3 — the guard's own non-vacuity.** Two negative cases, built locally rather than by editing the
real tables: (a) an address removed from the exemption table with no control must make T1 fail naming
that address; (b) a body whose value the editor cannot reproduce must make T2 fail at the differing
path. Asserted in the file, so the guard cannot rot into a green no-op.

### 2.3 The hard part: address canonicalisation

**Measured, and this is where the unit's weight is.** A naive walk of the nine schemas yields
**162 distinct object schemas carrying 708 declared keys**; expanded per type into
`(type, container-chain, key)` addresses it yields **3,806 asked addresses, of which a naive lookup
calls 3,341 missing**. Almost all of that is noise, because **the editor's scope model is not
isomorphic to the Zod path**. Three measured causes:

| cause | example | rule |
| --- | --- | --- |
| **Container keys have no `FieldDef`.** A `group` renders its children as dotted keys at the parent's scope; the group key itself is sometimes a field and sometimes not. | `hitPoints`, `token.footprint`, `uses.scaling` | Ask **leaf** keys. Ask a container only when it is a `rows` field. |
| **Riders are mounted at record scope, not where the schema hangs them.** `fieldsOf` appends `riderFieldsForTest(scope)` at the top level, so `ActionSchema`'s keys answer at `["actions"]` — never at `["features","actions"]`. | `hasControl("class","uses.limit",["actions"])` is `true`; `["features","actions"]` throws. | Restart the chain at the last rider segment (`actions`, `effects`, `modifiers`, `uses`, `grants`, `tags`). |
| **System-forced keys are never authored by hand.** | `id`, `source`, `schemaId`, `schemaVersion`, `source.*`, the wire-only `type` | A standing, reasoned exemption block. |

With those three rules applied by *probing an ordered candidate list* rather than by a hardcoded
table, the same walk gives **1,108 uncovered addresses over 223 distinct key names**. That is still
not a defect list — it is the guard's raw output before exemptions — but it is the honest starting
point, and every remaining false positive must be named in the exemption table with a reason.

**The canonicaliser is the fragile part and must fail loudly.** Every rewrite rule is *validated*:
if a rewrite produces a container that `fieldsWithin` cannot resolve, the guard throws rather than
silently widening the exemption set. A stale rule is a red build, never a quiet pass.

### 2.4 The guard's structural blind spot — and why B0 exists

**`ActorDefinitionSchema.extensions` is `z.record(z.string(), z.unknown())`
(`packages/schemas/src/index.ts:865`).** A schema walk finds *no addresses inside it*. That is
precisely where the sharpest gap in the whole program lives: **all 330 SRD monsters carry
`extensions["open5e.srd-2024"].savingThrows`, and `apps/server/src/saving-throws.ts:125-129` reads
it.** The guard cannot see the field it most needs to see.

So the guard takes a second, **hand-declared input**: the statblock extension contract — the keys
consumers really read out of the bag — enumerated once, in one place, and held to the bundle by a
test. That declaration is unit **B0**, and it is a prerequisite of B1–B4 rather than part of A1.

### 2.5 Cost and risk, named rather than discovered

- **`express` and `@types/express` must be declared in `apps/client`'s `devDependencies`.** Both are
  hoisted to the root today (measured: `node_modules/express` 5.2.1, `node_modules/@types/express`),
  so runtime resolution already works — `vocabulary-parity.mirror.test.ts` relies on the same
  hoisting for `@vtt/schemas`. `tsc -b` on `apps/client` needs `@types/express` visible. Declare
  both; do not rely on hoisting for a third-party runtime dependency.
- **The guard binds an ephemeral port and writes a temp SQLite file.** Every listen in the repo is
  already `listen(0, …)` (verified: no fixed-port listen exists in `apps/server/test` or
  `server.ts`), so there is no collision — but the governing plan's *"at most 2 concurrent full
  suites"* rule now applies to the **client** suite too, not only the server's. Record that.
- **Fold in one live known bug, and only one.** `docs/ai-ledger/known-bugs.md:127-131` records that
  `apps/server/test/homebrew-http.test.ts`'s per-path mount probe is vacuous — it asserts headers
  that come back for *any* path. A1 is the unit about tests that prove nothing, it mounts the real
  router, and the Codex equivalent already reads Express's route table. One targeted fix, cited in
  the commit; nothing else in that file.

---

## 3. The units

Eighteen units. **4 S · 10 M · 3 L · 1 XL.** Every one names its four parts.

### A — the guard (serial; nothing else starts until it lands)

#### A1 · the HTTP round-trip parity guard · **XL**

| part | what |
| --- | --- |
| engine reader | *n/a — this unit IS the guard.* |
| SRD content | *n/a.* |
| editor control | *n/a.* |
| both-paths test | new: `api-parity.mirror.test.ts` in `apps/client/src/homebrew/` (§2). |

- **Far-end proof:** a red `npm run test` when a schema field an API caller can author has no editor
  control and no exemption. Demonstrated by T3's constructed failure, with the exact message.
- **Non-vacuity (control):** delete one exemption row whose address has no control → T1 fails naming
  that address; restore.
- **Non-vacuity (value):** keep every control, mangle one field's `write` so the editor body differs
  from the stored body by one key → T2 fails at that path; restore.
- **375px:** no UI.
- **Serialization points touched:** none of the listed ones. Adds two devDependencies to
  `apps/client/package.json`.

### B — the monster statblock bag (`apps/client/src/homebrew/schemas.ts`, `MONSTER_SCHEMA` region, lines 813-884)

#### B0 · declare the statblock extension contract · **S**

Today `statblockFacts` (`apps/server/src/content-library.ts:314-325`) declares exactly two bag keys,
`challengeRating` and `type`. Seventeen are shipped. B0 declares the full vocabulary once, beside
`STATBLOCK_EXTENSION` (`content-library.ts:305`), and a test re-derives it from
`packages/content-srd-5.2.1/bundles/monsters.v1.json` — the discipline
`packages/content-srd-5.2.1/test/enums.test.ts` already uses for the six enumerated lists.

Measured, all 330 rows, key present on every row:

| key | rows with a non-empty value | reader |
| --- | --- | --- |
| `savingThrows` | **330** (≥1 numeric entry) | `apps/server/src/saving-throws.ts:127` |
| `speeds` | **330** (197 with a non-walk mode) | `apps/client/src/encounter/CharacterSheet.tsx:443-445, 628` |
| `alignment` | **330** | `CharacterSheet.tsx:844` |
| `passivePerception` | **330** | `CharacterSheet.tsx:659-660` |
| `type`, `challengeRating` | **330** | `content-library.ts:314-325` (already controlled) |
| `senses` | **252** | `CharacterSheet.tsx:659` |
| `traits` | **204** | `CharacterSheet.tsx:754-755` |
| `languages` | **200** | `CharacterSheet.tsx:661` |
| `armorDetail` | **329** | `CharacterSheet.tsx:626` (the AC tooltip) |
| `damageResistances` / `damageImmunities` / `conditionImmunities` (prose mirrors) | 53 / 124 / 75 | `CharacterSheet.tsx:661-664` — **excluded, see §4** |
| `damageVulnerabilities` | **0** | — **excluded** |
| `nonmagicalAttackImmunity` / `nonmagicalAttackResistance` | **0 true** | *no reader anywhere* — **excluded** |
| `experiencePoints` | **1** | *no reader anywhere* — **excluded** |

- **Far-end proof:** the guard's T1 now enumerates the bag; removing a declared key from the
  declaration makes the bundle-derivation test fail naming the key and the count.
- **Non-vacuity (control):** drop one key from the declaration → the derivation test fails.
- **Non-vacuity (value):** change one key's declared name by one character → the same test fails
  with the near-miss.
- **375px:** no UI.

#### B1 · a monster's saving throws · **M** — *the sharpest single case in the program*

| part | what |
| --- | --- |
| engine reader | `saveModifierFor`, `apps/server/src/saving-throws.ts:115-131`, **rung 3** |
| SRD content | **330 of 330** monster rows author `savingThrows` with ≥1 numeric entry |
| editor control | six number inputs in the Defences section, written through the extension-bag `write` (`schemas.ts:801-811`) — which today writes ONE key and must learn a nested object |
| both-paths test | new: `monster-defences.mirror.test.ts` in `apps/client/src/homebrew/` |

**The trap, and it is the reason this unit is M rather than S.** `saveModifierFor` reads the
extension bag **only when `definition.proficiencies` is absent** (`saving-throws.ts:117-124`, in as
many words: *"A sheet that records proficiencies is authoritative for itself"*). Writing the
"obvious" typed field `proficiencies.saves` would make a homebrew monster's saves resolve by a
**different rung** from every one of the 330 SRD monsters — proficiency-bonus arithmetic instead of
the printed total. The control must write the bag. `proficiencies` on a monster has **0 SRD
authors** and is excluded (§4).

- **Far-end proof:** a GM-forced save on a homebrew boss, seeded die = 7, authored `savingThrows.int
  = 8` → total **15**, succeeds against DC 15. Same body with the field stripped → INT 18 gives +4 →
  total **11**, fails. Both outcomes asserted, and the SRD half runs the identical body over the
  Aboleth (`savingThrows.int = 8`).
- **Non-vacuity (control):** remove the field from `MONSTER_SCHEMA` → `applyField` throws
  `No field "savingThrows" in the monster form …`.
- **Non-vacuity (value):** keep the control, change the authored 8 to 0 → the far-end total moves
  15 → 7 and the assertion fails.
- **375px:** yes — six new number inputs.

#### B2 · a monster's printed header: senses, passive Perception, languages, alignment · **M**

| part | what |
| --- | --- |
| engine reader | `CharacterSheet.tsx:659-661` (senses + passive Perception, languages) and `:844` (alignment, in the identity line) |
| SRD content | senses **252**, passivePerception **330**, languages **200**, alignment **330** |
| editor control | four extension-bag fields in the Identity section |
| both-paths test | new: `monster-header.mirror.test.ts` in `apps/client/src/homebrew/` |

**Ruling on the far end.** The bar allows *"a rendered string"*. To reach it from the node mirror
project, extract the sheet's two derivations — the senses line and the identity line — into one pure
module — a new `statblock-header.ts` in `apps/client/src/encounter/` — that `CharacterSheet.tsx` then calls, and make
the far end that module's output driven from both paths. A single added assertion in the existing
`CharacterSheet` DOM test proves the component still calls it. This is the same *one shared
computation, never two descriptions* discipline that moved `HOMEBREW_BODY_SCHEMAS` into the content
package; it is not an extra abstraction invented for a test.

- **Far end:** `"Large aberration, lawful evil · CR 10"` and `"darkvision 120 ft.; passive Perception 20"`
  from both paths, character for character.
- **Non-vacuity (control):** remove `alignment` → `applyField` throws.
- **Non-vacuity (value):** author `alignment: "chaotic good"` → the identity line changes and the
  pinned string fails.
- **375px:** yes.

#### B3 · a monster's movement modes · **M**

| part | what |
| --- | --- |
| engine reader | `CharacterSheet.tsx:443-445` → the Speed vital at `:628` |
| SRD content | **330** rows carry `speeds`; **197** carry a non-walk mode (fly 107, swim 63, climb 51, burrow 21, hover 16) |
| editor control | a five-number + one-checkbox group in the Identity section |
| both-paths test | new: `monster-speeds.mirror.test.ts` in `apps/client/src/homebrew/` |

**The trap.** The reader is `extension.speeds ? <derive from the bag> : <definition.speedFeet>`. A
monster that authors `speeds.fly` but leaves `speeds.walk` empty renders **only** the fly line — the
walking speed the GM typed into the existing `speedFeet` control silently disappears from the sheet.
The control must seed the whole container the first time any member is touched, the pattern
`apps/client/src/homebrew/defaults.ts` already uses for the weapon/armor blocks.

- **Far end:** `"10 ft., swim 40 ft."` (Aboleth) and, for the hover case, `"fly 60 ft. (hover)"`.
- **Non-vacuity (control):** remove the `speeds.swim` field → throws.
- **Non-vacuity (value):** set `speeds.walk` to 0 → the line loses its first clause and the
  assertion fails.
- **375px:** yes.

#### B4 · a monster's traits · **M**

| part | what |
| --- | --- |
| engine reader | `CharacterSheet.tsx:754-755` — a Traits section, rendered through `RichText` |
| SRD content | **204 of 330** rows carry a non-empty `traits` array |
| editor control | a `rows` field (name + description) in a new Traits section |
| both-paths test | new: `monster-traits.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** the Aboleth's five traits and a homebrew monster's authored trait both render as
  `"<name>. <description>"` through the same shared formatter B2 introduces.
- **Non-vacuity (control):** remove the row field → `authoredRow` throws
  `Field "traits" in the monster form mints no rows.`
- **Non-vacuity (value):** blank the description → the rendered entry loses its body and fails.
- **375px:** yes — a repeatable rows editor with a textarea, the densest new control in B.
- **Viewer-safety read (not a full audit):** traits are free prose on a stat block. The stat block
  reaches a client only through `content:monster-sheet`, which is GM-gated at
  `CharacterSheet.tsx:433` (`if (role !== "gm" …) return`). Confirm that line still holds; no
  projection changes.

### C — an action's advanced fields (`apps/client/src/homebrew/RiderEditor.tsx`, `actionsField` at :723)

Today `actionsField` offers exactly `name · activation · description · damage · attack · save · uses`
(verified by probe: a monster action row's fields are
`name, activation, description, damage, attack, attack.bonus, attack.reachFeet, attack.rangeFeet,
attack.rangeNormalFeet, save, save.ability, save.dc, uses, uses.limit, uses.per, uses.recharge, uses.pool`).

#### C1 · a hit that lands a condition (`onHit`) · **M**

| part | what |
| --- | --- |
| engine reader | `apps/server/src/action-resolution.ts:1010-1013` |
| SRD content | **47** monster actions author `onHit` |
| editor control | a rows field on the action row: conditions (pick-list), `escapeDc`, `maxTargetSize` |
| both-paths test | new: `action-onhit.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** the Aboleth's Tentacle hits and the target really carries `grappled` with escape DC
  **14**; the homebrew twin reaches the same condition on the same target.
- **Non-vacuity (control):** remove the field → `authoredRow` throws for `["actions","onHit"]`.
- **Non-vacuity (value):** change `escapeDc` 14 → 20 and the far-end assertion on the applied
  condition fails.
- **375px:** yes.

#### C2 · a legendary action's cost · **S**

| part | what |
| --- | --- |
| engine reader | `action-resolution.ts:311-313` (spends from the per-round pool), `tap-routing.ts:51` (exempt from the turn gate), client `encounter/ActionRunner.tsx:41, 52-55` |
| SRD content | **82** monster actions across **32** rows author `legendary.cost` |
| editor control | one number on the action row, paired with the existing `legendary.actionsPerRound` on the record |
| both-paths test | new: `action-legendary.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** with `actionsPerRound: 3`, three cost-1 legendary actions resolve on other creatures'
  turns and the fourth is refused, naming the empty pool.
- **Non-vacuity (control):** remove the field → throws.
- **Non-vacuity (value):** cost 1 → 3 and the *second* use is refused instead of the fourth.
- **375px:** yes (one number).

#### C3 · damage that grows with level (`damageByLevel`) · **S**

| part | what |
| --- | --- |
| engine reader | `apps/server/src/character-build.ts:339, 362-367` |
| SRD content | **15** actions: cleric `divine-spark` + `divine-strike`, druid `primal-strike`, rogue `sneak-attack`, subclass `circle-of-the-land/lands-aid`, and the dragonborn breath weapon on all **10** lineages |
| editor control | a rows field (level, formula, type) on a **feature-carrier** action row only — the same `scope !== "statblock"` split `toHitFields` already makes (`RiderEditor.tsx:624-627`), because `ActionSchema` on a stat block has no `damageByLevel` |
| both-paths test | new: `action-damage-by-level.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** the same authored line builds a rogue whose Sneak Attack rolls **1d6** at level 1 and
  **3d6** at level 5, with no content record changing between the two builds.
- **Non-vacuity (control):** remove the field → throws.
- **Non-vacuity (value):** delete the level-5 row → the level-5 build falls back to 1d6 and fails.
- **375px:** yes.

#### C4 · an action that grants itself an effect (`action.grants`) · **M**

| part | what |
| --- | --- |
| engine reader | `action-resolution.ts` (`grants` → an effect on the actor), consumed by `requiresEffectTag` at `:230-231` |
| SRD content | **3** class actions, on three different classes: barbarian `rage` → *Raging*, rogue `steady-aim` → *Steady Aim*, sorcerer `innate-sorcery` → *Innate Sorcery* |
| editor control | reuse `effectsField`'s row schema at cardinality 1, mounted as a group on the action row |
| both-paths test | new: `action-grants.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** resolving Rage puts the *Raging* effect on the actor with its tag, and a
  `requiresEffectTag: "raging"` action stops refusing — the refusal message at `:231` is the
  before-state.
- **Non-vacuity (control):** remove the group → throws.
- **Non-vacuity (value):** change the granted effect's tag → the gated action refuses again.
- **375px:** yes.

### D — species and background choice fields (`schemas.ts`, `SPECIES_SCHEMA` :302-368 and `BACKGROUND_SCHEMA` :371-408)

#### D1 · a species' language choices · **M**

| part | what |
| --- | --- |
| engine reader | `apps/server/src/character-build.ts:874, 895` — the `species-languages` offer, the budget *"Common plus two languages"* that Character Creation owes every character |
| SRD content | **9 of 9** species author `languageChoices: { choose: 2, fromCatalog: "standard-languages" }` |
| editor control | a choice-list group beside the existing `languages` tags field (which exists and is `true`) |
| both-paths test | new: `species-languages.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** the builder OFFERS a two-pick language choice whose option list resolves to the
  standard-languages catalog; a species with the field stripped offers **nothing**, and the two
  option lists are compared, not the field.
- **Non-vacuity (control):** remove `languageChoices.choose` → throws.
- **Non-vacuity (value):** `choose: 2` → `1` and the offer's capacity moves.
- **375px:** yes.

#### D2 · a lineage's own traits · **L**

| part | what |
| --- | --- |
| engine reader | `content-library.ts` flattens lineage traits into the species feature list; the riders then run — Wood Elf's *Fleet of Foot* carries `modifiers: [{ type: "speed", amount: 5 }]` |
| SRD content | **18 lineage rows over 4 species** (dragonborn 10, elf 3, gnome 2, tiefling 3) carrying **36 trait objects**; the lineage row's editor fields today are exactly `name, description` |
| editor control | mount `FeatureEditor` inside the lineage row |
| both-paths test | new: `lineage-traits.mirror.test.ts` in `apps/client/src/homebrew/` |

**The constraint that makes this L.** The publish gate **refuses** a choice on a lineage trait
(`apps/server/src/homebrew-validate.ts:266-268`: *"Lineage traits cannot carry choices yet — move the
choice up to a species trait"*, because the flatten drops the lineage tag). So the mounted editor
must **not** offer the choice panel at this depth, or the form authors a body its own gate refuses.
That is a scoped `FeatureEditor`, not the whole one — the work is the scoping, not the mounting.

- **Far end:** a Wood Elf character's speed is **35** and a High Elf's is **30**, and the five feet
  come from a lineage trait's rider; the homebrew twin reaches the same number by the same road.
- **Non-vacuity (control):** remove the traits field from the lineage row → `authoredRow` throws for
  `["lineages","traits"]`.
- **Non-vacuity (value):** change `amount: 5` → `0` and the far-end speed drops back to 30.
- **Guard interaction:** the choice panel must be **unauthorable** at this depth, not merely refused
  — assert `hasControl("species","choice",["lineages","traits"])` is `false`, and record it as an
  exemption with `permanent:` and the gate's own citation.
- **375px:** yes — the densest new surface in the program.

#### D3 · a background's ability spreads (a repair) · **S**

**A live defect found by measurement.** `BACKGROUND_SCHEMA`'s `abilityOptions.spreads` is a `rows`
field whose `newRow` mints `{ amounts: [2, 1] }` and whose only row field is `{ key: "label" }`
(`schemas.ts:389-399`). The schema is
`spreads: z.array(z.array(z.number().int().min(1).max(3)).min(1).max(3))`
(`packages/content-srd-5.2.1/src/character-content.ts:885`) — an array of arrays of **numbers**.
So the row shape the form mints is refused by the record's own schema, and `label` is a key the
schema has nowhere to put. **Tapping "Add a spread" makes a background unpublishable.**

| part | what |
| --- | --- |
| engine reader | `character-build.ts` — the background ability-increase step |
| SRD content | **4 of 4** backgrounds author `abilityOptions`, all with `spreads: [[2,1],[1,1,1]]` |
| editor control | replace the row with a real amounts control that writes a number array |
| both-paths test | new: `background-spreads.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** a character built on an authored background accepts a `+2/+1` distribution and refuses
  `+3/+0`, naming the bound.
- **Non-vacuity (control):** the pre-fix repro — mint a row through the current `newRow` and assert
  `publishVerdict(...).publishable` is `false`; after the fix it is `true`.
- **Non-vacuity (value):** author `spreads: [[3]]` and the `+2/+1` build is refused.
- **375px:** yes.

### E — the class level table (`apps/client/src/homebrew/LevelTableEditor.tsx`)

#### E1 · a class resource's id and its display flag · **L**

| part | what |
| --- | --- |
| engine reader | `character-build.ts:326-331` — `scaling: { type: "class-resource", id }` reads `classResources.find(r => r.id === scaling.id).amount`; and `:503`, which reads the literal id `"martial-arts"` for the Monk's die |
| SRD content | **375** class-resource entries over **235** level rows in **all 12** classes, spanning **18 distinct ids** (`action-surge, arcane-recovery, bardic-inspiration, channel-divinity, divine-intervention, eldritch-invocations, favored-enemy, focus-points, indomitable, martial-arts, rage, rage-damage, second-wind, sneak-attack, sorcery-points, unarmored-movement, weapon-mastery, wild-shape`); **159** entries carry `display: true` |
| editor control | an id field and a display toggle beside the existing name/amount pair (`LevelTableEditor.tsx:428-464`) |
| both-paths test | new: `class-resources.mirror.test.ts` in `apps/client/src/homebrew/` |

**Why this is L and not S.** The editor mints the id with `newId()` — a v4 UUID
(`apps/client/src/lib/ids.ts:13`). A UUID matches `ContentIdSchema`'s `/^[a-z0-9-]+$/`, so it
publishes clean and is then unreachable by any `class-resource` scaling rule: the GM cannot make a
homebrew Rage pool that a feature's uses can read. Worse for the guard: `LevelTableEditor` is a
`custom` field, so **its internals are invisible to `fieldsOf`** — exactly the `GrantsEditor` hole
(`authoring-harness.ts:48-68`). Closing this properly means giving the resource rows real `FieldDef`s
so the guard can see them, which is the same shape of refactor R1 performed for `FeatureEditor`.
That refactor is the unit's weight; the two new controls are the small half.

- **Far end:** a feature whose `uses.scaling` is `{ type: "class-resource", id: "rage" }` on an
  **editor-authored** class table yields **2** uses at level 1 and **3** at level 3, with the
  authored line unchanged — U7's proof shape, now reachable from the editor end.
- **Non-vacuity (control):** remove the id field → throws.
- **Non-vacuity (value):** rename the resource id to `rages` and the scaling resolves to nothing;
  the count drops to the fallback and the assertion fails.
- **375px:** yes — the level table is already the densest surface in `/homebrew`.

### F — the three API defects (`packages/api-contract/src/index.ts`, `homebrew-store.ts`, `homebrew-validate.ts`)

#### F1 · API-authored content publishes as `source: "srd"` (defect a) · **M**

**Measured.** `ContentSourceSchema` is `z.enum(["srd","homebrew"]).default("srd")`
(`character-content.ts:38`). `normalizeBody` (`homebrew-store.ts:791-800`) forces `id` and, for a
monster, `source.externalId` — and **never** `source`. Only the client stamps it
(`apps/client/src/homebrew/defaults.ts:76`). So a record created over HTTP with no `source` key is
badged as official SRD in the character builder.

The documentation makes it worse in a specific, countable way: `homebrewRecordBase.source`
(`packages/api-contract/src/index.ts:1119`) describes the field as *"Always \"homebrew\" once
stored"*, and that string renders **8 times** in `docs/api-reference.md` — at lines 5034, 5093, 5320,
5379, 6071, 6104, 6122, 6244, once for each of the eight record components that spread
`homebrewRecordBase` (class, subclass, species, background, feat, spell, equipment, spell-list; a
monster's `source` is the provenance object and is excluded). A ninth occurrence, at line 5979, reads
*"Always \"homebrew\" on this surface"* on `HomebrewRecordSummary` — and that one is **true**, because
`homebrew-http.ts:220` hardcodes it. **The API therefore contradicts itself inside one response:**
the summary says homebrew, the record body says srd.

| part | what |
| --- | --- |
| engine reader | `sourceBadge` in the character builder; the create modal's SRD-block filter |
| SRD content | every bundled record is genuinely `source: "srd"` — the discriminator must keep meaning that |
| editor control | already exists (the client stamp); this unit moves the guarantee to the server |
| both-paths test | new: `api-source-stamp.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Fix:** stamp `source: "homebrew"` in `normalizeBody` for the eight non-monster types, and correct
  the eight OpenAPI descriptions so a caller who trusts the document is right.
- **Far end:** POST a class body with no `source` key over HTTP, publish it, and assert the builder's
  pick card badges **Homebrew** — the rendered badge, not the stored field.
- **Non-vacuity (control):** remove the stamp → the badge reads SRD and the test names it.
- **Non-vacuity (value):** POST `source: "srd"` explicitly and assert the server still stores
  `"homebrew"` — a caller cannot opt out of provenance.
- **Serialization point:** **changes `openApiDocument`.** See §5.

#### F2 · a monster cannot be published from the published contract (defect b) · **M**

**Measured.** The publish gate hard-requires `extensions["open5e.srd-2024"].challengeRating` and
`.type` (`homebrew-validate.ts:318-319`, via `statblockFacts`). The contract documents `extensions`
as a free-form bag. **The string `open5e` appears 0 times in `packages/api-contract/src/index.ts` and
0 times in `docs/api-reference.md`** — verified by count. So an API caller can build a body that
satisfies every documented requirement and still get a 409 they cannot act on.

| part | what |
| --- | --- |
| engine reader | `statblockFacts`, `content-library.ts:314-325` |
| SRD content | **330 of 330** monsters carry both keys |
| editor control | already exists (`extensionField("type"…)`, `extensionField("challengeRating"…)`, `schemas.ts:823-824`) |
| both-paths test | new: `api-monster-publish.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Fix:** declare the two required bag keys in `HomebrewMonsterRecord` (building on B0's declared
  vocabulary), and make the refusal quote the documented path.
- **Far end:** a monster body assembled from the OpenAPI document alone publishes (**200**), where
  today the same body 409s. Both states asserted.
- **Non-vacuity (control):** strip `challengeRating` from the posted body → 409 with the documented
  message.
- **Non-vacuity (value):** post `challengeRating: "10"` (a string) → refused, because
  `statblockFacts` narrows rather than casts.
- **Serialization point:** **changes `openApiDocument`.**

#### F3 · publish the closed SRD vocabularies (defect c, first half) · **M**

**Measured.** `homebrewDamageType` is `{ type: "string", minLength: 1, maxLength: 40 }`
(`packages/api-contract/src/index.ts:1055`) and `homebrewConditionId` a free slug (`:1056`).
`CONTENT_PATHS` (`:268-283`) serves conditions, skills and languages — and has **no** entry for
damage types, weapon properties, masteries or rarities. The vocabularies exist and are complete
(`packages/content-srd-5.2.1/src/enums.ts`): **13** damage types, **15** conditions, **9** bare weapon
properties + **8** masteries (17 bundle rows), **7** rarities, plus 8 schools, 14 creature types,
6 gear categories, 18 skills, 19 languages.

| part | what |
| --- | --- |
| engine reader | every rider trigger matches the bare slug; a wrong one is silently inert — *"the single hardest homebrew failure to diagnose"* (`enums.ts` header) |
| SRD content | the seven `*_IDS` constants, each already re-derived from a bundle by `packages/content-srd-5.2.1/test/enums.test.ts` |
| editor control | the forms already offer them as `suggestions` — this unit puts the same constants on the wire |
| both-paths test | new: `api-vocabularies.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Fix:** new `CONTENT_PATHS` entries serving the constants, through the **same** command /
  authorization / projection path the UI uses (`.claude/rules/api-contract.md`), never a fork.
- **Far end:** `GET /api/v1/content/damage-types` returns exactly the 13 ids, in bundle order, and
  the editor's own suggestion list is the same array object — one constant, two consumers.
- **Non-vacuity (control):** remove the route → the request 404s and the test names it.
- **Non-vacuity (value):** add a fourteenth id to the constant → both the route's response and
  `enums.test.ts`'s bundle re-derivation fail, in that order.
- **⚠ Viewer safety.** A new read route is a new projection surface. These are printed rules and
  `CONTENT_PATHS.conditions` is already `gameSecurityWithPlayer("game:read")`, so the audience is
  settled by precedent — but **`viewer-safety-auditor` must review this unit before merge** (CLAUDE.md
  rule 3).
- **Serialization point:** **changes `openApiDocument`**, and touches `apps/server/src/game-http.ts`
  / `game-operations.ts`.

#### F4 · validate against the vocabularies (defect c, second half) · **L**

**The blocker, measured, and it is why this is L.** `homebrew-validate.ts:44-48` states the position
in writing: advisories are *"deliberately not here"* because `HomebrewValiditySchema` is `.strict()`
with exactly `{ valid, issues }` (`packages/api-contract/src/index.ts:664`), so a warning **has
nowhere to travel** and emitting one as an issue would BLOCK a publish that should succeed. And it
must not block: `DamageTypeIdSchema` is a max-40 open string on purpose
(`packages/schemas/src/index.ts:7`), and the mirror test already pins that a homebrew `"void"` type
reaches the wire (`vocabulary-parity.mirror.test.ts:3396-3399`) — *"closing it would have been the
inverse of the bug the client reported."*

So F4 is a **contract change**: add `warnings` to `HomebrewValiditySchema` and its component, carry it
through `documentOf` (`homebrew-http.ts:213-218`) and the client checklist, then emit near-miss
advisories for the closed vocabularies.

| part | what |
| --- | --- |
| engine reader | the same riders — a near-miss slug is inert at play time |
| SRD content | the seven `*_IDS` constants |
| editor control | the publish checklist renders warnings distinctly from blockers |
| both-paths test | new: `api-vocabulary-warnings.mirror.test.ts` in `apps/client/src/homebrew/` |

- **Far end:** a record authored with `damageType: "flame"` **publishes** (200) and the response
  carries a warning naming `fire` as the near miss; the same record with `"fire"` publishes with no
  warning. Both asserted.
- **Non-vacuity (control):** remove the near-miss check → the warning array is empty and the test
  names the missing advisory.
- **Non-vacuity (value):** change `"flame"` to `"quux"` (no near miss) → the warning still fires but
  suggests nothing, and the *shape* of the message differs; both branches asserted.
- **⚠ Must not become a blocker.** A regression test pins that `warnings.length > 0` never sets
  `valid: false`.
- **Serialization point:** **changes `openApiDocument`.**

---

## 4. What I am excluding, and why

**The phase's own rule, applied honestly:** a control with no SRD author creates an editor-only row,
which is its own defect. Everything below was measured at this HEAD.

### Excluded for **zero SRD authors**

| capability | measured | note |
| --- | --- | --- |
| monster `proficiencies` (saves, skills, languages, armor, weapons, tools, overrides) | **0** of 330 rows | The engine reader exists (`saving-throws.ts:122-124`) but no bundled monster authors it, and a control here would *change which rung* a homebrew monster's saves resolve on. B1 authors the bag instead. |
| monster **skills** | **0** — the key does not exist in the extension bag at all | The brief names it; the bundle does not have it. |
| monster `spellcasting`, `character`, `startingInventory`, `startingCurrency` | **0** each | These are *built-character* fields. Every SRD monster row lacks them. A control would be editor-only. |
| monster `damageVulnerabilities` (typed array) | **0** | It already **has** a control (`schemas.ts:842`) — an existing editor-only row, recorded here as a finding, not opened as a unit. |
| extension `nonmagicalAttackImmunity` / `nonmagicalAttackResistance` | 0 rows `true`, **and no reader anywhere** | Two of the four parts missing. |
| extension `experiencePoints` | 1 row, **no reader** | |
| action `requiresEffectTag` | **0** authored (it is *read* at `action-resolution.ts:230`; C4 supplies its authored counterpart) | |
| action `spellSlot` | **0** authored — synthesised from an item's `consumesSpellSlot` (`equipment-derivation.ts:918`) | |
| action `spellId` | **0** authored — synthesised at `character-build.ts:441` | |
| background `skillChoices` | **0** of 4 | |
| background `languages`, `languageChoices` | **0** of 4 | |
| species `abilityBonusChoice` | **0** of 9 | |
| class `levelTable[].spellsKnown` | **0** of 240 level rows | The brief names it; no bundled class authors it. |
| class `skillChoices.fromCatalog` | **0** of 12 | Every class uses the `from` list, which already has a control. |
| class `toolChoices` | **0** of 12 | |

### Excluded as a **lone record** (test 2, *"not a lone record"*, is unsatisfiable)

| capability | measured |
| --- | --- |
| action `targetRules` | **1** SRD author |
| action `reaction` | **1** — rogue `uncanny-dodge` only |
| background `toolChoices` | **1** of 4 |

### Excluded because **another program owns it**

| capability | owner | evidence |
| --- | --- | --- |
| action `multiattack` (126 authors) | **U21** | It is a live row of the census in `vocabulary-parity.mirror.test.ts:3416` — *"U21 — 126 SRD records author it"* — and governing plan ruling 13 re-scopes U21 explicitly. My guard **covers** it with an exemption pointing at U21; U21 ships the control. **If the parent wants this program to own it instead, the census row must move — a one-line change I am flagging rather than making.** |
| `equipment.weapon.mastery` | **U38** | census row at `:3415` |
| `class.widensPicks` | **U17** | census row at `:3417` |
| `equipment.weapon.properties` | prerequisites batch | governing plan §3 batch 0 |
| the full SRD magic-item list | content program | governing plan ruling 4 |

### Excluded as a **second spelling of a fact that already has a control**

The extension bag's `damageResistances` / `damageImmunities` / `conditionImmunities` are **prose
mirrors** of the typed arrays (measured: Air Elemental's bag holds the string `"lightning"` while the
row holds `["lightning"]`). The typed arrays already have controls (`schemas.ts:840-847`) and are the
mechanically live ones (`apps/server/src/hit-points.ts:149-150`). Authoring the prose would be two
spellings of one sentence — the drift this vocabulary work exists to prevent.

**But it surfaces a real bug, recorded not fixed:** the sheet renders `extension.damageResistances`
(`CharacterSheet.tsx:661-663`), so **a homebrew monster whose typed resistances are authored through
the existing control shows nothing in the sheet's Resistances row** — the mechanic bites, the display
is blank. It belongs to whoever owns `CharacterSheet`'s statblock rendering; B2's shared formatter is
the natural home. Log it in `known-bugs.md`; do not smuggle it into a unit.

### 4.1 Equipment-side gaps, and the content program's effect on them

**Cross-planner finding, from PLANNER-CONTENT:** `equipment.v1.json` carries **zero** rider blocks
today. The content program's C7 lanes generate a **258-item magic-item bundle**, and after it lands
every `armor-class`, `save-bonus`, resistance, immunity, proficiency grant, `roll-mode`, `casts` and
item-level `uses` rider has real SRD authors for the first time.

**Nothing in §4 above is re-classified by that**, and it is worth saying why rather than leaving it
implied: I excluded no equipment-side capability on author grounds. The only two equipment gaps this
program names — `weapon.mastery` and `weapon.properties` — are excluded for **ownership** (U38 and
the prerequisites batch), not for want of an author, and that does not change.

**But it changes one thing, and it is inside the guard.** `grants` is the single surviving entry on
`RIDER_EXEMPT` (`apps/client/src/homebrew/authoring-harness.ts:69`), waved through because
`GrantsEditor` is bespoke JSX with no `FieldDef` to look up — a documented *refactor*, on the honest
grounds that nothing authored it. **After C7 it is a gap with authors**: `grants.saves`,
`grants.damageResistances`, `grants.damageImmunities`, `grants.armor`, `grants.weapons`,
`grants.tools`, `grants.languages` and `casts` all become SRD-authored on an item, and
`equipment.grants.*` and `equipment.uses.scaling.*` are already measured as uncovered at record
scope. So A1's exemption row for `grants` must carry **`owner: content-program C7, then a follow-on
unit`** — not `permanent:` — and the follow-on is the `GrantsEditor` → declarative-surface conversion
R1 performed for `FeatureEditor`.

**Sized, not opened.** That follow-on is a real unit and it is deliberately **not** in this program:
its second part does not exist yet. Re-run the author measurement against the generated bundle the
day C7 merges, then open it. Opening it now would be planning against content that has not landed —
the exact failure the governing plan's §1 was written about.

**And one thing I did NOT lean on, stated because the same planner warned about it:** C4's authors
are **three class actions** (barbarian `rage`, rogue `steady-aim`, sorcerer `innate-sorcery`), never
items. Measured independently by that planner: **0 of the 258 magic items author an
"advantage on your next attack" shape** — that carrier is a class feature. C4's count does not move
when C7 lands, in either direction.

---

## 5. Concurrency, file lanes and the generated API reference

### 5.1 The lanes

**Ceiling is 4 agents** (governing plan §1). The binding constraint is **file contention, and my
program's contention is concentrated in three client files**, which the governing plan does not list:

- `apps/client/src/homebrew/schemas.ts` (934 lines) holds **all nine** form schemas.
- `apps/client/src/homebrew/RiderEditor.tsx` (1,365 lines) holds `actionsField`, which every action
  unit edits.
- `apps/client/src/homebrew/LevelTableEditor.tsx` (516 lines).

| lane | files owned | units | notes |
| --- | --- | --- | --- |
| **α** | `schemas.ts` **`MONSTER_SCHEMA` region (813-884)**, `content-library.ts` | B0 → B1 → B2 → B3 → B4 | |
| **β** | `RiderEditor.tsx` | C1 → C2 → C3 → C4 | |
| **γ** | `schemas.ts` **`SPECIES_SCHEMA` (302-368) + `BACKGROUND_SCHEMA` (371-408)**, `LevelTableEditor.tsx` | D1 → D2 → D3 → E1 | |
| **δ** | `packages/api-contract/src/index.ts`, `homebrew-store.ts`, `homebrew-validate.ts`, `game-http.ts` | F1 → F2 → F3 → F4 | |

**Two serialization points this program does NOT touch, checked because another planner found them.**
`EQUIPMENT_SCHEMA`'s weapon block (`schemas.ts:764-769`) is contended by the content program and the
mastery program's U38 — two programs, one block. My `schemas.ts` lanes are the `MONSTER_SCHEMA`
region (813-884) and the `SPECIES_SCHEMA` / `BACKGROUND_SCHEMA` regions (302-408); neither overlaps
it. And `loadEquipment()` is contended by the content program's C3 and C6 — **F3 does not touch it,
by design**: it serves the frozen constants in `packages/content-srd-5.2.1/src/enums.ts`, which are
browser-safe and already re-derived from the bundles by
`packages/content-srd-5.2.1/test/enums.test.ts`, rather than following `CONTENT_PATHS.conditions`'s
loader-backed pattern. That choice is what keeps F3 off the contended loader; do not "improve" it
into a loader call.

**α and γ share `schemas.ts`, deliberately, and the deviation is stated rather than discovered.**
Their edit regions are **405 lines apart** and share no symbol, so a three-way merge is trivial. The
condition on the deviation: whichever lane merges second **rebases and re-runs its own verification**
in its own worktree before the parent merges it — never a blind merge. If the parent prefers the
governing plan's stricter *"no two share a file"*, collapse α+γ into one nine-unit lane and give
lane γ's slot to the review/mobile pass instead.

Each unit's both-paths test is **its own new `*.mirror.test.ts` file**, named for the unit. No two
units edit the same test file, and **no unit in this program touches
`apps/client/src/homebrew/vocabulary-parity.mirror.test.ts`** — its census array stays untouched.

### 5.2 The generated API reference — the merge resolution

`docs/api-reference.md` is generated and freshness-tested by
`packages/api-contract/test/reference.test.ts:59` (*"matches the committed docs/api-reference.md
exactly (regenerate with `npm run docs` from the repo root)"*). `docs/app-map.md` is the same, via
`apps/server/test/app-map.test.ts`.

**Four units change `openApiDocument`: F1, F2, F3, F4 — all in lane δ.** Because they are all in one
lane and that lane is a `pipeline`, they never conflict with each other; they conflict only with the
parent's merge. The rule:

1. **No unit runs `npm run docs`.** A regenerated 6,000-line Markdown file in four branches is four
   guaranteed conflicts with no semantic content.
2. Each contract-changing unit leaves `docs/api-reference.md` **stale in its own branch** and says
   so in its commit message, naming the expected red test:
   `packages/api-contract/test/reference.test.ts` → *"matches the committed docs/api-reference.md
   exactly"*. That is the **only** test permitted to be red at hand-off, and the message must state
   the count of red tests so a reviewer can tell a stale doc from a regression.
3. **The parent runs `npm run docs` once, after the merge**, as the merge resolution, then re-runs
   the full suite green.
4. `.claude/rules/api-contract.md` still binds: `openApiDocument` must stay **byte-identical where
   unchanged**. A unit that reformats an untouched component fails review.

`docs/ai-ledger/current-state.md` is **parent-only** (governing plan §5) — it sits at its enforced
150-line ceiling with zero headroom (measured: exactly 150 lines). No unit edits it.

### 5.3 What must be serial

- **A1 before everything.** Ruling 10: every later unit lands under the guard. A unit merged before
  the guard has no exemption row and no round trip.
- **B0 before B1–B4.** They author the vocabulary B0 declares.
- **F3 before F4.** F4 validates against the lists F3 publishes.
- **At most two full suites at once** (governing plan §6) — and that now includes the **client**
  suite, because A1 makes it bind a port and open a SQLite file.

---

## 6. Verification — the bar, per lane

### 6.1 Every unit

- `npm run check` exit 0 from the repo root.
- `npm run test` from the repo root, with the file/test counts reported. **Build only the client
  workspace** — `npm run build` emits compiled output under the server workspace and `npm run test`
  then collects those compiled tests too (185 → 204 files, ~11 spurious failures; governing plan §6).
- Both non-vacuity probes, each with its **exact failing count and message**, restored after each.
- Read `docs/ai-ledger/known-bugs.md` before calling a red test a regression.

### 6.2 The 375px pass — concrete, because this program adds a lot of UI

Fourteen of the eighteen units add controls to `/homebrew`. The repo already has the two audits and
they already cover this surface:

- **`node scripts/tap-audit.mjs 375`** — the 44px floor. It carries three `/homebrew` entries:
  `play-homebrew`, `play-homebrew-record` and `play-homebrew-picker`
  (`scripts/tap-audit.mjs:523-556`). Its own docblock warns that it was once *"MEASURED against a
  database the seed had not built"* — an empty library reports a clean tab about a screen with no
  fields.
- **`node scripts/no-scroll-audit.mjs`** — the page-never-scrolls law at eight viewports, portrait
  and landscape.

Neither is wired into `npm test`; both need a dev server and the pre-installed Chromium at
`/opt/pw-browsers`. **Never run `playwright install`.**

**Two requirements this program adds, because the audits would otherwise pass vacuously:**

1. `play-homebrew-record` opens the **first** record in the rail, so it exercises **one** type's
   form. Every unit that adds a control must **seed a published record of its own type** before
   running the audit, and report which record the audit measured. A unit that reports a tap-audit
   number without naming the record it opened has not run the pass.
2. Each lane runs both audits **once at the end of the lane**, not once per unit — a per-unit browser
   pass costs more than it proves — but any unit adding a **repeating rows editor** (B4, C1, C3, D2,
   E1) runs the tap audit for itself, because a rows editor at 375px is where the floor actually
   breaks.

### 6.3 The review layer, folded in (governing plan ruling 3)

Each lane ends with three passes, and the review **hunts two specific failure modes — built-but-
unwired mechanisms and vacuous tests** — not general code review:

- a hostile adversarial review (`code-reviewer` + `test-reviewer`),
- a QA-fix pass on whatever it finds,
- a polish pass (`ux-reviewer`) over the new controls at 375px.

**`viewer-safety-auditor` is required before merge on F3** (a new read route is a new projection
surface). **A viewer-safety read — one citation, not a full audit — is required on B4** (free prose
on a stat block; confirm `CharacterSheet.tsx:433`'s GM gate still holds) **and on F1** (it changes
what a player sees on a builder pick card).

---

## 7. Ledger updates this program owes

Parent-only, after the merge:

- `docs/ai-ledger/decision-log.md` — the `schemas.ts` shared-file deviation (§5.1); the ruling that
  a monster's saves are authored in the **bag** and not in `proficiencies` (B1); the `warnings`
  contract addition (F4).
- `docs/ai-ledger/known-bugs.md` — **add** the sheet's typed-vs-prose resistance split (§4);
  **remove** the vacuous mount probe entry at `:127-131` once A1 fixes it.
- `docs/ai-ledger/current-state.md` — one edit in place, at the ceiling, describing the guard.
- `npm run docs`, once, as the merge resolution.

---

## 8. What I measured that contradicts the governing plan

Five items. Each was measured at HEAD `6278e5a`; none is corrected silently.

1. **"the OpenAPI describes `source` ten times as *Always \"homebrew\" once stored*"** (§4a). The
   measured count is **eight** false occurrences in `docs/api-reference.md` (lines 5034, 5093, 5320,
   5379, 6071, 6104, 6122, 6244) plus **one** occurrence of a *different and true* sentence on
   `HomebrewRecordSummary` (line 5979). Nine total, eight of them wrong. The under-reported half is
   more interesting than the count: **the summary and the record body disagree inside a single
   response.**

2. **"17 weapon properties" is the bundle row count, not a vocabulary** (§4c).
   `weapon-properties.v1.json` has 17 rows because the two families share one id space —
   `finesse-wp`, `cleave-mastery`. The vocabularies riders actually match are **9 bare properties**
   and **8 masteries** (`packages/content-srd-5.2.1/src/enums.ts:67-74`). F3 must publish two lists,
   not one of seventeen.

3. **Defect (c)'s validating half is blocked on a contract change nobody has scoped.**
   `HomebrewValiditySchema` is `.strict()` with exactly `{ valid, issues }`
   (`packages/api-contract/src/index.ts:664`), and `homebrew-validate.ts:44-48` says in writing that
   an advisory *"has nowhere to travel"* and would BLOCK a publish that should succeed. Validating
   the open vocabularies therefore requires a `warnings` array on the contract — which is why F4 is
   **L**, not the small sibling of F3 the §4 bullet reads like.

4. **The API buckets are smaller than they look, because roughly half the named fields have zero
   SRD authors.** Of the fields the brief lists: monster `proficiencies` **0**, monster `skills`
   **the key does not exist**, `spellcasting`/`character`/`startingInventory`/`startingCurrency`
   **0 each**, action `requiresEffectTag`/`spellSlot`/`spellId` **0 each**, `targetRules` **1**,
   `reaction` **1**, background `skillChoices`/`languages`/`languageChoices` **0**, class
   `levelTable[].spellsKnown` **0**, `skillChoices.fromCatalog` **0**. Applying the phase's own rule
   honestly removes fourteen candidates. The ones that survive are the ones that matter — 330, 204,
   197, 126, 82, 47, 36, 18, 15 authors — and the program is stronger for the pruning, not weaker.

5. **`multiattack` is already assigned.** It is a live census row in
   `vocabulary-parity.mirror.test.ts:3416` naming **U21**, and governing plan ruling 13 re-scopes U21
   by name. The brief lists it under my buckets. I have **not** taken it; the guard covers it with an
   exemption pointing at U21. Reassigning it is a one-line census edit and a parent decision.

**A sixth, which is new information rather than a contradiction:** `schemas.ts`, `RiderEditor.tsx`
and `LevelTableEditor.tsx` are three files that together carry almost every editor control this
program adds. They belong on the governing plan's §5 serialization list.

---

## 9. Unit index

| id | unit | size | lane | far end | contract | viewer safety | 375px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | the HTTP round-trip parity guard | XL | — (serial, first) | a red build | — | — | — |
| B0 | declare the statblock extension contract | S | α | a derivation test | — | — | — |
| B1 | a monster's saving throws | M | α | a rolled save total | — | — | ✔ |
| B2 | senses / passive Perception / languages / alignment | M | α | a rendered header line | — | — | ✔ |
| B3 | movement modes | M | α | a rendered speed line | — | — | ✔ |
| B4 | traits | M | α | a rendered trait entry | — | read | ✔ |
| C1 | `onHit` — a hit that lands a condition | M | β | the applied condition + escape DC | — | — | ✔ |
| C2 | `legendary.cost` | S | β | a refused fourth legendary action | — | — | ✔ |
| C3 | `damageByLevel` | S | β | 1d6 → 3d6 across two builds | — | — | ✔ |
| C4 | `action.grants` | M | β | an effect on the actor; a gate stops refusing | — | — | ✔ |
| D1 | a species' language choices | M | γ | the builder's offered option list | — | — | ✔ |
| D2 | a lineage's own traits | L | γ | speed 35 vs 30 | — | — | ✔ |
| D3 | a background's ability spreads (repair) | S | γ | a distribution accepted and one refused | — | — | ✔ |
| E1 | a class resource's id and display flag | L | γ | 2 uses at L1, 3 at L3 | — | — | ✔ |
| F1 | API content publishes as homebrew | M | δ | a rendered **Homebrew** badge | ✔ | read | — |
| F2 | the monster publish contract | M | δ | a documented body publishes | ✔ | — | — |
| F3 | publish the closed vocabularies | M | δ | 13 ids on the wire | ✔ | **audit** | — |
| F4 | validate against them (advisory `warnings`) | L | δ | a near-miss warning, publish still succeeds | ✔ | — | ✔ |

**Workflow script:** [`workflows/api-program.js`](workflows/api-program.js).

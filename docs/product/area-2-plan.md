# Area 2 plan — finish the classes and the homebrew editor, as one phase

**Written 2026-08-08 by AREA2-PLANNER, against HEAD `6909bd0` on
`claude/feature-implementations-intake-c5eyu1`.** This is an execution plan. Nothing in it was
implemented; where a size is a guess I write *estimated*, where I ran something I write *measured*
and say what.

## Status / what this supersedes

This plan is the **single executable order** for the combined phase. It stands on two intakes and
replaces both as the thing an agent reads before starting:

- [`area-2-scope.md`](area-2-scope.md) — the class residue, `3a`–`3d` re-diagnosed at HEAD, and the
  8 / 11 / 5 SHARED · HOMEBREW-ONLY · CLASS-ONLY split. **Still the reference for *why* each unit
  exists.** Its *recommended order* is superseded by the waves below.
- [`vocabulary-parity-audit.md`](vocabulary-parity-audit.md) — 170 items × nine families, 66 parity ·
  41 SRD-only · 30 editor-only · 16 inert · 17 unused. **Still the reference for the per-row
  evidence.** Its batch 1 / batch 2 split is folded into the waves below.

Both supersede the Area 2 section of
[`feature-implementations-plan.md`](feature-implementations-plan.md) (2026-08-07). That document is
kept for exactly one thing: **the client's original `3a`–`3d` Observed/Expected text is the
contract**, and it is quoted nowhere else.

Neither intake is a plan. The scope document sequences 18 items and **never sequences `3b`(b)** — one
of the client's own four issues is absent from its Wave 0–4 list. The audit sequences nothing. This
document sequences everything, and every unit names its four parts.

---

## The rule every unit is held to

> **One unit of work = an engine reader + SRD content authoring it + a homebrew editor control +
> a test through BOTH paths. Ship vocabulary complete, or don't ship it.**

**Every unit below names its four parts, or says which part does not apply and why.** "Does not
apply" is a permitted answer exactly twice:

- **No SRD content half** — a homebrew-only capability with no shipped record to author it. Allowed
  *only* when the unit's test still ends at an engine outcome (a rolled number, a spent counter, an
  applied condition). If you cannot name the engine outcome, the row is inert and belongs in Wave 5,
  not in a batch.
- **No control half** — an ETL/content-pipeline shape with no editor surface. Allowed only for the
  CLASS-ONLY rows, all of which are deferred out of this phase.

**"A control exists" is not the bar. "The value moves a number, driven from both ends" is.** The
audit's §N3 case is the one that proves the distinction: `spell-school-is` and
`attack-kind-is: ["spell"]` both render in `RiderEditor.tsx` today and both fail closed. A rule read
as "always add the control" produces exactly those rows. It must be read as "prove the value moves a
number, from both directions."

### The commit rule

**One vocabulary item per agent, per commit.** Three agents died mid-flight this session carrying too
much; one nearly committed a probe that had deleted Druid's `primal-order`. If a unit cannot be
described in one sentence naming its reader, its content, its control and its test, split it before
starting. Two units below are already split for this reason (U24/U25, the mace's two independent
bugs) and one item is explicitly *not* a unit (R1, a refactor with no vocabulary of its own).

### Sizes

**S** ≈ half a day or less · **M** ≈ 1 day · **L** ≈ 1.5–2 days. Every size below is **estimated by
reading the code**, not measured by building it. Wave totals are the sum of the estimates and carry
the same uncertainty.

---

## Wave 0 — the guard, and the free wins

**4 units · ~2 days estimated.** Nothing else starts until U1 is green.

### U1 — the both-paths test harness

**This lands first, and it is cheaper than either intake thought.** Argument and cost are in
*Decisions* below; the finding that decides it is that the mechanism already exists.

| part | what |
| --- | --- |
| **reader** | n/a — this unit adds no vocabulary. It is the guard that makes every later unit self-checking. |
| **content** | n/a. |
| **control** | n/a. |
| **test** | the harness itself, plus two census assertions (below). |

**Files.** New `apps/client/src/homebrew/authoring-harness.ts` (extract `fieldsOf`, `applyField`,
`clearField`, the publishable gate from `apps/client/src/homebrew/publish-paths.test.ts:47`–`:99`);
new `apps/client/src/homebrew/vocabulary-parity.mirror.test.ts`; `apps/client/src/homebrew/RiderEditor.tsx`
(one export widened).

**Why `.mirror.test.ts`.** `apps/client/vitest.config.ts` already declares a **second, node-environment
project** whose stated purpose is that "these tests import the SERVER's own modules to check that the
wizard and the authoritative build agree," and
`apps/client/src/builder/server-offers.mirror.test.ts:4` already imports
`../../../server/src/character-build.js` directly. So the joined test needs **no shared package, no
cross-workspace helper module, and no server-side import of client code**. The editor helpers stay in
their own directory; the server modules import by relative path the way the precedent does.

**The hole in the harness as the audit specified it — close it in this unit.** `applyField` throws on
an unknown key, which is the whole trick — **except for six keys.**
`publish-paths.test.ts:70`–`:77` carries a `RIDER_KEYS` escape hatch
(`modifiers`, `grants`, `uses`, `actions`, `effects`, `tags`) that falls through to a plain `setAt`
**without checking that a control exists**, because `RiderEditor` writes whole-body. Effect
`modifiers`, `uses.scaling: class-resource`, `recharge`, `attack.bonus` and `grants.spells` — five of
the six rows the harness exists to catch — **all live inside those six keys.** As specified, the
harness would pass silently on its own headline rows.

The fix is already half-built: `RIDER_FIELDS_FOR_TEST` (`apps/client/src/homebrew/RiderEditor.tsx:738`)
exports the flattened rider fields for `vocabularies.test.ts`. Extend `fieldsOf` to walk it and the
hole closes. Two caveats to carry:

- it is constructed at scope `"item"` only, so a feature-scoped twin is needed for feature rows;
- `GrantsEditor` (`RiderEditor.tsx:618`) is a bespoke component with no `FieldDef`, so `grants`
  legitimately stays on the escape list — **with that reason written next to it**, not silently.

**Ride-alongs, same commit** (the audit's §3 items 1–2, and they are the same guard shape): a census
asserting `MODIFIER_TYPES` covers exactly `FeatureModifierSchema`'s discriminators and that every
`blankModifier(type)` parses. `vocabularies.test.ts` already imports both sides.

**Seed it with three rows**, chosen because each fails today for a different reason:
`EffectGrant.modifiers` (SRD-only, the headline), `uses.scaling: class-resource` (SRD-only, 19
records), monster `attack.bonus` (**test 1 fails today — that is the point**).

**Verified at HEAD, measured:** `npx vitest run src/homebrew/publish-paths.test.ts
src/homebrew/vocabularies.test.ts --project dom` in `apps/client` → 2 files, **23 tests pass**. The
base the harness extends is green.

**Size M.** **Unblocks:** every unit below.

### U2 — `3b`(a): the "Uses are" readback

**reader** `FieldRenderer.tsx:73` (exists) · **content** n/a, a control defect · **control**
`RiderEditor.tsx:428-451` gains the missing `read` · **test** render from a body → assert the select;
change it → assert the body; re-render → assert it survived.

The comment at `:432-433` says `mode` "is read back out of the shape"; it never is, so the select
renders `<option value="">Not set</option>` every time. `usesField` is one component mounted by items
*and* features (`:770`), so the fix lands once. The proposed `read` body in the superseded plan is
correct against HEAD. **Size S (five lines).** **Unblocks:** every `uses` block in the phase becomes
testable by hand — put it before U7, U8, U24.

### U3 — `3a`: the rarity picker

**reader** n/a (rarity is advisory) · **content** `equipment.v1.json` rarities · **control**
`pick: true` renderer flag → `Combobox allowFreeText` · **test** type "unique" → body carries it; pick
"Very Rare" → `"very-rare"`.

**Decide the canonical-list question here, once.** `RARITY_IDS` is a **client-local literal**
(`apps/client/src/homebrew/schemas.ts:596`, six values, no `varies`) and there is no canonical rarity
list in `packages/content-srd-5.2.1/src/enums.ts` the way `DAMAGE_TYPE_IDS` is. Either move it to
`enums.ts`, or U5's proposed pin ("no file under `apps/*/src` declares a literal array holding three
or more slugs") is violated by U3's own file on the day it lands. **Move it.**
`vocabularies.test.ts` deliberately pins rarity open so a GM can type "unique" — **measured, that file
passes at HEAD** — and the client's intent is read as *look and behave like a dropdown*, not *close
the enum*. **Size S.** **Unblocks:** U5.

### U4 — `damage-type-is` on a save-only action

**reader** `action-resolution.ts` `riderFilters.damageTypes`, built once for **both** branches instead
of only inside `action.attack && targets.length === 1` · **content** Draconic Sorcery's Elemental
Affinity already stands on it · **control** already ships (`RiderEditor.tsx:229`) · **test** a
save-only spell (Burning Hands) with a `damage-type-is`-gated `extra-damage` rider now fires.

Smallest real bug in the phase and it under-applies today, which is the safe direction.
`apps/server/test/warlock-sorcerer-wizard.test.ts` pins the current narrow context, so widening it is
noticed. **Size S (~¼d).** Deletes the fourth clause of the `[server/riders]` entry in
`known-bugs.md`.

---

## Wave 1 — the authoring surface, before anything is authored against it

**7 units · ~4 days estimated.** All but U10 are declarative `FieldDef` additions to
`RiderEditor.tsx`, which the audit measured as a surface that takes them
(`modifiersField` is 21 variants as one `rows` field; `whenField` proves nesting is safe).

### U5 — `3d`: nine damage-type pickers

**reader** `combat.ts:29 adjustDamageParts` (exists) · **content** `DAMAGE_TYPE_IDS`,
13 frozen slugs, `packages/content-srd-5.2.1/src/enums.ts` · **control** `pick` on the three `text`
sites (`schemas.ts:743`, `schema.ts:316`, `RiderEditor.tsx:387`) + a visible pick affordance on
`TagInput` for the six tag sites (`schemas.ts:491`, `:813`/`:814`/`:815`, `RiderEditor.tsx:229`, and
the grant kinds at `:596`) · **test** the existing 9-site census in `vocabularies.test.ts:47-57` plus
one round-trip per control kind.

Add `normalizeDamageType()` beside the constant (trim + lowercase) used by both the editor's write
path and the engine's lookup, so `"Fire"` and `"fire"` cannot become two types. Keep
`DamageTypeIdSchema` open. **This must land before Area 3's `4a`**, or the damage engine gets built
against hand-typed data and there is no clean joint test. **Size S.**

### U6 — `EffectGrant.modifiers` — the highest-value row in the phase

**reader** `equipment-derivation.ts:588-595` and `action-resolution.ts:1075` (both exist, both starve)
· **content** **an SRD *feature* carrier, not an item** — Reckless Attack and Superior Defense author
`featureRiders.effects[].modifiers`, and `equipment.v1.json` contains **zero** `modifiers` blocks ·
**control** mount `modifiersField(...)` as a nested `rows` field inside `effectsField`
(`RiderEditor.tsx:542`) · **test** both paths, **crossing carriers** — the editor half authors an
*item* effect, the SRD half reads a *feature* effect, and one assertion body runs over both.

**Today every effect a GM authors is mechanically empty** — a name, some tags, a duration, and
nothing that changes a number. `EffectGrantSchema.modifiers` defaults to `[]`
(`packages/schemas/src/index.ts:560`) and the form says nothing about it.

**Ride-along, same commit:** `maxRows: 1` on item effects (`RiderEditor.tsx:547`) cites an engine
limit that is **real for features** (`character-build.ts:538` takes `effects[0]`) and **false for
items** (`takeEffects` iterates all). Make the cap scope-dependent and fix the copy — this unit is
already in that file.

**Size M** (the scope doc's number, not the audit's half-day-batch framing; see *Disagreements*).
**Unblocks:** U18, U22, and every later unit that needs a GM-authored effect to prove itself.

### U7 — `uses.scaling: class-resource`

**reader** `character-build.ts:327-332` · **content** 19 SRD features (Rage, Bardic Inspiration,
Channel Divinity) · **control** a fifth option on the `mode` select (`RiderEditor.tsx:428`) plus one
`uses.scaling.id` text row · **test** both paths end at a use count. Highest-count single gap in the
uses family: a homebrew class must otherwise duplicate its own printed table into a `by-level` list
beside the table. **Size S.** Depends on U2.

### U8 — `recharge` on `uses.per`

**reader** `rests.ts:77`, `encounter.ts:24` (fully implemented) · **content** 86 monster actions ·
**control** a fifth option at `RiderEditor.tsx:490` · **test** roll the recharge, assert the re-arm.
**Item/action scope only** — `FeatureUsesSchema.per` has no `recharge` member; do not add it to the
feature `usesField` without widening that schema. The client's `3c` Expected names the recharge basis.
**Size S.** Depends on U2. **Unblocks:** U24.

### U9 — `grants.spells`

**reader** `character-build.ts:553` → always-prepared · **content** **41** SRD records (domain spells,
racial spells, every "you always have X prepared") · **control** an eleventh `GRANT_KINDS` entry
(`RiderEditor.tsx:576`) whose "Which" is the spell picker, not a `TagInput` · **test** both paths end
at a prepared spell on a sheet. Ten of eleven grant arrays reach parity; this is the eleventh, and it
is currently *preserved* on write (`:637`) rather than editable — which is not a control. **Size S–M.**

### U10 — monster `attack.bonus`, and `scope` becomes three-valued

**A monster action with an attack roll cannot be published at all.** `actionsField` writes
`attack.ability` (`RiderEditor.tsx:525`); `ActionSchema.attack` requires `bonus`
(`packages/schemas/src/index.ts:592`) and the monster body is validated by `ActorDefinitionSchema`.
The GM fills in "Uses: Strength" and the gate answers `actions[].attack.bonus: Required`. One control,
two schemas, one of them wrong — **423 SRD monster actions author `attack.bonus`.**

**reader** `action-resolution.ts:827` · **content** 423 monster actions · **control** branch
`actionsField` on scope · **test** the harness's test 1, which **fails today** — that is the
acceptance criterion.

**Root cause, and it is the same one the audit names:** `RecordDetail.tsx:231-232` branches **three**
ways for `enabled` (equipment / monster / feature) and then collapses to **two** for `scope`
(`doc.type === "equipment" ? "item" : "feature"`), so a monster is handed scope `"feature"`. Make
`scope` three-valued (`"feature" | "item" | "statblock"`) at `RiderEditor.tsx:335`, `:413`, `:623`,
`:760`. **Correction to the audit:** `actionsField()` takes **no scope parameter at all**
(`RiderEditor.tsx:503`), so this unit also threads scope into it. Small type change; turns a class of
silent bug into a compile error. **Do it as a bug fix with a test, not as a batch item.**
**Size M.**

### U11 — `attack.rangeNormalFeet`

**reader** `action-resolution.ts:512` (long-range disadvantage) · **content** 45 records · **control**
one `kind: "number"` row in `actionsField`'s attack group · **test** an attack past normal range takes
disadvantage, from both paths. **Size S.**

> **Held back from this wave, deliberately: `attack.count`, `attack.criticalBonusDice`,
> `EffectGrant.onEnd` / `.target` / `.endsWithTag` / `.voidWhileIncapacitated`.** The audit's batch 1
> lists all six as cheap `FieldDef` rows. They are — but **every one has zero SRD authors**, so adding
> a control creates six more `editor-only` rows, which is precisely the 30-row mirror defect this
> phase exists to stop. Each may ship the moment a unit authors an SRD record that needs it, or with
> an explicit "no SRD content half" statement and a test that ends at an engine outcome. Not by
> default, and not as a batch.

---

## Wave 2 — the pick family, after the choice panel becomes declarative

**1 refactor + 5 units · ~5 days estimated.** This is the family that started the area.

### R1 — convert `FeatureEditor`'s choice panel to `FieldDef` (a refactor, **not** a unit)

**Measured: `apps/client/src/homebrew/FeatureEditor.tsx` is 651 lines with *zero* `FieldDef`
references** (`grep -c FieldDef` → 0). `extraPicks`, `choices`, `replaces`, `fromPicks`, the spell
window and the ASI ceiling all belong in it, and the audit's batch 2 is six more panels of the same
hand-written JSX.

It has no four parts, so it is not a unit and is labelled as a refactor. It is justified anyway, on a
ground **neither intake states**: **the harness cannot see `FeatureEditor` at all.** `fieldsOf` walks
`SCHEMAS[type].sections`; the feature editor is mounted as a `custom` field, so its controls are
invisible to `applyField` in both directions. **Converting is what puts the pick family under the
guard the phase is built on.** Six bespoke panels would ship with the fourth part of the rule
structurally unavailable.

**Keep as `custom`:** the level-chips control, which writes both `feature.level` and
`levelTable[].features[]` in one edit. `CustomField` (`schema.ts:157`) exists for exactly that.

**Cost, stated honestly:** ~1–1.5d *(estimated)* with **no user-visible change**, so the phase's own
acceptance bar cannot verify it. It therefore lands with a harness assertion that the choice panel's
keys are now reachable from `fieldsOf` — otherwise it is a refactor with no far end, which is the
thing this repo keeps punishing.

### U12 — `choices` (plural)

**reader** `character-build.ts:940`, `build-payload.ts:435` · **content** 3 feat records · **control**
the choice panel becomes a list · **test** the audit's worked example — `applyField("class", draft,
"choices", …)` throws `No field "choices" in the class form` today. **Size S** after R1, **M** before.
This is the purest built-but-unwired case of the session: reachable from `feats.v1.json`, a hard
compile error from all twelve class modules.

### U13 — `extraPicks` (+ `class-resource-growth` scaling)

**reader** `character-build.ts:1075`, `build-payload.ts:429`, `packages/domain/src/pick-budget.ts:59`
· **content** 6 records + 2 option-level · **control** one `rows` field; the offer key needs a picker
over the eight `NAMED_PICK_BUDGETS` (`character-build.ts:194`) plus `feature:<id>` over the record's
own features · **test** both paths end at a **raised capacity**.

**This is the extra-cantrip case that started the area.** Divine Order's Thaumaturge is
`extraPicks: [{ offer: "class-cantrips", amount: 1 }]`, authored 8 times in the SRD, unauthorable from
the editor. **Size M.**

### U14 — `replaces` + `replacesFeatureId`

**reader** `character-build.ts:1245`, `apps/server/src/choice-overrides.ts:65`, cleared by
`rests.ts:87`/`:99`, projected at `projections.ts:283`, commanded by `actor.rechoose` · **content** 2
+ 3 records · **control** one `rows` field (offer + when + amount) and one select over sibling feature
ids · **test** both paths end at a **re-opened settled row**.

The sharpest case in the audit: wired end to end through a command, actor state, rest clearing and a
gated projection — **and a GM cannot author one.** **Size M.**

### U15 — the spell window and the ASI ceiling

**reader** `character-build.ts:170-173` (`withinSpellWindow`) and `:1340` (the ceiling clamp),
`build-payload.ts:446`/`:452` · **content** `maxSpellLevel` 16 records · `minSpellLevel` 4 (Warlock's
Mystic Arcanum) · `maximum` 7 (the Epic Boons) · **control** three numbers on the choice panel ·
**test** both paths end at a **refused out-of-window pick** and at **INT 21**.

**Correction to the scope document — verified, and it shrinks this unit.** S6 sizes this as
"`minSpellLevel` — plus a `maxSpellLevel` control", i.e. a schema change plus consumers. **The schema
half already ships in full:** `character-content.ts:455`, the cross-field refinement at `:477-481`,
both consumers, `packages/domain/src/index.ts:797`, the OpenAPI property, **four SRD records**
(`warlock.ts:233`/`:237`/`:241`/`:245`), and a named test (`apps/server/test/pick-rulings.test.ts:97`,
"ruling H"). **This unit is control-only.** **Size S.** Closes four Warlock rows.

### U16 — `fromPicks` and `FeatureOption.requires`

**reader** `character-build.ts:959`/`:1023`, `packages/domain/src/catalog-choice.ts:194`,
`build-payload.ts:477` · **content** 3 + 8 records · **control** the option row already mounts
`RiderEditor`; these need the choice panel too · **test** both paths end at an option list narrowed to
the character's own earlier answers. **Size M.**

> **`FeatureOption.choices` and `FeatureOption.replaces` are `unused` (0 SRD authors) and stay out.**
> They inherit their readers for free from U12/U14 once the option row mounts the panel; adding
> dedicated controls would create two more editor-only rows.

---

## Wave 3 — the vocabulary the classes are waiting on

**7 units · ~7 days estimated.** Every one is SHARED: new capability both a class feature and a
homebrew author need.

### U17 — `widensPicks` (S5)

**reader** the two consumers that already read `maxSpellLevel` — `character-build.ts` `matchRow` and
`build-payload.ts` `featurePickOffer` · **content** Bard row 55, Magical Secrets, currently mis-wired
at `packages/content-srd-5.2.1/scripts/class-mechanics/bard.ts:74-94` as
`{kind:"spell", choose:2, fromCatalog:"bard-spells"}` — wrong mechanic, wrong list · **control** one
`rows` field on the panel R1 built · **test** both paths end at a **prepared-spell budget whose source
list grew**, not whose capacity did.

Third member of a family whose other two ship: `extraPicks` raises **capacity**, `replaces` re-opens a
**settled row**, neither says "same budget, more lists". Shape:
`widensPicks: [{ offer: <PickBudgetKey>, addCatalogs: [...] }]`. Land it directly after U13/U14 so the
family ships as a family and the panel is built once. **Size M.**

### U18 — `speed` effect modifier (S1)

**reader** `EffectModifierSchema` (`packages/schemas/src/index.ts:232-247`, ten members, **no speed
modifier — confirmed missing**) → `effectiveSpeedFeet` at
**`apps/server/src/condition-rules.ts:44-47`** · **content** an SRD effect that changes Speed ·
**control** one row inside U6's `modifiersField` nest · **test** both paths end at a **movement budget
that changed**.

**Correction to the previous agent's sizing, carried from the scope doc:** the reader is
`condition-rules.ts`, not `movement-rules.ts` — `movement-rules.ts:68` merely calls it. One file
smaller than claimed, and in a file with no movement logic in it. *(Recorded from the scope document;
I did not re-verify this one independently.)*

**Invariant — server authority.** Speed is consumed by the movement budget. The client must not
recompute it; the derived value ships in the projection or nowhere.

**Size M.** **Unblocks mastery `slow` — 7 weapons** — and an entire prose family (Boots of Speed, a
Slow spell, a cursed item; Monk's `unarmored-movement` column is `display: true` and read by nothing).
Depends on U6.

### U19 — `3b`(b): the pool binding

**Absent from the scope document's recommended order entirely.** It is one of the client's four
issues and it is sequenced here.

**reader** `actionPools()` at `apps/server/src/effective-actions.ts:150`, emitted as `pools` at
`apps/server/src/projections.ts:294` under `resourcesVisible` — **verified at HEAD** · **content** 40
SRD records author `uses.pool` · **control** `pick: true` + `suggestions: (ctx) => ctx.pools` on
**both** `uses.pool` (`RiderEditor.tsx:499`) **and** `resource-bonus.poolId` (`:393`) — leaving the
second is a guaranteed re-open · **test** both paths end at a **spend against the named pool**.

**No longer blocked.** The superseded plan's "gated on Area 1 Stage 3" note and its
"`classResources` has zero server readers" recon note are both stale: `pools` ships, and `id` is
exactly the `actionUses` key (`uses.pool ?? action.id`) the engine spends and re-arms.

The editor has no character in hand, so the buildable form is **every pool the merged catalog
declares**, with an unmatched pool degrading to a private counter — which is already the runtime
behaviour. **Do not add a refusal**; a GM handing a paladin item to a fighter is a normal table event.

**Invariant — projection.** The pool list must be scoped through `catalogFor(principal)` or a player
learns the GM's unpublished homebrew pool names. **Size M.**

### U20 — the weapon-swing override (S3)

**reader** the standing rider pass `extra-attack` already uses (`effective-actions.ts:101`), applied
in `weaponAbilityModifier` (`equipment-derivation.ts:978-986`) · **content** Monk's `martial-arts`
column — **measured from `classes.v1.json`: `1d6`/`1d8`/`1d10`/`1d12` at levels 1/5/11/17** ·
**control** a rider variant in `modifiersField` · **test** both paths end at a **quarterstaff swing
that rolls the Monk die off Dexterity**.

**The largest visible class-content gap left.** A Monk 5 at DEX 15 / STR 12 gets
`Quarterstaff +4 (1d6+1)` — Strength, and the printed `1d8` nowhere. A swing is derived at read time
by `deriveEquipment`, which holds no class table, so the die goes on the definition (or the class row
reachable from the derivation) — **never a hard-coded "if monk" inside `weaponAbilityModifier`.**
Shape: `weapon-swing`, scoped by `weapon-property-is`/category, carrying `die?` and
`ability?: "best-of-str-dex"`.

Homebrew half is item-shaped SRD language: "this weapon rolls 1d8 in place of its normal damage";
"you may use Dexterity with this weapon." **Size L.**

### U21 — bonus-action component pools (S4)

**reader** `evaluateActionEconomy` (`action-resolution.ts:255-301`), which today opens a component
instance only inside the `onOwnTurn && action.activation === "action"` branch — the bonus-action
branch at `:255-257` only sets `bonusActionUsed` · **content** Flurry of Blows, and 126 SRD records
author `multiattack` · **control** **there is no `multiattack` control anywhere in the homebrew
editor**; `RiderEditor.tsx:517` offers `activation` and nothing else. Its absence is currently
deliberate (`schemas.ts:834`) — this unit reverses that for the action/item scope · **test** both
paths end at **two swings handed out on a bonus action**.

**Invariant — role boundaries.** The economy is what refuses a player's off-turn action. Widening it
must not widen *who* may act: the `onOwnTurn` guard stays. **Size L.** **Unblocks mastery `nick` (4
weapons)** and closes Flurry of Blows.

### U22 — target-scoped effects (S2) — **viewer-safety change**

**reader** the advantage collector (`action-resolution.ts:548`), swept by `effects.ts` · **content**
an SRD "advantage on your next attack against a creature you hit" record · **control** one row in U6's
`modifiersField` nest · **test** both paths end at an **advantage that applies against one named foe
and not another**.

`EffectInstanceSchema` (`packages/schemas/src/index.ts:280-309`) carries `sourceActorId` and no
"against actor X" field; the `versus-*` triggers narrow by creature **type**, **size** and
**condition**, never identity. There is nowhere to hang "against this one foe."

> **Invariant — projection is the security boundary.** An effect naming a **target actor id** puts a
> new id on the wire. `apps/server/src/projections.ts:247` already strips `sourceActorId` from
> player-visible effects **for exactly this reason**; the new field needs the same treatment or a
> player learns which hidden monster the GM is aiming at. **Pair this unit with a
> `docs-viewer-safety` review and treat "when in doubt, omit it" as binding.**

**Size L.** **Unblocks mastery `vex` — 8 weapons, the largest single mastery.** Depends on U6.

### U23 — `extra-damage`, "same type as the triggering damage" (S7)

**reader** `action-resolution.ts:974` · **content** Evoker's Empowered Evocation, which has no correct
type to author today — Fireball is Fire, Lightning Bolt is Lightning · **control** a "same as the
triggering damage" option beside the type picker U5 built · **test** both paths end at a **rider whose
damage type matches the weapon's**.

`ExtraDamageVariantSchema` requires `damageType`. Homebrew half: "+2 damage of whatever type this
weapon deals" is unsayable. **Size S–M.** Depends on U5.

---

## Wave 4 — the mace

**2 units · ~2–3 days estimated.** The client's own reported issue, split because it is two
independent bugs. Do it after U2 (working "Uses are") and U8 (recharge) so the mace can actually be
authored as reported.

### U24 — `3c`(1): the item's own `uses` block is read by nothing

**reader** — **this is the missing half.** `usesOf` (`equipment-derivation.ts:822`) has exactly two
call sites, an *action's* own uses (`:892`) and a *cast's* own uses (`:929`). The equipped loop
(`:601-627`) reads `modifiers`, `grants`, `effects`, `actions`, `casts` and `grantsFeatIds` and never
`record.uses`; `weaponAction` (`:988-1010`) builds its `ActorAction` with **no `uses` key at all** ·
**content** the client's mace, 1/short rest · **control** already ships · **test** four far ends — a
rolled number, a spent counter, a refusal naming `1/short rest`, a re-arm on a short rest.

**Cheaper than the superseded plan sized it:** the equipped loop already calls
`catalog.equipmentRecord(entry.item.id)` one line below, at `:644`, for the weapon's mastery. The
record the fix needs is in hand at the call site. Give `weaponAction` an optional `uses` and spread
`usesOf(record.uses)`; for non-weapons synthesise an `activation: "other"` action mirroring the
feature path, so items and features behave alike. **Rejected:** a separate "Use *Item*" action beside
the swing — the GM authored one charge on one mace and would get two rows.

**Watch:** `rests.ts` and `encounter.ts` iterate `effectiveActions`, so the new `uses` re-arms for
free — but a `per: "recharge"` value (U8) now newly reaches the recharge roll. **Size M.**

### U25 — `3c`(2): the extra damage resolves and never renders

**reader** — three hops, all confirmed at HEAD by the scope document: (1) `withStandingRiders`
(`effective-actions.ts:44-73`) folds four rider kinds and correctly excludes at-its-moment
`extra-damage` (collected at `action-resolution.ts:965`), so `srv.damage` is base-only and
`CharacterSheet.tsx:792` prints one line; (2) `CharacterSheet.tsx:803` rolls `rollFlat(part.formula)`
with no riders, and `structuredAttacks` (`:228`) is false unless a fight is live **and** it is that
player's turn; (3) `addFromCatalog` (`:548-560`) sends no `equipped`, and `itemIsActive`
(`equipment-derivation.ts:385-389`) requires it, so a freshly added item contributes nothing ·
**content** the client's mace, +1d6 lightning · **control** already ships · **test** the sheet shows
both damage lines **before** the roll, and one resolution produces both bludgeoning and
`{1d6, lightning, total}`.

Expose `extraDamage: readonly {formula, type, when}[]` through the derivation and render it beside the
base part, marked conditional. **Do not fold it into `action.damage`** — that double-rolls. Take the
ruling already written at `equipment-derivation.ts` — when `srv` exists, route the damage chip through
the server. **Size L.**

**In the same commit as U25:** fix `docs/ai-ledger/current-state.md:54`. "Every field the item editor
offers reaches the fight" is overstated. `apps/server/test/homebrew-inert-fields.test.ts` is 383 lines
over six rows *(measured)*; **item-level `uses`, `extra-damage` display, `armor.*`, `cursed`,
`rarity`, weapon range bands, `tags` and `weapon.mastery` are all uncovered.**

---

## Wave 5 — the inert readers: 16 rows, placed

**7 units · ~2.5 days estimated.** Each of the audit's 16 `declared, no reader` rows is here, by name.
None ships a new control — these are readers for controls that already exist, which is why they sit
after the authoring surface rather than before it.

### The five one-line fixes — one agent, one day, five commits

| # | row | the one line | test's far end |
| --- | --- | --- | --- |
| **U26** | `spell-attack-bonus` | collected into `equipment-derivation.ts:676`, applied nowhere; its sibling `spell-save-dc` **is** folded at `effective-actions.ts:51` — the same fold, missing one call | a spell attack roll that moved |
| **U27** | `roll-mode` roll `check` | `equipment-derivation.ts:773` already collects at `on-ability-check`; it sums `check-bonus` and drops `roll-mode` | an ability check rolled with advantage |
| **U28** | `unarmored-defense.allowShield` | stored at `character-build.ts:573`; `:1613` reads only `.ability` — and it is a real 5e distinction (Barbarian allows a shield, Monk does not) | an AC that differs with a shield |
| **U29** | `attack-kind-is: "spell"` | an action with a `spellId` is a spell attack; one line in `attackKindsOf` (`action-resolution.ts:512`) | a rider gated on `["spell"]` that fires |
| **U30** | `spell-school-is` + `spell-level-is` | `action-resolution.ts:800` already sets `spellId`; school and level are a catalog lookup away | a school-gated rider that fires |

U29 and U30 are the remainder of the scope document's **S8**; with U4 they retire the fourth clause of
the `[content/vocabulary]` entry in `known-bugs.md` and unblock Innate Sorcery, Empowered Evocation
and Elemental Affinity. **Each S.**

### The two pairs that share one new call site

- **U31 — `on-taking-damage` + `damage-reduction`.** No incoming-damage path collects riders at all
  (`apps/server/src/hit-points.ts` reads `actor.effects`, never carriers). One new `collectRiders`
  call beside the typed-defence pass closes both. Flat reduction applies **after** immunity /
  resistance / vulnerability, per total, floored at 0 — the rule `combat.ts:29-42` already states.
  **Size M.**
- **U32 — `on-death-save` + `roll-mode: death-save`.** `death-saves.ts:44` reads only the caller's
  chosen mode. One new call site closes both, and death saves are exactly where a magic item wants to
  help. **Size S.**

### U33 — the labelling sweep: six rows that are a claim, not a bug

One commit, no behaviour change, and it is the honest end of the inventory:

| row | ruling |
| --- | --- |
| `darkvision` | **Keep, labelled.** There is no senses model; the trait prose carries it. Authored 7 times. Already `note: "Display only."` |
| `sense` | **Downgrade or render.** `darkvision` is at least honest — the prose says "Darkvision 60 ft". `sense` has neither a reader nor a display. Render it on the sheet beside darkvision, or delete the variant. |
| `featureRiders.tags` | **Fix the claim.** 44 SRD records author it, it crosses the wire as `ContentFeatureSummary.tags` (`packages/domain/src/index.ts:807`), nothing groups by it, and the editor calls it "grouping only". Either group the sheet by it or stop shipping it over the wire. |
| `roll-mode: concentration` | **Delete or route.** The concentration save is a normal CON save (`hit-points.ts:175` mints a plain one); either route it through `saving-throws.ts`, where `roll: "save"` already works, or drop the enum member. |
| `on-spell-cast` | **Defer with a note.** No spell-cast pipeline collects riders; `spell-id-is` fires from the action path instead. |
| `versus-creature-type` | **Defer, already labelled** (`RiderEditor.tsx:236`). Closing it means promoting creature type to a first-class `ActorDefinition` field — it lives only in the `open5e.srd-2024` extension bag today. |

**Size S.**

---

## Wave 6 — the masteries, reordered by weapons covered

**5 units · ~5 days estimated.**

**Measured directly from `packages/content-srd-5.2.1/bundles/weapons.v1.json` (I reproduced the scope
document's count): 38 of 38 weapons carry a mastery — vex 8 · slow 7 · sap 6 · topple 5 · nick 4 ·
push 4 · graze 2 · cleave 2.** `IMPLEMENTED_MASTERIES` is `{graze, sap}`
(`equipment-derivation.ts:247`), so **30 of 38 weapons carry a mastery that does nothing.**

**The ordering rule is weapons-covered per day, with the invariant-heaviest last.** That moves vex (8)
and slow (7) — 15 weapons between them — out of the mastery wave entirely: they ride the SHARED units
that unblock them, **U22** and **U18**, in Wave 3. Cleave (2 weapons, ~1–1.5d) is the worst
weapons-per-day in the set and goes late. What remains:

| # | mastery | weapons | blocker | size |
| --- | --- | ---: | --- | --- |
| **U34** | `topple` | 5 | a Constitution save the **weapon** triggers; the save path is `action.save`-declared and `weaponAction` declares none | ~½d *(estimated)* |
| **U35** | `nick` | 4 | moves the Light property's extra attack out of the bonus action — the same turn-economy branch **U21** opens | ~1d *(estimated, and cheaper after U21)* |
| **U36** | `cleave` | 2 | a second attack roll at a **different** creature inside one resolution | ~1–1.5d *(estimated)* |
| **U37** | `push` | 4 | the attack path must write a token position | ~1.5d *(estimated)* |

Each unit's four parts are the same shape: **reader** the mastery's behaviour in
`action-resolution.ts`; **content** the SRD weapons that already carry the slug; **control** none —
`weapon.mastery` is a closed 8-slug enum and implementing a slug adds no authorable vocabulary
(**that is U38's job**); **test** a rolled number / applied condition / moved token, driven from a
weapon record.

> **Invariant flags on U37 `push` — largest risk in the phase, scheduled last and alone.**
> **Server authority + projection + mobile parity.** The attack path would write a token position,
> which today only `apps/server/src/token-placement.ts` does. It must route through the same snapping,
> the same footprint rules and the same fog recomputation (`apps/server/src/fog.ts`) — **a second
> position writer is how a client-authoritative move gets in.** And a forced move that lands
> off-screen on a phone is a mobile-parity failure the desktop never sees.

### U38 — `weapon.mastery` on a homebrew weapon — **last, and gated**

**reader** `masteryByActionId` (`equipment-derivation.ts:638-649`), which requires *mastery ∧ unlocked
∧ implemented* · **content** all 38 SRD weapons · **control** one row in the weapon block at
`apps/client/src/homebrew/schemas.ts:739-746`, which is five rows today (category, damage dice, damage
type, range, long range) and none of them `mastery` · **test** both paths end at the mastery firing.

**This is the eighth built-but-unwired of the session and it is three days old.** Commit `c2fef2e`
added `mastery` to `EquipmentWeaponStatsSchema` (`packages/content-srd-5.2.1/src/schemas.ts:233`),
which flows to `HomebrewEquipmentWeapon` in the generated OpenAPI document, and **its own commit
message says a GM authoring a homebrew weapon should be able to give it a mastery.** There is no such
field. `WEAPON_MASTERY_IDS` is *already imported* into `apps/client/src/homebrew/useSchemaContext.ts:17`
for the `weapon-property-is` trigger, so the vocabulary is in hand and the control is one line. Both
parity directions passed; **a control has no parity direction to catch it** — which is precisely what
U1 fixes.

**Size XS — and it must not ship until all eight slugs reach**, or it offers a GM six choices that do
nothing. `masteryReaches` (`equipment-derivation.ts:257`) is the honest gate throughout: **a slug
joins `IMPLEMENTED_MASTERIES` in the same commit that adds its behaviour and its test, never before.**

---

## The client's `3a`–`3d`, by name

The contract is the client's own Observed/Expected text in
[`feature-implementations-plan.md`](feature-implementations-plan.md) lines 253–309. **Each closes by
name; none dissolves into vocabulary work.**

| issue | the client said | corrected diagnosis | unit | closed when |
| --- | --- | --- | --- | --- |
| **`3a`** | "Item rarity is free-form." | **Not free-form.** It is `kind: "text"` + `suggestions` → an `<input list>` + `<datalist>` with no visible affordance (`schemas.ts:649`, `FieldRenderer.tsx:347-382`), rendering as *nothing* on iOS Safari. `vocabularies.test.ts` **deliberately pins it open** so a GM can still type "unique" — *measured: that file passes at HEAD.* The intent is "look and behave like a dropdown," **not** "close the enum." | **U3** | rarity is a visible dropdown that still accepts a custom value |
| **`3b`(a)** | "The 'Uses are' dropdown will not hold a value." | **Correct as reported.** A `write` with no `read` (`RiderEditor.tsx:428-451`); the comment at `:432-433` claims a readback that never happens. Not a controlled-input bug, not `defaults.ts`, not `useAutosave.ts` — **the chosen shape was saving correctly all along.** | **U2** | "Uses are" survives a reload |
| **`3b`(b)** | "The shared pool is free-form text, so it cannot refer to anything real." | **No longer blocked.** The superseded plan's "gated on Area 1 Stage 3" and "there is currently no pool to bind to" are both stale — `pools` ships at `projections.ts:294`. The Expected's "pools available on **the character**" is still not buildable (an item is authored once and carried by anyone); the buildable form is every pool the merged catalog declares. **Functionally identical for Lay on Hands.** | **U19** | picking "Lay on Hands" spends a Lay on Hands use |
| **`3c`** | "The extra lightning damage and the limited use never appear." | **Correct as reported, and it is two independent bugs**, not one. Bug 1 is a missing reader (item-level `uses`); bug 2 is a display gap plus an equip gap on newly added items. | **U24, U25** | the mace: 1/short rest, +1d6 lightning, **both damage lines shown before the roll**, a spent counter, a refusal naming `1/short rest`, a re-arm on a short rest |
| **`3d`** | "Damage type is an unconstrained field." | **Not free-form.** Same `<datalist>` shape as `3a`; `vocabularies.test.ts:47-57` already asserts all 13 types are offered at all 9 sites. Nine sites re-counted at HEAD. Keep `DamageTypeIdSchema` open — a GM must still be able to type a homebrew damage type. | **U5** | every damage-type control is a visible dropdown that still accepts a custom value |

**Do not read the audit's 66 `parity` verdicts as "`3a`/`3d` are already done."** `parity` means a
control *exists* — `extra-damage.damageType` is `parity` at `RiderEditor.tsx:387` **and** is one of
`3d`'s three `text` sites. `3a` and `3d` are about the control's **affordance**, which no verdict in
that document measures.

---

## Invariant touchpoints

| unit | invariant | what to watch |
| --- | --- | --- |
| **U37 `push`** | **Server authority · projection · mobile parity** | A second token-position writer. Route through `token-placement.ts` snapping and footprint rules and `fog.ts` recomputation, or a client-authoritative move gets in. A forced move landing off-screen on a phone is a mobile-parity failure. **Largest risk in the phase; last and alone.** |
| **U22 target-scoped effects** | **Projection is the security boundary** | A new **actor id** on the wire. `projections.ts:247` already strips `sourceActorId` from player-visible effects for exactly this reason. Pair with a `docs-viewer-safety` review. When in doubt, omit the field. |
| **U19 pool binding** | **Projection** | The pool list must be scoped through `catalogFor(principal)` or a player learns the GM's unpublished homebrew pool names. |
| **U18 `speed`** | **Server authority** | Speed feeds the movement budget (`movement-rules.ts:68` → `condition-rules.ts:44`). The client must not recompute it; the derived value ships in the projection or nowhere. |
| **U21 bonus-action pools** | **Role boundaries** | The economy is what refuses a player's off-turn action. Widening *what* may be done must not widen *who* may act — the `onOwnTurn` guard stays. |
| **U5, U6, and every editor unit** | **Mobile parity** | All add controls to `/homebrew`, which the round-2 route audit already reports red on. Re-run `node scripts/tap-audit.mjs 375`; **the count must not rise**, and every new control is checked at a narrow viewport. |
| **U10, U38** | **Projection** | Both change what a published body may carry. A homebrew record reaches players through the catalog projection; new keys ride along. |

---

## Disagreements between the two intakes, resolved

Each was settled against the code, and each is a finding rather than bookkeeping.

**1. Where the editor-side test harness lives.** One reading of the audit places `publish-paths.test.ts`
under the server test directory; the audit itself names
`apps/client/src/homebrew/publish-paths.test.ts:60`–`:75`. **The audit is right — there is no such file
in `apps/server/test/`** (the seven `homebrew-*` files there are http, ids, inert-fields, store,
usages, validate, visibility). This is not pedantry: it decides the harness's home, and the wrong
home is what produced the "lift three helpers into a shared module" cost estimate.

**2. The harness's cost — both intakes overstate it.** The audit calls the helper lift "the only real
cost." **The mechanism already exists.** `apps/client/vitest.config.ts` declares a second,
node-environment project for `*.mirror.test.ts` whose documented purpose is importing the server's own
modules, and `apps/client/src/builder/server-offers.mirror.test.ts:4` already does it. The extraction
is same-directory, not cross-workspace. **Cost drops from a refactor to a file move.**

**3. The harness has a hole exactly where its headline rows are — neither intake records it.**
`applyField`'s throw, the guarantee the whole pattern rests on, **is bypassed for six keys** by the
`RIDER_KEYS` escape hatch at `publish-paths.test.ts:70`–`:77`. Effect `modifiers`,
`uses.scaling: class-resource`, `recharge`, `attack.bonus` and `grants.spells` all sit inside those
six. **Resolved:** extend `fieldsOf` over `RIDER_FIELDS_FOR_TEST` (`RiderEditor.tsx:738`), which was
exported for `vocabularies.test.ts` and does most of the job already. `grants` stays exempt, with the
reason written down.

**4. `minSpellLevel` — the scope document and `known-bugs.md` are both stale; the audit is right.**
S6 sizes a schema field plus two consumers; `known-bugs.md`'s `[content/vocabulary]` entry (1) says
"Needs the schema field plus the two consumers that already read `maxSpellLevel`". **Verified: it all
ships** — `character-content.ts:455`, the cross-field refinement at `:477-481`, `character-build.ts:170-173`,
`build-payload.ts:452`, `packages/domain/src/index.ts:797`, the OpenAPI property, **four SRD records**
(`warlock.ts:233`/`:237`/`:241`/`:245` → `classes.v1.json`), and `apps/server/test/pick-rulings.test.ts:97`
("ruling H"). **U15 is control-only and drops from M to S.** Clause (1) of that ledger entry is due
for deletion.

**5. Effect `modifiers` — the audit is right about the mechanism, the scope document is right about
the size.** The audit puts it in a "~8 controls, half a day" declarative batch; the scope document
sizes H1 at **M** alone. The size wins, and the reason is the rule: the unit is not "add the field",
it is reader + content + control + test. **Its content half crosses carriers** — the editor authors an
*item* effect, but the only SRD records that author `effects[].modifiers` are *features* (Reckless
Attack, Superior Defense), because `equipment.v1.json` contains **zero** `modifiers` blocks. A
both-paths test that spans two carriers is not half a day.

**6. The audit's own headline arithmetic is wrong.** It states "**41 of those 41 `SRD-only` rows
concentrate in two families**, the pick/choice vocabulary (17) and the action vocabulary (13)."
17 + 13 = **30**, and the section split it prints one paragraph earlier (A 17 · B 3 · C 3 · E 3 · F 1 ·
H 13 · I 1) sums to 41 correctly. **30 of 41 concentrate; the other 11 are spread across uses, grants,
effect-modifiers and record-level rows** — which matters, because those 11 are the ones a
family-shaped plan would miss. Every other count in that document reconciles: 66 + 41 + 30 + 16 + 17 =
170. ✓

**7. Mastery counts — the two agree, and I reproduced them.** Measured from `weapons.v1.json`:
`{topple:5, vex:8, slow:7, nick:4, sap:6, graze:2, cleave:2, push:4}`, 38 of 38 records. Implemented =
graze 2 + sap 6 = 8, so **30 of 38 inert** — the scope document's N4 stands exactly. What changes is
the *ordering* it implies: vex and slow are 15 weapons between them and ride Wave 3, cleave is 2
weapons at ~1–1.5d and goes late. **The scope document's Wave 4 order `topple → cleave → push` is
nearly right but misplaces `nick`**, which belongs beside U21's turn-economy work, not in the mastery
wave's tail.

**8. `3b`(b)'s blocked-ness — the superseded plan is stale, the scope document is right.**
`actionPools()` is at `effective-actions.ts:150` (the plan says `:115`) and `pools` is emitted at
`projections.ts:294` — **verified**. Both the plan's "Gated on Area 1 Stage 3" and its recon note that
"there is currently no pool to bind to" are dead.

**9. `slow`'s reader file.** The previous agent named `movement-rules.ts`; the scope document corrects
it to `condition-rules.ts:44-47`. **Recorded as resolved in the scope document's favour; I did not
re-verify it independently.**

**10. `FeatureEditor.tsx`'s size.** The audit says "650 lines"; **measured, 651**, with **zero**
`FieldDef` references. Trivial as a number, load-bearing as a fact: the file is not on the declarative
surface at all, which is what R1 turns on.

**11. `3b`(b) is missing from the scope document's sequence.** Its recommended order lists 18 items
(H9, S8-third, H7, H8, H1, H6, H4, S6, S1, S5, H2, H3, H11, S3, S4, S2, S7, C2, H5) and **H10 is not
among them**, though the split table sizes it at M. One of the client's four issues had no place in
the build order. **Resolved: it is U19.**

### Stale claims measured by the intakes — delete, do not soften

All four were re-measured; deletion is the repair this repo prefers.

- **`known-bugs.md` `[content/feats]` — Epic Boon `maximum`.** **Measured, and it is false at HEAD:**
  all seven `boon-of-*` records in `feats.v1.json` carry `maximum: 30`
  (`combat-prowess`, `dimensional-travel`, `fate`, `irresistible-offense`, `spell-recall`,
  `the-night-spirit`, `truesight`). **Delete the entry.** Its secondary claim that
  `apps/server/test/warlock-sorcerer-wizard.test.ts` "pins the current value at 20" needs a re-read in
  the same pass. Closed by **U15**, whose SRD content half is exactly those seven records.
- **`known-bugs.md` `[content/vocabulary]` clause (1) — `minSpellLevel` has no sibling.** False; see
  disagreement 4. **Delete the clause.** Closed by **U15**.
- **`known-bugs.md` `[testing]` — "Only the choice-bearing ones (46 of 185) carry structured
  riders."** The scope document measured **176 class features + inline options, 120 carrying a
  mechanic, 0 stubs**; **61 subclass features, 38 carrying a mechanic, 0 stubs**. *(Their measurement,
  not re-run here.)* **Rewrite with the real numbers or delete.**
- **The superseded plan's "`extraPicks` known limit: `amount` is a flat 1–5."** Stale —
  `ExtraPickSchema.scaling = {type: "class-resource-growth", id}` ships
  (`character-content.ts:314-350`, `packages/domain/src/pick-budget.ts`) and is authored by
  `warlock.ts:52`, `fighter.ts:23`, `barbarian.ts:70`. **Delete the note** in the commit that lands
  **U13**.
- **`current-state.md:54` D21 — "Every field the item editor offers reaches the fight."** Overstated;
  the covering test is 383 lines over six rows *(measured)*. **Fix the line in U25's commit**, with
  the uncovered list named.

---

## Deliberately not in this phase

Each with the reason, so nobody re-solves it.

| item | why not |
| --- | --- |
| **Row 24 — Warlock's Lessons of the First Ones (pass ordering)** | A `{kind:"feat"}` nested in an option cannot be answered: `character-build.ts` settles feat-kinded rows in pass A and chosen options in pass A2, so the offer does not exist yet when the feat row is matched. The fix is **a fourth build pass** (ruling E, `stage-4-authoring-assignments.md:246-257`) — its own change, not a unit. **And the editor cannot author the shape at all**: option depth is capped at 1 (`FeatureEditor.tsx:555-556`, stated in its own comment), so there is no homebrew half to pair it with. Authoring it today would make the invocation *untakeable*. |
| **Leveled-spell actions / "which pool pays for this spell"** | The blocker is measured, not assumed: an action would carry `spellSlot`, a Warlock 5's only slots are level 3, and Ascendant Step's Levitate costs none. **The homebrew item path already models this** — a cast row carries `consumesSpellSlot`. Copy the item's shape when it is taken up; do not invent a second one. |
| **Cantrip damage scaling (`spellEffectAt` + `cantripActionFor`)** | Must be fixed **together** or the sheet prints two different numbers on one row. The rows already exist in SRD content; the homebrew half (`castingOptions` on a homebrew spell, seeded to `[]` at `defaults.ts:144`) belongs with Area 1's spell work. |
| **`overlay.ts` exposing `choices`; qualified `weaponProficiencies` slugs** | ETL/content-pipeline shapes with no editor surface, so no four parts. `overlay.ts` was frozen for Stage 4; `martial-light` and `martial-finesse-or-light` are consumed by nothing and `WEAPON_GRANT_SUGGESTIONS` (`RiderEditor.tsx:606`) offers only the two unqualified slugs. |
| **`legendary.cost`, `save.dc: "spellcasting"`, `save.dc` derived, `damageByLevel`, `onHit`, `targetRules`, `reaction`, `requiresEffectTag`, `multiattack` on a *feature*** | The remaining `SRD-only` action rows. Several are deliberate omissions with the reason in `schemas.ts`; all are monster-authoring depth rather than the class/homebrew joint this phase closes. U10 makes the *carrier* correct, which is the precondition for any of them. |
| **`EffectGrant.onEnd` / `.target` / `.endsWithTag` / `.voidWhileIncapacitated`, `attack.count`, `attack.criticalBonusDice`, `FeatureOption.choices` / `.replaces`** | Engine readers exist; **zero SRD authors**. Adding controls creates more `editor-only` rows — the exact mirror defect. Ship each the day a unit authors an SRD record that needs it. |
| **The `amount`-seven-times bounds table** (`RiderEditor.tsx:372`–`:378`) | The audit is right that seven mutually exclusive controls for one key, held together only by seven `visibleWhen`s agreeing, is "the first thing that will break silently." But it is a refactor with no vocabulary and no far end, and U1's census test covers the adjacent risk (`MODIFIER_TYPES` drifting from the schema). Take it when a 22nd variant lands. |
| **`versus-creature-type`, `on-spell-cast`** | Both need a new first-class fact — creature type promoted off the `open5e.srd-2024` extension bag, and a spell-cast pipeline that collects riders. Labelled in Wave 5's U33 rather than built. |

---

## Acceptance bar for the phase

1. **The client's mace works as reported** — 1 use per short rest, +1d6 lightning, and the sheet shows
   **both damage lines before the roll**. Proved with four far ends: a rolled number, a spent counter,
   a refusal naming `1/short rest`, a re-arm on a short rest.
2. **Every rarity and damage-type control is a visible dropdown that still accepts a custom value**,
   and "Uses are" survives a reload.
3. **No unit ships one-ended.** For each unit, one test drives the SRD path and one drives the
   homebrew path, and **each fails when its own consumer is disabled**. Non-vacuity is *measured* per
   unit, not asserted.
4. **`masteryReaches` stays the honest gate.** A slug joins `IMPLEMENTED_MASTERIES` in the same commit
   that adds its behaviour and its test, never before — and U38 does not ship until all eight reach.
5. **`node scripts/tap-audit.mjs 375` on `/homebrew` does not rise**, and every new control is checked
   at a narrow viewport.
6. **The five stale claims above are deleted or corrected** in the commits that prove them stale, and
   `npm run docs` is re-run after any state/command/HTTP/OpenAPI change.

---

## Totals

**38 units + 1 refactor across 7 waves. ~28–31 agent-days, estimated by reading the code — not
measured by building any of it.**

| wave | units | ~days | what it buys |
| --- | ---: | ---: | --- |
| 0 — the guard | 4 | 2 | every later unit self-checks; two of the client's four issues close |
| 1 — the authoring surface | 7 | 4 | GM-authored effects stop being decorative; monsters become publishable |
| 2 — the pick family | 5 (+R1) | 5 | the extra-cantrip case that started the area |
| 3 — class vocabulary | 7 | 7 | Monk weapons, Flurry, row 55, masteries vex + slow, `3b`(b) |
| 4 — the mace | 2 | 2–3 | the client's `3c` |
| 5 — the inert readers | 7 | 2.5 | all 16 `declared, no reader` rows placed |
| 6 — the masteries | 5 | 5 | the remaining 30-of-38 weapons, then the control |

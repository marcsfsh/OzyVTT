# Pre-Stage-4 census: every pick or grant the content promises and no rider delivers

**Status:** audit only. Read-only sweep of `packages/content-srd-5.2.1/bundles/` (classes,
subclasses, species incl. lineages, backgrounds, feats) cross-checked against the vendored
`packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/classes.md`. Nothing here is a fix.

**Why it exists.** A Cleric took Divine Order → Thaumaturge (*"You know one extra cantrip from the
Cleric spell list"*) and the wizard still capped cantrips at 3. The question that matters is not
"how do we fix Cleric" but *"how many more of these are there?"* — the answer is below.

---

## 1. Headline count

> **66 records promise a pick or a grant that no rider delivers today.**

Every one was verified against the bundle record, not the prose — each carries either no rider block
at all, or a rider that does not cover the promise. The sweep walked **373 feature-bearing records**
(176 class features, 42 class-feature options, 61 subclass features, 33 species traits, 6 species
trait options, 36 lineage traits, 19 feats); 66 of them are gaps.

### By carrier kind

| carrier kind | records swept | gaps | rate |
|---|---:|---:|---:|
| class feature | 176 | 33 | 19% |
| class-feature **option** (all 28 Warlock invocations, 10 Metamagic, 2 Divine Order, 2 Blessed Strikes) | 42 | 18 | 43% |
| subclass feature | 61 | 11 | 18% |
| feat | 19 | 4 | 21% |
| species trait / lineage trait / species option | 75 | **0** | 0% |
| background feature | 0 (backgrounds carry no `features[]`) | **0** | — |
| **total** | **373** | **66** | 18% |

**Two confirmed zeros.** Species and lineages are clean — every trait that promises something either
carries the rider (`grants.spells`, `grants.damageResistances`, `choice`, `modifiers`) or promises
nothing structural. Backgrounds are clean by construction: they have no `features[]` at all, and
their promises (ability spread, origin feat, skills, tools, equipment) ride top-level fields the
builder already reads.

### By promise category (primary category per record)

| category | gaps | what it is |
|---|---:|---|
| granted spell (always-prepared / at-will) | 21 | `grants.spells` never authored |
| a free feat from a named list | 10 | 9 × Epic Boon + Lessons of the First Ones |
| a spell the player picks | 9 | Mystic Arcanum ×4, Magic Initiate ×3, Magical Discoveries, Pact of the Tome |
| pick one of N named mechanical options | 6 | Primal Order, Elemental Fury, Elemental Affinity, Fiendish Resilience, Hunter's Prey, Defensive Tactics |
| **pick budget that must follow a printed column** | 3 | Eldritch Invocations, Barbarian + Fighter Weapon Mastery |
| pick over the character's **own** prior picks | 3 | Agonizing Blast, Eldritch Spear, Repelling Blast |
| read-back of an earlier choice | 3 | Improved Blessed Strikes, Improved Elemental Fury, Nature's Ward |
| extra skill proficiency | 2 | Primal Knowledge, Bonus Proficiencies |
| extra language | 2 | Druidic, Thieves' Cant |
| catalog list **plus** one inline option | 2 | Paladin + Ranger Fighting Style (Blessed / Druidic Warrior) |
| expertise | 1 | Deft Explorer |
| tool proficiency | 1 | Skilled (the "or tools" half) |
| weapon proficiency | 1 | Pact of the Blade |
| beast forms from the monster catalog | 1 | Wild Shape known forms |
| widen an existing budget's source list | 1 | Magical Secrets |
| **total** | **66** | |

**Where the damage concentrates.** Warlock alone owns 25 of the 66 (7 class features + 18 invocation
options). Druid owns 6, Paladin 4, Ranger 4. Nine of the twelve classes lose their level-19 Epic Boon
outright. Cleric — the class that produced the bug report — has exactly **one** remaining gap.

---

## 2. The work list

Sorted by how badly it bites a real player: budgets that silently under-offer first, then whole
features that do nothing, then the tail.

**Legend for "expressible?"**
`today` = authorable with the vocabulary now in `packages/content-srd-5.2.1/src/character-content.ts`, no engine change ·
`partly` = one half of the promise is authorable, the other is not ·
`new` = needs machinery that does not exist even with `extraPicks` in hand.

> **This census was taken against the working tree with the `extraPicks` rider already landed**
> (`ExtraPickSchema` / `PickBudgetKeySchema`, summed on both sides, validated against the offers a
> build really has). The rider changes *how* several of these gaps get fixed — usually making them
> cheaper — but it does not close any of them, because none of the 66 records below carries an
> `extraPicks` block. The count is unaffected by it.

### Tier 1 — budgets that under-offer silently (a level-20 build is simply wrong)

| # | record | kind | level | what the text promises | category | expressible? | notes |
|---:|---|---|---:|---|---|---|---|
| 1 | `warlock` / `eldritch-invocations` | class | 1 | "you gain more invocations … as shown in the Invocations column" | pick-budget scaling | **new** | `choice.choose: 1`, granted once at L1. The printed column runs **1 → 10** (L1 1, L2 3, L5 5, L7 6, L9 7, L12 8, L15 9, L18 10). A level-20 Warlock is offered **one** invocation instead of ten. Repeat-grants cannot express it: the column steps by **+2** at L2 and L5, and a level row can list a feature only once. `extraPicks: [{offer:"feature:eldritch-invocations"}]` says the right thing but has nothing to hang on — the SRD prints no feature heading at L2/L5/L7/…, so there is no carrier at those levels. See §3G. |
| 2 | `fighter` / `weapon-mastery` | class | 1 | "as shown in the Weapon Mastery column" | pick-budget scaling | **new** | `choose: 3` fixed; column 3 → 4 (L4) → 5 (L10) → 6 (L16). **Fighter is `HAND_AUTHORED` and still has this gap** — being hand-authored did not save it. Same carrier problem as #1. |
| 3 | `barbarian` / `weapon-mastery` | class | 1 | same wording | pick-budget scaling | **new** | `choose: 2` fixed; column 2 → 3 (L4) → 4 (L10). Same. |

> Paladin, Ranger and Rogue Weapon Mastery are **not** gaps — the SRD prints no column for them and
> their text says a flat "two kinds of weapons". Sorcerer Metamagic is **not** a gap either: granted
> at L2/L10/L17 × `choose: 2` = 6, which is exactly what the SRD grants.

### Tier 2 — whole features that do nothing at all

| # | record | kind | level | what the text promises | category | expressible? | notes |
|---:|---|---|---:|---|---|---|---|
| 4 | `druid` / `primal-order` | class | 1 | choose **Magician** (one extra Druid cantrip + Arcana/Nature bonus) or **Warden** (Martial weapons + Medium armor training) | option pick + cantrip + weapon/armour | **today** | The exact twin of Cleric's Divine Order, and it has **no `choice` block at all**. Cleric's is fully authored: inline `options`, Thaumaturge carrying `extraPicks: [{offer:"class-cantrips", amount:1}]`, Protector carrying `grants.weapons`/`grants.armor`. Magician is the same two lines with `druid` in place of `cleric`. **This is the single closest twin of the reported bug and the first thing Stage 4 should author.** |
| 5 | `druid` / `elemental-fury` | class | 7 | choose Potent Spellcasting or Primal Strike | option pick | **today** | Twin of Cleric's `blessed-strikes`, which *is* authored. No `choice`. |
| 6–14 | `barbarian`·`bard`·`druid`·`monk`·`paladin`·`ranger`·`rogue`·`sorcerer`·`warlock` / `epic-boon` | class | 19 | "You gain an Epic Boon feat … or another feat of your choice" | free feat | **today** | Nine records, **no `choice`**. Cleric, Fighter and Wizard already author `{kind:"feat", fromCatalog:"epic-boon-feats"}` and the catalog resolves (7 epic-boon feats ship). Purely a missing line in the ETL's per-class `choices` map. |
| 15–18 | `warlock` / `mystic-arcanum-level-{6,7,8,9}-spell` | class | 11/13/15/17 | "Choose one level N Warlock spell as this arcanum" | spell pick | **today**\* | Four records, none with a `choice`. \*`maxSpellLevel` gives a *ceiling*, not an *exact level* — authored as-is, an L11 Warlock could pick a level-3 spell as their arcanum. Needs a `minSpellLevel` sibling to be exactly right. |
| 19 | `college-of-lore` / `bonus-proficiencies` | subclass | 3 | "You gain proficiency with three skills of your choice" | skill | **today** | `{kind:"skill", choose:3, fromCatalog:"skills"}`. |
| 20 | `barbarian` / `primal-knowledge` | class | 3 | "proficiency in another skill … from the skill list available to Barbarians at level 1" | skill | **today** | One line: `extraPicks: [{offer:"class-skills", amount:1}]`. Before the rider this needed the class's skill list restated in a `from:[…]`; it is now the textbook case the rider was built for — *"another skill from your class's list"* is a budget, not a new list. |
| 21 | `hunter` / `hunters-prey` | subclass | 3 | choose Colossus Slayer or Horde Breaker | option pick | **today** | Inline `options` with riders. |
| 22 | `hunter` / `defensive-tactics` | subclass | 7 | choose Escape the Horde or Multiattack Defense | option pick | **today** | Same. |
| 23 | `draconic-sorcery` / `elemental-affinity` | subclass | 6 | "Choose one of those types: Acid, Cold, Fire, Lightning, or Poison. You have Resistance to that damage type" | option pick (resistance) | **today** | Five inline `options`, each with `grants.damageResistances`. The damage-bonus half stays prose. |
| 24 | `warlock` / `lessons-of-the-first-ones` | class option | — | "gain one Origin feat of your choice" | free feat | **today** | An option's own nested `choice` is legal (`FeatureOptionChoiceSchema`) — this is exactly the Thaumaturge shape. |
| 25 | `warlock` / `pact-of-the-blade` | class option | — | "a Simple or Martial Melee weapon of your choice with which you bond … you have proficiency with the weapon" | weapon proficiency | **today** | Nested `{kind:"weapon", fromCatalog:"weapons"}` + `grants.weapons`. |

### Tier 3 — always-prepared and at-will spells never handed over

All of these are one `grants.spells` line. The Life Domain records already do it correctly and are
the template.

| # | record | kind | level | promise | expressible? | notes |
|---:|---|---|---:|---|---|---|
| 26 | `draconic-sorcery` / `draconic-spells` | subclass | 3 | always-prepared spells by Sorcerer level | **today** | **Prose is also truncated** — see §6. |
| 27 | `fiend-patron` / `fiend-spells` | subclass | 3 | same | **today** | Same truncation. |
| 28 | `oath-of-devotion` / `oath-of-devotion-spells` | subclass | 3 | same | **today** | Same truncation. |
| 29 | `circle-of-the-land` / `circle-of-the-land-spells` | subclass | 3 | "choose one type of land … you have the spells listed for your Druid level prepared" | **partly** | The four spell sets are authorable; the *long-rest re-choice* of land is not (see §3). |
| 30 | `paladin` / `paladins-smite` | class | 2 | always have Divine Smite prepared, 1/long rest free | **today** | `grants.spells` + `uses`. |
| 31 | `paladin` / `faithful-steed` | class | 5 | always have Find Steed prepared, 1/long rest free | **today** | Same. |
| 32 | `ranger` / `favored-enemy` | class | 1 | always have Hunter's Mark prepared, free casts per the Favored Enemy column | **today** | `grants.spells` + `uses.scaling {type:"class-resource", id:"favored-enemy"}` — the column already exists in the level table. |
| 33 | `warlock` / `contact-patron` | class | 9 | always have Contact Other Plane prepared | **today** | |
| 34 | `bard` / `words-of-creation` | class | 20 | "you always have the Power Word Heal and Power Word Kill spells prepared" | **today** | |
| 35 | `druid` / `druidic` | class | 1 | know Druidic **and** always have Speak with Animals prepared | **today** | `grants.languages` + `grants.spells`. |
| 36 | `warlock` / `pact-of-the-chain` | class option | — | "You learn the Find Familiar spell and can cast it … without expending a spell slot" | **today** | |
| 37–47 | `warlock` invocations: `armor-of-shadows`, `ascendant-step`, `fiendish-vigor`, `gift-of-the-depths`, `mask-of-many-faces`, `master-of-myriad-forms`, `misty-visions`, `one-with-shadows`, `otherworldly-leap`, `visions-of-distant-realms`, `whispers-of-the-grave` | class option | — | "You can cast *X* without expending a spell slot" | **today** | Eleven records, one `grants.spells` (+ `uses` where the SRD limits it) each. `gift-of-the-depths` also owes a Swim Speed, which has no vocabulary — leave it prose. |

### Tier 4 — the awkward tail (new machinery required)

| # | record | kind | level | promise | category | expressible? | notes |
|---:|---|---|---:|---|---|---|---|
| 48 | `paladin` / `fighting-style` | class | 2 | a Fighting Style feat **or** "Blessed Warrior: you learn two Cleric cantrips" | catalog + inline option | **new** | `options` derives `from`, and **`from` always beats `fromCatalog`** in both consumers (`build-payload.ts` `resolveChoice`, `character-build.ts` `featureOffer`). So "the whole feats catalog **plus** one bespoke option" is unsayable. Today Blessed Warrior is simply unpickable. |
| 49 | `ranger` / `fighting-style` | class | 2 | same, with "Druidic Warrior: two Druid cantrips" | catalog + inline option | **new** | Identical. |
| 50 | `warlock` / `pact-of-the-tome` | class option | — | "choose three cantrips, and choose two level 1 spells that have the Ritual tag … from any class's spell list" | multi-pick + cross-list + tag filter | **new** | Three separate problems: an option may carry only **one** nested `choice`; there is no "every spell list" catalog slug; and there is no way to filter on the Ritual tag. |
| 51–53 | `warlock` / `agonizing-blast`, `eldritch-spear`, `repelling-blast` | class option | — | "Choose one of your known Warlock cantrips that deals damage" | pick over own prior picks | **new** | The option list is *the character's own earlier answers*, plus a predicate over the chosen spells. No catalog family can express it. |
| 54 | `druid` / `wild-shape` | class | 2 | "You know four Beast forms … maximum Challenge Rating 1/4 and that lack a Fly Speed", growing by level | beast forms | **new** | No monster catalog family in `packages/domain/src/catalog-choice.ts`, no CR ceiling in the vocabulary (`maxSpellLevel` is the only ceiling), and the count *and* the CR both scale by level. |
| 55 | `bard` / `magical-secrets` | class | 10 | from L10 on, the class's *own* prepared-spell picks may come from Bard/Cleric/Druid/Wizard | widen an existing budget | **new** | **Currently mis-wired, not merely missing**: authored as a separate `{kind:"spell", choose:2, fromCatalog:"bard-spells"}` — the wrong mechanic *and* the wrong list. The real promise changes the *source list of an existing budget* at a level. |
| 56 | `college-of-lore` / `magical-discoveries` | subclass | 6 | "two spells … from the Cleric, Druid, or Wizard spell list or any combination" | multi-list spell pick | **partly** | `fromCatalog` takes one slug. Expressible *only* by publishing a `SpellListReference` overlay (`basedOn: ["cleric","druid","wizard"]`) — which exists, but is a homebrew-merge path, not something an SRD bundle record can point at today. |
| 57–59 | `magic-initiate-cleric`, `magic-initiate-druid`, `magic-initiate-wizard` | feat | — | "two cantrips … **You also choose one level 1 spell** from that list" | second pick on one record | **new** | All three author `{kind:"cantrip", choose:2, maxSpellLevel:0}`. The level-1 spell is silently dropped, because a `FeatureRecord` has exactly **one** `choice` and one `maxSpellLevel`. Two of the four SRD backgrounds grant a Magic Initiate as their origin feat (Acolyte → Cleric, Sage → Wizard), so **half of all level-1 characters hit this before they reach the class step**. |
| 60 | `skilled` | feat | — | "any combination of three **skills or tools**" | tool | **partly** | `{kind:"skill-or-tool", choose:3, fromCatalog:"skills"}` — tools are unofferable. There is no `tools` catalog family; an explicit `from` list would work but no canonical tool-id list is published as data. |
| 61 | `ranger` / `deft-explorer` | class | 2 | one Expertise **and** "two languages of your choice" | expertise + language | **partly** | Expertise is one line. Languages are blocked twice over: `extraPicks: [{offer:"species-languages", amount:2}]` is the right *shape*, but **no SRD species or background declares `languageChoices`, so that offer never exists** — and the server rejects a key naming no real budget, correctly and loudly. There is also no `languages` catalog family; the SRD's Standard/Rare language tables live only as **prose** inside `packages/content-srd-5.2.1/bundles/rules.v1.json`. |
| 62 | `rogue` / `thieves-cant` | class | 1 | Thieves' Cant **and** "one other language of your choice" | language | **partly** | Grant half is `grants.languages: ["thieves-cant"]`. The pick half is blocked identically to #61. |
| 63 | `cleric` / `improved-blessed-strikes` | class | 14 | "The option you chose for Blessed Strikes grows more powerful" | choice read-back | **new** | Needs a rider conditioned on an *earlier answer*. Cleric is `HAND_AUTHORED` and this is its **only** remaining gap. |
| 64 | `druid` / `improved-elemental-fury` | class | 15 | same shape, over Elemental Fury | choice read-back | **new** | |
| 65 | `circle-of-the-land` / `natures-ward` | subclass | 10 | "Resistance to a damage type associated with your **current land choice**" | choice read-back | **new** | |
| 66 | `fiend-patron` / `fiendish-resilience` | subclass | 10 | "Choose one damage type … whenever you finish a Short or Long Rest" | rest-time re-choice | **new** | The pick itself is Divine-Order-shaped; the *re-choosing on a rest* is not (see §3). |

---

## 3. Vocabulary gaps — promises the incoming pick-budget rider does **not** reach

The pick-budget rider fixes "+N to an existing budget". These are different in kind and will still be
broken the day after it ships. **Stage 4 should treat each as its own design question, not a content
authoring task.**

**A. Mutation of an existing choice ("you can replace…").** The single largest unmodelled family:
**33 distinct build- or rest-time replacement clauses** across the content, none of which has any
vocabulary. Replacement is not a budget increase — it is an edit to a `choices[]` ledger row, and the
ledger is the thing respec and level-up are built on.

- *On level-up, replace a cantrip*: Bard, Cleric, Druid, Sorcerer Spellcasting; Warlock Pact Magic;
  Paladin/Ranger Fighting Style (the Blessed/Druidic Warrior cantrips); Elf (High Elf) Arcane Cantrip
  (long rest).
- *On level-up, replace a chosen option*: Fighter Fighting Style (the feat itself), Sorcerer
  Metamagic, Warlock Eldritch Invocations, Warlock Mystic Arcanum ×4, Magic Initiate (Cleric) and
  (Druid) — note Magic Initiate (Wizard) omits the clause.
- *On a rest, re-choose*: Barbarian/Fighter/Paladin/Ranger/Rogue Weapon Mastery (5), Druid Wild Shape
  known forms, Paladin/Ranger Spellcasting prepared list, Wizard Memorize Spell, Hunter's Prey,
  Defensive Tactics, Circle of the Land land type, Fiendish Resilience damage type, Nature's Ward.
- *Widen what a replacement may draw from*: Bard Magical Secrets, College of Lore Magical Discoveries.

Excluded deliberately: Dragonborn Breath Weapon ("replace one of your attacks"), Fighter Tactical
Master, Alert Initiative Swap — those are in-combat actions, already resolvable by the action path.

**B. Two picks on one record.** A `FeatureRecord` and a `FeatureOption` each carry exactly **one**
`choice`, with one `kind` and one `maxSpellLevel`. Magic Initiate ×3 (2 cantrips + 1 level-1 spell),
Deft Explorer (expertise + languages), Pact of the Tome (3 cantrips + 2 rituals) and Divine
Order-shaped options generally all want two. This is arguably a *cheaper* fix than it looks — an
array of choices instead of one — but it touches the offer key scheme in both consumers.

**C. No catalog family for languages, tools, or creatures — and no language budget to raise.**
`packages/domain/src/catalog-choice.ts` resolves exactly six families: `skills`, `weapons`,
`<listId>-spells`, `<classId>-subclasses`, `<category>-feats`, `<speciesId>-lineages`. Missing:
`languages`, `tools` (Skilled), and beasts/monsters (Wild Shape). Damage types are **not** in this
list — they are expressible as inline `options` carrying `grants.damageResistances`, so they are not
blocking.

Languages are the sharp one, and `extraPicks` makes the diagnosis cleaner rather than fixing it: the
rider can raise `species-languages` or `background-languages`, but **no SRD species or background
declares `languageChoices`, so neither offer exists on any real build** — which means
**the base "Common plus two languages" every character is owed by Character Creation is never
offered at all**, quite apart from Deft Explorer and Thieves' Cant. Fixing the base case (give the
species or background a real `languageChoices` list) is the prerequisite that makes the two feature
gaps one line each.

**D. `from` and `fromCatalog` cannot be combined.** Both consumers short-circuit on a non-empty
`from`, and `options` derives `from`. A choice of "everything in a catalog, plus this one bespoke
thing" is unsayable. Costs Paladin and Ranger their Fighting Style variant.

**E. A pick whose option list is the character's own prior answers.** Agonizing Blast, Eldritch
Spear, Repelling Blast — all three additionally want a predicate ("that deals damage", "with a range
of 10+ feet", "that requires an attack roll").

**F. A rider conditioned on an earlier choice.** Improved Blessed Strikes, Improved Elemental Fury,
Nature's Ward. Cheapest plausible answer: split them into inline `options` gated on the parent
answer, which the offer machinery does not yet support.

**G. Level-scaled pick capacity — the gap `extraPicks` gets closest to and still does not close.**
`FeatureUsesSchema` already models four ways *uses* scale, including reading a printed column via
`{type:"class-resource"}`. Neither `FeatureChoice.choose` nor `ExtraPickSchema.amount` has any of
that: both are flat integers. `extraPicks` composes by addition and multiplies by grant count, so a
budget *can* grow — but only if some feature is granted at each level the column steps, and for
Eldritch Invocations (L2/L5/L7/L9/L12/L15/L18) and Weapon Mastery (L4/L10/L16) **the SRD prints no
feature heading at those levels to carry the grant**. Inventing marker features would be inventing
content the source does not have.

The honest fix is a `class-resource`-style scaling for capacity — the same four-way scaling
`FeatureUsesSchema` already has, applied to `choose`/`amount` so a budget can read the printed column
directly. **Worth designing while `extraPicks` is fresh**, since it is the same composition problem
one level up, and it is the only gap where a level-20 character is quantifiably, countably wrong.

**H. Exact spell level, not a ceiling.** `maxSpellLevel` has no `minSpellLevel` sibling. Mystic
Arcanum wants "a level 6 spell", not "level 6 or lower".

---

## 4. The cheap majority vs the awkward tail

| | records | share |
|---|---:|---:|
| **Cheap** — authorable today, no engine change | **43** | 65% |
| **Awkward** — needs machinery that does not exist yet | **23** | 35% |

**The cheap 43**, in the order they should be authored (each is a data edit, verifiable by building a
character and counting the offers):

1. **21 spell grants** (Tier 3) — one `grants.spells` line each. Life Domain is the working template.
2. **9 Epic Boons** — one entry in each class's `choices` map in
   `packages/content-srd-5.2.1/scripts/build-class-bundle.ts`. Cleric/Fighter/Wizard already show the
   exact shape. This is the single highest ratio of players-unblocked to lines-changed.
3. **6 option picks** — Primal Order, Elemental Fury, Elemental Affinity, Hunter's Prey, Defensive
   Tactics, Fiendish Resilience (its base pick). All are the Divine Order / Blessed Strikes pattern,
   already proven end to end — and Primal Order's Magician half is now a two-line `extraPicks` grant
   rather than a nested choice, so it is the cheapest of the six.
4. **4 Mystic Arcanum** spell picks (with the `minSpellLevel` caveat).
5. **2 skill picks**, **1 weapon pick**, and Lessons of the First Ones' feat pick.

**The awkward 23** cluster into five design questions, not twenty-three tasks: replacement (§3A),
two-picks-per-record (§3B), missing catalog families (§3C), catalog-plus-inline (§3D), and
level-scaled capacity (§3G). Sequencing suggestion: **§3G first** — it is adjacent to the rider being
built right now and it unblocks the three records where a level-20 character is quantifiably wrong.

**Two structural blockers Stage 4 will hit immediately, before any of the above:**

- **`SUBCLASS_MECHANICS` is declared and never merged.** It is exported from
  `packages/content-srd-5.2.1/scripts/class-mechanics/index.ts` but `build-class-bundle.ts` imported
  only `CLASS_MECHANICS`, `LIVE_CLASS_RESOURCES` and `applyMechanics`. **Fixed in `9f31dd9`.** Nine of the twelve subclasses are
  ETL-generated, so **there is no authoring surface for a subclass rider at all today** — 10 of the
  11 subclass gaps are unauthorable until that is wired. (Champion, Evoker and Life Domain are
  preserved from the bundle because their class is `HAND_AUTHORED`, which is why Life Domain alone
  carries real `grants.spells`.)
- **The subclass parser strips HTML tables.** `build-class-bundle.ts` runs
  `.replace(/<table>[\s\S]*?<\/table>/g, " ")` over every subclass feature body. That is why Draconic
  Spells, Fiend Spells, Oath of Devotion Spells and Circle of the Land Spells have *truncated prose*
  as well as no riders — their descriptions end mid-sentence at the table. The tables are present and
  complete in `packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/classes.md`; Stage 4 must read
  them from there. Life Domain's four records show what the finished shape looks like: one feature per
  level tier, each with its own `grants.spells`.

---

## 5. Already correctly wired — do not redo

`fighter`, `wizard` and `cleric` are in `HAND_AUTHORED` (`build-class-bundle.ts`), which is why their
riders survive a rebuild. Verified as working:

- **Cleric.** `divine-order` — inline `options`, Protector carrying `grants.weapons: ["martial"]` +
  `grants.armor: ["heavy"]`, **Thaumaturge carrying `extraPicks: [{offer:"class-cantrips",
  amount:1}]`**. `blessed-strikes` (2 options, Divine Strike with an action), `channel-divinity`
  (2 actions + `uses`), `epic-boon`, `ability-score-improvement`, `cleric-subclass`, and all four
  Life Domain spell tiers. The reported bug **was** the missing rider, and it is now authored: the
  server composes `printedCantrips + extraPickBudgets` for the cap and the sheet's `prepared` number,
  and `computeOffers` composes the identical sum for the offer it renders, reading the grant off the
  option the player actually took. Cleric's one remaining gap is #63, `improved-blessed-strikes`.
- **Wizard.** `scholar` (expertise from an explicit 6-skill list), `spell-mastery`,
  `signature-spells`, `epic-boon`, `wizard-subclass`, Evoker's `evocation-savant`
  (`maxSpellLevel: 2`).
- **Fighter.** `fighting-style` (feat catalog), `ability-score-improvement` ×6 levels, `epic-boon`,
  `fighter-subclass`, Champion's `additional-fighting-style`. *(Its Weapon Mastery column is still
  gap #2.)*
- **Class spell budgets.** All 12 level tables carry correct `cantripsKnown` / `preparedCount`
  columns, and `build-payload.ts` builds the untagged class-cantrip and prepared-spell offers from
  them. The base budgets are right; only the *feature-driven additions* to them are missing.
- **Repeat capacity.** `grantedAtLevels` × `choose` already handles Bard Expertise (L2+L9 = 4), Rogue
  Expertise (L1+L6 = 4), Sorcerer Metamagic (L2+L10+L17 = 6) and every ASI. Verified correct against
  the SRD.
- **All 9 species and 12 lineages.** Every promise delivered: Dragonborn breath weapons and
  resistances per lineage, Elf Keen Senses (`from` of 3 skills) and lineage cantrip, Gnome lineage
  cantrips and Speak with Animals, Goliath Giant Ancestry (6 inline options, each with an action),
  Human Skillful (skills catalog) and Versatile (origin-feats catalog), Tiefling Fiendish Legacy with
  all three legacies' L1/L3/L5 spells, Dwarf Toughness (`hit-points-per-level`), Orc, Halfling.
- **All 4 backgrounds.** `abilityOptions`, `originFeatId`, skills, tools/`toolChoices`, equipment.
- **15 of 19 feats.** All 7 epic boons (`choice.maximum: 30`), ASI, Grappler, Skilled (skills half),
  Defense (`armor-class` modifier), Alert, Savage Attacker, the three other fighting styles.

---

## 6. Method, so the count can be re-derived

Every record in `bundles/{classes,subclasses,species,backgrounds,feats}.v1.json` was flattened —
including `choice.options[]` on features and `lineages[].traits[]` on species — to 373 feature-bearing
records. Each description was matched against promise-language patterns (cantrip, spells
known/prepared, skill, expertise, language, tool, weapon/armour, feat, replace/swap, ability score,
mastery, "of your choice"), then every hit was read by hand against its **bundle record's actual
rider block** — `choice`, `grants`, `modifiers`, `actions`, `effects`, `uses` — and against
`packages/content-srd-5.2.1/sources/dnd-5e-srd-markdown/classes.md` where the bundle prose looked
truncated. A record counts as a gap only when a promise in its text has no rider covering it. Records
whose only unmodelled content is in-combat rules text (Sculpt Spells, Deflect Attacks, Cutting Words,
the Metamagic bodies) are **out of scope here** — they are part of Stage 4's 226, but they are not
*picks or grants*, and a pick-budget rider would do nothing for them.

`CARRIER_RIDER_DISPOSITION` (`apps/server/src/character-build.ts`) was used as the map of which riders
reach which carriers; note it covers the 13 roll-time riders, none of which is a pick or a grant.
Rider plumbing for class/subclass/species/background features was fixed in `d4c25fa`, and the
pick-budget rider (`extraPicks`) landed during this audit — so riders authored on those carriers do
reach the table now, and every gap above is a genuine absence of authored data or of design, not
plumbing. Each of the 66 was confirmed by reading its bundle record: none carries an `extraPicks`
block, and none carries a `choice`, `grants` or `modifiers` entry covering the promise in its text.
